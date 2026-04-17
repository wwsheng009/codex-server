package turnpolicies

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"

	"codex-server/backend/internal/diagnostics"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

const (
	defaultActionTimeout                                                        = 10 * time.Second
	defaultFollowUpCooldown                                                     = 2 * time.Minute
	defaultHookStartGrace                                                       = 100 * time.Millisecond
	defaultHookPollInterval                                                     = 20 * time.Millisecond
	DefaultPostToolUseFailedValidationEnabled                                   = true
	DefaultStopMissingSuccessfulVerificationEnabled                             = true
	DefaultPostToolUsePrimaryAction                                             = actionSteer
	DefaultStopMissingSuccessfulVerificationPrimaryAction                       = actionFollowUp
	DefaultPostToolUseInterruptNoActiveTurnBehavior                             = interruptNoActiveTurnBehaviorSkip
	DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior       = interruptNoActiveTurnBehaviorSkip
	DefaultFollowUpCooldownMs                                             int64 = int64(defaultFollowUpCooldown / time.Millisecond)
	postToolUsePolicyName                                                       = "posttooluse/failed-validation-command"
	stopMissingVerifyPolicy                                                     = "stop/missing-successful-verification"
	actionNone                                                                  = "none"
	actionSteer                                                                 = "steer"
	actionFollowUp                                                              = "followUp"
	actionInterrupt                                                             = "interrupt"
	interruptNoActiveTurnBehaviorSkip                                           = "skip"
	reasonInterruptNoActiveTurn                                                 = "interrupt_no_active_turn"
	actionStatusSucceeded                                                       = "succeeded"
	actionStatusFailed                                                          = "failed"
	actionStatusSkipped                                                         = "skipped"
	governanceLayerHook                                                         = "hook"
	governanceLayerTurnPolicyFallback                                           = "turnPolicyFallback"
	hookStatusRunning                                                           = "running"
	hookStatusFailed                                                            = "failed"
)

type RuntimeConfig struct {
	PostToolUseFailedValidationEnabled                   bool
	StopMissingVerificationEnabled                       bool
	PostToolUsePrimaryAction                             string
	StopMissingVerificationPrimaryAction                 string
	PostToolUseInterruptNoActiveTurnBehavior             string
	StopMissingVerificationInterruptNoActiveTurnBehavior string
	ValidationCommandPrefixes                            []string
	PostToolUseFollowUpCooldown                          time.Duration
	PostToolUseFollowUpCooldownMs                        int64
	StopMissingVerificationFollowUpCooldown              time.Duration
	StopMissingVerificationFollowUpCooldownMs            int64
	FollowUpCooldown                                     time.Duration
	FollowUpCooldownMs                                   int64
}

type turnExecutor interface {
	Start(ctx context.Context, workspaceID string, threadID string, input string, options turns.StartOptions) (turns.Result, error)
	Steer(ctx context.Context, workspaceID string, threadID string, input string) (turns.Result, error)
	Interrupt(ctx context.Context, workspaceID string, threadID string) (turns.Result, error)
}

type Service struct {
	store  *store.MemoryStore
	turns  turnExecutor
	events *events.Hub

	now              func() time.Time
	actionTimeout    time.Duration
	followUpCooldown time.Duration
	hookStartGrace   time.Duration
	hookPollInterval time.Duration

	hooksPrimary bool
	mu           sync.Mutex
	started      bool
	inFlightBy   map[string]struct{}
}

type decisionRequest struct {
	itemID                        string
	turnID                        string
	triggerMethod                 string
	policyName                    string
	verdict                       string
	action                        string
	reason                        string
	evidenceSummary               string
	fingerprint                   string
	hookHandlerKey                string
	hookFingerprint               string
	prompt                        string
	interruptNoActiveTurnBehavior string
}

type ListOptions struct {
	ThreadID      string
	PolicyName    string
	Action        string
	ActionStatus  string
	TriggerMethod string
	Source        string
	Reason        string
	Limit         int
}

