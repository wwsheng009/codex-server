package threads

import (
	"context"
	"strings"
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
	}, runtimeThreadDefaults{})

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
	}, runtimeThreadDefaults{})

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

func TestBuildThreadStartPayloadAppliesRuntimeDefaults(t *testing.T) {
	t.Parallel()

	payload := buildThreadStartPayload(`E:\projects\ai\codex-server`, CreateInput{
		Name: "New Thread",
	}, runtimeThreadDefaults{
		ApprovalPolicy: "never",
		SandboxMode:    "read-only",
	})

	if payload["approvalPolicy"] != "never" {
		t.Fatalf("expected runtime approval policy, got %#v", payload["approvalPolicy"])
	}
	if payload["sandbox"] != "read-only" {
		t.Fatalf("expected runtime sandbox mode, got %#v", payload["sandbox"])
	}
}

func TestBuildThreadStartPayloadSkipsUnsupportedThreadSandboxOverride(t *testing.T) {
	t.Parallel()

	payload := buildThreadStartPayload(`E:\projects\ai\codex-server`, CreateInput{
		Name: "New Thread",
	}, runtimeThreadDefaults{
		ApprovalPolicy:     "on-request",
		SandboxMode:        "",
		HasSandboxOverride: true,
	})

	if _, ok := payload["sandbox"]; ok {
		t.Fatalf("expected unsupported sandbox override to omit thread/start sandbox, got %#v", payload["sandbox"])
	}
}

