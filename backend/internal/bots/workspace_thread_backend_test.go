package bots

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/hooks"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/threads"
	"codex-server/backend/internal/turns"
)

func TestWorkspaceThreadAIBackendStreamsAgentMessageDeltas(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeStreamingTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 20*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond

	updates := make([]string, 0, 2)
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-1",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		if len(update.Messages) == 0 {
			return nil
		}
		updates = append(updates, update.Messages[len(update.Messages)-1].Text)
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if result.ThreadID != "thread-stream-1" {
		t.Fatalf("expected thread id thread-stream-1, got %q", result.ThreadID)
	}
	if len(result.Messages) != 1 || result.Messages[0].Text != "hello world" {
		t.Fatalf("unexpected final messages %#v", result.Messages)
	}
	if len(updates) == 0 {
		t.Fatal("expected at least one streaming update")
	}
	if updates[len(updates)-1] != "hello world" {
		t.Fatalf("expected last streaming update to be full text, got %#v", updates)
	}
}

func TestWorkspaceThreadAIBackendPassesPermissionPresetToThreadAndTurnRequests(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-permission-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-permission-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn-permission-1",
					Status: "completed",
					Items: []map[string]any{
						{
							"id":   "assistant-1",
							"type": "agentMessage",
							"text": "done",
						},
					},
				},
			},
		},
	}
	turnsExec := &fakeCapturingTurns{
		result: turns.Result{
			TurnID: "turn-permission-1",
			Status: "running",
		},
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, nil, 5*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.turnSettleDelay = time.Millisecond

	ctx := withBotDebugTrace(context.Background(), "bot-conn-1", "delivery-1")
	result, err := backend.ProcessMessage(ctx, store.BotConnection{
		ID:          "bot-conn-1",
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
		AIConfig: map[string]string{
			"model":              "gpt-5.4",
			"permission_preset":  "full-access",
			"reasoning_effort":   "high",
			"collaboration_mode": "plan",
		},
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-1",
		Text:           "hello",
	})
	if err != nil {
		t.Fatalf("ProcessMessage() error = %v", err)
	}

	if result.ThreadID != "thread-permission-1" {
		t.Fatalf("expected thread id thread-permission-1, got %q", result.ThreadID)
	}
	if len(result.Messages) != 1 || result.Messages[0].Text != "done" {
		t.Fatalf("unexpected final messages %#v", result.Messages)
	}
	if threadsExec.lastCreateInput.PermissionPreset != "full-access" {
		t.Fatalf("expected thread create permission preset full-access, got %#v", threadsExec.lastCreateInput.PermissionPreset)
	}
	if turnsExec.lastOptions.PermissionPreset != "full-access" {
		t.Fatalf("expected turn start permission preset full-access, got %#v", turnsExec.lastOptions.PermissionPreset)
	}
	if turnsExec.lastOptions.ReasoningEffort != "high" {
		t.Fatalf("expected turn start reasoning effort high, got %#v", turnsExec.lastOptions.ReasoningEffort)
	}
	if turnsExec.lastOptions.CollaborationMode != "plan" {
		t.Fatalf("expected turn start collaboration mode plan, got %#v", turnsExec.lastOptions.CollaborationMode)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.Source != "bot" {
		t.Fatalf("expected bot metadata source, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.Source)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.Origin != "codex-server-web" {
		t.Fatalf("expected codex-server-web metadata origin, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.Origin)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.WorkspaceID != "ws_123" {
		t.Fatalf("expected bot metadata workspace id ws_123, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.WorkspaceID)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.ThreadID != "thread-permission-1" {
		t.Fatalf("expected bot metadata thread id thread-permission-1, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.ThreadID)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.BotConnectionID != "bot-conn-1" {
		t.Fatalf("expected bot metadata connection id bot-conn-1, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.BotConnectionID)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.BotDeliveryID != "delivery-1" {
		t.Fatalf("expected bot metadata delivery id delivery-1, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.BotDeliveryID)
	}
	if turnsExec.lastOptions.ResponsesAPIClientMetadata.ServerTraceID != "delivery-1" {
		t.Fatalf("expected bot metadata server trace id delivery-1, got %#v", turnsExec.lastOptions.ResponsesAPIClientMetadata.ServerTraceID)
	}
}

func TestWorkspaceThreadAIBackendUsesClearSessionStartSourceAfterConversationClear(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-clear-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-clear-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{
				{
					ID:     "turn-clear-1",
					Status: "completed",
					Items: []map[string]any{
						{
							"id":   "assistant-1",
							"type": "agentMessage",
							"text": "done",
						},
					},
				},
			},
		},
	}
	turnsExec := &fakeCapturingTurns{
		result: turns.Result{
			TurnID: "turn-clear-1",
			Status: "running",
		},
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, nil, 5*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.turnSettleDelay = time.Millisecond

	result, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
		AIConfig: map[string]string{
			"model":             "gpt-5.4",
			"permission_preset": "full-access",
		},
	}, store.BotConversation{
		BackendState: conversationBackendStateWithPendingSessionStartSource(
			nil,
			threads.ThreadStartSourceClear,
		),
	}, InboundMessage{
		ConversationID: "chat-1",
		Text:           "hello",
	})
	if err != nil {
		t.Fatalf("ProcessMessage() error = %v", err)
	}

	if result.ThreadID != "thread-clear-1" {
		t.Fatalf("expected thread id thread-clear-1, got %q", result.ThreadID)
	}
	if got := threadsExec.lastCreateInput.SessionStartSource; got != threads.ThreadStartSourceClear {
		t.Fatalf("expected thread create session start source clear, got %#v", got)
	}
}

func TestWorkspaceThreadAIBackendBlocksSecretLikeInboundBeforeStartingTurn(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/ai/codex-server")
	eventHub := events.NewHub()
	eventHub.AttachStore(dataStore)

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-governed-bot-1",
			WorkspaceID: workspace.ID,
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-governed-bot-1",
				WorkspaceID: workspace.ID,
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	rawTurns := &fakeCountingTurns{}
	hookService := hooks.NewService(dataStore, rawTurns, eventHub)
	governedTurnStarter := hooks.NewGovernedTurnStarter(hookService, "bot/webhook", "thread")

	backend := newWorkspaceThreadAIBackend(
		threadsExec,
		governedTurnStarter,
		nil,
		5*time.Millisecond,
		time.Second,
	).(*workspaceThreadAIBackend)

	_, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		WorkspaceID: workspace.ID,
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-1",
		Text:           "请直接使用这个 key: sk-proj-abcDEF1234567890xyzUVW9876543210",
	})
	var blockedErr *hooks.GovernedTurnBlockedError
	if !errors.As(err, &blockedErr) {
		t.Fatalf("expected governed turn start block error, got %v", err)
	}
	if rawTurns.calls != 0 {
		t.Fatalf("expected blocked bot inbound prompt to skip turns.Start, got %d calls", rawTurns.calls)
	}

	runs := dataStore.ListHookRuns(workspace.ID, "thread-governed-bot-1")
	if len(runs) != 1 {
		t.Fatalf("expected 1 hook run, got %#v", runs)
	}
	if runs[0].EventName != "UserPromptSubmit" || runs[0].TriggerMethod != "bot/webhook" || runs[0].Scope != "thread" {
		t.Fatalf("expected bot webhook to record governed user prompt hook metadata, got %#v", runs[0])
	}
}

func TestCollectBotVisibleMessagesIncludesNonAgentOutputs(t *testing.T) {
	t.Parallel()

	messages := collectBotVisibleMessages(store.ThreadTurn{
		ID:     "turn-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":   "plan-1",
				"type": "plan",
				"text": "1. Inspect logs\n2. Fix delivery path",
			},
			{
				"id":               "command-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"aggregatedOutput": "ok  codex-server/backend/internal/bots",
			},
			{
				"id":   "files-1",
				"type": "fileChange",
				"changes": []any{
					map[string]any{
						"path": "backend/internal/bots/service.go",
						"kind": map[string]any{"type": "update"},
					},
					map[string]any{
						"path": "backend/internal/bots/telegram.go",
						"kind": map[string]any{"type": "update"},
					},
				},
			},
			{
				"id":     "tool-1",
				"type":   "dynamicToolCall",
				"tool":   "search_query",
				"status": "completed",
			},
			{
				"id":          "request-1",
				"type":        "serverRequest",
				"requestId":   "req_123",
				"requestKind": "item/tool/requestUserInput",
				"status":      "pending",
				"details": map[string]any{
					"questions": []any{map[string]any{"id": "q1"}, map[string]any{"id": "q2"}},
				},
			},
			{
				"id":   "assistant-1",
				"type": "agentMessage",
				"text": "Fixed the bot delivery path.",
			},
		},
	})

	if len(messages) != 6 {
		t.Fatalf("expected 6 bot-visible messages, got %#v", messages)
	}
	if messages[0].Text != "Plan:\n1. Inspect logs\n2. Fix delivery path" {
		t.Fatalf("unexpected plan message %#v", messages[0])
	}
	if messages[1].Text != "Command: go test ./...\nOutput: ok  codex-server/backend/internal/bots" {
		t.Fatalf("unexpected commandExecution message %#v", messages[1])
	}
	if messages[2].Text != "Files (2):\n- backend/internal/bots/service.go (Update)\n- backend/internal/bots/telegram.go (Update)" {
		t.Fatalf("unexpected fileChange message %#v", messages[2])
	}
	if messages[3].Text != "Tool Call: search_query · Completed" {
		t.Fatalf("unexpected toolCall message %#v", messages[3])
	}
	if messages[4].Text != "User Input Request: 2 questions waiting for input [Pending]\nRequest ID: req_123\nReply with /answer req_123 q1=...; q2=...\nReply with /decline req_123\nReply with /cancel req_123" {
		t.Fatalf("unexpected serverRequest message %#v", messages[4])
	}
	if messages[5].Text != "Fixed the bot delivery path." {
		t.Fatalf("unexpected agent message %#v", messages[5])
	}
}

