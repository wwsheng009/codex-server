package feishutools

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

// Feishu directory / IM endpoints used by the phase-1 read-only tools.
const (
	searchUserPath        = "/open-apis/search/v2/user"
	contactUserPath       = "/open-apis/contact/v3/users/%s"
	contactBatchGetIDPath = "/open-apis/contact/v3/users/batch_get_id"
	imChatSearchPath      = "/open-apis/im/v1/chats/search"
	imChatPath            = "/open-apis/im/v1/chats/%s"
	imChatMembersPath     = "/open-apis/im/v1/chats/%s/members"
)

// runSearchUser performs a directory search. Feishu's search surface requires
// a user token and the `contact:user:search` scope; we fail fast to avoid
// surfacing confusing tenant-token errors later.
func (s *Service) runSearchUser(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	query := strings.TrimSpace(stringParam(params, "query", "keyword", "q"))
	if query == "" {
		return nil, toolInvalidInput("query is required")
	}

	token, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	values := url.Values{}
	values.Set("query", query)
	if pageSize, ok := intParam(params, "pageSize", "page_size", "count", "limit"); ok && pageSize > 0 {
		values.Set("page_size", fmt.Sprintf("%d", pageSize))
	}
	if pageToken := strings.TrimSpace(stringParam(params, "pageToken", "page_token")); pageToken != "" {
		values.Set("page_token", pageToken)
	}

	var result struct {
		HasMore   bool             `json:"has_more"`
		PageToken string           `json:"page_token"`
		Users     []map[string]any `json:"users"`
	}
	if err := s.gateway.doJSON(ctx, "GET", searchUserPath, values, token.AccessToken, nil, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"query":     query,
		"hasMore":   result.HasMore,
		"pageToken": result.PageToken,
		"users":     result.Users,
		"principal": "user",
	}, nil
}

// runGetUser supports two actions: `default` (single user lookup by id) and
// `basic_batch` (batch_get_id by emails/mobiles). The default action prefers
// user token then falls back to tenant because tenant access is enough for
// open_id/user_id lookups.
func (s *Service) runGetUser(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "default":
		return s.runGetUserDefault(ctx, workspaceID, config, params)
	case "basic_batch":
		return s.runGetUserBasicBatch(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_get_user", action))
	}
}

