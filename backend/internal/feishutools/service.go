package feishutools

import (
	"context"
	"crypto/subtle"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"codex-server/backend/internal/auth"
	"codex-server/backend/internal/catalog"
	"codex-server/backend/internal/configfs"
	"codex-server/backend/internal/store"

	toml "github.com/pelletier/go-toml/v2"
)

var ErrInvalidInput = errors.New("invalid feishu tools input")

const (
	OauthModeAppOnly  = "app_only"
	OauthModeUserAuth = "user_oauth"

	defaultServerName          = "feishu"
	managedMCPServerName       = "feishu-tools"
	managedMCPServersKey       = "mcp_servers"
	legacyManagedMCPServersKey = "mcpServers"
	workspaceConfigTomlPath    = ".codex/config.toml"
)

type Service struct {
	configfs       *configfs.Service
	catalog        *catalog.Service
	auth           *auth.Service
	store          *store.MemoryStore
	oauth          *OauthClient
	gateway        *Gateway
	events         invokeEventPublisher
	publicBaseURL  string
	runtimeBaseURL string
	frontendOrigin string
}

type Config struct {
	Enabled             bool     `json:"enabled"`
	AppID               string   `json:"appId"`
	AppSecret           string   `json:"-"`
	AppSecretSet        bool     `json:"appSecretSet,omitempty"`
	MCPEndpoint         string   `json:"mcpEndpoint"`
	OauthMode           string   `json:"oauthMode"`
	SensitiveWriteGuard bool     `json:"sensitiveWriteGuard"`
	ToolAllowlist       []string `json:"toolAllowlist"`
	UpdatedAt           string   `json:"updatedAt,omitempty"`

	// UserToken holds the persisted Feishu user OAuth snapshot. It is excluded
	// from JSON marshaling to avoid leaking tokens via API responses.
	UserToken OauthTokenSnapshot `json:"-"`
}

type ConfigResult struct {
	Config             Config              `json:"config"`
	Defaults           Config              `json:"defaults"`
	ManagedMCPEndpoint string              `json:"managedMcpEndpoint,omitempty"`
	RuntimeIntegration *RuntimeIntegration `json:"runtimeIntegration,omitempty"`
	Source             string              `json:"source,omitempty"`
	UpdatedAt          string              `json:"updatedAt,omitempty"`
	Warnings           []string            `json:"warnings,omitempty"`
}

type AuthState struct {
	Status              string   `json:"status"`
	PrincipalType       string   `json:"principalType,omitempty"`
	AccountName         string   `json:"accountName,omitempty"`
	AccountID           string   `json:"accountId,omitempty"`
	OpenID              string   `json:"openId,omitempty"`
	UnionID             string   `json:"unionId,omitempty"`
	HasAccessToken      bool     `json:"hasAccessToken,omitempty"`
	HasRefreshToken     bool     `json:"hasRefreshToken,omitempty"`
	AccessTokenPreview  string   `json:"accessTokenPreview,omitempty"`
	RefreshTokenPreview string   `json:"refreshTokenPreview,omitempty"`
	ObtainedAt          string   `json:"obtainedAt,omitempty"`
	ExpiresAt           string   `json:"expiresAt,omitempty"`
	RefreshExpires      string   `json:"refreshExpiresAt,omitempty"`
	GrantedScopes       []string `json:"grantedScopes,omitempty"`
	CallbackURL         string   `json:"callbackUrl,omitempty"`
}

type StatusCheck struct {
	Name      string `json:"name"`
	Status    string `json:"status"`
	Detail    string `json:"detail,omitempty"`
	Hint      string `json:"hint,omitempty"`
	CheckedAt string `json:"checkedAt,omitempty"`
}

type StatusResult struct {
	OverallStatus      string              `json:"overallStatus"`
	ConfigStatus       string              `json:"configStatus,omitempty"`
	GatewayStatus      string              `json:"gatewayStatus,omitempty"`
	OauthStatus        string              `json:"oauthStatus,omitempty"`
	ServiceEndpoint    string              `json:"serviceEndpoint,omitempty"`
	LastCheckedAt      string              `json:"lastCheckedAt,omitempty"`
	Auth               *AuthState          `json:"auth,omitempty"`
	RuntimeIntegration *RuntimeIntegration `json:"runtimeIntegration,omitempty"`
	Checks             []StatusCheck       `json:"checks,omitempty"`
	Messages           []string            `json:"messages,omitempty"`
}

type RuntimeIntegration struct {
	Status                    string `json:"status"`
	Mode                      string `json:"mode,omitempty"`
	ServerName                string `json:"serverName,omitempty"`
	ServerURL                 string `json:"serverUrl,omitempty"`
	Managed                   bool   `json:"managed"`
	ThreadEnabled             bool   `json:"threadEnabled"`
	BotEnabled                bool   `json:"botEnabled"`
	AllowlistAppliedInThread  bool   `json:"allowlistAppliedInThread"`
	WriteGuardAppliedInThread bool   `json:"writeGuardAppliedInThread"`
	Detail                    string `json:"detail,omitempty"`
}

type CapabilityItem struct {
	ToolName       string   `json:"toolName"`
	Title          string   `json:"title,omitempty"`
	Description    string   `json:"description,omitempty"`
	Enabled        bool     `json:"enabled"`
	Stage          string   `json:"stage,omitempty"`
	RequiredScopes []string `json:"requiredScopes,omitempty"`
	RiskLevel      string   `json:"riskLevel,omitempty"`
}

type CapabilityCategory struct {
	ID           string           `json:"id"`
	Title        string           `json:"title"`
	Description  string           `json:"description,omitempty"`
	EnabledCount int              `json:"enabledCount,omitempty"`
	TotalCount   int              `json:"totalCount,omitempty"`
	Items        []CapabilityItem `json:"items,omitempty"`
}

type CapabilitiesSummary struct {
	EnabledCount int    `json:"enabledCount,omitempty"`
	TotalCount   int    `json:"totalCount,omitempty"`
	Stage        string `json:"stage,omitempty"`
}

type CapabilitiesResult struct {
	Categories []CapabilityCategory `json:"categories"`
	Summary    *CapabilitiesSummary `json:"summary,omitempty"`
}

type PermissionItem struct {
	Scope     string   `json:"scope"`
	Status    string   `json:"status"`
	Source    string   `json:"source,omitempty"`
	Reason    string   `json:"reason,omitempty"`
	Tools     []string `json:"tools,omitempty"`
	Sensitive bool     `json:"sensitive,omitempty"`
}

type PermissionsResult struct {
	OverallStatus   string           `json:"overallStatus,omitempty"`
	RequiredScopes  []string         `json:"requiredScopes,omitempty"`
	GrantedScopes   []string         `json:"grantedScopes,omitempty"`
	MissingScopes   []string         `json:"missingScopes,omitempty"`
	SensitiveScopes []string         `json:"sensitiveScopes,omitempty"`
	Suggestions     []string         `json:"suggestions,omitempty"`
	Items           []PermissionItem `json:"items,omitempty"`
}

type ConfigInput struct {
	Enabled             bool
	AppID               string
	AppSecret           string
	MCPEndpoint         string
	OauthMode           string
	SensitiveWriteGuard bool
	ToolAllowlist       []string
}

type AuditQuery struct {
	ToolName string
	Result   string
	Limit    int
}

type AuditResult struct {
	Items []store.FeishuToolAuditRecord `json:"items"`
}

func NewService(configFS *configfs.Service, catalogService *catalog.Service, authService *auth.Service, dataStore *store.MemoryStore) *Service {
	service := &Service{
		configfs: configFS,
		catalog:  catalogService,
		auth:     authService,
		store:    dataStore,
		oauth:    NewOauthClient(nil),
	}
	service.gateway = newGateway(service, nil)
	return service
}

// SetPublicBaseURL configures the base URL used to derive the Feishu OAuth
// redirect endpoint. It must be called before OauthLogin for browser-based
// flows to work end to end.
func (s *Service) SetPublicBaseURL(publicBaseURL string) {
	if s == nil {
		return
	}
	s.publicBaseURL = strings.TrimSpace(publicBaseURL)
}

// SetFrontendOrigin configures the browser-facing frontend origin used after
// completing OAuth. It should point at the SPA host rather than the API host.
func (s *Service) SetFrontendOrigin(frontendOrigin string) {
	if s == nil {
		return
	}
	s.frontendOrigin = strings.TrimSpace(frontendOrigin)
}

// SetRuntimeBaseURL configures the loopback-reachable base URL used by the
// managed Feishu MCP entry written into workspace .codex/config.toml.
func (s *Service) SetRuntimeBaseURL(runtimeBaseURL string) {
	if s == nil {
		return
	}
	s.runtimeBaseURL = strings.TrimSpace(runtimeBaseURL)
}

// SetOauthClient overrides the OAuth helper. Intended for tests.
func (s *Service) SetOauthClient(client *OauthClient) {
	if s == nil || client == nil {
		return
	}
	s.oauth = client
}

// SetGateway overrides the HTTP gateway. Intended for tests that need to
// point Feishu traffic at an httptest server.
func (s *Service) SetGateway(gateway *Gateway) {
	if s == nil || gateway == nil {
		return
	}
	s.gateway = gateway
}

// SetEventPublisher wires workspace-scoped event publication so Feishu tool
// invocations can broadcast incremental status updates to the frontend.
func (s *Service) SetEventPublisher(publisher invokeEventPublisher) {
	if s == nil {
		return
	}
	s.events = publisher
}

