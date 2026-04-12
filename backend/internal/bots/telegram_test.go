package bots

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
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

func TestTelegramProviderParseWebhookExtractsInboundMediaAttachments(t *testing.T) {
	t.Parallel()

	type downloadFixture struct {
		FilePath    string
		ContentType string
		Body        string
	}

	downloads := map[string]downloadFixture{
		"photo-full": {
			FilePath:    "photos/test-image.jpg",
			ContentType: "image/jpeg",
			Body:        "image-bytes",
		},
		"video-1": {
			FilePath:    "videos/clip.mp4",
			ContentType: "video/mp4",
			Body:        "video-bytes",
		},
		"document-1": {
			FilePath:    "docs/report.pdf",
			ContentType: "application/pdf",
			Body:        "pdf-bytes",
		},
		"voice-1": {
			FilePath:    "voices/voice.ogg",
			ContentType: "audio/ogg",
			Body:        "voice-bytes",
		},
		"audio-1": {
			FilePath:    "audio/track.mp3",
			ContentType: "audio/mpeg",
			Body:        "audio-bytes",
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/bot123:abc/getFile":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getFile payload error = %v", err)
			}
			fileID, _ := payload["file_id"].(string)
			fixture, ok := downloads[fileID]
			if !ok {
				t.Fatalf("unexpected telegram file id %q", fileID)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"file_id":        fileID,
					"file_path":      fixture.FilePath,
					"file_size":      len(fixture.Body),
					"file_unique_id": fileID + "-unique",
				},
			})
		case strings.HasPrefix(r.URL.Path, "/file/bot123:abc/"):
			filePath := strings.TrimPrefix(r.URL.Path, "/file/bot123:abc/")
			for _, fixture := range downloads {
				if fixture.FilePath != filePath {
					continue
				}
				w.Header().Set("Content-Type", fixture.ContentType)
				_, _ = io.WriteString(w, fixture.Body)
				return
			}
			t.Fatalf("unexpected telegram file download path %q", r.URL.Path)
		default:
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	testCases := []struct {
		name            string
		requestBody     string
		wantKind        string
		wantText        string
		wantFileName    string
		wantContentType string
		wantBody        string
		wantFileID      string
	}{
		{
			name: "photo with caption",
			requestBody: `{
				"message":{
					"message_id":99,
					"caption":"look at this",
					"photo":[
						{"file_id":"photo-thumb","file_unique_id":"photo-thumb-u","width":64,"height":64,"file_size":100},
						{"file_id":"photo-full","file_unique_id":"photo-full-u","width":1280,"height":720,"file_size":1000}
					],
					"chat":{"id":1001,"title":"Alice"},
					"from":{"id":5001,"username":"alice","first_name":"Alice","is_bot":false}
				}
			}`,
			wantKind:        botMediaKindImage,
			wantText:        "look at this",
			wantFileName:    "test-image.jpg",
			wantContentType: "image/jpeg",
			wantBody:        "image-bytes",
			wantFileID:      "photo-full",
		},
		{
			name: "video with caption",
			requestBody: `{
				"message":{
					"message_id":100,
					"caption":"watch this",
					"video":{"file_id":"video-1","file_unique_id":"video-u1","file_name":"clip.mp4","mime_type":"video/mp4","file_size":12},
					"chat":{"id":1002,"title":"Bob"},
					"from":{"id":5002,"username":"bob","first_name":"Bob","is_bot":false}
				}
			}`,
			wantKind:        botMediaKindVideo,
			wantText:        "watch this",
			wantFileName:    "clip.mp4",
			wantContentType: "video/mp4",
			wantBody:        "video-bytes",
			wantFileID:      "video-1",
		},
		{
			name: "document only",
			requestBody: `{
				"message":{
					"message_id":101,
					"document":{"file_id":"document-1","file_unique_id":"document-u1","file_name":"report.pdf","mime_type":"application/pdf","file_size":12},
					"chat":{"id":1003,"title":"Carol"},
					"from":{"id":5003,"username":"carol","first_name":"Carol","is_bot":false}
				}
			}`,
			wantKind:        botMediaKindFile,
			wantText:        "",
			wantFileName:    "report.pdf",
			wantContentType: "application/pdf",
			wantBody:        "pdf-bytes",
			wantFileID:      "document-1",
		},
		{
			name: "voice only",
			requestBody: `{
				"message":{
					"message_id":102,
					"voice":{"file_id":"voice-1","file_unique_id":"voice-u1","mime_type":"audio/ogg","file_size":12},
					"chat":{"id":1004,"title":"Dana"},
					"from":{"id":5004,"username":"dana","first_name":"Dana","is_bot":false}
				}
			}`,
			wantKind:        botMediaKindVoice,
			wantText:        "",
			wantFileName:    "voice.ogg",
			wantContentType: "audio/ogg",
			wantBody:        "voice-bytes",
			wantFileID:      "voice-1",
		},
		{
			name: "audio with caption",
			requestBody: `{
				"message":{
					"message_id":103,
					"caption":"listen to this",
					"audio":{"file_id":"audio-1","file_unique_id":"audio-u1","file_name":"track.mp3","mime_type":"audio/mpeg","file_size":12},
					"chat":{"id":1005,"title":"Eve"},
					"from":{"id":5005,"username":"eve","first_name":"Eve","is_bot":false}
				}
			}`,
			wantKind:        botMediaKindAudio,
			wantText:        "listen to this",
			wantFileName:    "track.mp3",
			wantContentType: "audio/mpeg",
			wantBody:        "audio-bytes",
			wantFileID:      "audio-1",
		},
	}

	for _, tc := range testCases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/hooks/bots/bot_001", strings.NewReader(tc.requestBody))
			messages, err := provider.ParseWebhook(request, store.BotConnection{
				Secrets: map[string]string{"bot_token": "123:abc"},
			})
			if err != nil {
				t.Fatalf("ParseWebhook() error = %v", err)
			}
			if len(messages) != 1 {
				t.Fatalf("expected 1 telegram inbound message, got %d", len(messages))
			}
			if messages[0].Text != tc.wantText {
				t.Fatalf("expected telegram inbound text %q, got %#v", tc.wantText, messages[0])
			}
			if messages[0].ProviderData[telegramMediaKindProviderDataKey] != tc.wantKind {
				t.Fatalf("expected telegram media kind provider data %q, got %#v", tc.wantKind, messages[0].ProviderData)
			}
			if messages[0].ProviderData[telegramMediaFileIDProviderDataKey] != tc.wantFileID {
				t.Fatalf("expected telegram media file id provider data %q, got %#v", tc.wantFileID, messages[0].ProviderData)
			}
			if len(messages[0].Media) != 1 {
				t.Fatalf("expected one telegram inbound media item, got %#v", messages[0])
			}
			media := messages[0].Media[0]
			if media.Kind != tc.wantKind || media.FileName != tc.wantFileName || media.ContentType != tc.wantContentType {
				t.Fatalf("unexpected telegram inbound media metadata %#v", media)
			}
			if media.Path == "" {
				t.Fatalf("expected telegram inbound media to persist a local path, got %#v", media)
			}
			defer os.Remove(media.Path)
			data, err := os.ReadFile(media.Path)
			if err != nil {
				t.Fatalf("os.ReadFile(%q) error = %v", media.Path, err)
			}
			if string(data) != tc.wantBody {
				t.Fatalf("expected telegram inbound media contents %q, got %q", tc.wantBody, string(data))
			}
		})
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
		nil,
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

