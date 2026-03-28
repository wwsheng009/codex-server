package diagnostics

import (
	"log/slog"
	"strings"
	"sync"
)

type ThreadTraceConfig struct {
	Enabled     bool
	WorkspaceID string
	ThreadID    string
}

var (
	threadTraceMu     sync.RWMutex
	threadTraceConfig ThreadTraceConfig
)

func ConfigureThreadTrace(enabled bool, workspaceID string, threadID string) {
	threadTraceMu.Lock()
	defer threadTraceMu.Unlock()

	threadTraceConfig = ThreadTraceConfig{
		Enabled:     enabled,
		WorkspaceID: strings.TrimSpace(workspaceID),
		ThreadID:    strings.TrimSpace(threadID),
	}
}

func WorkspaceTraceEnabled(workspaceID string) bool {
	threadTraceMu.RLock()
	config := threadTraceConfig
	threadTraceMu.RUnlock()

	if !config.Enabled {
		return false
	}

	workspaceID = strings.TrimSpace(workspaceID)
	if config.WorkspaceID == "" {
		return true
	}

	return workspaceID != "" && workspaceID == config.WorkspaceID
}

func ThreadTraceEnabled(workspaceID string, threadID string) bool {
	if !WorkspaceTraceEnabled(workspaceID) {
		return false
	}

	threadTraceMu.RLock()
	config := threadTraceConfig
	threadTraceMu.RUnlock()

	if config.ThreadID == "" {
		return true
	}

	threadID = strings.TrimSpace(threadID)
	return threadID != "" && threadID == config.ThreadID
}

func LogWorkspaceTrace(workspaceID string, msg string, attrs ...any) {
	if !WorkspaceTraceEnabled(workspaceID) {
		return
	}

	fields := make([]any, 0, len(attrs)+2)
	if trimmedWorkspaceID := strings.TrimSpace(workspaceID); trimmedWorkspaceID != "" {
		fields = append(fields, "workspaceId", trimmedWorkspaceID)
	}
	fields = append(fields, attrs...)
	slog.Info(msg, fields...)
}

func LogThreadTrace(workspaceID string, threadID string, msg string, attrs ...any) {
	if !ThreadTraceEnabled(workspaceID, threadID) {
		return
	}

	fields := make([]any, 0, len(attrs)+4)
	if trimmedWorkspaceID := strings.TrimSpace(workspaceID); trimmedWorkspaceID != "" {
		fields = append(fields, "workspaceId", trimmedWorkspaceID)
	}
	if trimmedThreadID := strings.TrimSpace(threadID); trimmedThreadID != "" {
		fields = append(fields, "threadId", trimmedThreadID)
	}
	fields = append(fields, attrs...)
	slog.Info(msg, fields...)
}

func LogTrace(workspaceID string, threadID string, msg string, attrs ...any) {
	if strings.TrimSpace(threadID) != "" {
		LogThreadTrace(workspaceID, threadID, msg, attrs...)
		return
	}

	LogWorkspaceTrace(workspaceID, msg, attrs...)
}