func (s *Service) List(workspaceID string, options ListOptions) ([]store.TurnPolicyDecision, error) {
	if s.store == nil {
		return []store.TurnPolicyDecision{}, nil
	}
	workspaceID = strings.TrimSpace(workspaceID)
	options = normalizeListOptions(options)

	if _, ok := s.store.GetWorkspace(workspaceID); !ok {
		return nil, store.ErrWorkspaceNotFound
	}

	items := s.store.ListTurnPolicyDecisions(workspaceID, options.ThreadID)
	filtered := items[:0]
	for _, item := range items {
		if options.PolicyName != "" && item.PolicyName != options.PolicyName {
			continue
		}
		if options.Action != "" && item.Action != options.Action {
			continue
		}
		if options.ActionStatus != "" && item.ActionStatus != options.ActionStatus {
			continue
		}
		if options.TriggerMethod != "" && item.TriggerMethod != options.TriggerMethod {
			continue
		}
		if options.Source != "" && item.Source != options.Source {
			continue
		}
		if options.Reason != "" && item.Reason != options.Reason {
			continue
		}
		filtered = append(filtered, item)
	}

	if options.Limit > 0 && len(filtered) > options.Limit {
		return append([]store.TurnPolicyDecision(nil), filtered[:options.Limit]...), nil
	}

	return append([]store.TurnPolicyDecision(nil), filtered...), nil
}

func normalizeListOptions(options ListOptions) ListOptions {
	options.ThreadID = strings.TrimSpace(options.ThreadID)
	options.PolicyName = strings.TrimSpace(options.PolicyName)
	options.Action = strings.TrimSpace(options.Action)
	options.ActionStatus = strings.TrimSpace(options.ActionStatus)
	options.TriggerMethod = strings.TrimSpace(options.TriggerMethod)
	options.Source = strings.TrimSpace(options.Source)
	options.Reason = strings.TrimSpace(options.Reason)
	return options
}

func NewService(dataStore *store.MemoryStore, turnService turnExecutor, eventHub *events.Hub) *Service {
	return &Service{
		store:            dataStore,
		turns:            turnService,
		events:           eventHub,
		now:              func() time.Time { return time.Now().UTC() },
		actionTimeout:    defaultActionTimeout,
		followUpCooldown: defaultFollowUpCooldown,
		hookStartGrace:   defaultHookStartGrace,
		hookPollInterval: defaultHookPollInterval,
		inFlightBy:       make(map[string]struct{}),
	}
}

func (s *Service) SetHooksPrimary(enabled bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.hooksPrimary = enabled
}