func TestTelegramProviderRunPollingAcceptsDocumentOnlyMessage(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/getUpdates":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": []map[string]any{
					{
						"update_id": 21,
						"message": map[string]any{
							"message_id": 111,
							"document": map[string]any{
								"file_id":        "document-1",
								"file_unique_id": "document-u1",
								"file_name":      "report.pdf",
								"mime_type":      "application/pdf",
								"file_size":      32,
							},
							"chat": map[string]any{
								"id":    1006,
								"title": "Ops",
							},
							"from": map[string]any{
								"id":         5006,
								"username":   "ops",
								"first_name": "Ops",
								"is_bot":     false,
							},
						},
					},
				},
			})
		case "/bot123:abc/getFile":
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode getFile payload error = %v", err)
			}
			if payload["file_id"] != "document-1" {
				t.Fatalf("expected document-1 getFile payload, got %#v", payload)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"file_id":        "document-1",
					"file_path":      "docs/report.pdf",
					"file_size":      32,
					"file_unique_id": "document-u1",
				},
			})
		case "/file/bot123:abc/docs/report.pdf":
			w.Header().Set("Content-Type", "application/pdf")
			_, _ = io.WriteString(w, "document-body")
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
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected polling to stop with context.Canceled, got %v", err)
	}

	if len(handled) != 1 {
		t.Fatalf("expected one handled polling message, got %#v", handled)
	}
	if handled[0].Text != "" {
		t.Fatalf("expected document-only polling message to keep empty text, got %#v", handled[0])
	}
	if len(handled[0].Media) != 1 || handled[0].Media[0].Kind != botMediaKindFile {
		t.Fatalf("expected document-only polling message to include file media, got %#v", handled[0])
	}
	defer os.Remove(handled[0].Media[0].Path)
	data, err := os.ReadFile(handled[0].Media[0].Path)
	if err != nil {
		t.Fatalf("os.ReadFile(%q) error = %v", handled[0].Media[0].Path, err)
	}
	if string(data) != "document-body" {
		t.Fatalf("expected persisted telegram polling document body, got %q", string(data))
	}
	if persistedSettings[telegramUpdateOffsetSetting] != "22" {
		t.Fatalf("expected telegram update offset 22, got %#v", persistedSettings)
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

func TestTelegramStreamingReplySessionRejectsMediaAttachmentsDuringUpdate(t *testing.T) {
	t.Parallel()

	provider := newTelegramProvider(nil).(*telegramProvider)

	session, err := provider.StartStreamingReply(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	err = session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{
			{
				Media: []store.BotMessageMedia{
					{Kind: botMediaKindImage, URL: "https://example.com/image.png"},
				},
			},
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for telegram streaming update media, got %v", err)
	}
}

func TestTelegramStreamingReplySessionCompleteWithMediaDeletesInterimChunks(t *testing.T) {
	t.Parallel()

	callOrder := make([]string, 0, 3)
	var deletePayload map[string]any
	var sendPhotoPayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			callOrder = append(callOrder, "sendMessage")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 901,
				},
			})
		case "/bot123:abc/deleteMessage":
			callOrder = append(callOrder, "deleteMessage")
			if err := json.NewDecoder(r.Body).Decode(&deletePayload); err != nil {
				t.Fatalf("decode deleteMessage payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		case "/bot123:abc/sendPhoto":
			callOrder = append(callOrder, "sendPhoto")
			if err := json.NewDecoder(r.Body).Decode(&sendPhotoPayload); err != nil {
				t.Fatalf("decode sendPhoto payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 902,
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
		ExternalChatID:   "1001",
		ExternalThreadID: "77",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "working draft"}},
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	err = session.Complete(context.Background(), []OutboundMessage{
		{
			Text: "final caption",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindImage, URL: "https://example.com/image.png"},
			},
		},
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	expectedOrder := []string{"sendMessage", "deleteMessage", "sendPhoto"}
	if strings.Join(callOrder, ",") != strings.Join(expectedOrder, ",") {
		t.Fatalf("unexpected telegram call order %#v", callOrder)
	}
	if deletePayload["message_id"] != float64(901) {
		t.Fatalf("expected deleteMessage for interim streamed message 901, got %#v", deletePayload)
	}
	if sendPhotoPayload["chat_id"] != "1001" {
		t.Fatalf("expected sendPhoto chat_id 1001, got %#v", sendPhotoPayload)
	}
	if sendPhotoPayload["message_thread_id"] != float64(77) {
		t.Fatalf("expected sendPhoto message_thread_id 77, got %#v", sendPhotoPayload)
	}
	if sendPhotoPayload["photo"] != "https://example.com/image.png" {
		t.Fatalf("expected sendPhoto photo url, got %#v", sendPhotoPayload)
	}
	if sendPhotoPayload["caption"] != "final caption" {
		t.Fatalf("expected sendPhoto caption, got %#v", sendPhotoPayload)
	}
}

func TestTelegramStreamingReplySessionCompleteWithMediaGroupDeletesInterimChunks(t *testing.T) {
	t.Parallel()

	callOrder := make([]string, 0, 3)
	var deletePayload map[string]any
	var sendMediaGroupPayload map[string]any

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/sendMessage":
			callOrder = append(callOrder, "sendMessage")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": map[string]any{
					"message_id": 911,
				},
			})
		case "/bot123:abc/deleteMessage":
			callOrder = append(callOrder, "deleteMessage")
			if err := json.NewDecoder(r.Body).Decode(&deletePayload); err != nil {
				t.Fatalf("decode deleteMessage payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok":     true,
				"result": true,
			})
		case "/bot123:abc/sendMediaGroup":
			callOrder = append(callOrder, "sendMediaGroup")
			if err := json.NewDecoder(r.Body).Decode(&sendMediaGroupPayload); err != nil {
				t.Fatalf("decode sendMediaGroup payload error = %v", err)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": []map[string]any{
					{"message_id": 912},
					{"message_id": 913},
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
		ExternalChatID:   "1001",
		ExternalThreadID: "77",
	})
	if err != nil {
		t.Fatalf("StartStreamingReply() error = %v", err)
	}

	if err := session.Update(context.Background(), StreamingUpdate{
		Messages: []OutboundMessage{{Text: "working draft"}},
	}); err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	err = session.Complete(context.Background(), []OutboundMessage{
		{
			Text: "final album caption",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindImage, URL: "https://example.com/image-1.png"},
				{Kind: botMediaKindImage, URL: "https://example.com/image-2.png"},
			},
		},
	})
	if err != nil {
		t.Fatalf("Complete() error = %v", err)
	}

	expectedOrder := []string{"sendMessage", "deleteMessage", "sendMediaGroup"}
	if strings.Join(callOrder, ",") != strings.Join(expectedOrder, ",") {
		t.Fatalf("unexpected telegram call order %#v", callOrder)
	}
	if deletePayload["message_id"] != float64(911) {
		t.Fatalf("expected deleteMessage for interim streamed message 911, got %#v", deletePayload)
	}
	if sendMediaGroupPayload["chat_id"] != "1001" {
		t.Fatalf("expected sendMediaGroup chat_id 1001, got %#v", sendMediaGroupPayload)
	}
	if sendMediaGroupPayload["message_thread_id"] != float64(77) {
		t.Fatalf("expected sendMediaGroup message_thread_id 77, got %#v", sendMediaGroupPayload)
	}
	items, ok := sendMediaGroupPayload["media"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("expected 2 sendMediaGroup items, got %#v", sendMediaGroupPayload["media"])
	}
	firstItem, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first media item to be an object, got %#v", items[0])
	}
	secondItem, ok := items[1].(map[string]any)
	if !ok {
		t.Fatalf("expected second media item to be an object, got %#v", items[1])
	}
	if firstItem["caption"] != "final album caption" {
		t.Fatalf("expected caption on first media group item, got %#v", firstItem)
	}
	if secondItem["media"] != "https://example.com/image-2.png" {
		t.Fatalf("expected second media item to preserve source URL, got %#v", secondItem)
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

func TestTelegramProviderSendMessagesSendsImageByURL(t *testing.T) {
	t.Parallel()

	var sendPhotoPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendPhoto" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		if err := json.NewDecoder(r.Body).Decode(&sendPhotoPayload); err != nil {
			t.Fatalf("decode sendPhoto payload error = %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": 730,
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
	}, []OutboundMessage{
		{
			Text: "topic image",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindImage, URL: "https://example.com/image.png"},
			},
		},
	})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if sendPhotoPayload["chat_id"] != "-100123" {
		t.Fatalf("expected chat_id -100123, got %#v", sendPhotoPayload)
	}
	if sendPhotoPayload["message_thread_id"] != float64(77) {
		t.Fatalf("expected message_thread_id 77, got %#v", sendPhotoPayload)
	}
	if sendPhotoPayload["photo"] != "https://example.com/image.png" {
		t.Fatalf("expected photo url in payload, got %#v", sendPhotoPayload)
	}
	if sendPhotoPayload["caption"] != "topic image" {
		t.Fatalf("expected caption topic image, got %#v", sendPhotoPayload)
	}
}