func TestShellCommandRejectsEmptyInput(t *testing.T) {
	t.Parallel()

	service := NewService(store.NewMemoryStore(), runtime.NewManager("codex app-server --listen stdio://", nil))
	if err := service.ShellCommand(context.Background(), "ws-1", "thread-1", "   "); err == nil {
		t.Fatal("expected empty shell command to be rejected")
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

func TestSliceThreadDetailTurnsKeepsLatestWindow(t *testing.T) {
	t.Parallel()

	detail := store.ThreadDetail{
		Turns: []store.ThreadTurn{
			{ID: "turn-1"},
			{ID: "turn-2"},
			{ID: "turn-3"},
			{ID: "turn-4"},
		},
	}

	windowed := sliceThreadDetailTurns(detail, 2, "")

	if !windowed.HasMoreTurns {
		t.Fatal("expected latest window to report more turns before the slice")
	}
	if len(windowed.Turns) != 2 {
		t.Fatalf("expected 2 turns in latest window, got %d", len(windowed.Turns))
	}
	if windowed.Turns[0].ID != "turn-3" || windowed.Turns[1].ID != "turn-4" {
		t.Fatalf("unexpected latest turn window: %+v", windowed.Turns)
	}
}

func TestSliceThreadDetailTurnsPaginatesBeforeTurnID(t *testing.T) {
	t.Parallel()

	detail := store.ThreadDetail{
		Turns: []store.ThreadTurn{
			{ID: "turn-1"},
			{ID: "turn-2"},
			{ID: "turn-3"},
			{ID: "turn-4"},
			{ID: "turn-5"},
		},
	}

	windowed := sliceThreadDetailTurns(detail, 2, "turn-4")

	if !windowed.HasMoreTurns {
		t.Fatal("expected older page to report more turns before the slice")
	}
	if len(windowed.Turns) != 2 {
		t.Fatalf("expected 2 turns in older page, got %d", len(windowed.Turns))
	}
	if windowed.Turns[0].ID != "turn-2" || windowed.Turns[1].ID != "turn-3" {
		t.Fatalf("unexpected older turn page: %+v", windowed.Turns)
	}
}

func TestBuildCachedThreadDetailUsesProjectionSnapshot(t *testing.T) {
	t.Parallel()

	thread := store.Thread{
		ID:          "thread-1",
		WorkspaceID: "ws-1",
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        "Cached Thread",
		Status:      "idle",
	}
	contextWindow := int64(128000)
	detail := buildCachedThreadDetail(thread, store.ThreadProjection{
		WorkspaceID: "ws-1",
		ThreadID:    "thread-1",
		Status:      "running",
		UpdatedAt:   time.Unix(42, 0).UTC(),
		TokenUsage: &store.ThreadTokenUsage{
			ModelContextWindow: &contextWindow,
		},
		Turns: []store.ThreadTurn{
			{ID: "turn-1", Status: "completed"},
			{ID: "turn-2", Status: "inProgress"},
		},
	})

	if detail.Status != "running" {
		t.Fatalf("expected projection status to win, got %q", detail.Status)
	}
	if detail.TurnCount != 2 {
		t.Fatalf("expected cached detail turn count, got %d", detail.TurnCount)
	}
	if detail.MessageCount != 0 {
		t.Fatalf("expected cached detail message count, got %d", detail.MessageCount)
	}
	if len(detail.Turns) != 2 || detail.Turns[0].ID != "turn-1" || detail.Turns[1].ID != "turn-2" {
		t.Fatalf("unexpected cached turns: %+v", detail.Turns)
	}
	if detail.TokenUsage == nil || detail.TokenUsage.ModelContextWindow == nil || *detail.TokenUsage.ModelContextWindow != contextWindow {
		t.Fatalf("expected cached token usage to survive, got %#v", detail.TokenUsage)
	}
}

func TestEnrichThreadListCountsUsesProjectionSnapshot(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	service := NewService(dataStore, runtime.NewManager("codex app-server --listen stdio://", nil))

	thread := store.Thread{
		ID:          "thread-1",
		WorkspaceID: workspace.ID,
		Name:        "Thread A",
		Status:      "idle",
	}

	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread:       thread,
		TurnCount:    3,
		MessageCount: 4,
		Turns: []store.ThreadTurn{
			{
				ID: "turn-1",
				Items: []map[string]any{
					{"id": "user-1", "type": "userMessage"},
					{"id": "assistant-1", "type": "agentMessage"},
				},
			},
			{
				ID: "turn-2",
				Items: []map[string]any{
					{"id": "assistant-2", "type": "agentMessage"},
				},
			},
			{
				ID: "turn-3",
				Items: []map[string]any{
					{"id": "user-2", "type": "userMessage"},
					{"id": "tool-1", "type": "dynamicToolCall"},
				},
			},
		},
	})

	items := service.enrichThreadListCounts(workspace.ID, []store.Thread{thread})
	if len(items) != 1 {
		t.Fatalf("expected 1 thread, got %d", len(items))
	}
	if items[0].TurnCount != 3 {
		t.Fatalf("expected list thread turn count 3, got %d", items[0].TurnCount)
	}
	if items[0].MessageCount != 4 {
		t.Fatalf("expected list thread message count 4, got %d", items[0].MessageCount)
	}
}

func TestGetDetailWindowUsesCachedSnapshotWhenRuntimeIsNotLive(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	thread := store.Thread{
		ID:          "thread-cache",
		WorkspaceID: workspace.ID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        "Cached Thread",
		Status:      "idle",
		UpdatedAt:   time.Unix(90, 0).UTC(),
	}
	dataStore.UpsertThread(thread)
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread:    thread,
		Cwd:       thread.Cwd,
		Preview:   "cached preview",
		Path:      `E:\projects\ai\codex-server\.codex\threads\thread-cache.jsonl`,
		Source:    "cache",
		TurnCount: 3,
		Turns: []store.ThreadTurn{
			{ID: "turn-1", Status: "completed"},
			{ID: "turn-2", Status: "completed"},
			{ID: "turn-3", Status: "inProgress"},
		},
	})

	service := NewService(dataStore, runtime.NewManager("codex app-server --listen stdio://", nil))
	detail, err := service.GetDetailWindow(
		context.Background(),
		workspace.ID,
		thread.ID,
		2,
		"",
		threadContentModeFull,
	)
	if err != nil {
		t.Fatalf("GetDetailWindow() error = %v", err)
	}

	if detail.Preview != "cached preview" {
		t.Fatalf("expected cached preview, got %q", detail.Preview)
	}
	if detail.HasMoreTurns != true {
		t.Fatalf("expected cached window to report older turns, got %+v", detail.HasMoreTurns)
	}
	if len(detail.Turns) != 2 || detail.Turns[0].ID != "turn-2" || detail.Turns[1].ID != "turn-3" {
		t.Fatalf("unexpected cached detail turns: %+v", detail.Turns)
	}
}

