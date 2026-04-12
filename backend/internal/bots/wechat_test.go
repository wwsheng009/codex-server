package bots

import (
	"context"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestWeChatProviderActivateAndRunPolling(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	callCount := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("AuthorizationType"); got != "ilink_bot_token" {
			t.Fatalf("expected AuthorizationType ilink_bot_token, got %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer wechat-token" {
			t.Fatalf("expected bearer token header, got %q", got)
		}
		if got := r.Header.Get("iLink-App-Id"); got != wechatAppIDHeader {
			t.Fatalf("expected iLink-App-Id %q, got %q", wechatAppIDHeader, got)
		}
		if got := r.Header.Get("iLink-App-ClientVersion"); got != wechatClientVersionHeader {
			t.Fatalf("expected client version header %q, got %q", wechatClientVersionHeader, got)
		}
		assertValidWeChatUINHeader(t, r.Header)

		switch r.URL.Path {
		case "/ilink/bot/getupdates":
			mu.Lock()
			callCount += 1
			currentCall := callCount
			mu.Unlock()

			if currentCall == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{
					"ret":             0,
					"errcode":         0,
					"errmsg":          "",
					"get_updates_buf": "sync-2",
					"msgs": []map[string]any{
						{
							"from_user_id":   "wechat-user-1",
							"client_id":      "client-1",
							"session_id":     "session-1",
							"message_type":   wechatMessageTypeUser,
							"message_state":  wechatMessageStateComplete,
							"context_token":  "ctx-1",
							"create_time_ms": 1710000000000,
							"item_list": []map[string]any{
								{
									"type": 1,
									"text_item": map[string]any{
										"text": "hello wechat",
									},
								},
							},
						},
					},
				})
				return
			}

			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":             0,
				"errcode":         0,
				"errmsg":          "",
				"get_updates_buf": "sync-2",
				"msgs":            []map[string]any{},
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
			wechatSyncBufSetting:      "sync-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	activation, err := provider.Activate(context.Background(), connection, "")
	if err != nil {
		t.Fatalf("Activate() error = %v", err)
	}
	if activation.Settings[wechatDeliveryModeSetting] != wechatDeliveryModePolling {
		t.Fatalf("expected polling delivery mode, got %#v", activation.Settings)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var messages []InboundMessage
	var persistedSettings []map[string]string
	err = provider.RunPolling(
		ctx,
		connection,
		func(_ context.Context, message InboundMessage) error {
			messages = append(messages, message)
			cancel()
			return nil
		},
		func(_ context.Context, settings map[string]string) error {
			persistedSettings = append(persistedSettings, cloneStringMapLocal(settings))
			return nil
		},
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after first message, got %v", err)
	}

	if len(messages) != 1 {
		t.Fatalf("expected 1 inbound wechat message, got %#v", messages)
	}
	if messages[0].ConversationID != "wechat-user-1" {
		t.Fatalf("expected conversation id wechat-user-1, got %#v", messages[0])
	}
	if messages[0].MessageID == "" || !strings.HasPrefix(messages[0].MessageID, "wechat:") {
		t.Fatalf("expected stable wechat message id, got %#v", messages[0])
	}
	if messages[0].ProviderData[wechatContextTokenKey] != "ctx-1" {
		t.Fatalf("expected context token in provider data, got %#v", messages[0].ProviderData)
	}
	if len(persistedSettings) == 0 || persistedSettings[0][wechatSyncBufSetting] != "sync-2" {
		t.Fatalf("expected sync buffer to be persisted, got %#v", persistedSettings)
	}
}

type recordingHTTPClientSource struct {
	transport http.RoundTripper

	mu       sync.Mutex
	timeouts []time.Duration
}

func (s *recordingHTTPClientSource) Client(timeout time.Duration) *http.Client {
	s.mu.Lock()
	s.timeouts = append(s.timeouts, timeout)
	s.mu.Unlock()

	return &http.Client{
		Timeout:   timeout,
		Transport: s.transport,
	}
}

func (s *recordingHTTPClientSource) RecordedTimeouts() []time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()

	return append([]time.Duration(nil), s.timeouts...)
}

func TestWeChatProviderRunPollingUsesServerLongPollTimeout(t *testing.T) {
	t.Parallel()

	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/getupdates" {
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}

		callCount++
		if callCount == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":                    0,
				"errcode":                0,
				"errmsg":                 "",
				"get_updates_buf":        "sync-timeout-2",
				"longpolling_timeout_ms": 2000,
				"msgs":                   []map[string]any{},
			})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":             0,
			"errcode":         0,
			"errmsg":          "",
			"get_updates_buf": "sync-timeout-2",
			"msgs": []map[string]any{
				{
					"from_user_id":   "wechat-user-timeout-1",
					"client_id":      "client-timeout-1",
					"session_id":     "session-timeout-1",
					"message_type":   wechatMessageTypeUser,
					"message_state":  wechatMessageStateComplete,
					"context_token":  "ctx-timeout-1",
					"create_time_ms": 1710000002000,
					"item_list": []map[string]any{
						{
							"type": wechatItemTypeText,
							"text_item": map[string]any{
								"text": "timeout update",
							},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	clients := &recordingHTTPClientSource{transport: server.Client().Transport}
	provider := newWeChatProviderWithClientSource(clients).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_timeout_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatAccountIDSetting:    "wechat-account-timeout-1",
			wechatOwnerUserIDSetting:  "wechat-owner-timeout-1",
			wechatSyncBufSetting:      "sync-timeout-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	err := provider.RunPolling(
		context.Background(),
		connection,
		func(_ context.Context, message InboundMessage) error {
			if message.Text != "timeout update" {
				t.Fatalf("expected timeout update message, got %#v", message)
			}
			return context.Canceled
		},
		func(_ context.Context, settings map[string]string) error {
			if got := settings[wechatSyncBufSetting]; got != "sync-timeout-2" {
				t.Fatalf("expected persisted sync buffer sync-timeout-2, got %#v", settings)
			}
			return nil
		},
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation from handler, got %v", err)
	}

	timeouts := clients.RecordedTimeouts()
	if len(timeouts) < 2 {
		t.Fatalf("expected at least two recorded client timeouts, got %#v", timeouts)
	}
	if timeouts[0] != wechatDefaultLongPollTimeout+wechatLongPollTimeoutBuf {
		t.Fatalf("expected initial long poll timeout %s, got %#v", wechatDefaultLongPollTimeout+wechatLongPollTimeoutBuf, timeouts)
	}
	if timeouts[1] != 2*time.Second+wechatLongPollTimeoutBuf {
		t.Fatalf("expected updated long poll timeout %s, got %#v", 2*time.Second+wechatLongPollTimeoutBuf, timeouts)
	}
}

func TestWeChatProviderRunPollingPausesExpiredSessionAndRecovers(t *testing.T) {
	originalPauseDuration := wechatSessionPauseDuration
	wechatSessionPauseDuration = 20 * time.Millisecond
	defer func() {
		wechatSessionPauseDuration = originalPauseDuration
	}()

	callCount := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/getupdates" {
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}

		callCount++
		if callCount == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     wechatSessionExpiredErrCode,
				"errcode": wechatSessionExpiredErrCode,
				"errmsg":  "session expired",
			})
			return
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":             0,
			"errcode":         0,
			"errmsg":          "",
			"get_updates_buf": "sync-session-2",
			"msgs": []map[string]any{
				{
					"from_user_id":   "wechat-user-session-1",
					"client_id":      "client-session-1",
					"session_id":     "session-session-1",
					"message_type":   wechatMessageTypeUser,
					"message_state":  wechatMessageStateComplete,
					"context_token":  "ctx-session-1",
					"create_time_ms": 1710000003000,
					"item_list": []map[string]any{
						{
							"type": wechatItemTypeText,
							"text_item": map[string]any{
								"text": "session recovered",
							},
						},
					},
				},
			},
		})
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_session_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatAccountIDSetting:    "wechat-account-session-1",
			wechatOwnerUserIDSetting:  "wechat-owner-session-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	received := make([]InboundMessage, 0, 1)
	err := provider.RunPolling(
		context.Background(),
		connection,
		func(_ context.Context, message InboundMessage) error {
			received = append(received, message)
			return context.Canceled
		},
		func(context.Context, map[string]string) error { return nil },
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation from handler, got %v", err)
	}
	if callCount != 2 {
		t.Fatalf("expected two polling attempts, got %d", callCount)
	}
	if len(received) != 1 || received[0].Text != "session recovered" {
		t.Fatalf("expected recovered message after pause, got %#v", received)
	}
}