func TestTelegramProviderSendMessagesUsesMediaGroupForMultipleImages(t *testing.T) {
	t.Parallel()

	var sendMediaGroupPayload map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendMediaGroup" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		if err := json.NewDecoder(r.Body).Decode(&sendMediaGroupPayload); err != nil {
			t.Fatalf("decode sendMediaGroup payload error = %v", err)
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": []map[string]any{
				{"message_id": 740},
				{"message_id": 741},
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
	}, []OutboundMessage{
		{
			Text: "topic album",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindImage, URL: "https://example.com/image-1.png"},
				{Kind: botMediaKindImage, URL: "https://example.com/image-2.png"},
			},
		},
	})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if sendMediaGroupPayload["chat_id"] != "-100123" {
		t.Fatalf("expected chat_id -100123, got %#v", sendMediaGroupPayload)
	}
	if sendMediaGroupPayload["message_thread_id"] != float64(77) {
		t.Fatalf("expected message_thread_id 77, got %#v", sendMediaGroupPayload)
	}

	items, ok := sendMediaGroupPayload["media"].([]any)
	if !ok || len(items) != 2 {
		t.Fatalf("expected 2 sendMediaGroup items, got %#v", sendMediaGroupPayload["media"])
	}
	firstItem, ok := items[0].(map[string]any)
	if !ok {
		t.Fatalf("expected first media item to be an object, got %#v", items[0])
	}
	secondItem, ok := items[1].(map[string]any)
	if !ok {
		t.Fatalf("expected second media item to be an object, got %#v", items[1])
	}
	if firstItem["type"] != "photo" || firstItem["media"] != "https://example.com/image-1.png" {
		t.Fatalf("unexpected first media group item %#v", firstItem)
	}
	if firstItem["caption"] != "topic album" {
		t.Fatalf("expected caption on first media item, got %#v", firstItem)
	}
	if secondItem["type"] != "photo" || secondItem["media"] != "https://example.com/image-2.png" {
		t.Fatalf("unexpected second media group item %#v", secondItem)
	}
	if _, ok := secondItem["caption"]; ok {
		t.Fatalf("did not expect caption on second media item, got %#v", secondItem)
	}
}

