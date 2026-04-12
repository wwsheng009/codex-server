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

const (
	reasonTurnInterruptRequested = "turn_interrupt_requested"
	reasonTurnInterruptAudited   = "turn_interrupt_audited"
	reasonTurnInterruptFailed    = "turn_interrupt_failed"

	reasonReviewStartRequested = "review_start_requested"
	reasonReviewStartAudited   = "review_start_audited"
	reasonReviewStartFailed    = "review_start_failed"

	reviewStartDelivery = "inline"
	reviewStartTarget   = "uncommittedChanges"
)

type GovernedTurnInterruptInput struct {
	WorkspaceID   string
	ThreadID      string
	TriggerMethod string
	Scope         string
	RequestID     string
}

type GovernedTurnInterruptResult struct {
	Interrupted   bool
	HadActiveTurn bool
	Reason        string
	Turn          turns.Result
	Run           *store.HookRun
}

type GovernedReviewStartInput struct {
	WorkspaceID   string
	ThreadID      string
	TriggerMethod string
	Scope         string
	RequestID     string
}

type GovernedReviewStartResult struct {
	Started bool
	Reason  string
	Turn    turns.Result
	Run     *store.HookRun
}

func (s *Service) InterruptGovernedTurn(
	ctx context.Context,
	input GovernedTurnInterruptInput,
) (GovernedTurnInterruptResult, error) {
	result := GovernedTurnInterruptResult{}

	if s == nil || s.turns == nil {
		return result, errors.New("turn executor is required")
	}

	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	input.TriggerMethod = strings.TrimSpace(input.TriggerMethod)
	input.Scope = strings.TrimSpace(input.Scope)
	input.RequestID = strings.TrimSpace(input.RequestID)

	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "turn/interrupt")
	auditToken := firstNonEmpty(input.RequestID, startedAt.Format(time.RFC3339Nano))
	baseEvent := store.EventEnvelope{
		WorkspaceID: input.WorkspaceID,
		ThreadID:    input.ThreadID,
		Method:      triggerMethod,
		TS:          startedAt,
	}
	run := store.HookRun{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		ItemID:        input.RequestID,
		EventName:     eventNameTurnInterrupt,
		HandlerKey:    handlerKeyTurnInterruptAudit,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         firstNonEmpty(input.Scope, "thread"),
		TriggerMethod: triggerMethod,
		ToolKind:      "turnInterrupt",
		ToolName:      "turn/interrupt",
		Status:        hookStatusRunning,
		Decision:      decisionContinue,
		Reason:        reasonTurnInterruptRequested,
		Fingerprint: fingerprintFor(
			input.ThreadID,
			"",
			input.RequestID,
			handlerKeyTurnInterruptAudit,
			triggerMethod+"\x00"+auditToken,
		),
		Source:    s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt: startedAt,
	}

	persistedRun := s.beginDirectAuditRun(baseEvent, run)

	turnResult, err := s.turns.Interrupt(ctx, input.WorkspaceID, input.ThreadID)
	if err != nil {
		result.Reason = reasonTurnInterruptFailed
		if persistedRun != nil {
			persistedRun.Status = hookStatusFailed
			persistedRun.Reason = result.Reason
			persistedRun.Error = err.Error()
			persistedRun.AdditionalContext = "resultStatus=failed"
			persistedRun.Entries = []store.HookOutputEntry{
				{Kind: "feedback", Text: "resultStatus=failed"},
			}
			result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
		}
		return result, err
	}

	hadActiveTurn := strings.TrimSpace(turnResult.TurnID) != ""
	result.Interrupted = true
	result.HadActiveTurn = hadActiveTurn
	result.Reason = reasonTurnInterruptAudited
	if !hadActiveTurn {
		result.Reason = reasonInterruptNoActiveTurn
	}
	result.Turn = turnResult

	if persistedRun != nil {
		persistedRun.TurnID = strings.TrimSpace(turnResult.TurnID)
		persistedRun.Status = hookStatusCompleted
		persistedRun.Reason = result.Reason
		persistedRun.AdditionalContext = fmt.Sprintf(
			"resultStatus=%s activeTurn=%t",
			firstNonEmpty(strings.TrimSpace(turnResult.Status), "interrupted"),
			hadActiveTurn,
		)
		persistedRun.Entries = interruptAuditEntries(turnResult, hadActiveTurn)
		result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
	}

	return result, nil
}