func TestCachedThreadDetailRejectsIncompleteProjection(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	dataStore.ApplyThreadEvent(store.EventEnvelope{
		WorkspaceID: workspace.ID,
		ThreadID:    "thread-incomplete",
		TurnID:      "turn-1",
		Method:      "item/agentMessage/delta",
		Payload: map[string]any{
			"threadId": "thread-incomplete",
			"turnId":   "turn-1",
			"itemId":   "item-1",
			"delta":    "partial",
		},
	})

	service := NewService(dataStore, runtime.NewManager("codex app-server --listen stdio://", nil))
	if _, ok := service.cachedThreadDetail(workspace.ID, "thread-incomplete"); ok {
		t.Fatal("expected incomplete projection to be rejected as a cache detail source")
	}
}

func TestShouldServeCurrentWindowFromCacheRequiresFreshSnapshot(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	thread := store.Thread{
		ID:          "thread-fresh",
		WorkspaceID: workspace.ID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        "Fresh Thread",
		Status:      "idle",
		UpdatedAt:   time.Unix(100, 0).UTC(),
	}
	dataStore.UpsertThread(thread)
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread:    thread,
		Cwd:       thread.Cwd,
		TurnCount: 1,
		Turns: []store.ThreadTurn{
			{ID: "turn-1", Status: "completed"},
		},
	})

	service := NewService(dataStore, runtime.NewManager("codex app-server --listen stdio://", nil))
	if !service.shouldServeCurrentWindowFromCache(workspace.ID, thread.ID) {
		t.Fatal("expected fresh snapshot to be eligible for current-window cache")
	}

	thread.UpdatedAt = time.Unix(200, 0).UTC()
	dataStore.UpsertThread(thread)
	if service.shouldServeCurrentWindowFromCache(workspace.ID, thread.ID) {
		t.Fatal("expected stale snapshot to be rejected for current-window cache")
	}
}

func TestShouldServeCurrentWindowFromCacheRejectsActiveTurns(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	thread := store.Thread{
		ID:          "thread-active",
		WorkspaceID: workspace.ID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        "Active Thread",
		Status:      "running",
		UpdatedAt:   time.Unix(100, 0).UTC(),
	}
	dataStore.UpsertThread(thread)
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread:    thread,
		Cwd:       thread.Cwd,
		TurnCount: 1,
		Turns: []store.ThreadTurn{
			{ID: "turn-1", Status: "inProgress"},
		},
	})

	runtimeManager := runtime.NewManager("codex app-server --listen stdio://", nil)
	runtimeManager.Configure(workspace.ID, workspace.RootPath)
	runtimeManager.RememberActiveTurn(workspace.ID, thread.ID, "turn-1")

	service := NewService(dataStore, runtimeManager)
	if service.shouldServeCurrentWindowFromCache(workspace.ID, thread.ID) {
		t.Fatal("expected active thread to bypass current-window cache")
	}
}

