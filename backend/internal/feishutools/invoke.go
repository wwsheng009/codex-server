package feishutools

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"codex-server/backend/internal/store"
)

// InvokeInput carries the arguments a caller (thread tool loop or the frontend
// debug panel) supplies when exercising a Feishu tool.
type InvokeInput struct {
	ToolName     string         `json:"toolName"`
	Action       string         `json:"action,omitempty"`
	InvocationID string         `json:"invocationId,omitempty"`
	Params       map[string]any `json:"params,omitempty"`
}

// InvokeResult is the stable response shape the invoke endpoint returns. The
// Result field is left as `map[string]any` so different tools can return the
// shape that makes sense for them while the envelope remains consistent.
type InvokeResult struct {
	ToolName     string                `json:"toolName"`
	Action       string                `json:"action,omitempty"`
	InvocationID string                `json:"invocationId,omitempty"`
	Principal    string                `json:"principal,omitempty"`
	Status       string                `json:"status"`
	StartedAt    string                `json:"startedAt"`
	CompletedAt  string                `json:"completedAt"`
	DurationMs   int64                 `json:"durationMs"`
	Events       []InvokeProgressEvent `json:"events,omitempty"`
	Result       map[string]any        `json:"result,omitempty"`
	Error        *InvokeError          `json:"error,omitempty"`
}

// InvokeError mirrors gatewayError for the JSON boundary so callers never see
// raw HTTP details. It intentionally omits the upstream body preview to avoid
// leaking tokens or other sensitive context that may have been echoed.
type InvokeError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Hint    string `json:"hint,omitempty"`
}

// Invoke dispatches a tool call. It performs allowlist and sensitive-action
// gating before delegating to the tool-specific implementation.
func (s *Service) Invoke(ctx context.Context, workspaceID string, input InvokeInput) (InvokeResult, error) {
	tool := strings.TrimSpace(input.ToolName)
	action := strings.TrimSpace(input.Action)
	if tool == "" {
		return InvokeResult{}, toolInvalidInput("toolName is required")
	}
	if _, ok := toolDefinitions[tool]; !ok {
		return InvokeResult{}, toolInvalidInput(fmt.Sprintf("unknown tool %q", tool))
	}

	config, err := s.readConfig(ctx, workspaceID)
	if err != nil {
		return InvokeResult{}, err
	}
	if !config.Enabled {
		return InvokeResult{}, toolInvalidInput("Feishu tools are disabled for this workspace")
	}
	if !toolEnabled(config, tool) {
		return InvokeResult{}, toolInvalidInput(fmt.Sprintf("tool %q is not in the workspace allowlist", tool))
	}
	actionKey, err := resolveActionKey(tool, action)
	if err != nil {
		return InvokeResult{}, err
	}
	if err := enforceSensitiveWriteGuard(config, actionKey); err != nil {
		return InvokeResult{}, err
	}

	started := time.Now().UTC()
	invocationID := strings.TrimSpace(input.InvocationID)
	if invocationID == "" {
		invocationID = store.NewID("feishu_invoke")
	}
	result := InvokeResult{
		ToolName:     tool,
		Action:       action,
		InvocationID: invocationID,
		StartedAt:    started.Format(time.RFC3339),
	}
	tracker := s.newInvokeTracker(ctx, workspaceID, invocationID, tool, action, started)
	ctx = contextWithInvokeTracker(ctx, tracker)
	emitInvokeProgress(ctx, "queued", "Feishu tool invocation accepted", map[string]any{
		"toolName": tool,
		"action":   action,
	})
	emitInvokeProgress(ctx, "authorizing", "Workspace Feishu configuration validated", map[string]any{
		"oauthMode":            config.OauthMode,
		"sensitiveWriteGuard":  config.SensitiveWriteGuard,
		"allowlistRestricted":  len(config.ToolAllowlist) > 0,
		"resolvedActionKey":    actionKey,
		"workspaceFeishuTools": config.Enabled,
	})
	emitInvokeProgress(ctx, defaultInvokeProgressState(tool, actionKey), "Executing Feishu tool", map[string]any{
		"resolvedActionKey": actionKey,
	})

	data, runErr := s.runTool(ctx, workspaceID, config, tool, action, input.Params)
	completed := time.Now().UTC()
	result.CompletedAt = completed.Format(time.RFC3339)
	result.DurationMs = completed.Sub(started).Milliseconds()

	if runErr != nil {
		result.Status = "error"
		result.Error = toInvokeError(runErr)
		emitInvokeProgress(ctx, "error", "Feishu tool invocation failed", map[string]any{
			"code":       result.Error.Code,
			"message":    result.Error.Message,
			"hint":       result.Error.Hint,
			"durationMs": result.DurationMs,
		})
		result.Events = tracker.Snapshot()
		// The HTTP layer should still deliver a 200 with structured error so
		// agents can inspect the payload; mapping happens at router level.
		return result, nil
	}
	if data != nil {
		if principal, ok := data["principal"].(string); ok {
			result.Principal = principal
			delete(data, "principal")
		}
	}
	result.Status = "ok"
	result.Result = data
	emitInvokeProgress(ctx, "success", "Feishu tool invocation completed", buildInvokeCompletionDetail(data, result.DurationMs))
	result.Events = tracker.Snapshot()
	return result, nil
}

