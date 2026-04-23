package accesscontrol

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

const (
	sessionCookieName                       = "codex_server_access"
	sessionMaxAge                           = 30 * 24 * time.Hour
	tokenHashPrefixLength                   = 4
	tokenHashSuffixLength                   = 4
	tokenPreviewFallback                    = "****"
	DefaultAllowLocalhostWithoutAccessToken = true
)

var (
	ErrLoginRequired       = errors.New("access login is required")
	ErrSessionInvalid      = errors.New("access session is invalid")
	ErrAccessTokenRequired = errors.New("access token is required")
	ErrAccessTokenInvalid  = errors.New("access token is invalid")
)

type Service struct {
	store              *store.MemoryStore
	defaultAllowRemote bool
	now                func() time.Time
}

type RemoteAccessDecision struct {
	Allowed bool
	Reason  string
}

type BootstrapResult struct {
	Authenticated                    bool `json:"authenticated"`
	LoginRequired                    bool `json:"loginRequired"`
	AllowRemoteAccess                bool `json:"allowRemoteAccess"`
	AllowLocalhostWithoutAccessToken bool `json:"allowLocalhostWithoutAccessToken"`
	ConfiguredTokenCount             int  `json:"configuredTokenCount"`
	ActiveTokenCount                 int  `json:"activeTokenCount"`
}

type TokenInput struct {
	ID        string `json:"id,omitempty"`
	Label     string `json:"label,omitempty"`
	Token     string `json:"token,omitempty"`
	ExpiresAt string `json:"expiresAt,omitempty"`
	Permanent bool   `json:"permanent,omitempty"`
}

type TokenDescriptor struct {
	ID           string     `json:"id"`
	Label        string     `json:"label,omitempty"`
	TokenPreview string     `json:"tokenPreview,omitempty"`
	ExpiresAt    *time.Time `json:"expiresAt,omitempty"`
	Permanent    bool       `json:"permanent"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"createdAt,omitempty"`
	UpdatedAt    time.Time  `json:"updatedAt,omitempty"`
}

const (
	RemoteAccessReasonDisabled            = "remote_access_disabled"
	RemoteAccessReasonRequiresActiveToken = "remote_access_requires_active_token"
)

func NewService(dataStore *store.MemoryStore, defaultAllowRemoteAccess bool) *Service {
	return &Service{
		store:              dataStore,
		defaultAllowRemote: defaultAllowRemoteAccess,
		now: func() time.Time {
			return time.Now().UTC()
		},
	}
}

func (s *Service) EffectiveAllowRemoteAccess() bool {
	prefs := s.store.GetRuntimePreferences()
	if prefs.AllowRemoteAccess != nil {
		return *prefs.AllowRemoteAccess
	}
	return s.defaultAllowRemote
}

func (s *Service) EffectiveAllowLocalhostWithoutAccessToken() bool {
	prefs := s.store.GetRuntimePreferences()
	if prefs.AllowLocalhostWithoutAccessToken != nil {
		return *prefs.AllowLocalhostWithoutAccessToken
	}
	return DefaultAllowLocalhostWithoutAccessToken
}

func (s *Service) EvaluateRemoteAccess(remoteAddr string) RemoteAccessDecision {
	if IsLoopbackRemoteAddr(remoteAddr) {
		return RemoteAccessDecision{Allowed: true}
	}

	if !s.EffectiveAllowRemoteAccess() {
		return RemoteAccessDecision{
			Allowed: false,
			Reason:  RemoteAccessReasonDisabled,
		}
	}

	now := s.now()
	tokens, err := NormalizeConfiguredTokens(s.store.GetRuntimePreferences().AccessTokens, now)
	if err != nil || !HasActiveTokens(tokens, now) {
		return RemoteAccessDecision{
			Allowed: false,
			Reason:  RemoteAccessReasonRequiresActiveToken,
		}
	}

	return RemoteAccessDecision{Allowed: true}
}

func (s *Service) Bootstrap(r *http.Request, remoteAddr string) BootstrapResult {
	now := s.now()
	prefs := s.store.GetRuntimePreferences()
	tokens, _ := NormalizeConfiguredTokens(prefs.AccessTokens, now)
	loginRequired := s.loginRequired(remoteAddr, tokens, now)

	return BootstrapResult{
		Authenticated:                    !loginRequired || s.authenticateRequest(r, tokens, now),
		LoginRequired:                    loginRequired,
		AllowRemoteAccess:                s.resolveAllowRemoteAccess(prefs.AllowRemoteAccess),
		AllowLocalhostWithoutAccessToken: s.EffectiveAllowLocalhostWithoutAccessToken(),
		ConfiguredTokenCount:             len(tokens),
		ActiveTokenCount:                 CountActiveTokens(tokens, now),
	}
}

