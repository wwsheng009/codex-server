import { formatLocalizedStatusLabel, humanizeDisplayValue } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import type { HookOutputEntry } from '../types/api'

type HookRunMessageFields = {
  eventName?: string | null
  handlerKey?: string | null
  triggerMethod?: string | null
  status?: string | null
  decision?: string | null
  reason?: string | null
  feedback?: string | null
  sessionStartSource?: string | null
  toolName?: string | null
  toolKind?: string | null
}

function trimHookRunValue(value?: string | null) {
  return String(value ?? '').trim()
}

function normalizeHookRunValue(value?: string | null) {
  return trimHookRunValue(value)
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function normalizeHookRunToolValue(value?: string | null) {
  return trimHookRunValue(value)
    .toLowerCase()
    .replace(/[\\/_\-\s]+/g, '')
}

function formatHookRunHandlerFallback(value?: string | null) {
  const text = trimHookRunValue(value)
  if (!text) {
    return ''
  }

  if (!text.includes('.')) {
    return humanizeDisplayValue(text, '—')
  }

  return text
    .split('.')
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => humanizeDisplayValue(segment, ''))
    .filter(Boolean)
    .join(' / ')
}

const structuredHookOutputEntryKeys = new Set([
  'targetpath',
  'sourcepath',
  'destinationpath',
  'matchedpath',
  'matchedpolicy',
  'command',
  'server',
  'tool',
  'mode',
  'requestkind',
  'permissionscount',
  'changecount',
  'path',
  'reason',
  'status',
])

function formatStructuredHookOutputEntryLabel(value: string) {
  const normalized = normalizeHookRunValue(value)
  if (!structuredHookOutputEntryKeys.has(normalized)) {
    return ''
  }

  return humanizeDisplayValue(value, '')
}

export function formatHookOutputEntryText(value?: string | null) {
  const text = trimHookRunValue(value)
  if (!text) {
    return ''
  }

  const equalsIndex = text.indexOf('=')
  if (equalsIndex > 0) {
    const label = formatStructuredHookOutputEntryLabel(text.slice(0, equalsIndex))
    if (label) {
      return `${label}: ${text.slice(equalsIndex + 1).trim()}`
    }
  }

  const colonIndex = text.indexOf(':')
  if (colonIndex > 0) {
    const label = formatStructuredHookOutputEntryLabel(text.slice(0, colonIndex))
    if (label) {
      return `${label}: ${text.slice(colonIndex + 1).trim()}`
    }
  }

  return text
}

export function formatHookRunFeedbackEntries(entries?: HookOutputEntry[] | null, limit = 2) {
  if (!entries?.length) {
    return ''
  }

  const formattedEntries = entries
    .map((entry) => formatHookOutputEntryText(entry.text))
    .filter(Boolean)

  if (formattedEntries.length === 0) {
    return ''
  }

  return formattedEntries.slice(0, Math.max(limit, 1)).join(' | ')
}

export function formatHookRunHandlerLabel(value?: string | null) {
  switch (trimHookRunValue(value)) {
    case 'builtin.sessionstart.inject-project-context':
      return i18n._({ id: 'Project Context Injection', message: 'Project Context Injection' })
    case 'builtin.userpromptsubmit.block-secret-paste':
      return i18n._({ id: 'Secret Paste Guard', message: 'Secret Paste Guard' })
    case 'builtin.pretooluse.block-dangerous-command':
      return i18n._({ id: 'Dangerous Command Guard', message: 'Dangerous Command Guard' })
    case 'builtin.pretooluse.block-protected-governance-file-mutation':
      return i18n._({
        id: 'Protected Governance File Mutation Guard',
        message: 'Protected Governance File Mutation Guard',
      })
    case 'builtin.posttooluse.failed-validation-rescue':
      return i18n._({ id: 'Failed Validation Rescue', message: 'Failed Validation Rescue' })
    case 'builtin.posttooluse.audit-mcp-tool-call':
      return i18n._({ id: 'MCP Tool Call Audit', message: 'MCP Tool Call Audit' })
    case 'builtin.serverrequest.audit-mcp-elicitation-request':
      return i18n._({
        id: 'MCP Elicitation Request Audit',
        message: 'MCP Elicitation Request Audit',
      })
    case 'builtin.serverrequest.audit-approval-request':
      return i18n._({ id: 'Approval Request Audit', message: 'Approval Request Audit' })
    case 'builtin.turnstart.audit-thread-turn-start':
      return i18n._({ id: 'Thread Turn Start Audit', message: 'Thread Turn Start Audit' })
    case 'builtin.turnsteer.audit-thread-turn-steer':
      return i18n._({ id: 'Thread Turn Steer Audit', message: 'Thread Turn Steer Audit' })
    case 'builtin.turninterrupt.audit-thread-interrupt':
      return i18n._({ id: 'Thread Interrupt Audit', message: 'Thread Interrupt Audit' })
    case 'builtin.reviewstart.audit-thread-review-start':
      return i18n._({ id: 'Thread Review Start Audit', message: 'Thread Review Start Audit' })
    case 'builtin.httpmutation.audit-workspace-mutation':
      return i18n._({ id: 'Workspace Mutation Audit', message: 'Workspace Mutation Audit' })
    case 'builtin.stop.require-successful-verification':
      return i18n._({
        id: 'Successful Verification Requirement',
        message: 'Successful Verification Requirement',
      })
    default:
      return formatHookRunHandlerFallback(value)
  }
}

