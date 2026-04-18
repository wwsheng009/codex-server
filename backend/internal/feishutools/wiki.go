package feishutools

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

const (
	wikiSpacesPath                = "/open-apis/wiki/v2/spaces"
	wikiSpacePathTemplate         = "/open-apis/wiki/v2/spaces/%s"
	wikiSpaceNodesPathTemplate    = "/open-apis/wiki/v2/spaces/%s/nodes"
	wikiSpaceNodeMovePathTemplate = "/open-apis/wiki/v2/spaces/%s/nodes/%s/move"
	wikiSpaceNodeCopyPathTemplate = "/open-apis/wiki/v2/spaces/%s/nodes/%s/copy"
	wikiSpaceDefaultPageSize      = 10
	wikiSpaceMaxPageSize          = 50
	wikiSpaceNodeDefaultPageSize  = 50
	wikiSpaceNodeMaxPageSize      = 200
)

func (s *Service) runWikiSpace(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "list":
		return s.runWikiSpaceList(ctx, workspaceID, config, params)
	case "get":
		return s.runWikiSpaceGet(ctx, workspaceID, config, params)
	case "create":
		return s.runWikiSpaceCreate(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_wiki_space", action))
	}
}

func (s *Service) runWikiSpaceNode(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "list":
		return s.runWikiSpaceNodeList(ctx, workspaceID, config, params)
	case "get":
		return s.runWikiSpaceNodeGet(ctx, workspaceID, config, params)
	case "create":
		return s.runWikiSpaceNodeCreate(ctx, workspaceID, config, params)
	case "move":
		return s.runWikiSpaceNodeMove(ctx, workspaceID, config, params)
	case "copy":
		return s.runWikiSpaceNodeCopy(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_wiki_space_node", action))
	}
}

func (s *Service) runWikiSpaceList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	pageSize := wikiSpaceDefaultPageSize
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		pageSize = value
	}
	if pageSize > wikiSpaceMaxPageSize {
		pageSize = wikiSpaceMaxPageSize
	}

	query := url.Values{}
	query.Set("page_size", fmt.Sprintf("%d", pageSize))
	copyQueryFields(query, params, []string{"page_token"}, map[string]string{"pageToken": "page_token"})

	var result struct {
		Items     []map[string]any `json:"items"`
		HasMore   bool             `json:"has_more"`
		PageToken string           `json:"page_token"`
	}
	if err := s.gateway.doJSON(ctx, "GET", wikiSpacesPath, query, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"spaces":    result.Items,
		"hasMore":   result.HasMore,
		"pageToken": result.PageToken,
		"pageSize":  pageSize,
		"principal": "user",
	}, nil
}

