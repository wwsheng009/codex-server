package hooks

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

const hookFollowUpTriggerMethod = "hook/follow-up"

const (
	reasonTurnStartRequested = "turn_start_requested"
	reasonTurnStartAudited   = "turn_start_audited"
	reasonTurnStartFailed    = "turn_start_failed"
)

type GovernedTurnStartInput struct {
	WorkspaceID   string
	ThreadID      string
	Input         string
	TriggerMethod string
	Scope         string
	RequestID     string
	Options       turns.StartOptions
}

type GovernedTurnStartResult struct {
	Started          bool
	Blocked          bool
	Reason           string
	FinalInput       string
	Turn             turns.Result
	Run              *store.HookRun
	UserPromptSubmit UserPromptSubmitResult
	SessionStart     SessionStartResult
}

type GovernedTurnBlockedError struct {
	Reason        string
	TriggerMethod string
	Scope         string
}

func (e *GovernedTurnBlockedError) Error() string {
	reason := strings.TrimSpace(e.Reason)
	if reason == "" {
		reason = "governed turn start blocked"
	}
	return "governed turn start blocked: " + reason
}

type GovernedTurnStarter struct {
	service       *Service
	triggerMethod string
	scope         string
}

func NewGovernedTurnStarter(service *Service, triggerMethod string, scope string) *GovernedTurnStarter {
	return &GovernedTurnStarter{
		service:       service,
		triggerMethod: strings.TrimSpace(triggerMethod),
		scope:         strings.TrimSpace(scope),
	}
}

func (s *GovernedTurnStarter) Start(
	ctx context.Context,
	workspaceID string,
	threadID string,
	input string,
	options turns.StartOptions,
) (turns.Result, error) {
	if s == nil || s.service == nil {
		return turns.Result{}, errors.New("governed turn starter is unavailable")
	}

	result, err := s.service.StartGovernedTurn(ctx, GovernedTurnStartInput{
		WorkspaceID:   workspaceID,
		ThreadID:      threadID,
		Input:         input,
		TriggerMethod: s.triggerMethod,
		Scope:         s.scope,
		Options:       options,
	})
	if err != nil {
		return turns.Result{}, err
	}
	if result.Blocked {
		return turns.Result{}, &GovernedTurnBlockedError{
			Reason:        result.Reason,
			TriggerMethod: s.triggerMethod,
			Scope:         s.scope,
		}
	}

	return result.Turn, nil
}

func (s *Service) StartGovernedTurn(
	ctx context.Context,
	input GovernedTurnStartInput,
) (GovernedTurnStartResult, error) {
	result := GovernedTurnStartResult{
		FinalInput: input.Input,
	}

	if s.turns == nil {
		return result, errors.New("turn executor is required")
	}

	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	input.TriggerMethod = strings.TrimSpace(input.TriggerMethod)
	input.Scope = strings.TrimSpace(input.Scope)
	input.RequestID = strings.TrimSpace(input.RequestID)

	userPromptResult, err := s.EvaluateUserPromptSubmit(ctx, UserPromptSubmitInput{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		TriggerMethod: input.TriggerMethod,
		Scope:         input.Scope,
		Input:         input.Input,
	})
	result.UserPromptSubmit = userPromptResult
	if err != nil {
		return result, err
	}
	if userPromptResult.Blocked {
		result.Blocked = true
		result.Reason = userPromptResult.Reason
		return result, nil
	}

	sessionStartResult, err := s.EvaluateSessionStart(ctx, SessionStartInput{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		TriggerMethod: input.TriggerMethod,
		Scope:         input.Scope,
		Input:         result.FinalInput,
	})
	result.SessionStart = sessionStartResult
	if err != nil {
		return result, err
	}
	if sessionStartResult.Applied && strings.TrimSpace(sessionStartResult.UpdatedInput) != "" {
		result.FinalInput = sessionStartResult.UpdatedInput
	}

	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "turn/start")
	auditToken := firstNonEmpty(input.RequestID, startedAt.Format(time.RFC3339Nano))
	baseEvent := store.EventEnvelope{
		WorkspaceID: input.WorkspaceID,
		ThreadID:    input.ThreadID,
		Method:      triggerMethod,
		TS:          startedAt,
	}
	run := store.HookRun{
		WorkspaceID:        input.WorkspaceID,
		ThreadID:           input.ThreadID,
		ItemID:             input.RequestID,
		EventName:          eventNameTurnStart,
		HandlerKey:         handlerKeyTurnStartAudit,
		HandlerType:        "builtin",
		Provider:           "server",
		ExecutionMode:      "sync",
		Scope:              firstNonEmpty(input.Scope, "thread"),
		TriggerMethod:      triggerMethod,
		SessionStartSource: sessionStartResult.SessionStartSource,
		ToolKind:           "turnStart",
		ToolName:           "turn/start",
		Status:             hookStatusRunning,
		Decision:           decisionContinue,
		Reason:             reasonTurnStartRequested,
		Fingerprint: fingerprintFor(
			input.ThreadID,
			"",
			input.RequestID,
			handlerKeyTurnStartAudit,
			triggerMethod+"\x00"+auditToken,
		),
		Source:    s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt: startedAt,
	}

	persistedRun := s.beginDirectAuditRun(baseEvent, run)

	turnResult, err := s.turns.Start(
		ctx,
		input.WorkspaceID,
		input.ThreadID,
		result.FinalInput,
		input.Options,
	)
	if err != nil {
		result.Reason = reasonTurnStartFailed
		if persistedRun != nil {
			persistedRun.Status = hookStatusFailed
			persistedRun.Reason = result.Reason
			persistedRun.Error = err.Error()
			persistedRun.AdditionalContext = turnStartAuditContext("failed", sessionStartResult)
			persistedRun.Entries = turnStartAuditEntriesWithStatus("failed", sessionStartResult)
			result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
		}
		return result, err
	}

	result.Started = true
	result.Reason = reasonTurnStartAudited
	result.Turn = turnResult

	if persistedRun != nil {
		persistedRun.TurnID = strings.TrimSpace(turnResult.TurnID)
		persistedRun.Status = hookStatusCompleted
		persistedRun.Reason = result.Reason
		persistedRun.AdditionalContext = turnStartAuditContext(
			firstNonEmpty(strings.TrimSpace(turnResult.Status), "running"),
			sessionStartResult,
		)
		persistedRun.Entries = turnStartAuditEntries(turnResult, sessionStartResult)
		result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
	}

	return result, nil
}