func (s *Service) RequireAccess(r *http.Request, remoteAddr string) error {
	if s.shouldBypassAccessTokenForLocalhost(remoteAddr) {
		return nil
	}

	now := s.now()
	prefs := s.store.GetRuntimePreferences()
	tokens, err := NormalizeConfiguredTokens(prefs.AccessTokens, now)
	if err != nil {
		return ErrSessionInvalid
	}

	if !HasActiveTokens(tokens, now) {
		return nil
	}

	if s.authenticateRequest(r, tokens, now) {
		return nil
	}

	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return ErrLoginRequired
	}

	return ErrSessionInvalid
}

func (s *Service) Login(
	w http.ResponseWriter,
	r *http.Request,
	remoteAddr string,
	rawToken string,
) (BootstrapResult, error) {
	now := s.now()
	trimmedToken := strings.TrimSpace(rawToken)
	if trimmedToken == "" {
		return BootstrapResult{}, ErrAccessTokenRequired
	}

	prefs := s.store.GetRuntimePreferences()
	tokens, err := NormalizeConfiguredTokens(prefs.AccessTokens, now)
	if err != nil {
		return BootstrapResult{}, ErrAccessTokenInvalid
	}

	token, ok := MatchActiveToken(trimmedToken, tokens, now)
	if !ok {
		return BootstrapResult{}, ErrAccessTokenInvalid
	}

	setSessionCookie(w, r, token, tokens, now)
	return BootstrapResult{
		Authenticated:                    true,
		LoginRequired:                    s.loginRequired(remoteAddr, tokens, now),
		AllowRemoteAccess:                s.resolveAllowRemoteAccess(prefs.AllowRemoteAccess),
		AllowLocalhostWithoutAccessToken: s.EffectiveAllowLocalhostWithoutAccessToken(),
		ConfiguredTokenCount:             len(tokens),
		ActiveTokenCount:                 CountActiveTokens(tokens, now),
	}, nil
}

func (s *Service) Logout(w http.ResponseWriter, r *http.Request) {
	clearSessionCookie(w, r)
}

func (s *Service) resolveAllowRemoteAccess(value *bool) bool {
	if value != nil {
		return *value
	}
	return s.defaultAllowRemote
}

func (s *Service) authenticateRequest(r *http.Request, tokens []store.AccessToken, now time.Time) bool {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return false
	}

	_, ok := validateSessionCookie(cookie.Value, tokens, now)
	return ok
}

func (s *Service) shouldBypassAccessTokenForLocalhost(remoteAddr string) bool {
	return s.EffectiveAllowLocalhostWithoutAccessToken() && IsLoopbackRemoteAddr(remoteAddr)
}

func (s *Service) loginRequired(remoteAddr string, tokens []store.AccessToken, now time.Time) bool {
	if !HasActiveTokens(tokens, now) {
		return false
	}

	return !s.shouldBypassAccessTokenForLocalhost(remoteAddr)
}

func NormalizeConfiguredTokens(tokens []store.AccessToken, now time.Time) ([]store.AccessToken, error) {
	if len(tokens) == 0 {
		return nil, nil
	}

	normalized := make([]store.AccessToken, 0, len(tokens))
	seenIDs := make(map[string]struct{}, len(tokens))
	seenHashes := make(map[string]struct{}, len(tokens))
	for _, token := range tokens {
		id := strings.TrimSpace(token.ID)
		hash := strings.TrimSpace(token.TokenHash)
		if id == "" || hash == "" {
			return nil, errors.New("configured access token is missing required id or token hash")
		}

		if _, ok := seenIDs[id]; ok {
			return nil, fmt.Errorf("duplicate configured access token id %q", id)
		}
		seenIDs[id] = struct{}{}

		if _, ok := seenHashes[hash]; ok {
			return nil, errors.New("duplicate configured access token value is not allowed")
		}
		seenHashes[hash] = struct{}{}

		next := token
		next.ID = id
		next.Label = strings.TrimSpace(token.Label)
		next.TokenHash = hash
		next.TokenPreview = strings.TrimSpace(token.TokenPreview)
		if next.ExpiresAt != nil {
			expiry := next.ExpiresAt.UTC()
			next.ExpiresAt = &expiry
		}
		if next.CreatedAt.IsZero() {
			next.CreatedAt = next.UpdatedAt
		}
		if next.UpdatedAt.IsZero() {
			next.UpdatedAt = next.CreatedAt
		}
		normalized = append(normalized, next)
	}

	sort.Slice(normalized, func(i int, j int) bool {
		if normalized[i].CreatedAt.Equal(normalized[j].CreatedAt) {
			return normalized[i].ID < normalized[j].ID
		}
		if normalized[i].CreatedAt.IsZero() {
			return false
		}
		if normalized[j].CreatedAt.IsZero() {
			return true
		}
		return normalized[i].CreatedAt.Before(normalized[j].CreatedAt)
	})

	return normalized, nil
}

