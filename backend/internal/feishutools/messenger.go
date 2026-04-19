package feishutools

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/url"
	"strings"
)

// Feishu IM endpoints consumed by the phase-1 read-only messenger tools.
const (
	imMessagesListPath       = "/open-apis/im/v1/messages"
	imMessagePathTemplate    = "/open-apis/im/v1/messages/%s"
	imThreadPathTemplate     = "/open-apis/im/v1/messages/%s/reply"
	imResourcePathTemplate   = "/open-apis/im/v1/messages/%s/resources/%s"
	imDefaultPageSize        = 20
	imMaxPageSize            = 50
	imDefaultResourceMaxSize = 5 * 1024 * 1024
)

func (s *Service) runIMUserMessage(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "send":
		return s.runIMUserSendMessage(ctx, workspaceID, config, params)
	case "reply":
		return s.runIMUserReplyMessage(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_im_user_message", action))
	}
}

func (s *Service) runIMUserSendMessage(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	receiveIDType := strings.TrimSpace(stringParam(params, "receiveIdType", "receive_id_type"))
	if receiveIDType == "" {
		return nil, toolInvalidInput("receiveIdType is required")
	}
	if receiveIDType != "open_id" && receiveIDType != "chat_id" {
		return nil, toolInvalidInput(fmt.Sprintf("unsupported receiveIdType %q; expected open_id|chat_id", receiveIDType))
	}

	receiveID := strings.TrimSpace(stringParam(params, "receiveId", "receive_id"))
	if receiveID == "" {
		return nil, toolInvalidInput("receiveId is required")
	}
	msgType := strings.TrimSpace(stringParam(params, "msgType", "msg_type"))
	if msgType == "" {
		return nil, toolInvalidInput("msgType is required")
	}
	content, ok := rawStringParam(params, "content")
	if !ok || strings.TrimSpace(content) == "" {
		return nil, toolInvalidInput("content is required")
	}

	user, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	query := url.Values{}
	query.Set("receive_id_type", receiveIDType)
	body := map[string]any{
		"receive_id": receiveID,
		"msg_type":   msgType,
		"content":    content,
	}
	if uuid := strings.TrimSpace(stringParam(params, "uuid")); uuid != "" {
		body["uuid"] = uuid
	}

	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", imMessagesListPath, query, user.AccessToken, body, &result); err != nil {
		return nil, err
	}
	result["receiveId"] = receiveID
	result["receiveIdType"] = receiveIDType
	result["principal"] = "user"
	return result, nil
}

func (s *Service) runIMUserReplyMessage(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	messageID := strings.TrimSpace(stringParam(params, "messageId", "message_id"))
	if messageID == "" {
		return nil, toolInvalidInput("messageId is required")
	}
	msgType := strings.TrimSpace(stringParam(params, "msgType", "msg_type"))
	if msgType == "" {
		return nil, toolInvalidInput("msgType is required")
	}
	content, ok := rawStringParam(params, "content")
	if !ok || strings.TrimSpace(content) == "" {
		return nil, toolInvalidInput("content is required")
	}

	user, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	body := map[string]any{
		"msg_type": msgType,
		"content":  content,
	}
	if replyInThread, ok := boolParam(params, "replyInThread", "reply_in_thread"); ok {
		body["reply_in_thread"] = replyInThread
	}
	if uuid := strings.TrimSpace(stringParam(params, "uuid")); uuid != "" {
		body["uuid"] = uuid
	}

	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(imThreadPathTemplate, url.PathEscape(messageID)), nil, user.AccessToken, body, &result); err != nil {
		return nil, err
	}
	result["repliedToMessageId"] = messageID
	result["principal"] = "user"
	return result, nil
}

