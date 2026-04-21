package feishutools

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/events"
	"codex-server/backend/internal/runtime"
	"codex-server/backend/internal/store"
	"codex-server/backend/internal/testutil/codexfake"

	toml "github.com/pelletier/go-toml/v2"
)

func TestParseConfigReadsFlatKeys(t *testing.T) {
	t.Parallel()

	config := parseConfig(map[string]any{
		"feishu_tools_enabled":         true,
		"feishu_app_id":                "cli_app_123",
		"feishu_app_secret":            "secret-value",
		"feishu_mcp_endpoint":          "https://mcp.example.com/sse",
		"feishu_oauth_mode":            "app_only",
		"feishu_sensitive_write_guard": false,
		"feishu_tool_allowlist":        []any{"feishu_fetch_doc", "feishu_task_task"},
	})

	if !config.Enabled {
		t.Fatalf("expected enabled config")
	}
	if config.AppID != "cli_app_123" {
		t.Fatalf("unexpected app id %q", config.AppID)
	}
	if !config.AppSecretSet {
		t.Fatalf("expected app secret flag to be set")
	}
	if config.MCPEndpoint != "https://mcp.example.com/sse" {
		t.Fatalf("unexpected endpoint %q", config.MCPEndpoint)
	}
	if config.OauthMode != OauthModeAppOnly {
		t.Fatalf("unexpected oauth mode %q", config.OauthMode)
	}
	if config.SensitiveWriteGuard {
		t.Fatalf("expected sensitive write guard to be false")
	}
	if len(config.ToolAllowlist) != 2 || config.ToolAllowlist[0] != "feishu_fetch_doc" || config.ToolAllowlist[1] != "feishu_task_task" {
		t.Fatalf("unexpected allowlist %#v", config.ToolAllowlist)
	}
}

func TestParseConfigReadsManagedMcpServerCompatToolFiltersWithoutEndpointOverride(t *testing.T) {
	t.Parallel()

	config := parseConfig(map[string]any{
		"mcp_servers": map[string]any{
			managedMCPServerName: map[string]any{
				"url":            "https://mcp.example.com/sse",
				"enabled":        true,
				"enabled_tools":  []any{"feishu_fetch_doc"},
				"disabled_tools": []any{"feishu_calendar_event"},
			},
		},
	})

	if !config.Enabled {
		t.Fatalf("expected managed mcp compat config to enable Feishu tools")
	}
	if config.MCPEndpoint != "" {
		t.Fatalf("expected managed mcp compat url not to override explicit endpoint source, got %q", config.MCPEndpoint)
	}
	if len(config.ToolAllowlist) != 1 || config.ToolAllowlist[0] != "feishu_fetch_doc" {
		t.Fatalf("unexpected allowlist %#v", config.ToolAllowlist)
	}
}

func TestBuildPermissionsTracksSensitiveScopes(t *testing.T) {
	t.Parallel()

	result := buildPermissions(Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_calendar_event"},
	})

	if result.OverallStatus != "pending_authorization" {
		t.Fatalf("unexpected overall status %q", result.OverallStatus)
	}
	if len(result.RequiredScopes) == 0 {
		t.Fatalf("expected required scopes to be populated")
	}
	if !hasScope(result.RequiredScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access to be part of required scopes: %#v", result.RequiredScopes)
	}
	foundDelete := false
	for _, scope := range result.SensitiveScopes {
		if scope == "calendar:calendar.event:delete" {
			foundDelete = true
			break
		}
	}
	if !foundDelete {
		t.Fatalf("expected calendar delete scope to be marked sensitive: %#v", result.SensitiveScopes)
	}
}

func TestBuildCapabilityCategoriesUsesAllowlist(t *testing.T) {
	t.Parallel()

	categories := buildCapabilityCategories(Config{
		Enabled:       true,
		OauthMode:     OauthModeUserAuth,
		ToolAllowlist: []string{"feishu_fetch_doc"},
	})

	var docsCategory *CapabilityCategory
	for index := range categories {
		if categories[index].ID == "docs" {
			docsCategory = &categories[index]
			break
		}
	}
	if docsCategory == nil {
		t.Fatalf("expected docs category")
	}
	if docsCategory.EnabledCount != 1 {
		t.Fatalf("expected docs enabled count 1, got %d", docsCategory.EnabledCount)
	}
}

