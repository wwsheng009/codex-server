package bots

import (
	"encoding/json"
	"fmt"
	"strings"
)

const (
	botCommandOutputTailLineLimit = 24
	botCommandOutputCharLimit     = 1800
	botFileChangeEntryLimit       = 8
	botToolValuePreviewLimit      = 160
)

func renderBotVisibleItem(item map[string]any) string {
	if len(item) == 0 {
		return ""
	}

	switch strings.TrimSpace(stringValue(item["type"])) {
	case "agentMessage":
		return strings.TrimSpace(stringValue(item["text"]))
	case "plan":
		return renderBotPlanItem(item)
	case "reasoning":
		return renderBotReasoningItem(item)
	case "commandExecution":
		return renderBotCommandExecutionItem(item)
	case "fileChange":
		return renderBotFileChangeItem(item)
	case "mcpToolCall", "dynamicToolCall", "collabAgentToolCall":
		return renderBotToolCallItem(item)
	case "serverRequest":
		return renderBotServerRequestItem(item)
	default:
		text := strings.TrimSpace(firstNonEmpty(stringValue(item["text"]), stringValue(item["message"])))
		return text
	}
}

func renderBotPlanItem(item map[string]any) string {
	text := strings.TrimSpace(stringValue(item["text"]))
	if text == "" {
		return ""
	}

	steps := botPlanSteps(text)
	if len(steps) == 0 {
		return "Plan:\n" + text
	}

	lines := make([]string, 0, len(steps)+1)
	lines = append(lines, "Plan:")
	for index, step := range steps {
		lines = append(lines, fmt.Sprintf("%d. %s", index+1, step))
	}
	return strings.Join(lines, "\n")
}

func renderBotReasoningItem(item map[string]any) string {
	parts := make([]string, 0, 2)
	if summary := strings.TrimSpace(strings.Join(stringSliceValue(item["summary"]), "\n")); summary != "" {
		parts = append(parts, summary)
	}
	if content := strings.TrimSpace(strings.Join(stringSliceValue(item["content"]), "\n")); content != "" {
		parts = append(parts, content)
	}
	if len(parts) == 0 {
		return ""
	}
	return "Reasoning:\n" + strings.Join(parts, "\n")
}

