package store

import "strings"

type HookRunDisplayFields struct {
	EventName          string
	HandlerKey         string
	TriggerMethod      string
	Status             string
	Decision           string
	Reason             string
	Feedback           string
	SessionStartSource string
	ToolName           string
	ToolKind           string
}

var structuredHookOutputEntryKeys = map[string]struct{}{
	"targetpath":       {},
	"sourcepath":       {},
	"destinationpath":  {},
	"matchedpath":      {},
	"matchedpolicy":    {},
	"command":          {},
	"server":           {},
	"tool":             {},
	"mode":             {},
	"requestkind":      {},
	"permissionscount": {},
	"changecount":      {},
	"path":             {},
	"reason":           {},
	"status":           {},
}

func FormatHookRunMessage(fields HookRunDisplayFields) string {
	lines := make([]string, 0, 6)
	if eventName := strings.TrimSpace(fields.EventName); eventName != "" {
		lines = append(lines, "Event: "+FormatHookRunEventName(eventName))
	}
	if handlerLabel := FormatHookRunHandlerLabel(fields.HandlerKey); handlerLabel != "" {
		lines = append(lines, "Handler: "+handlerLabel)
	}
	if status := strings.TrimSpace(fields.Status); status != "" {
		lines = append(lines, "Status: "+FormatHookRunStatus(status))
	}
	if decision := strings.TrimSpace(fields.Decision); decision != "" {
		lines = append(lines, "Decision: "+FormatHookRunDecision(decision))
	}
	if triggerMethod := FormatHookRunTriggerMethodLabel(fields.TriggerMethod); triggerMethod != "" {
		lines = append(lines, "Trigger: "+triggerMethod)
	}
	if toolLabel := FormatHookRunToolLabel(fields.ToolName, fields.ToolKind); toolLabel != "" {
		lines = append(lines, "Tool: "+toolLabel)
	}
	if sessionStartSource := FormatHookRunSessionStartSource(fields.SessionStartSource); sessionStartSource != "" {
		lines = append(lines, "Session Start Source: "+sessionStartSource)
	}
	if reason := strings.TrimSpace(fields.Reason); reason != "" {
		lines = append(lines, "Reason: "+FormatHookRunReason(reason))
	}
	if feedback := strings.TrimSpace(fields.Feedback); feedback != "" {
		lines = append(lines, "Feedback: "+feedback)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func FormatHookRunFeedbackEntries(entries []HookOutputEntry, limit int) string {
	if len(entries) == 0 {
		return ""
	}

	if limit <= 0 {
		limit = len(entries)
	}

	lines := make([]string, 0, limit)
	for _, entry := range entries {
		text := FormatHookOutputEntryText(entry.Text)
		if text == "" {
			continue
		}
		lines = append(lines, text)
		if len(lines) >= limit {
			break
		}
	}

	return strings.Join(lines, " | ")
}

func FormatHookOutputEntryText(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}

	if formatted, ok := formatStructuredHookOutputEntryText(text, "="); ok {
		return formatted
	}
	if formatted, ok := formatStructuredHookOutputEntryText(text, ":"); ok {
		return formatted
	}

	return text
}

func FormatHookRunToolLabel(toolName string, toolKind string) string {
	primary := firstNonEmptyDisplayValue(toolName, toolKind)
	if primary == "" {
		return ""
	}

	if exactLabel := formatKnownHookRunToolLabel(primary); exactLabel != "" {
		return exactLabel
	}
	if strings.Contains(primary, "__") {
		if segmentedLabel := formatHookRunPathToolLabel(primary, "__"); segmentedLabel != "" {
			return segmentedLabel
		}
	}
	if strings.Contains(primary, "/") {
		if segmentedLabel := formatHookRunPathToolLabel(primary, "/"); segmentedLabel != "" {
			return segmentedLabel
		}
	}

	if segmentLabel := formatHookRunToolSegment(primary); segmentLabel != "" {
		return segmentLabel
	}

	return humanizeHookRunDisplayValue(primary)
}

func FormatHookRunHandlerLabel(value string) string {
	switch strings.TrimSpace(value) {
	case "builtin.sessionstart.inject-project-context":
		return "Project Context Injection"
	case "builtin.userpromptsubmit.block-secret-paste":
		return "Secret Paste Guard"
	case "builtin.pretooluse.block-dangerous-command":
		return "Dangerous Command Guard"
	case "builtin.pretooluse.block-protected-governance-file-mutation":
		return "Protected Governance File Mutation Guard"
	case "builtin.posttooluse.failed-validation-rescue":
		return "Failed Validation Rescue"
	case "builtin.posttooluse.audit-mcp-tool-call":
		return "MCP Tool Call Audit"
	case "builtin.serverrequest.audit-mcp-elicitation-request":
		return "MCP Elicitation Request Audit"
	case "builtin.serverrequest.audit-approval-request":
		return "Approval Request Audit"
	case "builtin.turnstart.audit-thread-turn-start":
		return "Thread Turn Start Audit"
	case "builtin.turnsteer.audit-thread-turn-steer":
		return "Thread Turn Steer Audit"
	case "builtin.turninterrupt.audit-thread-interrupt":
		return "Thread Interrupt Audit"
	case "builtin.reviewstart.audit-thread-review-start":
		return "Thread Review Start Audit"
	case "builtin.httpmutation.audit-workspace-mutation":
		return "Workspace Mutation Audit"
	case "builtin.stop.require-successful-verification":
		return "Successful Verification Requirement"
	default:
		return formatHookRunHandlerFallback(value)
	}
}

func FormatHookRunTriggerMethodLabel(value string) string {
	switch strings.TrimSpace(value) {
	case "item/started":
		return "Item Started"
	case "item/completed":
		return "Item Completed"
	case "turn/completed":
		return "Turn Completed"
	case "tool/use":
		return "Tool Use"
	case "turn/input":
		return "Turn Input"
	case "item/tool/call":
		return "Tool Call"
	case "mcpServer/elicitation/request":
		return "MCP Elicitation Request"
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return "Command Execution Approval Request"
	case "item/fileChange/requestApproval", "applyPatchApproval":
		return "File Change Approval Request"
	case "item/permissions/requestApproval":
		return "Permissions Approval Request"
	case "fs/write":
		return "Write File"
	case "fs/mkdir":
		return "Create Directory"
	case "fs/remove":
		return "Remove Path"
	case "fs/copy":
		return "Copy Path"
	case "fs/move":
		return "Move Path"
	case "skills/config/write":
		return "Skills Config Write"
	case "config/mcp-server/reload":
		return "MCP Server Reload"
	case "windows-sandbox/setup-start":
		return "Windows Sandbox Setup Start"
	case "plugins/install":
		return "Plugin Install"
	case "plugins/uninstall":
		return "Plugin Uninstall"
	case "external-agent/import":
		return "External Agent Import"
	case "automation/run":
		return "Automation Run"
	case "bot/webhook":
		return "Bot Webhook"
	case "hook/follow-up":
		return "Hook Follow-up"
	default:
		if exactLabel := formatKnownHookRunToolLabel(value); exactLabel != "" {
			return exactLabel
		}
		return humanizeHookRunDisplayValue(strings.ReplaceAll(strings.TrimSpace(value), "/", " / "))
	}
}

func formatHookRunHandlerFallback(value string) string {
	text := strings.TrimSpace(value)
	if text == "" {
		return ""
	}
	if !strings.Contains(text, ".") {
		return humanizeHookRunDisplayValue(text)
	}

	parts := strings.Split(text, ".")
	labels := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		labels = append(labels, humanizeHookRunDisplayValue(part))
	}
	return strings.Join(labels, " / ")
}