func TestCollectBotVisibleMessagesIncludesUnknownTextItems(t *testing.T) {
	t.Parallel()

	messages := collectBotVisibleMessages(store.ThreadTurn{
		ID:     "turn-unknown-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":      "custom-1",
				"type":    "customStatus",
				"message": "Rendered in the web UI and should reach the bot.",
			},
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected 1 bot-visible message, got %#v", messages)
	}
	if messages[0].Text != "Rendered in the web UI and should reach the bot." {
		t.Fatalf("unexpected unknown item message %#v", messages[0])
	}
}

func TestCollectBotVisibleMessagesFormatsHookRunsWithoutPrecomputedMessage(t *testing.T) {
	t.Parallel()

	messages := collectBotVisibleMessages(store.ThreadTurn{
		ID:     "turn-hook-run-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":         "hook-run-1",
				"type":       "hookRun",
				"eventName":  "PostToolUse",
				"handlerKey": "builtin.turnpolicy.post-tool-use",
				"status":     "completed",
				"decision":   "continueTurn",
				"reason":     "validation_command_failed",
			},
		},
	})

	if len(messages) != 1 {
		t.Fatalf("expected 1 hook run message, got %#v", messages)
	}

	expected := strings.Join([]string{
		"Event: Post-Tool Use",
		"Handler: Builtin / Turnpolicy / Post Tool Use",
		"Status: Completed",
		"Decision: Continue Turn",
		"Reason: Validation command failed",
	}, "\n")
	if messages[0].Text != expected {
		t.Fatalf("unexpected hook run message %#v", messages[0])
	}
}

func TestCollectBotVisibleMessagesRespectsCommandOutputMode(t *testing.T) {
	t.Parallel()

	messages := collectBotVisibleMessagesWithConfig(store.ThreadTurn{
		ID:     "turn-command-mode-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":               "command-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "completed",
				"aggregatedOutput": "line-1\nline-2\nline-3\nline-4",
			},
		},
	}, botTranscriptRenderConfig{
		CommandOutputMode: botCommandOutputModeSingleLine,
	})

	if len(messages) != 1 {
		t.Fatalf("expected 1 bot-visible message, got %#v", messages)
	}
	if messages[0].Text != "Command: go test ./... [Completed] · 4 output lines" {
		t.Fatalf("unexpected command summary %#v", messages[0])
	}
}