func (s *Service) Audits(ctx context.Context, workspaceID string, query AuditQuery) (AuditResult, error) {
	if s == nil || s.store == nil {
		return AuditResult{}, fmt.Errorf("%w: feishu tools service is not initialized", ErrInvalidInput)
	}
	if _, err := s.readConfig(ctx, workspaceID); err != nil {
		return AuditResult{}, err
	}
	items := s.store.ListFeishuToolAuditRecords(workspaceID, store.FeishuToolAuditFilter{
		ToolName: strings.TrimSpace(query.ToolName),
		Result:   strings.TrimSpace(query.Result),
		Limit:    query.Limit,
	})
	return AuditResult{Items: items}, nil
}

func (s *Service) ReadConfig(ctx context.Context, workspaceID string) (ConfigResult, error) {
	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return ConfigResult{}, err
	}
	runtimeConfig, _ := s.readRuntimeConfig(ctx, workspaceID)
	resolvedEndpoint, builtinManaged := s.resolvedManagedMCPEndpoint(workspaceID, config)
	effectiveConfig := config
	effectiveConfig.MCPEndpoint = resolvedEndpoint
	runtimeIntegration := buildRuntimeIntegration(runtimeConfig, effectiveConfig, s.configfs != nil, builtinManaged)
	managedEndpoint := s.generatedManagedMCPEndpoint(workspaceID)

	source := "store"
	if !config.UserToken.Connected() && strings.TrimSpace(config.AppID) == "" && s.configfs != nil {
		source = "config/read_compat"
	}

	return ConfigResult{
		Config:             config,
		Defaults:           defaultConfig(),
		ManagedMCPEndpoint: managedEndpoint,
		RuntimeIntegration: &runtimeIntegration,
		Source:             source,
	}, nil
}

func (s *Service) WriteConfig(ctx context.Context, workspaceID string, input ConfigInput) (ConfigResult, error) {
	if s.store == nil {
		return ConfigResult{}, fmt.Errorf("%w: feishu config store is unavailable", ErrInvalidInput)
	}

	normalized, err := normalizeInput(input)
	if err != nil {
		return ConfigResult{}, err
	}

	existing, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return ConfigResult{}, err
	}
	runtimeConfig, _ := s.readRuntimeConfig(ctx, workspaceID)
	storedConfig, _ := s.store.GetFeishuToolsConfig(workspaceID)
	if generatedEndpoint, _ := s.resolvedManagedMCPEndpointFromToken(workspaceID, Config{}, storedConfig.ManagedMCPAuthToken); generatedEndpoint != "" &&
		strings.TrimSpace(normalized.MCPEndpoint) == generatedEndpoint {
		normalized.MCPEndpoint = ""
	}

	persisted := store.FeishuToolsConfig{
		WorkspaceID:         strings.TrimSpace(workspaceID),
		Enabled:             normalized.Enabled,
		AppID:               normalized.AppID,
		AppSecret:           existing.AppSecret,
		ManagedMCPAuthToken: strings.TrimSpace(storedConfig.ManagedMCPAuthToken),
		MCPEndpoint:         normalized.MCPEndpoint,
		OauthMode:           normalized.OauthMode,
		SensitiveWriteGuard: normalized.SensitiveWriteGuard,
		ToolAllowlist:       append([]string(nil), normalized.ToolAllowlist...),
		UserToken:           storeTokenSnapshot(existing.UserToken),
		UpdatedAt:           time.Now().UTC(),
	}
	if normalized.AppSecret != "" {
		persisted.AppSecret = normalized.AppSecret
	}
	if persisted.ManagedMCPAuthToken == "" {
		token, tokenErr := generateStateToken()
		if tokenErr != nil {
			return ConfigResult{}, fmt.Errorf("generate managed feishu mcp auth token: %w", tokenErr)
		}
		persisted.ManagedMCPAuthToken = token
	}

	if _, err := s.store.SetFeishuToolsConfig(persisted); err != nil {
		return ConfigResult{}, err
	}

	resultConfig := normalized
	resultConfig.AppSecretSet = existing.AppSecretSet || normalized.AppSecret != ""
	resultConfig.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	managedEndpoint, _ := s.resolvedManagedMCPEndpointFromToken(workspaceID, Config{}, persisted.ManagedMCPAuthToken)
	resolvedEndpoint, builtinManaged := s.resolvedManagedMCPEndpointFromToken(
		workspaceID,
		resultConfig,
		persisted.ManagedMCPAuthToken,
	)
	effectiveConfig := resultConfig
	effectiveConfig.MCPEndpoint = resolvedEndpoint
	runtimeIntegration := buildRuntimeIntegration(runtimeConfig, effectiveConfig, s.configfs != nil, builtinManaged)
	warnings := make([]string, 0, 2)
	if s.configfs == nil {
		runtimeIntegration.Status = "unavailable"
		runtimeIntegration.ThreadEnabled = false
		runtimeIntegration.BotEnabled = false
		runtimeIntegration.Detail = "Feishu settings were saved, but configfs is unavailable so the managed Feishu MCP server could not be synchronized into thread runtime."
		warnings = append(warnings, "Feishu MCP runtime integration was skipped because configfs is unavailable.")
	} else {
		managedServers, syncedIntegration := buildManagedMcpServers(
			s.readWorkspaceConfigFile(workspaceID),
			effectiveConfig,
			true,
			builtinManaged,
		)
		if err := s.writeWorkspaceManagedMcpServers(workspaceID, managedServers); err != nil {
			runtimeIntegration.Status = "sync_failed"
			runtimeIntegration.ThreadEnabled = false
			runtimeIntegration.BotEnabled = false
			runtimeIntegration.Detail = "Feishu settings were saved, but the managed Feishu MCP server could not be written into workspace .codex/config.toml."
			warnings = append(warnings, "Failed to synchronize mcp_servers.feishu-tools: "+err.Error())
		} else if err := s.configfs.ReloadMcpServers(ctx, workspaceID); err != nil {
			runtimeIntegration = syncedIntegration
			runtimeIntegration.Status = "reload_failed"
			runtimeIntegration.ThreadEnabled = false
			runtimeIntegration.BotEnabled = false
			runtimeIntegration.Detail = "Managed Feishu MCP config was saved, but MCP reload failed. Threads and bot-bound threads will not see the updated Feishu tools until reload succeeds."
			warnings = append(warnings, "MCP reload failed after saving Feishu settings: "+err.Error())
		} else {
			runtimeIntegration = syncedIntegration
		}
	}

	return ConfigResult{
		Config:             resultConfig,
		Defaults:           defaultConfig(),
		ManagedMCPEndpoint: managedEndpoint,
		RuntimeIntegration: &runtimeIntegration,
		Source:             "store",
		UpdatedAt:          resultConfig.UpdatedAt,
		Warnings:           warnings,
	}, nil
}

func (s *Service) Status(ctx context.Context, workspaceID string) (StatusResult, error) {
	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return StatusResult{}, err
	}
	runtimeConfig, _ := s.readRuntimeConfig(ctx, workspaceID)
	resolvedEndpoint, builtinManaged := s.resolvedManagedMCPEndpoint(workspaceID, config)
	config.MCPEndpoint = resolvedEndpoint
	runtimeIntegration := buildRuntimeIntegration(runtimeConfig, config, s.configfs != nil, builtinManaged)

	checkedAt := time.Now().UTC().Format(time.RFC3339)
	result := StatusResult{
		ServiceEndpoint:    strings.TrimSpace(config.MCPEndpoint),
		LastCheckedAt:      checkedAt,
		RuntimeIntegration: &runtimeIntegration,
		Auth: &AuthState{
			Status: statusForOauthMode(config),
		},
	}

	checks := []StatusCheck{
		{
			Name:      "feishu_tools_enabled",
			Status:    ternaryStatus(config.Enabled, "configured", "disabled"),
			Detail:    ternaryText(config.Enabled, "Feishu tools are enabled for this workspace.", "Feishu tools are currently disabled."),
			CheckedAt: checkedAt,
		},
		{
			Name:      "app_credentials",
			Status:    credentialStatus(config),
			Detail:    credentialDetail(config),
			Hint:      "Configure App ID and App Secret before enabling write capabilities.",
			CheckedAt: checkedAt,
		},
		{
			Name:      "mcp_endpoint",
			Status:    ternaryStatus(strings.TrimSpace(config.MCPEndpoint) != "", "configured", "missing"),
			Detail:    ternaryText(strings.TrimSpace(config.MCPEndpoint) != "", config.MCPEndpoint, "The built-in Feishu MCP endpoint is not available yet."),
			Hint:      "codex-server now hosts the Feishu MCP adapter itself and writes the managed workspace endpoint automatically.",
			CheckedAt: checkedAt,
		},
		{
			Name:      "oauth_mode",
			Status:    ternaryStatus(config.OauthMode == OauthModeUserAuth, "user_oauth", "app_only"),
			Detail:    ternaryText(config.OauthMode == OauthModeUserAuth, "User OAuth is enabled for user-scoped tools.", "App-only mode is enabled. User-scoped tools will stay unavailable."),
			Hint:      "Use user_oauth for Docs, Calendar, Tasks, and message history tools.",
			CheckedAt: checkedAt,
		},
		{
			Name:      "tool_allowlist",
			Status:    ternaryStatus(len(config.ToolAllowlist) == 0, "default_all", "restricted"),
			Detail:    ternaryText(len(config.ToolAllowlist) == 0, "All modeled Feishu tools are available by default.", strings.Join(config.ToolAllowlist, ", ")),
			Hint:      "Restrict the allowlist when you want to expose only a subset of tools.",
			CheckedAt: checkedAt,
		},
		{
			Name:      "thread_runtime_integration",
			Status:    runtimeIntegration.Status,
			Detail:    runtimeIntegration.Detail,
			Hint:      "Saving Feishu settings manages workspace .codex/config.toml:mcp_servers.feishu-tools and reloads MCP servers so thread and bot-bound thread runtimes can discover Feishu tools.",
			CheckedAt: checkedAt,
		},
		{
			Name:      "bot_runtime_integration",
			Status:    ternaryStatus(runtimeIntegration.BotEnabled, "inherits_thread_tools", "unavailable"),
			Detail:    "Bots do not have a separate Feishu tool execution path; a bot can use Feishu tools only through the tools visible to its bound thread.",
			Hint:      "Bind the bot to a thread with Feishu MCP tools available if you want bot conversations to use them.",
			CheckedAt: checkedAt,
		},
	}

	result.Auth = s.authStatePtr(config)
	result.ConfigStatus = statusFromChecks(checks[0], checks[1], checks[2], checks[3])
	result.OauthStatus = result.Auth.Status
	result.Messages = buildStatusMessages(config)

	gatewayStatus := "not_checked"
	if s.catalog != nil {
		if mcpStatus, statusErr := s.catalog.ListMcpServerStatus(ctx, workspaceID); statusErr != nil {
			checks = append(checks, StatusCheck{
				Name:      "mcp_gateway",
				Status:    "unknown",
				Detail:    "MCP server status is unavailable.",
				Hint:      statusErr.Error(),
				CheckedAt: checkedAt,
			})
			gatewayStatus = "unknown"
		} else {
			status, detail := resolveGatewayStatus(config, mcpStatus.Data)
			checks = append(checks, StatusCheck{
				Name:      "mcp_gateway",
				Status:    status,
				Detail:    detail,
				CheckedAt: checkedAt,
			})
			gatewayStatus = status
		}
	}

	result.GatewayStatus = gatewayStatus
	result.Checks = checks
	result.OverallStatus = overallStatus(config, gatewayStatus, runtimeIntegration)

	return result, nil
}

