package feishutools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Feishu OpenAPI endpoints used by the phase-1 tool gateway. Only endpoints
// actually consumed here are listed; extending the surface should go through
// a targeted review of the scope + rate-limit implications.
const (
	openAPIDefaultDomain          = "https://open.feishu.cn"
	openAPITenantTokenPath        = "/open-apis/auth/v3/tenant_access_token/internal"
	tenantTokenRefreshLeeway      = 2 * time.Minute
	openAPIDefaultHTTPTimeout     = 20 * time.Second
	openAPIMaxResponseBodyPreview = 512
)

// gatewayError is the stable error contract the invoke endpoint returns to the
// frontend and thread agents. It keeps the HTTP machinery leaky detail out of
// upper layers.
type gatewayError struct {
	Code      string         `json:"code"`
	Message   string         `json:"message"`
	Hint      string         `json:"hint,omitempty"`
	Status    int            `json:"status,omitempty"`
	FeishuErr *feishuAPIBody `json:"feishu,omitempty"`
}

func (e *gatewayError) Error() string {
	if e == nil {
		return ""
	}
	if e.Hint != "" {
		return fmt.Sprintf("%s: %s (%s)", e.Code, e.Message, e.Hint)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Message)
}

// feishuAPIBody captures the canonical Feishu error shape: `code` != 0 plus a
// human-readable `msg`. Some endpoints (OIDC) also use `error`/`error_description`
// which we normalize above.
type feishuAPIBody struct {
	Code int    `json:"code"`
	Msg  string `json:"msg,omitempty"`
}

type tenantTokenResponse struct {
	Code              int    `json:"code"`
	Msg               string `json:"msg"`
	TenantAccessToken string `json:"tenant_access_token"`
	Expire            int64  `json:"expire"`
}

type cachedTenantToken struct {
	Token     string
	ExpiresAt time.Time
}

// Gateway is the shared HTTP surface used by tool implementations. It owns the
// tenant-token cache and knows how to obtain a valid user token, refreshing
// when necessary. Create with newGateway inside the Service.
type Gateway struct {
	service    *Service
	httpClient *http.Client
	domain     string
	now        func() time.Time

	mu           sync.Mutex
	tenantTokens map[string]cachedTenantToken // key = workspaceID + ":" + appID
}

func newGateway(service *Service, httpClient *http.Client) *Gateway {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: openAPIDefaultHTTPTimeout}
	}
	return &Gateway{
		service:      service,
		httpClient:   httpClient,
		domain:       openAPIDefaultDomain,
		now:          time.Now,
		tenantTokens: make(map[string]cachedTenantToken),
	}
}

// WithDomain overrides the Feishu API domain, mainly to help tests point the
// gateway at an httptest server.
func (g *Gateway) WithDomain(domain string) *Gateway {
	if trimmed := strings.TrimSpace(domain); trimmed != "" {
		g.domain = strings.TrimRight(trimmed, "/")
	}
	return g
}

// TenantToken returns a valid tenant_access_token for the workspace, using a
// short-lived cache keyed by workspaceId + appId. Cache hits never touch the
// network.
func (g *Gateway) TenantToken(ctx context.Context, workspaceID string, config Config) (string, error) {
	appID := strings.TrimSpace(config.AppID)
	appSecret := strings.TrimSpace(config.AppSecret)
	if appID == "" || appSecret == "" {
		return "", &gatewayError{Code: "missing_credentials", Message: "Feishu App ID and App Secret must be configured", Hint: "Open Settings → Feishu Tools and fill in appId/appSecret."}
	}

	cacheKey := workspaceID + ":" + appID
	now := g.now()

	g.mu.Lock()
	if cached, ok := g.tenantTokens[cacheKey]; ok {
		if cached.ExpiresAt.After(now.Add(tenantTokenRefreshLeeway)) {
			g.mu.Unlock()
			return cached.Token, nil
		}
	}
	g.mu.Unlock()

	body, err := json.Marshal(map[string]string{
		"app_id":     appID,
		"app_secret": appSecret,
	})
	if err != nil {
		return "", err
	}
	emitInvokeProgress(ctx, "authorizing", "Requesting Feishu tenant token", map[string]any{
		"oauthMode": "app_only",
	})
	endpoint := g.domain + openAPITenantTokenPath
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")

	response, err := g.httpClient.Do(request)
	if err != nil {
		return "", &gatewayError{Code: "upstream_unreachable", Message: "Cannot reach Feishu OpenAPI", Hint: err.Error()}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return "", err
	}

	var parsed tenantTokenResponse
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return "", &gatewayError{Code: "upstream_invalid_response", Message: "Tenant token response was not valid JSON", Hint: previewResponseBody(raw)}
		}
	}
	if response.StatusCode >= 300 || parsed.Code != 0 || parsed.TenantAccessToken == "" {
		return "", &gatewayError{
			Code:      "tenant_token_failed",
			Message:   fallbackErrorMessage(parsed.Msg, "Feishu rejected the tenant token request"),
			Status:    response.StatusCode,
			FeishuErr: &feishuAPIBody{Code: parsed.Code, Msg: parsed.Msg},
		}
	}

	token := cachedTenantToken{
		Token:     parsed.TenantAccessToken,
		ExpiresAt: now.Add(time.Duration(parsed.Expire) * time.Second),
	}
	if parsed.Expire <= 0 {
		// Be conservative when the upstream omits expiry info.
		token.ExpiresAt = now.Add(30 * time.Minute)
	}

	g.mu.Lock()
	g.tenantTokens[cacheKey] = token
	g.mu.Unlock()
	emitInvokeProgress(ctx, "verifying", "Feishu tenant token ready", map[string]any{
		"expiresAt": token.ExpiresAt.UTC().Format(time.RFC3339),
	})
	return token.Token, nil
}