func TestTelegramProviderSendMessagesUploadsMediaGroupFromAbsolutePaths(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	firstPath := filepath.Join(tempDir, "album-1.jpg")
	secondPath := filepath.Join(tempDir, "album-2.jpg")
	if err := os.WriteFile(firstPath, []byte("album image 1"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(firstPath) error = %v", err)
	}
	if err := os.WriteFile(secondPath, []byte("album image 2"), 0o600); err != nil {
		t.Fatalf("os.WriteFile(secondPath) error = %v", err)
	}

	fields := make(map[string]string)
	uploadedNames := make(map[string]string)
	uploadedBodies := make(map[string]string)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendMediaGroup" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader() error = %v", err)
		}
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				t.Fatalf("NextPart() error = %v", err)
			}
			data, readErr := io.ReadAll(part)
			if readErr != nil {
				t.Fatalf("io.ReadAll(part) error = %v", readErr)
			}
			if part.FileName() != "" {
				uploadedNames[part.FormName()] = part.FileName()
				uploadedBodies[part.FormName()] = string(data)
			} else {
				fields[part.FormName()] = string(data)
			}
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": []map[string]any{
				{"message_id": 742},
				{"message_id": 743},
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{
		{
			Text: "album upload",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindImage, Path: firstPath},
				{Kind: botMediaKindImage, Path: secondPath},
			},
		},
	})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if fields["chat_id"] != "1001" {
		t.Fatalf("expected multipart chat_id 1001, got %#v", fields)
	}
	var mediaPayload []map[string]any
	if err := json.Unmarshal([]byte(fields["media"]), &mediaPayload); err != nil {
		t.Fatalf("json.Unmarshal(media) error = %v", err)
	}
	if len(mediaPayload) != 2 {
		t.Fatalf("expected 2 media payload items, got %#v", mediaPayload)
	}
	if mediaPayload[0]["type"] != "photo" || mediaPayload[0]["media"] != "attach://file0" {
		t.Fatalf("unexpected first media payload %#v", mediaPayload[0])
	}
	if mediaPayload[0]["caption"] != "album upload" {
		t.Fatalf("expected caption on first media payload, got %#v", mediaPayload[0])
	}
	if mediaPayload[1]["type"] != "photo" || mediaPayload[1]["media"] != "attach://file1" {
		t.Fatalf("unexpected second media payload %#v", mediaPayload[1])
	}
	if uploadedNames["file0"] != "album-1.jpg" || uploadedBodies["file0"] != "album image 1" {
		t.Fatalf("unexpected first upload part name/body: name=%q body=%q", uploadedNames["file0"], uploadedBodies["file0"])
	}
	if uploadedNames["file1"] != "album-2.jpg" || uploadedBodies["file1"] != "album image 2" {
		t.Fatalf("unexpected second upload part name/body: name=%q body=%q", uploadedNames["file1"], uploadedBodies["file1"])
	}
}

