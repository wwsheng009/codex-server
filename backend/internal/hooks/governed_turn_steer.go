package hooks

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

const (
	reasonTurnSteerRequested = "turn_steer_requested"
	reasonTurnSteerAudited   = "turn_steer_audited"
	reasonTurnSteerFailed    = "turn_steer_failed"
	reasonSteerNoActiveTurn  = "steer_no_active_turn"
)

type GovernedTurnSteerInput struct {
	WorkspaceID   string
	ThreadID      string
	Input         string
	TriggerMethod string
	Scope         string
	RequestID     string
}

type GovernedTurnSteerResult struct {
	Steered          bool
	Blocked          bool
	Reason           string
	Turn             turns.Result
	Run              *store.HookRun
	UserPromptSubmit UserPromptSubmitResult
}

type GovernedTurnSteerer struct {
	service       *Service
	triggerMethod string
	scope         string
}

func NewGovernedTurnSteerer(service *Service, triggerMethod string, scope string) *GovernedTurnSteerer {
	return &GovernedTurnSteerer{
		service:       service,
		triggerMethod: strings.TrimSpace(triggerMethod),
		scope:         strings.TrimSpace(scope),
	}
}

func (s *GovernedTurnSteerer) Steer(
	ctx context.Context,
	workspaceID string,
	threadID string,
	input string,
) (turns.Result, error) {
	if s == nil || s.service == nil {
		return turns.Result{}, errors.New("governed turn steerer is unavailable")
	}

	result, err := s.service.SteerGovernedTurn(ctx, GovernedTurnSteerInput{
		WorkspaceID:   workspaceID,
		ThreadID:      threadID,
		Input:         input,
		TriggerMethod: s.triggerMethod,
		Scope:         s.scope,
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

func (s *Service) SteerGovernedTurn(
	ctx context.Context,
	input GovernedTurnSteerInput,
) (GovernedTurnSteerResult, error) {
	result := GovernedTurnSteerResult{}

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

	startedAt := s.now()
	triggerMethod := firstNonEmpty(input.TriggerMethod, "turn/steer")
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
		EventName:     eventNameTurnSteer,
		HandlerKey:    handlerKeyTurnSteerAudit,
		HandlerType:   "builtin",
		Provider:      "server",
		ExecutionMode: "sync",
		Scope:         firstNonEmpty(input.Scope, "thread"),
		TriggerMethod: triggerMethod,
		ToolKind:      "turnSteer",
		ToolName:      "turn/steer",
		Status:        hookStatusRunning,
		Decision:      decisionContinue,
		Reason:        reasonTurnSteerRequested,
		Fingerprint: fingerprintFor(
			input.ThreadID,
			"",
			input.RequestID,
			handlerKeyTurnSteerAudit,
			triggerMethod+"\x00"+auditToken,
		),
		Source:    s.threadSource(input.WorkspaceID, input.ThreadID),
		StartedAt: startedAt,
	}

	persistedRun := s.beginDirectAuditRun(baseEvent, run)

	turnResult, err := s.turns.Steer(ctx, input.WorkspaceID, input.ThreadID, input.Input)
	if err != nil {
		result.Reason = reasonTurnSteerFailed
		additionalContext := "resultStatus=failed"
		entries := []store.HookOutputEntry{
			{Kind: "feedback", Text: "resultStatus=failed"},
		}
		if errors.Is(err, appRuntime.ErrNoActiveTurn) {
			result.Reason = reasonSteerNoActiveTurn
			additionalContext = "resultStatus=failed activeTurn=false"
			entries = append(entries, store.HookOutputEntry{Kind: "feedback", Text: "activeTurn=false"})
		}
		if persistedRun != nil {
			persistedRun.Status = hookStatusFailed
			persistedRun.Reason = result.Reason
			persistedRun.Error = err.Error()
			persistedRun.AdditionalContext = additionalContext
			persistedRun.Entries = entries
			result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
		}
		return result, err
	}

	result.Steered = true
	result.Reason = reasonTurnSteerAudited
	result.Turn = turnResult

	if persistedRun != nil {
		persistedRun.TurnID = strings.TrimSpace(turnResult.TurnID)
		persistedRun.Status = hookStatusCompleted
		persistedRun.Reason = result.Reason
		persistedRun.AdditionalContext = fmt.Sprintf(
			"resultStatus=%s activeTurn=true",
			firstNonEmpty(strings.TrimSpace(turnResult.Status), "steered"),
		)
		persistedRun.Entries = steerAuditEntries(turnResult)
		result.Run = s.completeDirectAuditRun(baseEvent, persistedRun)
	}

	return result, nil
}

func steerAuditEntries(result turns.Result) []store.HookOutputEntry {
	entries := []store.HookOutputEntry{
		{Kind: "feedback", Text: "resultStatus=" + firstNonEmpty(strings.TrimSpace(result.Status), "steered")},
		{Kind: "feedback", Text: "activeTurn=true"},
	}
	if turnID := strings.TrimSpace(result.TurnID); turnID != "" {
		entries = append(entries, store.HookOutputEntry{Kind: "context", Text: "turnId=" + turnID})
	}
	return entries
}