func (s *Service) Capabilities(ctx context.Context, workspaceID string) (CapabilitiesResult, error) {
	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return CapabilitiesResult{}, err
	}

	categories := buildCapabilityCategories(config)
	summary := &CapabilitiesSummary{Stage: "phase_2"}
	for _, category := range categories {
		summary.EnabledCount += category.EnabledCount
		summary.TotalCount += category.TotalCount
	}

	return CapabilitiesResult{
		Categories: categories,
		Summary:    summary,
	}, nil
}

func (s *Service) Permissions(ctx context.Context, workspaceID string) (PermissionsResult, error) {
	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return PermissionsResult{}, err
	}

	return buildPermissions(config), nil
}

func (s *Service) OauthLogin(ctx context.Context, workspaceID string, scopes []string) (auth.McpOauthLoginResult, error) {
	return s.OauthLoginWithBaseURL(ctx, workspaceID, scopes, "")
}

func (s *Service) OauthLoginWithBaseURL(ctx context.Context, workspaceID string, scopes []string, baseURL string) (auth.McpOauthLoginResult, error) {
	if s == nil || s.oauth == nil {
		return auth.McpOauthLoginResult{}, fmt.Errorf("%w: feishu tools service is not initialized", ErrInvalidInput)
	}

	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return auth.McpOauthLoginResult{}, err
	}
	if !config.Enabled {
		return auth.McpOauthLoginResult{}, fmt.Errorf("%w: enable Feishu tools before starting OAuth", auth.ErrInvalidLoginInput)
	}
	if config.OauthMode != OauthModeUserAuth {
		return auth.McpOauthLoginResult{}, fmt.Errorf("%w: Feishu tools OAuth requires oauthMode=user_oauth", auth.ErrInvalidLoginInput)
	}
	if strings.TrimSpace(config.AppID) == "" {
		return auth.McpOauthLoginResult{}, fmt.Errorf("%w: configure feishu_app_id before starting OAuth", auth.ErrInvalidLoginInput)
	}
	if !config.AppSecretSet {
		return auth.McpOauthLoginResult{}, fmt.Errorf("%w: configure feishu_app_secret before starting OAuth", auth.ErrInvalidLoginInput)
	}

	redirectURI, err := s.callbackURL(baseURL)
	if err != nil {
		return auth.McpOauthLoginResult{}, err
	}

	requestedScopes := normalizeScopes(scopes)
	if len(requestedScopes) == 0 {
		requestedScopes = buildPermissions(config).RequiredScopes
	}

	authorizeURL, _, err := s.oauth.BuildAuthorizeURL(workspaceID, config.AppID, redirectURI, requestedScopes)
	if err != nil {
		return auth.McpOauthLoginResult{}, err
	}
	return auth.McpOauthLoginResult{AuthorizationURL: authorizeURL}, nil
}

// OauthCallbackResult captures the outcome of processing a Feishu OAuth
// redirect. Callers can use the redirect target to return the browser to the
// settings page.
type OauthCallbackResult struct {
	WorkspaceID   string   `json:"workspaceId"`
	Status        string   `json:"status"`
	GrantedScopes []string `json:"grantedScopes,omitempty"`
	OpenID        string   `json:"openId,omitempty"`
	RedirectTo    string   `json:"redirectTo,omitempty"`
}

// OauthCallback validates the state, exchanges the code for tokens, persists
// the resulting snapshot, and returns enough data for the caller to finish
// the browser redirect.
func (s *Service) OauthCallback(ctx context.Context, state string, code string) (OauthCallbackResult, error) {
	return s.OauthCallbackWithBaseURL(ctx, state, code, "")
}

func (s *Service) OauthCallbackWithBaseURL(ctx context.Context, state string, code string, baseURL string) (OauthCallbackResult, error) {
	if s == nil || s.oauth == nil {
		return OauthCallbackResult{}, fmt.Errorf("%w: feishu tools service is not initialized", ErrInvalidInput)
	}
	if strings.TrimSpace(code) == "" {
		return OauthCallbackResult{}, fmt.Errorf("%w: code is required", ErrInvalidInput)
	}

	entry, err := s.oauth.ConsumeState(state)
	if err != nil {
		return OauthCallbackResult{}, err
	}

	config, err := s.readConfig(ctx, entry.WorkspaceID)
	if err != nil {
		return OauthCallbackResult{}, err
	}
	if !config.Enabled || !config.AppSecretSet || strings.TrimSpace(config.AppID) == "" {
		return OauthCallbackResult{}, fmt.Errorf("%w: feishu tools configuration is incomplete", ErrInvalidInput)
	}

	snapshot, err := s.oauth.ExchangeCode(ctx, config.AppID, config.AppSecret, code, entry.RedirectURI)
	if err != nil {
		return OauthCallbackResult{}, err
	}

	if err := s.writeTokenSnapshot(ctx, entry.WorkspaceID, snapshot); err != nil {
		return OauthCallbackResult{}, err
	}

	status := "connected"
	if strings.TrimSpace(snapshot.RefreshToken) == "" {
		status = "connected_no_refresh"
	}

	return OauthCallbackResult{
		WorkspaceID:   entry.WorkspaceID,
		Status:        status,
		GrantedScopes: snapshot.Scopes,
		OpenID:        snapshot.OpenID,
		RedirectTo:    s.frontendSettingsURL(baseURL, entry.WorkspaceID),
	}, nil
}

// OauthStatus reports whether the workspace currently has a Feishu user token
// and when it expires.
func (s *Service) OauthStatus(ctx context.Context, workspaceID string) (AuthState, error) {
	return s.OauthStatusWithBaseURL(ctx, workspaceID, "")
}

func (s *Service) OauthStatusWithBaseURL(ctx context.Context, workspaceID string, baseURL string) (AuthState, error) {
	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return AuthState{}, err
	}
	return s.authStateFor(config, baseURL), nil
}

// OauthRevoke removes the persisted user token snapshot and best-effort asks
// Feishu to invalidate the remote session.
func (s *Service) OauthRevoke(ctx context.Context, workspaceID string) (AuthState, error) {
	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return AuthState{}, err
	}

	if s.oauth != nil && strings.TrimSpace(config.UserToken.AccessToken) != "" {
		// Best effort: never fail revoke because of a remote error; local state
		// is the source of truth for the workspace.
		_ = s.oauth.Revoke(ctx, config.UserToken.AccessToken)
	}

	if err := s.clearTokenSnapshot(ctx, workspaceID); err != nil {
		return AuthState{}, err
	}

	config.UserToken = OauthTokenSnapshot{}
	return s.authStateFor(config, ""), nil
}

func (s *Service) readConfig(ctx context.Context, workspaceID string) (Config, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return Config{}, fmt.Errorf("%w: workspace id is required", ErrInvalidInput)
	}

	if s.store != nil {
		if storedConfig, ok := s.store.GetFeishuToolsConfig(workspaceID); ok {
			config := configFromStore(storedConfig)
			if s.configfs == nil {
				return config, nil
			}

			result, err := s.configfs.ReadConfig(ctx, workspaceID, true)
			if err != nil {
				return config, nil
			}

			return s.overlayStoreConfigWithManagedMcpServerCompat(
				workspaceID,
				config,
				storedConfig,
				mergeConfigLayers(result.Config, result.Layers),
			), nil
		}
	}

	if s.configfs == nil {
		return defaultConfig(), nil
	}

	result, err := s.configfs.ReadConfig(ctx, workspaceID, true)
	if err != nil {
		return Config{}, err
	}

	return parseConfig(mergeConfigLayers(result.Config, result.Layers)), nil
}

func (s *Service) readRuntimeConfig(ctx context.Context, workspaceID string) (map[string]any, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return map[string]any{}, fmt.Errorf("%w: workspace id is required", ErrInvalidInput)
	}
	if s.configfs == nil {
		return map[string]any{}, nil
	}

	result, err := s.configfs.ReadConfig(ctx, workspaceID, true)
	if err != nil {
		return map[string]any{}, err
	}

	return cloneObjectMap(mergeConfigLayers(result.Config, result.Layers)), nil
}

