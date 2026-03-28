package bots

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/store"
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