func TestCollectBotVisibleMessagesOmitsCommandsWhenCommandOutputModeIsNone(t *testing.T) {
	t.Parallel()

	messages := collectBotVisibleMessagesWithConfig(store.ThreadTurn{
		ID:     "turn-command-mode-none-1",
		Status: "completed",
		Items: []map[string]any{
			{
				"id":               "command-1",
				"type":             "commandExecution",
				"command":          "go test ./...",
				"status":           "completed",
				"aggregatedOutput": "line-1\nline-2",
			},
		},
	}, botTranscriptRenderConfig{
		CommandOutputMode: botCommandOutputModeNone,
	})

	if len(messages) != 0 {
		t.Fatalf("expected command item to be omitted when mode is none, got %#v", messages)
	}
}

func TestBotVisibleItemStreamBuildsSnapshotFromMixedOutputs(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{}
	stream.AddTextDelta("plan-1", "plan", "Inspect logs")
	stream.AddReasoningDelta("reasoning-1", "summary", 0, "Investigating delivery gap")
	stream.AddOutputDelta("command-1", "partial output")
	stream.MergeItem(map[string]any{
		"id":      "command-1",
		"type":    "commandExecution",
		"command": "go test ./...",
	})
	stream.AddTextDelta("assistant-1", "agentMessage", "Reply sent.")

	updates := make([][]OutboundMessage, 0, 1)
	if err := stream.Flush(context.Background(), func(_ context.Context, update StreamingUpdate) error {
		updates = append(updates, cloneOutboundMessages(update.Messages))
		return nil
	}); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	if len(updates) != 1 {
		t.Fatalf("expected 1 snapshot update, got %#v", updates)
	}
	expected := []OutboundMessage{
		{Text: "Plan:\n1. Inspect logs"},
		{Text: "Command: go test ./...\nOutput: partial output"},
		{Text: "Reply sent."},
	}
	if !equalOutboundMessages(updates[0], expected) {
		t.Fatalf("unexpected mixed snapshot %#v", updates[0])
	}
}

func TestBotVisibleItemStreamUsesConfiguredCommandOutputMode(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{
		renderConfig: botTranscriptRenderConfig{
			CommandOutputMode: botCommandOutputModeSingleLine,
		},
	}
	stream.AddOutputDelta("command-1", "line-1\nline-2")
	stream.MergeItem(map[string]any{
		"id":      "command-1",
		"type":    "commandExecution",
		"command": "go test ./...",
		"status":  "completed",
	})

	updates := make([][]OutboundMessage, 0, 1)
	if err := stream.Flush(context.Background(), func(_ context.Context, update StreamingUpdate) error {
		updates = append(updates, cloneOutboundMessages(update.Messages))
		return nil
	}); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	expected := []OutboundMessage{
		{Text: "Command: go test ./... [Completed] · 2 output lines"},
	}
	if len(updates) != 1 || !equalOutboundMessages(updates[0], expected) {
		t.Fatalf("unexpected single-line stream snapshot %#v", updates)
	}
}

func TestBotVisibleItemStreamOmitsCommandItemsWhenConfiguredToNone(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{
		renderConfig: botTranscriptRenderConfig{
			CommandOutputMode: botCommandOutputModeNone,
		},
	}
	stream.AddOutputDelta("command-1", "line-1\nline-2")
	stream.MergeItem(map[string]any{
		"id":      "command-1",
		"type":    "commandExecution",
		"command": "go test ./...",
		"status":  "completed",
	})
	stream.AddTextDelta("assistant-1", "agentMessage", "done")

	updates := make([][]OutboundMessage, 0, 1)
	if err := stream.Flush(context.Background(), func(_ context.Context, update StreamingUpdate) error {
		updates = append(updates, cloneOutboundMessages(update.Messages))
		return nil
	}); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	expected := []OutboundMessage{
		{Text: "done"},
	}
	if len(updates) != 1 || !equalOutboundMessages(updates[0], expected) {
		t.Fatalf("unexpected stream snapshot when command mode is none %#v", updates)
	}
}

func TestBotVisibleItemStreamCapturesUnknownCompletedItems(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{}
	stream.MergeItem(map[string]any{
		"id":      "custom-1",
		"type":    "customStatus",
		"message": "Unknown item types should still reach the bot.",
	})

	updates := make([][]OutboundMessage, 0, 1)
	if err := stream.Flush(context.Background(), func(_ context.Context, update StreamingUpdate) error {
		updates = append(updates, cloneOutboundMessages(update.Messages))
		return nil
	}); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	if len(updates) != 1 {
		t.Fatalf("expected 1 snapshot update, got %#v", updates)
	}
	if len(updates[0]) != 1 || updates[0][0].Text != "Unknown item types should still reach the bot." {
		t.Fatalf("unexpected unknown-item snapshot %#v", updates)
	}
}

func TestBotVisibleItemStreamCapturesServerRequestEvents(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{}
	requestID := "req_123"
	stream.ApplyServerRequestEvent(store.EventEnvelope{
		Method:          "item/tool/requestUserInput",
		ServerRequestID: &requestID,
		Payload: map[string]any{
			"questions": []any{map[string]any{"id": "q1"}},
		},
	})

	updates := make([][]OutboundMessage, 0, 1)
	if err := stream.Flush(context.Background(), func(_ context.Context, update StreamingUpdate) error {
		updates = append(updates, cloneOutboundMessages(update.Messages))
		return nil
	}); err != nil {
		t.Fatalf("Flush() error = %v", err)
	}

	if len(updates) != 1 {
		t.Fatalf("expected 1 server request snapshot, got %#v", updates)
	}
	if len(updates[0]) != 1 || updates[0][0].Text != "User Input Request: 1 question waiting for input [Pending]\nRequest ID: req_123\nReply with /answer req_123 <text>\nReply with /decline req_123\nReply with /cancel req_123" {
		t.Fatalf("unexpected server request snapshot %#v", updates[0])
	}
}