func TestTelegramProviderSendMessagesUploadsDocumentFromAbsolutePath(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "report.txt")
	if err := os.WriteFile(filePath, []byte("telegram attachment body"), 0o600); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	fields := make(map[string]string)
	uploadedName := ""
	uploadedBody := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendDocument" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader() error = %v", err)
		}
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				t.Fatalf("NextPart() error = %v", err)
			}
			data, readErr := io.ReadAll(part)
			if readErr != nil {
				t.Fatalf("io.ReadAll(part) error = %v", readErr)
			}
			if part.FileName() != "" {
				uploadedName = part.FileName()
				uploadedBody = string(data)
			} else {
				fields[part.FormName()] = string(data)
			}
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": 731,
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{
		{
			Text: "report attached",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindFile, Path: filePath},
			},
		},
	})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if fields["chat_id"] != "1001" {
		t.Fatalf("expected multipart chat_id 1001, got %#v", fields)
	}
	if fields["caption"] != "report attached" {
		t.Fatalf("expected multipart caption report attached, got %#v", fields)
	}
	if uploadedName != "report.txt" {
		t.Fatalf("expected uploaded file name report.txt, got %q", uploadedName)
	}
	if uploadedBody != "telegram attachment body" {
		t.Fatalf("expected uploaded file body to match, got %q", uploadedBody)
	}
}

