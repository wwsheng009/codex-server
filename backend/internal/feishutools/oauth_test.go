package feishutools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func TestBuildAuthorizeURLEmbedsScopesAndState(t *testing.T) {
	t.Parallel()

	client := NewOauthClient(nil).WithDomain("https://example.com")
	authorize, state, err := client.BuildAuthorizeURL(
		"ws-1",
		"cli_app_123",
		"https://host.example/api/feishu-tools/oauth/callback",
		[]string{"docx:document:readonly", "wiki:node:read", "docx:document:readonly"},
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.HasPrefix(state, "fto_") {
		t.Fatalf("unexpected state token %q", state)
	}

	parsed, err := url.Parse(authorize)
	if err != nil {
		t.Fatalf("invalid authorize url: %v", err)
	}
	if parsed.Path != oauthAuthorizePath {
		t.Fatalf("unexpected authorize path %q", parsed.Path)
	}
	values := parsed.Query()
	if values.Get("app_id") != "cli_app_123" {
		t.Fatalf("unexpected app_id %q", values.Get("app_id"))
	}
	if values.Get("response_type") != "code" {
		t.Fatalf("unexpected response_type %q", values.Get("response_type"))
	}
	if values.Get("state") != state {
		t.Fatalf("state mismatch: url=%q token=%q", values.Get("state"), state)
	}
	scope := values.Get("scope")
	if !strings.Contains(scope, "docx:document:readonly") || !strings.Contains(scope, "wiki:node:read") {
		t.Fatalf("scope missing entries: %q", scope)
	}
	if !strings.Contains(scope, oauthOfflineAccessScope) {
		t.Fatalf("scope missing offline_access: %q", scope)
	}
	if strings.Count(scope, "docx:document:readonly") != 1 {
		t.Fatalf("scope should deduplicate: %q", scope)
	}
	if strings.Count(scope, oauthOfflineAccessScope) != 1 {
		t.Fatalf("offline_access should be present exactly once: %q", scope)
	}
}

func TestBuildAuthorizeURLRejectsMissingInput(t *testing.T) {
	t.Parallel()

	client := NewOauthClient(nil)
	if _, _, err := client.BuildAuthorizeURL("", "app", "https://cb", nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
	if _, _, err := client.BuildAuthorizeURL("ws", "", "https://cb", nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
	if _, _, err := client.BuildAuthorizeURL("ws", "app", "", nil); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected invalid input, got %v", err)
	}
}

func TestConsumeStateValidatesAndExpires(t *testing.T) {
	t.Parallel()

	client := NewOauthClient(nil).WithDomain("https://example.com")
	_, state, err := client.BuildAuthorizeURL("ws-1", "app", "https://cb", nil)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	entry, err := client.ConsumeState(state)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.WorkspaceID != "ws-1" {
		t.Fatalf("unexpected workspace: %q", entry.WorkspaceID)
	}
	if _, err := client.ConsumeState(state); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected state to be single-use, got %v", err)
	}

	// Expired state should be rejected.
	_, state2, err := client.BuildAuthorizeURL("ws-1", "app", "https://cb", nil)
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}
	client.now = func() time.Time { return time.Now().Add(2 * pendingOauthTTL) }
	if _, err := client.ConsumeState(state2); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("expected expired state to fail, got %v", err)
	}
}

func TestExchangeCodeParsesSnapshot(t *testing.T) {
	t.Parallel()

	var receivedBody map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != oauthTokenPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		if err := json.NewDecoder(r.Body).Decode(&receivedBody); err != nil {
			t.Fatalf("decode body: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"code": 0,
			"access_token": "u-access",
			"refresh_token": "u-refresh",
			"token_type": "Bearer",
			"expires_in": 7200,
			"refresh_token_expires_in": 2592000,
			"scope": "docx:document:readonly wiki:node:read",
			"open_id": "ou_123",
			"union_id": "on_456"
		}`))
	}))
	defer server.Close()

	client := NewOauthClient(server.Client()).WithDomain(server.URL)
	fixedNow := time.Date(2026, 4, 17, 12, 0, 0, 0, time.UTC)
	client.now = func() time.Time { return fixedNow }

	snapshot, err := client.ExchangeCode(context.Background(), "app", "secret", "the-code", "https://cb")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if snapshot.AccessToken != "u-access" || snapshot.RefreshToken != "u-refresh" {
		t.Fatalf("unexpected tokens: %#v", snapshot)
	}
	if snapshot.OpenID != "ou_123" || snapshot.UnionID != "on_456" {
		t.Fatalf("unexpected identity: %#v", snapshot)
	}
	if len(snapshot.Scopes) != 2 {
		t.Fatalf("unexpected scopes: %#v", snapshot.Scopes)
	}
	if !snapshot.AccessTokenExpiresAt.Equal(fixedNow.Add(7200 * time.Second)) {
		t.Fatalf("unexpected access expiry: %v", snapshot.AccessTokenExpiresAt)
	}
	if !snapshot.RefreshTokenExpiresAt.Equal(fixedNow.Add(2592000 * time.Second)) {
		t.Fatalf("unexpected refresh expiry: %v", snapshot.RefreshTokenExpiresAt)
	}

	if receivedBody["grant_type"] != "authorization_code" {
		t.Fatalf("unexpected grant_type %q", receivedBody["grant_type"])
	}
	if receivedBody["code"] != "the-code" {
		t.Fatalf("unexpected code %q", receivedBody["code"])
	}
}

func TestExchangeCodeReportsErrors(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code": 20001, "error": "invalid_code", "error_description": "the authorization code is invalid"}`))
	}))
	defer server.Close()

	client := NewOauthClient(server.Client()).WithDomain(server.URL)
	_, err := client.ExchangeCode(context.Background(), "app", "secret", "code", "https://cb")
	if err == nil {
		t.Fatalf("expected error for non-2xx response")
	}
	if !strings.Contains(err.Error(), "the authorization code is invalid") {
		t.Fatalf("expected descriptive error, got %q", err.Error())
	}
}