func defaultConfig() Config {
	return Config{
		Enabled:             false,
		AppID:               "",
		AppSecretSet:        false,
		MCPEndpoint:         "",
		OauthMode:           OauthModeUserAuth,
		SensitiveWriteGuard: true,
		ToolAllowlist:       nil,
	}
}

func configFromStore(stored store.FeishuToolsConfig) Config {
	config := defaultConfig()
	config.Enabled = stored.Enabled
	config.AppID = strings.TrimSpace(stored.AppID)
	config.AppSecret = strings.TrimSpace(stored.AppSecret)
	config.AppSecretSet = config.AppSecret != ""
	config.MCPEndpoint = strings.TrimSpace(stored.MCPEndpoint)
	config.OauthMode = normalizeOauthMode(firstNonEmpty(strings.TrimSpace(stored.OauthMode), config.OauthMode))
	config.SensitiveWriteGuard = stored.SensitiveWriteGuard
	config.ToolAllowlist = normalizeToolAllowlist(stored.ToolAllowlist)
	if !stored.UpdatedAt.IsZero() {
		config.UpdatedAt = stored.UpdatedAt.UTC().Format(time.RFC3339)
	}
	config.UserToken = tokenSnapshotFromStore(stored.UserToken)
	return config
}

func tokenSnapshotFromStore(stored store.FeishuUserToken) OauthTokenSnapshot {
	snapshot := OauthTokenSnapshot{
		AccessToken:  strings.TrimSpace(stored.AccessToken),
		RefreshToken: strings.TrimSpace(stored.RefreshToken),
		Scopes:       normalizeScopes(stored.Scopes),
		OpenID:       strings.TrimSpace(stored.OpenID),
		UnionID:      strings.TrimSpace(stored.UnionID),
	}
	if stored.AccessTokenExpiresAt != nil {
		snapshot.AccessTokenExpiresAt = stored.AccessTokenExpiresAt.UTC()
	}
	if stored.RefreshTokenExpiresAt != nil {
		snapshot.RefreshTokenExpiresAt = stored.RefreshTokenExpiresAt.UTC()
	}
	if stored.ObtainedAt != nil {
		snapshot.ObtainedAt = stored.ObtainedAt.UTC()
	}
	return snapshot
}

func storeTokenSnapshot(snapshot OauthTokenSnapshot) store.FeishuUserToken {
	stored := store.FeishuUserToken{
		AccessToken:  strings.TrimSpace(snapshot.AccessToken),
		RefreshToken: strings.TrimSpace(snapshot.RefreshToken),
		Scopes:       normalizeScopes(snapshot.Scopes),
		OpenID:       strings.TrimSpace(snapshot.OpenID),
		UnionID:      strings.TrimSpace(snapshot.UnionID),
	}
	if !snapshot.AccessTokenExpiresAt.IsZero() {
		value := snapshot.AccessTokenExpiresAt.UTC()
		stored.AccessTokenExpiresAt = &value
	}
	if !snapshot.RefreshTokenExpiresAt.IsZero() {
		value := snapshot.RefreshTokenExpiresAt.UTC()
		stored.RefreshTokenExpiresAt = &value
	}
	if !snapshot.ObtainedAt.IsZero() {
		value := snapshot.ObtainedAt.UTC()
		stored.ObtainedAt = &value
	}
	return stored
}

func (s *Service) resolvedManagedMCPEndpoint(workspaceID string, config Config) (string, bool) {
	if s == nil {
		return strings.TrimSpace(config.MCPEndpoint), false
	}
	if strings.TrimSpace(config.MCPEndpoint) != "" {
		return strings.TrimSpace(config.MCPEndpoint), false
	}
	if s.store == nil {
		return "", false
	}
	stored, ok := s.store.GetFeishuToolsConfig(workspaceID)
	if !ok {
		return "", false
	}
	return s.resolvedManagedMCPEndpointFromToken(workspaceID, config, stored.ManagedMCPAuthToken)
}

func (s *Service) resolvedManagedMCPEndpointFromToken(workspaceID string, config Config, authToken string) (string, bool) {
	override := strings.TrimSpace(config.MCPEndpoint)
	if override != "" {
		return override, false
	}
	baseURL := strings.TrimRight(strings.TrimSpace(s.runtimeBaseURL), "/")
	authToken = strings.TrimSpace(authToken)
	if baseURL == "" || authToken == "" {
		return "", false
	}
	return fmt.Sprintf(
		"%s/api/feishu-tools/mcp/%s?token=%s",
		baseURL,
		url.PathEscape(strings.TrimSpace(workspaceID)),
		url.QueryEscape(authToken),
	), true
}

func (s *Service) generatedManagedMCPEndpoint(workspaceID string) string {
	if s == nil || s.store == nil {
		return ""
	}
	stored, ok := s.store.GetFeishuToolsConfig(workspaceID)
	if !ok {
		return ""
	}
	endpoint, _ := s.resolvedManagedMCPEndpointFromToken(workspaceID, Config{}, stored.ManagedMCPAuthToken)
	return endpoint
}

func (s *Service) ValidateManagedMCPToken(workspaceID string, token string) bool {
	if s == nil || s.store == nil {
		return false
	}
	stored, ok := s.store.GetFeishuToolsConfig(workspaceID)
	if !ok {
		return false
	}
	expected := strings.TrimSpace(stored.ManagedMCPAuthToken)
	return expected != "" && subtleConstantTimeEqual(expected, strings.TrimSpace(token))
}

func subtleConstantTimeEqual(left string, right string) bool {
	if len(left) == 0 || len(right) == 0 {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(left), []byte(right)) == 1
}

func parseConfig(raw map[string]any) Config {
	config := defaultConfig()
	if raw == nil {
		return config
	}
	managedEntry := managedMcpServerCompatEntry(raw)

	config.Enabled = boolValue(raw["feishu_tools_enabled"], config.Enabled)
	if !hasNestedKey(raw, "feishu_tools_enabled") && !hasNestedKey(raw, "feishu_tools", "enabled") {
		if enabled, ok := boolConfigValue(managedEntry["enabled"]); ok {
			config.Enabled = enabled
		} else if len(managedEntry) > 0 {
			config.Enabled = true
		}
	}
	config.AppID = firstNonEmpty(
		stringValue(raw["feishu_app_id"]),
		stringValue(nestedValue(raw, "feishu_tools", "app_id")),
	)
	appSecret := firstNonEmpty(
		stringValue(raw["feishu_app_secret"]),
		stringValue(nestedValue(raw, "feishu_tools", "app_secret")),
	)
	config.AppSecret = appSecret
	config.AppSecretSet = strings.TrimSpace(appSecret) != ""
	config.UserToken = parseUserTokenSnapshot(raw)
	config.MCPEndpoint = firstNonEmpty(
		stringValue(raw["feishu_mcp_endpoint"]),
		stringValue(nestedValue(raw, "feishu_tools", "mcp_endpoint")),
	)
	config.OauthMode = normalizeOauthMode(firstNonEmpty(
		stringValue(raw["feishu_oauth_mode"]),
		stringValue(nestedValue(raw, "feishu_tools", "oauth_mode")),
		config.OauthMode,
	))
	config.SensitiveWriteGuard = boolValue(
		firstDefined(raw["feishu_sensitive_write_guard"], nestedValue(raw, "feishu_tools", "sensitive_write_guard")),
		config.SensitiveWriteGuard,
	)
	config.ToolAllowlist = normalizeToolAllowlist(firstSlice(
		stringSliceValue(raw["feishu_tool_allowlist"]),
		stringSliceValue(nestedValue(raw, "feishu_tools", "tool_allowlist")),
	))
	if !hasNestedKey(raw, "feishu_tool_allowlist") && !hasNestedKey(raw, "feishu_tools", "tool_allowlist") {
		if allowlist, ok := managedMcpServerToolAllowlist(managedEntry); ok {
			config.ToolAllowlist = allowlist
		}
	}

	return config
}

func mergeConfigLayers(base map[string]any, layers []any) map[string]any {
	merged := cloneConfigMap(base)
	for index := len(layers) - 1; index >= 0; index-- {
		layer, ok := layers[index].(map[string]any)
		if !ok {
			continue
		}
		configMap, ok := layer["config"].(map[string]any)
		if !ok {
			continue
		}
		merged = mergeConfigMapRecursive(merged, configMap)
	}
	return merged
}

func mergeConfigMapRecursive(base map[string]any, overlay map[string]any) map[string]any {
	if base == nil && overlay == nil {
		return nil
	}
	result := cloneConfigMap(base)
	for key, value := range overlay {
		existingMap, existingIsMap := result[key].(map[string]any)
		valueMap, valueIsMap := value.(map[string]any)
		if existingIsMap && valueIsMap {
			result[key] = mergeConfigMapRecursive(existingMap, valueMap)
			continue
		}
		result[key] = value
	}
	return result
}

func cloneConfigMap(input map[string]any) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	output := make(map[string]any, len(input))
	for key, value := range input {
		nested, ok := value.(map[string]any)
		if ok {
			output[key] = cloneConfigMap(nested)
			continue
		}
		output[key] = value
	}
	return output
}

func normalizeInput(input ConfigInput) (Config, error) {
	config := Config{
		Enabled:             input.Enabled,
		AppID:               strings.TrimSpace(input.AppID),
		AppSecret:           strings.TrimSpace(input.AppSecret),
		MCPEndpoint:         strings.TrimSpace(input.MCPEndpoint),
		OauthMode:           normalizeOauthMode(input.OauthMode),
		SensitiveWriteGuard: input.SensitiveWriteGuard,
		ToolAllowlist:       normalizeToolAllowlist(input.ToolAllowlist),
	}
	config.AppSecretSet = config.AppSecret != ""

	if config.OauthMode != OauthModeAppOnly && config.OauthMode != OauthModeUserAuth {
		return Config{}, fmt.Errorf("%w: unsupported oauth mode", ErrInvalidInput)
	}

	for _, toolName := range config.ToolAllowlist {
		if _, ok := toolDefinitions[toolName]; !ok {
			return Config{}, fmt.Errorf("%w: unknown tool %s", ErrInvalidInput, toolName)
		}
	}

	return Config{
		Enabled:             config.Enabled,
		AppID:               config.AppID,
		AppSecret:           config.AppSecret,
		AppSecretSet:        config.AppSecretSet,
		MCPEndpoint:         config.MCPEndpoint,
		OauthMode:           config.OauthMode,
		SensitiveWriteGuard: config.SensitiveWriteGuard,
		ToolAllowlist:       config.ToolAllowlist,
	}, nil
}