func TestBuildPermissionsUsesGrantedUserScopesAndAliases(t *testing.T) {
	t.Parallel()

	result := buildPermissions(Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_im_user_message", "feishu_wiki_space"},
		UserToken: OauthTokenSnapshot{
			AccessToken:          "u-access",
			RefreshToken:         "u-refresh",
			AccessTokenExpiresAt: time.Now().UTC().Add(1 * time.Hour),
			Scopes: []string{
				"im:message",
				"im:message:send_as_user",
				"wiki:space:retrieve",
			},
		},
	})

	if result.OverallStatus != "pending_authorization" {
		t.Fatalf("expected pending_authorization while some scopes remain missing, got %q", result.OverallStatus)
	}
	if len(result.GrantedScopes) == 0 {
		t.Fatalf("expected granted scopes to be populated")
	}

	foundGranted := false
	foundMissing := false
	for _, item := range result.Items {
		if item.Scope == "im:message.send_as_user" && item.Status == "granted" {
			foundGranted = true
		}
		if item.Scope == "wiki:space:write_only" && item.Status == "missing" {
			foundMissing = true
		}
	}
	if !foundGranted {
		t.Fatalf("expected send_as_user alias to be treated as granted: %#v", result.Items)
	}
	if !foundMissing {
		t.Fatalf("expected wiki:space:write_only to remain missing: %#v", result.Items)
	}
}

func TestBuildPermissionsIncludesDocxConvertForStructuredDocUpdates(t *testing.T) {
	t.Parallel()

	result := buildPermissions(Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_update_doc"},
	})

	if !hasScope(result.RequiredScopes, "docx:document.block:convert") {
		t.Fatalf("expected structured doc updates to require docx:document.block:convert: %#v", result.RequiredScopes)
	}
	if !hasScope(result.MissingScopes, "docx:document.block:convert") {
		t.Fatalf("expected structured doc updates to surface docx:document.block:convert as missing before oauth: %#v", result.MissingScopes)
	}

	found := false
	for _, item := range result.Items {
		if item.Scope == "docx:document.block:convert" {
			found = item.Status == "pending_authorization" && item.Source == "user_scope"
			break
		}
	}
	if !found {
		t.Fatalf("expected permission item for docx:document.block:convert to be marked pending_authorization user_scope: %#v", result.Items)
	}
}

func TestBuildPermissionsExcludesRequiredAppScopesFromMissingScopes(t *testing.T) {
	t.Parallel()

	result := buildPermissions(Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc"},
	})

	for _, scope := range result.MissingScopes {
		if isRequiredAppScope(scope) {
			t.Fatalf("required app scopes should not be listed as oauth missing scopes: %#v", result.MissingScopes)
		}
	}
	if !hasScope(result.MissingScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access to be listed as missing when OAuth has not completed: %#v", result.MissingScopes)
	}
}

