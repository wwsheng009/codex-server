package feishutools

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunIMSearchMessagesFiltersByQueryContains(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != imMessagesListPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if r.URL.Query().Get("container_id") != "chat_1" {
			t.Errorf("missing container_id query param: %q", r.URL.RawQuery)
		}
		if r.URL.Query().Get("page_size") != "10" {
			t.Errorf("unexpected page_size: %q", r.URL.Query().Get("page_size"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"code": 0,
			"data": {
				"has_more": false,
				"page_token": "",
				"items": [
					{"message_id": "m1", "body": {"content": "Hello world"}},
					{"message_id": "m2", "body": {"content": "No match"}},
					{"message_id": "m3", "body": {"content": "HELLO there"}}
				]
			}
		}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMSearchMessages(context.Background(), "ws", validUserConfig(), map[string]any{
		"containerId":    "chat_1",
		"pageSize":       10,
		"queryContains":  "hello",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	items, ok := result["items"].([]map[string]any)
	if !ok {
		t.Fatalf("unexpected items type: %#v", result["items"])
	}
	if len(items) != 2 {
		t.Fatalf("expected 2 filtered items, got %d", len(items))
	}
	if principal, _ := result["principal"].(string); principal != "user" {
		t.Fatalf("expected user principal, got %q", principal)
	}
}

func TestRunIMSearchMessagesRejectsMissingContainer(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runIMSearchMessages(context.Background(), "ws", validUserConfig(), map[string]any{})
	if err == nil {
		t.Fatalf("expected error for missing containerId")
	}
	if !strings.Contains(err.Error(), "containerId") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunIMGetMessageReturnsFirstItem(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/messages/m-1") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"code": 0,
			"data": {"items": [{"message_id": "m-1", "msg_type": "text"}]}
		}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMGetMessage(context.Background(), "ws", validUserConfig(), map[string]any{
		"messageId": "m-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	message, ok := result["message"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected message type: %#v", result["message"])
	}
	if message["msg_type"] != "text" {
		t.Fatalf("unexpected message payload: %#v", message)
	}
}

func TestRunIMGetThreadMessagesForwardsPagination(t *testing.T) {
	t.Parallel()

	var observed string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/messages/m-root/reply") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		observed = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"message_id":"m-1"}],"has_more":true,"page_token":"next"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMGetThreadMessages(context.Background(), "ws", validUserConfig(), map[string]any{
		"messageId": "m-root",
		"pageSize":  5,
		"pageToken": "prev",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(observed, "page_size=5") || !strings.Contains(observed, "page_token=prev") {
		t.Fatalf("expected pagination forwarded, got %q", observed)
	}
	if hasMore, _ := result["hasMore"].(bool); !hasMore {
		t.Fatalf("expected hasMore=true in result: %#v", result)
	}
}

func TestRunIMFetchResourceReturnsBase64Body(t *testing.T) {
	t.Parallel()

	payload := []byte("fake-binary-bytes")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/messages/m-1/resources/file-key") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if r.URL.Query().Get("type") != "file" {
			t.Errorf("expected type=file, got %q", r.URL.Query().Get("type"))
		}
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMFetchResource(context.Background(), "ws", validUserConfig(), map[string]any{
		"messageId": "m-1",
		"fileKey":   "file-key",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got, _ := result["contentType"].(string); got != "application/octet-stream" {
		t.Fatalf("unexpected contentType: %q", got)
	}
	if got, _ := result["bodyBase64"].(string); got != base64.StdEncoding.EncodeToString(payload) {
		t.Fatalf("unexpected bodyBase64: %q", got)
	}
	if truncated, _ := result["truncated"].(bool); truncated {
		t.Fatalf("expected truncated=false")
	}
}

func TestRunIMFetchResourceSurfacesJSONErrorEnvelope(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":195005,"msg":"resource expired"}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	_, err := service.runIMFetchResource(context.Background(), "ws", validUserConfig(), map[string]any{
		"messageId": "m-1",
		"fileKey":   "fk",
		"type":      "image",
	})
	if err == nil {
		t.Fatalf("expected error envelope to surface")
	}
	gerr, ok := err.(*gatewayError)
	if !ok {
		t.Fatalf("expected *gatewayError, got %T", err)
	}
	if gerr.Code != "im_error" {
		t.Fatalf("expected im_error classification, got %q", gerr.Code)
	}
}

func TestRunIMFetchResourceTruncatesLargePayload(t *testing.T) {
	t.Parallel()

	// 1 KiB payload, cap at 512 B.
	payload := strings.Repeat("A", 1024)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/octet-stream")
		_, _ = w.Write([]byte(payload))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMFetchResource(context.Background(), "ws", validUserConfig(), map[string]any{
		"messageId": "m-1",
		"fileKey":   "fk",
		"maxBytes":  512,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if size, _ := result["sizeBytes"].(int); size != 512 {
		t.Fatalf("expected sizeBytes=512, got %v", result["sizeBytes"])
	}
	if truncated, _ := result["truncated"].(bool); !truncated {
		t.Fatalf("expected truncated=true")
	}
}

func TestRunIMFetchResourceRejectsInvalidType(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runIMFetchResource(context.Background(), "ws", validUserConfig(), map[string]any{
		"messageId": "m-1",
		"fileKey":   "fk",
		"type":      "video",
	})
	if err == nil {
		t.Fatalf("expected error for unsupported type")
	}
	if !strings.Contains(err.Error(), "unsupported resource type") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunIMUserMessageSendUsesUserToken(t *testing.T) {
	t.Parallel()

	var authHeader string
	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if r.URL.Path != imMessagesListPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if got := r.URL.Query().Get("receive_id_type"); got != "chat_id" {
			t.Errorf("expected receive_id_type=chat_id, got %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"message_id":"om_1","chat_id":"oc_1","create_time":"123"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMUserMessage(context.Background(), "ws", validUserConfig(), "send", map[string]any{
		"receiveIdType": "chat_id",
		"receiveId":     "oc_1",
		"msgType":       "text",
		"content":       `{"text":"hello"}`,
		"uuid":          "u-1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer u-access" {
		t.Fatalf("expected user token auth header, got %q", authHeader)
	}
	if received["receive_id"] != "oc_1" || received["msg_type"] != "text" || received["uuid"] != "u-1" {
		t.Fatalf("unexpected send body: %#v", received)
	}
	if result["principal"] != "user" || result["message_id"] != "om_1" {
		t.Fatalf("unexpected send result: %#v", result)
	}
}

func TestRunIMUserMessageReplyUsesThreadEndpoint(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/messages/om_root/reply") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"message_id":"om_reply","chat_id":"oc_1"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runIMUserMessage(context.Background(), "ws", validUserConfig(), "reply", map[string]any{
		"messageId":     "om_root",
		"msgType":       "text",
		"content":       `{"text":"reply"}`,
		"replyInThread": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if received["reply_in_thread"] != true || received["msg_type"] != "text" {
		t.Fatalf("unexpected reply body: %#v", received)
	}
	if result["principal"] != "user" || result["repliedToMessageId"] != "om_root" {
		t.Fatalf("unexpected reply result: %#v", result)
	}
}

func TestRunIMUserMessageSendRequiresReceiveID(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runIMUserMessage(context.Background(), "ws", validUserConfig(), "send", map[string]any{
		"receiveIdType": "open_id",
		"msgType":       "text",
		"content":       `{"text":"hello"}`,
	})
	if err == nil {
		t.Fatalf("expected missing receiveId error")
	}
}
