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

	"github.com/gorilla/websocket"
)

func TestFeishuActivateRequiresCredentials(t *testing.T) {
	provider := newFeishuProvider(nil).(*feishuProvider)
	_, err := provider.Activate(context.Background(), store.BotConnection{
		Provider: feishuProviderName,
		Settings: map[string]string{},
		Secrets:  map[string]string{},
	}, "")
	if err == nil || !strings.Contains(err.Error(), "feishu app id is required") {
		t.Fatalf("expected missing app id error, got %v", err)
	}
}

func TestFeishuActivateFetchesBotInfo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case feishuBotInfoEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"bot": map[string]any{
					"open_id": "ou_bot_123",
					"name":    "Ops Bot",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	activation, err := provider.Activate(context.Background(), store.BotConnection{
		Provider: feishuProviderName,
		Name:     "Ops Bot",
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, "")
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	if activation.Settings["bot_open_id"] != "ou_bot_123" {
		t.Fatalf("expected bot open id, got %#v", activation.Settings)
	}
}

func TestFeishuActivateWebhookSetsWebhookURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case feishuBotInfoEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"bot": map[string]any{
					"open_id": "ou_bot_123",
					"name":    "Ops Bot",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	activation, err := provider.Activate(context.Background(), store.BotConnection{
		ID:       "conn_feishu_webhook",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:        "app_123",
			feishuDomainSetting:       server.URL,
			feishuDeliveryModeSetting: feishuDeliveryModeWebhook,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, "https://bots.example.com/base/")
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	if activation.Settings["webhook_url"] != "https://bots.example.com/base/hooks/bots/conn_feishu_webhook" {
		t.Fatalf("expected webhook url, got %#v", activation.Settings)
	}
}

func TestFeishuActivateWebhookRequiresPublicBaseURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case feishuBotInfoEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"bot": map[string]any{
					"open_id": "ou_bot_123",
					"name":    "Ops Bot",
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	_, err := provider.Activate(context.Background(), store.BotConnection{
		ID:       "conn_feishu_webhook",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:        "app_123",
			feishuDomainSetting:       server.URL,
			feishuDeliveryModeSetting: feishuDeliveryModeWebhook,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, "")
	if !errors.Is(err, ErrPublicBaseURLMissing) {
		t.Fatalf("expected ErrPublicBaseURLMissing, got %v", err)
	}
}

func TestFeishuRunPollingParsesInboundMessage(t *testing.T) {
	upgrader := websocket.Upgrader{}
	var wsURL string
	wsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("Upgrade() error = %v", err)
		}
		defer conn.Close()
		eventPayload, err := json.Marshal(map[string]any{
			"header": map[string]any{
				"event_type": "im.message.receive_v1",
			},
			"event": map[string]any{
				"sender": map[string]any{
					"sender_id": map[string]any{
						"open_id": "ou_user_123",
					},
				},
				"message": map[string]any{
					"message_id":   "om_123",
					"chat_id":      "oc_chat_456",
					"chat_type":    "group",
					"message_type": "text",
					"content":      `{"text":"@Bot hello"}`,
					"mentions": []map[string]any{
						{"id": map[string]any{"open_id": "ou_bot_999"}},
					},
					"thread_id": "om_thread_789",
				},
			},
		})
		if err != nil {
			t.Fatalf("json.Marshal(eventPayload) error = %v", err)
		}
		if err := writeFeishuFrame(conn, feishuWSFrame{
			SeqID:           1,
			LogID:           1,
			Service:         1,
			Method:          feishuWSFrameMethodData,
			Headers:         []feishuWSHeader{{Key: feishuWSHeaderType, Value: feishuWSHeaderEvent}},
			PayloadEncoding: "json",
			PayloadType:     "string",
			Payload:         eventPayload,
		}); err != nil {
			t.Fatalf("writeFeishuFrame() error = %v", err)
		}
		<-time.After(50 * time.Millisecond)
	}))
	defer wsServer.Close()
	wsURL = "ws" + strings.TrimPrefix(wsServer.URL, "http")

	apiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case feishuWebsocketConnectEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"url": wsURL,
				},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer apiServer.Close()

	provider := newFeishuProvider(apiServer.Client()).(*feishuProvider)
	connection := store.BotConnection{
		ID:       "conn_feishu_1",
		Provider: feishuProviderName,
		Status:   "active",
		Settings: map[string]string{
			feishuAppIDSetting:                 "app_123",
			feishuDomainSetting:                apiServer.URL,
			feishuThreadIsolationSetting:       "true",
			feishuShareSessionInChannelSetting: "false",
			"bot_open_id":                      "ou_bot_999",
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var inbound InboundMessage
	err := provider.RunPolling(ctx, connection, func(_ context.Context, message InboundMessage) error {
		inbound = message
		cancel()
		return nil
	}, nil, nil)
	if err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("RunPolling() error = %v", err)
	}
	if inbound.ConversationID != "chat:oc_chat_456:root:om_thread_789" {
		t.Fatalf("unexpected conversation id: %#v", inbound)
	}
	if inbound.ProviderData["feishu_chat_id"] != "oc_chat_456" {
		t.Fatalf("expected provider state, got %#v", inbound.ProviderData)
	}
}

func TestFeishuParseWebhookResultHandlesChallenge(t *testing.T) {
	provider := newFeishuProvider(nil).(*feishuProvider)
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/feishu", strings.NewReader(`{
		"type":"url_verification",
		"challenge":"challenge-token-1"
	}`))
	result, messages, err := provider.ParseWebhookResult(request, store.BotConnection{
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuDeliveryModeSetting: feishuDeliveryModeWebhook,
		},
	})
	if err != nil {
		t.Fatalf("ParseWebhookResult() error = %v", err)
	}
	if len(messages) != 0 {
		t.Fatalf("expected no inbound messages for challenge, got %#v", messages)
	}
	payload, ok := result.Body.(map[string]string)
	if !ok {
		t.Fatalf("expected raw challenge response body, got %#v", result.Body)
	}
	if payload["challenge"] != "challenge-token-1" {
		t.Fatalf("expected challenge echo, got %#v", payload)
	}
}

func TestFeishuSendMessagesReplyFallback(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path+"?"+r.URL.RawQuery)
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			http.Error(w, "not available", http.StatusBadRequest)
		case "/open-apis/im/v1/messages":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"code":0}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_1",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_456",
		ProviderState: map[string]string{
			"feishu_chat_id":    "oc_chat_456",
			"feishu_message_id": "om_123",
		},
	}, []OutboundMessage{{Text: "hello"}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}
	if len(paths) < 3 || !strings.Contains(paths[1], "/reply") || !strings.Contains(paths[2], "receive_id_type=chat_id") {
		t.Fatalf("expected reply then create fallback, got %#v", paths)
	}
}

func TestFeishuSendMessagesUsesInteractiveCardWhenEnabled(t *testing.T) {
	var payload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages":
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu interactive payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_2",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:       "app_123",
			feishuDomainSetting:      server.URL,
			feishuEnableCardsSetting: "true",
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_456",
		ProviderState: map[string]string{
			feishuChatIDKey: "oc_chat_456",
		},
	}, []OutboundMessage{{Text: "hello **card**"}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}
	if payload["msg_type"] != "interactive" {
		t.Fatalf("expected interactive card message, got %#v", payload)
	}
	content, _ := payload["content"].(string)
	if !strings.Contains(content, `"schema":"2.0"`) {
		t.Fatalf("expected card schema payload, got %#v", payload)
	}
}
