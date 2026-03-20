package store

import (
	"path/filepath"
	"testing"
)

func TestPersistentStoreRoundTrip(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.UpsertThread(Thread{
		ID:          "thread-1",
		WorkspaceID: workspace.ID,
		Name:        "Thread A",
		Status:      "idle",
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	workspaces := secondStore.ListWorkspaces()
	if len(workspaces) != 1 {
		t.Fatalf("expected 1 workspace after reload, got %d", len(workspaces))
	}

	threads := secondStore.ListThreads(workspace.ID)
	if len(threads) != 1 {
		t.Fatalf("expected 1 thread after reload, got %d", len(threads))
	}

	if threads[0].Name != "Thread A" {
		t.Fatalf("expected persisted thread name, got %q", threads[0].Name)
	}
}

func TestPersistentStoreSeedsWorkspaceIDs(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	firstWorkspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if firstWorkspace.ID == "" {
		t.Fatal("expected first workspace id")
	}

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	secondWorkspace := secondStore.CreateWorkspace("Workspace B", "E:/projects/b")
	if secondWorkspace.ID == firstWorkspace.ID {
		t.Fatalf("expected unique workspace id after reload, got duplicate %q", secondWorkspace.ID)
	}
}

func TestPersistentStorePersistsThreadProjections(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":        "tool-1",
				"type":      "dynamicToolCall",
				"tool":      "search_query",
				"status":    "inProgress",
				"arguments": map[string]any{"q": "codex"},
			},
		},
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, "thread-1")
	if !ok {
		t.Fatal("expected thread projection to persist after reload")
	}
	if len(projection.Turns) != 1 {
		t.Fatalf("expected 1 projected turn, got %d", len(projection.Turns))
	}
	if len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected 1 projected item, got %d", len(projection.Turns[0].Items))
	}
	if got := projection.Turns[0].Items[0]["type"]; got != "dynamicToolCall" {
		t.Fatalf("expected projected tool call item, got %#v", got)
	}
}

func TestThreadProjectionPersistsServerRequests(t *testing.T) {
	t.Parallel()

	storePath := filepath.Join(t.TempDir(), "metadata.json")

	firstStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() error = %v", err)
	}

	workspace := firstStore.CreateWorkspace("Workspace A", "E:/projects/a")
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/commandExecution/requestApproval",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"command":  "rm -rf build",
		},
		ServerRequestID: ptr("req-1"),
	})
	firstStore.ApplyThreadEvent(EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "server/request/resolved",
		Payload: map[string]any{
			"method": "item/commandExecution/requestApproval",
		},
		ServerRequestID: ptr("req-1"),
	})

	secondStore, err := NewPersistentStore(storePath)
	if err != nil {
		t.Fatalf("NewPersistentStore() reload error = %v", err)
	}

	projection, ok := secondStore.GetThreadProjection(workspace.ID, "thread-1")
	if !ok || len(projection.Turns) != 1 || len(projection.Turns[0].Items) != 1 {
		t.Fatalf("expected persisted server request projection, got %#v", projection)
	}
	if got := projection.Turns[0].Items[0]["type"]; got != "serverRequest" {
		t.Fatalf("expected serverRequest item, got %#v", got)
	}
	if got := projection.Turns[0].Items[0]["status"]; got != "resolved" {
		t.Fatalf("expected resolved request status, got %#v", got)
	}
}

func ptr(value string) *string {
	return &value
}
