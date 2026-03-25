package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

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
