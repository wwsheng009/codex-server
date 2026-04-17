package bots

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/store"

	"github.com/gorilla/websocket"
)

func TestQQBotProviderRefreshesAccessTokenWhenExpired(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 4, 17, 10, 0, 0, 0, time.UTC)
	tokenRequests := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/app/getAppAccessToken" {
			t.Fatalf("unexpected qqbot path %s", r.URL.Path)
		}
		tokenRequests++
		_ = json.NewEncoder(w).Encode(map[string]any{
			"access_token": fmt.Sprintf("token-%d", tokenRequests),
			"expires_in":   "600",
		})
	}))
	defer server.Close()

	provider := newQQBotProvider(server.Client()).(*qqbotProvider)
	provider.tokenURL = server.URL + "/app/getAppAccessToken"
	provider.now = func() time.Time { return now }

	cfg := qqbotConfig{
		appID:     "app-1",
		appSecret: "secret-1",
	}

	first, err := provider.getAccessToken(context.Background(), cfg, false)
	if err != nil {
		t.Fatalf("getAccessToken(first) error = %v", err)
	}
	if first != "token-1" {
		t.Fatalf("expected first token token-1, got %q", first)
	}

	second, err := provider.getAccessToken(context.Background(), cfg, false)
	if err != nil {
		t.Fatalf("getAccessToken(second) error = %v", err)
	}
	if second != "token-1" {
		t.Fatalf("expected cached token token-1, got %q", second)
	}

	now = now.Add(9 * time.Minute)
	third, err := provider.getAccessToken(context.Background(), cfg, false)
	if err != nil {
		t.Fatalf("getAccessToken(third) error = %v", err)
	}
	if third != "token-2" {
		t.Fatalf("expected refreshed token token-2, got %q", third)
	}

	if tokenRequests != 2 {
		t.Fatalf("expected 2 token requests, got %d", tokenRequests)
	}
}

func TestQQBotConversationID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name   string
		got    string
		expect string
	}{
		{
			name:   "group member scoped",
			got:    qqbotConversationID(qqbotMessageTypeGroup, "group-1", "member-1", false),
			expect: "group:group-1:user:member-1",
		},
		{
			name:   "group shared",
			got:    qqbotConversationID(qqbotMessageTypeGroup, "group-1", "member-1", true),
			expect: "group:group-1",
		},
		{
			name:   "c2c",
			got:    qqbotConversationID(qqbotMessageTypeC2C, "", "user-1", false),
			expect: "user:user-1",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if tc.got != tc.expect {
				t.Fatalf("conversation id = %q, want %q", tc.got, tc.expect)
			}
		})
	}
}

func TestQQBotInboundMessageFromGatewayEventParsesGroupAndC2C(t *testing.T) {
	t.Parallel()

	connection := store.BotConnection{
		Provider: qqbotProviderName,
		Settings: map[string]string{
			qqbotAppIDSetting:                 "app-1",
			qqbotShareSessionInChannelSetting: "false",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "secret-1",
		},
	}

	provider := newQQBotProvider(&http.Client{}).(*qqbotProvider)

	groupMessage, err := provider.inboundMessageFromGatewayEvent(connection, "GROUP_AT_MESSAGE_CREATE", json.RawMessage(`{
		"id":"evt-group-1",
		"group_openid":"group-openid-1",
		"content":"<@!12345> hello group",
		"author":{"member_openid":"member-openid-1"},
		"message_reference":{"content":"earlier line"}
	}`))
	if err != nil {
		t.Fatalf("group event parse error = %v", err)
	}
	if groupMessage.ConversationID != "group:group-openid-1:user:member-openid-1" {
		t.Fatalf("unexpected group conversation id %#v", groupMessage)
	}
	if groupMessage.Text != "Quoted: earlier line\nhello group" {
		t.Fatalf("unexpected group text %#v", groupMessage)
	}
	if groupMessage.ProviderData[qqbotMessageTypeKey] != qqbotMessageTypeGroup {
		t.Fatalf("expected group provider data, got %#v", groupMessage.ProviderData)
	}

	c2cMessage, err := provider.inboundMessageFromGatewayEvent(connection, "C2C_MESSAGE_CREATE", json.RawMessage(`{
		"id":"evt-c2c-1",
		"content":"hello c2c",
		"author":{"user_openid":"user-openid-1"}
	}`))
	if err != nil {
		t.Fatalf("c2c event parse error = %v", err)
	}
	if c2cMessage.ConversationID != "user:user-openid-1" {
		t.Fatalf("unexpected c2c conversation id %#v", c2cMessage)
	}
	if c2cMessage.Text != "hello c2c" {
		t.Fatalf("unexpected c2c text %#v", c2cMessage)
	}
	if c2cMessage.ProviderData[qqbotMessageTypeKey] != qqbotMessageTypeC2C {
		t.Fatalf("expected c2c provider data, got %#v", c2cMessage.ProviderData)
	}
}

