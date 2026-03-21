package threads

import (
	"testing"
	"time"

	"codex-server/backend/internal/bridge"
	"codex-server/backend/internal/runtime"
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

func TestFilterStoredThreadsKeepsCreatedUnmaterializedEntries(t *testing.T) {
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

	if len(items) != 2 {
		t.Fatalf("expected both stored threads to remain, got %+v", items)
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

func TestMapThreadTokenUsageMapsTokenUsagePayload(t *testing.T) {
	t.Parallel()

	usage := mapThreadTokenUsage(map[string]any{
		"last": map[string]any{
			"cachedInputTokens":     10,
			"inputTokens":           120,
			"outputTokens":          30,
			"reasoningOutputTokens": 5,
			"totalTokens":           165,
		},
		"total": map[string]any{
			"cachedInputTokens":     20,
			"inputTokens":           2000,
			"outputTokens":          400,
			"reasoningOutputTokens": 50,
			"totalTokens":           2470,
		},
		"modelContextWindow": 8000,
	})

	if usage == nil {
		t.Fatal("expected token usage to be mapped")
	}
	if usage.Total.TotalTokens != 2470 {
		t.Fatalf("expected total tokens to be mapped, got %d", usage.Total.TotalTokens)
	}
	if usage.ModelContextWindow == nil || *usage.ModelContextWindow != 8000 {
		t.Fatalf("expected model context window to be mapped, got %#v", usage.ModelContextWindow)
	}
}

func TestMapThreadTokenUsageRejectsInvalidPayload(t *testing.T) {
	t.Parallel()

	if usage := mapThreadTokenUsage("invalid"); usage != nil {
		t.Fatalf("expected invalid payload to be ignored, got %#v", usage)
	}
}

func TestApplyStoredProjectionOverlaysProjectedToolCalls(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	dataStore.ApplyThreadEvent(store.EventEnvelope{
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

	detail := applyStoredProjection(store.ThreadDetail{
		Thread: store.Thread{
			ID:          "thread-1",
			WorkspaceID: workspace.ID,
			Name:        "Thread A",
			Status:      "idle",
		},
		Turns: []store.ThreadTurn{},
	}, dataStore, runtime.NewManager("codex app-server --listen stdio://", nil), workspace.ID, "thread-1")

	if len(detail.Turns) != 1 {
		t.Fatalf("expected projected turn to be restored, got %d turns", len(detail.Turns))
	}
	if len(detail.Turns[0].Items) != 1 {
		t.Fatalf("expected projected tool call item to be restored, got %d items", len(detail.Turns[0].Items))
	}
	if got := detail.Turns[0].Items[0]["tool"]; got != "search_query" {
		t.Fatalf("expected projected tool call details to survive refresh, got %#v", got)
	}
}

func TestApplyStoredProjectionExpiresUnavailableServerRequests(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	dataStore.ApplyThreadEvent(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/commandExecution/requestApproval",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"command":  "rm -rf build",
		},
		ServerRequestID: stringPtr("req-1"),
	})

	detail := applyStoredProjection(store.ThreadDetail{
		Thread: store.Thread{
			ID:          "thread-1",
			WorkspaceID: workspace.ID,
			Name:        "Thread A",
			Status:      "idle",
		},
		Turns: []store.ThreadTurn{},
	}, dataStore, runtime.NewManager("codex app-server --listen stdio://", nil), workspace.ID, "thread-1")

	if got := detail.Turns[0].Items[0]["status"]; got != "expired" {
		t.Fatalf("expected unavailable request to be marked expired, got %#v", got)
	}
}

func TestApplyStoredProjectionMergesEquivalentConversationItemsWithDifferentIDs(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)

	dataStore.ApplyThreadEvent(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/started",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":   "item-1",
				"type": "userMessage",
				"content": []any{
					map[string]any{
						"text": "Reply with exactly: hello",
						"type": "text",
					},
				},
			},
		},
	})
	dataStore.ApplyThreadEvent(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-1",
		TurnID:      "turn-1",
		Method:      "item/completed",
		Payload: map[string]any{
			"threadId": "thread-1",
			"turnId":   "turn-1",
			"item": map[string]any{
				"id":    "item-2",
				"type":  "agentMessage",
				"text":  "hello",
				"phase": "final_answer",
			},
		},
	})

	detail := applyStoredProjection(store.ThreadDetail{
		Thread: store.Thread{
			ID:          "thread-1",
			WorkspaceID: workspace.ID,
			Name:        "Thread A",
			Status:      "idle",
		},
		Turns: []store.ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":   "a0e5a61e-1a69-4cf8-b34c-0d3c80d90d3a",
						"type": "userMessage",
						"content": []any{
							map[string]any{
								"text": "Reply with exactly: hello",
								"type": "text",
							},
						},
					},
					{
						"id":   "msg_123",
						"type": "agentMessage",
						"text": "hello",
					},
				},
			},
		},
	}, dataStore, runtime.NewManager("codex app-server --listen stdio://", nil), workspace.ID, "thread-1")

	if len(detail.Turns) != 1 {
		t.Fatalf("expected 1 turn after merge, got %d", len(detail.Turns))
	}
	if len(detail.Turns[0].Items) != 2 {
		t.Fatalf("expected duplicate conversation items to merge, got %d items", len(detail.Turns[0].Items))
	}
	if got := detail.Turns[0].Items[0]["id"]; got != "a0e5a61e-1a69-4cf8-b34c-0d3c80d90d3a" {
		t.Fatalf("expected canonical user item id to be preserved, got %#v", got)
	}
	if got := detail.Turns[0].Items[1]["id"]; got != "msg_123" {
		t.Fatalf("expected canonical agent item id to be preserved, got %#v", got)
	}
	if got := detail.Turns[0].Items[1]["text"]; got != "hello" {
		t.Fatalf("expected canonical agent item text to survive merge, got %#v", got)
	}
}

func stringPtr(value string) *string {
	return &value
}