func turnStartAuditEntries(result turns.Result, sessionStartResult SessionStartResult) []store.HookOutputEntry {
	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "resultStatus=" + firstNonEmpty(strings.TrimSpace(result.Status), "running")},
		{Kind: "feedback", Text: fmt.Sprintf("sessionStartApplied=%t", sessionStartResult.Applied)},
	}
	if sessionStartSource := strings.TrimSpace(sessionStartResult.SessionStartSource); sessionStartSource != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "sessionStartSource=" + sessionStartSource})
	}
	if turnID := strings.TrimSpace(result.TurnID); turnID != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "turnId=" + turnID})
	}
	return entries
}

func turnStartAuditEntriesWithStatus(status string, sessionStartResult SessionStartResult) []store.HookOutputEntry {
	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "resultStatus=" + firstNonEmpty(strings.TrimSpace(status), "running")},
		{Kind: "feedback", Text: fmt.Sprintf("sessionStartApplied=%t", sessionStartResult.Applied)},
	}
	if sessionStartSource := strings.TrimSpace(sessionStartResult.SessionStartSource); sessionStartSource != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "sessionStartSource=" + sessionStartSource})
	}
	return entries
}

func turnStartAuditContext(status string, sessionStartResult SessionStartResult) string {
	parts := []string{
		"resultStatus=" + firstNonEmpty(strings.TrimSpace(status), "running"),
		fmt.Sprintf("sessionStartApplied=%t", sessionStartResult.Applied),
	}
	if sessionStartSource := strings.TrimSpace(sessionStartResult.SessionStartSource); sessionStartSource != "" {
		parts = append(parts, "sessionStartSource="+sessionStartSource)
	}
	return strings.Join(parts, " ")
}

func (s *Service) startGovernedHookFollowUpTurn(
	ctx context.Context,
	workspaceID string,
	threadID string,
	input string,
	metadata turns.StartMetadata,
) (turns.Result, error) {
	result, err := s.StartGovernedTurn(ctx, GovernedTurnStartInput{
		WorkspaceID:   workspaceID,
		ThreadID:      threadID,
		Input:         input,
		TriggerMethod: hookFollowUpTriggerMethod,
		Scope:         "thread",
		Options: turns.StartOptions{
			ResponsesAPIClientMetadata: metadata,
		},
	})
	if err != nil {
		return turns.Result{}, err
	}
	if result.Blocked {
		return turns.Result{}, &GovernedTurnBlockedError{
			Reason:        result.Reason,
			TriggerMethod: hookFollowUpTriggerMethod,
			Scope:         "thread",
		}
	}

	return result.Turn, nil
}