// runIMSearchMessages lists messages for a chat container. Feishu does not
// expose a full-text search endpoint on the IM surface; to keep callers
// honest we perform the list call and let them filter by `start_time` /
// `end_time` / sender rather than pretending to full-text search. A
// client-side `queryContains` filter is applied as a convenience.
func (s *Service) runIMSearchMessages(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	containerID := strings.TrimSpace(stringParam(params, "containerId", "container_id", "chatId", "chat_id"))
	if containerID == "" {
		return nil, toolInvalidInput("containerId is required")
	}

	query := url.Values{}
	containerType := strings.TrimSpace(stringParam(params, "containerIdType", "container_id_type"))
	if containerType == "" {
		containerType = "chat"
	}
	query.Set("container_id_type", containerType)
	query.Set("container_id", containerID)

	pageSize := imDefaultPageSize
	if value, ok := intParam(params, "pageSize", "page_size", "count", "limit"); ok && value > 0 {
		pageSize = value
	}
	if pageSize > imMaxPageSize {
		pageSize = imMaxPageSize
	}
	query.Set("page_size", fmt.Sprintf("%d", pageSize))

	if pageToken := strings.TrimSpace(stringParam(params, "pageToken", "page_token")); pageToken != "" {
		query.Set("page_token", pageToken)
	}
	if startTime := strings.TrimSpace(stringParam(params, "startTime", "start_time")); startTime != "" {
		query.Set("start_time", startTime)
	}
	if endTime := strings.TrimSpace(stringParam(params, "endTime", "end_time")); endTime != "" {
		query.Set("end_time", endTime)
	}
	if sortType := strings.TrimSpace(stringParam(params, "sortType", "sort_type")); sortType != "" {
		query.Set("sort_type", sortType)
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		HasMore   bool             `json:"has_more"`
		PageToken string           `json:"page_token"`
		Items     []map[string]any `json:"items"`
	}
	if err := s.gateway.doJSON(ctx, "GET", imMessagesListPath, query, token.Token, nil, &result); err != nil {
		return nil, err
	}

	filtered := result.Items
	if needle := strings.TrimSpace(stringParam(params, "queryContains", "query")); needle != "" {
		filtered = filterMessagesByText(result.Items, needle)
	}

	return map[string]any{
		"containerId":     containerID,
		"containerIdType": containerType,
		"pageSize":        pageSize,
		"hasMore":         result.HasMore,
		"pageToken":       result.PageToken,
		"items":           filtered,
		"totalReturned":   len(filtered),
		"principal":       token.Principal,
	}, nil
}