func TestBuildPermissionsTracksOfflineAccessRefreshCapability(t *testing.T) {
	t.Parallel()

	baseConfig := Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc"},
	}

	withoutRefresh := buildPermissions(Config{
		Enabled:             baseConfig.Enabled,
		AppID:               baseConfig.AppID,
		AppSecretSet:        baseConfig.AppSecretSet,
		MCPEndpoint:         baseConfig.MCPEndpoint,
		OauthMode:           baseConfig.OauthMode,
		SensitiveWriteGuard: baseConfig.SensitiveWriteGuard,
		ToolAllowlist:       append([]string(nil), baseConfig.ToolAllowlist...),
		UserToken: OauthTokenSnapshot{
			AccessToken:          "u-access",
			AccessTokenExpiresAt: time.Now().UTC().Add(1 * time.Hour),
			Scopes:               []string{"docx:document:readonly"},
		},
	})
	if withoutRefresh.OverallStatus != "pending_authorization" {
		t.Fatalf("expected pending_authorization without refresh token, got %q", withoutRefresh.OverallStatus)
	}
	if !hasScope(withoutRefresh.MissingScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access missing without refresh scope: %#v", withoutRefresh.MissingScopes)
	}

	withRefresh := buildPermissions(Config{
		Enabled:             baseConfig.Enabled,
		AppID:               baseConfig.AppID,
		AppSecretSet:        baseConfig.AppSecretSet,
		MCPEndpoint:         baseConfig.MCPEndpoint,
		OauthMode:           baseConfig.OauthMode,
		SensitiveWriteGuard: baseConfig.SensitiveWriteGuard,
		ToolAllowlist:       append([]string(nil), baseConfig.ToolAllowlist...),
		UserToken: OauthTokenSnapshot{
			AccessToken:           "u-access",
			RefreshToken:          "u-refresh",
			AccessTokenExpiresAt:  time.Now().UTC().Add(1 * time.Hour),
			RefreshTokenExpiresAt: time.Now().UTC().Add(24 * time.Hour),
			Scopes:                []string{"docx:document:readonly", "wiki:node:read", oauthOfflineAccessScope},
		},
	})
	if withRefresh.OverallStatus != "configured" {
		t.Fatalf("expected configured once offline_access and refresh token are present, got %q", withRefresh.OverallStatus)
	}
	if hasScope(withRefresh.MissingScopes, oauthOfflineAccessScope) {
		t.Fatalf("expected offline_access to stop being missing once granted: %#v", withRefresh.MissingScopes)
	}

	foundOauthCoreScope := false
	for _, item := range withRefresh.Items {
		if item.Scope == oauthOfflineAccessScope {
			foundOauthCoreScope = item.Source == "oauth_core_scope" && item.Status == "granted"
			break
		}
	}
	if !foundOauthCoreScope {
		t.Fatalf("expected offline_access permission item to be marked as granted oauth_core_scope: %#v", withRefresh.Items)
	}
}

func TestConfigEditUsesUpsertMergeStrategy(t *testing.T) {
	t.Parallel()

	edit := configEdit("feishu_app_id", "cli_app_123")
	if edit["keyPath"] != "feishu_app_id" {
		t.Fatalf("unexpected keyPath: %#v", edit)
	}
	if edit["mergeStrategy"] != "upsert" {
		t.Fatalf("expected mergeStrategy=upsert, got %#v", edit)
	}
	if edit["value"] != "cli_app_123" {
		t.Fatalf("unexpected value: %#v", edit)
	}
}

func TestBuildManagedMcpServersPreservesOtherServers(t *testing.T) {
	t.Parallel()

	servers, integration := buildManagedMcpServers(map[string]any{
		"mcp_servers": map[string]any{
			"github": map[string]any{
				"url": "https://mcp.github.com",
			},
		},
	}, Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
	}, true, false)

	if integration.Status != "configured" || !integration.ThreadEnabled || !integration.BotEnabled {
		t.Fatalf("unexpected runtime integration %#v", integration)
	}
	if _, ok := servers["github"]; !ok {
		t.Fatalf("expected existing mcp server to be preserved: %#v", servers)
	}
	managed, ok := servers[managedMCPServerName].(map[string]any)
	if !ok {
		t.Fatalf("expected managed feishu mcp server entry, got %#v", servers)
	}
	if managed["url"] != "https://mcp.example.com/sse" {
		t.Fatalf("unexpected managed server %#v", managed)
	}
	if managed["enabled"] != true {
		t.Fatalf("expected managed server to be enabled, got %#v", managed)
	}
	enabledTools, ok := managed["enabled_tools"].([]string)
	if !ok || len(enabledTools) == 0 {
		t.Fatalf("expected managed enabled_tools list, got %#v", managed)
	}
	disabledTools, ok := managed["disabled_tools"].([]string)
	if !ok {
		t.Fatalf("expected managed disabled_tools list, got %#v", managed)
	}
	if len(disabledTools) != 0 {
		t.Fatalf("expected expose-all mode to keep disabled_tools empty, got %#v", disabledTools)
	}
}