func resolveActionKey(tool string, action string) (string, error) {
	definition, ok := toolDefinitions[tool]
	if !ok {
		return "", toolInvalidInput(fmt.Sprintf("unknown tool %q", tool))
	}
	trimmedAction := strings.TrimSpace(action)
	if trimmedAction == "" {
		if len(definition.ActionKeys) == 1 {
			return definition.ActionKeys[0], nil
		}
		if slices.Contains(definition.ActionKeys, tool+".default") {
			return tool + ".default", nil
		}
		return "", nil
	}
	candidate := tool + "." + trimmedAction
	if slices.Contains(definition.ActionKeys, candidate) {
		return candidate, nil
	}
	return "", toolInvalidInput(fmt.Sprintf("unsupported action %q for %s", trimmedAction, tool))
}

func enforceSensitiveWriteGuard(config Config, actionKey string) error {
	if !config.SensitiveWriteGuard || actionKey == "" {
		return nil
	}
	for _, scope := range toolActionScopes[actionKey] {
		if isSensitiveScope(scope) {
			return &gatewayError{
				Code:    "sensitive_write_guard",
				Message: fmt.Sprintf("action %q is blocked while sensitive write guard is enabled", actionKey),
				Hint:    "Disable sensitiveWriteGuard in the workspace Feishu settings only after explicit approval.",
			}
		}
	}
	return nil
}

func (s *Service) runTool(ctx context.Context, workspaceID string, config Config, tool string, action string, params map[string]any) (map[string]any, error) {
	if params == nil {
		params = map[string]any{}
	}
	switch tool {
	case "feishu_fetch_doc":
		return s.runDocsFetch(ctx, workspaceID, config, params)
	case "feishu_create_doc":
		return s.runDocsCreate(ctx, workspaceID, config, params)
	case "feishu_update_doc":
		return s.runDocsUpdate(ctx, workspaceID, config, action, params)
	case "feishu_search_doc_wiki":
		return s.runDocsSearch(ctx, workspaceID, config, params)
	case "feishu_im_user_search_messages":
		return s.runIMSearchMessages(ctx, workspaceID, config, params)
	case "feishu_im_user_get_messages":
		return s.runIMGetMessage(ctx, workspaceID, config, params)
	case "feishu_im_user_get_thread_messages":
		return s.runIMGetThreadMessages(ctx, workspaceID, config, params)
	case "feishu_im_user_fetch_resource":
		return s.runIMFetchResource(ctx, workspaceID, config, params)
	case "feishu_im_user_message":
		return s.runIMUserMessage(ctx, workspaceID, config, action, params)
	case "feishu_search_user":
		return s.runSearchUser(ctx, workspaceID, config, params)
	case "feishu_get_user":
		return s.runGetUser(ctx, workspaceID, config, action, params)
	case "feishu_chat":
		return s.runChat(ctx, workspaceID, config, action, params)
	case "feishu_chat_members":
		return s.runChatMembers(ctx, workspaceID, config, params)
	case "feishu_calendar_freebusy":
		return s.runCalendarFreebusy(ctx, workspaceID, config, params)
	case "feishu_calendar_calendar":
		return s.runCalendar(ctx, workspaceID, config, action, params)
	case "feishu_calendar_event":
		return s.runCalendarEvent(ctx, workspaceID, config, action, params)
	case "feishu_calendar_event_attendee":
		return s.runCalendarEventAttendee(ctx, workspaceID, config, action, params)
	case "feishu_task_task":
		return s.runTask(ctx, workspaceID, config, action, params)
	case "feishu_task_tasklist":
		return s.runTasklist(ctx, workspaceID, config, action, params)
	case "feishu_task_section":
		return s.runTaskSection(ctx, workspaceID, config, action, params)
	case "feishu_task_subtask":
		return s.runTaskSubtask(ctx, workspaceID, config, action, params)
	case "feishu_task_comment":
		return s.runTaskComment(ctx, workspaceID, config, action, params)
	case "feishu_sheet":
		return s.runSheet(ctx, workspaceID, config, action, params)
	case "feishu_bitable_app":
		return s.runBitableApp(ctx, workspaceID, config, action, params)
	case "feishu_bitable_app_table":
		return s.runBitableTable(ctx, workspaceID, config, action, params)
	case "feishu_bitable_app_table_field":
		return s.runBitableField(ctx, workspaceID, config, action, params)
	case "feishu_bitable_app_table_record":
		return s.runBitableRecord(ctx, workspaceID, config, action, params)
	case "feishu_bitable_app_table_view":
		return s.runBitableView(ctx, workspaceID, config, action, params)
	case "feishu_drive_file":
		return s.runDriveFile(ctx, workspaceID, config, action, params)
	case "feishu_doc_comments":
		return s.runDocComments(ctx, workspaceID, config, action, params)
	case "feishu_doc_media":
		return s.runDocMedia(ctx, workspaceID, config, action, params)
	case "feishu_wiki_space":
		return s.runWikiSpace(ctx, workspaceID, config, action, params)
	case "feishu_wiki_space_node":
		return s.runWikiSpaceNode(ctx, workspaceID, config, action, params)
	default:
		return nil, toolInvalidInput(fmt.Sprintf("tool %q is not implemented yet", tool))
	}
}

func toInvokeError(err error) *InvokeError {
	if err == nil {
		return nil
	}
	if gerr, ok := err.(*gatewayError); ok {
		return &InvokeError{Code: gerr.Code, Message: gerr.Message, Hint: gerr.Hint}
	}
	return &InvokeError{Code: "internal_error", Message: err.Error()}
}