export function formatHookRunTriggerMethodLabel(value?: string | null) {
  const text = trimHookRunValue(value)
  if (!text) {
    return ''
  }

  switch (text) {
    case 'item/started':
      return i18n._({ id: 'Item Started', message: 'Item Started' })
    case 'item/completed':
      return i18n._({ id: 'Item Completed', message: 'Item Completed' })
    case 'turn/completed':
      return i18n._({ id: 'Turn Completed', message: 'Turn Completed' })
    case 'tool/use':
      return i18n._({ id: 'Tool Use', message: 'Tool Use' })
    case 'turn/input':
      return i18n._({ id: 'Turn Input', message: 'Turn Input' })
    case 'item/tool/call':
      return i18n._({ id: 'Tool Call', message: 'Tool Call' })
    case 'mcpServer/elicitation/request':
      return i18n._({ id: 'MCP Elicitation Request', message: 'MCP Elicitation Request' })
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return i18n._({
        id: 'Command Execution Approval Request',
        message: 'Command Execution Approval Request',
      })
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return i18n._({ id: 'File Change Approval Request', message: 'File Change Approval Request' })
    case 'item/permissions/requestApproval':
      return i18n._({ id: 'Permissions Approval Request', message: 'Permissions Approval Request' })
    case 'fs/write':
      return i18n._({ id: 'Write File', message: 'Write File' })
    case 'fs/mkdir':
      return i18n._({ id: 'Create Directory', message: 'Create Directory' })
    case 'fs/remove':
      return i18n._({ id: 'Remove Path', message: 'Remove Path' })
    case 'fs/copy':
      return i18n._({ id: 'Copy Path', message: 'Copy Path' })
    case 'fs/move':
      return i18n._({ id: 'Move Path', message: 'Move Path' })
    case 'skills/config/write':
      return i18n._({ id: 'Skills Config Write', message: 'Skills Config Write' })
    case 'config/mcp-server/reload':
      return i18n._({ id: 'MCP Server Reload', message: 'MCP Server Reload' })
    case 'windows-sandbox/setup-start':
      return i18n._({ id: 'Windows Sandbox Setup Start', message: 'Windows Sandbox Setup Start' })
    case 'plugins/install':
      return i18n._({ id: 'Plugin Install', message: 'Plugin Install' })
    case 'plugins/uninstall':
      return i18n._({ id: 'Plugin Uninstall', message: 'Plugin Uninstall' })
    case 'external-agent/import':
      return i18n._({ id: 'External Agent Import', message: 'External Agent Import' })
    case 'automation/run':
      return i18n._({ id: 'Automation Run', message: 'Automation Run' })
    case 'bot/webhook':
      return i18n._({ id: 'Bot Webhook', message: 'Bot Webhook' })
    case 'hook/follow-up':
      return i18n._({ id: 'Hook Follow-up', message: 'Hook Follow-up' })
    default: {
      const exactLabel = formatHookRunKnownToolLabel(value)
      if (exactLabel) {
        return exactLabel
      }
      return humanizeDisplayValue(text.replaceAll('/', ' / '), '—')
    }
  }
}