func (s *Service) runGetUserDefault(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	userID := strings.TrimSpace(stringParam(params, "userId", "user_id"))
	if userID == "" {
		return nil, toolInvalidInput("userId is required")
	}
	idType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type"))
	if idType == "" {
		idType = "open_id"
	}

	values := url.Values{}
	values.Set("user_id_type", idType)
	if dept := strings.TrimSpace(stringParam(params, "departmentIdType", "department_id_type")); dept != "" {
		values.Set("department_id_type", dept)
	}

	var (
		token bearerChoice
		err   error
	)
	if isCurrentUserAlias(userID) {
		snapshot, snapshotErr := s.gateway.UserToken(ctx, workspaceID, config)
		if snapshotErr != nil {
			return nil, snapshotErr
		}
		token = bearerChoice{Token: snapshot.AccessToken, Principal: "user"}
	} else {
		token, err = s.userOrTenantToken(ctx, workspaceID, config)
		if err != nil {
			return nil, err
		}
	}

	var result struct {
		User map[string]any `json:"user"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(contactUserPath, url.PathEscape(userID)), values, token.Token, nil, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"userId":     userID,
		"userIdType": idType,
		"user":       result.User,
		"principal":  token.Principal,
	}, nil
}

func isCurrentUserAlias(userID string) bool {
	switch strings.TrimSpace(strings.ToLower(userID)) {
	case "self", "me":
		return true
	default:
		return false
	}
}

func (s *Service) runGetUserBasicBatch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	emails := stringSliceParam(params, "emails")
	mobiles := stringSliceParam(params, "mobiles")
	if len(emails) == 0 && len(mobiles) == 0 {
		return nil, toolInvalidInput("emails or mobiles is required")
	}

	body := map[string]any{}
	if len(emails) > 0 {
		body["emails"] = emails
	}
	if len(mobiles) > 0 {
		body["mobiles"] = mobiles
	}
	if includeResigned, ok := boolParam(params, "includeResigned", "include_resigned"); ok {
		body["include_resigned"] = includeResigned
	}

	values := url.Values{}
	idType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type"))
	if idType == "" {
		idType = "open_id"
	}
	values.Set("user_id_type", idType)

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		UserList []map[string]any `json:"user_list"`
	}
	if err := s.gateway.doJSON(ctx, "POST", contactBatchGetIDPath, values, token.Token, body, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"userIdType": idType,
		"users":      result.UserList,
		"principal":  token.Principal,
	}, nil
}

// runChat handles `search` and `get` actions for a chat.
func (s *Service) runChat(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "search":
		return s.runChatSearch(ctx, workspaceID, config, params)
	case "get":
		return s.runChatGet(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_chat", action))
	}
}

func (s *Service) runChatSearch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	query := strings.TrimSpace(stringParam(params, "query", "keyword", "q"))
	values := url.Values{}
	if query != "" {
		values.Set("query", query)
	}
	if pageSize, ok := intParam(params, "pageSize", "page_size", "count", "limit"); ok && pageSize > 0 {
		values.Set("page_size", fmt.Sprintf("%d", pageSize))
	}
	if pageToken := strings.TrimSpace(stringParam(params, "pageToken", "page_token")); pageToken != "" {
		values.Set("page_token", pageToken)
	}

	// Chat search is inherently user-scoped (only chats the caller is in are
	// returned). Fail fast if no user token is available.
	token, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		HasMore   bool             `json:"has_more"`
		PageToken string           `json:"page_token"`
		Items     []map[string]any `json:"items"`
	}
	if err := s.gateway.doJSON(ctx, "GET", imChatSearchPath, values, token.AccessToken, nil, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"query":     query,
		"hasMore":   result.HasMore,
		"pageToken": result.PageToken,
		"items":     result.Items,
		"principal": "user",
	}, nil
}

func (s *Service) runChatGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	chatID := strings.TrimSpace(stringParam(params, "chatId", "chat_id"))
	if chatID == "" {
		return nil, toolInvalidInput("chatId is required")
	}
	values := url.Values{}
	if idType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); idType != "" {
		values.Set("user_id_type", idType)
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var chat map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(imChatPath, url.PathEscape(chatID)), values, token.Token, nil, &chat); err != nil {
		return nil, err
	}
	return map[string]any{
		"chatId":    chatID,
		"chat":      chat,
		"principal": token.Principal,
	}, nil
}

// runChatMembers lists members of a chat with pagination.
func (s *Service) runChatMembers(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	chatID := strings.TrimSpace(stringParam(params, "chatId", "chat_id"))
	if chatID == "" {
		return nil, toolInvalidInput("chatId is required")
	}

	values := url.Values{}
	if idType := strings.TrimSpace(stringParam(params, "memberIdType", "member_id_type")); idType != "" {
		values.Set("member_id_type", idType)
	}
	if pageSize, ok := intParam(params, "pageSize", "page_size", "count", "limit"); ok && pageSize > 0 {
		values.Set("page_size", fmt.Sprintf("%d", pageSize))
	}
	if pageToken := strings.TrimSpace(stringParam(params, "pageToken", "page_token")); pageToken != "" {
		values.Set("page_token", pageToken)
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		HasMore     bool             `json:"has_more"`
		PageToken   string           `json:"page_token"`
		MemberTotal int              `json:"member_total"`
		Items       []map[string]any `json:"items"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(imChatMembersPath, url.PathEscape(chatID)), values, token.Token, nil, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"chatId":      chatID,
		"hasMore":     result.HasMore,
		"pageToken":   result.PageToken,
		"memberTotal": result.MemberTotal,
		"items":       result.Items,
		"principal":   token.Principal,
	}, nil
}