func buildCapabilityCategories(config Config) []CapabilityCategory {
	categories := make([]CapabilityCategory, 0, len(capabilityCategories))
	for _, category := range capabilityCategories {
		items := make([]CapabilityItem, 0, len(category.ToolNames))
		enabledCount := 0
		for _, toolName := range category.ToolNames {
			definition, ok := toolDefinitions[toolName]
			if !ok {
				continue
			}
			enabled := config.Enabled && toolEnabled(config, toolName)
			if enabled {
				enabledCount++
			}
			items = append(items, CapabilityItem{
				ToolName:       definition.ToolName,
				Title:          definition.Title,
				Description:    definition.Description,
				Enabled:        enabled,
				Stage:          definition.Stage,
				RequiredScopes: collectScopes(definition.ActionKeys),
				RiskLevel:      definition.RiskLevel,
			})
		}
		categories = append(categories, CapabilityCategory{
			ID:           category.ID,
			Title:        category.Title,
			Description:  category.Description,
			EnabledCount: enabledCount,
			TotalCount:   len(items),
			Items:        items,
		})
	}

	return categories
}

func buildPermissions(config Config) PermissionsResult {
	scopeTools := make(map[string]map[string]struct{})
	requiredSet := make(map[string]struct{})
	sensitiveSet := make(map[string]struct{})
	grantedScopes := normalizeScopes(config.UserToken.Scopes)

	for _, scope := range requiredAppScopes {
		requiredSet[scope] = struct{}{}
	}
	requiredSet[oauthOfflineAccessScope] = struct{}{}

	for _, toolName := range enabledOrDefaultTools(config) {
		definition, ok := toolDefinitions[toolName]
		if !ok {
			continue
		}
		for _, scope := range collectScopes(definition.ActionKeys) {
			requiredSet[scope] = struct{}{}
			tools := scopeTools[scope]
			if tools == nil {
				tools = make(map[string]struct{})
				scopeTools[scope] = tools
			}
			tools[toolName] = struct{}{}
		}
	}

	items := make([]PermissionItem, 0, len(requiredSet))
	requiredScopes := sortedKeys(requiredSet)
	missingScopes := make([]string, 0, len(requiredScopes))

	for _, scope := range requiredScopes {
		status := permissionStatus(config, scope, grantedScopes)
		item := PermissionItem{
			Scope:     scope,
			Status:    status,
			Source:    permissionSource(scope),
			Reason:    permissionReason(config, scope, status),
			Tools:     sortedKeys(scopeTools[scope]),
			Sensitive: isSensitiveScope(scope),
		}
		if item.Sensitive {
			sensitiveSet[scope] = struct{}{}
		}
		if status == "missing" || (status == "pending_authorization" && !isRequiredAppScope(scope)) {
			missingScopes = append(missingScopes, scope)
		}
		items = append(items, item)
	}

	return PermissionsResult{
		OverallStatus:   permissionOverallStatus(config, missingScopes),
		RequiredScopes:  requiredScopes,
		GrantedScopes:   grantedScopes,
		MissingScopes:   missingScopes,
		SensitiveScopes: sortedKeys(sensitiveSet),
		Suggestions:     buildPermissionSuggestions(config),
		Items:           items,
	}
}

func resolveGatewayStatus(config Config, data []map[string]any) (string, string) {
	if !config.Enabled {
		return "disabled", "Feishu tools are disabled."
	}
	if strings.TrimSpace(config.MCPEndpoint) == "" {
		return "missing", "Built-in Feishu MCP endpoint is unavailable."
	}

	for _, item := range data {
		name := strings.ToLower(strings.TrimSpace(firstNonEmpty(
			stringValue(item["name"]),
			stringValue(item["id"]),
			stringValue(item["serverName"]),
		)))
		if name == "" {
			continue
		}
		if !strings.Contains(name, "feishu") && !strings.Contains(name, "lark") {
			continue
		}
		status := firstNonEmpty(
			stringValue(item["status"]),
			stringValue(item["health"]),
			"configured",
		)
		detail := firstNonEmpty(
			stringValue(item["message"]),
			stringValue(item["detail"]),
			"MCP server status matched a Feishu-related entry.",
		)
		return strings.TrimSpace(status), detail
	}

	return "configured", "Feishu MCP endpoint is configured, but no Feishu-specific MCP status entry was found."
}

func overallStatus(config Config, gatewayStatus string, runtimeIntegration RuntimeIntegration) string {
	if !config.Enabled {
		return "disabled"
	}
	if !hasCredentials(config) || strings.TrimSpace(config.MCPEndpoint) == "" {
		return "attention_required"
	}
	switch runtimeIntegration.Status {
	case "sync_required", "sync_failed", "reload_failed", "unavailable":
		return "attention_required"
	}
	if config.OauthMode == OauthModeUserAuth {
		return "pending_authorization"
	}
	if gatewayStatus == "unknown" {
		return "configured"
	}
	return "configured"
}

func permissionOverallStatus(config Config, missingScopes []string) string {
	if !config.Enabled {
		return "disabled"
	}
	if !hasCredentials(config) || strings.TrimSpace(config.MCPEndpoint) == "" {
		return "attention_required"
	}
	if config.OauthMode != OauthModeUserAuth {
		return "attention_required"
	}
	if config.UserToken.Connected() && strings.TrimSpace(config.UserToken.RefreshToken) == "" {
		return "pending_authorization"
	}
	if config.UserToken.Connected() && len(missingScopes) == 0 {
		return "configured"
	}
	return "pending_authorization"
}

func buildStatusMessages(config Config) []string {
	messages := make([]string, 0, 4)
	if !config.Enabled {
		messages = append(messages, "Enable Feishu tools to expose workspace-scoped Feishu capabilities.")
	}
	if !hasCredentials(config) {
		messages = append(messages, "App ID and App Secret are required before Feishu tools can authenticate.")
	}
	if strings.TrimSpace(config.MCPEndpoint) == "" {
		messages = append(messages, "Built-in Feishu MCP endpoint is not available yet, so threads cannot discover Feishu tools.")
	}
	if config.Enabled && config.OauthMode != OauthModeUserAuth {
		messages = append(messages, "Switch to user_oauth if you want Docs, Calendar, Tasks, or message history tools.")
	}
	return messages
}

func buildPermissionSuggestions(config Config) []string {
	suggestions := make([]string, 0, 5)
	if !config.Enabled {
		suggestions = append(suggestions, "Enable Feishu tools for this workspace.")
	}
	if !hasCredentials(config) {
		suggestions = append(suggestions, "Set both App ID and App Secret.")
	}
	if strings.TrimSpace(config.MCPEndpoint) == "" {
		suggestions = append(suggestions, "Make sure the built-in Feishu MCP endpoint is available before turning on Docs tools.")
	}
	if config.OauthMode != OauthModeUserAuth {
		suggestions = append(suggestions, "Change oauthMode to user_oauth for user-scoped tools.")
	} else if config.Enabled {
		suggestions = append(suggestions, "Start Feishu OAuth after the built-in MCP server is available.")
	}
	if config.UserToken.Connected() && strings.TrimSpace(config.UserToken.RefreshToken) == "" {
		suggestions = append(suggestions, "Re-run Feishu OAuth with offline_access so the workspace can store a refresh token.")
	}
	if config.SensitiveWriteGuard {
		suggestions = append(suggestions, "Keep sensitive write guard enabled until production scopes are verified.")
	}
	return suggestions
}

func enabledOrDefaultTools(config Config) []string {
	if !config.Enabled {
		return nil
	}
	if len(config.ToolAllowlist) > 0 {
		return append([]string(nil), config.ToolAllowlist...)
	}

	tools := make([]string, 0, len(toolDefinitions))
	for _, category := range capabilityCategories {
		for _, toolName := range category.ToolNames {
			tools = append(tools, toolName)
		}
	}
	return tools
}

func toolEnabled(config Config, toolName string) bool {
	if len(config.ToolAllowlist) == 0 {
		return true
	}
	for _, allowed := range config.ToolAllowlist {
		if allowed == toolName {
			return true
		}
	}
	return false
}

func collectScopes(actionKeys []string) []string {
	set := make(map[string]struct{})
	for _, key := range actionKeys {
		for _, scope := range toolActionScopes[key] {
			set[normalizeScopeKey(scope)] = struct{}{}
		}
	}
	return sortedKeys(set)
}

func normalizeScopes(scopes []string) []string {
	set := make(map[string]struct{})
	for _, scope := range scopes {
		trimmed := normalizeScopeKey(scope)
		if trimmed == "" {
			continue
		}
		set[trimmed] = struct{}{}
	}
	return sortedKeys(set)
}

func hasScope(scopes []string, target string) bool {
	for _, scope := range scopes {
		if sameScope(scope, target) {
			return true
		}
	}
	return false
}

func sameScope(left string, right string) bool {
	return normalizeScopeKey(left) == normalizeScopeKey(right)
}

func normalizeScopeKey(scope string) string {
	trimmed := strings.TrimSpace(scope)
	switch trimmed {
	case "im:message:send_as_user":
		return "im:message.send_as_user"
	default:
		return trimmed
	}
}