func TestBotVisibleItemStreamMergeCompletedTurnItemsPrefersCompletedMessageText(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{}
	stream.AddTextDelta("assistant-1", "agentMessage", "hello")

	merged := stream.mergeCompletedTurnItems([]map[string]any{
		{
			"id":   "assistant-1",
			"type": "agentMessage",
			"text": "hello world",
		},
	})

	if len(merged) != 1 {
		t.Fatalf("expected 1 merged item, got %#v", merged)
	}
	if stringValue(merged[0]["text"]) != "hello world" {
		t.Fatalf("expected completed turn text to win over partial stream text, got %#v", merged[0])
	}
}

func TestBotVisibleItemStreamMergeCompletedTurnItemsKeepsCompletedTextEvenIfStreamIsLonger(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{}
	stream.AddTextDelta("assistant-1", "agentMessage", "hello world from stale stream")

	merged := stream.mergeCompletedTurnItems([]map[string]any{
		{
			"id":   "assistant-1",
			"type": "agentMessage",
			"text": "hello world",
		},
	})

	if len(merged) != 1 {
		t.Fatalf("expected 1 merged item, got %#v", merged)
	}
	if stringValue(merged[0]["text"]) != "hello world" {
		t.Fatalf("expected completed turn text to remain authoritative, got %#v", merged[0])
	}
}

func TestBotVisibleItemStreamMergeCompletedTurnItemsPreservesCompletedServerRequestStatus(t *testing.T) {
	t.Parallel()

	stream := botVisibleItemStream{}
	requestID := "req_merge_1"
	stream.ApplyServerRequestEvent(store.EventEnvelope{
		Method:          "item/tool/requestUserInput",
		ServerRequestID: &requestID,
		Payload: map[string]any{
			"questions": []any{map[string]any{"id": "q1"}},
		},
	})

	merged := stream.mergeCompletedTurnItems([]map[string]any{
		{
			"id":          "server-request-" + requestID,
			"type":        "serverRequest",
			"requestId":   requestID,
			"requestKind": "item/tool/requestUserInput",
			"status":      "resolved",
			"details": map[string]any{
				"questions": []any{map[string]any{"id": "q1"}},
			},
		},
	})

	if len(merged) != 1 {
		t.Fatalf("expected 1 merged server request item, got %#v", merged)
	}
	if stringValue(merged[0]["status"]) != "resolved" {
		t.Fatalf("expected completed server request status to be preserved, got %#v", merged[0])
	}
}

func TestRenderBotServerRequestItemMarksAuthRefreshAsWorkspaceOnly(t *testing.T) {
	t.Parallel()

	text := renderBotVisibleItem(map[string]any{
		"id":          "server-request-auth-1",
		"type":        "serverRequest",
		"requestId":   "req_auth_1",
		"requestKind": "account/chatgptAuthTokens/refresh",
		"status":      "pending",
		"details": map[string]any{
			"reason": "Refresh ChatGPT auth tokens",
		},
	})

	if !strings.Contains(text, "Auth Refresh Request: Refresh ChatGPT auth tokens [Pending]") {
		t.Fatalf("expected auth refresh summary, got %q", text)
	}
	if !strings.Contains(text, "Request ID: req_auth_1") {
		t.Fatalf("expected auth refresh request id, got %q", text)
	}
	if !strings.Contains(text, "workspace UI instead") {
		t.Fatalf("expected workspace-only hint, got %q", text)
	}
	if strings.Contains(text, "/approve req_auth_1") {
		t.Fatalf("did not expect Telegram approval command for auth refresh, got %q", text)
	}
}

func TestWorkspaceThreadAIBackendWaitsForLateServerRequestResolution(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-2",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-2",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeLateServerRequestTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 40 * time.Millisecond

	snapshots := make([][]OutboundMessage, 0, 4)
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-2",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		snapshots = append(snapshots, cloneOutboundMessages(update.Messages))
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 2 {
		t.Fatalf("expected 2 final messages, got %#v", result.Messages)
	}
	if result.Messages[0].Text != "hello world" {
		t.Fatalf("unexpected final agent message %#v", result.Messages[0])
	}
	if result.Messages[1].Text != "User Input Request: 1 question waiting for input [Resolved]" {
		t.Fatalf("unexpected resolved server request message %#v", result.Messages[1])
	}

	foundResolvedSnapshot := false
	for _, snapshot := range snapshots {
		for _, message := range snapshot {
			if message.Text == "User Input Request: 1 question waiting for input [Resolved]" {
				foundResolvedSnapshot = true
				break
			}
		}
	}
	if !foundResolvedSnapshot {
		t.Fatalf("expected a streaming snapshot with the resolved server request, got %#v", snapshots)
	}
}

func TestWorkspaceThreadAIBackendPreservesCommandOrderAfterTurnCompletion(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-3",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-3",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeCommandThenAgentTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 40 * time.Millisecond

	snapshots := make([][]OutboundMessage, 0, 4)
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-3",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		snapshots = append(snapshots, cloneOutboundMessages(update.Messages))
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 2 {
		t.Fatalf("expected 2 final messages, got %#v", result.Messages)
	}
	if result.Messages[0].Text != "Command: go test ./... [Completed]\nOutput: ok" {
		t.Fatalf("expected command output to stay first, got %#v", result.Messages)
	}
	if result.Messages[1].Text != "done" {
		t.Fatalf("expected agent message to stay second, got %#v", result.Messages)
	}

	foundOrderedSnapshot := false
	for _, snapshot := range snapshots {
		if len(snapshot) < 2 {
			continue
		}
		if snapshot[0].Text == "Command: go test ./... [Completed]\nOutput: ok" && snapshot[1].Text == "done" {
			foundOrderedSnapshot = true
			break
		}
	}
	if !foundOrderedSnapshot {
		t.Fatalf("expected streaming snapshots to preserve command-before-agent order, got %#v", snapshots)
	}
}

func TestWorkspaceThreadAIBackendUsesStreamSnapshotWhenCompletedTurnLags(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-4",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-4",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeLaggingCompletedTurnTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 40 * time.Millisecond

	snapshots := make([][]OutboundMessage, 0, 2)
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-4",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		snapshots = append(snapshots, cloneOutboundMessages(update.Messages))
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 1 || result.Messages[0].Text != "hello world" {
		t.Fatalf("expected final messages to fall back to streamed snapshot, got %#v", result.Messages)
	}

	foundSnapshot := false
	for _, snapshot := range snapshots {
		if len(snapshot) == 1 && snapshot[0].Text == "hello world" {
			foundSnapshot = true
			break
		}
	}
	if !foundSnapshot {
		t.Fatalf("expected streamed snapshot with agent reply, got %#v", snapshots)
	}
}