func formatHookRunPathToolLabel(value string, separator string) string {
	rawParts := strings.Split(value, separator)
	parts := make([]string, 0, len(rawParts))
	for _, rawPart := range rawParts {
		part := strings.TrimSpace(rawPart)
		if part == "" {
			continue
		}
		parts = append(parts, formatHookRunToolSegment(part))
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, " / ")
}

func formatHookRunToolSegment(value string) string {
	switch normalizeHookRunToolValue(value) {
	case "fs":
		return "Filesystem"
	case "mcp":
		return "MCP"
	case "config":
		return "Config"
	case "thread":
		return "Thread"
	case "turn":
		return "Turn"
	case "review":
		return "Review"
	case "shellcommand":
		return "Shell Command"
	case "writefile":
		return "Write File"
	case "remove":
		return "Remove Path"
	case "copy":
		return "Copy Path"
	case "move":
		return "Move Path"
	case "batchwrite":
		return "Batch Write"
	default:
		return humanizeHookRunDisplayValue(value)
	}
}

func formatKnownHookRunToolLabel(value string) string {
	switch normalizeHookRunToolValue(value) {
	case "commandexec", "commandexecution":
		return "Command Execution"
	case "threadshellcommand":
		return "Thread Shell Command"
	case "fswritefile", "filewrite":
		return "Write File"
	case "fsremove", "pathremove":
		return "Remove Path"
	case "fscopy", "pathcopy":
		return "Copy Path"
	case "fsmove", "pathmove":
		return "Move Path"
	case "configvaluewrite":
		return "Write Config Value"
	case "configbatchwrite":
		return "Batch Config Write"
	case "configwrite":
		return "Config Write"
	case "turnstart":
		return "Turn Start"
	case "turnsteer":
		return "Turn Steer"
	case "turninterrupt":
		return "Turn Interrupt"
	case "reviewstart":
		return "Review Start"
	case "mcpelicitationrequest":
		return "MCP Elicitation Request"
	case "mcptoolcall":
		return "MCP Tool Call"
	case "dynamictoolcallrequest":
		return "Dynamic Tool Call Request"
	case "commandexecutionapprovalrequest":
		return "Command Execution Approval Request"
	case "filechangeapprovalrequest":
		return "File Change Approval Request"
	case "permissionsapprovalrequest":
		return "Permissions Approval Request"
	default:
		return ""
	}
}

func normalizeHookRunToolValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	return strings.NewReplacer(
		" ", "",
		"_", "",
		"-", "",
		"/", "",
		"\\", "",
	).Replace(strings.ToLower(trimmed))
}

func firstNonEmptyDisplayValue(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func formatStructuredHookOutputEntryText(value string, separator string) (string, bool) {
	index := strings.Index(value, separator)
	if index <= 0 {
		return "", false
	}

	label := formatStructuredHookOutputEntryLabel(value[:index])
	if label == "" {
		return "", false
	}

	return label + ": " + strings.TrimSpace(value[index+len(separator):]), true
}

func formatStructuredHookOutputEntryLabel(value string) string {
	normalized := normalizeHookRunDisplayValue(value)
	if _, ok := structuredHookOutputEntryKeys[normalized]; !ok {
		return ""
	}

	return humanizeHookRunDisplayValue(value)
}

func FormatHookRunEventName(value string) string {
	switch strings.TrimSpace(value) {
	case "SessionStart":
		return "Session Start"
	case "UserPromptSubmit":
		return "User Prompt Submit"
	case "PreToolUse":
		return "Pre-Tool Use"
	case "PostToolUse":
		return "Post-Tool Use"
	case "ServerRequest":
		return "Server Request"
	case "TurnStart":
		return "Turn Start"
	case "TurnSteer":
		return "Turn Steer"
	case "TurnInterrupt":
		return "Turn Interrupt"
	case "ReviewStart":
		return "Review Start"
	case "HttpMutation":
		return "HTTP Mutation"
	default:
		return humanizeHookRunDisplayValue(value)
	}
}

func FormatHookRunStatus(value string) string {
	switch normalizeHookRunDisplayValue(value) {
	case "loading":
		return "Loading"
	case "idle":
		return "Idle"
	case "ready":
		return "Ready"
	case "active":
		return "Active"
	case "success":
		return "Success"
	case "connected":
		return "Connected"
	case "submitted":
		return "Submitted"
	case "pending":
		return "Pending"
	case "queued":
		return "Queued"
	case "info":
		return "Info"
	case "warning":
		return "Warning"
	case "restarting":
		return "Restarting"
	case "restarted":
		return "Restarted"
	case "restartrequired":
		return "Restart Required"
	case "running":
		return "Running"
	case "connecting":
		return "Connecting"
	case "loaded":
		return "Loaded"
	case "initial":
		return "Initial"
	case "inprogress":
		return "In progress"
	case "processing":
		return "Processing"
	case "sending":
		return "Sending"
	case "waiting":
		return "Waiting"
	case "starting":
		return "Starting"
	case "streaming":
		return "Streaming"
	case "paused":
		return "Paused"
	case "closed":
		return "Closed"
	case "failed":
		return "Failed"
	case "error", "systemerror":
		return "Error"
	case "completed":
		return "Completed"
	case "cancelled", "canceled":
		return "Cancelled"
	case "archived":
		return "Archived"
	case "stopped", "interrupted":
		return "Stopped"
	case "unconfigured":
		return "Unconfigured"
	case "open":
		return "Open"
	case "resolved":
		return "Resolved"
	case "reviewing":
		return "Awaiting approval"
	case "notloaded":
		return "Not loaded"
	case "nottracked":
		return "Not tracked"
	case "unknown":
		return "Unknown"
	case "rejected":
		return "Rejected"
	case "denied":
		return "Denied"
	case "expired":
		return "Expired"
	case "confirmed":
		return "Confirmed"
	case "debug":
		return "Debug"
	case "normal":
		return "Normal"
	case "wait":
		return "Waiting for scan"
	case "scaned", "scanned":
		return "Scanned"
	default:
		return humanizeHookRunDisplayValue(value)
	}
}

func FormatHookRunDecision(value string) string {
	switch normalizeHookRunDisplayValue(value) {
	case "block":
		return "Block"
	case "continue":
		return "Continue"
	case "continueturn":
		return "Continue Turn"
	default:
		return humanizeHookRunDisplayValue(value)
	}
}

func FormatHookRunReason(value string) string {
	switch strings.TrimSpace(value) {
	case "session_start_audited":
		return "Session start audited"
	case "secret_like_input_blocked":
		return "Secret-like input blocked"
	case "dangerous_command_blocked":
		return "Dangerous command blocked"
	case "protected_governance_file_mutation_blocked":
		return "Protected governance file mutation blocked"
	case "project_context_injected":
		return "Project context injected"
	case "validation_command_failed":
		return "Validation command failed"
	case "file_changes_missing_successful_verification":
		return "File changes missing successful verification"
	case "mcp_elicitation_request_audited":
		return "MCP elicitation request audited"
	case "critical_mcp_tool_call_audited":
		return "Critical MCP tool call audited"
	case "protected_governance_file_mutation_observed_after_mcp_tool_call":
		return "Protected governance file mutation observed after MCP tool call"
	case "dangerous_command_observed_after_mcp_tool_call":
		return "Dangerous command observed after MCP tool call"
	case "command_execution_approval_request_audited":
		return "Command execution approval request audited"
	case "file_change_approval_request_audited":
		return "File change approval request audited"
	case "permissions_approval_request_audited":
		return "Permissions approval request audited"
	case "dynamic_tool_call_request_audited":
		return "Dynamic tool call request audited"
	case "workspace_http_mutation_audited":
		return "Workspace HTTP mutation audited"
	case "config_mcp_server_reload_audited":
		return "MCP server reload audited"
	case "windows_sandbox_setup_start_audited":
		return "Windows sandbox setup start audited"
	case "turn_start_requested":
		return "Turn start requested"
	case "turn_start_audited":
		return "Turn start audited"
	case "turn_start_failed":
		return "Turn start failed"
	case "turn_steer_requested":
		return "Turn steer requested"
	case "turn_steer_audited":
		return "Turn steer audited"
	case "turn_steer_failed":
		return "Turn steer failed"
	case "steer_no_active_turn":
		return "Steer requested without an active turn"
	case "turn_interrupt_requested":
		return "Turn interrupt requested"
	case "turn_interrupt_audited":
		return "Turn interrupt audited"
	case "turn_interrupt_failed":
		return "Turn interrupt failed"
	case "interrupt_no_active_turn":
		return "Interrupt requested without an active turn"
	case "review_start_requested":
		return "Review start requested"
	case "review_start_audited":
		return "Review start audited"
	case "review_start_failed":
		return "Review start failed"
	default:
		return humanizeHookRunDisplayValue(value)
	}
}

func FormatHookRunSessionStartSource(value string) string {
	switch normalizeHookRunDisplayValue(value) {
	case "startup":
		return "Startup"
	case "clear":
		return "Clear"
	case "resume":
		return "Resume"
	default:
		return humanizeHookRunDisplayValue(value)
	}
}

func normalizeHookRunDisplayValue(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}

	return strings.NewReplacer(" ", "", "_", "", "-", "").Replace(strings.ToLower(trimmed))
}

func humanizeHookRunDisplayValue(value string) string {
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