func normalizeToolAllowlist(values []string) []string {
	set := make(map[string]struct{})
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		set[trimmed] = struct{}{}
	}
	return sortedKeys(set)
}

func normalizeOauthMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case OauthModeAppOnly:
		return OauthModeAppOnly
	default:
		return OauthModeUserAuth
	}
}

func hasCredentials(config Config) bool {
	return strings.TrimSpace(config.AppID) != "" && config.AppSecretSet
}

func credentialStatus(config Config) string {
	if !config.Enabled {
		return "disabled"
	}
	if hasCredentials(config) {
		return "configured"
	}
	return "missing"
}

func credentialDetail(config Config) string {
	if hasCredentials(config) {
		return "App ID and App Secret are configured."
	}
	return "App ID or App Secret is missing."
}

func statusForOauthMode(config Config) string {
	if !config.Enabled {
		return "disabled"
	}
	if config.OauthMode == OauthModeAppOnly {
		return "app_only"
	}
	return "not_connected"
}

func permissionStatus(config Config, scope string, grantedScopes []string) string {
	if !config.Enabled {
		return "disabled"
	}
	if isRequiredAppScope(scope) {
		if hasCredentials(config) {
			return "configured_not_verified"
		}
		return "missing_config"
	}
	if config.OauthMode != OauthModeUserAuth {
		return "requires_user_oauth"
	}
	if !config.UserToken.Connected() {
		return "pending_authorization"
	}
	if hasScope(grantedScopes, scope) {
		return "granted"
	}
	return "missing"
}

func permissionReason(config Config, scope string, status string) string {
	switch status {
	case "disabled":
		return "Feishu tools are disabled for this workspace."
	case "missing_config":
		return "App credentials are required before app-scoped permissions can be verified."
	case "configured_not_verified":
		return "The workspace configuration is present, but scope verification is not connected yet."
	case "requires_user_oauth":
		if isRequiredOauthScope(scope) {
			return "Refresh-token support requires oauthMode=user_oauth."
		}
		return "This permission is user-scoped and needs oauthMode=user_oauth."
	case "pending_authorization":
		if isRequiredOauthScope(scope) {
			return "The workspace still needs offline_access so Feishu can issue and rotate refresh tokens."
		}
		if isSensitiveScope(scope) && config.SensitiveWriteGuard {
			return "This is a sensitive scope and should stay guarded until explicitly approved."
		}
		return "User authorization still needs to be completed."
	case "granted":
		if isRequiredOauthScope(scope) {
			return "This OAuth scope enables refresh-token issuance for the workspace session."
		}
		return "This scope is present in the current Feishu user authorization."
	case "missing":
		if isRequiredOauthScope(scope) {
			return "The current Feishu OAuth session does not include offline_access, so no refresh token is available."
		}
		if isSensitiveScope(scope) && config.SensitiveWriteGuard {
			return "This sensitive scope is not granted while sensitive write guard remains enabled."
		}
		return "The current Feishu user authorization does not include this scope."
	default:
		return ""
	}
}

func permissionSource(scope string) string {
	if isRequiredAppScope(scope) {
		return "required_app_scope"
	}
	if isRequiredOauthScope(scope) {
		return "oauth_core_scope"
	}
	return "user_scope"
}

func isRequiredAppScope(scope string) bool {
	for _, item := range requiredAppScopes {
		if sameScope(item, scope) {
			return true
		}
	}
	return false
}

func isRequiredOauthScope(scope string) bool {
	return sameScope(scope, oauthOfflineAccessScope)
}

func isSensitiveScope(scope string) bool {
	for _, item := range sensitiveScopes {
		if sameScope(item, scope) {
			return true
		}
	}
	return false
}

func statusFromChecks(checks ...StatusCheck) string {
	for _, check := range checks {
		if check.Status == "missing" || check.Status == "disabled" {
			return "attention_required"
		}
	}
	return "configured"
}

func ternaryStatus(ok bool, ifTrue string, ifFalse string) string {
	if ok {
		return ifTrue
	}
	return ifFalse
}

func ternaryText(ok bool, ifTrue string, ifFalse string) string {
	if ok {
		return ifTrue
	}
	return ifFalse
}

func sortedKeys[T any](input map[string]T) []string {
	if len(input) == 0 {
		return nil
	}
	items := make([]string, 0, len(input))
	for key := range input {
		items = append(items, key)
	}
	sort.Strings(items)
	return items
}

func stringValue(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return strings.TrimSpace(typed)
}

func stringSliceValue(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		items := make([]string, 0, len(typed))
		for _, item := range typed {
			text := stringValue(item)
			if text == "" {
				continue
			}
			items = append(items, text)
		}
		return items
	case string:
		if strings.TrimSpace(typed) == "" {
			return nil
		}
		parts := strings.FieldsFunc(typed, func(r rune) bool {
			return r == ',' || r == '\n'
		})
		items := make([]string, 0, len(parts))
		for _, part := range parts {
			text := strings.TrimSpace(part)
			if text == "" {
				continue
			}
			items = append(items, text)
		}
		return items
	default:
		return nil
	}
}

func boolValue(value any, fallback bool) bool {
	switch typed := value.(type) {
	case bool:
		return typed
	case string:
		normalized := strings.ToLower(strings.TrimSpace(typed))
		switch normalized {
		case "true", "1", "yes", "on":
			return true
		case "false", "0", "no", "off":
			return false
		default:
			return fallback
		}
	default:
		return fallback
	}
}

func boolConfigValue(value any) (bool, bool) {
	switch typed := value.(type) {
	case bool:
		return typed, true
	case string:
		switch strings.ToLower(strings.TrimSpace(typed)) {
		case "true", "1", "yes", "on":
			return true, true
		case "false", "0", "no", "off":
			return false, true
		default:
			return false, false
		}
	default:
		return false, false
	}
}

func nestedValue(root map[string]any, keys ...string) any {
	if root == nil || len(keys) == 0 {
		return nil
	}
	current := any(root)
	for _, key := range keys {
		object, ok := current.(map[string]any)
		if !ok {
			return nil
		}
		current = object[key]
	}
	return current
}