func TestQQBotProviderSendMessagesGroupFallsBackToProactive(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	var paths []string
	var payloads []map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/getAppAccessToken":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "token-1",
				"expires_in":   "7200",
			})
		case "/v2/groups/group-openid-1/messages":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode qqbot outbound payload error = %v", err)
			}
			mu.Lock()
			paths = append(paths, r.URL.Path)
			payloads = append(payloads, payload)
			callIndex := len(payloads)
			mu.Unlock()

			if callIndex == 1 {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = w.Write([]byte(`{"message":"invalid msg_id"}`))
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "sent-group-1"})
		default:
			t.Fatalf("unexpected qqbot path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newQQBotProvider(server.Client()).(*qqbotProvider)
	provider.tokenURL = server.URL + "/app/getAppAccessToken"
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Provider: qqbotProviderName,
		Settings: map[string]string{
			qqbotAppIDSetting: "app-1",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "secret-1",
		},
	}, store.BotConversation{
		ExternalChatID: "group-openid-1",
		ExternalUserID: "member-openid-1",
		ProviderState: map[string]string{
			qqbotMessageTypeKey:    qqbotMessageTypeGroup,
			qqbotGroupOpenIDKey:    "group-openid-1",
			qqbotUserOpenIDKey:     "member-openid-1",
			qqbotEventMessageIDKey: "evt-group-1",
		},
	}, []OutboundMessage{{Text: "hello group"}})
	if err != nil {
		t.Fatalf("SendMessages() group error = %v", err)
	}

	if len(paths) != 2 {
		t.Fatalf("expected 2 group send attempts, got %#v", paths)
	}
	if _, ok := payloads[0]["msg_id"]; !ok {
		t.Fatalf("expected first group send to use passive reply, got %#v", payloads[0])
	}
	if _, ok := payloads[0]["msg_seq"]; !ok {
		t.Fatalf("expected first group send to include msg_seq, got %#v", payloads[0])
	}
	if _, ok := payloads[1]["msg_id"]; ok {
		t.Fatalf("expected proactive fallback payload without msg_id, got %#v", payloads[1])
	}
	if payloads[1]["content"] != "hello group" {
		t.Fatalf("expected proactive fallback content hello group, got %#v", payloads[1])
	}
}

