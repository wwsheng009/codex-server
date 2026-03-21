import type { ServerEvent, ThreadDetail, ThreadTurn } from '../types/api'

export function applyLiveThreadEvents(
  detail: ThreadDetail | undefined,
  events: ServerEvent[],
): ThreadDetail | undefined {
  if (!detail) {
    return detail
  }

  const baselineMs = parseTimestamp(detail.updatedAt)
  if (baselineMs === null) {
    return applyThreadEventsToDetail(detail, events)
  }

  return applyThreadEventsToDetail(
    detail,
    events.filter((event) => {
      const eventMs = parseTimestamp(event.ts)
      return eventMs === null || eventMs > baselineMs
    }),
  )
}

export function applyThreadEventsToDetail(
  detail: ThreadDetail | undefined,
  events: ServerEvent[],
): ThreadDetail | undefined {
  return events.reduce<ThreadDetail | undefined>(
    (current, event) => applyThreadEventToDetail(current, event),
    detail,
  )
}

export function applyThreadEventToDetail(
  detail: ThreadDetail | undefined,
  event: ServerEvent,
): ThreadDetail | undefined {
  if (!detail || !event.threadId || event.threadId !== detail.id) {
    return detail
  }

  const payload = asObject(event.payload)

  if (event.serverRequestId) {
    const requestId = event.serverRequestId

    switch (event.method) {
      case 'server/request/resolved': {
        const turnId = stringField(payload.turnId) || event.turnId
        if (!turnId) {
          return withDetailUpdatedAt(detail, event.ts)
        }

        return updateTurnItem(
          detail,
          turnId,
          requestItemId(requestId),
          (current) => ({
            ...current,
            id: requestItemId(requestId),
            type: 'serverRequest',
            requestId,
            requestKind: stringField(payload.method) || stringField(current?.requestKind),
            status: 'resolved',
            resolvedAt: event.ts,
          }),
          event.ts,
        )
      }
      case 'server/request/expired': {
        const turnId = stringField(payload.turnId) || event.turnId
        if (!turnId) {
          return withDetailUpdatedAt(detail, event.ts)
        }

        return updateTurnItem(
          detail,
          turnId,
          requestItemId(requestId),
          (current) => ({
            ...current,
            id: requestItemId(requestId),
            type: 'serverRequest',
            requestId,
            requestKind: stringField(payload.method) || stringField(current?.requestKind),
            status: 'expired',
            expiredAt: event.ts,
            expireReason: stringField(payload.reason),
          }),
          event.ts,
        )
      }
      default:
        if (isServerRequestMethod(event.method)) {
          const turnId = stringField(payload.turnId) || event.turnId
          if (!turnId) {
            return withDetailUpdatedAt(detail, event.ts)
          }

          return updateTurnItem(
            detail,
            turnId,
            requestItemId(requestId),
            () => ({
              id: requestItemId(requestId),
              type: 'serverRequest',
              requestId,
              requestKind: event.method,
              status: 'pending',
              details: payload,
              requestedAt: event.ts,
            }),
            event.ts,
          )
        }
    }
  }

  switch (event.method) {
    case 'thread/status/changed': {
      const status = stringField(asObject(payload.status).type)
      if (!status || status === detail.status) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      return {
        ...detail,
        status,
        updatedAt: event.ts,
      }
    }
    case 'turn/started':
    case 'turn/completed': {
      const turn = asObject(payload.turn)
      const turnId = stringField(turn.id) || event.turnId
      if (!turnId) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      const turnStatus =
        stringField(turn.status) || (event.method === 'turn/completed' ? 'completed' : 'inProgress')

      return {
        ...detail,
        updatedAt: event.ts,
        turns: upsertTurn(detail.turns, turnId, (current) => ({
          id: turnId,
          status: turnStatus || current?.status || 'inProgress',
          items: readTurnItems(turn.items, current?.items ?? []),
          error: hasOwn(turn, 'error') ? turn.error ?? undefined : current?.error,
        })),
      }
    }
    case 'item/started':
    case 'item/completed': {
      const item = asObject(payload.item)
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(item.id)
      if (!turnId || !itemId) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      return updateTurnItem(detail, turnId, itemId, (current) => {
        const merged = mergeThreadItem(current, item)
        if (event.method === 'item/completed' && merged.type === 'agentMessage') {
          delete merged.phase
        }
        return merged
      }, event.ts)
    }
    case 'item/agentMessage/delta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      return updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'agentMessage',
        text: `${stringField(current?.text)}${delta}`,
        phase: 'streaming',
      }), event.ts)
    }
    case 'item/plan/delta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      return updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'plan',
        text: `${stringField(current?.text)}${delta}`,
      }), event.ts)
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      return updateTurnItem(detail, turnId, itemId, (current) => {
        const summary = stringList(current?.summary)
        const content = stringList(current?.content)

        if (event.method === 'item/reasoning/summaryTextDelta') {
          const nextSummary = appendAtIndex(summary, numberField(payload.summaryIndex), delta)
          return {
            ...current,
            id: itemId,
            type: 'reasoning',
            summary: nextSummary,
            content,
          }
        }

        const nextContent = appendAtIndex(content, numberField(payload.contentIndex), delta)
        return {
          ...current,
          id: itemId,
          type: 'reasoning',
          summary,
          content: nextContent,
        }
      }, event.ts)
    }
    case 'item/commandExecution/outputDelta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        return withDetailUpdatedAt(detail, event.ts)
      }

      return updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'commandExecution',
        status: stringField(current?.status) || 'inProgress',
        aggregatedOutput: `${stringField(current?.aggregatedOutput)}${delta}`,
      }), event.ts)
    }
    default:
      return detail
  }
}

