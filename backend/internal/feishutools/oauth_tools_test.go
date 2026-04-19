package feishutools

import (
	"context"
	"net/url"
	"strconv"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/store"
)

func newOauthToolTestService(t *testing.T, config store.FeishuToolsConfig) (*Service, *store.MemoryStore, store.Workspace) {
	t.Helper()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", "E:/projects/a")
	config.WorkspaceID = workspace.ID
	if _, err := dataStore.SetFeishuToolsConfig(config); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	service := NewService(nil, nil, nil, dataStore)
	service.SetPublicBaseURL("http://localhost:18080")
	service.SetFrontendOrigin("http://localhost:15173")
	return service, dataStore, workspace
}

func oauthToolTestConfig() store.FeishuToolsConfig {
	now := time.Now().UTC()
	accessExpires := now.Add(1 * time.Hour)
	refreshExpires := now.Add(24 * time.Hour)
	obtainedAt := now.Add(-5 * time.Minute)
	return store.FeishuToolsConfig{
		Enabled:       true,
		AppID:         "cli_app_123",
		AppSecret:     "secret",
		OauthMode:     OauthModeUserAuth,
		ToolAllowlist: []string{"feishu_oauth", "feishu_oauth_batch_auth", "feishu_im_bot_image"},
		UserToken: store.FeishuUserToken{
			AccessToken:           "u-access",
			RefreshToken:          "u-refresh",
			AccessTokenExpiresAt:  &accessExpires,
			RefreshTokenExpiresAt: &refreshExpires,
			Scopes:                []string{"docx:document:readonly", oauthOfflineAccessScope},
			OpenID:                "ou_123",
			UnionID:               "on_456",
			ObtainedAt:            &obtainedAt,
		},
	}
}

func findCapabilityCategory(categories []CapabilityCategory, id string) *CapabilityCategory {
	for index := range categories {
		if categories[index].ID == id {
			return &categories[index]
		}
	}
	return nil
}

func findCapabilityItem(items []CapabilityItem, toolName string) *CapabilityItem {
	for index := range items {
		if items[index].ToolName == toolName {
			return &items[index]
		}
	}
	return nil
}

func TestBuildCapabilityCategoriesIncludeOauthAndBotImageTools(t *testing.T) {
	config := Config{
		Enabled:       true,
		OauthMode:     OauthModeUserAuth,
		ToolAllowlist: []string{"feishu_oauth", "feishu_oauth_batch_auth", "feishu_im_bot_image"},
	}

	categories := buildCapabilityCategories(config)

	authCategory := findCapabilityCategory(categories, "auth")
	if authCategory == nil {
		t.Fatal("expected auth capability category")
	}
	if authCategory.EnabledCount != 2 {
		t.Fatalf("expected auth enabled count 2, got %d", authCategory.EnabledCount)
	}
	if findCapabilityItem(authCategory.Items, "feishu_oauth") == nil {
		t.Fatalf("expected feishu_oauth in auth category: %#v", authCategory.Items)
	}
	if findCapabilityItem(authCategory.Items, "feishu_oauth_batch_auth") == nil {
		t.Fatalf("expected feishu_oauth_batch_auth in auth category: %#v", authCategory.Items)
	}

	messengerCategory := findCapabilityCategory(categories, "messenger")
	if messengerCategory == nil {
		t.Fatal("expected messenger capability category")
	}
	botImage := findCapabilityItem(messengerCategory.Items, "feishu_im_bot_image")
	if botImage == nil {
		t.Fatalf("expected feishu_im_bot_image in messenger category: %#v", messengerCategory.Items)
	}
	if !botImage.Enabled {
		t.Fatalf("expected feishu_im_bot_image to be enabled: %#v", botImage)
	}
	if len(botImage.RequiredScopes) != 1 || botImage.RequiredScopes[0] != "im:resource" {
		t.Fatalf("unexpected bot image scopes: %#v", botImage.RequiredScopes)
	}
}

func TestRunOauthToolSupportsStatusLoginAndRevoke(t *testing.T) {
	service, dataStore, workspace := newOauthToolTestService(t, oauthToolTestConfig())

	statusResult, err := service.runOauthTool(context.Background(), workspace.ID, Config{}, "status", nil)
	if err != nil {
		t.Fatalf("runOauthTool(status) error = %v", err)
	}
	if statusResult["status"] != "connected" {
		t.Fatalf("expected connected status, got %#v", statusResult)
	}
	if statusResult["principal"] != "user" {
		t.Fatalf("expected user principal from status, got %#v", statusResult)
	}

	loginResult, err := service.runOauthTool(context.Background(), workspace.ID, Config{}, "login", map[string]any{
		"scopes": []any{"wiki:node:read", "wiki:node:read"},
	})
	if err != nil {
		t.Fatalf("runOauthTool(login) error = %v", err)
	}
	if loginResult["principal"] != "user" {
		t.Fatalf("expected user principal from login, got %#v", loginResult)
	}
	requestedScopes, ok := loginResult["requestedScopes"].([]string)
	if !ok {
		t.Fatalf("unexpected requestedScopes type: %#v", loginResult["requestedScopes"])
	}
	if !hasScope(requestedScopes, "wiki:node:read") || !hasScope(requestedScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected requested scopes to include wiki:node:read and offline_access, got %#v", requestedScopes)
	}
	authorizationURL, _ := loginResult["authorizationUrl"].(string)
	parsed, err := url.Parse(authorizationURL)
	if err != nil {
		t.Fatalf("parse authorization url: %v", err)
	}
	scopeParam := parsed.Query().Get("scope")
	if !strings.Contains(scopeParam, "wiki:node:read") || !strings.Contains(scopeParam, oauthOfflineAccessScope) {
		t.Fatalf("unexpected scope query %q", scopeParam)
	}

	revokeResult, err := service.runOauthTool(context.Background(), workspace.ID, Config{}, "revoke", nil)
	if err != nil {
		t.Fatalf("runOauthTool(revoke) error = %v", err)
	}
	if revokeResult["revoked"] != true {
		t.Fatalf("expected revoked=true, got %#v", revokeResult)
	}
	if revokeResult["status"] != "not_connected" {
		t.Fatalf("expected not_connected after revoke, got %#v", revokeResult)
	}

	stored, ok := dataStore.GetFeishuToolsConfig(workspace.ID)
	if !ok {
		t.Fatal("expected stored Feishu config")
	}
	if stored.UserToken.AccessToken != "" || stored.UserToken.RefreshToken != "" {
		t.Fatalf("expected revoke to clear token snapshot, got %#v", stored.UserToken)
	}
}