// UserToken returns a valid user access token for the workspace. If the cached
// access token is past the leeway window it is refreshed using the stored
// refresh token, which is then persisted.
func (g *Gateway) UserToken(ctx context.Context, workspaceID string, config Config) (OauthTokenSnapshot, error) {
	snapshot := config.UserToken
	if !snapshot.Connected() {
		return OauthTokenSnapshot{}, &gatewayError{
			Code:    "user_oauth_required",
			Message: "This tool requires a Feishu user authorization",
			Hint:    "Start the Feishu OAuth flow from Settings → Feishu Tools.",
		}
	}

	now := g.now().UTC()
	if snapshot.IsAccessTokenValid(now) {
		emitInvokeProgress(ctx, "authorizing", "Using stored Feishu user authorization", map[string]any{
			"principalType": "user",
			"expiresAt":     snapshot.AccessTokenExpiresAt.UTC().Format(time.RFC3339),
		})
		return snapshot, nil
	}

	if !snapshot.IsRefreshTokenValid(now) {
		return OauthTokenSnapshot{}, &gatewayError{
			Code:    "user_oauth_expired",
			Message: "The Feishu user authorization has expired",
			Hint:    "Re-run the Feishu OAuth flow to obtain a fresh refresh token.",
		}
	}
	if g.service == nil || g.service.oauth == nil {
		return OauthTokenSnapshot{}, &gatewayError{Code: "service_unavailable", Message: "Feishu tools service is not initialized"}
	}

	refreshed, err := g.service.oauth.Refresh(ctx, config.AppID, config.AppSecret, snapshot.RefreshToken)
	if err != nil {
		return OauthTokenSnapshot{}, &gatewayError{
			Code:    "user_oauth_refresh_failed",
			Message: "Refreshing the Feishu user token failed",
			Hint:    err.Error(),
		}
	}
	if err := g.service.writeTokenSnapshot(ctx, workspaceID, refreshed); err != nil {
		return OauthTokenSnapshot{}, &gatewayError{Code: "user_oauth_persist_failed", Message: "Could not persist the refreshed Feishu token", Hint: err.Error()}
	}
	emitInvokeProgress(ctx, "authorizing", "Refreshed Feishu user authorization", map[string]any{
		"principalType": "user",
		"expiresAt":     refreshed.AccessTokenExpiresAt.UTC().Format(time.RFC3339),
	})
	return refreshed, nil
}

