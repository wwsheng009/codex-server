package hooks

import (
	"context"
	"errors"
	"strings"
	"testing"

	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

func TestSteerGovernedTurnBlocksWhenUserPromptSubmitBlocks(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{}
	service := NewService(dataStore, fakeTurns, eventHub)

	result, err := service.SteerGovernedTurn(context.Background(), GovernedTurnSteerInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		Input:         "Authorization: Bearer github_pat_abcDEF1234567890abcDEF1234567890",
		TriggerMethod: "turn/steer",
		Scope:         "thread",
	})
	if err != nil {
		t.Fatalf("SteerGovernedTurn() error = %v", err)
	}
	if !result.Blocked || result.Steered {
		t.Fatalf("expected governed steer to block, got %#v", result)
	}
	if fakeTurns.steerCount() != 0 {
		t.Fatalf("expected turns.Steer to be skipped when prompt is blocked, got %d calls", fakeTurns.steerCount())
	}
	if !strings.Contains(result.Reason, "remove the secret") {
		t.Fatalf("expected secret-removal guidance, got %#v", result.Reason)
	}
}

func TestSteerGovernedTurnDelegatesToTurnExecutorAfterPromptCheck(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		steerResult: turns.Result{
			TurnID: "turn-steered",
			Status: "steered",
		},
	}
	service := NewService(dataStore, fakeTurns, eventHub)

	result, err := service.SteerGovernedTurn(context.Background(), GovernedTurnSteerInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		Input:         "请继续整理 hook 追溯链路",
		TriggerMethod: "turn/steer",
		Scope:         "thread",
		RequestID:     "req-steer-1",
	})
	if err != nil {
		t.Fatalf("SteerGovernedTurn() error = %v", err)
	}
	if result.Blocked || !result.Steered {
		t.Fatalf("expected governed steer to succeed, got %#v", result)
	}
	if result.Turn.TurnID != "turn-steered" {
		t.Fatalf("expected governed steer to return turn-steered, got %#v", result.Turn)
	}
	if fakeTurns.steerCount() != 1 {
		t.Fatalf("expected turns.Steer to be called once, got %d", fakeTurns.steerCount())
	}
	if got := fakeTurns.steerCalls[0]; got.input != "请继续整理 hook 追溯链路" {
		t.Fatalf("expected steer input to be forwarded unchanged, got %#v", got)
	}
	if result.Run == nil {
		t.Fatal("expected governed steer to persist a dedicated hook run")
	}
	if result.Run.EventName != eventNameTurnSteer || result.Run.HandlerKey != handlerKeyTurnSteerAudit {
		t.Fatalf("unexpected governed steer hook run identity %#v", result.Run)
	}
	if result.Run.Reason != reasonTurnSteerAudited || result.Run.Status != hookStatusCompleted {
		t.Fatalf("unexpected governed steer hook completion %#v", result.Run)
	}
	if result.Run.ItemID != "req-steer-1" || result.Run.TurnID != "turn-steered" {
		t.Fatalf("expected governed steer audit to persist request and turn ids, got %#v", result.Run)
	}
	if len(dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1")) != 0 {
		t.Fatalf("expected governed steer audit to avoid turn-policy persistence, got %#v", dataStore.ListTurnPolicyDecisions(workspace.ID, "thread-1"))
	}
}

func TestSteerGovernedTurnRecordsNoActiveTurnAudit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		steerErr: appRuntime.ErrNoActiveTurn,
	}
	service := NewService(dataStore, fakeTurns, eventHub)

	result, err := service.SteerGovernedTurn(context.Background(), GovernedTurnSteerInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		Input:         "请继续推进",
		TriggerMethod: "turn/steer",
		Scope:         "thread",
		RequestID:     "req-steer-idle",
	})
	if !errors.Is(err, appRuntime.ErrNoActiveTurn) {
		t.Fatalf("expected no-active-turn error, got result=%#v err=%v", result, err)
	}
	if result.Run == nil {
		t.Fatal("expected no-active-turn steer to persist a dedicated hook run")
	}
	if result.Run.Status != hookStatusFailed || result.Run.Reason != reasonSteerNoActiveTurn {
		t.Fatalf("unexpected no-active-turn governed steer hook run %#v", result.Run)
	}
	if !strings.Contains(result.Run.AdditionalContext, "activeTurn=false") {
		t.Fatalf("expected no-active-turn governed steer context, got %#v", result.Run)
	}
	if result.Run.ItemID != "req-steer-idle" {
		t.Fatalf("expected no-active-turn governed steer to persist request id, got %#v", result.Run)
	}
}

func TestSteerGovernedTurnPersistsFailedAudit(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	fakeTurns := &fakeTurnExecutor{
		steerErr: errors.New("steer runtime unavailable"),
	}
	service := NewService(dataStore, fakeTurns, eventHub)

	result, err := service.SteerGovernedTurn(context.Background(), GovernedTurnSteerInput{
		WorkspaceID:   workspace.ID,
		ThreadID:      "thread-1",
		Input:         "请继续推进",
		TriggerMethod: "turn/steer",
		Scope:         "thread",
		RequestID:     "req-steer-failed",
	})
	if err == nil {
		t.Fatal("expected SteerGovernedTurn() to return the underlying steer error")
	}
	if result.Run == nil {
		t.Fatal("expected failed steer to persist a dedicated hook run")
	}
	if result.Run.Status != hookStatusFailed || result.Run.Reason != reasonTurnSteerFailed {
		t.Fatalf("unexpected failed governed steer hook run %#v", result.Run)
	}
	if result.Run.Error != "steer runtime unavailable" {
		t.Fatalf("expected steer failure reason to be captured, got %#v", result.Run)
	}
}
