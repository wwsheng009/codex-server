package bots

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestTelegramProviderActivateAndParseWebhook(t *testing.T) {
	t.Parallel()

	var setWebhookPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/getMe":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"id":         42,
					"first_name": "Demo Bot",
					"username":   "demo_bot",
				},
			})
		case "/bot123:abc/setWebhook":
			if err := json.NewDecoder(r.Body).Decode(&setWebhookPayload); err != nil {
				t.Fatalf("decode setWebhook payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	connection := store.BotConnection{
		ID:      "bot_001",
		Secrets: map[string]string{"bot_token": "123:abc"},
	}

	activation, err := provider.Activate(context.Background(), connection, "https://public.example.com")
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
	}

	if activation.Settings["bot_username"] != "demo_bot" {
		t.Fatalf("expected bot username demo_bot, got %q", activation.Settings["bot_username"])
	}
	if activation.Settings[telegramDeliveryModeSetting] != telegramDeliveryModeWebhook {
		t.Fatalf("expected webhook delivery mode, got %#v", activation.Settings)
	}
	if activation.Settings["webhook_url"] != "https://public.example.com/hooks/bots/bot_001" {
		t.Fatalf("expected webhook url to be set, got %q", activation.Settings["webhook_url"])
	}
	if strings.TrimSpace(activation.Secrets["webhook_secret"]) == "" {
		t.Fatal("expected webhook secret to be generated")
	}
	if got := setWebhookPayload["url"]; got != "https://public.example.com/hooks/bots/bot_001" {
		t.Fatalf("expected setWebhook url to use connection id, got %#v", got)
	}

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/bot_001", strings.NewReader(`{
		"message":{
			"message_id":99,
			"text":"hello telegram",
			"chat":{"id":1001,"title":"Alice"},
			"from":{"id":5001,"username":"alice","first_name":"Alice","is_bot":false}
		}
	}`))
	request.Header.Set("X-Telegram-Bot-Api-Secret-Token", activation.Secrets["webhook_secret"])

	messages, err := provider.ParseWebhook(request, store.BotConnection{
		Secrets: activation.Secrets,
	})
	if err != nil {
		t.Fatalf("ParseWebhook() error = %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 telegram inbound message, got %d", len(messages))
	}
	if messages[0].ConversationID != "1001" || messages[0].Text != "hello telegram" {
		t.Fatalf("unexpected telegram inbound message %#v", messages[0])
	}
}

func TestTelegramProviderParseWebhookUsesTopicScopedConversationID(t *testing.T) {
	t.Parallel()

	provider := newTelegramProvider(&http.Client{}).(*telegramProvider)

	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/bot_001", strings.NewReader(`{
		"message":{
			"message_id":99,
			"message_thread_id":77,
			"text":"hello topic",
			"chat":{"id":-100123,"title":"Ops Group"},
			"from":{"id":5001,"username":"alice","first_name":"Alice","is_bot":false}
		}
	}`))

	messages, err := provider.ParseWebhook(request, store.BotConnection{})
	if err != nil {
		t.Fatalf("ParseWebhook() error = %v", err)
	}
	if len(messages) != 1 {
		t.Fatalf("expected 1 telegram inbound message, got %d", len(messages))
	}
	if messages[0].ConversationID != "-100123:thread:77" {
		t.Fatalf("expected topic-scoped conversation id, got %#v", messages[0])
	}
	if messages[0].ExternalChatID != "-100123" {
		t.Fatalf("expected external chat id -100123, got %#v", messages[0])
	}
	if messages[0].ExternalThreadID != "77" {
		t.Fatalf("expected external thread id 77, got %#v", messages[0])
	}
}

func TestTelegramProviderActivatePollingAndRunPolling(t *testing.T) {
	t.Parallel()

	deleteWebhookCalls := 0
	getUpdatesCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/getMe":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"id":         42,
					"first_name": "Demo Bot",
					"username":   "demo_bot",
				},
			})
		case "/bot123:abc/deleteWebhook":
			deleteWebhookCalls += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		case "/bot123:abc/getUpdates":
			getUpdatesCalls += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": []map[string]any{
					{
						"update_id": 7,
						"message": map[string]any{
							"message_id": 99,
							"text":       "hello polling",
							"chat": map[string]any{
								"id":    1001,
								"title": "Alice",
							},
							"from": map[string]any{
								"id":         5001,
								"username":   "alice",
								"first_name": "Alice",
								"is_bot":     false,
							},
						},
					},
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
		ID: "bot_002",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{"bot_token": "123:abc"},
	}

	activation, err := provider.Activate(context.Background(), connection, "")
	if err != nil {
		t.Fatalf("Activate() polling error = %v", err)
	}
	if activation.Settings[telegramDeliveryModeSetting] != telegramDeliveryModePolling {
		t.Fatalf("expected polling delivery mode, got %#v", activation.Settings)
	}
	if _, ok := activation.Settings["webhook_url"]; ok {
		t.Fatalf("expected no webhook url in polling mode, got %#v", activation.Settings)
	}
	if deleteWebhookCalls != 1 {
		t.Fatalf("expected deleteWebhook to be called once during polling activation, got %d", deleteWebhookCalls)
	}

	pollingConnection := connection
	pollingConnection.Settings = activation.Settings
	pollingConnection.Secrets = activation.Secrets

	handled := make([]InboundMessage, 0, 1)
	var persistedSettings map[string]string
	err = provider.RunPolling(
		context.Background(),
		pollingConnection,
		func(_ context.Context, message InboundMessage) error {
			handled = append(handled, message)
			return nil
		},
		func(_ context.Context, settings map[string]string) error {
			persistedSettings = settings
			return context.Canceled
		},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected polling to stop with context.Canceled, got %v", err)
	}
	if getUpdatesCalls != 1 {
		t.Fatalf("expected exactly one getUpdates call, got %d", getUpdatesCalls)
	}
	if len(handled) != 1 || handled[0].Text != "hello polling" {
		t.Fatalf("unexpected polling messages %#v", handled)
	}
	if persistedSettings[telegramUpdateOffsetSetting] != "8" {
		t.Fatalf("expected telegram update offset 8, got %#v", persistedSettings)
	}

	webhookRequest := httptest.NewRequest(http.MethodPost, "/hooks/bots/bot_002", strings.NewReader(`{}`))
	if _, err := provider.ParseWebhook(webhookRequest, pollingConnection); !errors.Is(err, ErrWebhookIgnored) {
		t.Fatalf("expected polling mode webhook parse to be ignored, got %v", err)
	}
}

func TestTelegramStreamingReplySessionEditsMessageInPlace(t *testing.T) {
	t.Parallel()

	sendPayloads := make([]map[string]any, 0, 2)
	editPayloads := make([]map[string]any, 0, 2)
	deletePayloads := make([]map[string]any, 0, 2)
	callOrder := make([]string, 0, 5)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendMessage payload error = %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			callOrder = append(callOrder, "sendMessage")

			messageID := 501
			if len(sendPayloads) > 1 {
				messageID = 502
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": messageID,
				},
			})
		case "/bot123:abc/editMessageText":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode editMessageText payload error = %v", err)
			}
			editPayloads = append(editPayloads, payload)
			callOrder = append(callOrder, "editMessageText")

			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 501,
				},
			})
		case "/bot123:abc/deleteMessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode deleteMessage payload error = %v", err)
			}
			deletePayloads = append(deletePayloads, payload)
			callOrder = append(callOrder, "deleteMessage")

			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{Text: "draft plan"},
			{Text: "draft reply"},
		},
	}); err != nil {
		t.Fatalf("Update(first) error = %v", err)
	}
	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{Text: "draft plan"},
			{Text: "draft reply updated"},
		},
	}); err != nil {
		t.Fatalf("Update(second) error = %v", err)
	}
	if err := session.Complete(context.Background(), []OutboundMessage{
		{Text: "draft plan"},
		{Text: "final reply"},
	}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if len(sendPayloads) != 2 {
		t.Fatalf("expected 2 sendMessage calls, got %#v", sendPayloads)
	}
	if len(editPayloads) != 2 {
		t.Fatalf("expected 2 editMessageText calls, got %#v", editPayloads)
	}
	if len(deletePayloads) != 0 {
		t.Fatalf("expected no deleteMessage calls, got %#v", deletePayloads)
	}
	if sendPayloads[0]["text"] != "draft plan" {
		t.Fatalf("unexpected first sendMessage payload %#v", sendPayloads[0])
	}
	if sendPayloads[1]["text"] != "draft reply" {
		t.Fatalf("unexpected second sendMessage payload %#v", sendPayloads[1])
	}
	if editPayloads[0]["text"] != "draft reply updated" {
		t.Fatalf("unexpected first editMessageText payload %#v", editPayloads[0])
	}
	if editPayloads[1]["text"] != "final reply" {
		t.Fatalf("unexpected final editMessageText payload %#v", editPayloads[1])
	}

	expectedOrder := []string{"sendMessage", "sendMessage", "editMessageText", "editMessageText"}
	if strings.Join(callOrder, ",") != strings.Join(expectedOrder, ",") {
		t.Fatalf("unexpected telegram call order %#v", callOrder)
	}
}

func TestTelegramStreamingReplySessionDeletesTrailingMessagesWhenReplyShrinks(t *testing.T) {
	t.Parallel()

	sendCount := 0
	deletePayloads := make([]map[string]any, 0, 2)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			sendCount += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 600 + sendCount,
				},
			})
		case "/bot123:abc/deleteMessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode deleteMessage payload error = %v", err)
			}
			deletePayloads = append(deletePayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		case "/bot123:abc/editMessageText":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 601,
				},
			})
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{Text: "segment-1"},
			{Text: "segment-2"},
			{Text: "segment-3"},
		},
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if err := session.Complete(context.Background(), []OutboundMessage{
		{Text: "segment-1"},
	}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if sendCount != 3 {
		t.Fatalf("expected 3 sendMessage calls, got %d", sendCount)
	}
	if len(deletePayloads) != 2 {
		t.Fatalf("expected 2 deleteMessage calls, got %#v", deletePayloads)
	}
}

func TestTelegramStreamingReplySessionFailUsesDetailedFallbackText(t *testing.T) {
	t.Parallel()

	editPayloads := make([]map[string]any, 0, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 900,
				},
			})
		case "/bot123:abc/editMessageText":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode editMessageText payload error = %v", err)
			}
			editPayloads = append(editPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 900,
				},
			})
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "working"}},
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if err := session.Fail(context.Background(), ""); err != nil {
		t.Fatalf("Fail() error = %v", err)
	}

	if len(editPayloads) != 1 {
		t.Fatalf("expected 1 editMessageText payload, got %#v", editPayloads)
	}
	if editPayloads[0]["text"] != defaultStreamingFailureText {
		t.Fatalf("expected detailed fallback failure text, got %#v", editPayloads[0])
	}
	if strings.Contains(editPayloads[0]["text"].(string), "Request failed. Please try again.") {
		t.Fatalf("did not expect legacy generic failure text, got %#v", editPayloads[0])
	}
}

func TestTelegramProviderSendMessagesIncludesTopicThreadID(t *testing.T) {
	t.Parallel()

	sendPayloads := make([]map[string]any, 0, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendMessage" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode sendMessage payload error = %v", err)
		}
		sendPayloads = append(sendPayloads, payload)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": 710,
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID:   "-100123",
		ExternalThreadID: "77",
	}, []OutboundMessage{{Text: "topic reply"}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if len(sendPayloads) != 1 {
		t.Fatalf("expected one sendMessage payload, got %#v", sendPayloads)
	}
	if sendPayloads[0]["chat_id"] != "-100123" {
		t.Fatalf("expected chat_id -100123, got %#v", sendPayloads[0])
	}
	if sendPayloads[0]["message_thread_id"] != float64(77) {
		t.Fatalf("expected message_thread_id 77, got %#v", sendPayloads[0])
	}
}

func TestTelegramProviderSendMessagesPreservesTopicThreadIDAcrossChunks(t *testing.T) {
	t.Parallel()

	sendPayloads := make([]map[string]any, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendMessage" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode sendMessage payload error = %v", err)
		}
		sendPayloads = append(sendPayloads, payload)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": 720 + len(sendPayloads),
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	longText := strings.Repeat("a", telegramTextLimitRunes+25)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID:   "-100123",
		ExternalThreadID: "77",
	}, []OutboundMessage{{Text: longText}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if len(sendPayloads) != 2 {
		t.Fatalf("expected 2 sendMessage payloads, got %#v", sendPayloads)
	}
	for index, payload := range sendPayloads {
		if payload["chat_id"] != "-100123" {
			t.Fatalf("expected chat_id -100123 for chunk %d, got %#v", index, payload)
		}
		if payload["message_thread_id"] != float64(77) {
			t.Fatalf("expected message_thread_id 77 for chunk %d, got %#v", index, payload)
		}
	}
}

func TestTelegramProviderRunPollingPreservesTopicThreadID(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/getUpdates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": []map[string]any{
					{
						"update_id": 15,
						"message": map[string]any{
							"message_id":        99,
							"message_thread_id": 77,
							"text":              "hello topic polling",
							"chat": map[string]any{
								"id":    -100123,
								"title": "Ops Group",
							},
							"from": map[string]any{
								"id":         5001,
								"username":   "alice",
								"first_name": "Alice",
								"is_bot":     false,
							},
						},
					},
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
		ID: "bot_003",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{"bot_token": "123:abc"},
	}

	handled := make([]InboundMessage, 0, 1)
	var persistedSettings map[string]string
	err := provider.RunPolling(
		context.Background(),
		connection,
		func(_ context.Context, message InboundMessage) error {
			handled = append(handled, message)
			return nil
		},
		func(_ context.Context, settings map[string]string) error {
			persistedSettings = settings
			return context.Canceled
		},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected polling to stop with context.Canceled, got %v", err)
	}

	if len(handled) != 1 {
		t.Fatalf("expected one handled polling message, got %#v", handled)
	}
	if handled[0].ConversationID != "-100123:thread:77" {
		t.Fatalf("expected topic-scoped conversation id, got %#v", handled[0])
	}
	if handled[0].ExternalChatID != "-100123" {
		t.Fatalf("expected external chat id -100123, got %#v", handled[0])
	}
	if handled[0].ExternalThreadID != "77" {
		t.Fatalf("expected external thread id 77, got %#v", handled[0])
	}
	if persistedSettings[telegramUpdateOffsetSetting] != "16" {
		t.Fatalf("expected telegram update offset 16, got %#v", persistedSettings)
	}
}

func TestTelegramProviderRunPollingSkipsIgnoredUpdatesAndAdvancesOffset(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/getUpdates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": []map[string]any{
					{
						"update_id": 20,
						"message": map[string]any{
							"message_id": 1,
							"text":       "bot echo",
							"chat": map[string]any{
								"id":    1001,
								"title": "Alice",
							},
							"from": map[string]any{
								"id":         9001,
								"username":   "demo_bot",
								"first_name": "Demo Bot",
								"is_bot":     true,
							},
						},
					},
					{
						"update_id": 21,
						"message": map[string]any{
							"message_id": 2,
							"text":       "   ",
							"chat": map[string]any{
								"id":    1001,
								"title": "Alice",
							},
							"from": map[string]any{
								"id":         5001,
								"username":   "alice",
								"first_name": "Alice",
								"is_bot":     false,
							},
						},
					},
					{
						"update_id": 22,
						"message": map[string]any{
							"message_id": 3,
							"text":       "hello after ignored updates",
							"chat": map[string]any{
								"id":    1001,
								"title": "Alice",
							},
							"from": map[string]any{
								"id":         5001,
								"username":   "alice",
								"first_name": "Alice",
								"is_bot":     false,
							},
						},
					},
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
		ID: "bot_004",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{"bot_token": "123:abc"},
	}

	handled := make([]InboundMessage, 0, 1)
	offsets := make([]string, 0, 3)
	err := provider.RunPolling(
		context.Background(),
		connection,
		func(_ context.Context, message InboundMessage) error {
			handled = append(handled, message)
			return nil
		},
		func(_ context.Context, settings map[string]string) error {
			offsets = append(offsets, settings[telegramUpdateOffsetSetting])
			if settings[telegramUpdateOffsetSetting] == "23" {
				return context.Canceled
			}
			return nil
		},
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected polling to stop with context.Canceled, got %v", err)
	}

	if len(handled) != 1 {
		t.Fatalf("expected one handled polling message, got %#v", handled)
	}
	if handled[0].Text != "hello after ignored updates" {
		t.Fatalf("unexpected handled polling message %#v", handled[0])
	}
	expectedOffsets := []string{"21", "22", "23"}
	if strings.Join(offsets, ",") != strings.Join(expectedOffsets, ",") {
		t.Fatalf("expected offset progression %#v, got %#v", expectedOffsets, offsets)
	}
}

func TestTelegramProviderSendMessagesRetriesRateLimitedRequests(t *testing.T) {
	t.Parallel()

	sendCalls := 0
	delays := make([]time.Duration, 0, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendMessage" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		sendCalls += 1
		if sendCalls == 1 {
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":          false,
				"error_code":  http.StatusTooManyRequests,
				"description": "Too Many Requests: retry after 3",
				"parameters": map[string]any{
					"retry_after": 3,
				},
			})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": 701,
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL
	provider.sleep = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		return nil
	}

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{{Text: "hello retry"}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if sendCalls != 2 {
		t.Fatalf("expected 2 sendMessage attempts, got %d", sendCalls)
	}
	if len(delays) != 1 || delays[0] != 3*time.Second {
		t.Fatalf("expected one retry-after delay of 3s, got %#v", delays)
	}
}

func TestTelegramProviderSendMessagesDoesNotRetryFatalClientErrors(t *testing.T) {
	t.Parallel()

	sendCalls := 0
	delays := make([]time.Duration, 0, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendMessage" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		sendCalls += 1
		w.WriteHeader(http.StatusBadRequest)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":          false,
			"error_code":  http.StatusBadRequest,
			"description": "Bad Request: chat not found",
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL
	provider.sleep = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		return nil
	}

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{{Text: "hello fatal"}})
	if err == nil {
		t.Fatal("expected SendMessages() to fail for fatal 400 response")
	}

	if sendCalls != 1 {
		t.Fatalf("expected exactly one sendMessage attempt, got %d", sendCalls)
	}
	if len(delays) != 0 {
		t.Fatalf("expected no retry delays for fatal client error, got %#v", delays)
	}
}

func TestTelegramStreamingReplySessionRetriesTransientEditAndDeleteFailures(t *testing.T) {
	t.Parallel()

	sendCalls := 0
	editCalls := 0
	deleteCalls := 0
	delays := make([]time.Duration, 0, 2)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			sendCalls += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 800 + sendCalls,
				},
			})
		case "/bot123:abc/editMessageText":
			editCalls += 1
			if editCalls == 1 {
				w.WriteHeader(http.StatusBadGateway)
				_, _ = w.Write([]byte("temporary upstream failure"))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 802,
				},
			})
		case "/bot123:abc/deleteMessage":
			deleteCalls += 1
			if deleteCalls == 1 {
				w.WriteHeader(http.StatusTooManyRequests)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"ok":          false,
					"error_code":  http.StatusTooManyRequests,
					"description": "Too Many Requests: retry after 1",
					"parameters": map[string]any{
						"retry_after": 1,
					},
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL
	provider.sleep = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		return nil
	}

	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{Text: "segment-1"},
			{Text: "segment-2"},
		},
	}); err != nil {
		t.Fatalf("Update(first) error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{Text: "segment-1"},
			{Text: "segment-2-updated"},
		},
	}); err != nil {
		t.Fatalf("Update(second) error = %v", err)
	}

	if err := session.Complete(context.Background(), []OutboundMessage{
		{Text: "segment-1"},
	}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if sendCalls != 2 {
		t.Fatalf("expected 2 initial sendMessage calls, got %d", sendCalls)
	}
	if editCalls != 2 {
		t.Fatalf("expected editMessageText to retry once, got %d calls", editCalls)
	}
	if deleteCalls != 2 {
		t.Fatalf("expected deleteMessage to retry once, got %d calls", deleteCalls)
	}
	if len(delays) != 2 {
		t.Fatalf("expected 2 retry delays, got %#v", delays)
	}
	if delays[0] != telegramDeliveryRetryBase {
		t.Fatalf("expected first delay %s, got %#v", telegramDeliveryRetryBase, delays)
	}
	if delays[1] != 1*time.Second {
		t.Fatalf("expected second delay 1s, got %#v", delays)
	}
}
