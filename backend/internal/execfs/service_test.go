package execfs

import (
	"testing"

	"codex-server/backend/internal/events"
	appRuntime "codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
)

func TestResolveWorkspacePathAcceptsRelativePathInsideRoot(t *testing.T) {
	t.Parallel()

	hub := events.NewHub()
	runtimes := appRuntime.NewManager("codex app-server --listen stdio://", hub)
	runtimes.Configure("ws-1", `E:\projects\ai\codex-server`)

	service := NewService(runtimes, hub, nil)
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

	service := NewService(runtimes, hub, nil)
	if _, err := service.resolveWorkspacePath("ws-1", `..\outside.txt`); err == nil {
		t.Fatal("expected resolveWorkspacePath to reject escaping root")
	}
}

func TestCommandSandboxPolicyDefaultsToDangerFullAccess(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil)
	policy := service.commandSandboxPolicy()

	if got := policy["type"]; got != "dangerFullAccess" {
		t.Fatalf("expected default command sandbox policy, got %#v", got)
	}
}

func TestCommandSandboxPolicyUsesConfiguredRuntimePreference(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		DefaultCommandSandboxPolicy: map[string]any{
			"type":          "externalSandbox",
			"networkAccess": "enabled",
		},
	})

	service := NewService(nil, nil, dataStore)
	policy := service.commandSandboxPolicy()

	if got := policy["type"]; got != "externalSandbox" {
		t.Fatalf("expected configured sandbox policy type, got %#v", got)
	}
	if got := policy["networkAccess"]; got != "enabled" {
		t.Fatalf("expected configured sandbox network access, got %#v", got)
	}
}
