package hooks

import (
	"context"
	"crypto/sha1"
	"encoding/hex"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode"

	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turnpolicies"
	"codex-server/backend/internal/turns"
)

const (
	eventNameSessionStart     = "SessionStart"
	eventNameUserPromptSubmit = "UserPromptSubmit"
	eventNamePreToolUse       = "PreToolUse"
	eventNamePostToolUse      = "PostToolUse"
	eventNameStop             = "Stop"
	eventNameServerRequest    = "ServerRequest"
	eventNameTurnStart        = "TurnStart"
	eventNameTurnSteer        = "TurnSteer"
	eventNameTurnInterrupt    = "TurnInterrupt"
	eventNameReviewStart      = "ReviewStart"
	eventNameHTTPMutation     = "HttpMutation"

	handlerKeySessionStartProjectContext = "builtin.sessionstart.inject-project-context"
	handlerKeySecretPrompt               = "builtin.userpromptsubmit.block-secret-paste"
	handlerKeyDangerousCommand           = "builtin.pretooluse.block-dangerous-command"
	handlerKeyProtectedPathWrite         = "builtin.pretooluse.block-protected-governance-file-mutation"
	handlerKeyFailedValidation           = "builtin.posttooluse.failed-validation-rescue"
	handlerKeyMcpToolCallAudit           = "builtin.posttooluse.audit-mcp-tool-call"
	handlerKeyMcpElicitationAudit        = "builtin.serverrequest.audit-mcp-elicitation-request"
	handlerKeyServerRequestApprovalAudit = "builtin.serverrequest.audit-approval-request"
	handlerKeyTurnStartAudit             = "builtin.turnstart.audit-thread-turn-start"
	handlerKeyTurnSteerAudit             = "builtin.turnsteer.audit-thread-turn-steer"
	handlerKeyTurnInterruptAudit         = "builtin.turninterrupt.audit-thread-interrupt"
	handlerKeyReviewStartAudit           = "builtin.reviewstart.audit-thread-review-start"
	handlerKeyHTTPMutationAudit          = "builtin.httpmutation.audit-workspace-mutation"
	handlerKeyMissingVerification        = "builtin.stop.require-successful-verification"

	policyNameFailedValidation    = "posttooluse/failed-validation-command"
	policyNameMissingVerification = "stop/missing-successful-verification"

	hookStatusRunning   = "running"
	hookStatusCompleted = "completed"
	hookStatusFailed    = "failed"

	decisionContinue     = "continue"
	decisionBlock        = "block"
	decisionContinueTurn = "continueTurn"

	actionNone      = "none"
	actionSteer     = "steer"
	actionFollowUp  = "followUp"
	actionInterrupt = "interrupt"

	actionStatusSucceeded = "succeeded"
	actionStatusFailed    = "failed"
	actionStatusSkipped   = "skipped"

	interruptNoActiveTurnBehaviorSkip = "skip"
	reasonInterruptNoActiveTurn       = "interrupt_no_active_turn"
	reasonSessionStartAudited         = "session_start_audited"

	sessionStartSourceStartup = "startup"
	sessionStartSourceClear   = "clear"
	sessionStartSourceResume  = "resume"

	governanceLayerHook = "hook"

	defaultActionTimeout = 10 * time.Second
)

var (
	privateKeyBlockPattern = regexp.MustCompile(`(?i)-----begin [a-z0-9 ]*private key-----`)
	openAIAPIKeyPattern    = regexp.MustCompile(`(?i)\bsk[-_][a-z0-9_-]{20,}\b`)
	githubPATPattern       = regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b`)
	slackTokenPattern      = regexp.MustCompile(`\bxox[baprs]-[A-Za-z0-9-]{20,}\b`)
	bearerHeaderPattern    = regexp.MustCompile(`(?i)\bauthorization\s*:\s*bearer\s+([A-Za-z0-9._~+/\-=]{16,})`)
	namedSecretPattern     = regexp.MustCompile(`(?im)\b(?:openai[_-]?api[_-]?key|api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|aws[_-]?secret[_-]?access[_-]?key|bot[_-]?token|password|passwd|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9._~+/\-=]{16,})["']?`)
)

type turnExecutor interface {
	Start(ctx context.Context, workspaceID string, threadID string, input string, options turns.StartOptions) (turns.Result, error)
	Steer(ctx context.Context, workspaceID string, threadID string, input string) (turns.Result, error)
	Interrupt(ctx context.Context, workspaceID string, threadID string) (turns.Result, error)
	Review(ctx context.Context, workspaceID string, threadID string) (turns.Result, error)
}

type Service struct {
	store  *store.MemoryStore
	turns  turnExecutor
	events *events.Hub

	now           func() time.Time
	actionTimeout time.Duration

	mu         sync.Mutex
	started    bool
	inFlightBy map[string]struct{}
}

type ListOptions struct {
	RunID      string
	ThreadID   string
	EventName  string
	Status     string
	HandlerKey string
	Limit      int
}

type PreToolUseInput struct {
	WorkspaceID     string
	ThreadID        string
	TurnID          string
	ToolKind        string
	ToolName        string
	TriggerMethod   string
	Scope           string
	Command         string
	TargetPath      string
	DestinationPath string
}

type SessionStartInput struct {
	WorkspaceID        string
	ThreadID           string
	TriggerMethod      string
	Scope              string
	Input              string
	SessionStartSource string
}

type SessionStartResult struct {
	Applied            bool
	UpdatedInput       string
	AdditionalContext  string
	SessionStartSource string
	Run                *store.HookRun
}

type UserPromptSubmitInput struct {
	WorkspaceID   string
	ThreadID      string
	TurnID        string
	TriggerMethod string
	Scope         string
	Input         string
}

type UserPromptSubmitResult struct {
	Allowed bool
	Blocked bool
	Reason  string
	Run     *store.HookRun
}

type PreToolUseResult struct {
	Allowed bool
	Blocked bool
	Reason  string
	Run     *store.HookRun
}

type hookEvaluation struct {
	run                           store.HookRun
	policyName                    string
	verdict                       string
	action                        string
	reason                        string
	evidenceSummary               string
	fingerprint                   string
	prompt                        string
	followUpCooldown              time.Duration
	interruptNoActiveTurnBehavior string
}

type protectedPathMutationMatch struct {
	policy        string
	message       string
	matchedPath   string
	candidatePath string
	candidateKey  string
}

type protectedGovernanceTarget struct {
	policy  string
	message string
}

type mutationPathCandidate struct {
	key  string
	path string
}

func NewService(dataStore *store.MemoryStore, turnService turnExecutor, eventHub *events.Hub) *Service {
	return &Service{
		store:         dataStore,
		turns:         turnService,
		events:        eventHub,
		now:           func() time.Time { return time.Now().UTC() },
		actionTimeout: defaultActionTimeout,
		inFlightBy:    make(map[string]struct{}),
	}
}

func (s *Service) Start(ctx context.Context) {
	s.mu.Lock()
	if s.started {
		s.mu.Unlock()
		return
	}
	s.started = true
	s.mu.Unlock()

	if s.store == nil || s.turns == nil || s.events == nil {
		return
	}

	eventsCh, cancel := s.events.SubscribeAll()
	go func() {
		defer cancel()
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-eventsCh:
				if !ok {
					return
				}
				go s.handleEvent(ctx, event)
			}
		}
	}()
}

func (s *Service) List(workspaceID string, options ListOptions) ([]store.HookRun, error) {
	if s.store == nil {
		return []store.HookRun{}, nil
	}

	workspaceID = strings.TrimSpace(workspaceID)
	options.RunID = strings.TrimSpace(options.RunID)
	options.ThreadID = strings.TrimSpace(options.ThreadID)
	options.EventName = strings.TrimSpace(options.EventName)
	options.Status = strings.TrimSpace(options.Status)
	options.HandlerKey = strings.TrimSpace(options.HandlerKey)

	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return nil, store.ErrWorkspaceNotFound
	}

	items := s.store.ListHookRuns(workspaceID, options.ThreadID)
	filtered := items[:0]
	for _, item := range items {
		if options.RunID != "" && item.ID != options.RunID {
			continue
		}
		if options.EventName != "" && item.EventName != options.EventName {
			continue
		}
		if options.Status != "" && item.Status != options.Status {
			continue
		}
		if options.HandlerKey != "" && item.HandlerKey != options.HandlerKey {
			continue
		}
		filtered = append(filtered, item)
	}

	if options.Limit > 0 && len(filtered) > options.Limit {
		return append([]store.HookRun(nil), filtered[:options.Limit]...), nil
	}

	return append([]store.HookRun(nil), filtered...), nil
}

func (s *Service) ReadConfiguration(workspaceID string) (ConfigurationReadResult, error) {
	if s.store == nil {
		return ConfigurationReadResult{}, nil
	}

	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return ConfigurationReadResult{}, store.ErrWorkspaceNotFound
	}

	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return ConfigurationReadResult{}, store.ErrWorkspaceNotFound
	}

	return ResolveConfiguration(workspace, s.store.GetRuntimePreferences()), nil
}

func (s *Service) WriteConfiguration(workspaceID string, input WorkspaceConfigOverrides) (ConfigurationWriteResult, error) {
	if s.store == nil {
		return ConfigurationWriteResult{}, nil
	}

	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return ConfigurationWriteResult{}, store.ErrWorkspaceNotFound
	}

	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return ConfigurationWriteResult{}, store.ErrWorkspaceNotFound
	}

	rootPath := strings.TrimSpace(workspace.RootPath)
	if rootPath == "" {
		return ConfigurationWriteResult{}, errors.New("workspace root path is required")
	}

	normalized, err := NormalizeWorkspaceConfigOverrides(input)
	if err != nil {
		return ConfigurationWriteResult{}, err
	}

	searchPaths := workspaceHookConfigurationWritePaths(rootPath)
	if len(searchPaths) == 0 {
		return ConfigurationWriteResult{}, errors.New("workspace hook configuration path is unavailable")
	}

	targetPath := searchPaths[0]
	status := "deleted"
	if HasWorkspaceConfigOverrides(normalized) {
		content, err := RenderWorkspaceFileConfig(normalized)
		if err != nil {
			return ConfigurationWriteResult{}, err
		}
		if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
			return ConfigurationWriteResult{}, err
		}
		if err := os.WriteFile(targetPath, append(content, '\n'), 0o644); err != nil {
			return ConfigurationWriteResult{}, err
		}
		status = "written"
	}

	for _, path := range searchPaths {
		if path == targetPath && status == "written" {
			continue
		}
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return ConfigurationWriteResult{}, err
		}
	}

	return ConfigurationWriteResult{
		Status:        status,
		FilePath:      targetPath,
		Configuration: ResolveConfiguration(workspace, s.store.GetRuntimePreferences()),
	}, nil
}

