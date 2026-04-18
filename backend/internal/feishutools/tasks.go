package feishutools

import (
	"context"
	"fmt"
	"net/url"
	"strings"
)

const taskPath = "/open-apis/task/v2/tasks"

const (
	tasklistPath              = "/open-apis/task/v2/tasklists"
	tasklistTasksPathTemplate = "/open-apis/task/v2/tasklists/%s/tasks"
	sectionPath               = "/open-apis/task/v2/sections"
	sectionPathTemplate       = "/open-apis/task/v2/sections/%s"
	sectionTasksPathTemplate  = "/open-apis/task/v2/sections/%s/tasks"
	subtaskPathTemplate       = "/open-apis/task/v2/tasks/%s/subtasks"
	commentPath               = "/open-apis/task/v2/comments"
	commentPathTemplate       = "/open-apis/task/v2/comments/%s"
)

func (s *Service) runTask(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runTaskCreate(ctx, workspaceID, config, params)
	case "get":
		return s.runTaskGet(ctx, workspaceID, config, params)
	case "list":
		return s.runTaskList(ctx, workspaceID, config, params)
	case "patch":
		return s.runTaskPatch(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_task_task", action))
	}
}

func (s *Service) runTaskTasklist(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runTaskTasklistCreate(ctx, workspaceID, config, params)
	case "get":
		return s.runTaskTasklistGet(ctx, workspaceID, config, params)
	case "list":
		return s.runTaskTasklistList(ctx, workspaceID, config, params)
	case "tasks":
		return s.runTaskTasklistTasks(ctx, workspaceID, config, params)
	case "patch":
		return s.runTaskTasklistPatch(ctx, workspaceID, config, params)
	case "add_members":
		return s.runTaskTasklistAddMembers(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_task_tasklist", action))
	}
}

func (s *Service) runTasklist(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	return s.runTaskTasklist(ctx, workspaceID, config, action, params)
}

func (s *Service) runTaskSection(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runTaskSectionCreate(ctx, workspaceID, config, params)
	case "get":
		return s.runTaskSectionGet(ctx, workspaceID, config, params)
	case "list":
		return s.runTaskSectionList(ctx, workspaceID, config, params)
	case "tasks":
		return s.runTaskSectionTasks(ctx, workspaceID, config, params)
	case "patch":
		return s.runTaskSectionPatch(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_task_section", action))
	}
}

func (s *Service) runTaskSubtask(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runTaskSubtaskCreate(ctx, workspaceID, config, params)
	case "list":
		return s.runTaskSubtaskList(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_task_subtask", action))
	}
}

func (s *Service) runTaskComment(ctx context.Context, workspaceID string, config Config, action string, params map[string]any) (map[string]any, error) {
	switch strings.TrimSpace(action) {
	case "", "create":
		return s.runTaskCommentCreate(ctx, workspaceID, config, params)
	case "list":
		return s.runTaskCommentList(ctx, workspaceID, config, params)
	case "get":
		return s.runTaskCommentGet(ctx, workspaceID, config, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("unsupported action %q for feishu_task_comment", action))
	}
}

