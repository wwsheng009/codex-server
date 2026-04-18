package feishutools

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// OAuth defaults targeting Feishu public endpoints. Lark/overseas deployments
// should override the domain through workspace configuration in a future
// iteration; phase-1 targets open.feishu.cn only.
const (
	defaultOauthDomain        = "https://open.feishu.cn"
	oauthAuthorizePath        = "/open-apis/authen/v1/authorize"
	oauthTokenPath            = "/open-apis/authen/v2/oauth/token"
	oauthRevokePath           = "/open-apis/authen/v1/oidc/logout"
	callbackPathTemplate      = "/api/feishu-tools/oauth/callback"
	pendingOauthTTL           = 10 * time.Minute
	oauthHTTPDefaultTimeout   = 15 * time.Second
	refreshLeewayBeforeExpiry = 2 * time.Minute
	oauthOfflineAccessScope   = "offline_access"
)

// OauthTokenSnapshot captures the persisted fields of a Feishu user OAuth
// session so the gateway can reason about validity without re-reading config.
type OauthTokenSnapshot struct {
	AccessToken           string
	RefreshToken          string
	AccessTokenExpiresAt  time.Time
	RefreshTokenExpiresAt time.Time
	Scopes                []string
	OpenID                string
	UnionID               string
	ObtainedAt            time.Time
}

// IsAccessTokenValid reports whether the access token can still be used
// without refresh (with a small leeway window).
func (t OauthTokenSnapshot) IsAccessTokenValid(now time.Time) bool {
	if strings.TrimSpace(t.AccessToken) == "" {
		return false
	}
	if t.AccessTokenExpiresAt.IsZero() {
		return true
	}
	return t.AccessTokenExpiresAt.After(now.Add(refreshLeewayBeforeExpiry))
}

// IsRefreshTokenValid reports whether the refresh token is still usable.
func (t OauthTokenSnapshot) IsRefreshTokenValid(now time.Time) bool {
	if strings.TrimSpace(t.RefreshToken) == "" {
		return false
	}
	if t.RefreshTokenExpiresAt.IsZero() {
		return true
	}
	return t.RefreshTokenExpiresAt.After(now)
}

// Connected reports whether the snapshot has enough material to be treated as
// an authorized session.
func (t OauthTokenSnapshot) Connected() bool {
	return strings.TrimSpace(t.AccessToken) != "" || strings.TrimSpace(t.RefreshToken) != ""
}

// oauthTokenResponse mirrors Feishu's `/authen/v2/oauth/token` response.
type oauthTokenResponse struct {
	Code             int    `json:"code"`
	Error            string `json:"error"`
	ErrorDescription string `json:"error_description"`
	Message          string `json:"message"`
	AccessToken      string `json:"access_token"`
	RefreshToken     string `json:"refresh_token"`
	TokenType        string `json:"token_type"`
	ExpiresIn        int64  `json:"expires_in"`
	RefreshExpiresIn int64  `json:"refresh_token_expires_in"`
	Scope            string `json:"scope"`
	OpenID           string `json:"open_id"`
	UnionID          string `json:"union_id"`
}

// OauthClient encapsulates the Feishu OAuth flow: URL building, code exchange,
// refresh, and revoke. It is safe for concurrent use.
type OauthClient struct {
	httpClient *http.Client
	domain     string
	now        func() time.Time

	mu           sync.Mutex
	pendingState map[string]pendingStateEntry
}

type pendingStateEntry struct {
	WorkspaceID string
	Scopes      []string
	RedirectURI string
	CreatedAt   time.Time
}

// NewOauthClient returns a ready-to-use OAuth helper. httpClient may be nil,
// in which case a default client with a short timeout is used.
func NewOauthClient(httpClient *http.Client) *OauthClient {
	if httpClient == nil {
		httpClient = &http.Client{Timeout: oauthHTTPDefaultTimeout}
	}
	return &OauthClient{
		httpClient:   httpClient,
		domain:       defaultOauthDomain,
		now:          time.Now,
		pendingState: make(map[string]pendingStateEntry),
	}
}

