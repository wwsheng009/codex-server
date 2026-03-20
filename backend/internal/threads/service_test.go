package threads

import (
	"testing"
	"time"

	"codex-server/backend/internal/bridge"
	"codex-server/backend/internal/store"
)

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

func TestStoredThreadBelongsToWorkspaceRejectsEmptyCwd(t *testing.T) {
	t.Parallel()

	thread := store.Thread{ID: "thread-1", WorkspaceID: "ws-1"}
	if storedThreadBelongsToWorkspace(thread, normalizePath(`E:\projects\ai\codex-server`)) {
		t.Fatal("expected stored thread with empty cwd to be ignored")
	}
}

func TestMapThreadPrefersExplicitName(t *testing.T) {
	t.Parallel()

	thread := mapThread("ws-1", map[string]any{
		"id":        "thread-1",
		"cwd":       `E:\projects\ai\codex-server`,
		"name":      "Named Thread",
		"preview":   "first message",
		"createdAt": int64(1),
		"updatedAt": int64(2),
	}, false)

	if thread.Name != "Named Thread" {
		t.Fatalf("expected explicit thread name, got %q", thread.Name)
	}
	if !thread.CreatedAt.Equal(time.Unix(1, 0).UTC()) {
		t.Fatalf("expected createdAt to be preserved, got %s", thread.CreatedAt)
	}
	if !thread.UpdatedAt.Equal(time.Unix(2, 0).UTC()) {
		t.Fatalf("expected updatedAt to be preserved, got %s", thread.UpdatedAt)
	}
}

func TestMapThreadFallsBackToPreview(t *testing.T) {
	t.Parallel()

	thread := mapThread("ws-1", map[string]any{
		"id":      "thread-1",
		"cwd":     `E:\projects\ai\codex-server`,
		"name":    "   ",
		"preview": "Inspect why thread titles are empty\nsecond line",
	}, false)

	if thread.Name != "Inspect why thread titles are empty" {
		t.Fatalf("expected preview-derived thread name, got %q", thread.Name)
	}
}

func TestMapThreadFallsBackToUntitledWhenNameAndPreviewAreEmpty(t *testing.T) {
	t.Parallel()

	thread := mapThread("ws-1", map[string]any{
		"id":      "thread-1",
		"cwd":     `E:\projects\ai\codex-server`,
		"name":    "   ",
		"preview": "\n  ",
	}, false)

	if thread.Name != "Untitled Thread" {
		t.Fatalf("expected Untitled Thread fallback, got %q", thread.Name)
	}
	if thread.Materialized {
		t.Fatal("expected empty thread to be treated as not materialized")
	}
}

func TestIsThreadTurnsUnavailableBeforeFirstUserMessage(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread 019d0aa6-3c5a-7142-9820-8e8eb7bbbd36 is not materialized yet; includeTurns is unavailable before first user message",
	}

	if !isThreadTurnsUnavailableBeforeFirstUserMessage(err) {
		t.Fatal("expected materialization error to be recognized")
	}
}

func TestIsThreadTurnsUnavailableBeforeFirstUserMessageRejectsOtherErrors(t *testing.T) {
	t.Parallel()

	err := &bridge.RPCError{
		Code:    -32600,
		Message: "thread/read failed",
	}

	if isThreadTurnsUnavailableBeforeFirstUserMessage(err) {
		t.Fatal("expected unrelated error to be ignored")
	}
}

func TestThreadIsMaterializedWhenPreviewExists(t *testing.T) {
	t.Parallel()

	if !threadIsMaterialized(map[string]any{
		"preview": "hello",
	}) {
		t.Fatal("expected preview to imply a materialized thread")
	}
}

func TestFilterStoredThreadsSkipsNonMaterializedEntries(t *testing.T) {
	t.Parallel()

	items := filterStoredThreads([]store.Thread{
		{
			ID:           "thread-1",
			WorkspaceID:  "ws-1",
			Cwd:          `E:\projects\ai\codex-server`,
			Materialized: true,
		},
		{
			ID:           "thread-2",
			WorkspaceID:  "ws-1",
			Cwd:          `E:\projects\ai\codex-server`,
			Materialized: false,
		},
	}, normalizePath(`E:\projects\ai\codex-server`))

	if len(items) != 1 || items[0].ID != "thread-1" {
		t.Fatalf("expected only the materialized thread to remain, got %+v", items)
	}
}

func TestBuildThreadStartPayloadUsesDefaultPermissions(t *testing.T) {
	t.Parallel()

	payload := buildThreadStartPayload(`E:\projects\ai\codex-server`, CreateInput{
		Name: "New Thread",
	})

	if payload["approvalPolicy"] != "on-request" {
		t.Fatalf("expected default approval policy, got %#v", payload["approvalPolicy"])
	}
	if payload["sandbox"] != "workspace-write" {
		t.Fatalf("expected default sandbox, got %#v", payload["sandbox"])
	}
}

func TestBuildThreadStartPayloadUsesFullAccessPreset(t *testing.T) {
	t.Parallel()

	payload := buildThreadStartPayload(`E:\projects\ai\codex-server`, CreateInput{
		Name:             "New Thread",
		Model:            "gpt-5.4",
		PermissionPreset: "full-access",
	})

	if payload["approvalPolicy"] != "never" {
		t.Fatalf("expected full-access approval policy, got %#v", payload["approvalPolicy"])
	}
	if payload["sandbox"] != "danger-full-access" {
		t.Fatalf("expected full-access sandbox, got %#v", payload["sandbox"])
	}
	if payload["model"] != "gpt-5.4" {
		t.Fatalf("expected model override, got %#v", payload["model"])
	}
}
