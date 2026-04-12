package hooks

import (
	"context"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
)

func TestServiceRecordsThreadScopedHTTPMutationRun(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)
	service := NewService(dataStore, &fakeTurnExecutor{}, eventHub)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.Start(ctx)

	eventHub.Publish(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "workspace/httpMutation",
		Payload: map[string]any{
			"requestId":     "req-turn-action-1",
			"scope":         "thread",
			"triggerMethod": "review/start",
			"toolKind":      "reviewStart",
			"toolName":      "review/start",
			"reason":        "review_start_audited",
			"context":       "threadId=thread-1 status=reviewing",
		},
		TS: time.Date(2026, time.April, 11, 3, 0, 0, 0, time.UTC),
	})

	waitFor(t, func() bool {
		runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
		return len(runs) == 1 && runs[0].Status == hookStatusCompleted
	})

	runs := dataStore.ListHookRuns(workspace.ID, "thread-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 thread-scoped HTTP mutation run, got %#v", runs)
	}
	run := runs[0]
	if run.EventName != eventNameHTTPMutation || run.HandlerKey != handlerKeyHTTPMutationAudit {
		t.Fatalf("unexpected HTTP mutation hook run identity %#v", run)
	}
	if run.Scope != "thread" || run.ThreadID != "thread-1" || run.TurnID != "turn-1" {
		t.Fatalf("expected thread scope and ids to be preserved, got %#v", run)
	}
	if run.TriggerMethod != "review/start" || run.ToolName != "review/start" || run.Reason != "review_start_audited" {
		t.Fatalf("unexpected HTTP mutation metadata %#v", run)
	}
}
