package feishutools

import (
	"context"
	"fmt"
	"strings"
)

const oauthBatchScopeLimit = 100

func (s *Service) runOauthTool(ctx context.Context, workspaceID string, _ Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "status":
		return s.runOauthStatusTool(ctx, workspaceID)
	case "login", "authorize":
		return s.runOauthLoginTool(ctx, workspaceID, params)
	case "revoke":
		return s.runOauthRevokeTool(ctx, workspaceID)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_oauth", action))
	}
}

func (s *Service) runOauthStatusTool(ctx context.Context, workspaceID string) (map[string]any, error) {
	state, err := s.OauthStatus(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	return authStateToMap(state), nil
}

func (s *Service) runOauthLoginTool(ctx context.Context, workspaceID string, params map[string]any) (map[string]any, error) {
	requestedScopes := normalizeScopes(readScopeParams(params))
	login, err := s.OauthLogin(ctx, workspaceID, requestedScopes)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"authorizationUrl": login.AuthorizationURL,
		"requestedScopes":  ensureOauthScopes(requestedScopes),
		"principal":        "user",
	}, nil
}

func (s *Service) runOauthRevokeTool(ctx context.Context, workspaceID string) (map[string]any, error) {
	state, err := s.OauthRevoke(ctx, workspaceID)
	if err != nil {
		return nil, err
	}
	result := authStateToMap(state)
	result["revoked"] = true
	return result, nil
}

func (s *Service) runOauthBatchAuth(ctx context.Context, workspaceID string, config Config, _ map[string]any) (map[string]any, error) {
	permissions := buildPermissions(config)
	requestedScopes := make([]string, 0, len(permissions.MissingScopes))
	for _, scope := range permissions.MissingScopes {
		if isRequiredAppScope(scope) || isSensitiveScope(scope) {
			continue
		}
		requestedScopes = append(requestedScopes, scope)
	}
	requestedScopes = normalizeScopes(requestedScopes)

	if len(requestedScopes) == 0 {
		return map[string]any{
			"alreadyAuthorized": true,
			"missingScopes":     []string{},
			"requestedScopes":   []string{},
			"principal":         "user",
		}, nil
	}

	requestedNow := requestedScopes
	remaining := 0
	if len(requestedNow) > oauthBatchScopeLimit {
		requestedNow = append([]string(nil), requestedNow[:oauthBatchScopeLimit]...)
		remaining = len(requestedScopes) - len(requestedNow)
	}

	login, err := s.OauthLogin(ctx, workspaceID, requestedNow)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"authorizationUrl":  login.AuthorizationURL,
		"alreadyAuthorized": false,
		"missingScopes":     requestedScopes,
		"requestedScopes":   ensureOauthScopes(requestedNow),
		"remainingScopes":   remaining,
		"principal":         "user",
	}, nil
}

func authStateToMap(state AuthState) map[string]any {
	result := map[string]any{
		"status":        state.Status,
		"principalType": state.PrincipalType,
	}
	if state.AccountName != "" {
		result["accountName"] = state.AccountName
	}
	if state.AccountID != "" {
		result["accountId"] = state.AccountID
	}
	if state.OpenID != "" {
		result["openId"] = state.OpenID
	}
	if state.UnionID != "" {
		result["unionId"] = state.UnionID
	}
	if state.HasAccessToken {
		result["hasAccessToken"] = true
	}
	if state.HasRefreshToken {
		result["hasRefreshToken"] = true
	}
	if state.AccessTokenPreview != "" {
		result["accessTokenPreview"] = state.AccessTokenPreview
	}
	if state.RefreshTokenPreview != "" {
		result["refreshTokenPreview"] = state.RefreshTokenPreview
	}
	if state.ObtainedAt != "" {
		result["obtainedAt"] = state.ObtainedAt
	}
	if state.ExpiresAt != "" {
		result["expiresAt"] = state.ExpiresAt
	}
	if state.RefreshExpires != "" {
		result["refreshExpiresAt"] = state.RefreshExpires
	}
	if len(state.GrantedScopes) > 0 {
		result["grantedScopes"] = append([]string(nil), state.GrantedScopes...)
	}
	if state.CallbackURL != "" {
		result["callbackUrl"] = state.CallbackURL
	}
	result["principal"] = "user"
	return result
}

func readScopeParams(params map[string]any) []string {
	if len(params) == 0 {
		return nil
	}
	if raw, ok := params["scopes"]; ok {
		if scopes := anyStringSlice(raw); len(scopes) > 0 {
			return scopes
		}
	}
	if raw, ok := params["scope"]; ok {
		if scopes := anyStringSlice(raw); len(scopes) > 0 {
			return scopes
		}
		if text, ok := raw.(string); ok {
			return splitScopes(text)
		}
	}
	return nil
}

func anyStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return append([]string(nil), typed...)
	case []any:
		result := make([]string, 0, len(typed))
		for _, item := range typed {
			text, ok := item.(string)
			if !ok {
				continue
			}
			if trimmed := strings.TrimSpace(text); trimmed != "" {
				result = append(result, trimmed)
			}
		}
		return result
	default:
		return nil
	}
}