func TestTelegramProviderSendMessagesUploadsVideoFromAbsolutePath(t *testing.T) {
	t.Parallel()

	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "clip.mp4")
	if err := os.WriteFile(filePath, []byte("telegram video body"), 0o600); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	fields := make(map[string]string)
	uploadedName := ""
	uploadedBody := ""
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/bot123:abc/sendVideo" {
			t.Fatalf("unexpected telegram API path %s", r.URL.Path)
		}

		reader, err := r.MultipartReader()
		if err != nil {
			t.Fatalf("MultipartReader() error = %v", err)
		}
		for {
			part, err := reader.NextPart()
			if errors.Is(err, io.EOF) {
				break
			}
			if err != nil {
				t.Fatalf("NextPart() error = %v", err)
			}
			data, readErr := io.ReadAll(part)
			if readErr != nil {
				t.Fatalf("io.ReadAll(part) error = %v", readErr)
			}
			if part.FileName() != "" {
				uploadedName = part.FileName()
				uploadedBody = string(data)
			} else {
				fields[part.FormName()] = string(data)
			}
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok": true,
			"result": map[string]any{
				"message_id": 741,
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{
		{
			Text: "video attached",
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindVideo, Path: filePath},
			},
		},
	})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if fields["chat_id"] != "1001" {
		t.Fatalf("expected multipart chat_id 1001, got %#v", fields)
	}
	if fields["caption"] != "video attached" {
		t.Fatalf("expected multipart caption video attached, got %#v", fields)
	}
	if uploadedName != "clip.mp4" {
		t.Fatalf("expected uploaded video name clip.mp4, got %q", uploadedName)
	}
	if uploadedBody != "telegram video body" {
		t.Fatalf("expected uploaded video body to match, got %q", uploadedBody)
	}
}

