package bots

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/events"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/turns"
)

func TestServiceDebugLogsCarryTraceIDAcrossProcessingSteps(t *testing.T) {
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	provider := newFakeStreamingProvider()

	service := NewService(dataStore, nil, nil, nil, Config{
		PublicBaseURL: "https://bots.example.com",
		Providers:     []Provider{provider},
		AIBackends:    []AIBackend{fakeStreamingAIBackend{}},
	})
	service.Start(context.Background())

	logs := captureBotDebugLogs(t, func() {
		connection, err := service.CreateConnection(context.Background(), workspace.ID, CreateConnectionInput{
			Provider:  "streamchat",
			AIBackend: "stream_ai",
			Settings: map[string]string{
				botRuntimeModeSetting: botRuntimeModeDebug,
			},
			Secrets: map[string]string{
				"bot_token": "token-123",
			},
		})
		if err != nil {
			t.Fatalf("CreateConnection() error = %v", err)
		}

		request := httptest.NewRequest(http.MethodPost, "/hooks/bots/"+connection.ID, strings.NewReader(`{
			"conversationId":"chat-debug-1",
			"messageId":"msg-debug-1",
			"userId":"user-1",
			"username":"alice",
			"title":"Alice",
			"text":"debug me"
		}`))
		request.Header.Set("X-Test-Secret", "fake-secret")

		result, err := service.HandleWebhook(request, connection.ID)
		if err != nil {
			t.Fatalf("HandleWebhook() error = %v", err)
		}
		if result.Accepted != 1 {
			t.Fatalf("expected 1 accepted inbound message, got %d", result.Accepted)
		}

		deadline := time.Now().Add(2 * time.Second)
		for {
			conversations := service.ListConversations(workspace.ID, connection.ID)
			if len(conversations) == 1 && conversations[0].LastOutboundText == "final: debug me" {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("expected bot conversation to settle, got %#v", conversations)
			}
			time.Sleep(10 * time.Millisecond)
		}
	})

	traceLogs := filterDebugLogsWithTrace(logs)
	if len(traceLogs) == 0 {
		t.Fatalf("expected trace-bearing debug logs, got %#v", logs)
	}

	traceID := debugLogStringField(traceLogs[0]["traceId"])
	if traceID == "" {
		t.Fatalf("expected non-empty trace id, got %#v", traceLogs[0])
	}

	requiredMessages := map[string]bool{
		"bot debug: claimed inbound delivery":    false,
		"bot debug: starting streaming ai reply": false,
		"bot debug: completed inbound delivery":  false,
	}

	for _, entry := range traceLogs {
		if debugLogStringField(entry["traceId"]) != traceID {
			t.Fatalf("expected a single trace id across logs, got %#v", traceLogs)
		}
		message := debugLogStringField(entry["msg"])
		if _, ok := requiredMessages[message]; ok {
			requiredMessages[message] = true
		}
	}

	for message, found := range requiredMessages {
		if !found {
			t.Fatalf("expected debug log %q, got %#v", message, traceLogs)
		}
	}
}

func TestTelegramProviderDebugLogsIncludeTraceID(t *testing.T) {
	var sendMessagePayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendMessage payload error = %v", err)
			}
			sendMessagePayloads = append(sendMessagePayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 101,
				},
			})
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	connection := store.BotConnection{
		ID:       "bot_debug_telegram",
		Provider: telegramProviderName,
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
		Secrets: map[string]string{
			"bot_token": "123:abc",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "1001",
	}

	logs := captureBotDebugLogs(t, func() {
		ctx := withBotDebugTrace(context.Background(), connection.ID, "bid_debug_telegram")
		if err := provider.SendMessages(ctx, connection, conversation, []OutboundMessage{{Text: "hello debug"}}); err != nil {
			t.Fatalf("SendMessages() error = %v", err)
		}
	})

	if len(sendMessagePayloads) != 1 {
		t.Fatalf("expected one telegram sendMessage call, got %#v", sendMessagePayloads)
	}

	foundRequested := false
	foundChunk := false
	for _, entry := range filterDebugLogsWithTrace(logs) {
		if debugLogStringField(entry["traceId"]) != "bid_debug_telegram" {
			t.Fatalf("expected telegram trace id to be preserved, got %#v", entry)
		}
		switch debugLogStringField(entry["msg"]) {
		case "bot debug: telegram send messages requested":
			foundRequested = true
		case "bot debug: telegram sending chunk":
			foundChunk = true
		}
	}

	if !foundRequested || !foundChunk {
		t.Fatalf("expected telegram debug logs for request and chunk send, got %#v", logs)
	}
}