func ResolveRuntimeConfig(prefs store.RuntimePreferences) RuntimeConfig {
	config := RuntimeConfig{
		PostToolUseFailedValidationEnabled:                   DefaultPostToolUseFailedValidationEnabled,
		StopMissingVerificationEnabled:                       DefaultStopMissingSuccessfulVerificationEnabled,
		PostToolUsePrimaryAction:                             DefaultPostToolUsePrimaryAction,
		StopMissingVerificationPrimaryAction:                 DefaultStopMissingSuccessfulVerificationPrimaryAction,
		PostToolUseInterruptNoActiveTurnBehavior:             DefaultPostToolUseInterruptNoActiveTurnBehavior,
		StopMissingVerificationInterruptNoActiveTurnBehavior: DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
		ValidationCommandPrefixes:                            DefaultValidationCommandPrefixes(),
		PostToolUseFollowUpCooldown:                          defaultFollowUpCooldown,
		PostToolUseFollowUpCooldownMs:                        DefaultFollowUpCooldownMs,
		StopMissingVerificationFollowUpCooldown:              defaultFollowUpCooldown,
		StopMissingVerificationFollowUpCooldownMs:            DefaultFollowUpCooldownMs,
		FollowUpCooldown:                                     defaultFollowUpCooldown,
		FollowUpCooldownMs:                                   DefaultFollowUpCooldownMs,
	}

	if prefs.TurnPolicyPostToolUseFailedValidationEnabled != nil {
		config.PostToolUseFailedValidationEnabled = *prefs.TurnPolicyPostToolUseFailedValidationEnabled
	}
	if prefs.TurnPolicyStopMissingSuccessfulVerificationEnabled != nil {
		config.StopMissingVerificationEnabled = *prefs.TurnPolicyStopMissingSuccessfulVerificationEnabled
	}
	if action := normalizePrimaryActionPreference(prefs.TurnPolicyPostToolUsePrimaryAction); action != "" {
		config.PostToolUsePrimaryAction = action
	}
	if action := normalizePrimaryActionPreference(prefs.TurnPolicyStopMissingSuccessfulVerificationPrimaryAction); action != "" {
		config.StopMissingVerificationPrimaryAction = action
	}
	if behavior := normalizeInterruptNoActiveTurnBehaviorPreference(prefs.TurnPolicyPostToolUseInterruptNoActiveTurnBehavior); behavior != "" {
		config.PostToolUseInterruptNoActiveTurnBehavior = behavior
	}
	if behavior := normalizeInterruptNoActiveTurnBehaviorPreference(prefs.TurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior); behavior != "" {
		config.StopMissingVerificationInterruptNoActiveTurnBehavior = behavior
	}
	if prefs.TurnPolicyFollowUpCooldownMs != nil && *prefs.TurnPolicyFollowUpCooldownMs >= 0 {
		config.FollowUpCooldownMs = *prefs.TurnPolicyFollowUpCooldownMs
		config.FollowUpCooldown = time.Duration(*prefs.TurnPolicyFollowUpCooldownMs) * time.Millisecond
		config.PostToolUseFollowUpCooldownMs = config.FollowUpCooldownMs
		config.PostToolUseFollowUpCooldown = config.FollowUpCooldown
		config.StopMissingVerificationFollowUpCooldownMs = config.FollowUpCooldownMs
		config.StopMissingVerificationFollowUpCooldown = config.FollowUpCooldown
	}
	if prefs.TurnPolicyPostToolUseFollowUpCooldownMs != nil && *prefs.TurnPolicyPostToolUseFollowUpCooldownMs >= 0 {
		config.PostToolUseFollowUpCooldownMs = *prefs.TurnPolicyPostToolUseFollowUpCooldownMs
		config.PostToolUseFollowUpCooldown = time.Duration(*prefs.TurnPolicyPostToolUseFollowUpCooldownMs) * time.Millisecond
	}
	if prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs != nil && *prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs >= 0 {
		config.StopMissingVerificationFollowUpCooldownMs = *prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs
		config.StopMissingVerificationFollowUpCooldown = time.Duration(*prefs.TurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs) * time.Millisecond
	}
	config.ValidationCommandPrefixes = ResolveValidationCommandPrefixes(prefs)

	return config
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

	eventsCh, cancel := s.events.SubscribeAllWithSource(
		"turnpolicies.service",
		"turn-policy-service",
	)
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

func (s *Service) handleEvent(ctx context.Context, event store.EventEnvelope) {
	if strings.TrimSpace(event.WorkspaceID) == "" || strings.TrimSpace(event.ThreadID) == "" {
		return
	}

	s.mu.Lock()
	hooksPrimary := s.hooksPrimary
	s.mu.Unlock()

	runtimeConfig := s.runtimeConfig()
	switch event.Method {
	case "item/completed":
		if !runtimeConfig.PostToolUseFailedValidationEnabled {
			return
		}
		request, ok := evaluateFailedValidationCommand(event, runtimeConfig.ValidationCommandPrefixes)
		if !ok {
			return
		}
		request = applyPrimaryActionPreference(request, runtimeConfig.PostToolUsePrimaryAction)
		request = applyInterruptNoActiveTurnBehaviorPreference(
			request,
			runtimeConfig.PostToolUseInterruptNoActiveTurnBehavior,
		)
		s.executeEvaluatedRequest(ctx, event, request, hooksPrimary)
	case "turn/completed":
		if !runtimeConfig.StopMissingVerificationEnabled {
			return
		}
		request, ok := evaluateMissingVerificationTurn(event, runtimeConfig.ValidationCommandPrefixes)
		if !ok {
			return
		}
		request = applyPrimaryActionPreference(request, runtimeConfig.StopMissingVerificationPrimaryAction)
		request = applyInterruptNoActiveTurnBehaviorPreference(
			request,
			runtimeConfig.StopMissingVerificationInterruptNoActiveTurnBehavior,
		)
		s.executeEvaluatedRequest(ctx, event, request, hooksPrimary)
	}
}

func (s *Service) executeEvaluatedRequest(
	ctx context.Context,
	event store.EventEnvelope,
	request decisionRequest,
	hooksPrimary bool,
) {
	governanceLayer := ""
	if hooksPrimary {
		if !s.shouldExecuteHooksPrimaryFallback(ctx, event, request) {
			return
		}
		governanceLayer = governanceLayerTurnPolicyFallback
	}

	s.executeDecision(ctx, event, request, governanceLayer)
}

func normalizePrimaryActionPreference(value string) string {
	switch strings.TrimSpace(value) {
	case actionSteer, actionFollowUp, actionInterrupt:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func normalizeInterruptNoActiveTurnBehaviorPreference(value string) string {
	switch strings.TrimSpace(value) {
	case interruptNoActiveTurnBehaviorSkip, actionFollowUp:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func applyPrimaryActionPreference(request decisionRequest, primaryAction string) decisionRequest {
	normalizedAction := normalizePrimaryActionPreference(primaryAction)
	if normalizedAction == "" {
		return request
	}
	request.verdict = normalizedAction
	request.action = normalizedAction
	return request
}

func applyInterruptNoActiveTurnBehaviorPreference(
	request decisionRequest,
	behavior string,
) decisionRequest {
	normalizedBehavior := normalizeInterruptNoActiveTurnBehaviorPreference(behavior)
	if normalizedBehavior == "" {
		return request
	}
	request.interruptNoActiveTurnBehavior = normalizedBehavior
	return request
}

func (s *Service) shouldExecuteHooksPrimaryFallback(
	ctx context.Context,
	event store.EventEnvelope,
	request decisionRequest,
) bool {
	if s.store == nil {
		return true
	}
	if strings.TrimSpace(request.hookHandlerKey) == "" || strings.TrimSpace(request.hookFingerprint) == "" {
		return true
	}

	noRunDeadline := s.now().Add(s.hookStartGrace)
	completionDeadline := time.Time{}

	for {
		existingDecision, ok := s.store.GetTurnPolicyDecisionByFingerprint(
			event.WorkspaceID,
			event.ThreadID,
			request.fingerprint,
		)
		if ok {
			return existingDecision.ActionStatus == actionStatusFailed
		}

		hookRun, ok := s.findHookRunByFingerprint(
			event.WorkspaceID,
			event.ThreadID,
			request.hookHandlerKey,
			request.hookFingerprint,
		)
		if !ok {
			if !s.now().Before(noRunDeadline) {
				return true
			}
		} else {
			if completionDeadline.IsZero() {
				completionDeadline = s.now().Add(s.actionTimeout + s.hookPollInterval)
			}

			switch strings.TrimSpace(hookRun.Status) {
			case hookStatusRunning:
				if !s.now().Before(completionDeadline) {
					return true
				}
			case hookStatusFailed:
				return true
			default:
				return false
			}
		}

		if !sleepContext(ctx, s.hookPollInterval) {
			return false
		}
	}
}

func sleepContext(ctx context.Context, duration time.Duration) bool {
	if duration <= 0 {
		select {
		case <-ctx.Done():
			return false
		default:
			return true
		}
	}

	timer := time.NewTimer(duration)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (s *Service) executeDecision(
	ctx context.Context,
	event store.EventEnvelope,
	request decisionRequest,
	governanceLayer string,
) {
	inFlightKey := event.WorkspaceID + "\x00" + event.ThreadID + "\x00" + request.fingerprint
	if !s.beginEvaluation(inFlightKey) {
		return
	}
	defer s.endEvaluation(inFlightKey)

	startedAt := s.now()
	source := s.threadSource(event.WorkspaceID, event.ThreadID)
	if existing, ok := s.store.GetTurnPolicyDecisionByFingerprint(event.WorkspaceID, event.ThreadID, request.fingerprint); ok &&
		existing.ActionStatus != actionStatusFailed {
		s.persistDecision(store.TurnPolicyDecision{
			WorkspaceID:         event.WorkspaceID,
			ThreadID:            event.ThreadID,
			TurnID:              request.turnID,
			ItemID:              request.itemID,
			TriggerMethod:       request.triggerMethod,
			PolicyName:          request.policyName,
			Fingerprint:         request.fingerprint,
			Verdict:             request.verdict,
			Action:              actionNone,
			ActionStatus:        actionStatusSkipped,
			Reason:              "duplicate_fingerprint",
			EvidenceSummary:     request.evidenceSummary,
			GovernanceLayer:     governanceLayer,
			Source:              source,
			EvaluationStartedAt: startedAt,
			DecisionAt:          s.now(),
			CompletedAt:         s.now(),
		})
		return
	}

	if request.action == actionFollowUp && s.recentSuccessfulFollowUp(event.WorkspaceID, event.ThreadID, request.policyName, s.now()) {
		s.persistDecision(store.TurnPolicyDecision{
			WorkspaceID:         event.WorkspaceID,
			ThreadID:            event.ThreadID,
			TurnID:              request.turnID,
			ItemID:              request.itemID,
			TriggerMethod:       request.triggerMethod,
			PolicyName:          request.policyName,
			Fingerprint:         request.fingerprint,
			Verdict:             request.verdict,
			Action:              actionNone,
			ActionStatus:        actionStatusSkipped,
			Reason:              "follow_up_cooldown_active",
			EvidenceSummary:     request.evidenceSummary,
			GovernanceLayer:     governanceLayer,
			Source:              source,
			EvaluationStartedAt: startedAt,
			DecisionAt:          s.now(),
			CompletedAt:         s.now(),
		})
		return
	}

	decisionAt := s.now()
	action := request.action
	actionStatus := actionStatusSucceeded
	actionTurnID := ""
	actionErr := ""
	followUpOptions := turns.StartOptions{
		ResponsesAPIClientMetadata: turns.TurnPolicyFollowUpStartMetadata(
			event.WorkspaceID,
			event.ThreadID,
			request.triggerMethod,
			request.policyName,
		),
	}

	callCtx, cancel := context.WithTimeout(ctx, s.actionTimeout)
	defer cancel()

	switch request.action {
	case actionSteer:
		result, err := s.turns.Steer(callCtx, event.WorkspaceID, event.ThreadID, request.prompt)
		if err != nil {
			if errors.Is(err, runtime.ErrNoActiveTurn) {
				action = actionFollowUp
				result, err = s.turns.Start(callCtx, event.WorkspaceID, event.ThreadID, request.prompt, followUpOptions)
			}
			if err != nil {
				actionStatus = actionStatusFailed
				actionErr = err.Error()
				break
			}
		}
		actionTurnID = strings.TrimSpace(result.TurnID)
	case actionFollowUp:
		result, err := s.turns.Start(callCtx, event.WorkspaceID, event.ThreadID, request.prompt, followUpOptions)
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
			request.reason = reasonInterruptNoActiveTurn
			if request.interruptNoActiveTurnBehavior == actionFollowUp {
				if s.recentSuccessfulFollowUp(event.WorkspaceID, event.ThreadID, request.policyName, s.now()) {
					action = actionNone
					actionStatus = actionStatusSkipped
					request.reason = "follow_up_cooldown_active"
					break
				}

				action = actionFollowUp
				result, err = s.turns.Start(callCtx, event.WorkspaceID, event.ThreadID, request.prompt, followUpOptions)
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
	s.persistDecision(store.TurnPolicyDecision{
		WorkspaceID:         event.WorkspaceID,
		ThreadID:            event.ThreadID,
		TurnID:              request.turnID,
		ItemID:              request.itemID,
		TriggerMethod:       request.triggerMethod,
		PolicyName:          request.policyName,
		Fingerprint:         request.fingerprint,
		Verdict:             request.verdict,
		Action:              action,
		ActionStatus:        actionStatus,
		ActionTurnID:        actionTurnID,
		Reason:              request.reason,
		EvidenceSummary:     request.evidenceSummary,
		GovernanceLayer:     governanceLayer,
		Source:              source,
		Error:               actionErr,
		EvaluationStartedAt: startedAt,
		DecisionAt:          decisionAt,
		CompletedAt:         completedAt,
	})

	diagnostics.LogThreadTrace(
		event.WorkspaceID,
		event.ThreadID,
		"turn policy evaluated",
		"policyName", request.policyName,
		"verdict", request.verdict,
		"action", action,
		"actionStatus", actionStatus,
		"actionTurnId", actionTurnID,
		"reason", request.reason,
		"error", actionErr,
	)
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
) bool {
	followUpCooldown := followUpCooldownForPolicy(s.runtimeConfig(), policyName)
	if followUpCooldown <= 0 {
		return false
	}

	cutoff := now.Add(-followUpCooldown)
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

func followUpCooldownForPolicy(config RuntimeConfig, policyName string) time.Duration {
	switch strings.TrimSpace(policyName) {
	case postToolUsePolicyName:
		return config.PostToolUseFollowUpCooldown
	case stopMissingVerifyPolicy:
		return config.StopMissingVerificationFollowUpCooldown
	default:
		return config.FollowUpCooldown
	}
}

func (s *Service) persistDecision(decision store.TurnPolicyDecision) {
	created, err := s.store.CreateTurnPolicyDecision(decision)
	if err != nil {
		diagnostics.LogThreadTrace(
			decision.WorkspaceID,
			decision.ThreadID,
			"turn policy decision persistence failed",
			"policyName", decision.PolicyName,
			"fingerprint", decision.Fingerprint,
			"error", err,
		)
		return
	}
	if s.events != nil {
		s.events.Publish(store.EventEnvelope{
			WorkspaceID: created.WorkspaceID,
			ThreadID:    created.ThreadID,
			TurnID:      created.TurnID,
			Method:      "turn-policy/decision_recorded",
			Payload: map[string]any{
				"decisionId":    created.ID,
				"threadId":      created.ThreadID,
				"turnId":        created.TurnID,
				"policyName":    created.PolicyName,
				"action":        created.Action,
				"actionStatus":  created.ActionStatus,
				"reason":        created.Reason,
				"triggerMethod": created.TriggerMethod,
				"source":        created.Source,
				"hookRunId":     created.HookRunID,
			},
			TS: s.now(),
		})
	}
}

func (s *Service) threadSource(workspaceID string, threadID string) string {
	projection, ok := s.store.GetThreadProjectionSummary(workspaceID, threadID)
	if !ok {
		return ""
	}
	return strings.TrimSpace(projection.Source)
}

func (s *Service) findHookRunByFingerprint(
	workspaceID string,
	threadID string,
	handlerKey string,
	fingerprint string,
) (store.HookRun, bool) {
	if s.store == nil || strings.TrimSpace(handlerKey) == "" || strings.TrimSpace(fingerprint) == "" {
		return store.HookRun{}, false
	}

	for _, run := range s.store.ListHookRuns(workspaceID, threadID) {
		if run.HandlerKey == handlerKey && run.Fingerprint == fingerprint {
			return run, true
		}
	}

	return store.HookRun{}, false
}

func (s *Service) runtimeConfig() RuntimeConfig {
	if s.store == nil {
		return RuntimeConfig{
			PostToolUseFailedValidationEnabled:                   DefaultPostToolUseFailedValidationEnabled,
			StopMissingVerificationEnabled:                       DefaultStopMissingSuccessfulVerificationEnabled,
			PostToolUsePrimaryAction:                             DefaultPostToolUsePrimaryAction,
			StopMissingVerificationPrimaryAction:                 DefaultStopMissingSuccessfulVerificationPrimaryAction,
			PostToolUseInterruptNoActiveTurnBehavior:             DefaultPostToolUseInterruptNoActiveTurnBehavior,
			StopMissingVerificationInterruptNoActiveTurnBehavior: DefaultStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
			ValidationCommandPrefixes:                            DefaultValidationCommandPrefixes(),
			PostToolUseFollowUpCooldown:                          s.followUpCooldown,
			PostToolUseFollowUpCooldownMs:                        int64(s.followUpCooldown / time.Millisecond),
			StopMissingVerificationFollowUpCooldown:              s.followUpCooldown,
			StopMissingVerificationFollowUpCooldownMs:            int64(s.followUpCooldown / time.Millisecond),
			FollowUpCooldown:                                     s.followUpCooldown,
			FollowUpCooldownMs:                                   int64(s.followUpCooldown / time.Millisecond),
		}
	}

	return ResolveRuntimeConfig(s.store.GetRuntimePreferences())
}