func TestWeChatRequestErrorIncludesErrcodeInErrorText(t *testing.T) {
	t.Parallel()

	err := &wechatRequestError{
		method:      "/ilink/bot/sendmessage",
		statusCode:  wechatSessionExpiredErrCode,
		status:      "api error",
		description: "session expired",
	}

	if !strings.Contains(err.Error(), "code=-14") {
		t.Fatalf("expected wechat request error to include errcode, got %q", err.Error())
	}
}

func TestWeChatAPIErrorIncludesRetAndSessionExpiredFallbackWhenErrmsgMissing(t *testing.T) {
	t.Parallel()

	err := wechatAPIError("/ilink/bot/sendmessage", wechatAPIResponse{
		Ret:     wechatSessionExpiredErrCode,
		ErrCode: wechatSessionExpiredErrCode,
	})
	if err == nil {
		t.Fatal("expected wechatAPIError() to return an error")
	}
	if !strings.Contains(err.Error(), "ret=-14 errcode=-14") {
		t.Fatalf("expected wechat api error to include ret and errcode, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "session expired") {
		t.Fatalf("expected wechat api error to include session expired fallback, got %q", err.Error())
	}
}

func TestWeChatSendTextMessageWrapsAPIErrorWithTextSummary(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":     1,
			"errcode": 0,
			"errmsg":  "",
		})
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	err := provider.sendTextMessage(
		context.Background(),
		server.URL,
		"wechat-token",
		"",
		"wechat-user-send-1",
		"ctx-send-1",
		"hello send failure",
	)
	if err == nil {
		t.Fatal("expected sendTextMessage() to fail")
	}
	if !strings.Contains(err.Error(), "wechat sendmessage text failed") {
		t.Fatalf("expected wrapped text send failure, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "chars=18") {
		t.Fatalf("expected wrapped text send failure to include char count, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), `preview="hello send failure"`) {
		t.Fatalf("expected wrapped text send failure to include preview, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "ret=1 errcode=0") {
		t.Fatalf("expected wrapped text send failure to include ret and errcode, got %q", err.Error())
	}
}

func TestWeChatSendMessageItemWrapsAPIErrorWithItemSummary(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":     1,
			"errcode": 0,
			"errmsg":  "",
		})
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	err := provider.sendMessageItem(
		context.Background(),
		server.URL,
		"wechat-token",
		"",
		"wechat-user-send-2",
		"ctx-send-2",
		wechatMessageItem{
			Type: wechatItemTypeVideo,
			VideoItem: &wechatVideoItem{
				VideoSize: 2048,
			},
		},
	)
	if err == nil {
		t.Fatal("expected sendMessageItem() to fail")
	}
	if !strings.Contains(err.Error(), "wechat sendmessage item failed") {
		t.Fatalf("expected wrapped item send failure, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "type=video") {
		t.Fatalf("expected wrapped item send failure to include item type, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "videoSize=2048") {
		t.Fatalf("expected wrapped item send failure to include item summary, got %q", err.Error())
	}
	if !strings.Contains(err.Error(), "ret=1 errcode=0") {
		t.Fatalf("expected wrapped item send failure to include ret and errcode, got %q", err.Error())
	}
}

func TestWeChatProviderReplyDeliveryRetryDecisionRetriesMarkedTransientFailure(t *testing.T) {
	t.Parallel()

	provider := newWeChatProvider(nil).(*wechatProvider)

	retry, delay := provider.ReplyDeliveryRetryDecision(markReplyDeliveryRetryable(&wechatRequestError{
		method:      "/ilink/bot/sendmessage",
		statusCode:  http.StatusBadGateway,
		status:      "502 Bad Gateway",
		description: "upstream busy",
	}), 1)
	if !retry {
		t.Fatal("expected marked transient wechat failure to trigger service-level retry")
	}
	if delay != wechatReplyRetryBaseDelay {
		t.Fatalf("expected first retry delay %v, got %v", wechatReplyRetryBaseDelay, delay)
	}
}

func TestWeChatProviderReplyDeliveryRetryDecisionDoesNotRetryExpiredSession(t *testing.T) {
	t.Parallel()

	provider := newWeChatProvider(nil).(*wechatProvider)

	retry, delay := provider.ReplyDeliveryRetryDecision(markReplyDeliveryRetryable(&wechatRequestError{
		method:      "/ilink/bot/sendmessage",
		statusCode:  wechatSessionExpiredErrCode,
		status:      "api error",
		description: "session expired",
	}), 1)
	if retry || delay != 0 {
		t.Fatalf("expected expired session failures not to retry automatically, got retry=%v delay=%v", retry, delay)
	}
}

func TestWeChatFlexibleStringUnmarshalSupportsStringAndNumber(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		payload string
		want    string
	}{
		{
			name:    "string",
			payload: `{"create_time_ms":"1710000000000"}`,
			want:    "1710000000000",
		},
		{
			name:    "number",
			payload: `{"create_time_ms":1710000000000}`,
			want:    "1710000000000",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var message wechatMessage
			if err := json.Unmarshal([]byte(tc.payload), &message); err != nil {
				t.Fatalf("json.Unmarshal() error = %v", err)
			}
			if got := message.CreateTimeMS.String(); got != tc.want {
				t.Fatalf("CreateTimeMS = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestWeChatProviderSendMessagesUsesConversationState(t *testing.T) {
	t.Parallel()

	var payloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
		if got := r.Header.Get("SKRouteTag"); got != "route-tag-send-1" {
			t.Fatalf("expected SKRouteTag route-tag-send-1, got %q", got)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		payloads = append(payloads, payload)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":     0,
			"errcode": 0,
			"errmsg":  "",
		})
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_send_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatRouteTagSetting:     "route-tag-send-1",
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-send-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{Text: "hello from codex"},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if len(payloads) != 1 {
		t.Fatalf("expected 1 sendmessage payload, got %#v", payloads)
	}

	msg, _ := payloads[0]["msg"].(map[string]any)
	if got := msg["to_user_id"]; got != "wechat-user-1" {
		t.Fatalf("expected to_user_id wechat-user-1, got %#v", msg)
	}
	if got := msg["context_token"]; got != "ctx-send-1" {
		t.Fatalf("expected context_token ctx-send-1, got %#v", msg)
	}

	itemList, _ := msg["item_list"].([]any)
	if len(itemList) != 1 {
		t.Fatalf("expected one item_list entry, got %#v", msg)
	}
	firstItem, _ := itemList[0].(map[string]any)
	textItem, _ := firstItem["text_item"].(map[string]any)
	if got := textItem["text"]; got != "hello from codex" {
		t.Fatalf("expected text payload hello from codex, got %#v", msg)
	}
}

func TestWeChatProviderSendMessagesRequiresContextToken(t *testing.T) {
	t.Parallel()

	provider := newWeChatProvider(&http.Client{}).(*wechatProvider)
	connection := store.BotConnection{
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      "https://wechat.example.com",
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	err := provider.SendMessages(context.Background(), connection, store.BotConversation{
		ExternalChatID: "wechat-user-1",
	}, []OutboundMessage{{Text: "hello"}})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput when context token is missing, got %v", err)
	}
	if !strings.Contains(err.Error(), "context token") {
		t.Fatalf("expected missing context token detail, got %v", err)
	}
}

func TestWeChatProviderSendMessagesDownloadsRemoteImageURLAndSendsImageItem(t *testing.T) {
	t.Parallel()

	const (
		uploadParam   = "upload-param-remote-image-1"
		downloadParam = "download-param-remote-image-1"
	)

	remoteImageBody := []byte("fake jpeg bytes for remote wechat upload")
	sendPayloads := make([]map[string]any, 0, 2)
	remoteDownloadCalls := 0
	getUploadCalls := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/remote-hormuz-map.jpg":
			remoteDownloadCalls += 1
			w.Header().Set("Content-Type", "image/jpeg")
			_, _ = w.Write(remoteImageBody)
		case "/ilink/bot/getuploadurl":
			getUploadCalls += 1

			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getuploadurl payload: %v", err)
			}
			if got := payload["to_user_id"]; got != "wechat-user-remote-image-1" {
				t.Fatalf("expected getuploadurl to_user_id wechat-user-remote-image-1, got %#v", payload)
			}
			if got := int(payload["media_type"].(float64)); got != wechatUploadMediaTypeImage {
				t.Fatalf("expected getuploadurl media_type image, got %#v", payload)
			}
			if got := int(payload["rawsize"].(float64)); got != len(remoteImageBody) {
				t.Fatalf("expected getuploadurl rawsize %d, got %#v", len(remoteImageBody), payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":          0,
				"errcode":      0,
				"errmsg":       "",
				"upload_param": uploadParam,
			})
		case "/c2c/upload":
			if got := r.URL.Query().Get("encrypted_query_param"); got != uploadParam {
				t.Fatalf("expected upload encrypted_query_param %q, got %q", uploadParam, got)
			}
			w.Header().Set("x-encrypted-param", downloadParam)
			w.WriteHeader(http.StatusOK)
		case "/ilink/bot/sendmessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendmessage payload: %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_remote_image_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-remote-image-1",
			wechatOwnerUserIDSetting:  "wechat-owner-remote-image-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-remote-image-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-remote-image-1",
		},
	}
	remoteURL := server.URL + "/remote-hormuz-map.jpg"

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "已收到。",
			Media: []store.BotMessageMedia{
				{
					Kind:     botMediaKindImage,
					URL:      remoteURL,
					FileName: "Strait_of_Hormuz.jpg",
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if remoteDownloadCalls != 1 {
		t.Fatalf("expected one remote image download, got %d", remoteDownloadCalls)
	}
	if getUploadCalls != 1 {
		t.Fatalf("expected one getuploadurl call, got %d", getUploadCalls)
	}
	if len(sendPayloads) != 2 {
		t.Fatalf("expected text caption plus one image payload, got %#v", sendPayloads)
	}
	if got := wechatTextFromSendPayload(sendPayloads[0]); got != "已收到。" {
		t.Fatalf("expected first payload to contain only the caption, got %#v", sendPayloads[0])
	}

	msg, _ := sendPayloads[1]["msg"].(map[string]any)
	if got := msg["context_token"]; got != "ctx-remote-image-1" {
		t.Fatalf("expected image payload to preserve context_token, got %#v", msg)
	}
	itemList, _ := msg["item_list"].([]any)
	if len(itemList) != 1 {
		t.Fatalf("expected image payload to have exactly one item, got %#v", msg)
	}
	item, _ := itemList[0].(map[string]any)
	if got := int(item["type"].(float64)); got != wechatItemTypeImage {
		t.Fatalf("expected second payload item type image, got %#v", item)
	}
	imageItem, _ := item["image_item"].(map[string]any)
	media, _ := imageItem["media"].(map[string]any)
	if got := media["encrypt_query_param"]; got != downloadParam {
		t.Fatalf("expected image payload encrypt_query_param %q, got %#v", downloadParam, item)
	}
	if got := item["text_item"]; got != nil {
		t.Fatalf("expected image payload not to degrade into a text item, got %#v", item)
	}

	serialized, err := json.Marshal(sendPayloads)
	if err != nil {
		t.Fatalf("json.Marshal(sendPayloads) error = %v", err)
	}
	if strings.Contains(string(serialized), remoteURL) {
		t.Fatalf("expected outbound payloads to omit the original remote URL, got %s", string(serialized))
	}
}

func TestWeChatProviderSendMessagesExtractsRemoteVideoFromHTMLPageAndSendsVideoItem(t *testing.T) {
	t.Parallel()

	const (
		uploadParam   = "upload-param-remote-video-1"
		downloadParam = "download-param-remote-video-1"
	)

	serverURL := ""
	remoteVideoBody := []byte("fake mp4 bytes for remote wechat upload")
	sendPayloads := make([]map[string]any, 0, 2)
	pageFetches := 0
	videoFetches := 0
	getUploadCalls := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/story":
			pageFetches += 1
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><meta property="og:video" content="` + serverURL + `/media/hormuz.mp4"></head><body>story page</body></html>`))
		case "/media/hormuz.mp4":
			videoFetches += 1
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(remoteVideoBody)
		case "/ilink/bot/getuploadurl":
			getUploadCalls += 1

			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getuploadurl payload: %v", err)
			}
			if got := payload["to_user_id"]; got != "wechat-user-remote-video-1" {
				t.Fatalf("expected getuploadurl to_user_id wechat-user-remote-video-1, got %#v", payload)
			}
			if got := int(payload["media_type"].(float64)); got != wechatUploadMediaTypeVideo {
				t.Fatalf("expected getuploadurl media_type video, got %#v", payload)
			}
			if got := int(payload["rawsize"].(float64)); got != len(remoteVideoBody) {
				t.Fatalf("expected getuploadurl rawsize %d, got %#v", len(remoteVideoBody), payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":          0,
				"errcode":      0,
				"errmsg":       "",
				"upload_param": uploadParam,
			})
		case "/c2c/upload":
			if got := r.URL.Query().Get("encrypted_query_param"); got != uploadParam {
				t.Fatalf("expected upload encrypted_query_param %q, got %q", uploadParam, got)
			}
			w.Header().Set("x-encrypted-param", downloadParam)
			w.WriteHeader(http.StatusOK)
		case "/ilink/bot/sendmessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendmessage payload: %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	serverURL = server.URL
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_remote_video_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-remote-video-1",
			wechatOwnerUserIDSetting:  "wechat-owner-remote-video-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-remote-video-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-remote-video-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "发你一个和霍尔木兹海峡相关的视频链接。",
			Media: []store.BotMessageMedia{
				{
					Kind: botMediaKindVideo,
					URL:  server.URL + "/story",
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if pageFetches != 1 {
		t.Fatalf("expected one story page fetch, got %d", pageFetches)
	}
	if videoFetches != 1 {
		t.Fatalf("expected one extracted video fetch, got %d", videoFetches)
	}
	if getUploadCalls != 1 {
		t.Fatalf("expected one getuploadurl call, got %d", getUploadCalls)
	}
	if len(sendPayloads) != 2 {
		t.Fatalf("expected text caption plus one video payload, got %#v", sendPayloads)
	}
	if got := wechatTextFromSendPayload(sendPayloads[0]); got != "发你一个和霍尔木兹海峡相关的视频链接。" {
		t.Fatalf("expected first payload to contain the caption text, got %#v", sendPayloads[0])
	}

	msg, _ := sendPayloads[1]["msg"].(map[string]any)
	itemList, _ := msg["item_list"].([]any)
	if len(itemList) != 1 {
		t.Fatalf("expected video payload to have exactly one item, got %#v", msg)
	}
	item, _ := itemList[0].(map[string]any)
	if got := int(item["type"].(float64)); got != wechatItemTypeVideo {
		t.Fatalf("expected second payload item type video, got %#v", item)
	}
	videoItem, _ := item["video_item"].(map[string]any)
	media, _ := videoItem["media"].(map[string]any)
	if got := media["encrypt_query_param"]; got != downloadParam {
		t.Fatalf("expected video payload encrypt_query_param %q, got %#v", downloadParam, media)
	}
}

func TestWeChatProviderSendMessagesExtractsRemoteVideoThroughIframeEmbedAndSendsVideoItem(t *testing.T) {
	t.Parallel()

	const (
		uploadParam   = "upload-param-remote-video-iframe-1"
		downloadParam = "download-param-remote-video-iframe-1"
	)

	remoteVideoBody := []byte("fake iframe-derived mp4 bytes for remote wechat upload")
	sendPayloads := make([]map[string]any, 0, 2)
	pageFetches := 0
	embedFetches := 0
	videoFetches := 0
	getUploadCalls := 0
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/story":
			pageFetches += 1
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><body><iframe src="/embed/video-player"></iframe></body></html>`))
		case "/embed/video-player":
			embedFetches += 1
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><meta property="og:video" content="` + serverURL + `/media/hormuz.mp4?download=1"></head></html>`))
		case "/media/hormuz.mp4":
			videoFetches += 1
			w.Header().Set("Content-Type", "video/mp4")
			_, _ = w.Write(remoteVideoBody)
		case "/ilink/bot/getuploadurl":
			getUploadCalls += 1

			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getuploadurl payload: %v", err)
			}
			if got := payload["to_user_id"]; got != "wechat-user-remote-video-iframe-1" {
				t.Fatalf("expected getuploadurl to_user_id wechat-user-remote-video-iframe-1, got %#v", payload)
			}
			if got := int(payload["media_type"].(float64)); got != wechatUploadMediaTypeVideo {
				t.Fatalf("expected getuploadurl media_type video, got %#v", payload)
			}
			if got := int(payload["rawsize"].(float64)); got != len(remoteVideoBody) {
				t.Fatalf("expected getuploadurl rawsize %d, got %#v", len(remoteVideoBody), payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":          0,
				"errcode":      0,
				"errmsg":       "",
				"upload_param": uploadParam,
			})
		case "/c2c/upload":
			if got := r.URL.Query().Get("encrypted_query_param"); got != uploadParam {
				t.Fatalf("expected upload encrypted_query_param %q, got %q", uploadParam, got)
			}
			w.Header().Set("x-encrypted-param", downloadParam)
			w.WriteHeader(http.StatusOK)
		case "/ilink/bot/sendmessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendmessage payload: %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	serverURL = server.URL
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_remote_video_iframe_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-remote-video-iframe-1",
			wechatOwnerUserIDSetting:  "wechat-owner-remote-video-iframe-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-remote-video-iframe-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-remote-video-iframe-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "发你一个通过播放器嵌入的视频。",
			Media: []store.BotMessageMedia{
				{
					Kind: botMediaKindVideo,
					URL:  server.URL + "/story",
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if pageFetches != 1 {
		t.Fatalf("expected one story page fetch, got %d", pageFetches)
	}
	if embedFetches != 1 {
		t.Fatalf("expected one embed page fetch, got %d", embedFetches)
	}
	if videoFetches != 1 {
		t.Fatalf("expected one extracted video fetch, got %d", videoFetches)
	}
	if getUploadCalls != 1 {
		t.Fatalf("expected one getuploadurl call, got %d", getUploadCalls)
	}
	if len(sendPayloads) != 2 {
		t.Fatalf("expected text caption plus one video payload, got %#v", sendPayloads)
	}
	if got := wechatTextFromSendPayload(sendPayloads[0]); got != "发你一个通过播放器嵌入的视频。" {
		t.Fatalf("expected first payload to contain the caption text, got %#v", sendPayloads[0])
	}

	msg, _ := sendPayloads[1]["msg"].(map[string]any)
	itemList, _ := msg["item_list"].([]any)
	if len(itemList) != 1 {
		t.Fatalf("expected video payload to have exactly one item, got %#v", msg)
	}
	item, _ := itemList[0].(map[string]any)
	if got := int(item["type"].(float64)); got != wechatItemTypeVideo {
		t.Fatalf("expected second payload item type video, got %#v", item)
	}
	videoItem, _ := item["video_item"].(map[string]any)
	media, _ := videoItem["media"].(map[string]any)
	if got := media["encrypt_query_param"]; got != downloadParam {
		t.Fatalf("expected video payload encrypt_query_param %q, got %#v", downloadParam, media)
	}
}

func TestWeChatProviderSendMessagesFallsBackToTextWhenRemoteVideoPageCannotResolveMedia(t *testing.T) {
	t.Parallel()

	sendPayloads := make([]map[string]any, 0, 1)
	pageFetches := 0

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/story":
			pageFetches += 1
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><title>story only</title></head><body>no downloadable media here</body></html>`))
		case "/ilink/bot/getuploadurl":
			t.Fatal("did not expect getuploadurl to be called when media extraction fails")
		case "/ilink/bot/sendmessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendmessage payload: %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_remote_video_fallback_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-remote-video-fallback-1",
			wechatOwnerUserIDSetting:  "wechat-owner-remote-video-fallback-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-remote-video-fallback-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-remote-video-fallback-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "发你一个和霍尔木兹海峡相关的视频链接。",
			Media: []store.BotMessageMedia{
				{
					Kind: botMediaKindVideo,
					URL:  server.URL + "/story",
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if pageFetches != 1 {
		t.Fatalf("expected one story page fetch, got %d", pageFetches)
	}
	if len(sendPayloads) != 1 {
		t.Fatalf("expected one fallback text payload, got %#v", sendPayloads)
	}
	expectedFallback := "发你一个和霍尔木兹海峡相关的视频链接。\n\n[WeChat attachment delivery fallback]\nvideo " + server.URL + "/story"
	if got := wechatTextFromSendPayload(sendPayloads[0]); got != expectedFallback {
		t.Fatalf("expected fallback text payload, got %#v", sendPayloads[0])
	}
}

func TestWeChatProviderSendMessagesTranscodesStreamingPlaylistToVideoItemWhenTranscoderAvailable(t *testing.T) {
	transcodedVideo := []byte("fake transcoded mp4 payload")

	originalLookPath := lookPathWeChatVideoCommand
	originalExec := execWeChatVideoCommand
	lookPathWeChatVideoCommand = func(file string) (string, error) {
		return file, nil
	}
	execWeChatVideoCommand = func(ctx context.Context, name string, args ...string) *exec.Cmd {
		commandArgs := append([]string{"-test.run=TestHelperProcessWeChatRemoteVideoTranscoder", "--"}, args...)
		command := exec.CommandContext(ctx, os.Args[0], commandArgs...)
		command.Env = append(os.Environ(),
			"GO_WANT_HELPER_PROCESS_WECHAT_VIDEO_TRANSCODER=1",
			"GO_HELPER_WECHAT_VIDEO_TRANSCODER_BYTES="+string(transcodedVideo),
		)
		return command
	}
	t.Cleanup(func() {
		lookPathWeChatVideoCommand = originalLookPath
		execWeChatVideoCommand = originalExec
	})

	const (
		uploadParam   = "upload-param-remote-video-playlist-transcoded-1"
		downloadParam = "download-param-remote-video-playlist-transcoded-1"
	)

	sendPayloads := make([]map[string]any, 0, 2)
	pageFetches := 0
	playlistFetches := 0
	getUploadCalls := 0
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/story":
			pageFetches += 1
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><meta property="og:video" content="` + serverURL + `/media/stream.m3u8?token=abc123"></head><body>story page</body></html>`))
		case "/media/stream.m3u8":
			playlistFetches += 1
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-VERSION:3\n"))
		case "/ilink/bot/getuploadurl":
			getUploadCalls += 1

			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getuploadurl payload: %v", err)
			}
			if got := payload["to_user_id"]; got != "wechat-user-remote-video-playlist-transcoded-1" {
				t.Fatalf("expected getuploadurl to_user_id wechat-user-remote-video-playlist-transcoded-1, got %#v", payload)
			}
			if got := int(payload["media_type"].(float64)); got != wechatUploadMediaTypeVideo {
				t.Fatalf("expected getuploadurl media_type video, got %#v", payload)
			}
			if got := int(payload["rawsize"].(float64)); got != len(transcodedVideo) {
				t.Fatalf("expected getuploadurl rawsize %d, got %#v", len(transcodedVideo), payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":          0,
				"errcode":      0,
				"errmsg":       "",
				"upload_param": uploadParam,
			})
		case "/c2c/upload":
			if got := r.URL.Query().Get("encrypted_query_param"); got != uploadParam {
				t.Fatalf("expected upload encrypted_query_param %q, got %q", uploadParam, got)
			}
			w.Header().Set("x-encrypted-param", downloadParam)
			w.WriteHeader(http.StatusOK)
		case "/ilink/bot/sendmessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendmessage payload: %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	serverURL = server.URL
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_remote_video_playlist_transcoded_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-remote-video-playlist-transcoded-1",
			wechatOwnerUserIDSetting:  "wechat-owner-remote-video-playlist-transcoded-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-remote-video-playlist-transcoded-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-remote-video-playlist-transcoded-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "发你一个已转码的视频。",
			Media: []store.BotMessageMedia{
				{
					Kind: botMediaKindVideo,
					URL:  server.URL + "/story",
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if pageFetches != 1 {
		t.Fatalf("expected one story page fetch, got %d", pageFetches)
	}
	if playlistFetches != 1 {
		t.Fatalf("expected one extracted playlist fetch, got %d", playlistFetches)
	}
	if getUploadCalls != 1 {
		t.Fatalf("expected one getuploadurl call, got %d", getUploadCalls)
	}
	if len(sendPayloads) != 2 {
		t.Fatalf("expected text caption plus one video payload, got %#v", sendPayloads)
	}
	if got := wechatTextFromSendPayload(sendPayloads[0]); got != "发你一个已转码的视频。" {
		t.Fatalf("expected first payload to contain the caption text, got %#v", sendPayloads[0])
	}

	msg, _ := sendPayloads[1]["msg"].(map[string]any)
	itemList, _ := msg["item_list"].([]any)
	if len(itemList) != 1 {
		t.Fatalf("expected video payload to have exactly one item, got %#v", msg)
	}
	item, _ := itemList[0].(map[string]any)
	if got := int(item["type"].(float64)); got != wechatItemTypeVideo {
		t.Fatalf("expected second payload item type video, got %#v", item)
	}
	videoItem, _ := item["video_item"].(map[string]any)
	media, _ := videoItem["media"].(map[string]any)
	if got := media["encrypt_query_param"]; got != downloadParam {
		t.Fatalf("expected video payload encrypt_query_param %q, got %#v", downloadParam, media)
	}
}

func TestHelperProcessWeChatRemoteVideoTranscoder(t *testing.T) {
	if os.Getenv("GO_WANT_HELPER_PROCESS_WECHAT_VIDEO_TRANSCODER") != "1" {
		return
	}

	args := os.Args
	separator := -1
	for index, arg := range args {
		if arg == "--" {
			separator = index
			break
		}
	}
	if separator < 0 || len(args) < separator+3 {
		_, _ = os.Stderr.WriteString("missing helper process output path")
		os.Exit(2)
	}

	outputPath := args[len(args)-1]
	if err := os.WriteFile(outputPath, []byte(os.Getenv("GO_HELPER_WECHAT_VIDEO_TRANSCODER_BYTES")), 0o600); err != nil {
		_, _ = os.Stderr.WriteString(err.Error())
		os.Exit(2)
	}
	os.Exit(0)
}

func TestWeChatProviderSendMessagesFallsBackToTextWhenRemoteVideoResolvesToStreamingPlaylist(t *testing.T) {
	t.Parallel()

	sendPayloads := make([]map[string]any, 0, 1)
	pageFetches := 0
	playlistFetches := 0
	serverURL := ""

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/story":
			pageFetches += 1
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(`<html><head><meta property="og:video" content="` + serverURL + `/media/stream.m3u8?token=abc123"></head><body>story page</body></html>`))
		case "/media/stream.m3u8":
			playlistFetches += 1
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-VERSION:3\n"))
		case "/ilink/bot/getuploadurl":
			t.Fatal("did not expect getuploadurl to be called when remote media resolves to a playlist")
		case "/ilink/bot/sendmessage":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendmessage payload: %v", err)
			}
			sendPayloads = append(sendPayloads, payload)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	serverURL = server.URL
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_remote_video_playlist_fallback_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-remote-video-playlist-fallback-1",
			wechatOwnerUserIDSetting:  "wechat-owner-remote-video-playlist-fallback-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-remote-video-playlist-fallback-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-remote-video-playlist-fallback-1",
		},
	}

	if err := provider.SendMessages(context.Background(), connection, conversation, []OutboundMessage{
		{
			Text: "发你一个播放器流链接。",
			Media: []store.BotMessageMedia{
				{
					Kind: botMediaKindVideo,
					URL:  server.URL + "/story",
				},
			},
		},
	}); err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if pageFetches != 1 {
		t.Fatalf("expected one story page fetch, got %d", pageFetches)
	}
	if playlistFetches != 1 {
		t.Fatalf("expected one extracted playlist fetch, got %d", playlistFetches)
	}
	if len(sendPayloads) != 1 {
		t.Fatalf("expected one fallback text payload, got %#v", sendPayloads)
	}
	expectedFallback := "发你一个播放器流链接。\n\n[WeChat attachment delivery fallback]\nvideo " + server.URL + "/story"
	if got := wechatTextFromSendPayload(sendPayloads[0]); got != expectedFallback {
		t.Fatalf("expected fallback text payload, got %#v", sendPayloads[0])
	}
}

func TestWeChatProviderStartTypingUsesGetConfigAndCachesTypingTicket(t *testing.T) {
	t.Parallel()

	var mu sync.Mutex
	getConfigCalls := 0
	typingStatuses := make([]int, 0, 4)

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/getconfig":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getconfig payload: %v", err)
			}
			if got := payload["ilink_user_id"]; got != "wechat-user-typing-1" {
				t.Fatalf("expected getconfig ilink_user_id wechat-user-typing-1, got %#v", payload)
			}
			if got := payload["context_token"]; got != "ctx-typing-1" {
				t.Fatalf("expected getconfig context_token ctx-typing-1, got %#v", payload)
			}
			mu.Lock()
			getConfigCalls += 1
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":           0,
				"errcode":       0,
				"errmsg":        "",
				"typing_ticket": "typing-ticket-1",
			})
		case "/ilink/bot/sendtyping":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode sendtyping payload: %v", err)
			}
			if got := payload["ilink_user_id"]; got != "wechat-user-typing-1" {
				t.Fatalf("expected sendtyping ilink_user_id wechat-user-typing-1, got %#v", payload)
			}
			if got := payload["typing_ticket"]; got != "typing-ticket-1" {
				t.Fatalf("expected sendtyping typing_ticket typing-ticket-1, got %#v", payload)
			}
			status, _ := payload["status"].(float64)
			mu.Lock()
			typingStatuses = append(typingStatuses, int(status))
			mu.Unlock()
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":     0,
				"errcode": 0,
				"errmsg":  "",
			})
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_typing_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-typing-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-typing-1",
		},
	}

	sessionOne, err := provider.StartTyping(context.Background(), connection, conversation)
	if err != nil {
		t.Fatalf("StartTyping() first call error = %v", err)
	}
	if sessionOne == nil {
		t.Fatal("expected first StartTyping() call to return a session")
	}
	if err := sessionOne.Stop(context.Background()); err != nil {
		t.Fatalf("first typing session Stop() error = %v", err)
	}

	sessionTwo, err := provider.StartTyping(context.Background(), connection, conversation)
	if err != nil {
		t.Fatalf("StartTyping() second call error = %v", err)
	}
	if sessionTwo == nil {
		t.Fatal("expected second StartTyping() call to return a session")
	}
	if err := sessionTwo.Stop(context.Background()); err != nil {
		t.Fatalf("second typing session Stop() error = %v", err)
	}

	mu.Lock()
	defer mu.Unlock()

	if getConfigCalls != 1 {
		t.Fatalf("expected typing ticket to be cached after first getconfig, got %d calls", getConfigCalls)
	}
	expectedStatuses := []int{
		wechatTypingStatusTyping,
		wechatTypingStatusCancel,
		wechatTypingStatusTyping,
		wechatTypingStatusCancel,
	}
	if len(typingStatuses) != len(expectedStatuses) {
		t.Fatalf("expected typing status sequence %#v, got %#v", expectedStatuses, typingStatuses)
	}
	for index, expected := range expectedStatuses {
		if typingStatuses[index] != expected {
			t.Fatalf("expected typing status sequence %#v, got %#v", expectedStatuses, typingStatuses)
		}
	}
}

func TestWeChatStreamingReplySessionSendsCommittedSegmentsBeforeCompletion(t *testing.T) {
	t.Parallel()

	var payloads []map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ilink/bot/sendmessage" {
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
		var payload map[string]any
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode payload: %v", err)
		}
		payloads = append(payloads, payload)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ret":     0,
			"errcode": 0,
			"errmsg":  "",
		})
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_stream_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}
	conversation := store.BotConversation{
		ExternalChatID: "wechat-user-stream-1",
		ProviderState: map[string]string{
			wechatContextTokenKey: "ctx-stream-1",
		},
	}

	session, err := provider.StartStreamingReply(context.Background(), connection, conversation)
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "segment 1"}},
	}); err != nil {
		t.Fatalf("first Update() error = %v", err)
	}
	if len(payloads) != 0 {
		t.Fatalf("expected first incomplete segment to stay buffered, got %#v", payloads)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{Text: "segment 1"},
			{Text: "segment 2"},
		},
	}); err != nil {
		t.Fatalf("second Update() error = %v", err)
	}
	if len(payloads) != 1 {
		t.Fatalf("expected first committed segment to send before completion, got %#v", payloads)
	}
	if got := wechatTextFromSendPayload(payloads[0]); got != "segment 1" {
		t.Fatalf("expected first committed segment text segment 1, got %q", got)
	}

	if err := session.Complete(context.Background(), []OutboundMessage{
		{Text: "segment 1"},
		{Text: "segment 2"},
		{Text: "segment 3"},
	}); err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	if len(payloads) != 3 {
		t.Fatalf("expected remaining segments to flush on completion, got %#v", payloads)
	}
	if got := wechatTextFromSendPayload(payloads[1]); got != "segment 2" {
		t.Fatalf("expected second committed segment text segment 2, got %q", got)
	}
	if got := wechatTextFromSendPayload(payloads[2]); got != "segment 3" {
		t.Fatalf("expected final segment text segment 3, got %q", got)
	}
}

func TestBuildWeChatOutboundMediaItemEncodesAESKeyAsBase64HexString(t *testing.T) {
	t.Parallel()

	uploaded := wechatUploadedMedia{
		Kind:           botMediaKindFile,
		FileName:       "handoff.pdf",
		PlaintextSize:  123,
		CiphertextSize: 128,
		DownloadParam:  "download-param-1",
		AESKey:         []byte{0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff},
	}

	item := buildWeChatOutboundMediaItem(uploaded)
	if item.Type != wechatItemTypeFile || item.FileItem == nil || item.FileItem.Media == nil {
		t.Fatalf("expected file item with media payload, got %#v", item)
	}

	expectedAESKey := base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(uploaded.AESKey)))
	if got := item.FileItem.Media.AESKey; got != expectedAESKey {
		t.Fatalf("expected aes_key %q, got %q", expectedAESKey, got)
	}
	if got := item.FileItem.Media.EncryptQueryParam; got != uploaded.DownloadParam {
		t.Fatalf("expected encrypt_query_param %q, got %q", uploaded.DownloadParam, got)
	}
	if got := item.FileItem.Len; got != "123" {
		t.Fatalf("expected plaintext len 123, got %q", got)
	}
}

func TestWeChatProviderRunPollingReceivesEncryptedFileAttachment(t *testing.T) {
	t.Parallel()

	plaintext := []byte("hello from inbound file\nsecond line\n")
	aesKey := []byte{0x10, 0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87, 0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f}
	ciphertext, err := encryptWeChatAESECB(plaintext, aesKey)
	if err != nil {
		t.Fatalf("encryptWeChatAESECB() error = %v", err)
	}

	const downloadParam = "download-param-file-1"
	encodedAESKey := base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(aesKey)))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/getupdates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":             0,
				"errcode":         0,
				"errmsg":          "",
				"get_updates_buf": "sync-file-2",
				"msgs": []map[string]any{
					{
						"from_user_id":   "wechat-user-file-1",
						"client_id":      "client-file-1",
						"session_id":     "session-file-1",
						"message_type":   wechatMessageTypeUser,
						"message_state":  wechatMessageStateComplete,
						"context_token":  "ctx-file-1",
						"create_time_ms": 1710000001000,
						"item_list": []map[string]any{
							{
								"type": wechatItemTypeFile,
								"file_item": map[string]any{
									"file_name": "report.txt",
									"len":       "34",
									"media": map[string]any{
										"encrypt_query_param": downloadParam,
										"aes_key":             encodedAESKey,
										"encrypt_type":        1,
									},
								},
							},
						},
					},
				},
			})
		case "/c2c/download":
			if got := r.URL.Query().Get("encrypted_query_param"); got != downloadParam {
				t.Fatalf("expected encrypted_query_param %q, got %q", downloadParam, got)
			}
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write(ciphertext)
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_file_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-1",
			wechatOwnerUserIDSetting:  "wechat-owner-1",
			wechatSyncBufSetting:      "sync-file-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var messages []InboundMessage
	err = provider.RunPolling(
		ctx,
		connection,
		func(_ context.Context, message InboundMessage) error {
			messages = append(messages, message)
			cancel()
			return nil
		},
		func(_ context.Context, _ map[string]string) error {
			return nil
		},
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after first file message, got %v", err)
	}

	if len(messages) != 1 {
		t.Fatalf("expected 1 inbound wechat file message, got %#v", messages)
	}
	if got := messages[0].ConversationID; got != "wechat-user-file-1" {
		t.Fatalf("expected conversation id wechat-user-file-1, got %#v", messages[0])
	}
	if len(messages[0].Media) != 1 {
		t.Fatalf("expected exactly 1 media attachment, got %#v", messages[0].Media)
	}

	media := messages[0].Media[0]
	if media.Kind != botMediaKindFile {
		t.Fatalf("expected file media kind, got %#v", media)
	}
	if media.FileName != "report.txt" {
		t.Fatalf("expected file name report.txt, got %#v", media)
	}
	if media.Path == "" {
		t.Fatalf("expected inbound file attachment to persist a local path, got %#v", media)
	}
	defer os.Remove(media.Path)

	data, err := os.ReadFile(media.Path)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) error = %v", media.Path, err)
	}
	if string(data) != string(plaintext) {
		t.Fatalf("expected decrypted inbound file contents %q, got %q", string(plaintext), string(data))
	}
	if !strings.Contains(messages[0].Text, "[File attachment]") {
		t.Fatalf("expected message summary text to mention file attachment, got %q", messages[0].Text)
	}
}

func TestWeChatProviderRunPollingFallsBackToQuotedFileAttachment(t *testing.T) {
	t.Parallel()

	plaintext := []byte("quoted attachment body\n")
	aesKey := []byte{0x21, 0x32, 0x43, 0x54, 0x65, 0x76, 0x87, 0x98, 0xa9, 0xba, 0xcb, 0xdc, 0xed, 0xfe, 0x0f, 0x10}
	ciphertext, err := encryptWeChatAESECB(plaintext, aesKey)
	if err != nil {
		t.Fatalf("encryptWeChatAESECB() error = %v", err)
	}

	const downloadParam = "download-param-quoted-file-1"
	encodedAESKey := base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(aesKey)))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/getupdates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":             0,
				"errcode":         0,
				"errmsg":          "",
				"get_updates_buf": "sync-quoted-2",
				"msgs": []map[string]any{
					{
						"from_user_id":   "wechat-user-quoted-1",
						"client_id":      "client-quoted-1",
						"session_id":     "session-quoted-1",
						"message_type":   wechatMessageTypeUser,
						"message_state":  wechatMessageStateComplete,
						"context_token":  "ctx-quoted-1",
						"create_time_ms": 1710000004000,
						"item_list": []map[string]any{
							{
								"type": wechatItemTypeText,
								"text_item": map[string]any{
									"text": "请查看我引用的附件",
								},
								"ref_msg": map[string]any{
									"title": "quoted file",
									"message_item": map[string]any{
										"type": wechatItemTypeFile,
										"file_item": map[string]any{
											"file_name": "quoted.txt",
											"media": map[string]any{
												"encrypt_query_param": downloadParam,
												"aes_key":             encodedAESKey,
												"encrypt_type":        1,
											},
										},
									},
								},
							},
						},
					},
				},
			})
		case "/c2c/download":
			if got := r.URL.Query().Get("encrypted_query_param"); got != downloadParam {
				t.Fatalf("expected encrypted_query_param %q, got %q", downloadParam, got)
			}
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write(ciphertext)
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_quoted_file_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-quoted-1",
			wechatOwnerUserIDSetting:  "wechat-owner-quoted-1",
			wechatSyncBufSetting:      "sync-quoted-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var messages []InboundMessage
	err = provider.RunPolling(
		ctx,
		connection,
		func(_ context.Context, message InboundMessage) error {
			messages = append(messages, message)
			cancel()
			return nil
		},
		func(context.Context, map[string]string) error { return nil },
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after first quoted message, got %v", err)
	}

	if len(messages) != 1 {
		t.Fatalf("expected exactly one quoted inbound message, got %#v", messages)
	}
	if len(messages[0].Media) != 1 {
		t.Fatalf("expected quoted fallback to produce one media attachment, got %#v", messages[0].Media)
	}
	media := messages[0].Media[0]
	if media.Kind != botMediaKindFile || media.FileName != "quoted.txt" {
		t.Fatalf("expected quoted file attachment metadata, got %#v", media)
	}
	if media.Path == "" {
		t.Fatalf("expected quoted file attachment to be persisted locally, got %#v", media)
	}
	defer os.Remove(media.Path)

	data, err := os.ReadFile(media.Path)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) error = %v", media.Path, err)
	}
	if string(data) != string(plaintext) {
		t.Fatalf("expected quoted file contents %q, got %q", string(plaintext), string(data))
	}
	if !strings.Contains(messages[0].Text, "[File attachment]") {
		t.Fatalf("expected quoted message summary to mention file attachment, got %q", messages[0].Text)
	}
}

func TestWeChatProviderRunPollingTranscodesVoiceToWAVWhenDecoderAvailable(t *testing.T) {
	decoderDir := t.TempDir()
	decoderPath := filepath.Join(decoderDir, "silk_v3_decoder.cmd")
	decoderScript := "@echo off\r\ncopy /Y \"%~1\" \"%~2\" >nul\r\n"
	if err := os.WriteFile(decoderPath, []byte(decoderScript), 0o755); err != nil {
		t.Fatalf("os.WriteFile(%q) error = %v", decoderPath, err)
	}
	t.Setenv("CODEX_WECHAT_SILK_DECODER", decoderPath)

	plaintext := []byte("fake silk payload")
	aesKey := []byte{0x31, 0x42, 0x53, 0x64, 0x75, 0x86, 0x97, 0xa8, 0xb9, 0xca, 0xdb, 0xec, 0xfd, 0x0e, 0x1f, 0x20}
	ciphertext, err := encryptWeChatAESECB(plaintext, aesKey)
	if err != nil {
		t.Fatalf("encryptWeChatAESECB() error = %v", err)
	}

	const downloadParam = "download-param-voice-1"
	encodedAESKey := base64.StdEncoding.EncodeToString([]byte(hex.EncodeToString(aesKey)))

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ilink/bot/getupdates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ret":             0,
				"errcode":         0,
				"errmsg":          "",
				"get_updates_buf": "sync-voice-2",
				"msgs": []map[string]any{
					{
						"from_user_id":   "wechat-user-voice-1",
						"client_id":      "client-voice-1",
						"session_id":     "session-voice-1",
						"message_type":   wechatMessageTypeUser,
						"message_state":  wechatMessageStateComplete,
						"context_token":  "ctx-voice-1",
						"create_time_ms": 1710000005000,
						"item_list": []map[string]any{
							{
								"type": wechatItemTypeVoice,
								"voice_item": map[string]any{
									"media": map[string]any{
										"encrypt_query_param": downloadParam,
										"aes_key":             encodedAESKey,
										"encrypt_type":        1,
									},
								},
							},
						},
					},
				},
			})
		case "/c2c/download":
			if got := r.URL.Query().Get("encrypted_query_param"); got != downloadParam {
				t.Fatalf("expected encrypted_query_param %q, got %q", downloadParam, got)
			}
			w.Header().Set("Content-Type", "application/octet-stream")
			_, _ = w.Write(ciphertext)
		default:
			t.Fatalf("unexpected wechat API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newWeChatProvider(server.Client()).(*wechatProvider)
	connection := store.BotConnection{
		ID:       "bot_wechat_voice_1",
		Provider: wechatProviderName,
		Settings: map[string]string{
			wechatDeliveryModeSetting: wechatDeliveryModePolling,
			wechatBaseURLSetting:      server.URL,
			wechatCDNBaseURLSetting:   server.URL + "/c2c",
			wechatAccountIDSetting:    "wechat-account-voice-1",
			wechatOwnerUserIDSetting:  "wechat-owner-voice-1",
			wechatSyncBufSetting:      "sync-voice-1",
		},
		Secrets: map[string]string{
			"bot_token": "wechat-token",
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var messages []InboundMessage
	err = provider.RunPolling(
		ctx,
		connection,
		func(_ context.Context, message InboundMessage) error {
			messages = append(messages, message)
			cancel()
			return nil
		},
		func(context.Context, map[string]string) error { return nil },
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected context cancellation after first voice message, got %v", err)
	}
	if len(messages) != 1 || len(messages[0].Media) != 1 {
		t.Fatalf("expected one inbound voice message with one attachment, got %#v", messages)
	}

	media := messages[0].Media[0]
	if media.Kind != botMediaKindVoice {
		t.Fatalf("expected voice media kind, got %#v", media)
	}
	if media.ContentType != "audio/wav" {
		t.Fatalf("expected transcoded voice content type audio/wav, got %#v", media)
	}
	if !strings.HasSuffix(strings.ToLower(media.FileName), ".wav") {
		t.Fatalf("expected transcoded voice file name to end with .wav, got %#v", media)
	}
	if media.Path == "" {
		t.Fatalf("expected transcoded voice file path, got %#v", media)
	}
	defer os.Remove(media.Path)

	data, err := os.ReadFile(media.Path)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) error = %v", media.Path, err)
	}
	if string(data) != string(plaintext) {
		t.Fatalf("expected transcoded voice file contents %q, got %q", string(plaintext), string(data))
	}
}

func wechatTextFromSendPayload(payload map[string]any) string {
	msg, _ := payload["msg"].(map[string]any)
	itemList, _ := msg["item_list"].([]any)
	if len(itemList) == 0 {
		return ""
	}
	firstItem, _ := itemList[0].(map[string]any)
	textItem, _ := firstItem["text_item"].(map[string]any)
	return strings.TrimSpace(stringValue(textItem["text"]))
}

func assertValidWeChatUINHeader(t *testing.T, headers http.Header) {
	t.Helper()
	assertValidWeChatUINValue(t, headers.Get("X-WECHAT-UIN"))
}

func assertValidWeChatUINValue(t *testing.T, value string) {
	t.Helper()

	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		t.Fatal("expected X-WECHAT-UIN header to be present")
	}

	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err != nil {
		t.Fatalf("expected X-WECHAT-UIN to be valid base64, got %q: %v", trimmed, err)
	}
	if len(decoded) == 0 {
		t.Fatalf("expected decoded X-WECHAT-UIN to be non-empty, got %q", trimmed)
	}
	for _, ch := range string(decoded) {
		if ch < '0' || ch > '9' {
			t.Fatalf("expected decoded X-WECHAT-UIN to be decimal digits, got %q", string(decoded))
		}
	}
}