function formatHookRunToolSegment(value?: string | null) {
  switch (normalizeHookRunToolValue(value)) {
    case 'fs':
      return i18n._({ id: 'Filesystem', message: 'Filesystem' })
    case 'mcp':
      return i18n._({ id: 'MCP', message: 'MCP' })
    case 'config':
      return i18n._({ id: 'Config', message: 'Config' })
    case 'thread':
      return i18n._({ id: 'Thread', message: 'Thread' })
    case 'turn':
      return i18n._({ id: 'Turn', message: 'Turn' })
    case 'review':
      return i18n._({ id: 'Review', message: 'Review' })
    case 'shellcommand':
      return i18n._({ id: 'Shell Command', message: 'Shell Command' })
    case 'writefile':
      return i18n._({ id: 'Write File', message: 'Write File' })
    case 'remove':
      return i18n._({ id: 'Remove Path', message: 'Remove Path' })
    case 'copy':
      return i18n._({ id: 'Copy Path', message: 'Copy Path' })
    case 'move':
      return i18n._({ id: 'Move Path', message: 'Move Path' })
    case 'batchwrite':
      return i18n._({ id: 'Batch Write', message: 'Batch Write' })
    default:
      return humanizeDisplayValue(value, '')
  }
}

function formatHookRunKnownToolLabel(value?: string | null) {
  switch (normalizeHookRunToolValue(value)) {
    case 'commandexec':
    case 'commandexecution':
      return i18n._({ id: 'Command Execution', message: 'Command Execution' })
    case 'threadshellcommand':
      return i18n._({ id: 'Thread Shell Command', message: 'Thread Shell Command' })
    case 'fswritefile':
    case 'filewrite':
      return i18n._({ id: 'Write File', message: 'Write File' })
    case 'fsremove':
    case 'pathremove':
      return i18n._({ id: 'Remove Path', message: 'Remove Path' })
    case 'fscopy':
    case 'pathcopy':
      return i18n._({ id: 'Copy Path', message: 'Copy Path' })
    case 'fsmove':
    case 'pathmove':
      return i18n._({ id: 'Move Path', message: 'Move Path' })
    case 'configvaluewrite':
      return i18n._({ id: 'Write Config Value', message: 'Write Config Value' })
    case 'configbatchwrite':
      return i18n._({ id: 'Batch Config Write', message: 'Batch Config Write' })
    case 'configwrite':
      return i18n._({ id: 'Config Write', message: 'Config Write' })
    case 'turnstart':
      return i18n._({ id: 'Turn Start', message: 'Turn Start' })
    case 'turnsteer':
      return i18n._({ id: 'Turn Steer', message: 'Turn Steer' })
    case 'turninterrupt':
      return i18n._({ id: 'Turn Interrupt', message: 'Turn Interrupt' })
    case 'reviewstart':
      return i18n._({ id: 'Review Start', message: 'Review Start' })
    case 'mcpelicitationrequest':
      return i18n._({ id: 'MCP Elicitation Request', message: 'MCP Elicitation Request' })
    case 'mcptoolcall':
      return i18n._({ id: 'MCP Tool Call', message: 'MCP Tool Call' })
    case 'dynamictoolcallrequest':
      return i18n._({ id: 'Dynamic Tool Call Request', message: 'Dynamic Tool Call Request' })
    case 'commandexecutionapprovalrequest':
      return i18n._({
        id: 'Command Execution Approval Request',
        message: 'Command Execution Approval Request',
      })
    case 'filechangeapprovalrequest':
      return i18n._({ id: 'File Change Approval Request', message: 'File Change Approval Request' })
    case 'permissionsapprovalrequest':
      return i18n._({ id: 'Permissions Approval Request', message: 'Permissions Approval Request' })
    default:
      return ''
  }
}

function formatHookRunPathToolLabel(value: string, separator: string) {
  const parts = value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return ''
  }

  return parts.map((part) => formatHookRunToolSegment(part)).filter(Boolean).join(' / ')
}

export function formatHookRunToolLabel(toolName?: string | null, toolKind?: string | null) {
  const primary = trimHookRunValue(toolName) || trimHookRunValue(toolKind)
  if (!primary) {
    return ''
  }

  const exactLabel = formatHookRunKnownToolLabel(primary)
  if (exactLabel) {
    return exactLabel
  }

  if (primary.includes('__')) {
    const segmentedLabel = formatHookRunPathToolLabel(primary, '__')
    if (segmentedLabel) {
      return segmentedLabel
    }
  }
  if (primary.includes('/')) {
    const segmentedLabel = formatHookRunPathToolLabel(primary, '/')
    if (segmentedLabel) {
      return segmentedLabel
    }
  }

  return formatHookRunToolSegment(primary) || humanizeDisplayValue(primary, '—')
}