func ApplyTokenInputs(
	existing []store.AccessToken,
	inputs []TokenInput,
	now time.Time,
) ([]store.AccessToken, error) {
	normalizedExisting, err := NormalizeConfiguredTokens(existing, now)
	if err != nil {
		return nil, err
	}

	existingByID := make(map[string]store.AccessToken, len(normalizedExisting))
	for _, token := range normalizedExisting {
		existingByID[token.ID] = token
	}

	next := make([]store.AccessToken, 0, len(inputs))
	for _, input := range inputs {
		id := strings.TrimSpace(input.ID)
		label := strings.TrimSpace(input.Label)
		rawToken := strings.TrimSpace(input.Token)
		expiresAtRaw := strings.TrimSpace(input.ExpiresAt)

		if id == "" && label == "" && rawToken == "" && expiresAtRaw == "" && !input.Permanent {
			continue
		}

		existingToken, hasExisting := existingByID[id]
		if id != "" && !hasExisting {
			return nil, fmt.Errorf("access token %q was not found", id)
		}
		if !hasExisting && rawToken == "" {
			return nil, errors.New("new access tokens must include a token value")
		}

		tokenHash := existingToken.TokenHash
		tokenPreview := existingToken.TokenPreview
		if rawToken != "" {
			tokenHash = hashToken(rawToken)
			tokenPreview = previewToken(rawToken)
		}
		if tokenHash == "" {
			return nil, errors.New("access token hash cannot be empty")
		}

		expiresAt, err := parseTokenExpiry(expiresAtRaw, input.Permanent)
		if err != nil {
			return nil, err
		}
		if expiresAt != nil && !expiresAt.After(now) {
			return nil, errors.New("access token expiry must be in the future")
		}

		tokenID := existingToken.ID
		if tokenID == "" {
			store.SeedIDCounter(maxConfiguredTokenIDSuffix(normalizedExisting, next))
			tokenID = store.NewID("atk")
		}

		createdAt := existingToken.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}

		next = append(next, store.AccessToken{
			ID:           tokenID,
			Label:        label,
			TokenHash:    tokenHash,
			TokenPreview: tokenPreview,
			ExpiresAt:    expiresAt,
			CreatedAt:    createdAt,
			UpdatedAt:    now,
		})
	}

	if _, err := NormalizeConfiguredTokens(next, now); err != nil {
		return nil, err
	}

	return next, nil
}

func maxConfiguredTokenIDSuffix(groups ...[]store.AccessToken) uint64 {
	var maxID uint64
	for _, group := range groups {
		for _, token := range group {
			if value := store.NumericIDSuffix(token.ID); value > maxID {
				maxID = value
			}
		}
	}
	return maxID
}

func DescribeTokens(tokens []store.AccessToken, now time.Time) []TokenDescriptor {
	if len(tokens) == 0 {
		return nil
	}

	descriptors := make([]TokenDescriptor, 0, len(tokens))
	for _, token := range tokens {
		descriptors = append(descriptors, TokenDescriptor{
			ID:           token.ID,
			Label:        token.Label,
			TokenPreview: token.TokenPreview,
			ExpiresAt:    cloneOptionalTime(token.ExpiresAt),
			Permanent:    token.ExpiresAt == nil,
			Status:       tokenStatus(token, now),
			CreatedAt:    token.CreatedAt,
			UpdatedAt:    token.UpdatedAt,
		})
	}
	return descriptors
}

func HasActiveTokens(tokens []store.AccessToken, now time.Time) bool {
	return CountActiveTokens(tokens, now) > 0
}

func CountActiveTokens(tokens []store.AccessToken, now time.Time) int {
	count := 0
	for _, token := range tokens {
		if tokenIsActive(token, now) {
			count++
		}
	}
	return count
}

func MatchActiveToken(rawToken string, tokens []store.AccessToken, now time.Time) (store.AccessToken, bool) {
	tokenHash := hashToken(rawToken)
	for _, token := range tokens {
		if token.TokenHash == tokenHash && tokenIsActive(token, now) {
			return token, true
		}
	}
	return store.AccessToken{}, false
}

