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
