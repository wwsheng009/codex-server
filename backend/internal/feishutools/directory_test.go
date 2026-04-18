package feishutools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRunSearchUserRequiresUserToken(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}
	_, err := service.runSearchUser(context.Background(), "ws", config, map[string]any{"query": "alice"})
	if err == nil {
		t.Fatalf("expected user_oauth_required error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "user_oauth_required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunSearchUserForwardsPagination(t *testing.T) {
	t.Parallel()

	var observedQuery string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != searchUserPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		observedQuery = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"has_more":true,"page_token":"next","users":[{"user_id":"u1"}]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runSearchUser(context.Background(), "ws", validUserConfig(), map[string]any{
		"query":     "alice",
		"pageSize":  5,
		"pageToken": "prev",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(observedQuery, "query=alice") ||
		!strings.Contains(observedQuery, "page_size=5") ||
		!strings.Contains(observedQuery, "page_token=prev") {
		t.Fatalf("unexpected upstream query: %q", observedQuery)
	}
	if hasMore, _ := result["hasMore"].(bool); !hasMore {
		t.Fatalf("expected hasMore=true, got %#v", result["hasMore"])
	}
}

func TestRunGetUserDefaultRoutesToIDPath(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/users/ou_1") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if r.URL.Query().Get("user_id_type") != "union_id" {
			t.Errorf("expected user_id_type=union_id, got %q", r.URL.Query().Get("user_id_type"))
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"user":{"user_id":"ou_1","name":"Alice"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runGetUser(context.Background(), "ws", validUserConfig(), "default", map[string]any{
		"userId":     "ou_1",
		"userIdType": "union_id",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	user, ok := result["user"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected user type: %#v", result["user"])
	}
	if user["name"] != "Alice" {
		t.Fatalf("unexpected user payload: %#v", user)
	}
}

func TestRunGetUserDefaultSelfRequiresUserToken(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}

	_, err := service.runGetUser(context.Background(), "ws", config, "default", map[string]any{
		"userId": "self",
	})
	if err == nil {
		t.Fatalf("expected user_oauth_required error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "user_oauth_required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunGetUserDefaultMeUsesUserToken(t *testing.T) {
	t.Parallel()

	var authHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		if !strings.HasSuffix(r.URL.Path, "/users/me") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"user":{"user_id":"ou_self","name":"Me"}}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runGetUser(context.Background(), "ws", validUserConfig(), "default", map[string]any{
		"userId": "me",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if authHeader != "Bearer u-access" {
		t.Fatalf("expected user token auth header, got %q", authHeader)
	}
	if principal, _ := result["principal"].(string); principal != "user" {
		t.Fatalf("expected user principal, got %#v", result)
	}
}

func TestRunGetUserBasicBatchSendsPayload(t *testing.T) {
	t.Parallel()

	var received map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != contactBatchGetIDPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&received); err != nil {
			t.Errorf("decode: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"user_list":[{"email":"a@x.com","user_id":"ou_1"}]}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runGetUser(context.Background(), "ws", validUserConfig(), "basic_batch", map[string]any{
		"emails":          []any{"a@x.com"},
		"includeResigned": true,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	emails, _ := received["emails"].([]any)
	if len(emails) != 1 || emails[0] != "a@x.com" {
		t.Fatalf("unexpected emails payload: %#v", received)
	}
	if received["include_resigned"] != true {
		t.Fatalf("expected include_resigned=true in payload: %#v", received)
	}
	users, ok := result["users"].([]map[string]any)
	if !ok || len(users) != 1 {
		t.Fatalf("unexpected users: %#v", result["users"])
	}
}

func TestRunGetUserRejectsUnknownAction(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runGetUser(context.Background(), "ws", validUserConfig(), "delete", map[string]any{
		"userId": "ou_1",
	})
	if err == nil {
		t.Fatalf("expected error for unsupported action")
	}
	if !strings.Contains(err.Error(), "unsupported action") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunChatSearchRequiresUserToken(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	config := validUserConfig()
	config.UserToken = OauthTokenSnapshot{}
	_, err := service.runChat(context.Background(), "ws", config, "search", map[string]any{"query": "meeting"})
	if err == nil {
		t.Fatalf("expected error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "user_oauth_required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRunChatGetUsesUserOrTenantFallback(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chats/oc_1") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"chat_id":"oc_1","name":"Team"}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runChat(context.Background(), "ws", validUserConfig(), "get", map[string]any{
		"chatId": "oc_1",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	chat, ok := result["chat"].(map[string]any)
	if !ok {
		t.Fatalf("unexpected chat type: %#v", result["chat"])
	}
	if chat["name"] != "Team" {
		t.Fatalf("unexpected chat payload: %#v", chat)
	}
}

func TestRunChatRejectsUnknownAction(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runChat(context.Background(), "ws", validUserConfig(), "delete", map[string]any{})
	if err == nil {
		t.Fatalf("expected error for unsupported chat action")
	}
}

func TestRunChatMembersForwardsPagination(t *testing.T) {
	t.Parallel()

	var observed string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/chats/oc_1/members") {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		observed = r.URL.RawQuery
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"data":{"items":[{"member_id":"ou_1"}],"has_more":false,"member_total":1,"page_token":""}}`))
	}))
	defer server.Close()

	service := newTestService(t, server.URL)
	result, err := service.runChatMembers(context.Background(), "ws", validUserConfig(), map[string]any{
		"chatId":       "oc_1",
		"memberIdType": "open_id",
		"pageSize":     10,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(observed, "member_id_type=open_id") ||
		!strings.Contains(observed, "page_size=10") {
		t.Fatalf("expected member_id_type/page_size forwarded, got %q", observed)
	}
	if total, ok := result["memberTotal"].(int); !ok || total != 1 {
		t.Fatalf("unexpected memberTotal: %#v", result["memberTotal"])
	}
}

func TestRunChatMembersRequiresChatID(t *testing.T) {
	t.Parallel()

	service := newTestService(t, "http://ignored")
	_, err := service.runChatMembers(context.Background(), "ws", validUserConfig(), map[string]any{})
	if err == nil {
		t.Fatalf("expected error for missing chatId")
	}
}
