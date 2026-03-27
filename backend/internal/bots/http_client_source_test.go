package bots

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"codex-server/backend/internal/store"
)

func TestTelegramProviderUsesRuntimeOutboundProxy(t *testing.T) {
	t.Parallel()

	var observedURL string
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedURL = r.URL.String()
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"id":         42,
				"first_name": "Proxy Bot",
				"username":   "proxy_bot",
			},
		})
	}))
	defer proxyServer.Close()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		OutboundProxyURL: proxyServer.URL,
	})

	provider := newTelegramProviderWithClientSource(newRuntimeHTTPClientSource(dataStore, "")).(*telegramProvider)
	provider.apiBaseURL = "http://api.telegram.test"

	info, err := provider.getMe(context.Background(), "123:abc")
	if err != nil {
		t.Fatalf("getMe() error = %v", err)
	}
	if info.Username != "proxy_bot" {
		t.Fatalf("unexpected bot info %#v", info)
	}
	if observedURL != "http://api.telegram.test/bot123:abc/getMe" {
		t.Fatalf("expected request to pass through proxy, got %q", observedURL)
	}
}

func TestOpenAIResponsesBackendUsesRuntimeOutboundProxy(t *testing.T) {
	t.Parallel()

	var observedURL string
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedURL = r.URL.String()
		if got := r.Header.Get("Authorization"); got != "Bearer sk-test" {
			t.Fatalf("expected Authorization header through proxy, got %q", got)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "resp_proxy",
			"output": []map[string]any{
				{
					"type": "message",
					"role": "assistant",
					"content": []map[string]any{
						{"type": "output_text", "text": "proxied response"},
					},
				},
			},
		})
	}))
	defer proxyServer.Close()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		OutboundProxyURL: proxyServer.URL,
	})

	backend := newOpenAIResponsesBackendWithClientSource(newRuntimeHTTPClientSource(dataStore, "")).(*openAIResponsesBackend)

	result, err := backend.ProcessMessage(context.Background(), store.BotConnection{
		AIConfig: map[string]string{
			"model": "gpt-5.4",
		},
		Settings: map[string]string{
			"openai_base_url": "http://api.openai.test/v1/responses",
		},
		Secrets: map[string]string{
			"openai_api_key": "sk-test",
		},
	}, store.BotConversation{}, InboundMessage{
		Text: "hello",
	})
	if err != nil {
		t.Fatalf("ProcessMessage() error = %v", err)
	}
	if observedURL != "http://api.openai.test/v1/responses" {
		t.Fatalf("expected request to pass through proxy, got %q", observedURL)
	}
	if len(result.Messages) != 1 || result.Messages[0].Text != "proxied response" {
		t.Fatalf("unexpected result %#v", result)
	}
}