func TestBuildManagedMcpServersRemovesManagedServerWhenDisabled(t *testing.T) {
	t.Parallel()

	servers, integration := buildManagedMcpServers(map[string]any{
		"mcp_servers": map[string]any{
			managedMCPServerName: map[string]any{
				"url": "https://mcp.example.com/sse",
			},
			"github": map[string]any{
				"url": "https://mcp.github.com",
			},
		},
	}, Config{
		Enabled:             false,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		SensitiveWriteGuard: true,
	}, true, false)

	if integration.Status != "sync_required" {
		t.Fatalf("expected disabled config with stale managed server to require sync, got %#v", integration)
	}
	if _, ok := servers[managedMCPServerName]; ok {
		t.Fatalf("expected managed feishu mcp server to be removed: %#v", servers)
	}
	if _, ok := servers["github"]; !ok {
		t.Fatalf("expected unrelated mcp server to be preserved: %#v", servers)
	}
}

func TestBuildRuntimeIntegrationReadsLegacyMcpServersKey(t *testing.T) {
	t.Parallel()

	config := Config{
		Enabled:             true,
		AppID:               "cli_app_123",
		AppSecretSet:        true,
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc"},
	}
	integration := buildRuntimeIntegration(map[string]any{
		"mcpServers": map[string]any{
			managedMCPServerName: managedMcpServerEntry(config),
		},
	}, config, true, false)

	if integration.Status != "configured" || !integration.ThreadEnabled {
		t.Fatalf("expected legacy mcpServers key to remain readable, got %#v", integration)
	}
}

func TestMergeConfigLayersRetainsFeishuKeysFromUserLayer(t *testing.T) {
	t.Parallel()

	merged := mergeConfigLayers(
		map[string]any{
			"model": "gpt-5.4",
		},
		[]any{
			map[string]any{
				"config": map[string]any{
					"feishu_tools_enabled": true,
					"feishu_app_id":        "cli_layer_app",
				},
			},
		},
	)

	if merged["feishu_tools_enabled"] != true {
		t.Fatalf("expected feishu_tools_enabled from layer, got %#v", merged)
	}
	if merged["feishu_app_id"] != "cli_layer_app" {
		t.Fatalf("expected feishu_app_id from layer, got %#v", merged)
	}
	if merged["model"] != "gpt-5.4" {
		t.Fatalf("expected base keys to be retained, got %#v", merged)
	}
}

func TestWriteConfigPersistsToStore(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, nil, nil, dataStore)

	result, err := service.WriteConfig(context.Background(), workspace.ID, ConfigInput{
		Enabled:             true,
		AppID:               "cli_store_app",
		AppSecret:           "store-secret",
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc", "feishu_calendar_event"},
	})
	if err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}
	if result.Source != "store" {
		t.Fatalf("expected store source, got %q", result.Source)
	}
	if result.RuntimeIntegration == nil || result.RuntimeIntegration.Status != "unavailable" {
		t.Fatalf("expected runtime integration to be unavailable without configfs, got %#v", result.RuntimeIntegration)
	}
	if len(result.Warnings) == 0 {
		t.Fatalf("expected config write to surface runtime integration warning when configfs is nil")
	}

	stored, ok := dataStore.GetFeishuToolsConfig(workspace.ID)
	if !ok {
		t.Fatalf("expected feishu config to be stored")
	}
	if stored.AppID != "cli_store_app" || stored.AppSecret != "store-secret" {
		t.Fatalf("unexpected stored config %#v", stored)
	}
	if len(stored.ToolAllowlist) != 2 {
		t.Fatalf("unexpected allowlist %#v", stored.ToolAllowlist)
	}

	readResult, err := service.ReadConfig(context.Background(), workspace.ID)
	if err != nil {
		t.Fatalf("ReadConfig() error = %v", err)
	}
	if readResult.Config.AppID != "cli_store_app" {
		t.Fatalf("expected stored app id, got %#v", readResult.Config)
	}
	if readResult.Config.MCPEndpoint != "https://mcp.example.com/sse" {
		t.Fatalf("expected explicit override to round-trip through read config, got %#v", readResult.Config)
	}
	if !readResult.Config.AppSecretSet {
		t.Fatalf("expected stored secret to remain set")
	}
	if readResult.RuntimeIntegration == nil || readResult.RuntimeIntegration.Status != "unavailable" {
		t.Fatalf("expected read config to describe missing runtime integration, got %#v", readResult.RuntimeIntegration)
	}
}