export function formatHookRunEventName(value?: string | null) {
  switch (trimHookRunValue(value)) {
    case 'SessionStart':
      return i18n._({ id: 'Session Start', message: 'Session Start' })
    case 'UserPromptSubmit':
      return i18n._({ id: 'User Prompt Submit', message: 'User Prompt Submit' })
    case 'PreToolUse':
      return i18n._({ id: 'Pre-Tool Use', message: 'Pre-Tool Use' })
    case 'PostToolUse':
      return i18n._({ id: 'Post-Tool Use', message: 'Post-Tool Use' })
    case 'ServerRequest':
      return i18n._({ id: 'Server Request', message: 'Server Request' })
    case 'TurnStart':
      return i18n._({ id: 'Turn Start', message: 'Turn Start' })
    case 'TurnSteer':
      return i18n._({ id: 'Turn Steer', message: 'Turn Steer' })
    case 'TurnInterrupt':
      return i18n._({ id: 'Turn Interrupt', message: 'Turn Interrupt' })
    case 'ReviewStart':
      return i18n._({ id: 'Review Start', message: 'Review Start' })
    case 'HttpMutation':
      return i18n._({ id: 'HTTP Mutation', message: 'HTTP Mutation' })
    default:
      return humanizeDisplayValue(value, '—')
  }
}

export function formatHookRunStatus(value?: string | null, fallback = '—') {
  return formatLocalizedStatusLabel(value, fallback)
}

export function formatHookRunDecision(value?: string | null, fallback = '—') {
  switch (normalizeHookRunValue(value)) {
    case 'block':
      return i18n._({ id: 'Block', message: 'Block' })
    case 'continue':
      return i18n._({ id: 'Continue', message: 'Continue' })
    case 'continueturn':
      return i18n._({ id: 'Continue Turn', message: 'Continue Turn' })
    default:
      return humanizeDisplayValue(value, fallback)
  }
}

export function formatHookRunReason(value?: string | null) {
  switch (trimHookRunValue(value)) {
    case 'session_start_audited':
      return i18n._({ id: 'Session start audited', message: 'Session start audited' })
    case 'secret_like_input_blocked':
      return i18n._({ id: 'Secret-like input blocked', message: 'Secret-like input blocked' })
    case 'dangerous_command_blocked':
      return i18n._({ id: 'Dangerous command blocked', message: 'Dangerous command blocked' })
    case 'protected_governance_file_mutation_blocked':
      return i18n._({
        id: 'Protected governance file mutation blocked',
        message: 'Protected governance file mutation blocked',
      })
    case 'project_context_injected':
      return i18n._({ id: 'Project context injected', message: 'Project context injected' })
    case 'validation_command_failed':
      return i18n._({ id: 'Validation command failed', message: 'Validation command failed' })
    case 'file_changes_missing_successful_verification':
      return i18n._({
        id: 'File changes missing successful verification',
        message: 'File changes missing successful verification',
      })
    case 'mcp_elicitation_request_audited':
      return i18n._({ id: 'MCP elicitation request audited', message: 'MCP elicitation request audited' })
    case 'critical_mcp_tool_call_audited':
      return i18n._({ id: 'Critical MCP tool call audited', message: 'Critical MCP tool call audited' })
    case 'protected_governance_file_mutation_observed_after_mcp_tool_call':
      return i18n._({
        id: 'Protected governance file mutation observed after MCP tool call',
        message: 'Protected governance file mutation observed after MCP tool call',
      })
    case 'dangerous_command_observed_after_mcp_tool_call':
      return i18n._({
        id: 'Dangerous command observed after MCP tool call',
        message: 'Dangerous command observed after MCP tool call',
      })
    case 'command_execution_approval_request_audited':
      return i18n._({
        id: 'Command execution approval request audited',
        message: 'Command execution approval request audited',
      })
    case 'file_change_approval_request_audited':
      return i18n._({
        id: 'File change approval request audited',
        message: 'File change approval request audited',
      })
    case 'permissions_approval_request_audited':
      return i18n._({
        id: 'Permissions approval request audited',
        message: 'Permissions approval request audited',
      })
    case 'dynamic_tool_call_request_audited':
      return i18n._({
        id: 'Dynamic tool call request audited',
        message: 'Dynamic tool call request audited',
      })
    case 'workspace_http_mutation_audited':
      return i18n._({ id: 'Workspace HTTP mutation audited', message: 'Workspace HTTP mutation audited' })
    case 'config_mcp_server_reload_audited':
      return i18n._({ id: 'MCP server reload audited', message: 'MCP server reload audited' })
    case 'windows_sandbox_setup_start_audited':
      return i18n._({
        id: 'Windows sandbox setup start audited',
        message: 'Windows sandbox setup start audited',
      })
    case 'turn_start_requested':
      return i18n._({ id: 'Turn start requested', message: 'Turn start requested' })
    case 'turn_start_audited':
      return i18n._({ id: 'Turn start audited', message: 'Turn start audited' })
    case 'turn_start_failed':
      return i18n._({ id: 'Turn start failed', message: 'Turn start failed' })
    case 'turn_steer_requested':
      return i18n._({ id: 'Turn steer requested', message: 'Turn steer requested' })
    case 'turn_steer_audited':
      return i18n._({ id: 'Turn steer audited', message: 'Turn steer audited' })
    case 'turn_steer_failed':
      return i18n._({ id: 'Turn steer failed', message: 'Turn steer failed' })
    case 'steer_no_active_turn':
      return i18n._({
        id: 'Steer requested without an active turn',
        message: 'Steer requested without an active turn',
      })
    case 'turn_interrupt_requested':
      return i18n._({ id: 'Turn interrupt requested', message: 'Turn interrupt requested' })
    case 'turn_interrupt_audited':
      return i18n._({ id: 'Turn interrupt audited', message: 'Turn interrupt audited' })
    case 'turn_interrupt_failed':
      return i18n._({ id: 'Turn interrupt failed', message: 'Turn interrupt failed' })
    case 'interrupt_no_active_turn':
      return i18n._({
        id: 'Interrupt requested without an active turn',
        message: 'Interrupt requested without an active turn',
      })
    case 'review_start_requested':
      return i18n._({ id: 'Review start requested', message: 'Review start requested' })
    case 'review_start_audited':
      return i18n._({ id: 'Review start audited', message: 'Review start audited' })
    case 'review_start_failed':
      return i18n._({ id: 'Review start failed', message: 'Review start failed' })
    default:
      return humanizeDisplayValue(value, '—')
  }
}