func hasNestedKey(root map[string]any, keys ...string) bool {
	if root == nil || len(keys) == 0 {
		return false
	}

	current := root
	for index, key := range keys {
		value, ok := current[key]
		if !ok {
			return false
		}
		if index == len(keys)-1 {
			return true
		}
		next, ok := value.(map[string]any)
		if !ok {
			return false
		}
		current = next
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstDefined(values ...any) any {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func firstSlice(values ...[]string) []string {
	for _, value := range values {
		if len(value) > 0 {
			return value
		}
	}
	return nil
}

// callbackURL derives the Feishu OAuth redirect target from the browser-facing
// frontend origin when available. In local development the frontend dev server
// proxies /api requests back to the backend, so the callback should still use
// the frontend address the user sees in the browser.
func (s *Service) callbackURL(baseURL string) (string, error) {
	base := strings.TrimSpace(s.resolveCallbackBaseURL(baseURL))
	if base == "" {
		return "", fmt.Errorf("%w: frontend origin is not configured; configure CODEX_FRONTEND_ORIGIN or access the app through a stable local URL", ErrInvalidInput)
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return "", fmt.Errorf("%w: invalid callback base URL: %v", ErrInvalidInput, err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("%w: callback base URL must include scheme and host", ErrInvalidInput)
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + callbackPathTemplate
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String(), nil
}

// frontendSettingsURL returns the browser URL that the callback handler should
// redirect to after completing the flow. It falls back to the callback's
// origin when no custom frontend is configured.
func (s *Service) frontendSettingsURL(baseURL string, workspaceID string) string {
	base := strings.TrimSpace(s.resolveFrontendBaseURL(baseURL))
	if base == "" {
		return ""
	}
	parsed, err := url.Parse(base)
	if err != nil {
		return ""
	}
	parsed.Path = strings.TrimRight(parsed.Path, "/") + "/settings/feishu-tools"
	query := parsed.Query()
	query.Set("feishuOauth", "completed")
	if strings.TrimSpace(workspaceID) != "" {
		query.Set("workspaceId", workspaceID)
	}
	parsed.RawQuery = query.Encode()
	parsed.Fragment = ""
	return parsed.String()
}

func (s *Service) resolveCallbackBaseURL(requestBaseURL string) string {
	if frontendBase := strings.TrimSpace(s.resolveFrontendBaseURL(requestBaseURL)); frontendBase != "" {
		return frontendBase
	}
	if publicBase := strings.TrimSpace(s.publicBaseURL); publicBase != "" {
		return publicBase
	}
	return strings.TrimSpace(requestBaseURL)
}

func (s *Service) resolveFrontendBaseURL(requestBaseURL string) string {
	requestBaseURL = strings.TrimSpace(requestBaseURL)
	configured := strings.TrimSpace(s.frontendOrigin)
	if configured == "" {
		return ""
	}

	parsedConfigured, err := url.Parse(configured)
	if err != nil || parsedConfigured.Scheme == "" || parsedConfigured.Host == "" {
		return configured
	}

	hostname := strings.TrimSpace(parsedConfigured.Hostname())
	if hostname == "" || (hostname != "0.0.0.0" && hostname != "::") {
		return parsedConfigured.String()
	}

	if requestBaseURL == "" {
		parsedConfigured.Host = net.JoinHostPort("localhost", effectivePort(parsedConfigured))
		return parsedConfigured.String()
	}

	parsedRequest, err := url.Parse(requestBaseURL)
	if err != nil || parsedRequest.Host == "" {
		parsedConfigured.Host = net.JoinHostPort("localhost", effectivePort(parsedConfigured))
		return parsedConfigured.String()
	}

	requestHost := strings.TrimSpace(parsedRequest.Hostname())
	if requestHost == "" {
		requestHost = "localhost"
	}
	parsedConfigured.Host = net.JoinHostPort(requestHost, effectivePort(parsedConfigured))
	return parsedConfigured.String()
}

func effectivePort(parsed *url.URL) string {
	if parsed == nil {
		return ""
	}
	if port := strings.TrimSpace(parsed.Port()); port != "" {
		return port
	}
	if strings.EqualFold(strings.TrimSpace(parsed.Scheme), "https") {
		return "443"
	}
	return "80"
}

func (s *Service) authStatePtr(config Config) *AuthState {
	state := s.authStateFor(config, "")
	return &state
}

func (s *Service) authStateFor(config Config, baseURL string) AuthState {
	state := AuthState{
		Status: statusForOauthMode(config),
	}
	if callback, err := s.callbackURL(baseURL); err == nil {
		state.CallbackURL = callback
	}
	if !config.UserToken.Connected() {
		return state
	}

	now := time.Now().UTC()
	switch {
	case config.UserToken.IsAccessTokenValid(now):
		if strings.TrimSpace(config.UserToken.RefreshToken) == "" {
			state.Status = "connected_no_refresh"
		} else {
			state.Status = "connected"
		}
	case config.UserToken.IsRefreshTokenValid(now):
		state.Status = "refresh_required"
	default:
		state.Status = "expired"
	}
	state.PrincipalType = "user"
	state.OpenID = config.UserToken.OpenID
	state.UnionID = config.UserToken.UnionID
	state.AccountID = config.UserToken.OpenID
	state.HasAccessToken = strings.TrimSpace(config.UserToken.AccessToken) != ""
	state.HasRefreshToken = strings.TrimSpace(config.UserToken.RefreshToken) != ""
	state.AccessTokenPreview = maskTokenPreview(config.UserToken.AccessToken)
	state.RefreshTokenPreview = maskTokenPreview(config.UserToken.RefreshToken)
	state.GrantedScopes = append([]string(nil), config.UserToken.Scopes...)
	if !config.UserToken.ObtainedAt.IsZero() {
		state.ObtainedAt = config.UserToken.ObtainedAt.UTC().Format(time.RFC3339)
	}
	if !config.UserToken.AccessTokenExpiresAt.IsZero() {
		state.ExpiresAt = config.UserToken.AccessTokenExpiresAt.UTC().Format(time.RFC3339)
	}
	if !config.UserToken.RefreshTokenExpiresAt.IsZero() {
		state.RefreshExpires = config.UserToken.RefreshTokenExpiresAt.UTC().Format(time.RFC3339)
	}
	return state
}

func maskTokenPreview(token string) string {
	trimmed := strings.TrimSpace(token)
	if trimmed == "" {
		return ""
	}
	if len(trimmed) <= 10 {
		if len(trimmed) <= 4 {
			return strings.Repeat("*", len(trimmed))
		}
		return trimmed[:2] + strings.Repeat("*", len(trimmed)-4) + trimmed[len(trimmed)-2:]
	}
	return trimmed[:6] + "..." + trimmed[len(trimmed)-4:]
}

const (
	feishuUserAccessTokenKey           = "feishu_user_access_token"
	feishuUserRefreshTokenKey          = "feishu_user_refresh_token"
	feishuUserAccessTokenExpiresAtKey  = "feishu_user_access_token_expires_at"
	feishuUserRefreshTokenExpiresAtKey = "feishu_user_refresh_token_expires_at"
	feishuUserScopesKey                = "feishu_user_scopes"
	feishuUserOpenIDKey                = "feishu_user_open_id"
	feishuUserUnionIDKey               = "feishu_user_union_id"
	feishuUserTokenObtainedAtKey       = "feishu_user_token_obtained_at"
)

func parseUserTokenSnapshot(raw map[string]any) OauthTokenSnapshot {
	if raw == nil {
		return OauthTokenSnapshot{}
	}
	snapshot := OauthTokenSnapshot{
		AccessToken:  firstNonEmpty(stringValue(raw[feishuUserAccessTokenKey]), stringValue(nestedValue(raw, "feishu_tools", "user_access_token"))),
		RefreshToken: firstNonEmpty(stringValue(raw[feishuUserRefreshTokenKey]), stringValue(nestedValue(raw, "feishu_tools", "user_refresh_token"))),
		OpenID:       firstNonEmpty(stringValue(raw[feishuUserOpenIDKey]), stringValue(nestedValue(raw, "feishu_tools", "user_open_id"))),
		UnionID:      firstNonEmpty(stringValue(raw[feishuUserUnionIDKey]), stringValue(nestedValue(raw, "feishu_tools", "user_union_id"))),
		Scopes: normalizeScopes(firstSlice(
			stringSliceValue(raw[feishuUserScopesKey]),
			stringSliceValue(nestedValue(raw, "feishu_tools", "user_scopes")),
		)),
		AccessTokenExpiresAt:  parseTimeValue(firstNonEmpty(stringValue(raw[feishuUserAccessTokenExpiresAtKey]), stringValue(nestedValue(raw, "feishu_tools", "user_access_token_expires_at")))),
		RefreshTokenExpiresAt: parseTimeValue(firstNonEmpty(stringValue(raw[feishuUserRefreshTokenExpiresAtKey]), stringValue(nestedValue(raw, "feishu_tools", "user_refresh_token_expires_at")))),
		ObtainedAt:            parseTimeValue(firstNonEmpty(stringValue(raw[feishuUserTokenObtainedAtKey]), stringValue(nestedValue(raw, "feishu_tools", "user_token_obtained_at")))),
	}
	return snapshot
}

func parseTimeValue(value string) time.Time {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, trimmed)
	if err != nil {
		return time.Time{}
	}
	return parsed.UTC()
}

func (s *Service) writeTokenSnapshot(ctx context.Context, workspaceID string, snapshot OauthTokenSnapshot) error {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return fmt.Errorf("%w: workspace id is required", ErrInvalidInput)
	}

	if s.store != nil {
		current := store.FeishuToolsConfig{
			WorkspaceID: workspaceID,
			OauthMode:   OauthModeUserAuth,
		}
		if existing, ok := s.store.GetFeishuToolsConfig(workspaceID); ok {
			current = existing
		}
		current.UserToken = storeTokenSnapshot(snapshot)
		current.UpdatedAt = time.Now().UTC()
		_, err := s.store.SetFeishuToolsConfig(current)
		return err
	}

	if s.configfs == nil {
		return fmt.Errorf("%w: config service is unavailable", ErrInvalidInput)
	}

	edits := []map[string]any{
		configEdit(feishuUserAccessTokenKey, snapshot.AccessToken),
		configEdit(feishuUserRefreshTokenKey, snapshot.RefreshToken),
		configEdit(feishuUserAccessTokenExpiresAtKey, formatTimeValue(snapshot.AccessTokenExpiresAt)),
		configEdit(feishuUserRefreshTokenExpiresAtKey, formatTimeValue(snapshot.RefreshTokenExpiresAt)),
		configEdit(feishuUserScopesKey, snapshot.Scopes),
		configEdit(feishuUserOpenIDKey, snapshot.OpenID),
		configEdit(feishuUserUnionIDKey, snapshot.UnionID),
		configEdit(feishuUserTokenObtainedAtKey, formatTimeValue(snapshot.ObtainedAt)),
	}
	_, err := s.configfs.BatchWriteConfig(ctx, workspaceID, "", edits, true)
	return err
}

func (s *Service) clearTokenSnapshot(ctx context.Context, workspaceID string) error {
	return s.writeTokenSnapshot(ctx, workspaceID, OauthTokenSnapshot{})
}

func formatTimeValue(value time.Time) string {
	if value.IsZero() {
		return ""
	}
	return value.UTC().Format(time.RFC3339)
}

func configEdit(keyPath string, value any) map[string]any {
	return map[string]any{
		"keyPath":       keyPath,
		"mergeStrategy": "upsert",
		"value":         value,
	}
}

func (s *Service) readWorkspaceConfigFile(workspaceID string) map[string]any {
	configPath, err := s.workspaceConfigPath(workspaceID)
	if err != nil {
		return map[string]any{}
	}

	content, err := os.ReadFile(configPath)
	if err != nil {
		return map[string]any{}
	}

	data := make(map[string]any)
	if err := toml.Unmarshal(content, &data); err != nil {
		return map[string]any{}
	}
	return data
}

func (s *Service) writeWorkspaceManagedMcpServers(workspaceID string, managedServers map[string]any) error {
	configPath, err := s.workspaceConfigPath(workspaceID)
	if err != nil {
		return err
	}

	data := make(map[string]any)
	if content, readErr := os.ReadFile(configPath); readErr == nil {
		if err := toml.Unmarshal(content, &data); err != nil {
			return fmt.Errorf("parse workspace config: %w", err)
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return fmt.Errorf("read workspace config: %w", readErr)
	}

	delete(data, legacyManagedMCPServersKey)
	if len(managedServers) == 0 {
		delete(data, managedMCPServersKey)
	} else {
		data[managedMCPServersKey] = managedServers
	}

	encoded, err := toml.Marshal(data)
	if err != nil {
		return fmt.Errorf("encode workspace config: %w", err)
	}

	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		return fmt.Errorf("create workspace config directory: %w", err)
	}
	if err := os.WriteFile(configPath, encoded, 0o644); err != nil {
		return fmt.Errorf("write workspace config: %w", err)
	}
	return nil
}

func (s *Service) workspaceConfigPath(workspaceID string) (string, error) {
	workspaceID = strings.TrimSpace(workspaceID)
	if workspaceID == "" {
		return "", fmt.Errorf("%w: workspace id is required", ErrInvalidInput)
	}
	if s.store == nil {
		return "", fmt.Errorf("%w: workspace store is unavailable", ErrInvalidInput)
	}

	workspace, ok := s.store.GetWorkspace(workspaceID)
	if !ok {
		return "", fmt.Errorf("%w: workspace %q was not found", ErrInvalidInput, workspaceID)
	}
	rootPath := strings.TrimSpace(workspace.RootPath)
	if rootPath == "" {
		return "", fmt.Errorf("%w: workspace root path is required", ErrInvalidInput)
	}

	return filepath.Join(rootPath, filepath.FromSlash(workspaceConfigTomlPath)), nil
}

func buildManagedMcpServers(raw map[string]any, config Config, configfsAvailable bool, builtinManaged bool) (map[string]any, RuntimeIntegration) {
	servers := cloneObjectMap(runtimeMcpServersValue(raw))
	delete(servers, managedMCPServerName)

	integration := buildRuntimeIntegration(raw, config, configfsAvailable, builtinManaged)
	if !configfsAvailable {
		return servers, integration
	}
	if !config.Enabled || strings.TrimSpace(config.MCPEndpoint) == "" {
		return servers, integration
	}

	servers[managedMCPServerName] = managedMcpServerEntry(config)
	integration.Status = "configured"
	integration.ThreadEnabled = true
	integration.BotEnabled = true
	integration.AllowlistAppliedInThread = builtinManaged
	integration.WriteGuardAppliedInThread = builtinManaged
	integration.Detail = "Threads use the managed workspace MCP server feishu-tools; bot conversations can use the same Feishu tools only through their bound thread."
	return servers, integration
}

func buildRuntimeIntegration(raw map[string]any, config Config, configfsAvailable bool, builtinManaged bool) RuntimeIntegration {
	integration := RuntimeIntegration{
		Status:                    "disabled",
		Mode:                      "workspace_mcp",
		ServerName:                managedMCPServerName,
		ServerURL:                 strings.TrimSpace(config.MCPEndpoint),
		Managed:                   true,
		AllowlistAppliedInThread:  false,
		WriteGuardAppliedInThread: false,
	}
	if !configfsAvailable {
		integration.Status = "unavailable"
		integration.Detail = "configfs is unavailable, so Feishu MCP runtime integration cannot be synchronized for threads or bot-bound threads."
		return integration
	}

	currentServers := runtimeMcpServersValue(raw)
	currentEntry := normalizeManagedMcpServerEntry(objectMapValue(currentServers[managedMCPServerName]))
	hasManagedServer := len(currentEntry) > 0

	if !config.Enabled {
		if hasManagedServer {
			integration.Status = "sync_required"
			integration.Detail = "Feishu tools are disabled, but the managed Feishu MCP server is still present in workspace .codex/config.toml. Save settings again to remove it from thread runtime."
			return integration
		}
		integration.Detail = "Feishu tools are disabled, so no managed Feishu MCP server is attached to thread or bot runtime."
		return integration
	}
	if strings.TrimSpace(config.MCPEndpoint) == "" {
		if hasManagedServer {
			integration.Status = "sync_required"
			integration.Detail = "Feishu tools are enabled without an available MCP endpoint, but a stale managed Feishu MCP server is still present in workspace .codex/config.toml."
			return integration
		}
		integration.Status = "missing_endpoint"
		integration.Detail = "Built-in Feishu MCP endpoint is unavailable, so threads and bot-bound threads cannot discover Feishu tools yet."
		return integration
	}

	expectedEntry := managedMcpServerEntry(config)
	if !hasManagedServer || !reflect.DeepEqual(currentEntry, expectedEntry) {
		integration.Status = "sync_required"
		integration.Detail = "Save Feishu settings to sync workspace .codex/config.toml:mcp_servers.feishu-tools for threads and bot-bound threads."
		return integration
	}

	integration.Status = "configured"
	integration.ThreadEnabled = true
	integration.BotEnabled = true
	integration.AllowlistAppliedInThread = builtinManaged
	integration.WriteGuardAppliedInThread = builtinManaged
	integration.Detail = "Threads use the managed workspace MCP server feishu-tools; bot conversations can use the same Feishu tools only through their bound thread."
	return integration
}

func managedMcpServerEntry(config Config) map[string]any {
	entry := map[string]any{
		"url":     strings.TrimSpace(config.MCPEndpoint),
		"enabled": true,
	}

	enabledTools, disabledTools := managedMcpToolFilters(config)
	entry["enabled_tools"] = enabledTools
	entry["disabled_tools"] = disabledTools
	return entry
}

func managedMcpToolFilters(config Config) ([]string, []string) {
	allTools := allManagedToolNames()
	if len(allTools) == 0 {
		return []string{}, []string{}
	}

	if len(config.ToolAllowlist) == 0 {
		return allTools, []string{}
	}

	enabledSet := make(map[string]struct{}, len(config.ToolAllowlist))
	for _, toolName := range config.ToolAllowlist {
		trimmed := strings.TrimSpace(toolName)
		if trimmed == "" {
			continue
		}
		if _, ok := toolDefinitions[trimmed]; !ok {
			continue
		}
		enabledSet[trimmed] = struct{}{}
	}

	enabledTools := make([]string, 0, len(enabledSet))
	disabledTools := make([]string, 0, len(allTools))
	for _, toolName := range allTools {
		if _, ok := enabledSet[toolName]; ok {
			enabledTools = append(enabledTools, toolName)
			continue
		}
		disabledTools = append(disabledTools, toolName)
	}

	return enabledTools, disabledTools
}

func allManagedToolNames() []string {
	return sortedKeys(toolDefinitions)
}

func (s *Service) overlayStoreConfigWithManagedMcpServerCompat(workspaceID string, config Config, stored store.FeishuToolsConfig, raw map[string]any) Config {
	entry := managedMcpServerCompatEntry(raw)
	if len(entry) == 0 {
		return config
	}

	expectedConfig := config
	resolvedEndpoint, _ := s.resolvedManagedMCPEndpointFromToken(workspaceID, expectedConfig, stored.ManagedMCPAuthToken)
	expectedConfig.MCPEndpoint = resolvedEndpoint
	if config.Enabled && strings.TrimSpace(expectedConfig.MCPEndpoint) != "" && reflect.DeepEqual(entry, managedMcpServerEntry(expectedConfig)) {
		return config
	}

	if allowlist, ok := managedMcpServerToolAllowlist(entry); ok {
		config.ToolAllowlist = allowlist
	}
	return config
}

func managedMcpServerCompatEntry(raw map[string]any) map[string]any {
	servers := runtimeMcpServersValue(raw)
	if len(servers) == 0 {
		return nil
	}
	return normalizeManagedMcpServerEntry(objectMapValue(servers[managedMCPServerName]))
}

func normalizeManagedMcpServerEntry(entry map[string]any) map[string]any {
	if len(entry) == 0 {
		return nil
	}

	normalized := make(map[string]any)
	if url := stringValue(entry["url"]); url != "" {
		normalized["url"] = url
	}
	if enabled, ok := boolConfigValue(entry["enabled"]); ok {
		normalized["enabled"] = enabled
	}
	if _, ok := entry["enabled_tools"]; ok {
		normalized["enabled_tools"] = normalizeManagedEntryToolNames(stringSliceValue(entry["enabled_tools"]))
	}
	if _, ok := entry["disabled_tools"]; ok {
		normalized["disabled_tools"] = normalizeManagedEntryToolNames(stringSliceValue(entry["disabled_tools"]))
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func managedMcpServerToolAllowlist(entry map[string]any) ([]string, bool) {
	if len(entry) == 0 {
		return nil, false
	}

	allTools := allManagedToolNames()
	if len(allTools) == 0 {
		return nil, false
	}

	_, hasEnabled := entry["enabled_tools"]
	_, hasDisabled := entry["disabled_tools"]
	enabledTools := normalizeManagedEntryToolNames(stringSliceValue(entry["enabled_tools"]))
	disabledTools := normalizeManagedEntryToolNames(stringSliceValue(entry["disabled_tools"]))

	switch {
	case hasEnabled && len(enabledTools) > 0:
		if len(enabledTools) == len(allTools) {
			return nil, true
		}
		return enabledTools, true
	case hasDisabled && len(disabledTools) > 0:
		disabledSet := make(map[string]struct{}, len(disabledTools))
		for _, toolName := range disabledTools {
			disabledSet[toolName] = struct{}{}
		}
		enabled := make([]string, 0, len(allTools))
		for _, toolName := range allTools {
			if _, blocked := disabledSet[toolName]; blocked {
				continue
			}
			enabled = append(enabled, toolName)
		}
		if len(enabled) == len(allTools) {
			return nil, true
		}
		return enabled, true
	case hasEnabled || hasDisabled:
		return nil, true
	default:
		return nil, false
	}
}

func normalizeManagedEntryToolNames(values []string) []string {
	set := make(map[string]struct{})
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, ok := toolDefinitions[trimmed]; !ok {
			continue
		}
		set[trimmed] = struct{}{}
	}
	return sortedKeys(set)
}

func runtimeMcpServersValue(raw map[string]any) map[string]any {
	servers := objectMapValue(raw[managedMCPServersKey])
	if len(servers) > 0 {
		return servers
	}
	return objectMapValue(raw[legacyManagedMCPServersKey])
}

func objectMapValue(value any) map[string]any {
	typed, ok := value.(map[string]any)
	if !ok || len(typed) == 0 {
		return nil
	}
	return typed
}

func cloneObjectMap(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}
	result := make(map[string]any, len(input))
	for key, value := range input {
		result[key] = cloneAnyValue(value)
	}
	return result
}

func cloneAnyValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneObjectMap(typed)
	case []any:
		items := make([]any, len(typed))
		for index, item := range typed {
			items[index] = cloneAnyValue(item)
		}
		return items
	default:
		return typed
	}
}