func TestInvokePersistsFeishuToolAuditRecord(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, nil, nil, dataStore)

	now := time.Now().UTC()
	pointerTime := func(value time.Time) *time.Time {
		return &value
	}
	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID: workspace.ID,
		Enabled:     true,
		AppID:       "cli_store_app",
		AppSecret:   "store-secret",
		OauthMode:   OauthModeUserAuth,
		ToolAllowlist: []string{
			"feishu_oauth",
		},
		UserToken: store.FeishuUserToken{
			AccessToken:           "u-access",
			RefreshToken:          "u-refresh",
			Scopes:                []string{"offline_access"},
			OpenID:                "ou_user_1",
			AccessTokenExpiresAt:  pointerTime(now.Add(1 * time.Hour)),
			RefreshTokenExpiresAt: pointerTime(now.Add(24 * time.Hour)),
			ObtainedAt:            pointerTime(now),
		},
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	ctx := ContextWithInvokeEventScope(context.Background(), "thread-1", "turn-1")
	result, err := service.Invoke(ctx, workspace.ID, InvokeInput{
		ToolName: "feishu_oauth",
		Action:   "status",
	})
	if err != nil {
		t.Fatalf("Invoke() error = %v", err)
	}
	if result.Status != "ok" {
		t.Fatalf("expected ok invoke result, got %#v", result)
	}

	records := dataStore.ListFeishuToolAuditRecords(workspace.ID, store.FeishuToolAuditFilter{})
	if len(records) != 1 {
		t.Fatalf("expected one audit record, got %#v", records)
	}
	record := records[0]
	if record.ThreadID != "thread-1" || record.TurnID != "turn-1" {
		t.Fatalf("expected thread scope to persist, got %#v", record)
	}
	if record.ToolName != "feishu_oauth" || record.Action != "status" || record.ActionKey != "feishu_oauth.status" {
		t.Fatalf("unexpected tool audit fields %#v", record)
	}
	if record.PrincipalType != "user" || record.PrincipalID != "ou_user_1" {
		t.Fatalf("unexpected principal in audit record %#v", record)
	}
	if record.Result != "success" || record.DurationMs < 0 {
		t.Fatalf("unexpected audit outcome %#v", record)
	}
}