func TestWorkspaceThreadAIBackendPrefersCompletedTurnContentOverPartialStreamSnapshot(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-4b",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-4b",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeCompletedTurnWinsOverPartialStreamTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 20 * time.Millisecond

	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-4b",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 1 || result.Messages[0].Text != "hello world" {
		t.Fatalf("expected completed turn content to win over partial stream snapshot, got %#v", result.Messages)
	}
}

func TestWorkspaceThreadAIBackendWaitsWhenTurnSnapshotLagsTerminalEvent(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-4c",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-4c",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeDelayedCompletedTurnSnapshotTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 20 * time.Millisecond

	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-4c",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 1 || result.Messages[0].Text != "hello world" {
		t.Fatalf("expected backend to wait until the completed turn snapshot is available, got %#v", result.Messages)
	}
}

func TestWorkspaceThreadAIBackendKeepsWaitingWhenStreamingDeliveryFails(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-5",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-5",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeStreamingTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 40 * time.Millisecond

	updateAttempts := 0
	snapshots := make([][]OutboundMessage, 0, 2)
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-5",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		updateAttempts += 1
		if updateAttempts == 1 {
			return errors.New("telegram edit failed")
		}
		snapshots = append(snapshots, cloneOutboundMessages(update.Messages))
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 1 || result.Messages[0].Text != "hello world" {
		t.Fatalf("expected final messages despite streaming delivery failure, got %#v", result.Messages)
	}
	if updateAttempts < 2 {
		t.Fatalf("expected streaming delivery to continue after the first failure, got %d attempts", updateAttempts)
	}

	foundSnapshot := false
	for _, snapshot := range snapshots {
		if len(snapshot) == 1 && snapshot[0].Text == "hello world" {
			foundSnapshot = true
			break
		}
	}
	if !foundSnapshot {
		t.Fatalf("expected a later streaming snapshot after the initial delivery failure, got %#v", snapshots)
	}
}

func TestWorkspaceThreadAIBackendRecoversStreamingContentAfterEventSubscriptionOverflow(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-overflow-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-overflow-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeOverflowThenSnapshotTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 20 * time.Millisecond

	snapshots := make([][]OutboundMessage, 0, 4)
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-stream-overflow-1",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		if len(update.Messages) == 0 {
			return nil
		}
		snapshots = append(snapshots, cloneOutboundMessages(update.Messages))
		if len(snapshots) == 1 {
			time.Sleep(80 * time.Millisecond)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 1 || result.Messages[0].Text != "hello world overflow recovered" {
		t.Fatalf("expected final messages to recover from overflowed subscription, got %#v", result.Messages)
	}

	foundRecoveredSnapshot := false
	for _, snapshot := range snapshots {
		if len(snapshot) == 1 && snapshot[0].Text == "hello world overflow recovered" {
			foundRecoveredSnapshot = true
			break
		}
	}
	if !foundRecoveredSnapshot {
		t.Fatalf("expected a later streaming snapshot to recover after overflow, got %#v", snapshots)
	}
}

func TestWorkspaceThreadAIBackendRecoversAfterOverflowBeforeTerminalSnapshotSettles(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-stream-overflow-2",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-stream-overflow-2",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeOverflowBeforeCompletionTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, time.Second, 2*time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 20 * time.Millisecond

	startedAt := time.Now()
	result, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-stream-overflow-2",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		if len(update.Messages) == 0 {
			return nil
		}
		time.Sleep(80 * time.Millisecond)
		return nil
	})
	if err != nil {
		t.Fatalf("ProcessMessageStream() error = %v", err)
	}

	if len(result.Messages) != 1 || result.Messages[0].Text != "hello recovered before poll timeout" {
		t.Fatalf("expected fast snapshot recovery after overflow, got %#v", result.Messages)
	}
	if elapsed := time.Since(startedAt); elapsed >= 900*time.Millisecond {
		t.Fatalf("expected recovery before fallback poll interval, got %s", elapsed)
	}

	detailCalls, turnCalls := threadsExec.callCounts()
	if detailCalls != 0 {
		t.Fatalf("expected streaming recovery to avoid fresh detail lookups, got %d", detailCalls)
	}
	if turnCalls == 0 {
		t.Fatal("expected streaming recovery to use single-turn snapshots")
	}
}

func TestWorkspaceThreadAIBackendTreatsInterruptedTurnAsTerminal(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-terminal-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-terminal-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	turnsExec := &fakeTerminalTurns{
		threads: threadsExec,
		turn: store.ThreadTurn{
			ID:     "turn-terminal-1",
			Status: "interrupted",
		},
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, nil, 10*time.Millisecond, 200*time.Millisecond).(*workspaceThreadAIBackend)
	backend.turnSettleDelay = 20 * time.Millisecond
	_, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-terminal-1",
		Text:           "hello",
	})
	if err == nil {
		t.Fatal("expected interrupted terminal turn to fail fast")
	}
	var turnErr *workspaceTurnTerminalError
	if !errors.As(err, &turnErr) {
		t.Fatalf("expected workspaceTurnTerminalError, got %T (%v)", err, err)
	}
	if turnErr.Status != "interrupted" {
		t.Fatalf("expected interrupted status in typed error, got %#v", turnErr)
	}
	if strings.Contains(strings.ToLower(err.Error()), "deadline") {
		t.Fatalf("expected interrupted status instead of timeout, got %v", err)
	}
	if !strings.Contains(err.Error(), "interrupted") {
		t.Fatalf("expected interrupted status in error, got %v", err)
	}
}