func (s *Service) EvaluateSessionStart(_ context.Context, input SessionStartInput) (SessionStartResult, error) {
	if s.store == nil {
		return SessionStartResult{UpdatedInput: input.Input}, nil
	}

	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	input.TriggerMethod = strings.TrimSpace(input.TriggerMethod)
	input.Scope = strings.TrimSpace(input.Scope)
	input.Input = strings.TrimSpace(input.Input)
	input.SessionStartSource = normalizeSessionStartLifecycleSource(input.SessionStartSource)

	if input.WorkspaceID == "" {
		return SessionStartResult{UpdatedInput: input.Input}, nil
	}
	workspace, ok := s.store.GetWorkspace(input.WorkspaceID)
	if !ok {
		return SessionStartResult{}, store.ErrWorkspaceNotFound
	}
	if input.ThreadID == "" || input.Input == "" {
		return SessionStartResult{UpdatedInput: input.Input}, nil
	}
	runtimeConfig := ResolveConfiguration(workspace, s.store.GetRuntimePreferences())
	if !runtimeConfig.EffectiveHookSessionStartEnabled {
		return SessionStartResult{UpdatedInput: input.Input}, nil
	}

	hasTurns := s.threadHasConversationTurns(input.WorkspaceID, input.ThreadID)
	pendingSource := normalizeSessionStartLifecycleSource(
		s.store.PendingThreadSessionStartSource(input.WorkspaceID, input.ThreadID),
	)
	threadSource := normalizeSessionStartLifecycleSource(
		s.threadSessionStartSource(input.WorkspaceID, input.ThreadID),
	)
	resolvedSource := firstNonEmpty(input.SessionStartSource, pendingSource, threadSource)
	if resolvedSource == "" && !hasTurns {
		resolvedSource = sessionStartSourceStartup
	}
	if !shouldEvaluateSessionStartSource(resolvedSource, input.SessionStartSource, pendingSource, hasTurns) {
		if hasTurns && pendingSource != sessionStartSourceResume {
			s.store.ClearPendingThreadSessionStartSource(input.WorkspaceID, input.ThreadID)
		}
		return SessionStartResult{UpdatedInput: input.Input}, nil
	}

	contextSource, contextText, contextLoaded := s.loadSessionStartContext(
		workspace,
		input.ThreadID,
		runtimeConfig.EffectiveHookSessionStartContextPaths,
		runtimeConfig.EffectiveHookSessionStartMaxChars,
	)
	updatedInput := input.Input
	reason := reasonSessionStartAudited
	entries := make([]store.HookOutputEntry, 0, 3)
	if contextLoaded {
		updatedInput = injectSessionStartContext(
			input.Input,
			contextSource,
			contextText,
			runtimeConfig.EffectiveHookSessionStartTemplate,
		)
		reason = "project_context_injected"
		entries = append(entries,
			store.HookOutputEntry{Kind: "feedback", Text: "loaded project context from " + contextSource},
			store.HookOutputEntry{Kind: "context", Text: fmt.Sprintf("context_length=%d", len([]rune(contextText)))},
		)
	} else {
		entries = append(entries, store.HookOutputEntry{Kind: "feedback", Text: "no project context matched"})
	}
	entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "sessionStartSource=" + resolvedSource})
	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "turn/start")
	run := store.HookRun{
		WorkspaceID:        input.WorkspaceID,
		ThreadID:           input.ThreadID,
		EventName:          eventNameSessionStart,
		HandlerKey:         handlerKeySessionStartProjectContext,
		HandlerType:        "builtin",
		Provider:           "server",
		ExecutionMode:      "sync",
		Scope:              firstNonEmpty(input.Scope, "thread"),
		TriggerMethod:      triggerMethod,
		SessionStartSource: resolvedSource,
		ToolKind:           "session",
		ToolName:           "turn/start",
		Status:             hookStatusRunning,
		Decision:           decisionContinue,
		Reason:             reason,
		Fingerprint: fingerprintFor(
			input.ThreadID,
			"",
			"",
			handlerKeySessionStartProjectContext,
			resolvedSource+"\x00"+contextSource+"\x00"+digestText(contextText),
		),
		AdditionalContext: contextText,
		Entries:           entries,
		Source:            s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt:         startedAt,
	}
	if contextLoaded {
		run.UpdatedInput = updatedInput
	}

	baseEvent := store.EventEnvelope{
		WorkspaceID: input.WorkspaceID,
		ThreadID:    input.ThreadID,
		Method:      triggerMethod,
		TS:          startedAt,
	}
	persistedRun, err := s.store.UpsertHookRun(run)
	if err != nil {
		return SessionStartResult{}, err
	}

	s.publishHookEvent(baseEvent, "hook/started", persistedRun)

	completedAt := s.now()
	durationMs := completedAt.Sub(startedAt).Milliseconds()
	persistedRun.Status = hookStatusCompleted
	persistedRun.CompletedAt = &completedAt
	persistedRun.DurationMs = &durationMs
	if _, err := s.store.UpsertHookRun(persistedRun); err == nil {
		s.publishHookEvent(baseEvent, "hook/completed", persistedRun)
	}
	if pendingSource == resolvedSource {
		s.store.ClearPendingThreadSessionStartSource(input.WorkspaceID, input.ThreadID)
	}

	return SessionStartResult{
		Applied:            contextLoaded,
		UpdatedInput:       updatedInput,
		AdditionalContext:  contextText,
		SessionStartSource: resolvedSource,
		Run:                &persistedRun,
	}, nil
}

func (s *Service) EvaluateUserPromptSubmit(_ context.Context, input UserPromptSubmitInput) (UserPromptSubmitResult, error) {
	if s.store == nil {
		return UserPromptSubmitResult{Allowed: true}, nil
	}

	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	input.TurnID = strings.TrimSpace(input.TurnID)
	input.TriggerMethod = strings.TrimSpace(input.TriggerMethod)
	input.Scope = strings.TrimSpace(input.Scope)
	input.Input = strings.TrimSpace(input.Input)

	if input.WorkspaceID == "" {
		return UserPromptSubmitResult{Allowed: true}, nil
	}
	workspace, ok := s.store.GetWorkspace(input.WorkspaceID)
	if !ok {
		return UserPromptSubmitResult{}, store.ErrWorkspaceNotFound
	}
	if input.Input == "" {
		return UserPromptSubmitResult{Allowed: true}, nil
	}
	if !ResolveConfiguration(workspace, s.store.GetRuntimePreferences()).EffectiveHookUserPromptSubmitBlockSecretPasteEnabled {
		return UserPromptSubmitResult{Allowed: true}, nil
	}

	match, ok := matchSecretPrompt(input.Input)
	if !ok {
		return UserPromptSubmitResult{Allowed: true}, nil
	}

	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "turn/input")
	run := store.HookRun{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		TurnID:        input.TurnID,
		EventName:     eventNameUserPromptSubmit,
		HandlerKey:    handlerKeySecretPrompt,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         firstNonEmpty(input.Scope, "thread"),
		TriggerMethod: triggerMethod,
		ToolKind:      "userPrompt",
		ToolName:      triggerMethod,
		Status:        hookStatusRunning,
		Decision:      decisionBlock,
		Reason:        "secret_like_input_blocked",
		Fingerprint: fingerprintFor(
			input.ThreadID,
			input.TurnID,
			"",
			handlerKeySecretPrompt,
			match.policy+"\x00"+digestText(input.Input),
		),
		Entries: []store.HookOutputEntry{
			{Kind: "feedback", Text: "matched policy: " + match.policy},
			{Kind: "context", Text: fmt.Sprintf("input_length=%d", len([]rune(input.Input)))},
		},
		Source:    s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt: startedAt,
	}

	baseEvent := store.EventEnvelope{
		WorkspaceID: input.WorkspaceID,
		ThreadID:    input.ThreadID,
		TurnID:      input.TurnID,
		Method:      triggerMethod,
		TS:          startedAt,
	}
	persistedRun, err := s.store.UpsertHookRun(run)
	if err != nil {
		return UserPromptSubmitResult{}, err
	}

	s.publishHookEvent(baseEvent, "hook/started", persistedRun)

	completedAt := s.now()
	durationMs := completedAt.Sub(startedAt).Milliseconds()
	persistedRun.Status = hookStatusCompleted
	persistedRun.CompletedAt = &completedAt
	persistedRun.DurationMs = &durationMs
	if _, err := s.store.UpsertHookRun(persistedRun); err == nil {
		s.publishHookEvent(baseEvent, "hook/completed", persistedRun)
	}

	return UserPromptSubmitResult{
		Allowed: false,
		Blocked: true,
		Reason:  match.message,
		Run:     &persistedRun,
	}, nil
}

func (s *Service) EvaluatePreToolUse(_ context.Context, input PreToolUseInput) (PreToolUseResult, error) {
	if s.store == nil {
		return PreToolUseResult{Allowed: true}, nil
	}

	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	input.TurnID = strings.TrimSpace(input.TurnID)
	input.ToolKind = strings.TrimSpace(input.ToolKind)
	input.ToolName = strings.TrimSpace(input.ToolName)
	input.TriggerMethod = strings.TrimSpace(input.TriggerMethod)
	input.Scope = strings.TrimSpace(input.Scope)
	input.Command = strings.TrimSpace(input.Command)
	input.TargetPath = strings.TrimSpace(input.TargetPath)
	input.DestinationPath = strings.TrimSpace(input.DestinationPath)

	if input.WorkspaceID == "" {
		return PreToolUseResult{Allowed: true}, nil
	}
	workspace, ok := s.store.GetWorkspace(input.WorkspaceID)
	if !ok {
		return PreToolUseResult{}, store.ErrWorkspaceNotFound
	}
	if input.Command == "" && input.TargetPath == "" && input.DestinationPath == "" {
		return PreToolUseResult{Allowed: true}, nil
	}
	configuration := ResolveConfiguration(workspace, s.store.GetRuntimePreferences())

	if match, ok := matchProtectedGovernancePathMutation(
		workspace.RootPath,
		input,
		configuration.EffectiveHookPreToolUseProtectedGovernancePaths,
	); ok {
		return s.completeBlockedPreToolUseRun(
			input,
			handlerKeyProtectedPathWrite,
			"protected_governance_file_mutation_blocked",
			match.message,
			match.policy,
			[]store.HookOutputEntry{
				{Kind: "feedback", Text: match.candidateKey + "=" + match.candidatePath},
				{Kind: "context", Text: "matched path: " + match.matchedPath},
			},
			match.policy+"\x00"+match.matchedPath+"\x00"+match.candidateKey+"\x00"+match.candidatePath,
		)
	}

	if !configuration.EffectiveHookPreToolUseBlockDangerousCommandEnabled {
		return PreToolUseResult{Allowed: true}, nil
	}

	match, ok := matchDangerousCommand(input.Command)
	if !ok {
		return PreToolUseResult{Allowed: true}, nil
	}

	return s.completeBlockedPreToolUseRun(
		input,
		handlerKeyDangerousCommand,
		"dangerous_command_blocked",
		match.message,
		match.policy,
		[]store.HookOutputEntry{
			{Kind: "feedback", Text: "command=" + input.Command},
			{Kind: "context", Text: "matched policy: " + match.policy},
		},
		match.policy+"\x00"+normalizeCommandWhitespace(input.Command),
	)
}

func (s *Service) InterceptServerRequest(
	ctx context.Context,
	input appRuntime.ServerRequestInput,
) (appRuntime.ServerRequestInterception, error) {
	if strings.TrimSpace(input.Method) != "item/tool/call" {
		return appRuntime.ServerRequestInterception{}, nil
	}

	preToolInput, ok := preToolUseInputFromDynamicToolCall(input)
	if !ok {
		return appRuntime.ServerRequestInterception{}, nil
	}

	result, err := s.EvaluatePreToolUse(ctx, preToolInput)
	if err != nil {
		return appRuntime.ServerRequestInterception{}, err
	}
	if !result.Blocked {
		return appRuntime.ServerRequestInterception{}, nil
	}

	return appRuntime.ServerRequestInterception{
		Handled: true,
		Response: map[string]any{
			"contentItems": []map[string]any{},
			"success":      false,
		},
	}, nil
}

func (s *Service) completeBlockedPreToolUseRun(
	input PreToolUseInput,
	handlerKey string,
	reason string,
	message string,
	policy string,
	entries []store.HookOutputEntry,
	fingerprintPayload string,
) (PreToolUseResult, error) {
	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "tool/use")
	run := store.HookRun{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		TurnID:        input.TurnID,
		EventName:     eventNamePreToolUse,
		HandlerKey:    handlerKey,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         firstNonEmpty(input.Scope, "tool"),
		TriggerMethod: triggerMethod,
		ToolKind:      input.ToolKind,
		ToolName:      input.ToolName,
		Status:        hookStatusRunning,
		Decision:      decisionBlock,
		Reason:        reason,
		Fingerprint: fingerprintFor(
			input.ThreadID,
			input.TurnID,
			"",
			handlerKey,
			fingerprintPayload,
		),
		Entries:   entries,
		Source:    s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt: startedAt,
	}

	baseEvent := store.EventEnvelope{
		WorkspaceID: input.WorkspaceID,
		ThreadID:    input.ThreadID,
		TurnID:      input.TurnID,
		Method:      triggerMethod,
		TS:          startedAt,
	}
	persistedRun, err := s.store.UpsertHookRun(run)
	if err != nil {
		return PreToolUseResult{}, err
	}

	s.publishHookEvent(baseEvent, "hook/started", persistedRun)

	completedAt := s.now()
	durationMs := completedAt.Sub(startedAt).Milliseconds()
	persistedRun.Status = hookStatusCompleted
	persistedRun.CompletedAt = &completedAt
	persistedRun.DurationMs = &durationMs
	if _, err := s.store.UpsertHookRun(persistedRun); err == nil {
		s.publishHookEvent(baseEvent, "hook/completed", persistedRun)
	}

	return PreToolUseResult{
		Allowed: false,
		Blocked: true,
		Reason:  message,
		Run:     &persistedRun,
	}, nil
}