func TestOauthTokenSnapshotValidity(t *testing.T) {
	t.Parallel()

	now := time.Now().UTC()
	snapshot := OauthTokenSnapshot{
		AccessToken:           "a",
		RefreshToken:          "r",
		AccessTokenExpiresAt:  now.Add(5 * time.Minute),
		RefreshTokenExpiresAt: now.Add(24 * time.Hour),
	}
	if !snapshot.IsAccessTokenValid(now) {
		t.Fatalf("expected access token valid within leeway")
	}
	if snapshot.IsAccessTokenValid(now.Add(4 * time.Minute)) {
		t.Fatalf("expected access token to be considered stale inside leeway")
	}
	if !snapshot.IsRefreshTokenValid(now) {
		t.Fatalf("expected refresh token valid")
	}
	if snapshot.IsRefreshTokenValid(now.Add(25 * time.Hour)) {
		t.Fatalf("expected refresh token expired")
	}
	if !snapshot.Connected() {
		t.Fatalf("expected snapshot to be connected")
	}
	if (OauthTokenSnapshot{}).Connected() {
		t.Fatalf("empty snapshot must not be connected")
	}
}

func TestServiceOauthLoginRequiresPublicBaseURL(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil, nil)
	// No PublicBaseURL set; config read will fail because configfs is nil,
	// but we specifically care that the service does not panic and surfaces
	// a helpful error regardless of which check trips first.
	_, err := service.OauthLogin(context.Background(), "ws-1", nil)
	if err == nil {
		t.Fatalf("expected an error when configuration is missing")
	}
}

func TestOauthLoginWithBaseURLAlwaysRequestsOfflineAccess(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	service := NewService(nil, nil, nil, dataStore)
	service.SetPublicBaseURL("http://localhost:18080")

	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID: workspace.ID,
		Enabled:     true,
		AppID:       "cli_app_123",
		AppSecret:   "secret",
		OauthMode:   OauthModeUserAuth,
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	login, err := service.OauthLoginWithBaseURL(context.Background(), workspace.ID, []string{"docx:document:readonly"}, "http://localhost:18080")
	if err != nil {
		t.Fatalf("OauthLoginWithBaseURL() error = %v", err)
	}
	parsed, err := url.Parse(login.AuthorizationURL)
	if err != nil {
		t.Fatalf("parse authorization url: %v", err)
	}
	scope := parsed.Query().Get("scope")
	if !strings.Contains(scope, "docx:document:readonly") {
		t.Fatalf("expected requested business scope, got %q", scope)
	}
	if !strings.Contains(scope, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access in scope, got %q", scope)
	}
}