export function upsertPendingUserMessage(
  turns: ThreadTurn[],
  pendingTurn: { input: string; localId: string; turnId?: string },
) {
  if (!pendingTurn.turnId) {
    return turns
  }

  const turnIndex = turns.findIndex((turn) => turn.id === pendingTurn.turnId)
  if (turnIndex < 0) {
    return turns
  }

  const turn = turns[turnIndex]
  const hasUserMessage = turn.items.some((item) => item.type === 'userMessage')
  if (hasUserMessage) {
    return turns
  }

  const nextTurns = [...turns]
  nextTurns[turnIndex] = {
    ...turn,
    items: [buildPendingUserMessageItem(pendingTurn.localId, pendingTurn.input), ...turn.items],
  }
  return nextTurns
}

function buildPendingUserMessageItem(localId: string, input: string) {
  return {
    content: [
      {
        text: input,
        type: 'inputText',
      },
    ],
    id: `pending-user-${localId}`,
    type: 'userMessage',
  }
}

function withDetailUpdatedAt(detail: ThreadDetail, updatedAt: string) {
  if (!updatedAt || detail.updatedAt === updatedAt) {
    return detail
  }

  return {
    ...detail,
    updatedAt,
  }
}

function updateTurnItem(
  detail: ThreadDetail,
  turnId: string,
  itemId: string,
  buildItem: (current?: Record<string, unknown>) => Record<string, unknown>,
  updatedAt: string,
) {
  return {
    ...detail,
    updatedAt,
    turns: upsertTurn(detail.turns, turnId, (turn) => ({
      id: turnId,
      status: turn?.status || 'inProgress',
      items: upsertItem(turn?.items ?? [], itemId, buildItem),
      error: turn?.error,
    })),
  }
}

function upsertTurn(
  turns: ThreadTurn[],
  turnId: string,
  buildTurn: (current?: ThreadTurn) => ThreadTurn,
) {
  const index = turns.findIndex((turn) => turn.id === turnId)
  if (index < 0) {
    return [...turns, buildTurn()]
  }

  const nextTurns = [...turns]
  nextTurns[index] = buildTurn(turns[index])
  return nextTurns
}

function upsertItem(
  items: Record<string, unknown>[],
  itemId: string,
  buildItem: (current?: Record<string, unknown>) => Record<string, unknown>,
) {
  const index = items.findIndex((item) => stringField(item.id) === itemId)
  if (index < 0) {
    return [...items, buildItem()]
  }

  const nextItems = [...items]
  nextItems[index] = buildItem(items[index])
  return nextItems
}

function mergeThreadItem(
  current: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
) {
  if (!current) {
    return incoming
  }

  const merged: Record<string, unknown> = {
    ...current,
    ...incoming,
  }

  if (incoming.type === 'agentMessage' && !stringField(incoming.text) && stringField(current.text)) {
    merged.text = current.text
  }

  if (incoming.type === 'plan' && !stringField(incoming.text) && stringField(current.text)) {
    merged.text = current.text
  }

  if (
    incoming.type === 'commandExecution' &&
    !stringField(incoming.aggregatedOutput) &&
    stringField(current.aggregatedOutput)
  ) {
    merged.aggregatedOutput = current.aggregatedOutput
  }

  if (incoming.type === 'reasoning') {
    if (!stringList(incoming.summary).length && stringList(current.summary).length) {
      merged.summary = current.summary
    }
    if (!stringList(incoming.content).length && stringList(current.content).length) {
      merged.content = current.content
    }
  }

  return merged
}

function readTurnItems(value: unknown, fallback: Record<string, unknown>[]) {
  if (!Array.isArray(value) || value.length === 0) {
    return fallback
  }

  return value.filter(
    (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
  )
}

function appendAtIndex(items: string[], index: number | undefined, delta: string) {
  const targetIndex = typeof index === 'number' && index >= 0 ? index : 0
  const nextItems = [...items]

  while (nextItems.length <= targetIndex) {
    nextItems.push('')
  }

  nextItems[targetIndex] = `${nextItems[targetIndex]}${delta}`
  return nextItems
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function parseTimestamp(value: string | undefined) {
  if (!value) {
    return null
  }

  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function isServerRequestMethod(method: string) {
  return [
    'item/commandExecution/requestApproval',
    'execCommandApproval',
    'item/fileChange/requestApproval',
    'applyPatchApproval',
    'item/tool/requestUserInput',
    'item/permissions/requestApproval',
    'mcpServer/elicitation/request',
    'item/tool/call',
    'account/chatgptAuthTokens/refresh',
  ].includes(method)
}

function requestItemId(requestId: string) {
  return `server-request-${requestId}`
}