func TestSummarizeThreadDetailContentTruncatesHeavySystemPayloads(t *testing.T) {
	t.Parallel()

	longOutput := strings.Repeat("output line\n", 4_000)
	longReasoning := strings.Repeat("reasoning-", 600)
	longArgument := strings.Repeat("argument-", 500)
	longMessage := strings.Repeat("message-", 500)

	detail := store.ThreadDetail{
		Thread: store.Thread{
			ID:          "thread-summary",
			WorkspaceID: "ws_1",
			Name:        "Summary Thread",
		},
		Turns: []store.ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":   "user-1",
						"type": "userMessage",
						"content": []any{
							map[string]any{
								"type": "inputText",
								"text": longMessage,
							},
						},
					},
					{
						"id":               "cmd-1",
						"type":             "commandExecution",
						"command":          "npm test",
						"aggregatedOutput": longOutput,
					},
					{
						"id":      "reasoning-1",
						"type":    "reasoning",
						"summary": []any{longReasoning},
						"content": []any{longReasoning},
					},
					{
						"id":        "tool-1",
						"type":      "mcpToolCall",
						"arguments": map[string]any{"query": longArgument},
					},
					{
						"id":   "assistant-1",
						"type": "agentMessage",
						"text": longMessage,
					},
				},
			},
		},
	}

	summarized := summarizeThreadDetailContent(detail)

	userContent, _ := summarized.Turns[0].Items[0]["content"].([]any)
	userEntry, _ := userContent[0].(map[string]any)
	if len(stringValue(userEntry["text"])) >= len(longMessage) {
		t.Fatalf("expected user message content to be truncated, got len=%d", len(stringValue(userEntry["text"])))
	}

	commandOutput := stringValue(summarized.Turns[0].Items[1]["aggregatedOutput"])
	if len(commandOutput) >= len(longOutput) {
		t.Fatalf("expected command output to be truncated, got len=%d", len(commandOutput))
	}
	if len(commandOutput) > threadSummaryCommandOutputPreviewLimit+5 {
		t.Fatalf("expected summarized command preview to stay compact, got len=%d", len(commandOutput))
	}
	if summarized.Turns[0].Items[1]["summaryTruncated"] != true {
		t.Fatalf("expected command item to be marked truncated, got %#v", summarized.Turns[0].Items[1]["summaryTruncated"])
	}
	if got := int64Value(summarized.Turns[0].Items[1]["outputLineCount"]); got != 4000 {
		t.Fatalf("expected full output line count to be preserved, got %d", got)
	}

	reasoningSummary, _ := summarized.Turns[0].Items[2]["summary"].([]any)
	if len(reasoningSummary) != 1 || len(stringValue(reasoningSummary[0])) >= len(longReasoning) {
		t.Fatalf("expected reasoning summary to be truncated, got %#v", reasoningSummary)
	}

	toolArguments, _ := summarized.Turns[0].Items[3]["arguments"].(map[string]any)
	if len(stringValue(toolArguments["query"])) >= len(longArgument) {
		t.Fatalf("expected tool arguments to be truncated, got len=%d", len(stringValue(toolArguments["query"])))
	}

	assistantText := stringValue(summarized.Turns[0].Items[4]["text"])
	if len(assistantText) >= len(longMessage) {
		t.Fatalf("expected assistant message text to be truncated, got len=%d", len(assistantText))
	}
}