export function formatSessionStartSource(value?: string | null, fallback = '—') {
  switch (normalizeHookRunValue(value)) {
    case 'startup':
      return i18n._({ id: 'Startup', message: 'Startup' })
    case 'clear':
      return i18n._({ id: 'Clear', message: 'Clear' })
    case 'resume':
      return i18n._({ id: 'Resume', message: 'Resume' })
    default:
      return humanizeDisplayValue(value, fallback)
  }
}

export function formatHookRunMessage({
  eventName,
  handlerKey,
  triggerMethod,
  status,
  decision,
  reason,
  feedback,
  sessionStartSource,
  toolName,
  toolKind,
}: HookRunMessageFields) {
  const lines: string[] = []

  if (trimHookRunValue(eventName)) {
    lines.push(`Event: ${formatHookRunEventName(eventName)}`)
  }
  const handlerLabel = formatHookRunHandlerLabel(handlerKey)
  if (handlerLabel) {
    lines.push(`Handler: ${handlerLabel}`)
  }
  if (trimHookRunValue(status)) {
    lines.push(`Status: ${formatHookRunStatus(status)}`)
  }
  if (trimHookRunValue(decision)) {
    lines.push(`Decision: ${formatHookRunDecision(decision)}`)
  }
  const triggerMethodLabel = formatHookRunTriggerMethodLabel(triggerMethod)
  if (triggerMethodLabel) {
    lines.push(`Trigger: ${triggerMethodLabel}`)
  }
  const toolLabel = formatHookRunToolLabel(toolName, toolKind)
  if (toolLabel) {
    lines.push(`Tool: ${toolLabel}`)
  }
  if (trimHookRunValue(sessionStartSource)) {
    lines.push(`Session Start Source: ${formatSessionStartSource(sessionStartSource)}`)
  }
  if (trimHookRunValue(reason)) {
    lines.push(`Reason: ${formatHookRunReason(reason)}`)
  }
  if (trimHookRunValue(feedback)) {
    lines.push(`Feedback: ${trimHookRunValue(feedback)}`)
  }

  if (!lines.length) {
    return i18n._({ id: 'Hook run updated', message: 'Hook run updated' })
  }

  return lines.join('\n')
}