func TestWriteConfigSynchronizesManagedMcpServerIntoWorkspaceConfig(t *testing.T) {
	hub := events.NewHub()
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"config/read": {
				Result: map[string]any{
					"config":  map[string]any{},
					"origins": map[string]any{},
					"layers":  []any{},
				},
			},
			"config/mcpServer/reload": {
				Result: map[string]any{
					"reloaded": true,
				},
			},
		},
	})

	runtimeManager := runtime.NewManager(session.Command, hub)
	rootPath := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootPath)
	runtimeManager.Configure(workspace.ID, rootPath)
	t.Cleanup(func() {
		runtimeManager.Remove(workspace.ID)
	})

	service := NewService(configfs.NewService(runtimeManager), nil, nil, dataStore)
	configPath := filepath.Join(rootPath, ".codex", "config.toml")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(configPath, []byte("[mcp_servers.github]\nurl = \"https://mcp.github.com\"\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(config.toml) error = %v", err)
	}

	result, err := service.WriteConfig(context.Background(), workspace.ID, ConfigInput{
		Enabled:             true,
		AppID:               "cli_store_app",
		AppSecret:           "store-secret",
		MCPEndpoint:         "https://mcp.example.com/sse",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc"},
	})
	if err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}
	if result.RuntimeIntegration == nil || result.RuntimeIntegration.Status != "configured" {
		t.Fatalf("expected runtime integration to be configured, got %#v", result.RuntimeIntegration)
	}

	state := codexfake.ReadState(t, session.StateFile)
	reloadCalled := false
	for _, record := range state.Received {
		if record.Method == "config/mcpServer/reload" {
			reloadCalled = true
		}
	}
	if !reloadCalled {
		t.Fatalf("expected config/mcpServer/reload to be called, got %#v", state.Received)
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile(config.toml) error = %v", err)
	}

	var config map[string]any
	if err := toml.Unmarshal(content, &config); err != nil {
		t.Fatalf("toml.Unmarshal() error = %v", err)
	}
	servers, ok := config["mcp_servers"].(map[string]any)
	if !ok {
		t.Fatalf("expected mcp_servers table, got %#v", config)
	}
	if _, ok := servers["github"]; !ok {
		t.Fatalf("expected existing workspace server to be preserved, got %#v", servers)
	}
	managed, ok := servers[managedMCPServerName].(map[string]any)
	if !ok {
		t.Fatalf("expected managed mcp server entry, got %#v", servers)
	}
	if managed["url"] != "https://mcp.example.com/sse" {
		t.Fatalf("unexpected managed mcp server %#v", managed)
	}
	if managed["enabled"] != true {
		t.Fatalf("expected managed mcp server to be enabled, got %#v", managed)
	}
	enabledTools, ok := managed["enabled_tools"].([]any)
	if !ok || len(enabledTools) != 1 || enabledTools[0] != "feishu_fetch_doc" {
		t.Fatalf("expected enabled_tools allowlist to be written, got %#v", managed)
	}
	disabledTools, ok := managed["disabled_tools"].([]any)
	if !ok || len(disabledTools) == 0 {
		t.Fatalf("expected disabled_tools complement to be written, got %#v", managed)
	}
}

func TestWriteConfigGeneratesManagedMcpEndpointWhenInputIsBlank(t *testing.T) {
	hub := events.NewHub()
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"config/read": {
				Result: map[string]any{
					"config":  map[string]any{},
					"origins": map[string]any{},
					"layers":  []any{},
				},
			},
			"config/mcpServer/reload": {
				Result: map[string]any{
					"reloaded": true,
				},
			},
		},
	})

	runtimeManager := runtime.NewManager(session.Command, hub)
	rootPath := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootPath)
	runtimeManager.Configure(workspace.ID, rootPath)
	t.Cleanup(func() {
		runtimeManager.Remove(workspace.ID)
	})

	service := NewService(configfs.NewService(runtimeManager), nil, nil, dataStore)
	service.SetRuntimeBaseURL("http://127.0.0.1:18080")

	result, err := service.WriteConfig(context.Background(), workspace.ID, ConfigInput{
		Enabled:             true,
		AppID:               "cli_store_app",
		AppSecret:           "store-secret",
		MCPEndpoint:         "",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc"},
	})
	if err != nil {
		t.Fatalf("WriteConfig() error = %v", err)
	}
	if result.Config.MCPEndpoint != "" {
		t.Fatalf("expected explicit override field to remain blank, got %#v", result.Config)
	}
	if result.ManagedMCPEndpoint == "" {
		t.Fatal("expected built-in managed mcp endpoint to be generated")
	}
	if got := result.RuntimeIntegration; got == nil || got.Status != "configured" || !got.AllowlistAppliedInThread || !got.WriteGuardAppliedInThread {
		t.Fatalf("expected built-in runtime integration to be configured with guardrails, got %#v", got)
	}

	configPath := filepath.Join(rootPath, ".codex", "config.toml")
	content, err := os.ReadFile(configPath)
	if err != nil {
		t.Fatalf("ReadFile(config.toml) error = %v", err)
	}

	var config map[string]any
	if err := toml.Unmarshal(content, &config); err != nil {
		t.Fatalf("toml.Unmarshal() error = %v", err)
	}
	servers, ok := config["mcp_servers"].(map[string]any)
	if !ok {
		t.Fatalf("expected mcp_servers table, got %#v", config)
	}
	managed, ok := servers[managedMCPServerName].(map[string]any)
	if !ok {
		t.Fatalf("expected managed mcp server entry, got %#v", servers)
	}
	if managed["url"] != result.ManagedMCPEndpoint {
		t.Fatalf("expected generated endpoint to be written, got %#v", managed)
	}
	if managed["enabled"] != true {
		t.Fatalf("expected generated endpoint entry to stay enabled, got %#v", managed)
	}
	if !strings.Contains(result.ManagedMCPEndpoint, "/api/feishu-tools/mcp/"+workspace.ID+"?token=") {
		t.Fatalf("unexpected generated endpoint %q", result.ManagedMCPEndpoint)
	}
}

