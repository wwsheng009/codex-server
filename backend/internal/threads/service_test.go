package threads

import "testing"

func TestThreadBelongsToWorkspaceNormalizesWindowsPathPrefix(t *testing.T) {
	t.Parallel()

	thread := map[string]any{
		"cwd": `\\?\E:\projects\ai\codex-server`,
	}

	if !threadBelongsToWorkspace(thread, normalizePath(`E:\projects\ai\codex-server`)) {
		t.Fatal("expected thread cwd with \\\\?\\ prefix to match workspace root")
	}
}

func TestThreadBelongsToWorkspaceRejectsOtherRoots(t *testing.T) {
	t.Parallel()

	thread := map[string]any{
		"cwd": `E:\projects\other-repo`,
	}

	if threadBelongsToWorkspace(thread, normalizePath(`E:\projects\ai\codex-server`)) {
		t.Fatal("expected thread from another root to be filtered out")
	}
}

func TestThreadBelongsToWorkspaceAcceptsSubdirectories(t *testing.T) {
	t.Parallel()

	thread := map[string]any{
		"cwd": `E:\projects\ai\codex-server\backend`,
	}

	if !threadBelongsToWorkspace(thread, normalizePath(`E:\projects\ai\codex-server`)) {
		t.Fatal("expected thread in workspace subdirectory to match workspace root")
	}
}
