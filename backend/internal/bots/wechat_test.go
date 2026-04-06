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
	"strings"
	"sync"
	"testing"

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
	if !strings.Contains(messages[0].Text, "[WeChat file attachment]") {
		t.Fatalf("expected message summary text to mention file attachment, got %q", messages[0].Text)
	}
}
