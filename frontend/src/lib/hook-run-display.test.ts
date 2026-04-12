import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../i18n/runtime'
import {
  formatHookRunHandlerLabel,
  formatHookOutputEntryText,
  formatHookRunFeedbackEntries,
  formatHookRunDecision,
  formatHookRunEventName,
  formatHookRunMessage,
  formatHookRunReason,
  formatHookRunStatus,
  formatHookRunTriggerMethodLabel,
  formatHookRunToolLabel,
  formatSessionStartSource,
} from './hook-run-display'

describe('hook-run-display', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('formats dedicated thread entry hook event names with readable labels', () => {
    expect(formatHookRunEventName('TurnStart')).toBe('Turn Start')
    expect(formatHookRunEventName('TurnSteer')).toBe('Turn Steer')
    expect(formatHookRunEventName('TurnInterrupt')).toBe('Turn Interrupt')
    expect(formatHookRunEventName('ReviewStart')).toBe('Review Start')
  })

  it('formats common governance reasons with readable labels', () => {
    expect(formatHookRunReason('turn_start_audited')).toBe('Turn start audited')
    expect(formatHookRunReason('steer_no_active_turn')).toBe('Steer requested without an active turn')
    expect(formatHookRunReason('validation_command_failed')).toBe('Validation command failed')
    expect(formatHookRunReason('mcp_elicitation_request_audited')).toBe(
      'MCP elicitation request audited',
    )
    expect(
      formatHookRunReason('protected_governance_file_mutation_observed_after_mcp_tool_call'),
    ).toBe('Protected governance file mutation observed after MCP tool call')
    expect(formatHookRunReason('config_mcp_server_reload_audited')).toBe(
      'MCP server reload audited',
    )
  })

  it('formats hook run status and decision labels', () => {
    expect(formatHookRunStatus('inProgress')).toBe('In progress')
    expect(formatHookRunDecision('continueTurn')).toBe('Continue Turn')
    expect(formatSessionStartSource('resume')).toBe('Resume')
  })

  it('formats hook run tool labels with readable names', () => {
    expect(formatHookRunToolLabel('command/exec')).toBe('Command Execution')
    expect(formatHookRunToolLabel(undefined, 'commandExecution')).toBe('Command Execution')
    expect(formatHookRunToolLabel('filesystem/write_file')).toBe('Filesystem / Write File')
    expect(formatHookRunToolLabel('mcp/filesystem/exec_command')).toBe(
      'MCP / Filesystem / Exec Command',
    )
  })

  it('formats hook run handler labels with readable names', () => {
    expect(formatHookRunHandlerLabel('builtin.posttooluse.failed-validation-rescue')).toBe(
      'Failed Validation Rescue',
    )
    expect(formatHookRunHandlerLabel('builtin.pretooluse.block-dangerous-command')).toBe(
      'Dangerous Command Guard',
    )
    expect(formatHookRunHandlerLabel('builtin.httpmutation.audit-workspace-mutation')).toBe(
      'Workspace Mutation Audit',
    )
  })

  it('formats hook run trigger labels with readable names', () => {
    expect(formatHookRunTriggerMethodLabel('item/completed')).toBe('Item Completed')
    expect(formatHookRunTriggerMethodLabel('turn/start')).toBe('Turn Start')
    expect(formatHookRunTriggerMethodLabel('mcpServer/elicitation/request')).toBe(
      'MCP Elicitation Request',
    )
    expect(formatHookRunTriggerMethodLabel('item/commandExecution/requestApproval')).toBe(
      'Command Execution Approval Request',
    )
    expect(formatHookRunTriggerMethodLabel('fs/write')).toBe('Write File')
  })

  it('formats structured hook output entry text with readable labels', () => {
    expect(formatHookOutputEntryText('sourcePath=.codex/hooks.json')).toBe(
      'Source Path: .codex/hooks.json',
    )
    expect(formatHookOutputEntryText('matched policy: broad-recursive-delete')).toBe(
      'Matched Policy: broad-recursive-delete',
    )
    expect(
      formatHookRunFeedbackEntries([
        { kind: 'feedback', text: 'command=go test ./...; status=failed; exitCode=1' },
        { kind: 'context', text: 'matched path: docs/governance.md' },
      ]),
    ).toBe(
      'Command: go test ./...; status=failed; exitCode=1 | Matched Path: docs/governance.md',
    )
  })

  it('builds readable hook run summary messages', () => {
    expect(
      formatHookRunMessage({
        eventName: 'PostToolUse',
        handlerKey: 'builtin.posttooluse.failed-validation-rescue',
        triggerMethod: 'item/completed',
        status: 'completed',
        decision: 'continueTurn',
        toolName: 'command/exec',
        reason: 'validation_command_failed',
      }),
    ).toBe(
      'Event: Post-Tool Use\nHandler: Failed Validation Rescue\nStatus: Completed\nDecision: Continue Turn\nTrigger: Item Completed\nTool: Command Execution\nReason: Validation command failed',
    )
  })

  it('falls back to humanized labels for unmapped values', () => {
    expect(formatHookRunEventName('CustomHookEvent')).toBe('Custom Hook Event')
    expect(formatHookRunReason('custom_reason_code')).toBe('Custom Reason Code')
  })

  it('includes session start source in readable hook run summary messages', () => {
    expect(
      formatHookRunMessage({
        eventName: 'SessionStart',
        handlerKey: 'builtin.sessionstart.inject-project-context',
        status: 'completed',
        decision: 'continue',
        triggerMethod: 'turn/start',
        reason: 'project_context_injected',
        sessionStartSource: 'clear',
      }),
    ).toBe(
      'Event: Session Start\nHandler: Project Context Injection\nStatus: Completed\nDecision: Continue\nTrigger: Turn Start\nSession Start Source: Clear\nReason: Project context injected',
    )
  })
})