func TestQQBotProviderSendMessagesUsesC2CEndpoint(t *testing.T) {
	t.Parallel()

	var path string
	var payload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/getAppAccessToken":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "token-1",
				"expires_in":   "7200",
			})
		case "/v2/users/user-openid-1/messages":
			path = r.URL.Path
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode qqbot c2c payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "sent-c2c-1"})
		default:
			t.Fatalf("unexpected qqbot path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newQQBotProvider(server.Client()).(*qqbotProvider)
	provider.tokenURL = server.URL + "/app/getAppAccessToken"
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Provider: qqbotProviderName,
		Settings: map[string]string{
			qqbotAppIDSetting: "app-1",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "secret-1",
		},
	}, store.BotConversation{
		ExternalChatID: "user-openid-1",
		ProviderState: map[string]string{
			qqbotMessageTypeKey: qqbotMessageTypeC2C,
			qqbotUserOpenIDKey:  "user-openid-1",
		},
	}, []OutboundMessage{{Text: "hello c2c"}})
	if err != nil {
		t.Fatalf("SendMessages() c2c error = %v", err)
	}

	if path != "/v2/users/user-openid-1/messages" {
		t.Fatalf("expected c2c path /v2/users/user-openid-1/messages, got %q", path)
	}
	if payload["content"] != "hello c2c" {
		t.Fatalf("expected c2c content hello c2c, got %#v", payload)
	}
	if _, ok := payload["msg_id"]; ok {
		t.Fatalf("expected proactive c2c send without msg_id, got %#v", payload)
	}
}

func TestQQBotProviderSendMessagesUploadsRemoteImage(t *testing.T) {
	t.Parallel()

	var uploadPayload map[string]any
	var messagePayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/getAppAccessToken":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "token-1",
				"expires_in":   "7200",
			})
		case "/image.png":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write([]byte("png-bytes"))
		case "/v2/groups/group-openid-1/files":
			if err := json.NewDecoder(r.Body).Decode(&uploadPayload); err != nil {
				t.Fatalf("decode qqbot upload payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"file_info": "file-info-1"})
		case "/v2/groups/group-openid-1/messages":
			if err := json.NewDecoder(r.Body).Decode(&messagePayload); err != nil {
				t.Fatalf("decode qqbot media send payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"id": "sent-group-media-1"})
		default:
			t.Fatalf("unexpected qqbot path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newQQBotProvider(server.Client()).(*qqbotProvider)
	provider.tokenURL = server.URL + "/app/getAppAccessToken"
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Provider: qqbotProviderName,
		Settings: map[string]string{
			qqbotAppIDSetting: "app-1",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "secret-1",
		},
	}, store.BotConversation{
		ExternalChatID: "group-openid-1",
		ExternalUserID: "member-openid-1",
		ProviderState: map[string]string{
			qqbotMessageTypeKey:    qqbotMessageTypeGroup,
			qqbotGroupOpenIDKey:    "group-openid-1",
			qqbotUserOpenIDKey:     "member-openid-1",
			qqbotEventMessageIDKey: "evt-group-1",
		},
	}, []OutboundMessage{{
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindImage, URL: server.URL + "/image.png", FileName: "photo.png"},
		},
	}})
	if err != nil {
		t.Fatalf("SendMessages() media error = %v", err)
	}

	if uploadPayload["file_type"] != float64(1) {
		t.Fatalf("expected image upload file_type 1, got %#v", uploadPayload)
	}
	if strings.TrimSpace(uploadPayload["file_data"].(string)) == "" {
		t.Fatalf("expected base64 file data, got %#v", uploadPayload)
	}
	if messagePayload["msg_type"] != float64(7) {
		t.Fatalf("expected rich media msg_type 7, got %#v", messagePayload)
	}
	mediaPayload, ok := messagePayload["media"].(map[string]any)
	if !ok || mediaPayload["file_info"] != "file-info-1" {
		t.Fatalf("expected file_info in media payload, got %#v", messagePayload)
	}
	if messagePayload["msg_id"] != "evt-group-1" {
		t.Fatalf("expected passive media reply msg_id, got %#v", messagePayload)
	}
}

