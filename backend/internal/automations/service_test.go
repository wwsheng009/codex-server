package automations

import (
	"testing"

	"codex-server/backend/internal/store"
)

func TestCreateRequiresWorkspace(t *testing.T) {
	t.Parallel()

	service := NewService(store.NewMemoryStore())

	_, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Prompt:      "Summarize changes",
		WorkspaceID: "missing",
	})
	if err != store.ErrWorkspaceNotFound {
		t.Fatalf("expected ErrWorkspaceNotFound, got %v", err)
	}
}

func TestListHydratesCurrentWorkspaceName(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Original Workspace", "E:/projects/ai/codex-server")
	service := NewService(dataStore)

	automation, err := service.Create(CreateInput{
		Title:       "Daily Sync",
		Description: "Summary",
		Prompt:      "Summarize changes",
		WorkspaceID: workspace.ID,
		Schedule:    "hourly",
		Model:       "gpt-5.4",
		Reasoning:   "medium",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := dataStore.SetWorkspaceName(workspace.ID, "Renamed Workspace"); err != nil {
		t.Fatalf("SetWorkspaceName() error = %v", err)
	}

	reloaded, err := service.Get(automation.ID)
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}

	if reloaded.WorkspaceName != "Renamed Workspace" {
		t.Fatalf("expected hydrated workspace name, got %q", reloaded.WorkspaceName)
	}
}
