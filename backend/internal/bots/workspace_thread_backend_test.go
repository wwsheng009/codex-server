package bots

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/events"
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
	if messages[1].Text != "Command: go test ./...\nOutput:\nok  codex-server/backend/internal/bots" {
		t.Fatalf("unexpected commandExecution message %#v", messages[1])
	}
	if messages[2].Text != "Files:\n- backend/internal/bots/service.go (Update)\n- backend/internal/bots/telegram.go (Update)" {
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
		{Text: "Command: go test ./...\nOutput:\npartial output"},
		{Text: "Reply sent."},
	}
	if !equalOutboundMessages(updates[0], expected) {
		t.Fatalf("unexpected mixed snapshot %#v", updates[0])
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
	if result.Messages[0].Text != "Command: go test ./... [Completed]\nOutput:\nok" {
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
		if snapshot[0].Text == "Command: go test ./...\nOutput:\nok" && snapshot[1].Text == "done" {
			foundOrderedSnapshot = true
			break
		}
	}
	if !foundOrderedSnapshot {
		t.Fatalf("expected streaming snapshots to preserve command-before-agent order, got %#v", snapshots)
	}
}

type fakeWorkspaceThreads struct {
	mu     sync.Mutex
	thread store.Thread
	detail store.ThreadDetail
}

func (f *fakeWorkspaceThreads) Create(_ context.Context, _ string, _ threads.CreateInput) (store.Thread, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.thread, nil
}

func (f *fakeWorkspaceThreads) GetDetail(_ context.Context, _ string, _ string) (store.ThreadDetail, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return cloneThreadDetailForTest(f.detail), nil
}

func (f *fakeWorkspaceThreads) setCompletedTurn(turn store.ThreadTurn) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.detail.Turns = []store.ThreadTurn{turn}
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