func TestGetTurnItemUsesCachedSnapshotAndSupportsSummaryMode(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	thread := store.Thread{
		ID:          "thread-item",
		WorkspaceID: workspace.ID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        "Thread Item",
		Status:      "completed",
		UpdatedAt:   time.Unix(100, 0).UTC(),
	}
	longOutput := strings.Repeat("output line\n", 4_000)
	dataStore.UpsertThread(thread)
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread: thread,
		Turns: []store.ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":               "cmd-1",
						"type":             "commandExecution",
						"command":          "npm test",
						"aggregatedOutput": longOutput,
					},
				},
			},
		},
	})

	service := NewService(dataStore, runtime.NewManager("codex app-server --listen stdio://", nil))

	fullItem, err := service.GetTurnItem(
		context.Background(),
		workspace.ID,
		thread.ID,
		"turn-1",
		"cmd-1",
		threadContentModeFull,
	)
	if err != nil {
		t.Fatalf("GetTurnItem(full) error = %v", err)
	}
	if got := stringValue(fullItem["aggregatedOutput"]); got != longOutput {
		t.Fatalf("expected full item output to be preserved, got len=%d", len(got))
	}

	summaryItem, err := service.GetTurnItem(
		context.Background(),
		workspace.ID,
		thread.ID,
		"turn-1",
		"cmd-1",
		threadContentModeSummary,
	)
	if err != nil {
		t.Fatalf("GetTurnItem(summary) error = %v", err)
	}
	if got := stringValue(summaryItem["aggregatedOutput"]); len(got) >= len(longOutput) {
		t.Fatalf("expected summarized item output to be truncated, got len=%d", len(got))
	}
	if summaryItem["summaryTruncated"] != true {
		t.Fatalf("expected summarized item to be marked truncated, got %#v", summaryItem["summaryTruncated"])
	}
	if got := int64Value(summaryItem["outputLineCount"]); got != 4000 {
		t.Fatalf("expected summarized item line count to be preserved, got %d", got)
	}
}