func TestRunOauthBatchAuthFiltersSensitiveScopes(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	service := NewService(nil, nil, nil, dataStore)
	service.SetPublicBaseURL("http://localhost:18080")

	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID:         workspace.ID,
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecret:           "secret",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_calendar_event"},
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	result, err := service.runOauthBatchAuth(context.Background(), workspace.ID, Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecret:           "secret",
		AppSecretSet:        true,
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_calendar_event"},
	}, nil)
	if err != nil {
		t.Fatalf("runOauthBatchAuth() error = %v", err)
	}

	requestedScopes, _ := result["requestedScopes"].([]string)
	if len(requestedScopes) == 0 {
		t.Fatalf("expected requested scopes, got %#v", result)
	}
	for _, scope := range requestedScopes {
		if scope == "calendar:calendar.event:delete" {
			t.Fatalf("expected sensitive delete scope to be filtered, got %#v", requestedScopes)
		}
	}
	foundOfflineAccess := false
	for _, scope := range requestedScopes {
		if scope == oauthOfflineAccessScope {
			foundOfflineAccess = true
			break
		}
	}
	if !foundOfflineAccess {
		t.Fatalf("expected offline_access to be requested, got %#v", requestedScopes)
	}

	rawURL, _ := result["authorizationUrl"].(string)
	parsed, err := url.Parse(rawURL)
	if err != nil {
		t.Fatalf("parse authorization url: %v", err)
	}
	scopeText := parsed.Query().Get("scope")
	if strings.Contains(scopeText, "calendar:calendar.event:delete") {
		t.Fatalf("expected authorization url to exclude sensitive scope, got %q", scopeText)
	}
	if !strings.Contains(scopeText, oauthOfflineAccessScope) {
		t.Fatalf("expected authorization url to include offline_access, got %q", scopeText)
	}
}

func TestAuthStateReflectsSnapshot(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil, nil)
	service.SetFrontendOrigin("https://host.example")

	now := time.Now().UTC()
	config := Config{
		Enabled:      true,
		AppID:        "app",
		AppSecretSet: true,
		OauthMode:    OauthModeUserAuth,
		UserToken: OauthTokenSnapshot{
			AccessToken:           "access",
			RefreshToken:          "refresh",
			AccessTokenExpiresAt:  now.Add(1 * time.Hour),
			RefreshTokenExpiresAt: now.Add(30 * 24 * time.Hour),
			Scopes:                []string{"docx:document:readonly"},
			OpenID:                "ou_xyz",
			ObtainedAt:            now,
		},
	}
	state := service.authStateFor(config, "")
	if state.Status != "connected" {
		t.Fatalf("expected connected, got %q", state.Status)
	}
	if !state.HasAccessToken || !state.HasRefreshToken {
		t.Fatalf("expected token presence flags, got %#v", state)
	}
	if state.AccessTokenPreview == "" || state.RefreshTokenPreview == "" {
		t.Fatalf("expected token previews, got %#v", state)
	}
	if state.OpenID != "ou_xyz" || state.AccountID != "ou_xyz" {
		t.Fatalf("unexpected identity fields: %#v", state)
	}
	if !strings.HasSuffix(state.CallbackURL, callbackPathTemplate) {
		t.Fatalf("unexpected callback url: %q", state.CallbackURL)
	}

	config.UserToken.RefreshToken = ""
	config.UserToken.RefreshTokenExpiresAt = time.Time{}
	state = service.authStateFor(config, "")
	if state.Status != "connected_no_refresh" {
		t.Fatalf("expected connected_no_refresh, got %q", state.Status)
	}
	if !state.HasAccessToken || state.HasRefreshToken {
		t.Fatalf("expected access token only, got %#v", state)
	}

	// Expired access token, valid refresh.
	config.UserToken.RefreshToken = "refresh"
	config.UserToken.RefreshTokenExpiresAt = now.Add(30 * 24 * time.Hour)
	config.UserToken.AccessTokenExpiresAt = now.Add(-1 * time.Minute)
	state = service.authStateFor(config, "")
	if state.Status != "refresh_required" {
		t.Fatalf("expected refresh_required, got %q", state.Status)
	}

	// Fully expired.
	config.UserToken.RefreshTokenExpiresAt = now.Add(-1 * time.Minute)
	state = service.authStateFor(config, "")
	if state.Status != "expired" {
		t.Fatalf("expected expired, got %q", state.Status)
	}
}

func TestAuthStateUsesDerivedBaseURLWhenPublicBaseURLMissing(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil, nil)
	service.SetFrontendOrigin("http://localhost:15173")
	config := Config{
		Enabled:      true,
		AppID:        "app",
		AppSecretSet: true,
		OauthMode:    OauthModeUserAuth,
	}

	state := service.authStateFor(config, "http://localhost:18080")
	if state.CallbackURL != "http://localhost:15173"+callbackPathTemplate {
		t.Fatalf("unexpected callback url %q", state.CallbackURL)
	}
}

func TestOauthStatusWithBaseURLReturnsDerivedCallbackURL(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	service := NewService(nil, nil, nil, dataStore)
	service.SetFrontendOrigin("http://localhost:15173")
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	_, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID: workspace.ID,
		Enabled:     true,
		AppID:       "cli_app_123",
		AppSecret:   "secret",
		OauthMode:   OauthModeUserAuth,
	})
	if err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	state, err := service.OauthStatusWithBaseURL(context.Background(), workspace.ID, "http://localhost:18080")
	if err != nil {
		t.Fatalf("OauthStatusWithBaseURL() error = %v", err)
	}
	if state.CallbackURL != "http://localhost:15173"+callbackPathTemplate {
		t.Fatalf("unexpected callback url %q", state.CallbackURL)
	}
}