func (s *Service) handleEvent(ctx context.Context, event store.EventEnvelope) {
	if strings.TrimSpace(event.WorkspaceID) == "" {
		return
	}

	switch event.Method {
	case "workspace/httpMutation":
		run, ok := s.observeWorkspaceHTTPMutation(event)
		if !ok {
			return
		}
		s.executeObservation(event, run)
		return
	}

	if strings.TrimSpace(event.ThreadID) == "" {
		return
	}

	switch event.Method {
	case "mcpServer/elicitation/request":
		run, ok := s.observeMcpElicitationRequest(event)
		if !ok {
			return
		}
		s.executeObservation(event, run)
	case "item/commandExecution/requestApproval",
		"item/fileChange/requestApproval",
		"item/permissions/requestApproval",
		"item/tool/call":
		run, ok := s.observeApprovalServerRequest(event)
		if !ok {
			return
		}
		s.executeObservation(event, run)
	case "item/completed":
		run, ok := s.observeMcpToolCallPostToolUse(event)
		if ok {
			s.executeObservation(event, run)
		}
		evaluation, ok := s.evaluateFailedValidationPostToolUse(event)
		if !ok {
			return
		}
		s.executeEvaluation(ctx, event, evaluation)
	case "turn/completed":
		evaluation, ok := s.evaluateMissingVerificationStop(event)
		if !ok {
			return
		}
		s.executeEvaluation(ctx, event, evaluation)
	}
}

type workspaceHTTPMutationObservation struct {
	triggerMethod     string
	scope             string
	toolKind          string
	toolName          string
	reason            string
	additionalContext string
	fingerprintSuffix string
	entries           []store.HookOutputEntry
}

func (s *Service) observeWorkspaceHTTPMutation(event store.EventEnvelope) (store.HookRun, bool) {
	payload := asObject(event.Payload)
	requestID := strings.TrimSpace(stringValue(payload["requestId"]))
	if requestID == "" {
		requestID = event.TS.UTC().Format(time.RFC3339Nano)
	}

	observation, ok := workspaceHTTPMutationObservationForPayload(payload)
	if !ok {
		return store.HookRun{}, false
	}

	startedAt := s.now()
	run := store.HookRun{
		WorkspaceID:   event.WorkspaceID,
		ThreadID:      strings.TrimSpace(event.ThreadID),
		TurnID:        strings.TrimSpace(event.TurnID),
		ItemID:        requestID,
		EventName:     eventNameHTTPMutation,
		HandlerKey:    handlerKeyHTTPMutationAudit,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         firstNonEmpty(strings.TrimSpace(observation.scope), "workspace"),
		TriggerMethod: observation.triggerMethod,
		ToolKind:      observation.toolKind,
		ToolName:      observation.toolName,
		Status:        hookStatusRunning,
		Decision:      decisionContinue,
		Reason:        observation.reason,
		Fingerprint: fingerprintFor(
			strings.TrimSpace(event.ThreadID),
			strings.TrimSpace(event.TurnID),
			requestID,
			handlerKeyHTTPMutationAudit,
			observation.fingerprintSuffix,
		),
		AdditionalContext: observation.additionalContext,
		Entries:           observation.entries,
		StartedAt:         startedAt,
	}

	return run, true
}

func workspaceHTTPMutationObservationForPayload(
	payload map[string]any,
) (workspaceHTTPMutationObservation, bool) {
	triggerMethod := strings.TrimSpace(stringValue(payload["triggerMethod"]))
	scope := firstNonEmpty(strings.TrimSpace(stringValue(payload["scope"])), "workspace")
	toolKind := strings.TrimSpace(stringValue(payload["toolKind"]))
	toolName := strings.TrimSpace(stringValue(payload["toolName"]))
	if triggerMethod == "" || toolKind == "" || toolName == "" {
		return workspaceHTTPMutationObservation{}, false
	}

	requestKind := firstNonEmpty(strings.TrimSpace(stringValue(payload["requestKind"])), "httpMutation")
	reason := firstNonEmpty(strings.TrimSpace(stringValue(payload["reason"])), "workspace_http_mutation_audited")
	additionalContext := strings.TrimSpace(stringValue(payload["context"]))
	fingerprintSuffix := strings.TrimSpace(stringValue(payload["fingerprint"]))
	if fingerprintSuffix == "" {
		fingerprintSuffix = toolName + "\x00" + additionalContext
	}

	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "requestKind=" + requestKind},
	}
	if additionalContext != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: additionalContext})
	}

	return workspaceHTTPMutationObservation{
		triggerMethod:     triggerMethod,
		scope:             scope,
		toolKind:          toolKind,
		toolName:          toolName,
		reason:            reason,
		additionalContext: additionalContext,
		fingerprintSuffix: fingerprintSuffix,
		entries:           entries,
	}, true
}

func (s *Service) observeMcpElicitationRequest(event store.EventEnvelope) (store.HookRun, bool) {
	payload := asObject(event.Payload)
	serverName := strings.TrimSpace(stringValue(payload["serverName"]))
	message := strings.TrimSpace(stringValue(payload["message"]))
	mode := strings.TrimSpace(stringValue(payload["mode"]))
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(payload["turnId"])), strings.TrimSpace(event.TurnID))

	if serverName == "" && message == "" {
		return store.HookRun{}, false
	}

	startedAt := s.now()
	run := store.HookRun{
		WorkspaceID:   event.WorkspaceID,
		ThreadID:      event.ThreadID,
		TurnID:        turnID,
		EventName:     eventNameServerRequest,
		HandlerKey:    handlerKeyMcpElicitationAudit,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         "thread",
		TriggerMethod: event.Method,
		ToolKind:      "mcpElicitationRequest",
		ToolName:      firstNonEmpty(serverName, "mcp"),
		Status:        hookStatusRunning,
		Decision:      decisionContinue,
		Reason:        "mcp_elicitation_request_audited",
		Fingerprint: fingerprintFor(
			event.ThreadID,
			turnID,
			"",
			handlerKeyMcpElicitationAudit,
			firstNonEmpty(serverName, "mcp")+"\x00"+mode+"\x00"+digestText(message),
		),
		AdditionalContext: message,
		Entries: []store.HookOutputEntry{
			{Kind: "feedback", Text: "server=" + firstNonEmpty(serverName, "mcp")},
			{Kind: "feedback", Text: "mode=" + firstNonEmpty(mode, "unknown")},
		},
		StartedAt: startedAt,
	}

	return run, true
}

type approvalServerRequestObservation struct {
	toolKind          string
	toolName          string
	reason            string
	additionalContext string
	fingerprintSuffix string
	entries           []store.HookOutputEntry
}

func (s *Service) observeApprovalServerRequest(event store.EventEnvelope) (store.HookRun, bool) {
	payload := asObject(event.Payload)
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(payload["turnId"])), strings.TrimSpace(event.TurnID))
	requestID := ""
	if event.ServerRequestID != nil {
		requestID = strings.TrimSpace(*event.ServerRequestID)
	}

	observation, ok := approvalServerRequestObservationForEvent(event.Method, payload)
	if !ok {
		return store.HookRun{}, false
	}

	startedAt := s.now()
	run := store.HookRun{
		WorkspaceID:       event.WorkspaceID,
		ThreadID:          event.ThreadID,
		TurnID:            turnID,
		ItemID:            requestID,
		EventName:         eventNameServerRequest,
		HandlerKey:        handlerKeyServerRequestApprovalAudit,
		HandlerType:       "builtin",
		Provider:          "server",
		ExecutionMode:     "sync",
		Scope:             "thread",
		TriggerMethod:     event.Method,
		ToolKind:          observation.toolKind,
		ToolName:          observation.toolName,
		Status:            hookStatusRunning,
		Decision:          decisionContinue,
		Reason:            observation.reason,
		Fingerprint:       fingerprintFor(event.ThreadID, turnID, requestID, handlerKeyServerRequestApprovalAudit, event.Method+"\x00"+observation.fingerprintSuffix),
		AdditionalContext: observation.additionalContext,
		Entries:           observation.entries,
		StartedAt:         startedAt,
	}

	return run, true
}

func approvalServerRequestObservationForEvent(
	method string,
	payload map[string]any,
) (approvalServerRequestObservation, bool) {
	switch strings.TrimSpace(method) {
	case "item/commandExecution/requestApproval":
		command := strings.TrimSpace(stringValue(payload["command"]))
		if command == "" {
			return approvalServerRequestObservation{}, false
		}
		return approvalServerRequestObservation{
			toolKind:          "commandExecutionApprovalRequest",
			toolName:          command,
			reason:            "command_execution_approval_request_audited",
			additionalContext: command,
			fingerprintSuffix: digestText(command),
			entries: []store.HookOutputEntry{
				{Kind: "feedback", Text: "requestKind=" + method},
				{Kind: "context", Text: "command=" + command},
			},
		}, true
	case "item/fileChange/requestApproval":
		path := strings.TrimSpace(stringValue(payload["path"]))
		changeCount := len(asSlice(payload["changes"]))
		toolName := path
		additionalContext := path
		fingerprintSuffix := digestText(path)
		entries := []store.HookOutputEntry{
			{Kind: "feedback", Text: "requestKind=" + method},
		}
		if path != "" {
			entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "path=" + path})
		}
		if changeCount > 0 {
			entries = append(entries, store.HookOutputEntry{Kind: "feedback", Text: fmt.Sprintf("changeCount=%d", changeCount)})
			if toolName == "" {
				toolName = fmt.Sprintf("%d file change(s)", changeCount)
			}
			if additionalContext == "" {
				additionalContext = toolName
			}
			if path == "" {
				fingerprintSuffix = fmt.Sprintf("changes:%d", changeCount)
			}
		}
		if toolName == "" {
			toolName = "file-change-approval"
		}
		if additionalContext == "" {
			additionalContext = toolName
		}
		return approvalServerRequestObservation{
			toolKind:          "fileChangeApprovalRequest",
			toolName:          toolName,
			reason:            "file_change_approval_request_audited",
			additionalContext: additionalContext,
			fingerprintSuffix: fingerprintSuffix,
			entries:           entries,
		}, true
	case "item/permissions/requestApproval":
		reason := strings.TrimSpace(stringValue(payload["reason"]))
		permissionsCount := permissionCount(payload["permissions"])
		fingerprintSuffix := fmt.Sprintf("permissions:%d", permissionsCount)
		if reason != "" {
			fingerprintSuffix = digestText(reason)
		}
		entries := []store.HookOutputEntry{
			{Kind: "feedback", Text: "requestKind=" + method},
		}
		if reason != "" {
			entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "reason=" + reason})
		}
		if permissionsCount > 0 {
			entries = append(entries, store.HookOutputEntry{Kind: "feedback", Text: fmt.Sprintf("permissionsCount=%d", permissionsCount)})
		}
		return approvalServerRequestObservation{
			toolKind:          "permissionsApprovalRequest",
			toolName:          "permissions",
			reason:            "permissions_approval_request_audited",
			additionalContext: firstNonEmpty(reason, "Additional permissions requested"),
			fingerprintSuffix: fingerprintSuffix,
			entries:           entries,
		}, true
	case "item/tool/call":
		toolName := strings.TrimSpace(stringValue(payload["tool"]))
		if toolName == "" {
			toolName = strings.TrimSpace(stringValue(asObject(payload["params"])["tool"]))
		}
		if toolName == "" {
			return approvalServerRequestObservation{}, false
		}
		return approvalServerRequestObservation{
			toolKind:          "dynamicToolCallRequest",
			toolName:          toolName,
			reason:            "dynamic_tool_call_request_audited",
			additionalContext: toolName,
			fingerprintSuffix: digestText(toolName),
			entries: []store.HookOutputEntry{
				{Kind: "feedback", Text: "requestKind=" + method},
				{Kind: "context", Text: "tool=" + toolName},
			},
		}, true
	default:
		return approvalServerRequestObservation{}, false
	}
}