func TestNewWorkspaceThreadAIBackendDefaultsToNoTurnTimeout(t *testing.T) {
	t.Parallel()

	backend := newWorkspaceThreadAIBackend(nil, nil, nil, 0, 0).(*workspaceThreadAIBackend)
	if backend.turnTimeout != 0 {
		t.Fatalf("expected no default turn timeout, got %v", backend.turnTimeout)
	}
	if backend.pollInterval != defaultThreadPollInterval {
		t.Fatalf("expected default poll interval %v, got %v", defaultThreadPollInterval, backend.pollInterval)
	}
}

func TestWorkspaceThreadAIBackendTreatsFailedStreamingTurnAsTerminal(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-terminal-2",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-terminal-2",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeTerminalStreamingTurns{
		hub:     hub,
		threads: threadsExec,
		turn: store.ThreadTurn{
			ID:     "turn-terminal-2",
			Status: "failed",
			Error: map[string]any{
				"message": "permission denied",
			},
		},
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, 200*time.Millisecond).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 10 * time.Millisecond
	backend.turnSettleDelay = 20 * time.Millisecond

	_, err := backend.ProcessMessageStream(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-terminal-2",
		Text:           "hello",
	}, func(_ context.Context, update StreamingUpdate) error {
		return nil
	})
	if err == nil {
		t.Fatal("expected failed terminal streaming turn to return an error")
	}
	var turnErr *workspaceTurnTerminalError
	if !errors.As(err, &turnErr) {
		t.Fatalf("expected workspaceTurnTerminalError, got %T (%v)", err, err)
	}
	if turnErr.Status != "failed" {
		t.Fatalf("expected failed status in typed error, got %#v", turnErr)
	}
	if strings.Contains(strings.ToLower(err.Error()), "deadline") {
		t.Fatalf("expected failed status instead of timeout, got %v", err)
	}
	if !strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("expected failed turn error message, got %v", err)
	}
}

func TestWorkspaceThreadAIBackendReturnsTypedNoReplyError(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-terminal-3",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-terminal-3",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	turnsExec := &fakeTerminalTurns{
		threads: threadsExec,
		turn: store.ThreadTurn{
			ID:     "turn-terminal-3",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "reasoning-1",
					"type": "reasoning",
					"text": "internal trace only",
				},
			},
		},
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, nil, 10*time.Millisecond, 200*time.Millisecond).(*workspaceThreadAIBackend)
	backend.turnSettleDelay = 20 * time.Millisecond

	_, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-terminal-3",
		Text:           "hello",
	})
	if err == nil {
		t.Fatal("expected completed turn without visible reply to return an error")
	}
	var noReplyErr *botVisibleReplyMissingError
	if !errors.As(err, &noReplyErr) {
		t.Fatalf("expected botVisibleReplyMissingError, got %T (%v)", err, err)
	}
	if noReplyErr.Backend != "workspace_thread" {
		t.Fatalf("expected workspace_thread backend in typed error, got %#v", noReplyErr)
	}
	if !strings.Contains(err.Error(), "no bot-visible reply") {
		t.Fatalf("expected no-reply error text, got %v", err)
	}
}

func TestWorkspaceThreadAIBackendUsesFreshDetailForTerminalTurnConfirmation(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-turn-lookup-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-turn-lookup-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	turnsExec := &fakeTerminalTurns{
		threads: threadsExec,
		turn: store.ThreadTurn{
			ID:     "turn-turn-lookup-1",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "assistant-1",
					"type": "agentMessage",
					"text": "done",
				},
			},
		},
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, nil, 10*time.Millisecond, 200*time.Millisecond).(*workspaceThreadAIBackend)
	backend.turnSettleDelay = 20 * time.Millisecond

	result, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-turn-lookup-1",
		Text:           "hello",
	})
	if err != nil {
		t.Fatalf("ProcessMessage() error = %v", err)
	}
	if len(result.Messages) != 1 || result.Messages[0].Text != "done" {
		t.Fatalf("unexpected final messages %#v", result.Messages)
	}

	deadline := time.Now().Add(200 * time.Millisecond)
	detailCalls, turnCalls := 0, 0
	for time.Now().Before(deadline) {
		detailCalls, turnCalls = threadsExec.callCounts()
		if detailCalls > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if detailCalls == 0 {
		t.Fatal("expected fresh detail lookups for terminal turn confirmation")
	}
	if turnCalls != 0 {
		t.Fatalf("expected terminal confirmation to bypass cached single-turn lookups, got %d", turnCalls)
	}
}

func TestWorkspaceThreadAIBackendPrefersTurnEventsBeforeFallbackPolling(t *testing.T) {
	t.Parallel()

	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-turn-events-1",
			WorkspaceID: "ws_123",
			Name:        "Bot Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-turn-events-1",
				WorkspaceID: "ws_123",
				Name:        "Bot Thread",
				Status:      "idle",
			},
			Turns: []store.ThreadTurn{},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeEventDrivenTurns{
		hub:     hub,
		threads: threadsExec,
	}

	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 40*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.turnSettleDelay = 15 * time.Millisecond

	result, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		WorkspaceID: "ws_123",
		Provider:    "telegram",
		Name:        "Telegram Bot",
	}, store.BotConversation{}, InboundMessage{
		ConversationID: "chat-turn-events-1",
		Text:           "hello",
	})
	if err != nil {
		t.Fatalf("ProcessMessage() error = %v", err)
	}
	if len(result.Messages) != 1 || result.Messages[0].Text != "done" {
		t.Fatalf("unexpected final messages %#v", result.Messages)
	}

	deadline := time.Now().Add(200 * time.Millisecond)
	detailCalls, turnCalls := 0, 0
	for time.Now().Before(deadline) {
		detailCalls, turnCalls = threadsExec.callCounts()
		if detailCalls > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if detailCalls == 0 {
		t.Fatal("expected event-driven wait to confirm terminal state from fresh detail")
	}
	if turnCalls != 0 {
		t.Fatalf("expected event-driven wait to avoid cached single-turn lookups, got %d", turnCalls)
	}
}

type fakeWorkspaceThreads struct {
	mu              sync.Mutex
	thread          store.Thread
	detail          store.ThreadDetail
	detailCalls     int
	turnCalls       int
	lastCreateInput threads.CreateInput
}

func (f *fakeWorkspaceThreads) Create(_ context.Context, _ string, input threads.CreateInput) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.lastCreateInput = input
	return f.thread, nil
}