func TestRunOauthBatchAuthSkipsSensitiveScopes(t *testing.T) {
	config := oauthToolTestConfig()
	config.ToolAllowlist = []string{"feishu_calendar_event"}
	config.UserToken = store.FeishuUserToken{}

	service, _, workspace := newOauthToolTestService(t, config)
	result, err := service.runOauthBatchAuth(context.Background(), workspace.ID, configFromStore(config), nil)
	if err != nil {
		t.Fatalf("runOauthBatchAuth() error = %v", err)
	}

	requestedScopes, ok := result["requestedScopes"].([]string)
	if !ok {
		t.Fatalf("unexpected requestedScopes type: %#v", result["requestedScopes"])
	}
	if len(requestedScopes) == 0 {
		t.Fatalf("expected non-empty requested scopes, got %#v", result)
	}
	for _, scope := range requestedScopes {
		if isSensitiveScope(scope) {
			t.Fatalf("expected sensitive scopes to be excluded, got %#v", requestedScopes)
		}
	}
	if !hasScope(requestedScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access in requested scopes, got %#v", requestedScopes)
	}
}

func TestRunOauthBatchAuthReturnsAlreadyAuthorizedWhenNothingMissing(t *testing.T) {
	config := oauthToolTestConfig()
	config.ToolAllowlist = []string{"feishu_fetch_doc"}
	config.UserToken.Scopes = []string{"docx:document:readonly", "wiki:node:read", oauthOfflineAccessScope}

	service, _, workspace := newOauthToolTestService(t, config)
	result, err := service.runOauthBatchAuth(context.Background(), workspace.ID, configFromStore(config), nil)
	if err != nil {
		t.Fatalf("runOauthBatchAuth() error = %v", err)
	}
	if result["alreadyAuthorized"] != true {
		t.Fatalf("expected alreadyAuthorized=true, got %#v", result)
	}
	if got, _ := result["requestedScopes"].([]string); len(got) != 0 {
		t.Fatalf("expected no requested scopes, got %#v", got)
	}
}

func TestRunOauthBatchAuthCapsRequestedScopesAtHundred(t *testing.T) {
	const syntheticToolName = "feishu_oauth_batch_auth_test_tool"
	const syntheticActionKey = syntheticToolName + ".default"

	originalDefinition, hadDefinition := toolDefinitions[syntheticToolName]
	originalScopes, hadScopes := toolActionScopes[syntheticActionKey]
	originalCategories := append([]capabilityCategoryDefinition(nil), capabilityCategories...)
	defer func() {
		if hadDefinition {
			toolDefinitions[syntheticToolName] = originalDefinition
		} else {
			delete(toolDefinitions, syntheticToolName)
		}
		if hadScopes {
			toolActionScopes[syntheticActionKey] = originalScopes
		} else {
			delete(toolActionScopes, syntheticActionKey)
		}
		capabilityCategories = originalCategories
	}()

	scopes := make([]string, 0, 105)
	for index := 0; index < 105; index++ {
		scopes = append(scopes, "synthetic:scope:"+strconv.Itoa(index))
	}

	toolDefinitions[syntheticToolName] = toolDefinition{
		ToolName:    syntheticToolName,
		Title:       "Synthetic OAuth batch auth tool",
		Description: "Synthetic test tool",
		Stage:       "preview",
		RiskLevel:   "low",
		ActionKeys:  []string{syntheticActionKey},
	}
	toolActionScopes[syntheticActionKey] = scopes
	capabilityCategories = append(capabilityCategories, capabilityCategoryDefinition{
		ID:          "auth_test",
		Title:       "Auth test",
		Description: "Synthetic auth tools",
		ToolNames:   []string{syntheticToolName},
	})

	config := oauthToolTestConfig()
	config.ToolAllowlist = []string{syntheticToolName}
	config.UserToken = store.FeishuUserToken{}

	service, _, workspace := newOauthToolTestService(t, config)
	result, err := service.runOauthBatchAuth(context.Background(), workspace.ID, configFromStore(config), nil)
	if err != nil {
		t.Fatalf("runOauthBatchAuth() error = %v", err)
	}

	requestedScopes, ok := result["requestedScopes"].([]string)
	if !ok {
		t.Fatalf("unexpected requestedScopes type: %#v", result["requestedScopes"])
	}
	if len(requestedScopes) != oauthBatchScopeLimit {
		t.Fatalf("expected requestedScopes to be capped at %d, got %d", oauthBatchScopeLimit, len(requestedScopes))
	}
	if remaining, _ := result["remainingScopes"].(int); remaining != 6 {
		t.Fatalf("expected remainingScopes=6, got %#v", result["remainingScopes"])
	}
	if !hasScope(requestedScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access to remain in requested scopes, got %#v", requestedScopes)
	}
}
