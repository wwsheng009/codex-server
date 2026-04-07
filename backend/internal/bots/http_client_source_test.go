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

func TestWeChatProviderResolvesRemoteHTMLMediaViaRuntimeOutboundProxy(t *testing.T) {
	t.Parallel()

	const (
		storyURL      = "http://media.example.test/story"
		videoURL      = "http://media.example.test/video.mp4"
		wechatAPIBase = "http://wechat.api.test"
		wechatCDNBase = "http://wechat.cdn.test/c2c"
		uploadParam   = "upload-param-proxy-video-1"
	)

	observedURLs := make([]string, 0, 8)
	sendCalls := 0
	proxyServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedURLs = append(observedURLs, r.URL.String())

		switch {
		case r.URL.String() == storyURL:
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><meta property="og:video" content="` + videoURL + `"></head><body>story</body></html>`))
		case r.URL.String() == videoURL:
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write([]byte("proxied remote video bytes"))
		case r.URL.String() == wechatAPIBase+"/ilink/bot/getuploadurl":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getuploadurl payload: %v", err)
			}
			if got := int(payload["media_type"].(float64)); got != wechatUploadMediaTypeVideo {
				t.Fatalf("expected proxied getuploadurl media_type video, got %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":          0,
				"errcode":      0,
				"errmsg":       "",
				"upload_param": uploadParam,
			})
		case strings.HasPrefix(r.URL.String(), wechatCDNBase+"/upload?"):
			if got := r.URL.Query().Get("encrypted_query_param"); got != uploadParam {
				t.Fatalf("expected proxied upload encrypted_query_param %q, got %q", uploadParam, got)
			}
			w.Header().Set("x-encrypted-param", "download-param-proxy-video-1")
			w.WriteHeader(http.StatusOK)
		case r.URL.String() == wechatAPIBase+"/ilink/bot/sendmessage":
			sendCalls += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected proxied URL %q", r.URL.String())
		}
	}))
	defer proxyServer.Close()

	dataStore := store.NewMemoryStore()
	dataStore.SetRuntimePreferences(store.RuntimePreferences{
		OutboundProxyURL: proxyServer.URL,
	})

	provider := newWeChatProviderWithClientSource(newRuntimeHTTPClientSource(dataStore, "")).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_proxy_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      wechatAPIBase,
			wechatCDNBaseURLSetting:   wechatCDNBase,
			wechatAccountIDSetting:    "wechat-account-proxy-1",
			wechatOwnerUserIDSetting:  "wechat-owner-proxy-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-proxy-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-proxy-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "proxy media",
			Media: []store.BotMessageMedia{
				{
					Kind: botMediaKindVideo,
					URL:  storyURL,
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if sendCalls != 2 {
		t.Fatalf("expected caption plus media send through proxy, got %d send calls", sendCalls)
	}
	joined := strings.Join(observedURLs, "\n")
	if !strings.Contains(joined, storyURL) {
		t.Fatalf("expected proxy to observe story URL fetch, got %#v", observedURLs)
	}
	if !strings.Contains(joined, videoURL) {
		t.Fatalf("expected proxy to observe extracted video URL fetch, got %#v", observedURLs)
	}
	if !strings.Contains(joined, wechatAPIBase+"/ilink/bot/getuploadurl") {
		t.Fatalf("expected proxy to observe wechat getuploadurl, got %#v", observedURLs)
	}
}