func (s *Service) runTaskCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	body := mapWithout(params, "userIdType", "user_id_type")
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", taskPath, query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	taskGUID := strings.TrimSpace(stringParam(params, "taskGuid", "task_guid"))
	if taskGUID == "" {
		return nil, toolInvalidInput("taskGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", taskPath+"/"+url.PathEscape(taskGUID), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "type", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	if value, ok := boolParam(params, "completed"); ok {
		query.Set("completed", fmt.Sprintf("%t", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", taskPath, query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskPatch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	taskGUID := strings.TrimSpace(stringParam(params, "taskGuid", "task_guid"))
	if taskGUID == "" {
		return nil, toolInvalidInput("taskGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, false)
	if err != nil {
		return nil, err
	}
	body := mapWithout(params, "taskGuid", "task_guid", "userIdType", "user_id_type")
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "PATCH", taskPath+"/"+url.PathEscape(taskGUID), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskTasklistCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	body := mapWithout(params, "userIdType", "user_id_type")
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", tasklistPath, query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskTasklistGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	tasklistGUID := strings.TrimSpace(stringParam(params, "tasklistGuid", "tasklist_guid"))
	if tasklistGUID == "" {
		return nil, toolInvalidInput("tasklistGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", tasklistPath+"/"+url.PathEscape(tasklistGUID), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskTasklistList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", tasklistPath, query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskTasklistTasks(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	tasklistGUID := strings.TrimSpace(stringParam(params, "tasklistGuid", "tasklist_guid"))
	if tasklistGUID == "" {
		return nil, toolInvalidInput("tasklistGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	if value, ok := boolParam(params, "completed"); ok {
		query.Set("completed", fmt.Sprintf("%t", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(tasklistTasksPathTemplate, url.PathEscape(tasklistGUID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskTasklistPatch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	tasklistGUID := strings.TrimSpace(stringParam(params, "tasklistGuid", "tasklist_guid"))
	if tasklistGUID == "" {
		return nil, toolInvalidInput("tasklistGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	tasklist := mapWithout(params, "tasklistGuid", "tasklist_guid", "userIdType", "user_id_type")
	if len(tasklist) == 0 {
		return nil, toolInvalidInput("at least one tasklist field is required")
	}
	body := map[string]any{
		"tasklist":      tasklist,
		"update_fields": mapKeys(tasklist),
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "PATCH", tasklistPath+"/"+url.PathEscape(tasklistGUID), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskTasklistAddMembers(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	tasklistGUID := strings.TrimSpace(stringParam(params, "tasklistGuid", "tasklist_guid"))
	if tasklistGUID == "" {
		return nil, toolInvalidInput("tasklistGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	members, ok := params["members"]
	if !ok || members == nil {
		return nil, toolInvalidInput("members is required")
	}
	body := map[string]any{"members": members}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", tasklistPath+"/"+url.PathEscape(tasklistGUID)+"/add_members", query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSectionCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	body := mapWithout(params, "userIdType", "user_id_type")
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", sectionPath, query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSectionGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	sectionGUID := strings.TrimSpace(stringParam(params, "sectionGuid", "section_guid"))
	if sectionGUID == "" {
		return nil, toolInvalidInput("sectionGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(sectionPathTemplate, url.PathEscape(sectionGUID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSectionList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	resourceType := strings.TrimSpace(stringParam(params, "resourceType", "resource_type"))
	if resourceType == "" {
		return nil, toolInvalidInput("resourceType is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	copyQueryFields(
		query,
		params,
		[]string{"resource_type", "resource_id", "page_token", "user_id_type"},
		map[string]string{"resourceType": "resource_type", "resourceId": "resource_id", "pageToken": "page_token", "userIdType": "user_id_type"},
	)
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", sectionPath, query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSectionTasks(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	sectionGUID := strings.TrimSpace(stringParam(params, "sectionGuid", "section_guid"))
	if sectionGUID == "" {
		return nil, toolInvalidInput("sectionGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	copyQueryFields(
		query,
		params,
		[]string{"page_token", "created_from", "created_to", "user_id_type"},
		map[string]string{"pageToken": "page_token", "createdFrom": "created_from", "createdTo": "created_to", "userIdType": "user_id_type"},
	)
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	if value, ok := boolParam(params, "completed"); ok {
		query.Set("completed", fmt.Sprintf("%t", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(sectionTasksPathTemplate, url.PathEscape(sectionGUID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSectionPatch(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	sectionGUID := strings.TrimSpace(stringParam(params, "sectionGuid", "section_guid"))
	if sectionGUID == "" {
		return nil, toolInvalidInput("sectionGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	section := mapWithout(params, "sectionGuid", "section_guid", "userIdType", "user_id_type")
	if len(section) == 0 {
		return nil, toolInvalidInput("at least one section field is required")
	}
	body := map[string]any{
		"section":       section,
		"update_fields": mapKeys(section),
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "PATCH", fmt.Sprintf(sectionPathTemplate, url.PathEscape(sectionGUID)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSubtaskCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	taskGUID := strings.TrimSpace(stringParam(params, "taskGuid", "task_guid"))
	if taskGUID == "" {
		return nil, toolInvalidInput("taskGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	body := mapWithout(params, "taskGuid", "task_guid", "userIdType", "user_id_type")
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", fmt.Sprintf(subtaskPathTemplate, url.PathEscape(taskGUID)), query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskSubtaskList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	taskGUID := strings.TrimSpace(stringParam(params, "taskGuid", "task_guid"))
	if taskGUID == "" {
		return nil, toolInvalidInput("taskGuid is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	copyQueryFields(query, params, []string{"page_token", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(subtaskPathTemplate, url.PathEscape(taskGUID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskCommentCreate(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	taskGUID := strings.TrimSpace(stringParam(params, "taskGuid", "task_guid", "resourceId", "resource_id"))
	if taskGUID == "" {
		return nil, toolInvalidInput("taskGuid is required")
	}
	content := strings.TrimSpace(stringParam(params, "content"))
	if content == "" {
		return nil, toolInvalidInput("content is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	body := map[string]any{
		"resource_type": "task",
		"resource_id":   taskGUID,
		"content":       content,
	}
	if replyTo := strings.TrimSpace(stringParam(params, "replyToCommentId", "reply_to_comment_id")); replyTo != "" {
		body["reply_to_comment_id"] = replyTo
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "POST", commentPath, query, token.Token, body, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskCommentList(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	taskGUID := strings.TrimSpace(stringParam(params, "taskGuid", "task_guid", "resourceId", "resource_id"))
	if taskGUID == "" {
		return nil, toolInvalidInput("resourceId is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	query.Set("resource_type", "task")
	query.Set("resource_id", taskGUID)
	copyQueryFields(query, params, []string{"direction", "page_token", "user_id_type"}, map[string]string{"pageToken": "page_token", "userIdType": "user_id_type"})
	if value, ok := intParam(params, "pageSize", "page_size"); ok && value > 0 {
		query.Set("page_size", fmt.Sprintf("%d", value))
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", commentPath, query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) runTaskCommentGet(ctx context.Context, workspaceID string, config Config, params map[string]any) (map[string]any, error) {
	commentID := strings.TrimSpace(stringParam(params, "commentId", "comment_id"))
	if commentID == "" {
		return nil, toolInvalidInput("commentId is required")
	}
	token, query, err := s.taskTokenAndQuery(ctx, workspaceID, config, params, true)
	if err != nil {
		return nil, err
	}
	var result map[string]any
	if err := s.gateway.doJSON(ctx, "GET", fmt.Sprintf(commentPathTemplate, url.PathEscape(commentID)), query, token.Token, nil, &result); err != nil {
		return nil, err
	}
	result["principal"] = token.Principal
	return result, nil
}

func (s *Service) taskTokenAndQuery(ctx context.Context, workspaceID string, config Config, params map[string]any, userOnly bool) (bearerChoice, url.Values, error) {
	var token bearerChoice
	var err error
	if userOnly {
		snapshot, snapshotErr := s.gateway.UserToken(ctx, workspaceID, config)
		if snapshotErr != nil {
			return bearerChoice{}, nil, snapshotErr
		}
		token = bearerChoice{Token: snapshot.AccessToken, Principal: "user"}
	} else {
		token, err = s.userOrTenantToken(ctx, workspaceID, config)
		if err != nil {
			return bearerChoice{}, nil, err
		}
	}
	query := url.Values{}
	if userIDType := strings.TrimSpace(stringParam(params, "userIdType", "user_id_type")); userIDType != "" {
		query.Set("user_id_type", userIDType)
	}
	return token, query, nil
}

func mapKeys(input map[string]any) []string {
	if len(input) == 0 {
		return nil
	}
	keys := make([]string, 0, len(input))
	for key := range input {
		keys = append(keys, key)
	}
	return keys
}