func asSlice(value any) []any {
	switch typed := value.(type) {
	case []any:
		return typed
	default:
		return nil
	}
}

func permissionCount(value any) int {
	switch typed := value.(type) {
	case []any:
		return len(typed)
	case map[string]any:
		return len(typed)
	default:
		return 0
	}
}

func (s *Service) observeMcpToolCallPostToolUse(event store.EventEnvelope) (store.HookRun, bool) {
	if s.store == nil {
		return store.HookRun{}, false
	}

	payload := asObject(event.Payload)
	item := asObject(payload["item"])
	if stringValue(item["type"]) != "mcpToolCall" {
		return store.HookRun{}, false
	}

	workspace, ok := s.store.GetWorkspace(event.WorkspaceID)
	if !ok {
		return store.HookRun{}, false
	}

	serverName := strings.TrimSpace(stringValue(item["server"]))
	toolName := strings.TrimSpace(stringValue(item["tool"]))
	itemID := strings.TrimSpace(stringValue(item["id"]))
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(payload["turnId"])), strings.TrimSpace(event.TurnID))
	preToolInput, ok := preToolUseInputFromMcpToolCall(
		event.WorkspaceID,
		event.ThreadID,
		turnID,
		serverName,
		toolName,
		asObject(item["arguments"]),
	)
	if !ok {
		return store.HookRun{}, false
	}

	configuration := ResolveConfiguration(workspace, s.store.GetRuntimePreferences())
	displayToolName := mcpToolCallDisplayName(serverName, toolName)
	reason := "critical_mcp_tool_call_audited"
	policy := "critical-mcp-tool-call"
	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "server=" + firstNonEmpty(serverName, "unknown")},
		{Kind: "feedback", Text: "tool=" + firstNonEmpty(toolName, displayToolName)},
	}
	fingerprintParts := []string{policy, strings.ToLower(displayToolName)}

	if status := strings.TrimSpace(stringValue(item["status"])); status != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "feedback", Text: "status=" + status})
		fingerprintParts = append(fingerprintParts, status)
	}

	if match, ok := matchProtectedGovernancePathMutation(
		workspace.RootPath,
		preToolInput,
		configuration.EffectiveHookPreToolUseProtectedGovernancePaths,
	); ok {
		reason = "protected_governance_file_mutation_observed_after_mcp_tool_call"
		policy = match.policy
		entries = append(
			entries,
			store.HookOutputEntry{Kind: "context", Text: match.candidateKey + "=" + match.candidatePath},
			store.HookOutputEntry{Kind: "context", Text: "matched path: " + match.matchedPath},
		)
		fingerprintParts = append(fingerprintParts, match.matchedPath)
	} else if preToolInput.Command != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "command=" + preToolInput.Command})
		fingerprintParts = append(fingerprintParts, normalizeCommandWhitespace(preToolInput.Command))
		if match, ok := matchDangerousCommand(preToolInput.Command); ok {
			reason = "dangerous_command_observed_after_mcp_tool_call"
			policy = match.policy
			entries = append(entries, store.HookOutputEntry{Kind: "feedback", Text: "matched policy: " + match.policy})
		}
	} else if targetPath := firstNonEmpty(preToolInput.DestinationPath, preToolInput.TargetPath); targetPath != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "targetPath=" + targetPath})
		fingerprintParts = append(fingerprintParts, targetPath)
	}

	startedAt := s.now()
	run := store.HookRun{
		WorkspaceID:   event.WorkspaceID,
		ThreadID:      event.ThreadID,
		TurnID:        turnID,
		ItemID:        itemID,
		EventName:     eventNamePostToolUse,
		HandlerKey:    handlerKeyMcpToolCallAudit,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         "item",
		TriggerMethod: event.Method,
		ToolKind:      "mcpToolCall",
		ToolName:      displayToolName,
		Status:        hookStatusRunning,
		Decision:      decisionContinue,
		Reason:        reason,
		Fingerprint: fingerprintFor(
			event.ThreadID,
			turnID,
			itemID,
			handlerKeyMcpToolCallAudit,
			policy+"\x00"+strings.Join(fingerprintParts, "\x00"),
		),
		Entries:   entries,
		StartedAt: startedAt,
	}

	return run, true
}

func (s *Service) evaluateFailedValidationPostToolUse(event store.EventEnvelope) (hookEvaluation, bool) {
	config := turnpolicies.ResolveRuntimeConfig(s.store.GetRuntimePreferences())
	if !config.PostToolUseFailedValidationEnabled {
		return hookEvaluation{}, false
	}

	payload := asObject(event.Payload)
	item := asObject(payload["item"])
	if stringValue(item["type"]) != "commandExecution" {
		return hookEvaluation{}, false
	}

	command := strings.TrimSpace(stringValue(item["command"]))
	if !isValidationCommand(command, config.ValidationCommandPrefixes) || !isFailedCommandExecution(item) {
		return hookEvaluation{}, false
	}

	itemID := strings.TrimSpace(stringValue(item["id"]))
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(payload["turnId"])), strings.TrimSpace(event.TurnID))
	exitCode, hasExitCode := intValue(item["exitCode"])
	evidenceSummary := buildCommandEvidenceSummary(command, item, 1_000)
	evidenceFingerprint := command +
		"|" + stringValue(item["status"]) +
		"|" + normalizedExitCode(hasExitCode, exitCode) +
		"|" + outputTail(stringValue(item["aggregatedOutput"]), 240)

	startedAt := s.now()
	run := store.HookRun{
		WorkspaceID:   event.WorkspaceID,
		ThreadID:      event.ThreadID,
		TurnID:        turnID,
		ItemID:        itemID,
		EventName:     eventNamePostToolUse,
		HandlerKey:    handlerKeyFailedValidation,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         "item",
		TriggerMethod: event.Method,
		ToolKind:      "commandExecution",
		ToolName:      "commandExecution",
		Status:        hookStatusRunning,
		Decision:      decisionContinueTurn,
		Reason:        "validation_command_failed",
		Fingerprint: fingerprintFor(
			event.ThreadID,
			turnID,
			itemID,
			handlerKeyFailedValidation,
			evidenceFingerprint,
		),
		Entries: []store.HookOutputEntry{
			{Kind: "feedback", Text: evidenceSummary},
		},
		StartedAt: startedAt,
	}

	return hookEvaluation{
		run:                           run,
		policyName:                    policyNameFailedValidation,
		verdict:                       config.PostToolUsePrimaryAction,
		action:                        config.PostToolUsePrimaryAction,
		reason:                        "validation_command_failed",
		evidenceSummary:               evidenceSummary,
		fingerprint:                   fingerprintFor(event.ThreadID, turnID, itemID, policyNameFailedValidation, evidenceFingerprint),
		prompt:                        failedValidationPrompt(command, hasExitCode, exitCode, outputTail(stringValue(item["aggregatedOutput"]), 600)),
		followUpCooldown:              config.PostToolUseFollowUpCooldown,
		interruptNoActiveTurnBehavior: config.PostToolUseInterruptNoActiveTurnBehavior,
	}, true
}

func (s *Service) evaluateMissingVerificationStop(event store.EventEnvelope) (hookEvaluation, bool) {
	config := turnpolicies.ResolveRuntimeConfig(s.store.GetRuntimePreferences())
	if !config.StopMissingVerificationEnabled {
		return hookEvaluation{}, false
	}

	payload := asObject(event.Payload)
	turn := asObject(payload["turn"])
	turnID := firstNonEmpty(strings.TrimSpace(stringValue(turn["id"])), strings.TrimSpace(event.TurnID))
	items := itemList(turn["items"])
	if len(items) == 0 {
		return hookEvaluation{}, false
	}

	lastFileChangeIndex := -1
	changePaths := make([]string, 0)
	for index, item := range items {
		if stringValue(item["type"]) != "fileChange" || stringValue(item["status"]) != "completed" {
			continue
		}
		lastFileChangeIndex = index
		changePaths = append(changePaths, fileChangePaths(item)...)
	}
	if lastFileChangeIndex < 0 {
		return hookEvaluation{}, false
	}

	for _, item := range items[lastFileChangeIndex+1:] {
		if stringValue(item["type"]) != "commandExecution" {
			continue
		}
		command := strings.TrimSpace(stringValue(item["command"]))
		if isValidationCommand(command, config.ValidationCommandPrefixes) && isSuccessfulValidationCommand(item) {
			return hookEvaluation{}, false
		}
	}

	evidencePaths := summarizePaths(changePaths, 5)
	evidenceSummary := "file changes completed without a later successful validation command"
	if len(evidencePaths) > 0 {
		evidenceSummary += ": " + strings.Join(evidencePaths, ", ")
	}

	startedAt := s.now()
	run := store.HookRun{
		WorkspaceID:   event.WorkspaceID,
		ThreadID:      event.ThreadID,
		TurnID:        turnID,
		EventName:     eventNameStop,
		HandlerKey:    handlerKeyMissingVerification,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         "turn",
		TriggerMethod: event.Method,
		Status:        hookStatusRunning,
		Decision:      decisionContinueTurn,
		Reason:        "file_changes_missing_successful_verification",
		Fingerprint: fingerprintFor(
			event.ThreadID,
			turnID,
			"",
			handlerKeyMissingVerification,
			strings.Join(evidencePaths, "|"),
		),
		Entries: []store.HookOutputEntry{
			{Kind: "context", Text: evidenceSummary},
		},
		StartedAt: startedAt,
	}

	return hookEvaluation{
		run:                           run,
		policyName:                    policyNameMissingVerification,
		verdict:                       config.StopMissingVerificationPrimaryAction,
		action:                        config.StopMissingVerificationPrimaryAction,
		reason:                        "file_changes_missing_successful_verification",
		evidenceSummary:               evidenceSummary,
		fingerprint:                   fingerprintFor(event.ThreadID, turnID, "", policyNameMissingVerification, strings.Join(evidencePaths, "|")),
		prompt:                        missingVerificationPrompt(evidencePaths),
		followUpCooldown:              config.StopMissingVerificationFollowUpCooldown,
		interruptNoActiveTurnBehavior: config.StopMissingVerificationInterruptNoActiveTurnBehavior,
	}, true
}

func (s *Service) executeEvaluation(ctx context.Context, event store.EventEnvelope, evaluation hookEvaluation) {
	inFlightKey := event.WorkspaceID + "\x00" + event.ThreadID + "\x00" + evaluation.fingerprint
	if !s.beginEvaluation(inFlightKey) {
		return
	}
	defer s.endEvaluation(inFlightKey)

	evaluation.run.Source = s.threadSource(event.WorkspaceID, event.ThreadID)
	run, err := s.store.UpsertHookRun(evaluation.run)
	if err != nil {
		return
	}

	s.publishHookEvent(event, "hook/started", run)

	completedRun := run
	completedDecision, actionErr := s.executeGovernanceAction(ctx, event, evaluation, run.ID)
	completedAt := s.now()
	durationMs := completedAt.Sub(run.StartedAt).Milliseconds()
	completedRun.CompletedAt = &completedAt
	completedRun.DurationMs = &durationMs
	completedRun.Status = hookStatusCompleted
	if actionErr != "" {
		completedRun.Status = hookStatusFailed
		completedRun.Error = actionErr
	}
	if completedDecision.Reason != "" {
		completedRun.Entries = append(
			completedRun.Entries,
			store.HookOutputEntry{Kind: "feedback", Text: "action reason: " + completedDecision.Reason},
		)
	}
	if completedDecision.Action != "" && completedDecision.Action != actionNone {
		completedRun.Entries = append(
			completedRun.Entries,
			store.HookOutputEntry{
				Kind: "feedback",
				Text: fmt.Sprintf("action=%s status=%s", completedDecision.Action, completedDecision.ActionStatus),
			},
		)
	}
	if _, err := s.store.UpsertHookRun(completedRun); err == nil {
		s.publishHookEvent(event, "hook/completed", completedRun)
	}
}