func renderBotCommandExecutionItem(item map[string]any) string {
	command := strings.TrimSpace(stringValue(item["command"]))
	output := strings.TrimSpace(stringValue(item["aggregatedOutput"]))
	status := strings.TrimSpace(stringValue(item["status"]))

	lines := make([]string, 0, 3)
	switch {
	case command != "" && status != "":
		lines = append(lines, fmt.Sprintf("Command: %s [%s]", command, humanizeBotStatus(status)))
	case command != "":
		lines = append(lines, "Command: "+command)
	case status != "":
		lines = append(lines, "Command Status: "+humanizeBotStatus(status))
	}

	if output != "" {
		lines = append(lines, tailBotCommandOutput(output))
	}

	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func renderBotFileChangeItem(item map[string]any) string {
	changes := botFileChanges(item["changes"])
	if len(changes) == 0 {
		return ""
	}

	lines := make([]string, 0, minInt(len(changes), botFileChangeEntryLimit)+2)
	lines = append(lines, "Files:")
	limit := minInt(len(changes), botFileChangeEntryLimit)
	for index := 0; index < limit; index += 1 {
		change := changes[index]
		line := "- " + change.path
		if change.kind != "" {
			line += " (" + change.kind + ")"
		}
		lines = append(lines, line)
	}
	if len(changes) > limit {
		lines = append(lines, fmt.Sprintf("+%d more file changes", len(changes)-limit))
	}

	return strings.Join(lines, "\n")
}

func renderBotToolCallItem(item map[string]any) string {
	itemType := strings.TrimSpace(stringValue(item["type"]))
	tool := strings.TrimSpace(stringValue(item["tool"]))
	if tool == "" {
		tool = humanizeBotItemType(itemType)
	}

	summary := botToolCallSummary(item)
	switch itemType {
	case "mcpToolCall":
		if summary != "" {
			return "MCP Tool Call: " + tool + " · " + summary
		}
		return "MCP Tool Call: " + tool
	case "collabAgentToolCall":
		if summary != "" {
			return "Agent Tool Call: " + tool + " · " + summary
		}
		return "Agent Tool Call: " + tool
	default:
		if summary != "" {
			return "Tool Call: " + tool + " · " + summary
		}
		return "Tool Call: " + tool
	}
}

func renderBotServerRequestItem(item map[string]any) string {
	requestKind := strings.TrimSpace(stringValue(item["requestKind"]))
	status := strings.TrimSpace(firstNonEmpty(stringValue(item["status"]), "pending"))
	details := objectValue(item["details"])
	summary := botSummarizeServerRequest(requestKind, details)
	if summary == "" {
		summary = "Expand in workspace for details"
	}

	line := botServerRequestTitle(requestKind) + ": " + summary
	switch strings.ToLower(status) {
	case "resolved", "completed":
		return line + " [Resolved]"
	case "expired":
		reason := strings.TrimSpace(stringValue(item["expireReason"]))
		if reason == "" {
			return line + " [Expired]"
		}
		return line + " [Expired: " + botServerRequestExpiredMessage(reason) + "]"
	default:
		requestID := strings.TrimSpace(stringValue(item["requestId"]))
		statusLine := line + " [" + humanizeBotStatus(status) + "]"
		if requestID == "" {
			return statusLine
		}
		hints := botPendingApprovalHelpLines(requestKind, requestID, details)
		if len(hints) == 0 {
			return statusLine + "\nRequest ID: " + requestID
		}
		return statusLine + "\nRequest ID: " + requestID + "\n" + strings.Join(hints, "\n")
	}
}

func botPendingApprovalHelpLines(kind string, requestID string, details map[string]any) []string {
	switch kind {
	case "item/tool/requestUserInput":
		questionIDs := botApprovalQuestionIDs(details)
		if len(questionIDs) <= 1 {
			return []string{
				"Reply with /answer " + requestID + " <text>",
				"Reply with /decline " + requestID,
				"Reply with /cancel " + requestID,
			}
		}
		return []string{
			"Reply with /answer " + requestID + " " + strings.Join(questionIDs, "=...; ") + "=...",
			"Reply with /decline " + requestID,
			"Reply with /cancel " + requestID,
		}
	case "mcpServer/elicitation/request", "item/tool/call":
		return []string{
			"Reply with /answer " + requestID + " <text>",
			"Reply with /decline " + requestID,
			"Reply with /cancel " + requestID,
		}
	case "item/permissions/requestApproval":
		return []string{
			"Reply with /approve " + requestID,
			"Reply with /decline " + requestID,
		}
	case "account/chatgptAuthTokens/refresh":
		return []string{"Complete this request in the workspace UI instead."}
	default:
		return []string{
			"Reply with /approve " + requestID,
			"Reply with /decline " + requestID,
			"Reply with /cancel " + requestID,
		}
	}
}

func botApprovalQuestionIDs(details map[string]any) []string {
	rawQuestions, ok := details["questions"].([]any)
	if !ok || len(rawQuestions) == 0 {
		return nil
	}

	questionIDs := make([]string, 0, len(rawQuestions))
	for _, rawQuestion := range rawQuestions {
		question := objectValue(rawQuestion)
		questionID := strings.TrimSpace(stringValue(question["id"]))
		if questionID != "" {
			questionIDs = append(questionIDs, questionID)
		}
	}

	return questionIDs
}

func botPlanSteps(text string) []string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	steps := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		line = strings.TrimSpace(strings.TrimLeft(line, "-*0123456789.) \t"))
		if line == "" {
			continue
		}
		steps = append(steps, line)
	}
	return steps
}

func botFileChanges(value any) []botFileChange {
	rawItems := make([]map[string]any, 0)
	switch typed := value.(type) {
	case []any:
		for _, rawItem := range typed {
			entry := objectValue(rawItem)
			if len(entry) == 0 {
				continue
			}
			rawItems = append(rawItems, entry)
		}
	case []map[string]any:
		rawItems = append(rawItems, typed...)
	default:
		return nil
	}

	items := make([]botFileChange, 0, len(rawItems))
	for _, entry := range rawItems {
		path := strings.TrimSpace(stringValue(entry["path"]))
		kind := humanizeBotItemType(strings.TrimSpace(stringValue(objectValue(entry["kind"])["type"])))
		if path == "" && kind == "" {
			continue
		}
		items = append(items, botFileChange{path: path, kind: kind})
	}
	return items
}

type botFileChange struct {
	path string
	kind string
}

func botToolCallSummary(item map[string]any) string {
	itemType := strings.TrimSpace(stringValue(item["type"]))
	status := strings.TrimSpace(stringValue(item["status"]))
	server := strings.TrimSpace(stringValue(item["server"]))
	receiverThreadIDs := stringSliceValue(item["receiverThreadIds"])

	switch itemType {
	case "mcpToolCall":
		if server != "" {
			if status != "" {
				return "Server " + server + " · " + humanizeBotStatus(status)
			}
			return "Server " + server
		}
	case "collabAgentToolCall":
		if len(receiverThreadIDs) > 0 {
			return fmt.Sprintf("%d target thread%s", len(receiverThreadIDs), pluralSuffix(len(receiverThreadIDs)))
		}
	}

	if status != "" {
		return humanizeBotStatus(status)
	}

	if preview := botPreviewValue(item["error"]); preview != "" {
		return preview
	}
	if preview := botPreviewValue(item["result"]); preview != "" {
		return preview
	}
	if preview := botPreviewValue(item["contentItems"]); preview != "" {
		return preview
	}
	return ""
}

