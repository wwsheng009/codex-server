package hooks

import (
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestServiceListFiltersByRunID(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	firstRun, err := dataStore.UpsertHookRun(store.HookRun{
		ID:          "hook-1",
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		EventName:   eventNameUserPromptSubmit,
		HandlerKey:  handlerKeySecretPrompt,
		Status:      hookStatusCompleted,
		StartedAt:   time.Date(2026, time.April, 11, 1, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("UpsertHookRun(first) error = %v", err)
	}
	if _, err := dataStore.UpsertHookRun(store.HookRun{
		ID:          "hook-2",
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		EventName:   eventNameSessionStart,
		HandlerKey:  handlerKeySessionStartProjectContext,
		Status:      hookStatusCompleted,
		StartedAt:   time.Date(2026, time.April, 11, 1, 1, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("UpsertHookRun(second) error = %v", err)
	}

	service := NewService(dataStore, &fakeTurnExecutor{}, nil)
	runs, err := service.List(workspace.ID, ListOptions{
		ThreadID: "thread-1",
		RunID:    firstRun.ID,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(runs) != 1 {
		t.Fatalf("expected 1 run after run-id filter, got %#v", runs)
	}
	if runs[0].ID != firstRun.ID {
		t.Fatalf("expected run id %q, got %#v", firstRun.ID, runs[0])
	}
}

func TestServiceListCombinesRunIDWithOtherFilters(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	targetRun, err := dataStore.UpsertHookRun(store.HookRun{
		ID:          "hook-1",
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		EventName:   eventNamePreToolUse,
		HandlerKey:  handlerKeyDangerousCommand,
		Status:      hookStatusCompleted,
		StartedAt:   time.Date(2026, time.April, 11, 2, 0, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("UpsertHookRun(target) error = %v", err)
	}
	if _, err := dataStore.UpsertHookRun(store.HookRun{
		ID:          "hook-2",
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		EventName:   eventNamePreToolUse,
		HandlerKey:  handlerKeyProtectedPathWrite,
		Status:      hookStatusCompleted,
		StartedAt:   time.Date(2026, time.April, 11, 2, 1, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("UpsertHookRun(non-target) error = %v", err)
	}

	service := NewService(dataStore, &fakeTurnExecutor{}, nil)

	runs, err := service.List(workspace.ID, ListOptions{
		ThreadID:   "thread-1",
		RunID:      targetRun.ID,
		EventName:  eventNamePreToolUse,
		Status:     hookStatusCompleted,
		HandlerKey: handlerKeyDangerousCommand,
		Limit:      1,
	})
	if err != nil {
		t.Fatalf("List() error = %v", err)
	}

	if len(runs) != 1 {
		t.Fatalf("expected 1 run after combined filters, got %#v", runs)
	}
	if runs[0].ID != targetRun.ID {
		t.Fatalf("expected target run id %q, got %#v", targetRun.ID, runs[0])
	}

	runs, err = service.List(workspace.ID, ListOptions{
		ThreadID:   "thread-1",
		RunID:      targetRun.ID,
		HandlerKey: handlerKeyProtectedPathWrite,
	})
	if err != nil {
		t.Fatalf("List() mismatch error = %v", err)
	}
	if len(runs) != 0 {
		t.Fatalf("expected mismatched handler filter to exclude run, got %#v", runs)
	}
}