func (s *Service) executeObservation(event store.EventEnvelope, run store.HookRun) {
	inFlightKey := event.WorkspaceID + "\x00" + event.ThreadID + "\x00" + run.Fingerprint
	if !s.beginEvaluation(inFlightKey) {
		return
	}
	defer s.endEvaluation(inFlightKey)

	if s.hasRecordedHookRun(event.WorkspaceID, event.ThreadID, run.HandlerKey, run.Fingerprint) {
		return
	}

	run.Source = s.threadSource(event.WorkspaceID, event.ThreadID)
	persistedRun, err := s.store.UpsertHookRun(run)
	if err != nil {
		return
	}

	s.publishHookEvent(event, "hook/started", persistedRun)

	completedRun := persistedRun
	completedAt := s.now()
	durationMs := completedAt.Sub(persistedRun.StartedAt).Milliseconds()
	completedRun.CompletedAt = &completedAt
	completedRun.DurationMs = &durationMs
	completedRun.Status = hookStatusCompleted
	if _, err := s.store.UpsertHookRun(completedRun); err == nil {
		s.publishHookEvent(event, "hook/completed", completedRun)
	}
}

func (s *Service) executeGovernanceAction(
	ctx context.Context,
	event store.EventEnvelope,
	evaluation hookEvaluation,
	hookRunID string,
) (store.TurnPolicyDecision, string) {
	startedAt := s.now()
	source := s.threadSource(event.WorkspaceID, event.ThreadID)
	if existing, ok := s.store.GetTurnPolicyDecisionByFingerprint(event.WorkspaceID, event.ThreadID, evaluation.fingerprint); ok &&
		existing.ActionStatus != actionStatusFailed {
		decision, _ := s.store.CreateTurnPolicyDecision(store.TurnPolicyDecision{
			WorkspaceID:         event.WorkspaceID,
			ThreadID:            event.ThreadID,
			TurnID:              evaluation.run.TurnID,
			ItemID:              evaluation.run.ItemID,
			TriggerMethod:       evaluation.run.TriggerMethod,
			PolicyName:          evaluation.policyName,
			Fingerprint:         evaluation.fingerprint,
			Verdict:             evaluation.verdict,
			Action:              actionNone,
			ActionStatus:        actionStatusSkipped,
			Reason:              "duplicate_fingerprint",
			EvidenceSummary:     evaluation.evidenceSummary,
			GovernanceLayer:     governanceLayerHook,
			HookRunID:           hookRunID,
			Source:              source,
			EvaluationStartedAt: startedAt,
			DecisionAt:          s.now(),
			CompletedAt:         s.now(),
		})
		return decision, ""
	}

	if evaluation.action == actionFollowUp && s.recentSuccessfulFollowUp(
		event.WorkspaceID,
		event.ThreadID,
		evaluation.policyName,
		s.now(),
		evaluation.followUpCooldown,
	) {
		decision, _ := s.store.CreateTurnPolicyDecision(store.TurnPolicyDecision{
			WorkspaceID:         event.WorkspaceID,
			ThreadID:            event.ThreadID,
			TurnID:              evaluation.run.TurnID,
			ItemID:              evaluation.run.ItemID,
			TriggerMethod:       evaluation.run.TriggerMethod,
			PolicyName:          evaluation.policyName,
			Fingerprint:         evaluation.fingerprint,
			Verdict:             evaluation.verdict,
			Action:              actionNone,
			ActionStatus:        actionStatusSkipped,
			Reason:              "follow_up_cooldown_active",
			EvidenceSummary:     evaluation.evidenceSummary,
			GovernanceLayer:     governanceLayerHook,
			HookRunID:           hookRunID,
			Source:              source,
			EvaluationStartedAt: startedAt,
			DecisionAt:          s.now(),
			CompletedAt:         s.now(),
		})
		return decision, ""
	}

	decisionAt := s.now()
	action := evaluation.action
	actionStatus := actionStatusSucceeded
	actionTurnID := ""
	actionErr := ""
	reason := evaluation.reason
	followUpMetadata := turns.HookFollowUpStartMetadata(
		event.WorkspaceID,
		event.ThreadID,
		evaluation.run.TriggerMethod,
		evaluation.policyName,
		hookRunID,
	)

	callCtx, cancel := context.WithTimeout(ctx, s.actionTimeout)
	defer cancel()

	switch action {
	case actionSteer:
		result, err := s.turns.Steer(callCtx, event.WorkspaceID, event.ThreadID, evaluation.prompt)
		if err != nil {
			if errors.Is(err, appRuntime.ErrNoActiveTurn) {
				action = actionFollowUp
				result, err = s.startGovernedHookFollowUpTurn(
					callCtx,
					event.WorkspaceID,
					event.ThreadID,
					evaluation.prompt,
					followUpMetadata,
				)
			}
			if err != nil {
				actionStatus = actionStatusFailed
				actionErr = err.Error()
				break
			}
		}
		actionTurnID = strings.TrimSpace(result.TurnID)
	case actionFollowUp:
		result, err := s.startGovernedHookFollowUpTurn(
			callCtx,
			event.WorkspaceID,
			event.ThreadID,
			evaluation.prompt,
			followUpMetadata,
		)
		if err != nil {
			actionStatus = actionStatusFailed
			actionErr = err.Error()
			break
		}
		actionTurnID = strings.TrimSpace(result.TurnID)
	case actionInterrupt:
		result, err := s.turns.Interrupt(callCtx, event.WorkspaceID, event.ThreadID)
		if err != nil {
			actionStatus = actionStatusFailed
			actionErr = err.Error()
			break
		}
		actionTurnID = strings.TrimSpace(result.TurnID)
		if actionTurnID == "" {
			reason = reasonInterruptNoActiveTurn
			if evaluation.interruptNoActiveTurnBehavior == actionFollowUp {
				if s.recentSuccessfulFollowUp(
					event.WorkspaceID,
					event.ThreadID,
					evaluation.policyName,
					s.now(),
					evaluation.followUpCooldown,
				) {
					action = actionNone
					actionStatus = actionStatusSkipped
					reason = "follow_up_cooldown_active"
					break
				}

				action = actionFollowUp
				result, err = s.startGovernedHookFollowUpTurn(
					callCtx,
					event.WorkspaceID,
					event.ThreadID,
					evaluation.prompt,
					followUpMetadata,
				)
				if err != nil {
					actionStatus = actionStatusFailed
					actionErr = err.Error()
					break
				}
				actionTurnID = strings.TrimSpace(result.TurnID)
				break
			}
			actionStatus = actionStatusSkipped
		}
	default:
		action = actionNone
		actionStatus = actionStatusSkipped
	}

	completedAt := s.now()
	decision, _ := s.store.CreateTurnPolicyDecision(store.TurnPolicyDecision{
		WorkspaceID:         event.WorkspaceID,
		ThreadID:            event.ThreadID,
		TurnID:              evaluation.run.TurnID,
		ItemID:              evaluation.run.ItemID,
		TriggerMethod:       evaluation.run.TriggerMethod,
		PolicyName:          evaluation.policyName,
		Fingerprint:         evaluation.fingerprint,
		Verdict:             evaluation.verdict,
		Action:              action,
		ActionStatus:        actionStatus,
		ActionTurnID:        actionTurnID,
		Reason:              reason,
		EvidenceSummary:     evaluation.evidenceSummary,
		GovernanceLayer:     governanceLayerHook,
		HookRunID:           hookRunID,
		Source:              source,
		Error:               actionErr,
		EvaluationStartedAt: startedAt,
		DecisionAt:          decisionAt,
		CompletedAt:         completedAt,
	})

	diagnostics.LogThreadTrace(
		event.WorkspaceID,
		event.ThreadID,
		"hook governance evaluated",
		"eventName", evaluation.run.EventName,
		"handlerKey", evaluation.run.HandlerKey,
		"policyName", evaluation.policyName,
		"decision", evaluation.run.Decision,
		"action", action,
		"actionStatus", actionStatus,
		"actionTurnId", actionTurnID,
		"reason", reason,
		"error", actionErr,
	)

	return decision, actionErr
}

func (s *Service) beginEvaluation(key string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.inFlightBy[key]; ok {
		return false
	}
	s.inFlightBy[key] = struct{}{}
	return true
}

func (s *Service) endEvaluation(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	delete(s.inFlightBy, key)
}

func (s *Service) recentSuccessfulFollowUp(
	workspaceID string,
	threadID string,
	policyName string,
	now time.Time,
	cooldown time.Duration,
) bool {
	if cooldown <= 0 {
		return false
	}

	cutoff := now.Add(-cooldown)
	for _, decision := range s.store.ListTurnPolicyDecisions(workspaceID, threadID) {
		if decision.PolicyName != policyName ||
			decision.Action != actionFollowUp ||
			decision.ActionStatus != actionStatusSucceeded {
			continue
		}
		if !decision.CompletedAt.Before(cutoff) {
			return true
		}
	}

	return false
}

func (s *Service) threadSource(workspaceID string, threadID string) string {
	projection, ok := s.store.GetThreadProjectionSummary(workspaceID, threadID)
	if !ok {
		return ""
	}
	return strings.TrimSpace(projection.Source)
}

func (s *Service) hasRecordedHookRun(workspaceID string, threadID string, handlerKey string, fingerprint string) bool {
	if s.store == nil || strings.TrimSpace(fingerprint) == "" {
		return false
	}

	for _, run := range s.store.ListHookRuns(workspaceID, threadID) {
		if run.HandlerKey == handlerKey && run.Fingerprint == fingerprint {
			return true
		}
	}
	return false
}

func (s *Service) publishHookEvent(event store.EventEnvelope, method string, run store.HookRun) {
	if s.events == nil {
		return
	}

	s.events.Publish(store.EventEnvelope{
		WorkspaceID: event.WorkspaceID,
		ThreadID:    event.ThreadID,
		TurnID:      firstNonEmpty(run.TurnID, event.TurnID),
		Method:      method,
		Payload: map[string]any{
			"run": hookRunPayload(run),
		},
		TS: s.now(),
	})
}

func hookRunPayload(run store.HookRun) map[string]any {
	payload := map[string]any{
		"id":                 run.ID,
		"workspaceId":        run.WorkspaceID,
		"threadId":           run.ThreadID,
		"turnId":             run.TurnID,
		"itemId":             run.ItemID,
		"eventName":          run.EventName,
		"handlerKey":         run.HandlerKey,
		"handlerType":        run.HandlerType,
		"provider":           run.Provider,
		"executionMode":      run.ExecutionMode,
		"scope":              run.Scope,
		"triggerMethod":      run.TriggerMethod,
		"sessionStartSource": run.SessionStartSource,
		"toolKind":           run.ToolKind,
		"toolName":           run.ToolName,
		"status":             run.Status,
		"decision":           run.Decision,
		"reason":             run.Reason,
		"fingerprint":        run.Fingerprint,
		"source":             run.Source,
		"startedAt":          run.StartedAt.Format(time.RFC3339),
	}
	if run.AdditionalContext != "" {
		payload["additionalContext"] = run.AdditionalContext
	}
	if run.UpdatedInput != nil {
		payload["updatedInput"] = cloneAnyValue(run.UpdatedInput)
	}
	if len(run.Entries) > 0 {
		entries := make([]map[string]any, 0, len(run.Entries))
		for _, entry := range run.Entries {
			entries = append(entries, map[string]any{
				"kind": entry.Kind,
				"text": entry.Text,
			})
		}
		payload["entries"] = entries
	}
	if run.Error != "" {
		payload["error"] = run.Error
	}
	if run.CompletedAt != nil && !run.CompletedAt.IsZero() {
		payload["completedAt"] = run.CompletedAt.Format(time.RFC3339)
	}
	if run.DurationMs != nil {
		payload["durationMs"] = *run.DurationMs
	}
	return payload
}