func EventTraceAttrs(method string, turnID string, payload any) []any {
	attrs := make([]any, 0, 18)

	if trimmedMethod := strings.TrimSpace(method); trimmedMethod != "" {
		attrs = append(attrs, "method", trimmedMethod)
	}

	object := asObject(payload)
	if turnID == "" {
		turnID = firstNonEmptyString(stringValue(object["turnId"]), nestedID(object["turn"]))
	}
	if trimmedTurnID := strings.TrimSpace(turnID); trimmedTurnID != "" {
		attrs = append(attrs, "turnId", trimmedTurnID)
	}

	if itemID := firstNonEmptyString(stringValue(object["itemId"]), nestedID(object["item"])); itemID != "" {
		attrs = append(attrs, "itemId", itemID)
	}
	if itemType := firstNonEmptyString(nestedString(object["item"], "type"), stringValue(object["type"])); itemType != "" {
		attrs = append(attrs, "itemType", itemType)
	}
	if phase := firstNonEmptyString(nestedString(object["item"], "phase"), stringValue(object["phase"])); phase != "" {
		attrs = append(attrs, "phase", phase)
	}
	if itemStatus := firstNonEmptyString(nestedString(object["item"], "status"), stringValue(object["status"])); itemStatus != "" {
		attrs = append(attrs, "status", itemStatus)
	}
	if turnStatus := nestedString(object["turn"], "status"); turnStatus != "" {
		attrs = append(attrs, "turnStatus", turnStatus)
	}
	if statusType := nestedString(object["status"], "type"); statusType != "" {
		attrs = append(attrs, "statusType", statusType)
	}
	if requestMethod := stringValue(object["method"]); requestMethod != "" {
		attrs = append(attrs, "requestMethod", requestMethod)
	}
	if turnItemCount := nestedArrayLen(object["turn"], "items"); turnItemCount > 0 {
		attrs = append(attrs, "turnItemCount", turnItemCount)
	}
	if deltaLen := payloadDeltaLen(object); deltaLen > 0 {
		attrs = append(attrs, "deltaLen", deltaLen)
	}
	if aggregatedOutputLen := len(stringValue(object["aggregatedOutput"])); aggregatedOutputLen > 0 {
		attrs = append(attrs, "aggregatedOutputLen", aggregatedOutputLen)
	}
	if textLen := len(firstNonEmptyString(nestedString(object["item"], "text"), stringValue(object["text"]))); textLen > 0 {
		attrs = append(attrs, "textLen", textLen)
	}

	return attrs
}

func TurnStartTraceAttrs(payload map[string]any) []any {
	attrs := make([]any, 0, 14)

	if threadID := strings.TrimSpace(stringValue(payload["threadId"])); threadID != "" {
		attrs = append(attrs, "requestThreadId", threadID)
	}
	if model := strings.TrimSpace(stringValue(payload["model"])); model != "" {
		attrs = append(attrs, "model", model)
	}
	if effort := strings.TrimSpace(stringValue(payload["effort"])); effort != "" {
		attrs = append(attrs, "effort", effort)
	}
	if approvalPolicy := strings.TrimSpace(stringValue(payload["approvalPolicy"])); approvalPolicy != "" {
		attrs = append(attrs, "approvalPolicy", approvalPolicy)
	}
	if sandboxType := nestedString(payload["sandboxPolicy"], "type"); sandboxType != "" {
		attrs = append(attrs, "sandboxType", sandboxType)
	}
	if _, ok := payload["collaborationMode"]; ok {
		attrs = append(attrs, "hasCollaborationMode", true)
	}
	if inputCount := len(asArray(payload["input"])); inputCount > 0 {
		attrs = append(attrs, "inputCount", inputCount)
	}
	if inputTextLength := inputEntriesTextLength(payload["input"]); inputTextLength > 0 {
		attrs = append(attrs, "inputTextLength", inputTextLength)
	}

	return attrs
}

func TruncateString(value string, max int) string {
	value = strings.TrimSpace(value)
	if max <= 0 || len(value) <= max {
		return value
	}
	if max <= 3 {
		return value[:max]
	}
	return value[:max-3] + "..."
}

func payloadDeltaLen(object map[string]any) int {
	for _, key := range []string{"delta", "deltaText", "deltaBase64"} {
		if delta := stringValue(object[key]); delta != "" {
			return len(delta)
		}
	}

	return 0
}

func inputEntriesTextLength(value any) int {
	entries := asArray(value)
	total := 0
	for _, rawEntry := range entries {
		total += len(strings.TrimSpace(stringValue(asObject(rawEntry)["text"])))
	}

	return total
}

func nestedArrayLen(value any, key string) int {
	return len(asArray(asObject(value)[key]))
}

func nestedString(value any, key string) string {
	return stringValue(asObject(value)[key])
}

func nestedID(value any) string {
	return stringValue(asObject(value)["id"])
}

func asObject(value any) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return map[string]any{}
	}
	return object
}

func asArray(value any) []any {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	return items
}

func stringValue(value any) string {
	typed, ok := value.(string)
	if !ok {
		return ""
	}
	return typed
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