func TestGetTurnItemOutputUsesCachedSnapshot(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", `E:\projects\ai\codex-server`)
	thread := store.Thread{
		ID:          "thread-item-output",
		WorkspaceID: workspace.ID,
		Cwd:         `E:\projects\ai\codex-server`,
		Name:        "Thread Item Output",
		Status:      "completed",
		UpdatedAt:   time.Unix(100, 0).UTC(),
	}
	longOutput := strings.Repeat("output line\n", 4_000)
	dataStore.UpsertThread(thread)
	dataStore.UpsertThreadProjectionSnapshot(store.ThreadDetail{
		Thread: thread,
		Turns: []store.ThreadTurn{
			{
				ID:     "turn-1",
				Status: "completed",
				Items: []map[string]any{
					{
						"id":               "cmd-1",
						"type":             "commandExecution",
						"command":          "npm test",
						"aggregatedOutput": longOutput,
					},
				},
			},
		},
	})

	service := NewService(dataStore, runtime.NewManager("codex app-server --listen stdio://", nil))

	previewOutput, err := service.GetTurnItemOutput(
		context.Background(),
		workspace.ID,
		thread.ID,
		"turn-1",
		"cmd-1",
		threadContentModeSummary,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("GetTurnItemOutput() error = %v", err)
	}
	if previewOutput.ItemID != "cmd-1" {
		t.Fatalf("expected item id cmd-1, got %q", previewOutput.ItemID)
	}
	if previewOutput.Command != "npm test" {
		t.Fatalf("expected command to be included, got %q", previewOutput.Command)
	}
	if previewOutput.AggregatedOutput == longOutput {
		t.Fatal("expected preview mode to truncate the command output")
	}
	if previewOutput.OutputContentMode != threadContentModeSummary {
		t.Fatalf("expected preview content mode, got %q", previewOutput.OutputContentMode)
	}
	if !previewOutput.OutputTruncated {
		t.Fatal("expected preview output to be marked truncated")
	}
	if previewOutput.OutputLineCount != 4000 {
		t.Fatalf("expected preview output line count 4000, got %d", previewOutput.OutputLineCount)
	}

	tailOutput, err := service.GetTurnItemOutput(
		context.Background(),
		workspace.ID,
		thread.ID,
		"turn-1",
		"cmd-1",
		threadOutputModeTail,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("GetTurnItemOutput(tail) error = %v", err)
	}
	if tailOutput.AggregatedOutput == longOutput {
		t.Fatal("expected tail mode to avoid loading the full command output")
	}
	if tailOutput.OutputContentMode != threadOutputModeTail {
		t.Fatalf("expected tail content mode, got %q", tailOutput.OutputContentMode)
	}
	if !tailOutput.OutputTruncated {
		t.Fatal("expected tail output to be marked truncated")
	}
	if tailOutput.OutputStartLine <= 0 {
		t.Fatalf("expected tail output to include a start line, got %d", tailOutput.OutputStartLine)
	}
	if tailOutput.OutputEndLine != 4000 {
		t.Fatalf("expected tail output end line 4000, got %d", tailOutput.OutputEndLine)
	}
	if tailOutput.OutputStartOffset <= 0 {
		t.Fatalf("expected tail output to include a start offset, got %d", tailOutput.OutputStartOffset)
	}
	if tailOutput.OutputEndOffset != trimOutputLineBreakSuffix(longOutput) {
		t.Fatalf(
			"expected tail output end offset %d, got %d",
			trimOutputLineBreakSuffix(longOutput),
			tailOutput.OutputEndOffset,
		)
	}
	if tailOutput.OutputTotalLength != len(longOutput) {
		t.Fatalf("expected tail output total length %d, got %d", len(longOutput), tailOutput.OutputTotalLength)
	}
	if tailOutput.OutputLineCount != 4000 {
		t.Fatalf("expected tail output line count 4000, got %d", tailOutput.OutputLineCount)
	}

	expandedTailOutput, err := service.GetTurnItemOutput(
		context.Background(),
		workspace.ID,
		thread.ID,
		"turn-1",
		"cmd-1",
		threadOutputModeTail,
		threadExpandedCommandOutputTailLineLimit,
		tailOutput.OutputStartLine,
	)
	if err != nil {
		t.Fatalf("GetTurnItemOutput(expanded tail) error = %v", err)
	}
	if expandedTailOutput.OutputContentMode != threadOutputModeTail {
		t.Fatalf("expected expanded tail content mode, got %q", expandedTailOutput.OutputContentMode)
	}
	if expandedTailOutput.OutputStartLine >= tailOutput.OutputStartLine {
		t.Fatalf("expected expanded tail to move the start line earlier, got %d then %d", tailOutput.OutputStartLine, expandedTailOutput.OutputStartLine)
	}
	if expandedTailOutput.OutputEndLine != tailOutput.OutputStartLine {
		t.Fatalf(
			"expected expanded tail chunk to end where the current tail begins, got %d",
			expandedTailOutput.OutputEndLine,
		)
	}
	if expandedTailOutput.OutputStartOffset >= tailOutput.OutputStartOffset {
		t.Fatalf("expected expanded tail to move the start offset earlier, got %d then %d", tailOutput.OutputStartOffset, expandedTailOutput.OutputStartOffset)
	}
	if len(expandedTailOutput.AggregatedOutput) == 0 {
		t.Fatal("expected expanded tail chunk to contain output")
	}
	if expandedTailOutput.OutputEndOffset != tailOutput.OutputStartOffset {
		t.Fatalf("expected expanded tail chunk to end where the current tail begins, got %d", expandedTailOutput.OutputEndOffset)
	}

	fullOutput, err := service.GetTurnItemOutput(
		context.Background(),
		workspace.ID,
		thread.ID,
		"turn-1",
		"cmd-1",
		threadContentModeFull,
		0,
		0,
	)
	if err != nil {
		t.Fatalf("GetTurnItemOutput(full) error = %v", err)
	}
	if fullOutput.AggregatedOutput != longOutput {
		t.Fatalf("expected full command output, got len=%d", len(fullOutput.AggregatedOutput))
	}
	if fullOutput.OutputContentMode != threadContentModeFull {
		t.Fatalf("expected full content mode, got %q", fullOutput.OutputContentMode)
	}
	if fullOutput.OutputTruncated {
		t.Fatal("expected full output not to be marked truncated")
	}
	if fullOutput.OutputLineCount != 4000 {
		t.Fatalf("expected full output line count 4000, got %d", fullOutput.OutputLineCount)
	}
}

func stringPtr(value string) *string {
	return &value
}
