import type { PendingApproval, ServerEvent } from '../../types/api'
import type { ApprovalCacheQueryClient } from './approvalTypes'

const snapshotMethod = 'approvals/snapshot'

const approvalRequestMethods = new Set([
  'item/commandExecution/requestApproval',
  'execCommandApproval',
  'item/fileChange/requestApproval',
  'applyPatchApproval',
  'item/tool/requestUserInput',
  'item/permissions/requestApproval',
  'mcpServer/elicitation/request',
  'item/tool/call',
  'account/chatgptAuthTokens/refresh',
])

const approvalResolutionMethods = new Set(['server/request/resolved', 'server/request/expired'])

export function applyApprovalEventToCache(
  queryClient: ApprovalCacheQueryClient,
  workspaceId: string,
  event: ServerEvent,
) {
  if (!canApplyApprovalEvent(event)) {
    return false
  }

  queryClient.setQueryData<PendingApproval[]>(['approvals', workspaceId], (current) =>
    nextApprovalsForEvent(current, event),
  )
  return true
}

export function nextApprovalsForEvent(
  current: PendingApproval[] | undefined,
  event: ServerEvent,
): PendingApproval[] | undefined {
  if (event.method === snapshotMethod) {
    return sortPendingApprovals(readApprovalsSnapshot(event.payload))
  }

  if (approvalResolutionMethods.has(event.method)) {
    return removeApprovalFromList(current, event.serverRequestId)
  }

  if (!approvalRequestMethods.has(event.method)) {
    return undefined
  }

  const approval = buildPendingApprovalFromEvent(event)
  if (!approval) {
    return undefined
  }

  return upsertApprovalInList(current, approval)
}

export function removeApprovalFromList(
  current: PendingApproval[] | undefined,
  requestId?: string | null,
) {
  if (!requestId) {
    return current
  }

  const items = current ?? []
  const nextItems = items.filter((approval) => approval.id !== requestId)
  return nextItems.length === items.length ? current : nextItems
}

export function removeThreadApprovalsFromList(
  current: PendingApproval[] | undefined,
  threadId?: string,
) {
  if (!threadId) {
    return current
  }

  const items = current ?? []
  const nextItems = items.filter((approval) => approval.threadId !== threadId)
  return nextItems.length === items.length ? current : nextItems
}

function buildPendingApprovalFromEvent(event: ServerEvent): PendingApproval | null {
  const requestId = stringField(event.serverRequestId)
  if (!requestId) {
    return null
  }

  const details = asObject(event.payload)
  const threadId = event.threadId || stringField(details.threadId)
  if (!threadId) {
    return null
  }

  return {
    id: requestId,
    workspaceId: event.workspaceId,
    threadId,
    kind: event.method,
    summary: summarizeApprovalRequest(event.method, details),
    status: 'pending',
    actions: approvalActions(event.method),
    details,
    requestedAt: event.ts,
  }
}

function canApplyApprovalEvent(event: ServerEvent) {
  if (event.method === snapshotMethod) {
    return true
  }

  if (approvalResolutionMethods.has(event.method)) {
    return Boolean(event.serverRequestId)
  }

  if (!approvalRequestMethods.has(event.method)) {
    return false
  }

  return buildPendingApprovalFromEvent(event) !== null
}

function readApprovalsSnapshot(payload: unknown) {
  const typedPayload = asObject(payload)
  const items = Array.isArray(typedPayload.approvals) ? typedPayload.approvals : []
  return items
    .map((entry) => readPendingApproval(entry))
    .filter((entry): entry is PendingApproval => entry !== null)
}

function readPendingApproval(value: unknown): PendingApproval | null {
  const entry = asObject(value)
  const id = stringField(entry.id)
  const workspaceId = stringField(entry.workspaceId)
  const threadId = stringField(entry.threadId)
  const kind = stringField(entry.kind)
  const summary = stringField(entry.summary)
  const status = stringField(entry.status)
  const requestedAt = stringField(entry.requestedAt)

  if (!id || !workspaceId || !threadId || !kind || !summary || !status || !requestedAt) {
    return null
  }

  return {
    id,
    workspaceId,
    threadId,
    kind,
    summary,
    status,
    actions: stringList(entry.actions),
    details: asNullableObject(entry.details),
    requestedAt,
  }
}

function upsertApprovalInList(current: PendingApproval[] | undefined, approval: PendingApproval) {
  const items = current ?? []
  const nextItems = items.some((entry) => entry.id === approval.id)
    ? items.map((entry) => (entry.id === approval.id ? approval : entry))
    : [approval, ...items]

  return sortPendingApprovals(nextItems)
}

function sortPendingApprovals(items: PendingApproval[]) {
  return [...items].sort(
    (left, right) => parseTimestamp(right.requestedAt) - parseTimestamp(left.requestedAt),
  )
}

function summarizeApprovalRequest(method: string, details: Record<string, unknown>) {
  switch (method) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval': {
      const command = stringField(details.command)
      return command || method
    }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval': {
      const path = stringField(details.path)
      if (path) {
        return path
      }

      const changeCount = Array.isArray(details.changes) ? details.changes.length : 0
      return changeCount > 0 ? `${changeCount} file change(s)` : method
    }
    case 'item/tool/requestUserInput': {
      const questionCount = Array.isArray(details.questions) ? details.questions.length : 0
      return questionCount > 0 ? `${questionCount} question(s) awaiting user input` : method
    }
    case 'item/permissions/requestApproval':
      return 'Additional permissions requested'
    case 'mcpServer/elicitation/request': {
      const message = stringField(details.message)
      if (message) {
        return message
      }

      const serverName = stringField(details.serverName)
      return serverName ? `MCP input requested by ${serverName}` : method
    }
    case 'item/tool/call': {
      const tool = stringField(details.tool)
      return tool ? `Dynamic tool call: ${tool}` : method
    }
    case 'account/chatgptAuthTokens/refresh': {
      const reason = stringField(details.reason)
      return reason ? `Refresh ChatGPT auth tokens: ${reason}` : 'Refresh ChatGPT auth tokens'
    }
    default: {
      const reason = stringField(details.reason)
      return reason || method
    }
  }
}

function approvalActions(method: string) {
  switch (method) {
    case 'account/chatgptAuthTokens/refresh':
      return ['accept']
    case 'item/tool/requestUserInput':
    case 'mcpServer/elicitation/request':
      return ['accept', 'decline', 'cancel']
    case 'item/permissions/requestApproval':
      return ['accept', 'decline']
    default:
      return ['accept', 'decline', 'cancel']
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function parseTimestamp(value: string) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function asNullableObject(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}
