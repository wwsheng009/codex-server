package api

import (
	"net/http"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestHookRunsRouteSupportsRunIDFilter(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	if _, err := dataStore.UpsertHookRun(store.HookRun{
		ID:          "hook-1",
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		EventName:   "UserPromptSubmit",
		HandlerKey:  "builtin.userpromptsubmit.block-secret-paste",
		Status:      "completed",
		StartedAt:   time.Date(2026, time.April, 11, 4, 0, 0, 0, time.UTC),
	}); err != nil {
		t.Fatalf("UpsertHookRun(first) error = %v", err)
	}
	targetRun, err := dataStore.UpsertHookRun(store.HookRun{
		ID:          "hook-2",
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		EventName:   "HttpMutation",
		HandlerKey:  "builtin.httpmutation.audit-workspace-mutation",
		Status:      "completed",
		StartedAt:   time.Date(2026, time.April, 11, 4, 1, 0, 0, time.UTC),
	})
	if err != nil {
		t.Fatalf("UpsertHookRun(second) error = %v", err)
	}

	router := newTestRouter(dataStore)
	response := performJSONRequest(
		t,
		router,
		http.MethodGet,
		"/api/workspaces/"+workspace.ID+"/hook-runs?threadId=thread-1&runId="+targetRun.ID,
		"",
	)

	if response.Code != http.StatusOK {
		t.Fatalf("expected 200 from hook runs route, got %d", response.Code)
	}

	var payload struct {
		Data []store.HookRun `json:"data"`
	}
	decodeResponseBody(t, response, &payload)

	if len(payload.Data) != 1 {
		t.Fatalf("expected 1 hook run after runId filter, got %#v", payload.Data)
	}
	if payload.Data[0].ID != targetRun.ID {
		t.Fatalf("expected run id %q, got %#v", targetRun.ID, payload.Data[0])
	}
}