func botSummarizeServerRequest(kind string, details map[string]any) string {
	switch kind {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return strings.TrimSpace(stringValue(details["command"]))
	case "item/fileChange/requestApproval", "applyPatchApproval":
		if path := strings.TrimSpace(stringValue(details["path"])); path != "" {
			return path
		}
		if count := len(botFileChanges(details["changes"])); count > 0 {
			return fmt.Sprintf("%d file change%s", count, pluralSuffix(count))
		}
	case "item/tool/requestUserInput":
		if questions, ok := details["questions"].([]any); ok && len(questions) > 0 {
			return fmt.Sprintf("%d question%s waiting for input", len(questions), pluralSuffix(len(questions)))
		}
		return "Provide input to continue"
	case "item/permissions/requestApproval":
		return strings.TrimSpace(firstNonEmpty(stringValue(details["reason"]), "Additional permissions were requested"))
	case "mcpServer/elicitation/request":
		return strings.TrimSpace(firstNonEmpty(stringValue(details["message"]), stringValue(details["serverName"]), "The MCP server is waiting for input"))
	case "item/tool/call":
		return strings.TrimSpace(firstNonEmpty(stringValue(details["tool"]), "Provide output for the requested tool call"))
	case "account/chatgptAuthTokens/refresh":
		return strings.TrimSpace(firstNonEmpty(stringValue(details["reason"]), "Refresh the account authentication tokens"))
	default:
		return strings.TrimSpace(firstNonEmpty(stringValue(details["message"]), stringValue(details["reason"])))
	}

	return ""
}

func botServerRequestTitle(kind string) string {
	switch kind {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return "Command Approval"
	case "item/fileChange/requestApproval", "applyPatchApproval":
		return "File Change Approval"
	case "item/tool/requestUserInput":
		return "User Input Request"
	case "item/permissions/requestApproval":
		return "Permissions Request"
	case "mcpServer/elicitation/request":
		return "MCP Input Request"
	case "item/tool/call":
		return "Tool Response Request"
	case "account/chatgptAuthTokens/refresh":
		return "Auth Refresh Request"
	default:
		return "Server Request"
	}
}

func botServerRequestExpiredMessage(reason string) string {
	switch reason {
	case "runtime_closed":
		return "runtime closed"
	case "runtime_removed":
		return "runtime removed"
	case "request_unavailable":
		return "request unavailable"
	default:
		return "request unavailable"
	}
}

func botPreviewValue(value any) string {
	switch typed := value.(type) {
	case string:
		return truncateBotSingleLine(typed, botToolValuePreviewLimit)
	default:
		if value == nil {
			return ""
		}
		data, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return truncateBotSingleLine(string(data), botToolValuePreviewLimit)
	}
}

func tailBotCommandOutput(output string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(output, "\r\n", "\n"))
	if normalized == "" {
		return ""
	}

	lines := strings.Split(normalized, "\n")
	truncated := false
	if len(lines) > botCommandOutputTailLineLimit {
		lines = lines[len(lines)-botCommandOutputTailLineLimit:]
		truncated = true
	}

	text := strings.Join(lines, "\n")
	if len([]rune(text)) > botCommandOutputCharLimit {
		runes := []rune(text)
		text = string(runes[len(runes)-botCommandOutputCharLimit:])
		truncated = true
	}

	if truncated {
		return "Latest Output:\n...\n" + text
	}
	return "Output:\n" + text
}

func humanizeBotStatus(value string) string {
	return humanizeBotItemType(strings.NewReplacer("inprogress", "in progress").Replace(strings.ToLower(strings.TrimSpace(value))))
}

func humanizeBotItemType(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}

	value = strings.ReplaceAll(value, "_", " ")
	value = strings.ReplaceAll(value, "-", " ")

	var builder strings.Builder
	for index, r := range value {
		if index > 0 && r >= 'A' && r <= 'Z' && value[index-1] >= 'a' && value[index-1] <= 'z' {
			builder.WriteByte(' ')
		}
		builder.WriteRune(r)
	}

	parts := strings.Fields(builder.String())
	for index, part := range parts {
		if part == "" {
			continue
		}
		parts[index] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func truncateBotSingleLine(value string, maxLength int) string {
	compact := strings.TrimSpace(strings.Join(strings.Fields(value), " "))
	if maxLength <= 0 || len([]rune(compact)) <= maxLength {
		return compact
	}

	runes := []rune(compact)
	return string(runes[:maxLength-1]) + "…"
}

func pluralSuffix(count int) string {
	if count == 1 {
		return ""
	}
	return "s"
}

func minInt(left int, right int) int {
	if left < right {
		return left
	}
	return right
}