func failedValidationPrompt(command string, hasExitCode bool, exitCode int, output string) string {
	var builder strings.Builder
	builder.WriteString("刚刚的验证命令失败了，请不要结束这条线程。\n")
	builder.WriteString("失败命令：")
	builder.WriteString(command)
	builder.WriteString("\n")
	if hasExitCode {
		builder.WriteString("退出码：")
		builder.WriteString(fmt.Sprintf("%d", exitCode))
		builder.WriteString("\n")
	}
	if trimmed := strings.TrimSpace(output); trimmed != "" {
		builder.WriteString("输出片段：\n")
		builder.WriteString(trimmed)
		builder.WriteString("\n")
	}
	builder.WriteString("请先分析失败原因，修复相关问题，并重新运行必要的验证或测试命令。只有在验证通过后再给出最终结论。")
	return builder.String()
}

func missingVerificationPrompt(paths []string) string {
	var builder strings.Builder
	builder.WriteString("上一轮已经修改了文件，但还没有看到成功的验证结果，请继续这条线程。\n")
	if len(paths) > 0 {
		builder.WriteString("涉及文件：")
		builder.WriteString(strings.Join(paths, ", "))
		builder.WriteString("\n")
	}
	builder.WriteString("请检查刚才的改动，运行与这些改动相关的验证或测试命令；如果验证失败，先修复再重试。只有在验证完成后再给出最终结论。")
	return builder.String()
}

func buildCommandEvidenceSummary(command string, item map[string]any, maxOutput int) string {
	var builder strings.Builder
	builder.WriteString("command=")
	builder.WriteString(command)
	if status := strings.TrimSpace(stringValue(item["status"])); status != "" {
		builder.WriteString("; status=")
		builder.WriteString(status)
	}
	if exitCode, ok := intValue(item["exitCode"]); ok {
		builder.WriteString("; exitCode=")
		builder.WriteString(fmt.Sprintf("%d", exitCode))
	}
	if output := strings.TrimSpace(outputTail(stringValue(item["aggregatedOutput"]), maxOutput)); output != "" {
		builder.WriteString("; output=")
		builder.WriteString(output)
	}
	return builder.String()
}

func fileChangePaths(item map[string]any) []string {
	changes, ok := item["changes"].([]any)
	if !ok || len(changes) == 0 {
		return nil
	}

	paths := make([]string, 0, len(changes))
	for _, change := range changes {
		path := strings.TrimSpace(stringValue(asObject(change)["path"]))
		if path == "" {
			continue
		}
		paths = append(paths, path)
	}
	return paths
}

func summarizePaths(paths []string, limit int) []string {
	if len(paths) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(paths))
	items := make([]string, 0, len(paths))
	for _, path := range paths {
		trimmed := strings.TrimSpace(path)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		items = append(items, trimmed)
		if limit > 0 && len(items) >= limit {
			break
		}
	}
	return items
}

func isFailedCommandExecution(item map[string]any) bool {
	status := strings.TrimSpace(stringValue(item["status"]))
	if status == "failed" {
		return true
	}
	if exitCode, ok := intValue(item["exitCode"]); ok && exitCode != 0 {
		return true
	}
	return false
}

func isSuccessfulValidationCommand(item map[string]any) bool {
	if strings.TrimSpace(stringValue(item["status"])) != "completed" {
		return false
	}
	if exitCode, ok := intValue(item["exitCode"]); ok && exitCode != 0 {
		return false
	}
	return true
}

func isValidationCommand(command string, validationCommandPrefixes []string) bool {
	normalized := strings.ToLower(strings.TrimSpace(command))
	if normalized == "" {
		return false
	}

	prefixes := turnpolicies.NormalizeValidationCommandPrefixes(validationCommandPrefixes)
	if len(prefixes) == 0 {
		prefixes = turnpolicies.DefaultValidationCommandPrefixes()
	}
	for _, prefix := range prefixes {
		if strings.HasPrefix(normalized, prefix) {
			return true
		}
	}

	return false
}

func fingerprintFor(threadID string, turnID string, itemID string, scope string, evidence string) string {
	sum := sha1.Sum([]byte(threadID + "\x00" + turnID + "\x00" + itemID + "\x00" + scope + "\x00" + evidence))
	return hex.EncodeToString(sum[:])
}

func outputTail(value string, maxChars int) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || maxChars <= 0 {
		return ""
	}
	runes := []rune(trimmed)
	if len(runes) <= maxChars {
		return trimmed
	}
	return string(runes[len(runes)-maxChars:])
}

func normalizedExitCode(hasExitCode bool, exitCode int) string {
	if !hasExitCode {
		return ""
	}
	return fmt.Sprintf("%d", exitCode)
}

func asObject(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return object
}

func itemList(value any) []map[string]any {
	rawItems, ok := value.([]any)
	if !ok {
		return nil
	}
	items := make([]map[string]any, 0, len(rawItems))
	for _, item := range rawItems {
		items = append(items, asObject(item))
	}
	return items
}

func stringValue(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return typed
}

func intValue(value any) (int, bool) {
	switch typed := value.(type) {
	case int:
		return typed, true
	case int32:
		return int(typed), true
	case int64:
		return int(typed), true
	case float64:
		if math.Trunc(typed) != typed {
			return 0, false
		}
		return int(typed), true
	default:
		return 0, false
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func (s *Service) threadHasConversationTurns(workspaceID string, threadID string) bool {
	projection, ok := s.store.GetThreadProjectionSummary(workspaceID, threadID)
	if !ok {
		return false
	}
	return projection.TurnCount > 0
}

func (s *Service) threadSessionStartSource(workspaceID string, threadID string) string {
	if s.store == nil {
		return ""
	}
	thread, ok := s.store.GetThread(workspaceID, threadID)
	if !ok {
		return ""
	}
	return strings.TrimSpace(thread.SessionStartSource)
}

func normalizeSessionStartLifecycleSource(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case sessionStartSourceStartup:
		return sessionStartSourceStartup
	case sessionStartSourceClear:
		return sessionStartSourceClear
	case sessionStartSourceResume:
		return sessionStartSourceResume
	default:
		return ""
	}
}

func shouldEvaluateSessionStartSource(
	resolvedSource string,
	requestedSource string,
	pendingSource string,
	hasConversationTurns bool,
) bool {
	switch resolvedSource {
	case sessionStartSourceResume:
		return requestedSource == sessionStartSourceResume || pendingSource == sessionStartSourceResume
	case sessionStartSourceStartup, sessionStartSourceClear:
		return !hasConversationTurns
	default:
		return false
	}
}

func (s *Service) loadSessionStartContext(
	workspace store.Workspace,
	threadID string,
	contextPaths []string,
	maxChars int,
) (string, string, bool) {
	baseDir := strings.TrimSpace(workspace.RootPath)
	if thread, ok := s.store.GetThread(workspace.ID, threadID); ok && strings.TrimSpace(thread.Cwd) != "" {
		baseDir = strings.TrimSpace(thread.Cwd)
	}
	if baseDir == "" {
		return "", "", false
	}
	if len(contextPaths) == 0 {
		return "", "", false
	}

	for _, relativePath := range contextPaths {
		for _, candidate := range resolveSessionStartContextCandidates(
			workspace.RootPath,
			baseDir,
			relativePath,
		) {
			content, err := os.ReadFile(candidate.absolutePath)
			if err != nil {
				if errors.Is(err, os.ErrNotExist) {
					continue
				}
				continue
			}

			normalized := normalizeSessionStartContext(string(content), maxChars)
			if normalized == "" {
				continue
			}
			return candidate.displayPath, normalized, true
		}
	}

	return "", "", false
}

type sessionStartContextCandidate struct {
	absolutePath string
	displayPath  string
}

func resolveSessionStartContextCandidates(
	workspaceRoot string,
	baseDir string,
	relativePath string,
) []sessionStartContextCandidate {
	trimmed := strings.TrimSpace(relativePath)
	if trimmed == "" {
		return nil
	}

	normalizedRelative := filepath.ToSlash(trimmed)
	candidates := []sessionStartContextCandidate{
		{
			absolutePath: filepath.Join(baseDir, filepath.FromSlash(normalizedRelative)),
			displayPath:  normalizedRelative,
		},
	}

	if !strings.HasPrefix(strings.ToLower(normalizedRelative), ".codex/") {
		if len(candidates) == 1 {
			candidates[0].displayPath = sessionStartDisplayPath(workspaceRoot, candidates[0].absolutePath)
		}
		return candidates
	}

	codexHome := discoverCodexHomePath()
	if codexHome == "" {
		if len(candidates) == 1 {
			candidates[0].displayPath = sessionStartDisplayPath(workspaceRoot, candidates[0].absolutePath)
		}
		return candidates
	}

	suffix := normalizedRelative[len(".codex/"):]
	candidates = append(
		candidates,
		sessionStartContextCandidate{
			absolutePath: filepath.Join(codexHome, filepath.FromSlash(suffix)),
			displayPath:  normalizedRelative,
		},
	)

	if len(candidates) >= 1 {
		candidates[0].displayPath = sessionStartDisplayPath(workspaceRoot, candidates[0].absolutePath)
	}
	return dedupeSessionStartContextCandidates(candidates)
}

func dedupeSessionStartContextCandidates(
	candidates []sessionStartContextCandidate,
) []sessionStartContextCandidate {
	if len(candidates) == 0 {
		return nil
	}

	seen := make(map[string]struct{}, len(candidates))
	result := make([]sessionStartContextCandidate, 0, len(candidates))
	for _, candidate := range candidates {
		absolutePath := strings.TrimSpace(candidate.absolutePath)
		if absolutePath == "" {
			continue
		}
		key := filepath.Clean(absolutePath)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		candidate.absolutePath = key
		if strings.TrimSpace(candidate.displayPath) == "" {
			candidate.displayPath = filepath.ToSlash(filepath.Base(key))
		}
		result = append(result, candidate)
	}
	return result
}

func discoverCodexHomePath() string {
	codexHome := strings.TrimSpace(os.Getenv("CODEX_HOME"))
	if codexHome != "" {
		return filepath.Clean(codexHome)
	}

	homeDir, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(homeDir) == "" {
		return ""
	}
	return filepath.Join(strings.TrimSpace(homeDir), ".codex")
}

func sessionStartDisplayPath(workspaceRoot string, absolutePath string) string {
	if relativePath, err := filepath.Rel(strings.TrimSpace(workspaceRoot), absolutePath); err == nil {
		return filepath.ToSlash(relativePath)
	}
	return filepath.ToSlash(filepath.Base(absolutePath))
}

func normalizeSessionStartContext(value string, maxChars int) string {
	lines := strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n")
	normalizedLines := make([]string, 0, len(lines))
	previousBlank := false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			if previousBlank || len(normalizedLines) == 0 {
				continue
			}
			normalizedLines = append(normalizedLines, "")
			previousBlank = true
			continue
		}

		normalizedLines = append(normalizedLines, trimmed)
		previousBlank = false
	}

	normalized := strings.TrimSpace(strings.Join(normalizedLines, "\n"))
	if normalized == "" {
		return ""
	}

	runes := []rune(normalized)
	if maxChars > 0 && len(runes) > maxChars {
		return strings.TrimSpace(string(runes[:maxChars])) + "\n[truncated]"
	}
	return normalized
}

func injectSessionStartContext(input string, sourcePath string, context string, template string) string {
	resolvedTemplate := strings.TrimSpace(template)
	if resolvedTemplate == "" {
		resolvedTemplate = DefaultSessionStartTemplate
	}

	sourcePathLine := ""
	if trimmedSourcePath := strings.TrimSpace(sourcePath); trimmedSourcePath != "" {
		sourcePathLine = "来源文件：" + trimmedSourcePath + "\n"
	}

	replacer := strings.NewReplacer(
		"{{source_path_line}}", sourcePathLine,
		"{{source_path}}", strings.TrimSpace(sourcePath),
		"{{context}}", strings.TrimSpace(context),
		"{{user_request}}", strings.TrimSpace(input),
	)
	return strings.TrimSpace(replacer.Replace(resolvedTemplate))
}

func cloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		cloned := make(map[string]any, len(typed))
		for key, entry := range typed {
			cloned[key] = cloneAnyValue(entry)
		}
		return cloned
	case []any:
		cloned := make([]any, len(typed))
		for index, entry := range typed {
			cloned[index] = cloneAnyValue(entry)
		}
		return cloned
	default:
		return typed
	}
}

type dangerousCommandMatch struct {
	policy  string
	message string
}

type secretPromptMatch struct {
	policy  string
	message string
}

func matchSecretPrompt(prompt string) (secretPromptMatch, bool) {
	if privateKeyBlockPattern.FindStringIndex(prompt) != nil {
		return secretPromptMatch{
			policy:  "private-key-block",
			message: "blocked prompt: detected a pasted private key or credential block; remove the secret and retry",
		}, true
	}

	if candidate := openAIAPIKeyPattern.FindString(prompt); candidate != "" && !looksLikePlaceholderSecretValue(candidate) {
		return secretPromptMatch{
			policy:  "openai-api-key",
			message: "blocked prompt: detected a pasted API key or access token; remove the secret and retry",
		}, true
	}

	if candidate := githubPATPattern.FindString(prompt); candidate != "" && !looksLikePlaceholderSecretValue(candidate) {
		return secretPromptMatch{
			policy:  "github-personal-access-token",
			message: "blocked prompt: detected a pasted API key or access token; remove the secret and retry",
		}, true
	}

	if candidate := slackTokenPattern.FindString(prompt); candidate != "" && !looksLikePlaceholderSecretValue(candidate) {
		return secretPromptMatch{
			policy:  "slack-token",
			message: "blocked prompt: detected a pasted API key or access token; remove the secret and retry",
		}, true
	}

	if matches := bearerHeaderPattern.FindStringSubmatch(prompt); len(matches) > 1 && looksLikeHighEntropyToken(matches[1]) {
		return secretPromptMatch{
			policy:  "authorization-bearer-header",
			message: "blocked prompt: detected a pasted bearer token; remove the secret and retry",
		}, true
	}

	for _, matches := range namedSecretPattern.FindAllStringSubmatch(prompt, -1) {
		if len(matches) < 2 {
			continue
		}
		if !looksLikeHighEntropyToken(matches[1]) {
			continue
		}
		return secretPromptMatch{
			policy:  "named-credential-assignment",
			message: "blocked prompt: detected a pasted credential value; remove the secret and retry",
		}, true
	}

	return secretPromptMatch{}, false
}

func matchDangerousCommand(command string) (dangerousCommandMatch, bool) {
	tokens := tokenizeCommand(command)
	if len(tokens) == 0 {
		return dangerousCommandMatch{}, false
	}

	for index := 0; index < len(tokens); index++ {
		token := tokens[index]
		switch token {
		case "sudo":
			continue
		case "rm":
			if target, ok := rmDangerousTarget(tokens[index+1:]); ok {
				return dangerousCommandMatch{
					policy:  "broad-recursive-delete",
					message: "blocked dangerous command: broad recursive delete target detected (" + target + ")",
				}, true
			}
		case "remove-item":
			if target, ok := powerShellDangerousTarget(tokens[index+1:]); ok {
				return dangerousCommandMatch{
					policy:  "powershell-broad-recursive-delete",
					message: "blocked dangerous command: PowerShell recursive delete target is too broad (" + target + ")",
				}, true
			}
		case "rd", "rmdir", "del":
			if target, ok := cmdDangerousTarget(token, tokens[index+1:]); ok {
				return dangerousCommandMatch{
					policy:  "cmd-broad-delete",
					message: "blocked dangerous command: command processor delete target is too broad (" + target + ")",
				}, true
			}
		case "format-volume", "diskpart", "fdisk", "sfdisk":
			return dangerousCommandMatch{
				policy:  "disk-formatting",
				message: "blocked dangerous command: disk formatting and partitioning commands are not allowed",
			}, true
		default:
			if token == "diskutil" && index+1 < len(tokens) && tokens[index+1] == "erasedisk" {
				return dangerousCommandMatch{
					policy:  "disk-formatting",
					message: "blocked dangerous command: disk formatting and partitioning commands are not allowed",
				}, true
			}
			if token == "mkfs" || strings.HasPrefix(token, "mkfs.") {
				return dangerousCommandMatch{
					policy:  "disk-formatting",
					message: "blocked dangerous command: disk formatting and partitioning commands are not allowed",
				}, true
			}
		}
	}

	return dangerousCommandMatch{}, false
}

func matchProtectedGovernancePathMutation(
	workspaceRoot string,
	input PreToolUseInput,
	protectedPaths []string,
) (protectedPathMutationMatch, bool) {
	for _, candidate := range mutationPathCandidates(input) {
		relativePath, ok := normalizeWorkspaceRelativePath(workspaceRoot, candidate.path)
		target, ok := classifyProtectedGovernanceRelativePath(relativePath, protectedPaths)
		if !ok {
			continue
		}
		return protectedPathMutationMatch{
			policy:        target.policy,
			message:       target.message,
			matchedPath:   relativePath,
			candidatePath: candidate.path,
			candidateKey:  candidate.key,
		}, true
	}

	return protectedPathMutationMatch{}, false
}

func mutationPathCandidates(input PreToolUseInput) []mutationPathCandidate {
	switch strings.TrimSpace(input.ToolName) {
	case "fs/copy":
		return nonEmptyPathCandidates(mutationPathCandidate{
			key:  "destinationPath",
			path: input.DestinationPath,
		})
	case "fs/move":
		return nonEmptyPathCandidates(
			mutationPathCandidate{
				key:  "sourcePath",
				path: input.TargetPath,
			},
			mutationPathCandidate{
				key:  "destinationPath",
				path: input.DestinationPath,
			},
		)
	case "fs/writeFile", "fs/remove", "config/value/write", "config/batchWrite":
		return nonEmptyPathCandidates(mutationPathCandidate{
			key:  "targetPath",
			path: input.TargetPath,
		})
	default:
		return nonEmptyPathCandidates(
			mutationPathCandidate{
				key:  "destinationPath",
				path: input.DestinationPath,
			},
			mutationPathCandidate{
				key:  "targetPath",
				path: input.TargetPath,
			},
		)
	}
}

func nonEmptyPathCandidates(values ...mutationPathCandidate) []mutationPathCandidate {
	if len(values) == 0 {
		return nil
	}

	items := make([]mutationPathCandidate, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value.path) == "" {
			continue
		}
		items = append(items, mutationPathCandidate{
			key:  strings.TrimSpace(value.key),
			path: strings.TrimSpace(value.path),
		})
	}
	if len(items) == 0 {
		return nil
	}
	return items
}

func preToolUseInputFromDynamicToolCall(input appRuntime.ServerRequestInput) (PreToolUseInput, bool) {
	params := asObject(input.Params)
	rawToolName := strings.TrimSpace(stringValue(params["tool"]))
	toolName := canonicalDynamicToolCallName(rawToolName)
	if toolName == "" {
		return PreToolUseInput{}, false
	}

	arguments := asObject(params["arguments"])
	preToolInput := PreToolUseInput{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		TurnID:        input.TurnID,
		ToolKind:      dynamicToolCallToolKind(toolName),
		ToolName:      toolName,
		TriggerMethod: firstNonEmpty(input.Method, "item/tool/call"),
		Scope:         dynamicToolCallScope(input.ThreadID),
	}

	switch toolName {
	case "thread/shellCommand", "command/exec":
		preToolInput.Command = dynamicToolCallArgumentCommand(arguments)
	case "fs/writeFile":
		preToolInput.TargetPath = stringValue(arguments["path"])
	case "fs/remove":
		preToolInput.TargetPath = stringValue(arguments["path"])
	case "fs/copy":
		preToolInput.TargetPath = stringValue(arguments["sourcePath"])
		preToolInput.DestinationPath = stringValue(arguments["destinationPath"])
	case "config/value/write":
		preToolInput.TargetPath = stringValue(arguments["filePath"])
	case "config/batchWrite":
		preToolInput.TargetPath = stringValue(arguments["filePath"])
	default:
		mcpInput, ok := preToolUseInputFromMcpDynamicToolCall(
			input.WorkspaceID,
			input.ThreadID,
			input.TurnID,
			rawToolName,
			arguments,
		)
		if !ok {
			return PreToolUseInput{}, false
		}
		mcpInput.TriggerMethod = firstNonEmpty(input.Method, "item/tool/call")
		mcpInput.Scope = dynamicToolCallScope(input.ThreadID)
		return mcpInput, true
	}

	if strings.TrimSpace(preToolInput.Command) == "" &&
		strings.TrimSpace(preToolInput.TargetPath) == "" &&
		strings.TrimSpace(preToolInput.DestinationPath) == "" {
		return PreToolUseInput{}, false
	}

	return preToolInput, true
}

func canonicalDynamicToolCallName(value string) string {
	switch strings.TrimSpace(value) {
	case "fs/write":
		return "fs/writeFile"
	case "config/write":
		return "config/value/write"
	case "config/batch-write":
		return "config/batchWrite"
	default:
		return strings.TrimSpace(value)
	}
}

func dynamicToolCallToolKind(toolName string) string {
	switch strings.TrimSpace(toolName) {
	case "thread/shellCommand":
		return "shellCommand"
	case "command/exec":
		return "commandExecution"
	case "fs/writeFile":
		return "fileWrite"
	case "fs/remove":
		return "pathRemove"
	case "fs/copy":
		return "pathCopy"
	case "fs/move":
		return "pathMove"
	case "config/value/write":
		return "configWrite"
	case "config/batchWrite":
		return "configBatchWrite"
	default:
		return "dynamicToolCall"
	}
}

func dynamicToolCallScope(threadID string) string {
	if strings.TrimSpace(threadID) != "" {
		return "thread"
	}
	return "workspace"
}

func dynamicToolCallArgumentCommand(arguments map[string]any) string {
	for _, key := range []string{"command", "cmd"} {
		value, ok := arguments[key]
		if !ok {
			continue
		}
		if command := commandArgumentString(value); command != "" {
			return command
		}
	}

	return ""
}

func preToolUseInputFromMcpDynamicToolCall(
	workspaceID string,
	threadID string,
	turnID string,
	toolName string,
	arguments map[string]any,
) (PreToolUseInput, bool) {
	serverName, normalizedToolName, ok := parseMcpDynamicToolCallName(toolName)
	if !ok {
		return PreToolUseInput{}, false
	}

	return preToolUseInputFromMcpToolCall(
		workspaceID,
		threadID,
		turnID,
		serverName,
		normalizedToolName,
		arguments,
	)
}

func preToolUseInputFromMcpToolCall(
	workspaceID string,
	threadID string,
	turnID string,
	serverName string,
	toolName string,
	arguments map[string]any,
) (PreToolUseInput, bool) {
	normalizedToolName := normalizeMcpToolCallToolName(toolName)
	preToolInput := PreToolUseInput{
		WorkspaceID: workspaceID,
		ThreadID:    threadID,
		TurnID:      turnID,
		ToolKind:    "mcpToolCall",
		ToolName:    mcpToolCallDisplayName(serverName, toolName),
	}

	switch normalizedToolName {
	case "write_file", "writefile", "edit_file", "append_file", "create_file", "create_directory", "mkdir", "mkdir_p", "make_dir":
		preToolInput.ToolName = "fs/writeFile"
		preToolInput.TargetPath = mcpToolCallArgumentPath(arguments, "path", "file_path", "filePath", "target_path", "targetPath", "directory_path", "directoryPath", "dir_path", "dirPath")
	case "remove_file", "delete_file", "remove_directory", "delete_directory", "remove_path", "delete_path":
		preToolInput.ToolName = "fs/remove"
		preToolInput.TargetPath = mcpToolCallArgumentPath(arguments, "path", "file_path", "filePath", "target_path", "targetPath", "directory_path", "directoryPath", "dir_path", "dirPath")
	case "copy_file", "copy_path":
		preToolInput.ToolName = "fs/copy"
		preToolInput.TargetPath = mcpToolCallArgumentPath(arguments, "source_path", "sourcePath", "from_path", "fromPath")
		preToolInput.DestinationPath = mcpToolCallArgumentPath(arguments, "destination_path", "destinationPath", "to_path", "toPath", "path")
	case "move_file", "rename_file", "move_path", "rename_path":
		preToolInput.ToolName = "fs/move"
		preToolInput.TargetPath = mcpToolCallArgumentPath(arguments, "source_path", "sourcePath", "from_path", "fromPath", "old_path", "oldPath")
		preToolInput.DestinationPath = mcpToolCallArgumentPath(arguments, "destination_path", "destinationPath", "to_path", "toPath", "new_path", "newPath", "path")
	case "exec_command", "execute_command", "run_command", "shell_command":
		preToolInput.ToolName = "command/exec"
		preToolInput.Command = mcpToolCallArgumentCommand(arguments)
	default:
		return PreToolUseInput{}, false
	}

	if strings.TrimSpace(preToolInput.Command) == "" &&
		strings.TrimSpace(preToolInput.TargetPath) == "" &&
		strings.TrimSpace(preToolInput.DestinationPath) == "" {
		return PreToolUseInput{}, false
	}

	return preToolInput, true
}