func (s *Service) StartGovernedReview(
	ctx context.Context,
	input GovernedReviewStartInput,
) (GovernedReviewStartResult, error) {
	result := GovernedReviewStartResult{}

	if s == nil || s.turns == nil {
		return result, errors.New("turn executor is required")
	}

	input.WorkspaceID = strings.TrimSpace(input.WorkspaceID)
	input.ThreadID = strings.TrimSpace(input.ThreadID)
	input.TriggerMethod = strings.TrimSpace(input.TriggerMethod)
	input.Scope = strings.TrimSpace(input.Scope)
	input.RequestID = strings.TrimSpace(input.RequestID)

	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "review/start")
	auditToken := firstNonEmpty(input.RequestID, startedAt.Format(time.RFC3339Nano))
	baseEvent := store.EventEnvelope{
		WorkspaceID: input.WorkspaceID,
		ThreadID:    input.ThreadID,
		Method:      triggerMethod,
		TS:          startedAt,
	}
	run := store.HookRun{
		WorkspaceID:   input.WorkspaceID,
		ThreadID:      input.ThreadID,
		ItemID:        input.RequestID,
		EventName:     eventNameReviewStart,
		HandlerKey:    handlerKeyReviewStartAudit,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         firstNonEmpty(input.Scope, "thread"),
		TriggerMethod: triggerMethod,
		ToolKind:      "reviewStart",
		ToolName:      "review/start",
		Status:        hookStatusRunning,
		Decision:      decisionContinue,
		Reason:        reasonReviewStartRequested,
		Fingerprint: fingerprintFor(
			input.ThreadID,
			"",
			input.RequestID,
			handlerKeyReviewStartAudit,
			triggerMethod+"\x00"+auditToken,
		),
		AdditionalContext: fmt.Sprintf("delivery=%s target=%s", reviewStartDelivery, reviewStartTarget),
		Source:            s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt:         startedAt,
	}

	persistedRun := s.beginDirectAuditRun(baseEvent, run)

	turnResult, err := s.turns.Review(ctx, input.WorkspaceID, input.ThreadID)
	if err != nil {
		result.Reason = reasonReviewStartFailed
		if persistedRun != nil {
			persistedRun.Status = hookStatusFailed
			persistedRun.Reason = result.Reason
			persistedRun.Error = err.Error()
			persistedRun.AdditionalContext = fmt.Sprintf(
				"delivery=%s target=%s resultStatus=failed",
				reviewStartDelivery,
				reviewStartTarget,
			)
			persistedRun.Entries = []store.HookOutputEntry{
				{Kind: "feedback", Text: "resultStatus=failed"},
				{Kind: "feedback", Text: "delivery=" + reviewStartDelivery},
				{Kind: "feedback", Text: "target=" + reviewStartTarget},
			}
			result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
		}
		return result, err
	}

	result.Started = true
	result.Reason = reasonReviewStartAudited
	result.Turn = turnResult

	if persistedRun != nil {
		persistedRun.TurnID = strings.TrimSpace(turnResult.TurnID)
		persistedRun.Status = hookStatusCompleted
		persistedRun.Reason = result.Reason
		persistedRun.AdditionalContext = fmt.Sprintf(
			"delivery=%s target=%s resultStatus=%s",
			reviewStartDelivery,
			reviewStartTarget,
			firstNonEmpty(strings.TrimSpace(turnResult.Status), "reviewing"),
		)
		persistedRun.Entries = reviewStartAuditEntries(turnResult)
		result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
	}

	return result, nil
}

func (s *Service) beginDirectAuditRun(baseEvent store.EventEnvelope, run store.HookRun) *store.HookRun {
	if s == nil || s.store == nil || strings.TrimSpace(run.WorkspaceID) == "" {
		return nil
	}

	persistedRun, err := s.store.UpsertHookRun(run)
	if err != nil {
		return nil
	}

	s.publishHookEvent(baseEvent, "hook/started", persistedRun)
	return &persistedRun
}

func (s *Service) completeDirectAuditRun(
	baseEvent store.EventEnvelope,
	run *store.HookRun,
) *store.HookRun {
	if s == nil || s.store == nil || run == nil {
		return run
	}

	completedAt := s.now()
	durationMs := completedAt.Sub(run.StartedAt).Milliseconds()
	run.CompletedAt = &completedAt
	run.DurationMs = &durationMs
	if strings.TrimSpace(run.Status) == "" {
		run.Status = hookStatusCompleted
	}

	persistedRun, err := s.store.UpsertHookRun(*run)
	if err != nil {
		return run
	}

	s.publishHookEvent(baseEvent, "hook/completed", persistedRun)
	return &persistedRun
}

func interruptAuditEntries(result turns.Result, hadActiveTurn bool) []store.HookOutputEntry {
	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "resultStatus=" + firstNonEmpty(strings.TrimSpace(result.Status), "interrupted")},
		{Kind: "feedback", Text: fmt.Sprintf("activeTurn=%t", hadActiveTurn)},
	}
	if turnID := strings.TrimSpace(result.TurnID); turnID != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "turnId=" + turnID})
	}
	return entries
}

func reviewStartAuditEntries(result turns.Result) []store.HookOutputEntry {
	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "resultStatus=" + firstNonEmpty(strings.TrimSpace(result.Status), "reviewing")},
	}
	if turnID := strings.TrimSpace(result.TurnID); turnID != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "turnId=" + turnID})
	}
	entries = append(entries,
		store.HookOutputEntry{Kind: "feedback", Text: "delivery=" + reviewStartDelivery},
		store.HookOutputEntry{Kind: "feedback", Text: "target=" + reviewStartTarget},
	)
	return entries
}