func TestTelegramProviderSendMessagesRejectsRelativeMediaPath(t *testing.T) {
	t.Parallel()

	provider := newTelegramProvider(nil).(*telegramProvider)

	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{
		{
			Media: []store.BotMessageMedia{
				{Kind: botMediaKindImage, Path: "relative-image.png"},
			},
		},
	})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected ErrInvalidInput for telegram media send, got %v", err)
	}
	if err == nil || !strings.Contains(err.Error(), "must be absolute") {
		t.Fatalf("expected absolute-path validation error, got %v", err)
	}
}

func TestSplitTelegramTextPreservesWhitespaceExactly(t *testing.T) {
	t.Parallel()

	original := "  leading\n" + strings.Repeat("a", telegramTextLimitRunes+5) + "\ntrailing  "
	chunks := splitTelegramText(original, telegramTextLimitRunes)
	if len(chunks) != 2 {
		t.Fatalf("expected 2 chunks, got %#v", chunks)
	}
	if strings.Join(chunks, "") != original {
		t.Fatalf("expected split/join to preserve original text exactly")
	}
}

func TestTelegramProviderSendMessagesPreservesLongTextWhitespaceAcrossChunks(t *testing.T) {
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
				"message_id": 820 + len(sendPayloads),
			},
		})
	}))
	defer server.Close()

	provider := newTelegramProvider(server.Client()).(*telegramProvider)
	provider.apiBaseURL = server.URL

	original := "  leading\n" + strings.Repeat("a", telegramTextLimitRunes+5) + "\ntrailing  "
	err := provider.SendMessages(context.Background(), store.BotConnection{
		Secrets: map[string]string{"bot_token": "123:abc"},
	}, store.BotConversation{
		ExternalChatID: "1001",
	}, []OutboundMessage{{Text: original}})
	if err != nil {
		t.Fatalf("SendMessages() error = %v", err)
	}

	if len(sendPayloads) != 2 {
		t.Fatalf("expected 2 sendMessage payloads, got %#v", sendPayloads)
	}

	texts := make([]string, 0, len(sendPayloads))
	for _, payload := range sendPayloads {
		texts = append(texts, payload["text"].(string))
	}
	if strings.Join(texts, "") != original {
		t.Fatalf("expected sent chunks to preserve original text exactly")
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
		nil,
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
		nil,
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

func TestTelegramProviderRunPollingRetriesTransientGetUpdatesFailures(t *testing.T) {
	t.Parallel()

	getUpdatesCalls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/bot123:abc/getUpdates":
			getUpdatesCalls += 1
			_ = json.NewEncoder(w).Encode(map[string]any{
				"ok": true,
				"result": []map[string]any{
					{
						"update_id": 31,
						"message": map[string]any{
							"message_id": 7,
							"text":       "hello after transient failure",
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

	client := server.Client()
	transport := &scriptedTelegramRoundTripper{
		base: client.Transport,
		errs: []error{io.ErrUnexpectedEOF, io.ErrUnexpectedEOF},
	}
	client.Transport = transport

	provider := newTelegramProviderWithClientSource(fixedHTTPClientSource{client: client}).(*telegramProvider)
	provider.apiBaseURL = server.URL

	delays := make([]time.Duration, 0, 2)
	provider.sleep = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		return nil
	}

	connection := store.BotConnection{
		ID: "bot_retry_polling",
		Settings: map[string]string{
			telegramDeliveryModeSetting: telegramDeliveryModePolling,
		},
		Secrets: map[string]string{"bot_token": "123:abc"},
	}

	handled := make([]InboundMessage, 0, 1)
	err := provider.RunPolling(
		context.Background(),
		connection,
		func(_ context.Context, message InboundMessage) error {
			handled = append(handled, message)
			return nil
		},
		func(_ context.Context, settings map[string]string) error {
			if settings[telegramUpdateOffsetSetting] == "32" {
				return context.Canceled
			}
			return nil
		},
		nil,
	)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("expected polling to stop with context.Canceled, got %v", err)
	}
	if transport.calls != 3 {
		t.Fatalf("expected 3 transport attempts, got %d", transport.calls)
	}
	if getUpdatesCalls != 1 {
		t.Fatalf("expected 1 successful getUpdates request, got %d", getUpdatesCalls)
	}
	if len(handled) != 1 || handled[0].Text != "hello after transient failure" {
		t.Fatalf("unexpected handled polling messages %#v", handled)
	}
	expectedDelays := []time.Duration{telegramDeliveryRetryBase, telegramDeliveryRetryBase * 2}
	if strings.Join(formatDurations(delays), ",") != strings.Join(formatDurations(expectedDelays), ",") {
		t.Fatalf("expected retry delays %#v, got %#v", expectedDelays, delays)
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

type scriptedTelegramRoundTripper struct {
	base  http.RoundTripper
	errs  []error
	calls int
}

func (r *scriptedTelegramRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	r.calls += 1
	if len(r.errs) > 0 {
		err := r.errs[0]
		r.errs = r.errs[1:]
		return nil, err
	}
	if r.base == nil {
		r.base = http.DefaultTransport
	}
	return r.base.RoundTrip(req)
}

func formatDurations(items []time.Duration) []string {
	formatted := make([]string, 0, len(items))
	for _, item := range items {
		formatted = append(formatted, item.String())
	}
	return formatted
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

func TestTelegramProviderReplyDeliveryRetryDecisionRequiresRetryableMarker(t *testing.T) {
	t.Parallel()

	provider := newTelegramProvider(nil).(*telegramProvider)

	retry, delay := provider.ReplyDeliveryRetryDecision(errors.New("plain failure"), 1)
	if retry || delay != 0 {
		t.Fatalf("expected plain failures not to trigger service-level retry, got retry=%v delay=%v", retry, delay)
	}
}

func TestTelegramProviderReplyDeliveryRetryDecisionRetriesMarkedTransientFailure(t *testing.T) {
	t.Parallel()

	provider := newTelegramProvider(nil).(*telegramProvider)

	retry, delay := provider.ReplyDeliveryRetryDecision(
		markReplyDeliveryRetryable(&telegramRequestError{
			method:      "sendMessage",
			statusCode:  http.StatusTooManyRequests,
			status:      "api error",
			description: "Too Many Requests: retry after 2",
			retryAfter:  2 * time.Second,
		}),
		1,
	)
	if !retry {
		t.Fatal("expected marked transient telegram failure to trigger service-level retry")
	}
	if delay != 2*time.Second {
		t.Fatalf("expected retry delay 2s, got %v", delay)
	}

	retry, delay = provider.ReplyDeliveryRetryDecision(
		markReplyDeliveryRetryable(&telegramRequestError{
			method:      "sendMessage",
			statusCode:  http.StatusTooManyRequests,
			status:      "api error",
			description: "Too Many Requests: retry after 2",
			retryAfter:  2 * time.Second,
		}),
		2,
	)
	if retry || delay != 0 {
		t.Fatalf("expected second service-level failure to stop retrying, got retry=%v delay=%v", retry, delay)
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
