package workspace

import (
	"context"
	"errors"
	"testing"

	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

func TestRestartRuntimeReconfiguresWorkspaceAfterRestartAttempt(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex-command-that-does-not-exist", nil)
	service := NewService(dataStore, runtimeManager)

	workspace, err := service.Create("Workspace A", "E:/projects/ai/codex-server")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := service.RestartRuntime(context.Background(), workspace.ID); err == nil {
		t.Fatal("expected RestartRuntime() to fail when runtime command is unavailable")
	}

	if _, ok := dataStore.GetWorkspace(workspace.ID); !ok {
		t.Fatal("expected workspace metadata to remain after restart attempt")
	}

	state := runtimeManager.State(workspace.ID)
	if state.RootPath != workspace.RootPath {
		t.Fatalf("expected runtime root path %q, got %q", workspace.RootPath, state.RootPath)
	}
	if state.Status != "error" {
		t.Fatalf("expected runtime status to be error after failed restart, got %q", state.Status)
	}
}

func TestRestartRuntimeReturnsWorkspaceNotFound(t *testing.T) {
	t.Parallel()

	service := NewService(store.NewMemoryStore(), runtime.NewManager("codex-command-that-does-not-exist", nil))

	_, err := service.RestartRuntime(context.Background(), "ws_missing")
	if !errors.Is(err, store.ErrWorkspaceNotFound) {
		t.Fatalf("expected ErrWorkspaceNotFound, got %v", err)
	}
}

func TestRuntimeStateIncludesRecoveryMarkers(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	runtimeManager := runtime.NewManager("codex-command-that-does-not-exist", nil)
	service := NewService(dataStore, runtimeManager)

	workspace, err := service.Create("Workspace A", "E:/projects/ai/codex-server")
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	if _, err := runtimeManager.EnsureStarted(context.Background(), workspace.ID); err == nil {
		t.Fatal("expected EnsureStarted() to fail when runtime command is unavailable")
	}

	state, err := service.RuntimeState(workspace.ID)
	if err != nil {
		t.Fatalf("RuntimeState() error = %v", err)
	}
	if state.LastErrorCategory != "configuration" {
		t.Fatalf("expected configuration error category, got %#v", state)
	}
	if state.LastErrorRecoveryAction != "fix-launch-config" {
		t.Fatalf("expected fix-launch-config recovery action, got %#v", state)
	}
	if state.LastErrorRetryable {
		t.Fatalf("expected missing command not to be retryable, got %#v", state)
	}
	if state.LastErrorRequiresRuntimeRecycle {
		t.Fatalf("expected missing command not to require runtime recycle, got %#v", state)
	}
}