func normalizeMcpToolCallToolName(value string) string {
	normalized := strings.ToLower(strings.TrimSpace(value))
	normalized = strings.ReplaceAll(normalized, "-", "_")
	normalized = strings.ReplaceAll(normalized, " ", "_")
	return normalized
}

func parseMcpDynamicToolCallName(value string) (string, string, bool) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", "", false
	}

	if serverName, toolName, ok := splitMcpDynamicToolCallPath(raw); ok {
		return serverName, toolName, true
	}

	lower := strings.ToLower(raw)
	if strings.HasPrefix(lower, "mcp__") {
		parts := strings.Split(raw, "__")
		if len(parts) >= 3 {
			serverName := strings.TrimSpace(parts[1])
			toolName := strings.TrimSpace(strings.Join(parts[2:], "__"))
			if isRecognizedMcpToolCallName(toolName) {
				return serverName, toolName, true
			}
		}
	}

	return "", "", false
}

func splitMcpDynamicToolCallPath(value string) (string, string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", "", false
	}

	if strings.HasPrefix(strings.ToLower(trimmed), "mcp/") {
		trimmed = strings.TrimSpace(trimmed[4:])
	}

	slashIndex := strings.Index(trimmed, "/")
	if slashIndex <= 0 || slashIndex >= len(trimmed)-1 {
		return "", "", false
	}

	serverName := strings.TrimSpace(trimmed[:slashIndex])
	toolName := strings.TrimSpace(trimmed[slashIndex+1:])
	if serverName == "" || !isRecognizedMcpToolCallName(toolName) {
		return "", "", false
	}

	return serverName, toolName, true
}

func isRecognizedMcpToolCallName(value string) bool {
	switch normalizeMcpToolCallToolName(value) {
	case "write_file", "writefile", "edit_file", "append_file", "create_file", "create_directory", "mkdir", "mkdir_p", "make_dir",
		"remove_file", "delete_file", "remove_directory", "delete_directory", "remove_path", "delete_path",
		"copy_file", "copy_path",
		"move_file", "rename_file", "move_path", "rename_path",
		"exec_command", "execute_command", "run_command", "shell_command":
		return true
	default:
		return false
	}
}

func mcpToolCallDisplayName(serverName string, toolName string) string {
	serverName = strings.TrimSpace(serverName)
	toolName = strings.TrimSpace(toolName)
	if serverName == "" {
		return toolName
	}
	if toolName == "" {
		return serverName
	}
	return serverName + "/" + toolName
}

func mcpToolCallArgumentPath(arguments map[string]any, keys ...string) string {
	for _, key := range keys {
		if path := strings.TrimSpace(stringValue(arguments[key])); path != "" {
			return path
		}
	}
	return ""
}

func mcpToolCallArgumentCommand(arguments map[string]any) string {
	for _, key := range []string{"command", "cmd", "script"} {
		value, ok := arguments[key]
		if !ok {
			continue
		}
		if command := commandArgumentString(value); command != "" {
			return command
		}
	}

	return ""
}

func commandArgumentString(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case []string:
		return strings.TrimSpace(strings.Join(typed, " "))
	case []any:
		parts := make([]string, 0, len(typed))
		for _, entry := range typed {
			part := strings.TrimSpace(stringValue(entry))
			if part == "" {
				return ""
			}
			parts = append(parts, part)
		}
		return strings.TrimSpace(strings.Join(parts, " "))
	default:
		return ""
	}
}

func normalizeWorkspaceRelativePath(workspaceRoot string, candidate string) (string, bool) {
	root := strings.TrimSpace(workspaceRoot)
	path := strings.TrimSpace(candidate)
	if root == "" || path == "" {
		return "", false
	}

	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	path = filepath.Clean(path)
	relativePath, err := filepath.Rel(root, path)
	if err != nil {
		return "", false
	}
	if relativePath == ".." || strings.HasPrefix(relativePath, ".."+string(filepath.Separator)) {
		return "", false
	}

	normalized := filepath.ToSlash(relativePath)
	normalized = strings.TrimPrefix(normalized, "./")
	return normalized, normalized != ""
}

func classifyProtectedGovernanceRelativePath(
	value string,
	protectedPaths []string,
) (protectedGovernanceTarget, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return protectedGovernanceTarget{}, false
	}

	for _, candidate := range []string{
		".codex/hooks.json",
		"hooks.json",
	} {
		if strings.EqualFold(trimmed, candidate) {
			return protectedGovernanceTarget{
				policy:  "protected-hooks-config-file-mutation",
				message: "blocked protected governance file mutation: direct edits to hooks governance files are not allowed through generic fs/config tools; use the workspace hook-configuration API or editor instead",
			}, true
		}
	}

	for _, candidate := range []string{
		".codex/SESSION_START.md",
		".codex/session-start.md",
		"AGENTS.md",
		"CLAUDE.md",
	} {
		if strings.EqualFold(trimmed, candidate) {
			return protectedGovernanceTarget{
				policy:  "protected-session-governance-document-mutation",
				message: "blocked protected governance file mutation: direct edits to session governance documents are not allowed through generic fs/config tools; update the workspace document directly in your editor so the change remains explicit and reviewable",
			}, true
		}
	}

	for _, candidate := range protectedPaths {
		if strings.EqualFold(trimmed, strings.TrimSpace(candidate)) {
			return protectedGovernanceTarget{
				policy:  "protected-configured-governance-file-mutation",
				message: "blocked protected governance file mutation: direct edits to configured governance files are not allowed through generic fs/config tools; update the workspace governance configuration or edit the source document explicitly in your editor",
			}, true
		}
	}

	return protectedGovernanceTarget{}, false
}

func nonEmptyStrings(values ...string) []string {
	items := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		items = append(items, trimmed)
	}
	return items
}

func tokenizeCommand(command string) []string {
	fields := strings.Fields(strings.ToLower(strings.TrimSpace(command)))
	if len(fields) == 0 {
		return nil
	}

	tokens := make([]string, 0, len(fields))
	for _, field := range fields {
		trimmed := strings.TrimSpace(field)
		if trimmed == "" {
			continue
		}
		tokens = append(tokens, trimCommandToken(trimmed))
	}
	return tokens
}

func normalizeCommandWhitespace(command string) string {
	return strings.Join(strings.Fields(strings.ToLower(strings.TrimSpace(command))), " ")
}

func digestText(value string) string {
	sum := sha1.Sum([]byte(strings.TrimSpace(value)))
	return hex.EncodeToString(sum[:])
}

func looksLikeHighEntropyToken(value string) bool {
	candidate := trimSecretCandidate(value)
	if len(candidate) < 20 || looksLikePlaceholderSecretValue(candidate) {
		return false
	}
	if strings.ContainsAny(candidate, " \r\n\t") {
		return false
	}

	hasLower := false
	hasUpper := false
	hasDigit := false
	hasSymbol := false
	classCount := 0
	for _, r := range candidate {
		switch {
		case unicode.IsLower(r):
			if !hasLower {
				hasLower = true
				classCount++
			}
		case unicode.IsUpper(r):
			if !hasUpper {
				hasUpper = true
				classCount++
			}
		case unicode.IsDigit(r):
			if !hasDigit {
				hasDigit = true
				classCount++
			}
		case strings.ContainsRune("._~+/-=:", r):
			if !hasSymbol {
				hasSymbol = true
				classCount++
			}
		default:
			return false
		}
	}

	if classCount >= 3 {
		return true
	}
	return classCount >= 2 && (hasDigit || hasSymbol)
}

func looksLikePlaceholderSecretValue(value string) bool {
	candidate := strings.ToLower(trimSecretCandidate(value))
	if candidate == "" {
		return true
	}
	if strings.Contains(candidate, "<") || strings.Contains(candidate, ">") {
		return true
	}

	for _, marker := range []string{
		"your",
		"example",
		"sample",
		"placeholder",
		"replace",
		"changeme",
		"dummy",
		"fake",
		"redacted",
		"masked",
		"test-key",
		"test-token",
		"token-here",
		"key-here",
		"xxxx",
		"****",
	} {
		if strings.Contains(candidate, marker) {
			return true
		}
	}

	return false
}

func trimSecretCandidate(value string) string {
	return strings.Trim(strings.TrimSpace(value), "\"'`;,:()[]{}")
}

func rmDangerousTarget(tokens []string) (string, bool) {
	recursive := false
	force := false

	for _, token := range tokens {
		if token == "" {
			continue
		}
		if strings.HasPrefix(token, "-") {
			if strings.Contains(token, "r") {
				recursive = true
			}
			if strings.Contains(token, "f") {
				force = true
			}
			continue
		}

		if recursive && force && isDangerousDeleteTarget(token) {
			return token, true
		}
		return "", false
	}

	return "", false
}

func powerShellDangerousTarget(tokens []string) (string, bool) {
	recursive := false
	pathFlag := false
	var target string

	for _, token := range tokens {
		if token == "" {
			continue
		}
		switch token {
		case "-recurse":
			recursive = true
			continue
		case "-path", "-literalpath":
			pathFlag = true
			continue
		}

		if pathFlag {
			target = token
			pathFlag = false
			continue
		}

		if strings.HasPrefix(token, "-") {
			continue
		}
		if target == "" {
			target = token
		}
	}

	if recursive && isDangerousDeleteTarget(target) {
		return target, true
	}
	return "", false
}

func cmdDangerousTarget(command string, tokens []string) (string, bool) {
	hasRecursive := false
	target := ""
	for _, token := range tokens {
		if token == "" {
			continue
		}
		if strings.HasPrefix(token, "/") {
			if command == "del" && token == "/s" {
				hasRecursive = true
			}
			if (command == "rd" || command == "rmdir") && token == "/s" {
				hasRecursive = true
			}
			continue
		}
		target = token
	}

	if hasRecursive && isDangerousDeleteTarget(target) {
		return target, true
	}
	return "", false
}

func isDangerousDeleteTarget(token string) bool {
	target := trimCommandToken(token)
	switch target {
	case "", ".", "./", ".\\", "..", "../", "..\\", "/", "/*", "\\*", "*", "./*", ".\\*", "../*", "..\\*":
		return true
	}

	if isWindowsDriveRoot(target) || isWindowsDriveRootWildcard(target) {
		return true
	}
	return false
}

func trimCommandToken(token string) string {
	return strings.Trim(strings.TrimSpace(token), "\"'`;")
}

func isWindowsDriveRoot(value string) bool {
	if len(value) != 3 {
		return false
	}
	drive := value[0]
	return ((drive >= 'a' && drive <= 'z') || (drive >= 'A' && drive <= 'Z')) &&
		value[1] == ':' &&
		(value[2] == '\\' || value[2] == '/')
}

func isWindowsDriveRootWildcard(value string) bool {
	if len(value) != 4 {
		return false
	}
	drive := value[0]
	return ((drive >= 'a' && drive <= 'z') || (drive >= 'A' && drive <= 'Z')) &&
		value[1] == ':' &&
		(value[2] == '\\' || value[2] == '/') &&
		value[3] == '*'
}