func TestQQBotProviderSendMessagesUploadsLocalFile(t *testing.T) {
	t.Parallel()

	tempFile, err := os.CreateTemp(t.TempDir(), "qqbot-report-*.txt")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	if _, err := tempFile.WriteString("report-bytes"); err != nil {
		t.Fatalf("WriteString() error = %v", err)
	}
	if err := tempFile.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	var uploadPayload map[string]any
	var messagePayloads []map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/getAppAccessToken":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "token-1",
				"expires_in":   "7200",
			})
		case "/v2/users/user-openid-1/files":
			if err := json.NewDecoder(r.Body).Decode(&uploadPayload); err != nil {
				t.Fatalf("decode qqbot file upload payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"file_info": "file-info-2"})
		case "/v2/users/user-openid-1/messages":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode qqbot c2c payload error = %v", err)
			}
			messagePayloads = append(messagePayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{"id": fmt.Sprintf("sent-%d", len(messagePayloads))})
		default:
			t.Fatalf("unexpected qqbot path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newQQBotProvider(server.Client()).(*qqbotProvider)
	provider.tokenURL = server.URL + "/app/getAppAccessToken"
	provider.apiBaseURL = server.URL

	err = provider.SendMessages(context.Background(), store.BotConnection{
		Provider: qqbotProviderName,
		Settings: map[string]string{
			qqbotAppIDSetting: "app-1",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "secret-1",
		},
	}, store.BotConversation{
		ExternalChatID: "user-openid-1",
		ProviderState: map[string]string{
			qqbotMessageTypeKey: qqbotMessageTypeC2C,
			qqbotUserOpenIDKey:  "user-openid-1",
		},
	}, []OutboundMessage{{
		Text: "hello file",
		Media: []store.BotMessageMedia{
			{Kind: botMediaKindFile, Path: tempFile.Name(), FileName: "report.txt"},
		},
	}})
	if err != nil {
		t.Fatalf("SendMessages() local file error = %v", err)
	}

	if uploadPayload["file_type"] != float64(4) {
		t.Fatalf("expected generic file upload file_type 4, got %#v", uploadPayload)
	}
	if len(messagePayloads) != 2 {
		t.Fatalf("expected text message plus media message, got %#v", messagePayloads)
	}
	if messagePayloads[0]["content"] != "hello file" {
		t.Fatalf("expected first c2c payload to be text, got %#v", messagePayloads[0])
	}
	if messagePayloads[1]["msg_type"] != float64(7) {
		t.Fatalf("expected second c2c payload to be rich media, got %#v", messagePayloads[1])
	}
}

func TestQQBotProviderRunPollingPerformsHelloIdentifyReadyHeartbeatAndDispatch(t *testing.T) {
	t.Parallel()

	upgrader := websocket.Upgrader{}
	var wsURL string

	var identifyPayload map[string]any
	heartbeatSeen := make(chan struct{}, 1)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/app/getAppAccessToken":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "token-1",
				"expires_in":   "7200",
			})
		case "/gateway/bot":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"url": wsURL,
			})
		case "/ws":
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("upgrade websocket error = %v", err)
			}
			defer conn.Close()

			if err := conn.WriteJSON(map[string]any{
				"op": qqbotGatewayOpHello,
				"d": map[string]any{
					"heartbeat_interval": 20,
				},
			}); err != nil {
				t.Fatalf("write hello error = %v", err)
			}

			var identify qqbotGatewayPayload
			if err := conn.ReadJSON(&identify); err != nil {
				t.Fatalf("read identify error = %v", err)
			}
			if identify.Op != qqbotGatewayOpIdentify {
				t.Fatalf("expected identify op, got %#v", identify)
			}
			if err := json.Unmarshal(identify.D, &identifyPayload); err != nil {
				t.Fatalf("unmarshal identify payload error = %v", err)
			}

			if err := conn.WriteJSON(map[string]any{
				"op": qqbotGatewayOpDispatch,
				"t":  "READY",
				"s":  1,
				"d": map[string]any{
					"session_id": "session-1",
				},
			}); err != nil {
				t.Fatalf("write ready error = %v", err)
			}

			var heartbeat qqbotGatewayPayload
			if err := conn.ReadJSON(&heartbeat); err != nil {
				t.Fatalf("read heartbeat error = %v", err)
			}
			if heartbeat.Op != qqbotGatewayOpHeartbeat {
				t.Fatalf("expected heartbeat op, got %#v", heartbeat)
			}
			heartbeatSeen <- struct{}{}

			if err := conn.WriteJSON(map[string]any{
				"op": qqbotGatewayOpHeartbeatACK,
			}); err != nil {
				t.Fatalf("write heartbeat ack error = %v", err)
			}

			if err := conn.WriteJSON(map[string]any{
				"op": qqbotGatewayOpDispatch,
				"t":  "GROUP_AT_MESSAGE_CREATE",
				"s":  2,
				"d": map[string]any{
					"id":           "evt-group-1",
					"group_openid": "group-openid-1",
					"content":      "<@!12345> hello gateway",
					"author": map[string]any{
						"member_openid": "member-openid-1",
					},
				},
			}); err != nil {
				t.Fatalf("write dispatch error = %v", err)
			}
		default:
			t.Fatalf("unexpected qqbot path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	parsedServerURL, err := url.Parse(server.URL)
	if err != nil {
		t.Fatalf("url.Parse(server.URL) error = %v", err)
	}
	wsURL = "ws://" + parsedServerURL.Host + "/ws"

	provider := newQQBotProvider(server.Client()).(*qqbotProvider)
	provider.tokenURL = server.URL + "/app/getAppAccessToken"
	provider.apiBaseURL = server.URL

	connection := store.BotConnection{
		ID:       "conn-1",
		Provider: qqbotProviderName,
		Settings: map[string]string{
			qqbotAppIDSetting: "app-1",
		},
		Secrets: map[string]string{
			qqbotAppSecretKey: "secret-1",
		},
	}

	var handled []InboundMessage
	var persisted []map[string]string
	err = provider.RunPolling(
		context.Background(),
		connection,
		func(_ context.Context, message InboundMessage) error {
			handled = append(handled, message)
			return context.Canceled
		},
		func(_ context.Context, settings map[string]string) error {
			persisted = append(persisted, qqbotCloneStringMap(settings))
			return nil
		},
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected RunPolling() to stop with context.Canceled, got %v", err)
	}

	select {
	case <-heartbeatSeen:
	case <-time.After(time.Second):
		t.Fatal("expected heartbeat to be sent before dispatch")
	}

	if identifyPayload["token"] != "QQBot token-1" {
		t.Fatalf("expected identify token QQBot token-1, got %#v", identifyPayload)
	}
	if len(handled) != 1 {
		t.Fatalf("expected 1 handled message, got %#v", handled)
	}
	if handled[0].ConversationID != "group:group-openid-1:user:member-openid-1" {
		t.Fatalf("unexpected handled message %#v", handled[0])
	}
	if handled[0].Text != "hello gateway" {
		t.Fatalf("unexpected handled text %#v", handled[0])
	}

	if len(persisted) == 0 {
		t.Fatalf("expected gateway session state to be persisted")
	}
	lastPersisted := persisted[len(persisted)-1]
	if lastPersisted[qqbotGatewaySessionIDSetting] != "session-1" {
		t.Fatalf("expected persisted session_id session-1, got %#v", lastPersisted)
	}
	if lastPersisted[qqbotGatewaySeqSetting] != "2" {
		t.Fatalf("expected persisted seq 2, got %#v", lastPersisted)
	}
}

func TestQQBotProviderParseWebhookIgnored(t *testing.T) {
	t.Parallel()

	provider := newQQBotProvider(&http.Client{}).(*qqbotProvider)
	_, err := provider.ParseWebhook(httptest.NewRequest(http.MethodPost, "/hooks/bots/qqbot", strings.NewReader(`{}`)), store.BotConnection{})
	if !errors.Is(err, ErrWebhookIgnored) {
		t.Fatalf("expected ErrWebhookIgnored, got %v", err)
	}
}