// WithDomain overrides the Feishu endpoint domain (used for Lark or tests).
func (c *OauthClient) WithDomain(domain string) *OauthClient {
	if trimmed := strings.TrimSpace(domain); trimmed != "" {
		c.domain = strings.TrimRight(trimmed, "/")
	}
	return c
}

// BuildAuthorizeURL returns the Feishu authorize URL and a freshly minted state
// token that the caller must validate when the callback fires.
func (c *OauthClient) BuildAuthorizeURL(workspaceID string, appID string, redirectURI string, scopes []string) (string, string, error) {
	if strings.TrimSpace(appID) == "" {
		return "", "", fmt.Errorf("%w: app id is required", ErrInvalidInput)
	}
	if strings.TrimSpace(redirectURI) == "" {
		return "", "", fmt.Errorf("%w: redirect uri is required", ErrInvalidInput)
	}
	if strings.TrimSpace(workspaceID) == "" {
		return "", "", fmt.Errorf("%w: workspace id is required", ErrInvalidInput)
	}

	requestedScopes := ensureOauthScopes(scopes)

	state, err := c.registerPendingState(workspaceID, redirectURI, requestedScopes)
	if err != nil {
		return "", "", err
	}

	values := url.Values{}
	values.Set("app_id", strings.TrimSpace(appID))
	values.Set("redirect_uri", redirectURI)
	values.Set("response_type", "code")
	values.Set("state", state)
	if scope := strings.Join(requestedScopes, " "); scope != "" {
		values.Set("scope", scope)
	}

	authorize := c.domain + oauthAuthorizePath + "?" + values.Encode()
	return authorize, state, nil
}

// ConsumeState validates and removes a pending state. If the state is unknown
// or expired an error is returned.
func (c *OauthClient) ConsumeState(state string) (pendingStateEntry, error) {
	trimmed := strings.TrimSpace(state)
	if trimmed == "" {
		return pendingStateEntry{}, fmt.Errorf("%w: state is required", ErrInvalidInput)
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.pendingState[trimmed]
	if !ok {
		return pendingStateEntry{}, fmt.Errorf("%w: unknown oauth state", ErrInvalidInput)
	}
	delete(c.pendingState, trimmed)

	if c.now().Sub(entry.CreatedAt) > pendingOauthTTL {
		return pendingStateEntry{}, fmt.Errorf("%w: oauth state expired", ErrInvalidInput)
	}
	return entry, nil
}

// ExchangeCode swaps an authorization code for access + refresh tokens.
func (c *OauthClient) ExchangeCode(ctx context.Context, appID, appSecret, code, redirectURI string) (OauthTokenSnapshot, error) {
	body := map[string]string{
		"grant_type":    "authorization_code",
		"client_id":     strings.TrimSpace(appID),
		"client_secret": strings.TrimSpace(appSecret),
		"code":          strings.TrimSpace(code),
		"redirect_uri":  strings.TrimSpace(redirectURI),
	}
	return c.requestToken(ctx, body)
}

// Refresh trades a refresh token for a fresh access+refresh token pair.
func (c *OauthClient) Refresh(ctx context.Context, appID, appSecret, refreshToken string) (OauthTokenSnapshot, error) {
	body := map[string]string{
		"grant_type":    "refresh_token",
		"client_id":     strings.TrimSpace(appID),
		"client_secret": strings.TrimSpace(appSecret),
		"refresh_token": strings.TrimSpace(refreshToken),
	}
	return c.requestToken(ctx, body)
}

// Revoke best-effort notifies Feishu that the given access token should be
// invalidated. Failures are returned but callers should treat revoke as
// advisory; local token removal is the source of truth.
func (c *OauthClient) Revoke(ctx context.Context, accessToken string) error {
	trimmed := strings.TrimSpace(accessToken)
	if trimmed == "" {
		return nil
	}

	endpoint := c.domain + oauthRevokePath
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+trimmed)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode >= 300 {
		raw, _ := io.ReadAll(response.Body)
		return fmt.Errorf("feishu revoke failed: status=%d body=%s", response.StatusCode, strings.TrimSpace(string(raw)))
	}
	return nil
}