func TestValidateManagedMCPToken(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID:         workspace.ID,
		ManagedMCPAuthToken: "token-123",
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	service := NewService(nil, nil, nil, dataStore)
	if !service.ValidateManagedMCPToken(workspace.ID, "token-123") {
		t.Fatal("expected managed mcp token to validate")
	}
	if service.ValidateManagedMCPToken(workspace.ID, "wrong-token") {
		t.Fatal("expected wrong token to be rejected")
	}
}

func TestHandleMCPInitializeAndList(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, nil, nil, dataStore)

	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID:         workspace.ID,
		Enabled:             true,
		AppID:               "cli_demo",
		AppSecret:           "secret",
		SensitiveWriteGuard: true,
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	initializeResponse, ok := service.HandleMCP(context.Background(), workspace.ID, []byte(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}`))
	if !ok || !strings.Contains(string(initializeResponse), `"protocolVersion":"2025-03-26"`) {
		t.Fatalf("unexpected initialize response %s", string(initializeResponse))
	}

	listResponse, ok := service.HandleMCP(context.Background(), workspace.ID, []byte(`{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}`))
	if !ok || !strings.Contains(string(listResponse), `"name":"feishu_fetch_doc"`) {
		t.Fatalf("unexpected tools/list response %s", string(listResponse))
	}
}

func TestHandleMCPToolCallReturnsToolEnvelope(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, nil, nil, dataStore)

	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID:         workspace.ID,
		Enabled:             true,
		AppID:               "cli_demo",
		AppSecret:           "secret",
		SensitiveWriteGuard: true,
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	payload := `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"feishu_fetch_doc","arguments":{"documentId":"doc_xxx"}}}`
	response, ok := service.HandleMCP(context.Background(), workspace.ID, []byte(payload))
	if !ok {
		t.Fatal("expected tools/call to produce a response")
	}
	if !strings.Contains(string(response), `"isError":true`) || !strings.Contains(string(response), `"toolName":"feishu_fetch_doc"`) {
		t.Fatalf("unexpected tools/call response %s", string(response))
	}
}

func TestWriteTokenSnapshotPersistsToStore(t *testing.T) {
	t.Parallel()

	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", t.TempDir())
	service := NewService(nil, nil, nil, dataStore)

	now := time.Now().UTC()
	err := service.writeTokenSnapshot(context.Background(), workspace.ID, OauthTokenSnapshot{
		AccessToken:           "access-token",
		RefreshToken:          "refresh-token",
		AccessTokenExpiresAt:  now.Add(1 * time.Hour),
		RefreshTokenExpiresAt: now.Add(24 * time.Hour),
		Scopes:                []string{"calendar:calendar:readonly"},
		OpenID:                "ou_xxx",
		UnionID:               "on_xxx",
		ObtainedAt:            now,
	})
	if err != nil {
		t.Fatalf("writeTokenSnapshot() error = %v", err)
	}

	stored, ok := dataStore.GetFeishuToolsConfig(workspace.ID)
	if !ok {
		t.Fatalf("expected token snapshot to create store record")
	}
	if stored.UserToken.AccessToken != "access-token" || stored.UserToken.RefreshToken != "refresh-token" {
		t.Fatalf("unexpected token snapshot %#v", stored.UserToken)
	}

	readConfig, err := service.readConfig(context.Background(), workspace.ID)
	if err != nil {
		t.Fatalf("readConfig() error = %v", err)
	}
	if readConfig.UserToken.AccessToken != "access-token" {
		t.Fatalf("expected access token from store, got %#v", readConfig.UserToken)
	}
}

func TestReadConfigKeepsGeneratedEndpointUnlessStoreExplicitlyOverrides(t *testing.T) {
	managedEntry := managedMcpServerEntry(Config{
		Enabled:             true,
		MCPEndpoint:         "https://mcp.example.com/custom",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       []string{"feishu_fetch_doc"},
	})
	hub := events.NewHub()
	session := codexfake.NewSessionWithScenario(t, codexfake.Scenario{
		Behaviors: map[string]codexfake.MethodBehavior{
			"config/read": {
				Result: map[string]any{
					"config": map[string]any{
						"mcp_servers": map[string]any{
							managedMCPServerName: managedEntry,
						},
					},
					"origins": map[string]any{},
					"layers":  []any{},
				},
			},
		},
	})

	runtimeManager := runtime.NewManager(session.Command, hub)
	rootPath := t.TempDir()
	dataStore := store.NewMemoryStore()
	workspace := dataStore.CreateWorkspace("Workspace A", rootPath)
	runtimeManager.Configure(workspace.ID, rootPath)
	t.Cleanup(func() {
		runtimeManager.Remove(workspace.ID)
	})

	if _, err := dataStore.SetFeishuToolsConfig(store.FeishuToolsConfig{
		WorkspaceID:         workspace.ID,
		Enabled:             true,
		AppID:               "cli_store_app",
		AppSecret:           "store-secret",
		ManagedMCPAuthToken: "token-123",
		SensitiveWriteGuard: true,
		OauthMode:           OauthModeUserAuth,
	}); err != nil {
		t.Fatalf("SetFeishuToolsConfig() error = %v", err)
	}

	service := NewService(configfs.NewService(runtimeManager), nil, nil, dataStore)
	service.SetRuntimeBaseURL("http://127.0.0.1:18080")
	result, err := service.ReadConfig(context.Background(), workspace.ID)
	if err != nil {
		t.Fatalf("ReadConfig() error = %v", err)
	}

	expectedEndpoint := "http://127.0.0.1:18080/api/feishu-tools/mcp/" + workspace.ID + "?token=token-123"
	if result.Config.MCPEndpoint != "" {
		t.Fatalf("expected explicit override field to stay blank until user saves one, got %#v", result.Config)
	}
	if result.ManagedMCPEndpoint != expectedEndpoint {
		t.Fatalf("expected generated managed endpoint to be reported separately, got %#v", result)
	}
	if len(result.Config.ToolAllowlist) != 1 || result.Config.ToolAllowlist[0] != "feishu_fetch_doc" {
		t.Fatalf("expected allowlist from managed mcp compat, got %#v", result.Config.ToolAllowlist)
	}
	if result.RuntimeIntegration == nil || result.RuntimeIntegration.Status != "sync_required" {
		t.Fatalf("expected runtime integration to require sync because runtime still has a custom url, got %#v", result.RuntimeIntegration)
	}
}

func TestFrontendSettingsURLUsesSettingsRouteAndWorkspaceQuery(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil, nil)
	service.SetFrontendOrigin("http://localhost:15173")

	redirectURL := service.frontendSettingsURL("http://localhost:18080", "ws_000014")
	if redirectURL != "http://localhost:15173/settings/feishu-tools?feishuOauth=completed&workspaceId=ws_000014" {
		t.Fatalf("unexpected redirect url %q", redirectURL)
	}
}

func TestFrontendSettingsURLRewritesBindAllFrontendOriginToRequestHost(t *testing.T) {
	t.Parallel()

	service := NewService(nil, nil, nil, nil)
	service.SetFrontendOrigin("http://0.0.0.0:15173")

	redirectURL := service.frontendSettingsURL("http://localhost:18080", "ws_000014")
	if redirectURL != "http://localhost:15173/settings/feishu-tools?feishuOauth=completed&workspaceId=ws_000014" {
		t.Fatalf("unexpected redirect url %q", redirectURL)
	}
}
