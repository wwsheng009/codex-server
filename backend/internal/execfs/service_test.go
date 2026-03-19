package execfs

import (
	"testing"

	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
)

func TestResolveWorkspacePathAcceptsRelativePathInsideRoot(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	runtimes := appRuntime.NewManager("codex app-server --listen stdio://", hub)
	runtimes.Configure("ws-1", `E:\projects\ai\codex-server`)

	service := NewService(runtimes, hub)
	resolvedPath, err := service.resolveWorkspacePath("ws-1", `backend\main.go`)
	if err != nil {
		t.Fatalf("resolveWorkspacePath() error = %v", err)
	}

	expected := `E:\projects\ai\codex-server\backend\main.go`
	if resolvedPath != expected {
		t.Fatalf("expected %q, got %q", expected, resolvedPath)
	}
}

func TestResolveWorkspacePathRejectsEscapingRoot(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	runtimes := appRuntime.NewManager("codex app-server --listen stdio://", hub)
	runtimes.Configure("ws-1", `E:\projects\ai\codex-server`)

	service := NewService(runtimes, hub)
	if _, err := service.resolveWorkspacePath("ws-1", `..\outside.txt`); err == nil {
		t.Fatal("expected resolveWorkspacePath to reject escaping root")
	}
}
