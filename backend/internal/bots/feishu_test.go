package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
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

func TestFeishuRunPollingParsesApprovalInstanceEvent(t *testing.T) {
	upgrader := websocket.Upgrader{}
	var wsURL string
	wsServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Fatalf("Upgrade() error = %v", err)
		}
		defer conn.Close()

		eventPayload, err := json.Marshal(map[string]any{
			"ts":    "1502199207.7171419",
			"uuid":  "evt_uuid_1",
			"token": "token_1",
			"type":  "event_callback",
			"event": map[string]any{
				"app_id":                "cli_approval_1",
				"tenant_key":            "tenant_1",
				"type":                  "approval_instance",
				"approval_code":         "APPROVAL_CODE_1",
				"instance_code":         "INSTANCE_CODE_1",
				"status":                "PENDING",
				"operate_time":          "1666079207003",
				"instance_operate_time": "1666079207003",
				"uuid":                  "event_body_uuid_1",
			},
		})
		if err != nil {
			t.Fatalf("Marshal() error = %v", err)
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
		ID:       "conn_feishu_approval_poll_1",
		Provider: feishuProviderName,
		Status:   "active",
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: apiServer.URL,
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
	if inbound.ConversationID != "approval:APPROVAL_CODE_1:instance:INSTANCE_CODE_1" {
		t.Fatalf("unexpected approval conversation id: %#v", inbound)
	}
	if inbound.ProviderData[feishuApprovalStatusKey] != "PENDING" {
		t.Fatalf("expected approval status provider data, got %#v", inbound.ProviderData)
	}
	if !strings.Contains(inbound.Text, "INSTANCE_CODE_1") || !strings.Contains(inbound.Text, "PENDING") {
		t.Fatalf("expected approval event text, got %#v", inbound)
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

func TestFeishuParseWebhookResultParsesApprovalInstanceEvent(t *testing.T) {
	provider := newFeishuProvider(nil).(*feishuProvider)
	request := httptest.NewRequest(http.MethodPost, "/hooks/bots/feishu", strings.NewReader(`{
		"ts":"1502199207.7171419",
		"uuid":"evt_uuid_1",
		"token":"token_1",
		"type":"event_callback",
		"event":{
			"app_id":"cli_approval_1",
			"tenant_key":"tenant_1",
			"type":"approval_instance",
			"approval_code":"APPROVAL_CODE_1",
			"instance_code":"INSTANCE_CODE_1",
			"status":"APPROVED",
			"operate_time":"1666079207003",
			"instance_operate_time":"1666079207003",
			"uuid":"event_body_uuid_1"
		}
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
	if result.StatusCode != 0 {
		t.Fatalf("expected no custom response status, got %#v", result)
	}
	if len(messages) != 1 {
		t.Fatalf("expected one approval inbound message, got %#v", messages)
	}
	if messages[0].ConversationID != "approval:APPROVAL_CODE_1:instance:INSTANCE_CODE_1" {
		t.Fatalf("unexpected approval conversation id: %#v", messages[0])
	}
	if messages[0].ProviderData[feishuApprovalStatusKey] != "APPROVED" {
		t.Fatalf("expected approval status provider data, got %#v", messages[0].ProviderData)
	}
}

func TestFeishuParseEventPayloadParsesApprovalUpdatedEvent(t *testing.T) {
	provider := newFeishuProvider(nil).(*feishuProvider)
	payload, err := json.Marshal(map[string]any{
		"schema": "2.0",
		"header": map[string]any{
			"event_id":   "evt_approval_updated_1",
			"event_type": "approval.approval.updated_v4",
			"app_id":     "cli_approval_1",
			"tenant_key": "tenant_1",
		},
		"event": map[string]any{
			"object": map[string]any{
				"approval_id":        "approval_id_1",
				"approval_code":      "APPROVAL_CODE_1",
				"version_id":         "version_2",
				"form_definition_id": "form_3",
				"timestamp":          "1736763698",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	inbound, err := provider.parseFeishuEventPayload(payload, store.BotConnection{
		Provider: feishuProviderName,
	})
	if err != nil {
		t.Fatalf("parseFeishuEventPayload() error = %v", err)
	}
	if inbound.ConversationID != "approval-definition:APPROVAL_CODE_1" {
		t.Fatalf("unexpected approval definition conversation id: %#v", inbound)
	}
	if inbound.MessageID != "evt_approval_updated_1" {
		t.Fatalf("expected event id to become message id, got %#v", inbound)
	}
	if inbound.ProviderData[feishuEventTypeKey] != "approval.approval.updated_v4" {
		t.Fatalf("expected approval updated event type, got %#v", inbound.ProviderData)
	}
	if !strings.Contains(inbound.Text, "Version ID: version_2") {
		t.Fatalf("expected version id in approval updated text, got %#v", inbound)
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

func TestFeishuStartTypingAddsAndRemovesReaction(t *testing.T) {
	var paths []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reactions":
			if r.Method != http.MethodPost {
				t.Fatalf("expected POST reaction create, got %s", r.Method)
			}
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatalf("decode reaction create body: %v", err)
			}
			reactionType, _ := body["reaction_type"].(map[string]any)
			if reactionType["emoji_type"] != feishuTypingReactionEmojiType {
				t.Fatalf("unexpected reaction payload %#v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"reaction_id": "reaction_123",
				},
			})
		case "/open-apis/im/v1/messages/om_123/reactions/reaction_123":
			if r.Method != http.MethodDelete {
				t.Fatalf("expected DELETE reaction remove, got %s", r.Method)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartTyping(context.Background(), store.BotConnection{
		ID:       "conn_feishu_typing_1",
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
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartTyping() error = %v", err)
	}
	if session == nil {
		t.Fatal("expected typing session")
	}
	if err := session.Stop(context.Background()); err != nil {
		t.Fatalf("Stop() error = %v", err)
	}
	if len(paths) != 3 || !strings.Contains(paths[1], "/reactions") || !strings.Contains(paths[2], "/reactions/reaction_123") {
		t.Fatalf("expected token, create reaction, delete reaction sequence, got %#v", paths)
	}
}

func TestFeishuStartTypingWithoutReplyMessageReturnsNilSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		default:
			t.Fatalf("unexpected request path %q", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartTyping(context.Background(), store.BotConnection{
		ID:       "conn_feishu_typing_2",
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
			feishuChatIDKey: "oc_chat_456",
		},
	})
	if err != nil {
		t.Fatalf("StartTyping() error = %v", err)
	}
	if session != nil {
		t.Fatalf("expected nil typing session, got %#v", session)
	}
}

func TestFeishuStreamingReplySessionEmitsApprovalSnapshotBeforeCompletion(t *testing.T) {
	var replyPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			messageID := "om_stream_1"
			if len(replyPayloads) > 1 {
				messageID = "om_stream_2"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": messageID}})
		case "/open-apis/im/v1/messages/om_stream_1", "/open-apis/im/v1/messages/om_stream_2":
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_1",
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
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "working"}},
	}); err != nil {
		t.Fatalf("Update(partial) error = %v", err)
	}
	if len(replyPayloads) != 0 {
		t.Fatalf("expected partial single-message update to stay buffered, got %#v", replyPayloads)
	}

	pendingApprovalText := "Command Approval: dir [Pending]\nRequest ID: req_123\nReply with /approve req_123\nReply with /decline req_123"
	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: pendingApprovalText}},
	}); err != nil {
		t.Fatalf("Update(approval) error = %v", err)
	}
	if len(replyPayloads) != 1 {
		t.Fatalf("expected one approval snapshot send before completion, got %#v", replyPayloads)
	}
	approvalContent, _ := replyPayloads[0]["content"].(string)
	if !strings.Contains(approvalContent, "req_123") {
		t.Fatalf("expected approval snapshot to include request id, got %#v", replyPayloads[0])
	}

	if err := session.Complete(context.Background(), []OutboundMessage{{Text: "All done"}}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if len(replyPayloads) != 2 {
		t.Fatalf("expected final completion to send a new reply after approval snapshot, got %#v", replyPayloads)
	}
	finalContent, _ := replyPayloads[1]["content"].(string)
	if !strings.Contains(finalContent, "All done") {
		t.Fatalf("expected final completion payload, got %#v", replyPayloads[1])
	}
}

func TestFeishuStreamingReplySessionEmitsFeishuToolProgressBeforeCompletion(t *testing.T) {
	var replyPayloads []map[string]any
	var patchPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": "om_stream_progress_1"}})
		case "/open-apis/im/v1/messages/om_stream_progress_1":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu patch payload error = %v", err)
			}
			patchPayloads = append(patchPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_progress_1",
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
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	progressText := "Feishu Sheet · Append Rows [Writing]\nAppending rows to sheet"
	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: progressText}},
	}); err != nil {
		t.Fatalf("Update(progress) error = %v", err)
	}
	if len(replyPayloads) != 1 {
		t.Fatalf("expected one tool progress snapshot send before completion, got %#v", replyPayloads)
	}
	progressContent, _ := replyPayloads[0]["content"].(string)
	if !strings.Contains(progressContent, "Feishu Sheet · Append Rows") {
		t.Fatalf("expected tool progress snapshot content, got %#v", replyPayloads[0])
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "Feishu Sheet · Append Rows [Writing]\nstep 2"}},
	}); err != nil {
		t.Fatalf("Update(progress step2) error = %v", err)
	}
	if len(replyPayloads) != 1 || len(patchPayloads) != 1 {
		t.Fatalf("expected tool progress to update the same streaming message, got replies=%#v patches=%#v", replyPayloads, patchPayloads)
	}
	progressPatchContent, _ := patchPayloads[0]["content"].(string)
	if !strings.Contains(progressPatchContent, "step 2") {
		t.Fatalf("expected tool progress patch payload, got %#v", patchPayloads[0])
	}

	if err := session.Complete(context.Background(), []OutboundMessage{{Text: "All done"}}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if len(replyPayloads) != 2 || len(patchPayloads) != 1 {
		t.Fatalf("expected final completion to preserve progress and send a new reply, got replies=%#v patches=%#v", replyPayloads, patchPayloads)
	}
	finalContent, _ := replyPayloads[1]["content"].(string)
	if !strings.Contains(finalContent, "All done") {
		t.Fatalf("expected final completion payload, got %#v", replyPayloads[1])
	}
}

func TestFeishuStreamingReplySessionKeepsPlanUpdatesOnOneMessage(t *testing.T) {
	var replyPayloads []map[string]any
	var patchPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			messageID := "om_stream_plan_1"
			if len(replyPayloads) > 1 {
				messageID = "om_stream_plan_2"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": messageID}})
		case "/open-apis/im/v1/messages/om_stream_plan_1":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu patch payload error = %v", err)
			}
			patchPayloads = append(patchPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_plan_1",
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
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "Plan:\n1. Inspect logs"}},
	}); err != nil {
		t.Fatalf("Update(plan step1) error = %v", err)
	}
	if len(replyPayloads) != 1 || len(patchPayloads) != 0 {
		t.Fatalf("expected first plan snapshot to send one reply, got replies=%#v patches=%#v", replyPayloads, patchPayloads)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "Plan:\n1. Inspect logs\n2. Verify Feishu delivery"}},
	}); err != nil {
		t.Fatalf("Update(plan step2) error = %v", err)
	}
	if len(replyPayloads) != 1 || len(patchPayloads) != 1 {
		t.Fatalf("expected second plan snapshot to patch the same reply, got replies=%#v patches=%#v", replyPayloads, patchPayloads)
	}

	if err := session.Complete(context.Background(), []OutboundMessage{{Text: "All done"}}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if len(replyPayloads) != 2 || len(patchPayloads) != 1 {
		t.Fatalf("expected final completion to send a new reply after plan updates, got replies=%#v patches=%#v", replyPayloads, patchPayloads)
	}
	finalContent, _ := replyPayloads[1]["content"].(string)
	if !strings.Contains(finalContent, "All done") {
		t.Fatalf("expected final completion payload, got %#v", replyPayloads[1])
	}
}

func TestFeishuStreamingReplySessionFallsBackToNewReplyWhenPatchFails(t *testing.T) {
	var replyPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			messageID := "om_stream_patch_fail_1"
			if len(replyPayloads) > 1 {
				messageID = "om_stream_patch_fail_2"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": messageID}})
		case "/open-apis/im/v1/messages/om_stream_patch_fail_1":
			http.Error(w, "patch disabled", http.StatusForbidden)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_patch_fail_1",
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
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "Feishu Sheet · Append Rows [Writing]\nstep 1"}},
	}); err != nil {
		t.Fatalf("Update(step1) error = %v", err)
	}
	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "Feishu Sheet · Append Rows [Writing]\nstep 2"}},
	}); err != nil {
		t.Fatalf("Update(step2) error = %v", err)
	}

	if len(replyPayloads) != 2 {
		t.Fatalf("expected fallback to second reply after patch failure, got %#v", replyPayloads)
	}
	secondContent, _ := replyPayloads[1]["content"].(string)
	if !strings.Contains(secondContent, "step 2") {
		t.Fatalf("expected fallback reply to include final text, got %#v", replyPayloads[1])
	}
}

func TestFeishuStreamingReplySessionSmartPreserveSplitsPlainTextAcrossReplies(t *testing.T) {
	var replyPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": fmt.Sprintf("om_plain_%d", len(replyPayloads))}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_plain_1",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:                      "app_123",
			feishuDomainSetting:                     server.URL,
			feishuStreamingPlainTextStrategySetting: feishuStreamingPlainTextStrategySmartPreserve,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_456",
		ProviderState: map[string]string{
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	firstChunk := strings.Repeat("A", 180) + ".\n\nSecond chunk starts"
	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: firstChunk}},
	}); err != nil {
		t.Fatalf("Update(firstChunk) error = %v", err)
	}
	if len(replyPayloads) != 1 {
		t.Fatalf("expected one preserved chunk reply, got %#v", replyPayloads)
	}
	firstContent, _ := replyPayloads[0]["content"].(string)
	if !strings.Contains(firstContent, strings.Repeat("A", 180)) {
		t.Fatalf("expected first preserved chunk to be sent, got %#v", replyPayloads[0])
	}
	if strings.Contains(firstContent, "Second chunk starts") {
		t.Fatalf("did not expect partial second chunk in preserved reply, got %#v", replyPayloads[0])
	}

	finalText := strings.Repeat("A", 180) + ".\n\nSecond chunk starts and finishes here."
	if err := session.Complete(context.Background(), []OutboundMessage{{Text: finalText}}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if len(replyPayloads) != 2 {
		t.Fatalf("expected final remainder reply after preserved chunk, got %#v", replyPayloads)
	}
	finalContent, _ := replyPayloads[1]["content"].(string)
	if strings.Contains(finalContent, strings.Repeat("A", 180)) {
		t.Fatalf("did not expect committed prefix to repeat in final remainder, got %#v", replyPayloads[1])
	}
	if !strings.Contains(finalContent, "Second chunk starts and finishes here.") {
		t.Fatalf("expected final remainder content, got %#v", replyPayloads[1])
	}
}

func TestFeishuStreamingReplySessionUpdateOnlyKeepsPlainTextBufferedUntilCompletion(t *testing.T) {
	var replyPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": "om_plain_final_1"}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_plain_2",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:                      "app_123",
			feishuDomainSetting:                     server.URL,
			feishuStreamingPlainTextStrategySetting: feishuStreamingPlainTextStrategyUpdateOnly,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_456",
		ProviderState: map[string]string{
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: strings.Repeat("buffered text ", 16)}},
	}); err != nil {
		t.Fatalf("Update(buffered) error = %v", err)
	}
	if len(replyPayloads) != 0 {
		t.Fatalf("expected update_only strategy to keep plain text buffered, got %#v", replyPayloads)
	}

	finalText := strings.Repeat("buffered text ", 16) + "done."
	if err := session.Complete(context.Background(), []OutboundMessage{{Text: finalText}}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}
	if len(replyPayloads) != 1 {
		t.Fatalf("expected final plain text reply on completion, got %#v", replyPayloads)
	}
	finalContent, _ := replyPayloads[0]["content"].(string)
	if !strings.Contains(finalContent, "done.") {
		t.Fatalf("expected final buffered content, got %#v", replyPayloads[0])
	}
}

func TestFeishuStreamingReplySessionAppendDeltaEmitsOnlyNewPlainTextReplies(t *testing.T) {
	var replyPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_123/reply":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu streaming payload error = %v", err)
			}
			replyPayloads = append(replyPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0, "data": map[string]any{"message_id": fmt.Sprintf("om_plain_append_%d", len(replyPayloads))}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		ID:       "conn_feishu_stream_plain_3",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:                      "app_123",
			feishuDomainSetting:                     server.URL,
			feishuStreamingPlainTextStrategySetting: feishuStreamingPlainTextStrategyAppendDelta,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_456",
		ProviderState: map[string]string{
			feishuChatIDKey:    "oc_chat_456",
			feishuMessageIDKey: "om_123",
		},
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "First chunk"}},
	}); err != nil {
		t.Fatalf("Update(first chunk) error = %v", err)
	}
	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "First chunk second chunk"}},
	}); err != nil {
		t.Fatalf("Update(second chunk) error = %v", err)
	}
	if err := session.Complete(context.Background(), []OutboundMessage{{Text: "First chunk second chunk final chunk"}}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if len(replyPayloads) != 3 {
		t.Fatalf("expected append_delta to send three incremental replies, got %#v", replyPayloads)
	}
	firstContent, _ := replyPayloads[0]["content"].(string)
	secondContent, _ := replyPayloads[1]["content"].(string)
	finalContent, _ := replyPayloads[2]["content"].(string)
	if !strings.Contains(firstContent, "First chunk") {
		t.Fatalf("expected first payload to contain initial text, got %#v", replyPayloads[0])
	}
	if strings.Contains(secondContent, "First chunk") || !strings.Contains(secondContent, "second chunk") {
		t.Fatalf("expected second payload to contain only appended text, got %#v", replyPayloads[1])
	}
	if strings.Contains(finalContent, "First chunk") || strings.Contains(finalContent, "second chunk") || !strings.Contains(finalContent, "final chunk") {
		t.Fatalf("expected final payload to contain only the final append, got %#v", replyPayloads[2])
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

func TestBuildFeishuCardJSONWrapsMarkdownTablesAsCodeBlocks(t *testing.T) {
	cardJSON := buildFeishuCardJSON("总结如下：\n\n| Name | Value |\n| --- | --- |\n| foo | bar |")

	var card struct {
		Body struct {
			Elements []struct {
				Content string `json:"content"`
			} `json:"elements"`
		} `json:"body"`
	}
	if err := json.Unmarshal([]byte(cardJSON), &card); err != nil {
		t.Fatalf("unmarshal card json error = %v", err)
	}
	if len(card.Body.Elements) != 1 {
		t.Fatalf("expected one card element, got %#v", card.Body.Elements)
	}
	content := card.Body.Elements[0].Content
	expected := "```text\n| Name | Value |\n| --- | --- |\n| foo | bar |\n```"
	if !strings.Contains(content, expected) {
		t.Fatalf("expected markdown table to be wrapped as code block, got %q", content)
	}
}

func TestFeishuSendMessagesFallsBackToTextWhenCardTableLimitTriggered(t *testing.T) {
	var payloads []map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode feishu payload error = %v", err)
			}
			payloads = append(payloads, payload)
			if payload["msg_type"] == "interactive" {
				http.Error(w, "Failed to create card content, ext=ErrCode: 11310; ErrMsg: card table number over limit; ErrorValue: table;", http.StatusBadRequest)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_card_limit_1",
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
	}, []OutboundMessage{{
		Text: "结果如下：\n\n| Name | Value |\n| --- | --- |\n| foo | bar |",
	}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if len(payloads) != 2 {
		t.Fatalf("expected interactive send plus text fallback, got %#v", payloads)
	}
	if payloads[0]["msg_type"] != "interactive" {
		t.Fatalf("expected first payload to be interactive, got %#v", payloads[0])
	}
	if payloads[1]["msg_type"] != "text" {
		t.Fatalf("expected second payload to fall back to text, got %#v", payloads[1])
	}
	content, _ := payloads[1]["content"].(string)
	if !strings.Contains(content, `| Name | Value |`) {
		t.Fatalf("expected text fallback to preserve table text, got %#v", payloads[1])
	}
}

func TestFeishuSendMessagesUploadsImageAndFile(t *testing.T) {
	tmpDir := t.TempDir()
	imagePath := filepath.Join(tmpDir, "chart.png")
	filePath := filepath.Join(tmpDir, "report.pdf")
	if err := os.WriteFile(imagePath, []byte{0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n', 'a'}, 0o600); err != nil {
		t.Fatalf("WriteFile(image) error = %v", err)
	}
	if err := os.WriteFile(filePath, []byte("%PDF-1.7\nreport\n"), 0o600); err != nil {
		t.Fatalf("WriteFile(file) error = %v", err)
	}

	var sentPayloads []map[string]any
	var imageUploadFields map[string]string
	var fileUploadFields map[string]string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/images":
			fields, err := readMultipartFields(r)
			if err != nil {
				t.Fatalf("read image multipart fields error = %v", err)
			}
			imageUploadFields = fields
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"image_key": "img_key_123",
				},
			})
		case "/open-apis/im/v1/files":
			fields, err := readMultipartFields(r)
			if err != nil {
				t.Fatalf("read file multipart fields error = %v", err)
			}
			fileUploadFields = fields
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"file_key": "file_key_456",
				},
			})
		case "/open-apis/im/v1/messages":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode send payload error = %v", err)
			}
			sentPayloads = append(sentPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_media_1",
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
			feishuChatIDKey: "oc_chat_456",
		},
	}, []OutboundMessage{{
		Text: "attachments ready",
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindImage, Path: imagePath},
			{Kind: botMediaKindFile, Path: filePath},
		},
	}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if len(sentPayloads) != 3 {
		t.Fatalf("expected 3 outbound Feishu messages, got %#v", sentPayloads)
	}
	if sentPayloads[0]["msg_type"] != "text" {
		t.Fatalf("expected text payload first, got %#v", sentPayloads[0])
	}
	if sentPayloads[1]["msg_type"] != "image" {
		t.Fatalf("expected image payload second, got %#v", sentPayloads[1])
	}
	if sentPayloads[2]["msg_type"] != "file" {
		t.Fatalf("expected file payload third, got %#v", sentPayloads[2])
	}
	if got := imageUploadFields["image_type"]; got != "message" {
		t.Fatalf("expected image_type=message, got %#v", imageUploadFields)
	}
	if got := imageUploadFields["image"]; got != "chart.png" {
		t.Fatalf("expected uploaded image filename chart.png, got %#v", imageUploadFields)
	}
	if got := fileUploadFields["file_type"]; got != "pdf" {
		t.Fatalf("expected uploaded file_type=pdf, got %#v", fileUploadFields)
	}
	if got := fileUploadFields["file_name"]; got != "report.pdf" {
		t.Fatalf("expected uploaded file_name report.pdf, got %#v", fileUploadFields)
	}
	if got := fileUploadFields["file"]; got != "report.pdf" {
		t.Fatalf("expected uploaded file part report.pdf, got %#v", fileUploadFields)
	}
}

func TestFeishuSendMessagesUploadsVoiceAsAudioMessage(t *testing.T) {
	tmpDir := t.TempDir()
	voicePath := filepath.Join(tmpDir, "voice.ogg")
	if err := os.WriteFile(voicePath, []byte("OggSvoice-bytes"), 0o600); err != nil {
		t.Fatalf("WriteFile(voice) error = %v", err)
	}

	var uploadFields map[string]string
	var sentPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/files":
			fields, err := readMultipartFields(r)
			if err != nil {
				t.Fatalf("read voice multipart fields error = %v", err)
			}
			uploadFields = fields
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"file_key": "voice_key_123",
				},
			})
		case "/open-apis/im/v1/messages":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode send payload error = %v", err)
			}
			sentPayloads = append(sentPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_voice_1",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_voice_1",
		ProviderState: map[string]string{
			feishuChatIDKey: "oc_chat_voice_1",
		},
	}, []OutboundMessage{{
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindVoice, Path: voicePath, ContentType: "audio/ogg"},
		},
	}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if got := uploadFields["file_type"]; got != "opus" {
		t.Fatalf("expected voice upload file_type opus, got %#v", uploadFields)
	}
	if got := uploadFields["file_name"]; got != "voice.ogg" {
		t.Fatalf("expected voice upload file_name voice.ogg, got %#v", uploadFields)
	}
	if len(sentPayloads) != 1 || sentPayloads[0]["msg_type"] != "audio" {
		t.Fatalf("expected one audio outbound message, got %#v", sentPayloads)
	}
}

func TestFeishuSendMessagesTranscodesUnsupportedVoiceFormat(t *testing.T) {
	tmpDir := t.TempDir()
	voicePath := filepath.Join(tmpDir, "voice.mp3")
	if err := os.WriteFile(voicePath, []byte("ID3voice"), 0o600); err != nil {
		t.Fatalf("WriteFile(voice) error = %v", err)
	}

	originalLookPath := lookPathFeishuAudioCommand
	originalExec := execFeishuAudioCommand
	lookPathFeishuAudioCommand = func(file string) (string, error) {
		return file, nil
	}
	execFeishuAudioCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		commandArgs := append([]string{"-test.run=TestHelperProcessFeishuAudioTranscoder", "--"}, args...)
		command := exec.CommandContext(ctx, os.Args[0], commandArgs...)
		command.Env = append(os.Environ(),
			"GO_WANT_HELPER_PROCESS_FEISHU_AUDIO_TRANSCODER=1",
			"GO_HELPER_FEISHU_AUDIO_TRANSCODER_BYTES=OggSconverted-voice",
		)
		return command
	}
	t.Cleanup(func() {
		lookPathFeishuAudioCommand = originalLookPath
		execFeishuAudioCommand = originalExec
	})

	var uploadFields map[string]string
	var sentPayloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/files":
			fields, err := readMultipartFields(r)
			if err != nil {
				t.Fatalf("read transcoded voice multipart fields error = %v", err)
			}
			uploadFields = fields
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code": 0,
				"data": map[string]any{
					"file_key": "voice_key_transcoded_1",
				},
			})
		case "/open-apis/im/v1/messages":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode send payload error = %v", err)
			}
			sentPayloads = append(sentPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"code": 0})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_voice_invalid_1",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_voice_invalid_1",
		ProviderState: map[string]string{
			feishuChatIDKey: "oc_chat_voice_invalid_1",
		},
	}, []OutboundMessage{{
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindVoice, Path: voicePath, ContentType: "audio/mpeg"},
		},
	}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}
	if got := uploadFields["file_name"]; got != "voice.opus" {
		t.Fatalf("expected transcoded filename voice.opus, got %#v", uploadFields)
	}
	if len(sentPayloads) != 1 || sentPayloads[0]["msg_type"] != "audio" {
		t.Fatalf("expected one audio outbound message, got %#v", sentPayloads)
	}
}

func TestFeishuSendMessagesVoiceTranscodeRequiresFFmpeg(t *testing.T) {
	tmpDir := t.TempDir()
	voicePath := filepath.Join(tmpDir, "voice.mp3")
	if err := os.WriteFile(voicePath, []byte("ID3voice"), 0o600); err != nil {
		t.Fatalf("WriteFile(voice) error = %v", err)
	}

	originalLookPath := lookPathFeishuAudioCommand
	lookPathFeishuAudioCommand = func(file string) (string, error) {
		return "", errors.New("missing ffmpeg")
	}
	t.Cleanup(func() {
		lookPathFeishuAudioCommand = originalLookPath
	})

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_voice_invalid_2",
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	}, store.BotConversation{
		ExternalChatID: "oc_chat_voice_invalid_2",
		ProviderState: map[string]string{
			feishuChatIDKey: "oc_chat_voice_invalid_2",
		},
	}, []OutboundMessage{{
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindVoice, Path: voicePath, ContentType: "audio/mpeg"},
		},
	}})
	if err == nil || !strings.Contains(err.Error(), "ffmpeg not found") {
		t.Fatalf("expected ffmpeg missing error, got %v", err)
	}
}

func TestFeishuSendMessagesRejectsRelativeMediaPath(t *testing.T) {
	uploadCalled := false
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/images", "/open-apis/im/v1/files", "/open-apis/im/v1/messages":
			uploadCalled = true
			http.Error(w, "unexpected request", http.StatusInternalServerError)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	err := provider.SendMessages(context.Background(), store.BotConnection{
		ID:       "conn_feishu_media_invalid_1",
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
			feishuChatIDKey: "oc_chat_456",
		},
	}, []OutboundMessage{{
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindImage, Path: "relative-image.png"},
		},
	}})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "must be absolute") {
		t.Fatalf("expected absolute path validation error, got %v", err)
	}
	if uploadCalled {
		t.Fatalf("expected validation failure before any media upload attempt")
	}
}

func TestPrepareInboundMessageForAIFeishuAddsAttachmentHint(t *testing.T) {
	prepared := prepareInboundMessageForAI(store.BotConnection{
		Provider: feishuProviderName,
	}, InboundMessage{
		Text: "请分析这个截图",
		Media: []store.BotMessageMedia{
			{
				Kind:        botMediaKindImage,
				Path:        `E:\tmp\chart.png`,
				FileName:    "chart.png",
				ContentType: "image/png",
			},
		},
	})

	if !strings.Contains(prepared.Text, "[Image attachment]") {
		t.Fatalf("expected prepared text to mention image attachment, got %q", prepared.Text)
	}
	if !strings.Contains(prepared.Text, "feishu-attachments") {
		t.Fatalf("expected prepared text to include Feishu attachment note, got %q", prepared.Text)
	}
}

func TestNormalizeProviderReplyMessagesFeishuParsesAttachmentProtocol(t *testing.T) {
	messages := normalizeProviderReplyMessages(store.BotConnection{
		Provider: feishuProviderName,
	}, []OutboundMessage{{
		Text: "附件已生成。\n\n```feishu-attachments\nimage E:\\tmp\\chart.png\nfile https://example.com/report.pdf\n```",
	}})

	if len(messages) != 1 {
		t.Fatalf("expected one normalized message, got %#v", messages)
	}
	if strings.Contains(messages[0].Text, "feishu-attachments") {
		t.Fatalf("expected attachment protocol block removed from visible text, got %q", messages[0].Text)
	}
	if len(messages[0].Media) != 2 {
		t.Fatalf("expected two parsed media attachments, got %#v", messages[0].Media)
	}
	if messages[0].Media[0].Kind != botMediaKindImage || messages[0].Media[0].Path != `E:\tmp\chart.png` {
		t.Fatalf("expected first attachment to parse as local image, got %#v", messages[0].Media[0])
	}
	if messages[0].Media[1].Kind != botMediaKindFile || messages[0].Media[1].URL != "https://example.com/report.pdf" {
		t.Fatalf("expected second attachment to parse as remote file, got %#v", messages[0].Media[1])
	}
}

func TestFeishuParseEventPayloadDownloadsInboundImage(t *testing.T) {
	const imageBytes = "\x89PNG\r\n\x1a\nfeishu-image"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_img_1/resources/img_key_1":
			if got := r.URL.Query().Get("type"); got != "image" {
				t.Fatalf("expected resource type=image, got %q", got)
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte(imageBytes))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	payload, err := json.Marshal(map[string]any{
		"header": map[string]any{
			"event_type": "im.message.receive_v1",
		},
		"event": map[string]any{
			"sender": map[string]any{
				"sender_id": map[string]any{
					"open_id": "ou_user_1",
				},
				"sender_type": "user",
				"name":        "Alice",
			},
			"message": map[string]any{
				"message_id":   "om_img_1",
				"chat_id":      "oc_chat_img_1",
				"chat_type":    "p2p",
				"message_type": "image",
				"content":      `{"image_key":"img_key_1"}`,
			},
			"chat": map[string]any{
				"name": "Alice",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	inbound, err := provider.parseFeishuEventPayload(payload, store.BotConnection{
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	})
	if err != nil {
		t.Fatalf("parseFeishuEventPayload() error = %v", err)
	}
	if len(inbound.Media) != 1 {
		t.Fatalf("expected one inbound media item, got %#v", inbound)
	}
	if inbound.Media[0].Kind != botMediaKindImage {
		t.Fatalf("expected inbound image kind, got %#v", inbound.Media[0])
	}
	if inbound.Media[0].ContentType != "image/png" {
		t.Fatalf("expected image/png content type, got %#v", inbound.Media[0])
	}
	if !filepath.IsAbs(inbound.Media[0].Path) {
		t.Fatalf("expected persisted absolute media path, got %#v", inbound.Media[0])
	}
	if _, statErr := os.Stat(inbound.Media[0].Path); statErr != nil {
		t.Fatalf("expected persisted inbound image file, got %v", statErr)
	}
}

func TestFeishuParseEventPayloadDownloadsInboundFile(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_file_1/resources/file_key_1":
			if got := r.URL.Query().Get("type"); got != "file" {
				t.Fatalf("expected resource type=file, got %q", got)
			}
			w.Header().Set("Content-Type", "application/pdf")
			w.Header().Set("Content-Disposition", `attachment; filename="report.pdf"`)
			_, _ = w.Write([]byte("%PDF-1.7\nfeishu report\n"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	payload, err := json.Marshal(map[string]any{
		"header": map[string]any{
			"event_type": "im.message.receive_v1",
		},
		"event": map[string]any{
			"sender": map[string]any{
				"sender_id": map[string]any{
					"open_id": "ou_user_2",
				},
				"sender_type": "user",
				"name":        "Bob",
			},
			"message": map[string]any{
				"message_id":   "om_file_1",
				"chat_id":      "oc_chat_file_1",
				"chat_type":    "p2p",
				"message_type": "file",
				"content":      `{"file_key":"file_key_1","file_name":"report.pdf"}`,
			},
			"chat": map[string]any{
				"name": "Bob",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	inbound, err := provider.parseFeishuEventPayload(payload, store.BotConnection{
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	})
	if err != nil {
		t.Fatalf("parseFeishuEventPayload() error = %v", err)
	}
	if len(inbound.Media) != 1 {
		t.Fatalf("expected one inbound media item, got %#v", inbound)
	}
	if inbound.Media[0].Kind != botMediaKindFile {
		t.Fatalf("expected inbound file kind, got %#v", inbound.Media[0])
	}
	if inbound.Media[0].FileName != "report.pdf" {
		t.Fatalf("expected inbound filename report.pdf, got %#v", inbound.Media[0])
	}
	if inbound.Media[0].ContentType != "application/pdf" {
		t.Fatalf("expected application/pdf content type, got %#v", inbound.Media[0])
	}
	if !filepath.IsAbs(inbound.Media[0].Path) {
		t.Fatalf("expected persisted absolute media path, got %#v", inbound.Media[0])
	}
	if _, statErr := os.Stat(inbound.Media[0].Path); statErr != nil {
		t.Fatalf("expected persisted inbound file, got %v", statErr)
	}
}

func TestFeishuParseEventPayloadDownloadsInboundAudio(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_audio_1/resources/audio_key_1":
			if got := r.URL.Query().Get("type"); got != "file" {
				t.Fatalf("expected resource type=file, got %q", got)
			}
			w.Header().Set("Content-Type", "audio/ogg")
			w.Header().Set("Content-Disposition", `attachment; filename="voice.ogg"`)
			_, _ = w.Write([]byte("OggSvoice"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	payload, err := json.Marshal(map[string]any{
		"header": map[string]any{
			"event_type": "im.message.receive_v1",
		},
		"event": map[string]any{
			"sender": map[string]any{
				"sender_id": map[string]any{
					"open_id": "ou_user_audio_1",
				},
				"sender_type": "user",
				"name":        "Dora",
			},
			"message": map[string]any{
				"message_id":   "om_audio_1",
				"chat_id":      "oc_chat_audio_1",
				"chat_type":    "p2p",
				"message_type": "audio",
				"content":      `{"file_key":"audio_key_1"}`,
			},
			"chat": map[string]any{
				"name": "Dora",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	inbound, err := provider.parseFeishuEventPayload(payload, store.BotConnection{
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	})
	if err != nil {
		t.Fatalf("parseFeishuEventPayload() error = %v", err)
	}
	if len(inbound.Media) != 1 {
		t.Fatalf("expected one inbound voice item, got %#v", inbound)
	}
	if inbound.Media[0].Kind != botMediaKindVoice {
		t.Fatalf("expected inbound voice kind, got %#v", inbound.Media[0])
	}
	if inbound.Media[0].ContentType != "audio/ogg" {
		t.Fatalf("expected audio/ogg content type, got %#v", inbound.Media[0])
	}
	if !filepath.IsAbs(inbound.Media[0].Path) {
		t.Fatalf("expected persisted absolute voice path, got %#v", inbound.Media[0])
	}
}

func TestFeishuParseEventPayloadPostIncludesImages(t *testing.T) {
	const imageBytes = "\x89PNG\r\n\x1a\npost-image"

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case feishuAppAccessTokenEndpoint:
			_ = json.NewEncoder(w).Encode(map[string]any{
				"code":             0,
				"app_access_token": "token_123",
				"expire":           7200,
			})
		case "/open-apis/im/v1/messages/om_post_1/resources/post_img_1":
			if got := r.URL.Query().Get("type"); got != "image" {
				t.Fatalf("expected resource type=image, got %q", got)
			}
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte(imageBytes))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	payload, err := json.Marshal(map[string]any{
		"header": map[string]any{
			"event_type": "im.message.receive_v1",
		},
		"event": map[string]any{
			"sender": map[string]any{
				"sender_id": map[string]any{
					"open_id": "ou_user_3",
				},
				"sender_type": "user",
				"name":        "Carol",
			},
			"message": map[string]any{
				"message_id":   "om_post_1",
				"chat_id":      "oc_chat_post_1",
				"chat_type":    "p2p",
				"message_type": "post",
				"content":      `{"title":"日报","content":[[{"tag":"text","text":"请看截图"},{"tag":"img","image_key":"post_img_1"}]]}`,
			},
			"chat": map[string]any{
				"name": "Carol",
			},
		},
	})
	if err != nil {
		t.Fatalf("Marshal() error = %v", err)
	}

	provider := newFeishuProvider(server.Client()).(*feishuProvider)
	inbound, err := provider.parseFeishuEventPayload(payload, store.BotConnection{
		Provider: feishuProviderName,
		Settings: map[string]string{
			feishuAppIDSetting:  "app_123",
			feishuDomainSetting: server.URL,
		},
		Secrets: map[string]string{
			feishuAppSecretKey: "secret_123",
		},
	})
	if err != nil {
		t.Fatalf("parseFeishuEventPayload() error = %v", err)
	}
	if !strings.Contains(inbound.Text, "日报") || !strings.Contains(inbound.Text, "请看截图") {
		t.Fatalf("expected post text preserved, got %#v", inbound)
	}
	if len(inbound.Media) != 1 || inbound.Media[0].Kind != botMediaKindImage {
		t.Fatalf("expected one post image attachment, got %#v", inbound.Media)
	}
}

func TestHelperProcessFeishuAudioTranscoder(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS_FEISHU_AUDIO_TRANSCODER") != "1" {
		return
	}

	_, _ = io.Copy(io.Discard, os.Stdin)
	_, _ = os.Stdout.Write([]byte(os.Getenv("GO_HELPER_FEISHU_AUDIO_TRANSCODER_BYTES")))
	os.Exit(0)
}

func readMultipartFields(r *http.Request) (map[string]string, error) {
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, err
	}

	fields := make(map[string]string)
	for {
		part, err := reader.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, err
		}
		data, err := io.ReadAll(part)
		if err != nil {
			return nil, err
		}
		value := strings.TrimSpace(string(data))
		name := part.FormName()
		if filename := strings.TrimSpace(part.FileName()); filename != "" {
			value = filename
		}
		fields[name] = value
	}
	return fields, nil
}