func TestCallbackURLPrefersFrontendOriginOverPublicBaseURL(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil, nil)
	service.SetFrontendOrigin("http://localhost:15173")
	service.SetPublicBaseURL("http://localhost:18080")

	callbackURL, err := service.callbackURL("http://localhost:18080")
	if err != nil {
		t.Fatalf("callbackURL() error = %v", err)
	}
	if callbackURL != "http://localhost:15173"+callbackPathTemplate {
		t.Fatalf("unexpected callback url %q", callbackURL)
	}
}

func TestOauthCallbackReportsConnectedNoRefreshWhenRefreshTokenMissing(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != oauthTokenPath {
			t.Errorf("unexpected path %q", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"code": 0,
			"access_token": "u-access",
			"token_type": "Bearer",
			"expires_in": 7200,
			"scope": "docx:document:readonly",
			"open_id": "ou_123"
		}`))
	}))
	defer server.Close()

	dataStore := store.NewMemoryStore()
	service := NewService(nil, nil, nil, dataStore)
	service.SetPublicBaseURL("http://localhost:18080")
	service.SetFrontendOrigin("http://localhost:15173")
	service.SetOauthClient(NewOauthClient(server.Client()).WithDomain(server.URL))

	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID: workspace.ID,
		Enabled:     true,
		AppID:       "cli_app_123",
		AppSecret:   "secret",
		OauthMode:   OauthModeUserAuth,
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	login, err := service.OauthLoginWithBaseURL(context.Background(), workspace.ID, []string{"docx:document:readonly"}, "http://localhost:18080")
	if err != nil {
		t.Fatalf("OauthLoginWithBaseURL() error = %v", err)
	}
	parsed, err := url.Parse(login.AuthorizationURL)
	if err != nil {
		t.Fatalf("parse authorization url: %v", err)
	}
	stateParam := parsed.Query().Get("state")
	if stateParam == "" {
		t.Fatalf("expected oauth state in authorization url")
	}

	result, err := service.OauthCallbackWithBaseURL(context.Background(), stateParam, "code-123", "http://localhost:18080")
	if err != nil {
		t.Fatalf("OauthCallbackWithBaseURL() error = %v", err)
	}
	if result.Status != "connected_no_refresh" {
		t.Fatalf("expected connected_no_refresh, got %q", result.Status)
	}

	stored, ok := dataStore.GetFeishuToolsConfig(workspace.ID)
	if !ok {
		t.Fatalf("expected stored feishu config")
	}
	if stored.UserToken.AccessToken != "u-access" {
		t.Fatalf("expected access token to be persisted, got %#v", stored.UserToken)
	}
	if stored.UserToken.RefreshToken != "" {
		t.Fatalf("expected refresh token to remain empty, got %#v", stored.UserToken)
	}
}

func TestParseConfigLoadsUserTokenSnapshot(t *testing.T) {
	t.Parallel()

	config := parseConfig(map[string]any{
		"feishu_tools_enabled":                 true,
		"feishu_app_id":                        "cli_app_123",
		"feishu_app_secret":                    "secret",
		"feishu_user_access_token":             "a",
		"feishu_user_refresh_token":            "r",
		"feishu_user_access_token_expires_at":  "2026-04-17T12:00:00Z",
		"feishu_user_refresh_token_expires_at": "2026-05-17T12:00:00Z",
		"feishu_user_scopes":                   []any{"docx:document:readonly"},
		"feishu_user_open_id":                  "ou_1",
		"feishu_user_union_id":                 "on_1",
		"feishu_user_token_obtained_at":        "2026-04-17T10:00:00Z",
	})

	if config.UserToken.AccessToken != "a" || config.UserToken.RefreshToken != "r" {
		t.Fatalf("unexpected tokens: %#v", config.UserToken)
	}
	if config.UserToken.OpenID != "ou_1" || config.UserToken.UnionID != "on_1" {
		t.Fatalf("unexpected identity: %#v", config.UserToken)
	}
	if len(config.UserToken.Scopes) != 1 || config.UserToken.Scopes[0] != "docx:document:readonly" {
		t.Fatalf("unexpected scopes: %#v", config.UserToken.Scopes)
	}
	if config.UserToken.AccessTokenExpiresAt.IsZero() || config.UserToken.RefreshTokenExpiresAt.IsZero() {
		t.Fatalf("expected expiry fields to be populated: %#v", config.UserToken)
	}
	if config.AppSecret != "secret" {
		t.Fatalf("expected app secret to be populated for downstream exchange flow")
	}
}