func (c *OauthClient) requestToken(ctx context.Context, body map[string]string) (OauthTokenSnapshot, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return OauthTokenSnapshot{}, err
	}

	endpoint := c.domain + oauthTokenPath
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return OauthTokenSnapshot{}, err
	}
	request.Header.Set("Content-Type", "application/json; charset=utf-8")

	response, err := c.httpClient.Do(request)
	if err != nil {
		return OauthTokenSnapshot{}, err
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		return OauthTokenSnapshot{}, err
	}

	var parsed oauthTokenResponse
	if len(raw) > 0 {
		if err := json.Unmarshal(raw, &parsed); err != nil {
			return OauthTokenSnapshot{}, fmt.Errorf("decode feishu oauth token response: %w", err)
		}
	}

	if response.StatusCode >= 300 || parsed.AccessToken == "" {
		msg := strings.TrimSpace(parsed.ErrorDescription)
		if msg == "" {
			msg = strings.TrimSpace(parsed.Error)
		}
		if msg == "" {
			msg = strings.TrimSpace(parsed.Message)
		}
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
		}
		if msg == "" {
			msg = fmt.Sprintf("status=%d", response.StatusCode)
		}
		return OauthTokenSnapshot{}, fmt.Errorf("feishu oauth token request failed: %s", msg)
	}

	now := c.now().UTC()
	snapshot := OauthTokenSnapshot{
		AccessToken:  strings.TrimSpace(parsed.AccessToken),
		RefreshToken: strings.TrimSpace(parsed.RefreshToken),
		Scopes:       splitScopes(parsed.Scope),
		OpenID:       strings.TrimSpace(parsed.OpenID),
		UnionID:      strings.TrimSpace(parsed.UnionID),
		ObtainedAt:   now,
	}
	if parsed.ExpiresIn > 0 {
		snapshot.AccessTokenExpiresAt = now.Add(time.Duration(parsed.ExpiresIn) * time.Second)
	}
	if parsed.RefreshExpiresIn > 0 {
		snapshot.RefreshTokenExpiresAt = now.Add(time.Duration(parsed.RefreshExpiresIn) * time.Second)
	}
	return snapshot, nil
}

func (c *OauthClient) registerPendingState(workspaceID string, redirectURI string, scopes []string) (string, error) {
	state, err := generateStateToken()
	if err != nil {
		return "", err
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	// Opportunistically clean up expired entries so the map does not grow
	// without bound for long-running processes.
	now := c.now()
	for key, entry := range c.pendingState {
		if now.Sub(entry.CreatedAt) > pendingOauthTTL {
			delete(c.pendingState, key)
		}
	}

	c.pendingState[state] = pendingStateEntry{
		WorkspaceID: workspaceID,
		Scopes:      append([]string(nil), scopes...),
		RedirectURI: redirectURI,
		CreatedAt:   now,
	}
	return state, nil
}

func generateStateToken() (string, error) {
	buffer := make([]byte, 24)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	// base64url without padding keeps the state safe inside a URL.
	encoded := base64.RawURLEncoding.EncodeToString(buffer)
	// Prefix with a hex nibble so tokens are obviously non-empty even when
	// base64 encoding produces leading non-alphabetic characters.
	return "fto_" + encoded + "_" + hex.EncodeToString(buffer[:2]), nil
}

func splitScopes(scope string) []string {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" {
		return nil
	}
	items := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == ' ' || r == ','
	})
	result := make([]string, 0, len(items))
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		value := strings.TrimSpace(item)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

func dedupeScopes(scopes []string) []string {
	if len(scopes) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(scopes))
	out := make([]string, 0, len(scopes))
	for _, scope := range scopes {
		trimmed := strings.TrimSpace(scope)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

func ensureOauthScopes(scopes []string) []string {
	requested := append([]string(nil), scopes...)
	requested = append(requested, oauthOfflineAccessScope)
	return dedupeScopes(requested)
}