func TestLogBotDebugDoesNotDuplicateDeliveryIDAttribute(t *testing.T) {
	var buffer bytes.Buffer
	logger := slog.New(slog.NewTextHandler(&buffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	previous := slog.Default()
	slog.SetDefault(logger)
	defer slog.SetDefault(previous)

	connection := store.BotConnection{
		ID:          "bot_debug_delivery",
		WorkspaceID: "ws_debug",
		Provider:    "telegram",
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
	}

	logBotDebug(
		withBotDebugTrace(context.Background(), connection.ID, "bid_debug_delivery"),
		connection,
		"claimed inbound delivery",
		slog.String("messageId", "message-1"),
	)

	line := strings.TrimSpace(buffer.String())
	if line == "" {
		t.Fatal("expected a text log line")
	}
	if count := strings.Count(line, "deliveryId="); count != 1 {
		t.Fatalf("expected deliveryId to appear once, got count=%d line=%q", count, line)
	}
}

func TestRecordPollingErrorEmitsDebugLogForDebugConnections(t *testing.T) {
	connection := store.BotConnection{
		ID:          "bot_debug_polling",
		WorkspaceID: "ws_debug",
		Provider:    wechatProviderName,
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
	}
	service := NewService(store.NewMemoryStore(), nil, nil, nil, Config{})

	logs := captureBotDebugLogs(t, func() {
		service.recordPollingError(connection, errors.New("decode wechat /ilink/bot/getupdates response: sample failure"))
	})

	found := false
	for _, entry := range logs {
		if debugLogStringField(entry["msg"]) != "bot debug: polling iteration failed" {
			continue
		}
		if !strings.Contains(debugLogStringField(entry["error"]), "decode wechat /ilink/bot/getupdates response") {
			t.Fatalf("expected polling failure detail in debug log, got %#v", entry)
		}
		found = true
	}

	if !found {
		t.Fatalf("expected polling failure debug log, got %#v", logs)
	}
}

func TestRecordPollingErrorIncludesProxyURLWhenAvailable(t *testing.T) {
	connection := store.BotConnection{
		ID:          "bot_debug_polling_proxy",
		WorkspaceID: "ws_debug",
		Provider:    telegramProviderName,
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
	}
	service := NewService(store.NewMemoryStore(), nil, nil, nil, Config{})

	logs := captureBotDebugLogs(t, func() {
		service.recordPollingError(
			connection,
			wrapTelegramPollingTransportError(
				errors.New(`telegram getUpdates request failed: Post "https://api.telegram.org/bot123:abc/getUpdates": local error: tls: bad record MAC`),
				"http://127.0.0.1:10810",
			),
		)
	})

	found := false
	for _, entry := range logs {
		if debugLogStringField(entry["msg"]) != "bot debug: polling iteration failed" {
			continue
		}
		if debugLogStringField(entry["proxyUrl"]) != "http://127.0.0.1:10810" {
			t.Fatalf("expected proxyUrl in polling debug log, got %#v", entry)
		}
		found = true
	}

	if !found {
		t.Fatalf("expected polling failure debug log with proxy diagnostics, got %#v", logs)
	}
}

func TestWorkspaceThreadStreamingDebugLogsSkipNonBotVisibleItemLifecycle(t *testing.T) {
	threadsExec := &fakeWorkspaceThreads{
		thread: store.Thread{
			ID:          "thread-debug-1",
			WorkspaceID: "ws_debug",
			Name:        "Debug Thread",
			Status:      "idle",
		},
		detail: store.ThreadDetail{
			Thread: store.Thread{
				ID:          "thread-debug-1",
				WorkspaceID: "ws_debug",
				Name:        "Debug Thread",
				Status:      "idle",
			},
		},
	}
	hub := events.NewHub()
	turnsExec := &fakeDebugLoggingStreamingTurns{
		hub:     hub,
		threads: threadsExec,
	}
	backend := newWorkspaceThreadAIBackend(threadsExec, turnsExec, hub, 10*time.Millisecond, time.Second).(*workspaceThreadAIBackend)
	backend.streamFlushInterval = 5 * time.Millisecond

	connection := store.BotConnection{
		ID:          "bot_debug_workspace",
		WorkspaceID: "ws_debug",
		Provider:    "telegram",
		Settings: map[string]string{
			botRuntimeModeSetting: botRuntimeModeDebug,
		},
	}

	logs := captureBotDebugLogs(t, func() {
		_, err := backend.ProcessMessageStream(
			withBotDebugTrace(context.Background(), connection.ID, "bid_debug_workspace"),
			connection,
			store.BotConversation{},
			InboundMessage{
				ConversationID: "chat-debug",
				Text:           "/help",
			},
			func(_ context.Context, _ StreamingUpdate) error { return nil },
		)
		if err != nil {
			t.Fatalf("ProcessMessageStream() error = %v", err)
		}
	})

	streamingMessages := make([]string, 0)
	for _, entry := range filterDebugLogsWithTrace(logs) {
		message := debugLogStringField(entry["msg"])
		if strings.HasPrefix(message, "bot debug: workspace streaming event received") {
			streamingMessages = append(streamingMessages, message)
		}
	}

	required := map[string]bool{
		"bot debug: workspace streaming event received: turn/started":            false,
		"bot debug: workspace streaming event received: item/agentMessage/delta": false,
		"bot debug: workspace streaming event received: turn/completed":          false,
	}
	for _, message := range streamingMessages {
		if _, ok := required[message]; ok {
			required[message] = true
		}
		if strings.HasSuffix(message, "item/started") || strings.HasSuffix(message, "item/completed") {
			t.Fatalf("expected non-bot-visible item lifecycle events to be suppressed, got %#v", streamingMessages)
		}
	}

	for message, found := range required {
		if !found {
			t.Fatalf("expected streaming debug log %q, got %#v", message, streamingMessages)
		}
	}
}

type fakeDebugLoggingStreamingTurns struct {
	hub     *events.Hub
	threads *fakeWorkspaceThreads
}

func (f *fakeDebugLoggingStreamingTurns) Start(_ context.Context, workspaceID string, threadID string, _ string, _ turns.StartOptions) (turns.Result, error) {
	go func() {
		turnID := "turn-debug-1"

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      turnID,
			Method:      "turn/started",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   turnID,
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      turnID,
			Method:      "item/started",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   turnID,
				"item": map[string]any{
					"id":   "user-1",
					"type": "userMessage",
				},
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      turnID,
			Method:      "item/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   turnID,
				"item": map[string]any{
					"id":   "user-1",
					"type": "userMessage",
				},
			},
			TS: time.Now().UTC(),
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      turnID,
			Method:      "item/agentMessage/delta",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   turnID,
				"itemId":   "assistant-1",
				"delta":    "help text",
			},
			TS: time.Now().UTC(),
		})

		f.threads.setCompletedTurn(store.ThreadTurn{
			ID:     turnID,
			Status: "completed",
			Items: []map[string]any{
				{
					"id":   "assistant-1",
					"type": "agentMessage",
					"text": "help text",
				},
			},
		})

		time.Sleep(5 * time.Millisecond)
		f.hub.Publish(store.EventEnvelope{
			WorkspaceID: workspaceID,
			ThreadID:    threadID,
			TurnID:      turnID,
			Method:      "turn/completed",
			Payload: map[string]any{
				"threadId": threadID,
				"turnId":   turnID,
				"turn": map[string]any{
					"id":     turnID,
					"status": "completed",
				},
			},
			TS: time.Now().UTC(),
		})
	}()

	return turns.Result{
		TurnID: "turn-debug-1",
		Status: "running",
	}, nil
}

func captureBotDebugLogs(t *testing.T, run func()) []map[string]any {
	t.Helper()

	var buffer bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&buffer, &slog.HandlerOptions{Level: slog.LevelInfo}))
	previous := slog.Default()
	slog.SetDefault(logger)
	defer slog.SetDefault(previous)

	run()

	lines := strings.Split(strings.TrimSpace(buffer.String()), "\n")
	entries := make([]map[string]any, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var entry map[string]any
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			t.Fatalf("unmarshal log entry error = %v; line=%q", err, line)
		}
		entries = append(entries, entry)
	}
	return entries
}

func filterDebugLogsWithTrace(entries []map[string]any) []map[string]any {
	filtered := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		if debugLogStringField(entry["traceId"]) == "" {
			continue
		}
		filtered = append(filtered, entry)
	}
	return filtered
}

func debugLogStringField(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}