// doJSON sends a JSON request and decodes the Feishu envelope into `out`. The
// caller chooses which token (tenant or user) to forward via the `bearer`
// argument. When `out` is nil the response body is discarded.
//
// The method returns a *gatewayError whenever the request fails, including
// when Feishu signals a non-zero `code`.
func (g *Gateway) doJSON(ctx context.Context, method string, path string, query url.Values, bearer string, payload any, out any) error {
	endpoint := g.domain + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	state, message := describeGatewayProgress(method, path)
	emitInvokeProgress(ctx, state, message, map[string]any{
		"method": sanitizeGatewayMethod(method),
		"path":   path,
	})

	var reader io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json; charset=utf-8")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}

	response, err := g.httpClient.Do(request)
	if err != nil {
		return &gatewayError{Code: "upstream_unreachable", Message: "Cannot reach Feishu OpenAPI", Hint: err.Error()}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode >= 400 && len(raw) == 0 {
		return &gatewayError{Code: "upstream_error", Message: fmt.Sprintf("Feishu returned HTTP %d", response.StatusCode), Status: response.StatusCode}
	}

	// Feishu's standard response carries `code`, `msg`, and `data`. Decode the
	// envelope generically so we can map non-zero codes onto gatewayError
	// without forcing every call site to duplicate the check.
	var envelope struct {
		Code int             `json:"code"`
		Msg  string          `json:"msg"`
		Data json.RawMessage `json:"data"`
	}
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return &gatewayError{Code: "upstream_invalid_response", Message: "Feishu response was not valid JSON", Hint: previewResponseBody(raw), Status: response.StatusCode}
		}
	}
	if envelope.Code != 0 {
		return &gatewayError{
			Code:      feishuErrorCode(envelope.Code),
			Message:   fallbackErrorMessage(envelope.Msg, fmt.Sprintf("Feishu returned error code %d", envelope.Code)),
			Status:    response.StatusCode,
			FeishuErr: &feishuAPIBody{Code: envelope.Code, Msg: envelope.Msg},
		}
	}
	if response.StatusCode >= 400 {
		return &gatewayError{Code: "upstream_error", Message: fmt.Sprintf("Feishu returned HTTP %d", response.StatusCode), Status: response.StatusCode, Hint: previewResponseBody(raw)}
	}

	if out == nil || len(envelope.Data) == 0 || string(envelope.Data) == "null" {
		emitInvokeProgress(ctx, "verifying", describeGatewayCompletion(path), map[string]any{
			"method": sanitizeGatewayMethod(method),
			"path":   path,
		})
		return nil
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return &gatewayError{Code: "upstream_invalid_response", Message: "Feishu data payload could not be decoded", Hint: err.Error()}
	}
	emitInvokeProgress(ctx, "verifying", describeGatewayCompletion(path), map[string]any{
		"method": sanitizeGatewayMethod(method),
		"path":   path,
	})
	return nil
}

// doRaw performs a JSON request and returns the raw envelope body so callers
// that need custom shape handling (for example text/html responses) can decide
// how to process it themselves.
func (g *Gateway) doRaw(ctx context.Context, method string, path string, query url.Values, bearer string, payload any) ([]byte, error) {
	endpoint := g.domain + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	state, message := describeGatewayProgress(method, path)
	emitInvokeProgress(ctx, state, message, map[string]any{
		"method": sanitizeGatewayMethod(method),
		"path":   path,
	})

	var reader io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return nil, err
		}
		reader = bytes.NewReader(encoded)
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, err
	}
	if payload != nil {
		request.Header.Set("Content-Type", "application/json; charset=utf-8")
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}

	response, err := g.httpClient.Do(request)
	if err != nil {
		return nil, &gatewayError{Code: "upstream_unreachable", Message: "Cannot reach Feishu OpenAPI", Hint: err.Error()}
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return nil, err
	}
	if response.StatusCode >= 400 {
		return raw, &gatewayError{Code: "upstream_error", Message: fmt.Sprintf("Feishu returned HTTP %d", response.StatusCode), Status: response.StatusCode, Hint: previewResponseBody(raw)}
	}
	emitInvokeProgress(ctx, "verifying", describeGatewayCompletion(path), map[string]any{
		"method": sanitizeGatewayMethod(method),
		"path":   path,
	})
	return raw, nil
}

func feishuErrorCode(code int) string {
	switch {
	case code == 99991663 || code == 99991664 || code == 99991665:
		return "invalid_credentials"
	case code == 99991668:
		return "app_permission_denied"
	case code == 99991400 || code == 99991401:
		return "rate_limited"
	case code >= 230000 && code < 240000:
		return "docs_error"
	case code >= 195000 && code < 196000:
		return "im_error"
	case code >= 1420000 && code < 1430000:
		return "search_error"
	default:
		return fmt.Sprintf("feishu_error_%d", code)
	}
}

func fallbackErrorMessage(value string, fallback string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return fallback
	}
	return trimmed
}

func previewResponseBody(raw []byte) string {
	text := strings.TrimSpace(string(raw))
	if len(text) > openAPIMaxResponseBodyPreview {
		text = text[:openAPIMaxResponseBodyPreview] + "…"
	}
	return text
}

// ResourceDownload is the payload returned by the binary downloader. It
// carries enough metadata for the invoke envelope to describe the file
// without re-streaming the bytes everywhere.
type ResourceDownload struct {
	Bytes       []byte
	ContentType string
	SizeBytes   int
	Truncated   bool
}