func (f *fakeWorkspaceThreads) GetDetail(_ context.Context, _ string, _ string) (store.ThreadDetail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.detailCalls += 1
	return cloneThreadDetailForTest(f.detail), nil
}

func (f *fakeWorkspaceThreads) GetTurn(
	_ context.Context,
	_ string,
	_ string,
	turnID string,
	_ string,
) (store.ThreadTurn, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.turnCalls += 1

	for _, turn := range f.detail.Turns {
		if turn.ID != turnID {
			continue
		}

		return cloneThreadDetailForTest(store.ThreadDetail{Turns: []store.ThreadTurn{turn}}).Turns[0], nil
	}

	return store.ThreadTurn{}, store.ErrThreadNotFound
}

func (f *fakeWorkspaceThreads) Rename(_ context.Context, _ string, threadID string, name string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.thread.ID != threadID {
		return store.Thread{}, store.ErrThreadNotFound
	}
	f.thread.Name = strings.TrimSpace(name)
	f.detail.Thread.Name = f.thread.Name
	return f.thread, nil
}

func (f *fakeWorkspaceThreads) Archive(_ context.Context, _ string, threadID string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.thread.ID != threadID {
		return store.Thread{}, store.ErrThreadNotFound
	}
	f.thread.Archived = true
	f.detail.Thread.Archived = true
	return f.thread, nil
}

func (f *fakeWorkspaceThreads) Unarchive(_ context.Context, _ string, threadID string) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	if f.thread.ID != threadID {
		return store.Thread{}, store.ErrThreadNotFound
	}
	f.thread.Archived = false
	f.detail.Thread.Archived = false
	return f.thread, nil
}

func (f *fakeWorkspaceThreads) setCompletedTurn(turn store.ThreadTurn) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.detail.Turns = []store.ThreadTurn{turn}
}

func (f *fakeWorkspaceThreads) callCounts() (detailCalls int, turnCalls int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.detailCalls, f.turnCalls
}

type fakeStreamingTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeStreamingTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-1",
			Method:      "turn/started",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-1",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(10 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-1",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-1",
				"itemId":   "item-1",
				"delta":    "hello",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(15 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-1",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-1",
				"itemId":   "item-1",
				"delta":    " world",
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-1",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "item-1",
					"type": "agentMessage",
					"text": "hello world",
				},
			},
		})

		time.Sleep(10 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-1",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-1",
				"turn": map[string]any{
					"id":     "turn-stream-1",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-1",
		Status: "running",
	}, nil
}

type fakeCapturingTurns struct {
	result      turns.Result
	lastOptions turns.StartOptions
}

func (f *fakeCapturingTurns) Start(
	_ context.Context,
	_ string,
	_ string,
	_ string,
	options turns.StartOptions,
) (turns.Result, error) {
	f.lastOptions = options
	return f.result, nil
}

type fakeCountingTurns struct {
	calls  int
	result turns.Result
}

func (f *fakeCountingTurns) Start(
	_ context.Context,
	_ string,
	_ string,
	_ string,
	_ turns.StartOptions,
) (turns.Result, error) {
	f.calls++
	if f.result.TurnID == "" {
		f.result = turns.Result{
			TurnID: "turn-counting-1",
			Status: "running",
		}
	}
	return f.result, nil
}

func (f *fakeCountingTurns) Steer(_ context.Context, _ string, _ string, _ string) (turns.Result, error) {
	return turns.Result{}, nil
}

func (f *fakeCountingTurns) Interrupt(_ context.Context, _ string, _ string) (turns.Result, error) {
	return turns.Result{}, nil
}

func (f *fakeCountingTurns) Review(_ context.Context, _ string, _ string) (turns.Result, error) {
	return turns.Result{}, nil
}

type fakeLateServerRequestTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeLateServerRequestTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		requestID := "req-stream-1"

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-2",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-2",
				"itemId":   "assistant-1",
				"delta":    "hello world",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID:     workspaceID,
			ThreadID:        threadID,
			TurnID:          "turn-stream-2",
			Method:          "item/tool/requestUserInput",
			ServerRequestID: &requestID,
			Payload: map[string]any{
				"threadId":   threadID,
				"turnId":     "turn-stream-2",
				"questions":  []any{map[string]any{"id": "q1"}},
				"request_id": requestID,
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-2",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":          "server-request-" + requestID,
					"type":        "serverRequest",
					"requestId":   requestID,
					"requestKind": "item/tool/requestUserInput",
					"status":      "pending",
					"details": map[string]any{
						"questions": []any{map[string]any{"id": "q1"}},
					},
				},
				{
					"id":   "assistant-1",
					"type": "agentMessage",
					"text": "hello world",
				},
			},
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-2",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-2",
				"turn": map[string]any{
					"id":     "turn-stream-2",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(15 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID:     workspaceID,
			ThreadID:        threadID,
			TurnID:          "turn-stream-2",
			Method:          "server/request/resolved",
			ServerRequestID: &requestID,
			Payload: map[string]any{
				"method": "item/tool/requestUserInput",
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-2",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":          "server-request-" + requestID,
					"type":        "serverRequest",
					"requestId":   requestID,
					"requestKind": "item/tool/requestUserInput",
					"status":      "resolved",
					"details": map[string]any{
						"questions": []any{map[string]any{"id": "q1"}},
					},
				},
				{
					"id":   "assistant-1",
					"type": "agentMessage",
					"text": "hello world",
				},
			},
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-2",
		Status: "running",
	}, nil
}

type fakeCommandThenAgentTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeCommandThenAgentTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-3",
			Method:      "item/started",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-3",
				"item": map[string]any{
					"id":      "cmd-1",
					"type":    "commandExecution",
					"command": "go test ./...",
				},
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-3",
			Method:      "item/commandExecution/outputDelta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-3",
				"itemId":   "cmd-1",
				"delta":    "ok",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-3",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-3",
				"itemId":   "msg-1",
				"delta":    "done",
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-3",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-1",
					"type": "agentMessage",
					"text": "done",
				},
				{
					"id":               "cmd-1",
					"type":             "commandExecution",
					"command":          "go test ./...",
					"aggregatedOutput": "ok",
					"status":           "completed",
				},
			},
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-3",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-3",
				"turn": map[string]any{
					"id":     "turn-stream-3",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-3",
		Status: "running",
	}, nil
}

type fakeLaggingCompletedTurnTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeLaggingCompletedTurnTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-4",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-4",
				"itemId":   "msg-1",
				"delta":    "hello world",
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-4",
			Status: "completed",
			Items:  []map[string]any{},
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-4",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-4",
				"turn": map[string]any{
					"id":     "turn-stream-4",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-4",
		Status: "running",
	}, nil
}

type fakeCompletedTurnWinsOverPartialStreamTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeCompletedTurnWinsOverPartialStreamTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-4b",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-4b",
				"itemId":   "msg-1",
				"delta":    "hello",
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-4b",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-1",
					"type": "agentMessage",
					"text": "hello world",
				},
			},
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-4b",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-4b",
				"turn": map[string]any{
					"id":     "turn-stream-4b",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-4b",
		Status: "running",
	}, nil
}

type fakeDelayedCompletedTurnSnapshotTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeDelayedCompletedTurnSnapshotTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-4c",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-4c",
				"itemId":   "msg-1",
				"delta":    "hello",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-4c",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-4c",
				"turn": map[string]any{
					"id":     "turn-stream-4c",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(35 * time.Millisecond)
		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-4c",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-1",
					"type": "agentMessage",
					"text": "hello world",
				},
			},
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-4c",
		Status: "running",
	}, nil
}

type fakeOverflowThenSnapshotTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeOverflowThenSnapshotTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-overflow-1",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-overflow-1",
				"itemId":   "msg-1",
				"delta":    "hello",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		for index := 0; index < 160; index++ {
			f.hub.Publish(store.EventEnvelope{
				WorkspaceID: workspaceID,
				ThreadID:    threadID,
				TurnID:      "turn-stream-overflow-1",
				Method:      "item/agentMessage/delta",
				Payload: map[string]any{
					"threadId": threadID,
					"turnId":   "turn-stream-overflow-1",
					"itemId":   "msg-1",
					"delta":    "!",
				},
				TS: time.Now().UTC(),
			})
		}

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-overflow-1",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-1",
					"type": "agentMessage",
					"text": "hello world overflow recovered",
				},
			},
		})

		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-overflow-1",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-overflow-1",
				"turn": map[string]any{
					"id":     "turn-stream-overflow-1",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-overflow-1",
		Status: "running",
	}, nil
}

type fakeOverflowBeforeCompletionTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeOverflowBeforeCompletionTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-stream-overflow-2",
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-stream-overflow-2",
				"itemId":   "msg-1",
				"delta":    "hello",
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		for index := 0; index < 160; index++ {
			f.hub.Publish(store.EventEnvelope{
				WorkspaceID: workspaceID,
				ThreadID:    threadID,
				TurnID:      "turn-stream-overflow-2",
				Method:      "item/agentMessage/delta",
				Payload: map[string]any{
					"threadId": threadID,
					"turnId":   "turn-stream-overflow-2",
					"itemId":   "msg-1",
					"delta":    ".",
				},
				TS: time.Now().UTC(),
			})
		}

		time.Sleep(40 * time.Millisecond)
		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-stream-overflow-2",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "msg-1",
					"type": "agentMessage",
					"text": "hello recovered before poll timeout",
				},
			},
		})
	}()

	return turns.Result{
		TurnID: "turn-stream-overflow-2",
		Status: "running",
	}, nil
}

type fakeTerminalTurns struct {
	threads *fakeWorkspaceThreads
	turn    store.ThreadTurn
}

func (f *fakeTerminalTurns) Start(_ context.Context, _ string, _ string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.threads.setCompletedTurn(f.turn)
	}()

	return turns.Result{
		TurnID: f.turn.ID,
		Status: "running",
	}, nil
}

type fakeTerminalStreamingTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
	turn    store.ThreadTurn
}

func (f *fakeTerminalStreamingTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.threads.setCompletedTurn(f.turn)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      f.turn.ID,
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   f.turn.ID,
				"turn": map[string]any{
					"id":     f.turn.ID,
					"status": f.turn.Status,
					"error":  f.turn.Error,
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: f.turn.ID,
		Status: "running",
	}, nil
}

type fakeEventDrivenTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeEventDrivenTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-turn-events-1",
			Method:      "turn/started",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-turn-events-1",
			},
			TS: time.Now().UTC(),
		})

		for _, delta := range []string{"d", "o", "n", "e"} {
			time.Sleep(5 * time.Millisecond)
			f.hub.Publish(store.EventEnvelope{
				WorkspaceID: workspaceID,
				ThreadID:    threadID,
				TurnID:      "turn-turn-events-1",
				Method:      "item/agentMessage/delta",
				Payload: map[string]any{
					"threadId": threadID,
					"turnId":   "turn-turn-events-1",
					"itemId":   "assistant-1",
					"delta":    delta,
				},
				TS: time.Now().UTC(),
			})
		}

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     "turn-turn-events-1",
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "assistant-1",
					"type": "agentMessage",
					"text": "done",
				},
			},
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      "turn-turn-events-1",
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   "turn-turn-events-1",
				"turn": map[string]any{
					"id":     "turn-turn-events-1",
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-turn-events-1",
		Status: "running",
	}, nil
}

func cloneThreadDetailForTest(detail store.ThreadDetail) store.ThreadDetail {
	cloned := detail
	cloned.Turns = make([]store.ThreadTurn, 0, len(detail.Turns))
	for _, turn := range detail.Turns {
		nextTurn := store.ThreadTurn{
			ID:     turn.ID,
			Status: turn.Status,
			Error:  turn.Error,
		}
		if len(turn.Items) > 0 {
			nextTurn.Items = make([]map[string]any, 0, len(turn.Items))
			for _, item := range turn.Items {
				nextItem := make(map[string]any, len(item))
				for key, value := range item {
					nextItem[key] = value
				}
				nextTurn.Items = append(nextTurn.Items, nextItem)
			}
		} else {
			nextTurn.Items = []map[string]any{}
		}
		cloned.Turns = append(cloned.Turns, nextTurn)
	}
	return cloned
}
