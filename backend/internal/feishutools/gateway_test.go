package feishutools

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestGatewayTenantTokenCachesSuccess(t *testing.T) {
	t.Parallel()

	var hits int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != openAPITenantTokenPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		atomic.AddInt32(&hits, 1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"msg":"ok","tenant_access_token":"t-123","expire":3600}`))
	}))
	defer server.Close()

	gateway := newGateway(nil, server.Client()).WithDomain(server.URL)
	config := Config{AppID: "app", AppSecret: "secret"}

	token, err := gateway.TenantToken(context.Background(), "ws", config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if token != "t-123" {
		t.Fatalf("unexpected token: %q", token)
	}
	// Second call should be served from cache.
	if _, err := gateway.TenantToken(context.Background(), "ws", config); err != nil {
		t.Fatalf("unexpected error on second call: %v", err)
	}
	if atomic.LoadInt32(&hits) != 1 {
		t.Fatalf("expected cache hit on second call, got %d server hits", atomic.LoadInt32(&hits))
	}
}

func TestGatewayTenantTokenSurfacesUpstreamError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":99991663,"msg":"invalid app secret"}`))
	}))
	defer server.Close()

	gateway := newGateway(nil, server.Client()).WithDomain(server.URL)
	_, err := gateway.TenantToken(context.Background(), "ws", Config{AppID: "app", AppSecret: "secret"})
	if err == nil {
		t.Fatalf("expected an error for non-zero feishu code")
	}
	gerr, ok := err.(*gatewayError)
	if !ok {
		t.Fatalf("expected *gatewayError, got %T", err)
	}
	if gerr.Code != "tenant_token_failed" {
		t.Fatalf("unexpected error code %q", gerr.Code)
	}
}

func TestGatewayTenantTokenRejectsMissingCredentials(t *testing.T) {
	t.Parallel()

	gateway := newGateway(nil, nil)
	_, err := gateway.TenantToken(context.Background(), "ws", Config{})
	if err == nil {
		t.Fatalf("expected missing credential error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "missing_credentials" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGatewayUserTokenReturnsAccessWhenValid(t *testing.T) {
	t.Parallel()

	gateway := newGateway(nil, nil)
	now := time.Now().UTC()
	config := Config{
		UserToken: OauthTokenSnapshot{
			AccessToken:          "still-valid",
			RefreshToken:         "r",
			AccessTokenExpiresAt: now.Add(1 * time.Hour),
		},
	}
	snapshot, err := gateway.UserToken(context.Background(), "ws", config)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snapshot.AccessToken != "still-valid" {
		t.Fatalf("unexpected token")
	}
}

func TestGatewayUserTokenSignalsOauthRequired(t *testing.T) {
	t.Parallel()

	gateway := newGateway(nil, nil)
	_, err := gateway.UserToken(context.Background(), "ws", Config{})
	if err == nil {
		t.Fatalf("expected error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok || gerr.Code != "user_oauth_required" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestGatewayDoJSONDecodesEnvelope(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("unexpected auth header %q", got)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"code":0,"msg":"ok","data":{"value":42}}`))
	}))
	defer server.Close()

	gateway := newGateway(nil, server.Client()).WithDomain(server.URL)
	var out struct {
		Value int `json:"value"`
	}
	if err := gateway.doJSON(context.Background(), "GET", "/probe", nil, "tok", nil, &out); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if out.Value != 42 {
		t.Fatalf("unexpected value: %d", out.Value)
	}
}

func TestGatewayDoJSONNormalizesFeishuError(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"code":230001,"msg":"document not found"}`))
	}))
	defer server.Close()

	gateway := newGateway(nil, server.Client()).WithDomain(server.URL)
	err := gateway.doJSON(context.Background(), "GET", "/probe", nil, "tok", nil, nil)
	if err == nil {
		t.Fatalf("expected error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok {
		t.Fatalf("expected *gatewayError, got %T", err)
	}
	if gerr.Code != "docs_error" {
		t.Fatalf("unexpected code: %q", gerr.Code)
	}
	if !strings.Contains(gerr.Message, "document not found") {
		t.Fatalf("unexpected message: %q", gerr.Message)
	}
}

func TestGatewayDoJSONWrapsHTTPErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))
	defer server.Close()

	gateway := newGateway(nil, server.Client()).WithDomain(server.URL)
	err := gateway.doJSON(context.Background(), "GET", "/probe", nil, "tok", nil, nil)
	if err == nil {
		t.Fatalf("expected error")
	}
	gerr, ok := err.(*gatewayError)
	if !ok {
		t.Fatalf("expected *gatewayError, got %T", err)
	}
	if gerr.Code != "upstream_error" {
		t.Fatalf("unexpected code: %q", gerr.Code)
	}
}