func (s *Service) runWikiSpaceGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	spaceID := strings.TrimSpace(stringParam(params, "spaceId", "space_id"))
	if spaceID == "" {
		return nil, toolInvalidInput("spaceId is required")
	}

	var result struct {
		Space map[string]any `json:"space"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(wikiSpacePathTemplate, url.PathEscape(spaceID)), nil, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"space":     result.Space,
		"spaceId":   spaceID,
		"principal": "user",
	}, nil
}

func (s *Service) runWikiSpaceCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	body := map[string]any{}
	if name, ok := rawStringParam(params, "name"); ok {
		body["name"] = name
	}
	if description, ok := rawStringParam(params, "description"); ok {
		body["description"] = description
	}

	var result struct {
		Space map[string]any `json:"space"`
	}
	if err := s.gateway.doJSON(ctx, "POST", wikiSpacesPath, nil, access.AccessToken, body, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"space":     result.Space,
		"principal": "user",
	}, nil
}

func (s *Service) runWikiSpaceNodeList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	spaceID := strings.TrimSpace(stringParam(params, "spaceId", "space_id"))
	if spaceID == "" {
		return nil, toolInvalidInput("spaceId is required")
	}

	pageSize := wikiSpaceNodeDefaultPageSize
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		pageSize = value
	}
	if pageSize > wikiSpaceNodeMaxPageSize {
		pageSize = wikiSpaceNodeMaxPageSize
	}

	query := url.Values{}
	query.Set("page_size", fmt.Sprintf("%d", pageSize))
	copyQueryFields(query, params, []string{"page_token", "parent_node_token"}, map[string]string{
		"pageToken":       "page_token",
		"parentNodeToken": "parent_node_token",
	})

	var result struct {
		Items     []map[string]any `json:"items"`
		HasMore   bool             `json:"has_more"`
		PageToken string           `json:"page_token"`
	}
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(wikiSpaceNodesPathTemplate, url.PathEscape(spaceID)), query, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"spaceId":         spaceID,
		"nodes":           result.Items,
		"hasMore":         result.HasMore,
		"pageToken":       result.PageToken,
		"pageSize":        pageSize,
		"parentNodeToken": strings.TrimSpace(stringParam(params, "parentNodeToken", "parent_node_token")),
		"principal":       "user",
	}, nil
}

func (s *Service) runWikiSpaceNodeGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	token := strings.TrimSpace(stringParam(params, "token", "nodeToken", "node_token"))
	if token == "" {
		return nil, toolInvalidInput("token is required")
	}

	query := url.Values{}
	query.Set("token", token)
	query.Set("obj_type", firstNonEmpty(strings.TrimSpace(stringParam(params, "objType", "obj_type")), "wiki"))

	var result struct {
		Node map[string]any `json:"node"`
	}
	if err := s.gateway.doJSON(ctx, "GET", wikiGetNodePath, query, access.AccessToken, nil, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"node":      result.Node,
		"token":     token,
		"objType":   query.Get("obj_type"),
		"principal": "user",
	}, nil
}

func (s *Service) runWikiSpaceNodeCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	spaceID := strings.TrimSpace(stringParam(params, "spaceId", "space_id"))
	if spaceID == "" {
		return nil, toolInvalidInput("spaceId is required")
	}
	objType := strings.TrimSpace(stringParam(params, "objType", "obj_type"))
	if objType == "" {
		return nil, toolInvalidInput("objType is required")
	}
	nodeType := strings.TrimSpace(stringParam(params, "nodeType", "node_type"))
	if nodeType == "" {
		return nil, toolInvalidInput("nodeType is required")
	}

	body := map[string]any{
		"obj_type":  objType,
		"node_type": nodeType,
	}
	if parentNodeToken := strings.TrimSpace(stringParam(params, "parentNodeToken", "parent_node_token")); parentNodeToken != "" {
		body["parent_node_token"] = parentNodeToken
	}
	if originNodeToken := strings.TrimSpace(stringParam(params, "originNodeToken", "origin_node_token")); originNodeToken != "" {
		body["origin_node_token"] = originNodeToken
	}
	if title, ok := rawStringParam(params, "title"); ok {
		body["title"] = title
	}

	var result struct {
		Node map[string]any `json:"node"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(wikiSpaceNodesPathTemplate, url.PathEscape(spaceID)), nil, access.AccessToken, body, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"spaceId":   spaceID,
		"node":      result.Node,
		"principal": "user",
	}, nil
}

func (s *Service) runWikiSpaceNodeMove(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	spaceID := strings.TrimSpace(stringParam(params, "spaceId", "space_id"))
	if spaceID == "" {
		return nil, toolInvalidInput("spaceId is required")
	}
	nodeToken := strings.TrimSpace(stringParam(params, "nodeToken", "node_token"))
	if nodeToken == "" {
		return nil, toolInvalidInput("nodeToken is required")
	}

	body := map[string]any{}
	if targetParentToken, ok := rawStringParam(params, "targetParentToken", "target_parent_token"); ok {
		body["target_parent_token"] = targetParentToken
	}

	var result struct {
		Node map[string]any `json:"node"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(wikiSpaceNodeMovePathTemplate, url.PathEscape(spaceID), url.PathEscape(nodeToken)), nil, access.AccessToken, body, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"spaceId":   spaceID,
		"nodeToken": nodeToken,
		"node":      result.Node,
		"principal": "user",
	}, nil
}

func (s *Service) runWikiSpaceNodeCopy(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	access, err := s.gateway.UserToken(ctx, workspaceID, config)
	if err != nil {
		return nil, err
	}

	spaceID := strings.TrimSpace(stringParam(params, "spaceId", "space_id"))
	if spaceID == "" {
		return nil, toolInvalidInput("spaceId is required")
	}
	nodeToken := strings.TrimSpace(stringParam(params, "nodeToken", "node_token"))
	if nodeToken == "" {
		return nil, toolInvalidInput("nodeToken is required")
	}

	body := map[string]any{}
	if targetSpaceID := strings.TrimSpace(stringParam(params, "targetSpaceId", "target_space_id")); targetSpaceID != "" {
		body["target_space_id"] = targetSpaceID
	}
	if targetParentToken, ok := rawStringParam(params, "targetParentToken", "target_parent_token"); ok {
		body["target_parent_token"] = targetParentToken
	}
	if title, ok := rawStringParam(params, "title"); ok {
		body["title"] = title
	}

	var result struct {
		Node map[string]any `json:"node"`
	}
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(wikiSpaceNodeCopyPathTemplate, url.PathEscape(spaceID), url.PathEscape(nodeToken)), nil, access.AccessToken, body, &result); err != nil {
		return nil, err
	}

	return map[string]any{
		"spaceId":   spaceID,
		"nodeToken": nodeToken,
		"node":      result.Node,
		"principal": "user",
	}, nil
}