func IsLoopbackRemoteAddr(remoteAddr string) bool {
	host := strings.TrimSpace(remoteAddr)
	if host == "" {
		return false
	}

	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}

	host = strings.Trim(host, "[]")
	if strings.EqualFold(host, "localhost") {
		return true
	}

	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func setSessionCookie(
	w http.ResponseWriter,
	r *http.Request,
	token store.AccessToken,
	tokens []store.AccessToken,
	now time.Time,
) {
	expiresAt := now.Add(sessionMaxAge)
	if token.ExpiresAt != nil && token.ExpiresAt.Before(expiresAt) {
		expiresAt = token.ExpiresAt.UTC()
	}

	payload := fmt.Sprintf(
		"%s|%d|%s",
		token.ID,
		expiresAt.Unix(),
		signSession(token.ID, expiresAt.Unix(), tokens),
	)
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    base64.RawURLEncoding.EncodeToString([]byte(payload)),
		Path:     "/",
		Expires:  expiresAt,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(0, 0).UTC(),
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   r.TLS != nil,
	})
}

func validateSessionCookie(value string, tokens []store.AccessToken, now time.Time) (store.AccessToken, bool) {
	decoded, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return store.AccessToken{}, false
	}

	parts := strings.Split(string(decoded), "|")
	if len(parts) != 3 {
		return store.AccessToken{}, false
	}

	tokenID := strings.TrimSpace(parts[0])
	if tokenID == "" {
		return store.AccessToken{}, false
	}

	expiresUnix, err := strconv.ParseInt(strings.TrimSpace(parts[1]), 10, 64)
	if err != nil {
		return store.AccessToken{}, false
	}

	expiresAt := time.Unix(expiresUnix, 0).UTC()
	if !expiresAt.After(now) {
		return store.AccessToken{}, false
	}

	expectedSignature := signSession(tokenID, expiresUnix, tokens)
	if !hmac.Equal([]byte(expectedSignature), []byte(strings.TrimSpace(parts[2]))) {
		return store.AccessToken{}, false
	}

	for _, token := range tokens {
		if token.ID != tokenID {
			continue
		}
		if !tokenIsActive(token, now) {
			return store.AccessToken{}, false
		}
		return token, true
	}

	return store.AccessToken{}, false
}

func signSession(tokenID string, expiresUnix int64, tokens []store.AccessToken) string {
	key := signingKey(tokens)
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(tokenID))
	_, _ = mac.Write([]byte{'\n'})
	_, _ = mac.Write([]byte(strconv.FormatInt(expiresUnix, 10)))
	return hex.EncodeToString(mac.Sum(nil))
}

func signingKey(tokens []store.AccessToken) []byte {
	mac := hmac.New(sha256.New, []byte("codex-server-access-session"))
	sorted := make([]store.AccessToken, len(tokens))
	copy(sorted, tokens)
	sort.Slice(sorted, func(i int, j int) bool {
		return sorted[i].ID < sorted[j].ID
	})
	for _, token := range sorted {
		_, _ = mac.Write([]byte(token.ID))
		_, _ = mac.Write([]byte{'\n'})
		_, _ = mac.Write([]byte(token.TokenHash))
		_, _ = mac.Write([]byte{'\n'})
		if token.ExpiresAt != nil {
			_, _ = mac.Write([]byte(token.ExpiresAt.UTC().Format(time.RFC3339Nano)))
		}
		_, _ = mac.Write([]byte{'\n'})
	}
	return mac.Sum(nil)
}

func parseTokenExpiry(value string, permanent bool) (*time.Time, error) {
	if permanent || strings.TrimSpace(value) == "" {
		return nil, nil
	}

	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(value))
	if err != nil {
		return nil, errors.New("access token expiresAt must use RFC3339 format")
	}
	expiry := parsed.UTC()
	return &expiry, nil
}

func tokenIsActive(token store.AccessToken, now time.Time) bool {
	if token.ExpiresAt == nil {
		return true
	}
	return token.ExpiresAt.After(now)
}

func tokenStatus(token store.AccessToken, now time.Time) string {
	if tokenIsActive(token, now) {
		return "active"
	}
	return "expired"
}

func hashToken(raw string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(raw)))
	return hex.EncodeToString(sum[:])
}

func previewToken(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return tokenPreviewFallback
	}

	if len(trimmed) <= tokenHashPrefixLength+tokenHashSuffixLength {
		return tokenPreviewFallback
	}

	return trimmed[:tokenHashPrefixLength] + "..." + trimmed[len(trimmed)-tokenHashSuffixLength:]
}

func cloneOptionalTime(value *time.Time) *time.Time {
	if value == nil {
		return nil
	}

	cloned := value.UTC()
	return &cloned
}