// runIMGetMessage fetches a single message envelope by id.
func (s *Service) runIMGetMessage(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	messageID := strings.TrimSpace(stringParam(params, "messageId", "message_id"))
	if messageID == "" {
		return nil, toolInvalidInput("messageId is required")
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		Items []map[string]any `json:"items"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(imMessagePathTemplate, url.PathEscape(messageID)), nil, token.Token, nil, &result); err != nil {
		return nil, err
	}
	var first map[string]any
	if len(result.Items) > 0 {
		first = result.Items[0]
	}
	return map[string]any{
		"messageId": messageID,
		"message":   first,
		"items":     result.Items,
		"principal": token.Principal,
	}, nil
}

// runIMGetThreadMessages returns the reply chain of a parent message. This
// mirrors the Lark "thread" concept and is enough for summarizing a thread
// without needing the beta `/threads/{id}` endpoint.
func (s *Service) runIMGetThreadMessages(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	messageID := strings.TrimSpace(stringParam(params, "messageId", "message_id", "rootMessageId", "root_message_id"))
	if messageID == "" {
		return nil, toolInvalidInput("messageId is required")
	}

	query := url.Values{}
	pageSize := imDefaultPageSize
	if value, ok := intParam(params, "pageSize", "page_size", "count"); ok && value > 0 {
		pageSize = value
	}
	if pageSize > imMaxPageSize {
		pageSize = imMaxPageSize
	}
	query.Set("page_size", fmt.Sprintf("%d", pageSize))
	if pageToken := strings.TrimSpace(stringParam(params, "pageToken", "page_token")); pageToken != "" {
		query.Set("page_token", pageToken)
	}
	if sortType := strings.TrimSpace(stringParam(params, "sortType", "sort_type")); sortType != "" {
		query.Set("sort_type", sortType)
	}

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	var result struct {
		HasMore   bool             `json:"has_more"`
		PageToken string           `json:"page_token"`
		Items     []map[string]any `json:"items"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(imThreadPathTemplate, url.PathEscape(messageID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	return map[string]any{
		"messageId": messageID,
		"pageSize":  pageSize,
		"hasMore":   result.HasMore,
		"pageToken": result.PageToken,
		"items":     result.Items,
		"principal": token.Principal,
	}, nil
}

// runIMFetchResource downloads a file/image attachment. The binary payload is
// returned base64-encoded inside the invoke envelope so it can cross the JSON
// boundary. A hard cap keeps a single call from exhausting memory; callers
// can request a smaller cap via `maxBytes`.
func (s *Service) runIMFetchResource(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	messageID := strings.TrimSpace(stringParam(params, "messageId", "message_id"))
	if messageID == "" {
		return nil, toolInvalidInput("messageId is required")
	}
	fileKey := strings.TrimSpace(stringParam(params, "fileKey", "file_key"))
	if fileKey == "" {
		return nil, toolInvalidInput("fileKey is required")
	}
	resourceType := strings.TrimSpace(stringParam(params, "type", "resourceType", "resource_type"))
	if resourceType == "" {
		resourceType = "file"
	}
	if resourceType != "file" && resourceType != "image" {
		return nil, toolInvalidInput(fmt.Sprintf("unsupported resource type %q; expected file|image", resourceType))
	}

	maxBytes := imDefaultResourceMaxSize
	if value, ok := intParam(params, "maxBytes", "max_bytes"); ok && value > 0 {
		maxBytes = value
	}
	if maxBytes > imDefaultResourceMaxSize {
		maxBytes = imDefaultResourceMaxSize
	}

	query := url.Values{}
	query.Set("type", resourceType)

	token, err := s.userOrTenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	download, err := s.gateway.downloadResource(
		ctx,
		fmt.Sprintf(imResourcePathTemplate, url.PathEscape(messageID), url.PathEscape(fileKey)),
		query,
		token.Token,
		maxBytes,
	)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"messageId":   messageID,
		"fileKey":     fileKey,
		"type":        resourceType,
		"contentType": download.ContentType,
		"sizeBytes":   download.SizeBytes,
		"truncated":   download.Truncated,
		"bodyBase64":  base64.StdEncoding.EncodeToString(download.Bytes),
		"principal":   token.Principal,
	}, nil
}

func (s *Service) runIMBotImage(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	messageID := strings.TrimSpace(stringParam(params, "messageId", "message_id"))
	if messageID == "" {
		return nil, toolInvalidInput("messageId is required")
	}
	fileKey := strings.TrimSpace(stringParam(params, "fileKey", "file_key"))
	if fileKey == "" {
		return nil, toolInvalidInput("fileKey is required")
	}
	resourceType := strings.TrimSpace(stringParam(params, "type", "resourceType", "resource_type"))
	if resourceType == "" {
		resourceType = "image"
	}
	if resourceType != "image" && resourceType != "file" {
		return nil, toolInvalidInput(fmt.Sprintf("unsupported resource type %q; expected image|file", resourceType))
	}

	maxBytes := imDefaultResourceMaxSize
	if value, ok := intParam(params, "maxBytes", "max_bytes"); ok && value > 0 {
		maxBytes = value
	}
	if maxBytes > imDefaultResourceMaxSize {
		maxBytes = imDefaultResourceMaxSize
	}

	query := url.Values{}
	query.Set("type", resourceType)

	token, err := s.gateway.TenantToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	download, err := s.gateway.downloadResource(
		ctx,
		fmt.Sprintf(imResourcePathTemplate, url.PathEscape(messageID), url.PathEscape(fileKey)),
		query,
		token,
		maxBytes,
	)
	if err != nil {
		return nil, err
	}

	return map[string]any{
		"messageId":   messageID,
		"fileKey":     fileKey,
		"type":        resourceType,
		"contentType": download.ContentType,
		"sizeBytes":   download.SizeBytes,
		"truncated":   download.Truncated,
		"bodyBase64":  base64.StdEncoding.EncodeToString(download.Bytes),
		"principal":   "bot",
	}, nil
}

// filterMessagesByText applies a best-effort substring filter over the text
// run content of each message. It is intentionally tolerant because Feishu
// messages can arrive in many content shapes; anything we cannot inspect we
// keep.
func filterMessagesByText(items []map[string]any, needle string) []map[string]any {
	lowered := strings.ToLower(needle)
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		body, ok := item["body"].(map[string]any)
		if !ok {
			out = append(out, item)
			continue
		}
		content, ok := body["content"].(string)
		if !ok {
			out = append(out, item)
			continue
		}
		if strings.Contains(strings.ToLower(content), lowered) {
			out = append(out, item)
		}
	}
	return out
}