// downloadResource fetches a binary payload from Feishu, capping at maxBytes
// so a single tool call cannot exhaust server memory. Feishu signals errors
// by returning a JSON envelope even on HTTP 200, so the helper inspects the
// Content-Type before deciding how to interpret the body.
func (g *Gateway) downloadResource(ctx context.Context, path string, query url.Values, bearer string, maxBytes int) (*ResourceDownload, error) {
	endpoint := g.domain + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	emitInvokeProgress(ctx, "running", "Downloading resource from Feishu", map[string]any{
		"method": http.MethodGet,
		"path":   path,
	})

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	if bearer != "" {
		request.Header.Set("Authorization", "Bearer "+bearer)
	}

	response, err := g.httpClient.Do(request)
	if err != nil {
		return nil, &gatewayError{Code: "upstream_unreachable", Message: "Cannot reach Feishu OpenAPI", Hint: err.Error()}
	}
	defer response.Body.Close()

	contentType := response.Header.Get("Content-Type")
	// Errors arrive as JSON even with HTTP 200 on this endpoint, so inspect
	// the Content-Type before treating the body as binary.
	if response.StatusCode >= 400 || strings.Contains(contentType, "application/json") {
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 64*1024))
		if readErr != nil {
			return nil, readErr
		}
		var envelope feishuAPIBody
		if len(raw) > 0 {
			_ = json.Unmarshal(raw, &envelope)
		}
		if envelope.Code != 0 {
			return nil, &gatewayError{
				Code:      feishuErrorCode(envelope.Code),
				Message:   fallbackErrorMessage(envelope.Msg, "Feishu returned an error while downloading the resource"),
				Status:    response.StatusCode,
				FeishuErr: &feishuAPIBody{Code: envelope.Code, Msg: envelope.Msg},
			}
		}
		return nil, &gatewayError{
			Code:    "upstream_error",
			Message: fmt.Sprintf("Feishu returned HTTP %d while downloading the resource", response.StatusCode),
			Status:  response.StatusCode,
			Hint:    previewResponseBody(raw),
		}
	}

	limit := maxBytes
	if limit <= 0 {
		limit = 5 * 1024 * 1024
	}
	// Read one byte beyond the cap so we can report truncation accurately.
	buffer, err := io.ReadAll(io.LimitReader(response.Body, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	truncated := false
	if len(buffer) > limit {
		buffer = buffer[:limit]
		truncated = true
	}
	emitInvokeProgress(ctx, "verifying", "Feishu resource download completed", map[string]any{
		"method":      http.MethodGet,
		"path":        path,
		"sizeBytes":   len(buffer),
		"truncated":   truncated,
		"contentType": contentType,
	})
	return &ResourceDownload{
		Bytes:       buffer,
		ContentType: contentType,
		SizeBytes:   len(buffer),
		Truncated:   truncated,
	}, nil
}

// ClearCachedTenantToken drops any cached tenant token for the workspace. It
// is invoked when credentials change so the next request forces a fresh fetch.
func (g *Gateway) ClearCachedTenantToken(workspaceID string, appID string) {
	if g == nil {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	delete(g.tenantTokens, workspaceID+":"+appID)
}

func sanitizeGatewayMethod(method string) string {
	trimmed := strings.ToUpper(strings.TrimSpace(method))
	if trimmed == "" {
		return http.MethodGet
	}
	return trimmed
}

func describeGatewayProgress(method string, path string) (string, string) {
	normalizedMethod := sanitizeGatewayMethod(method)
	normalizedPath := strings.ToLower(strings.TrimSpace(path))

	switch {
	case strings.Contains(normalizedPath, "/sheets/"):
		if normalizedMethod == http.MethodGet {
			return "running", "Reading Feishu Sheets data"
		}
		return "writing", "Writing Feishu Sheets data"
	case strings.Contains(normalizedPath, "/bitable/"):
		if normalizedMethod == http.MethodGet {
			return "running", "Reading Feishu Base data"
		}
		return "writing", "Writing Feishu Base data"
	case strings.Contains(normalizedPath, "/docx/") || strings.Contains(normalizedPath, "/docs/"):
		if normalizedMethod == http.MethodGet {
			return "running", "Reading Feishu Docs data"
		}
		return "writing", "Updating Feishu Docs data"
	case normalizedMethod == http.MethodGet:
		return "running", "Calling Feishu OpenAPI"
	default:
		return "writing", "Sending write request to Feishu OpenAPI"
	}
}

func describeGatewayCompletion(path string) string {
	normalizedPath := strings.ToLower(strings.TrimSpace(path))

	switch {
	case strings.Contains(normalizedPath, "/sheets/"):
		return "Feishu Sheets request completed"
	case strings.Contains(normalizedPath, "/bitable/"):
		return "Feishu Base request completed"
	case strings.Contains(normalizedPath, "/docx/") || strings.Contains(normalizedPath, "/docs/"):
		return "Feishu Docs request completed"
	default:
		return "Feishu OpenAPI request completed"
	}
}
