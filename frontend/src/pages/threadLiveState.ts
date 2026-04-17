import type { HookOutputEntry, ServerEvent, ThreadDetail, ThreadTurn } from '../types/api'
import {
  frontendDebugLog,
  summarizeServerEventForDebug,
  summarizeThreadDetailForDebug,
} from '../lib/frontend-runtime-mode'
import { recordConversationLiveDiagnosticEvent } from '../components/workspace/threadConversationProfiler'
import { formatHookRunFeedbackEntries, formatHookRunMessage } from '../lib/hook-run-display'
import {
  buildTurnPlanItem,
  normalizeTurnPlanStatus,
  readTurnPlanItem,
  turnPlanItemId,
} from '../lib/turn-plan'
import { readThreadTokenUsageFromEvent } from '../lib/thread-token-usage'
import type { ResolveLiveThreadDetailInput } from './threadLiveStateTypes'
export type { ResolveLiveThreadDetailInput } from './threadLiveStateTypes'

const THREAD_GOVERNANCE_TURN_ID = 'thread-governance'

export function resolveLiveThreadDetail({
  currentLiveDetail,
  events,
  threadDetail,
}: ResolveLiveThreadDetailInput) {
  const baseDetail = selectLiveThreadDetailBase(currentLiveDetail, threadDetail)
  return applyLiveThreadEvents(baseDetail, events)
}

export function applyLiveThreadEvents(
  detail: ThreadDetail | undefined,
  events: ServerEvent[],
): ThreadDetail | undefined {
  if (!detail) {
    return detail
  }

  const baselineMs = parseTimestamp(detail.updatedAt)
  let baselineSeq = readLiveThreadEventSeq(detail)
  if (baselineMs === null && baselineSeq === null) {
    frontendDebugLog('thread-live', 'applying live events without baseline filter', {
      detail: summarizeThreadDetailForDebug(detail),
      eventCount: events.length,
    })
    return applyThreadEventsToDetail(detail, events)
  }

  let nextDetail: ThreadDetail | undefined = detail
  const replayState = createFilteredEventReplayState()
  const acceptedEvents: ServerEvent[] = []
  const recoveredEvents: ServerEvent[] = []
  const filteredEvents: ServerEvent[] = []
  for (const event of events) {
    const eventSeq = readServerEventSeq(event)
    if (baselineSeq !== null && eventSeq !== null) {
      if (eventSeq > baselineSeq) {
        acceptedEvents.push(event)
        nextDetail = applyThreadEventToDetail(nextDetail, event)
        baselineSeq = readLiveThreadEventSeq(nextDetail)
        continue
      }

      filteredEvents.push(event)
      const filteredTarget = summarizeLiveDiagnosticTarget(event)
      recordConversationLiveDiagnosticEvent({
        itemId: filteredTarget.itemId,
        itemType: filteredTarget.itemType,
        kind: 'baseline-filtered',
        metadata: {
          baselineEventSeq: baselineSeq,
          baselineUpdatedAt: detail.updatedAt,
          eventSeq,
          eventTs: event.ts,
        },
        method: event.method,
        reason: 'filtered: event seq already applied',
        serverRequestId: event.serverRequestId ?? null,
        source: 'thread-live',
        threadId: detail.id,
        turnId: filteredTarget.turnId ?? event.turnId ?? null,
      })
      continue
    }

    const eventMs = parseTimestamp(event.ts)
    if (baselineMs === null || eventMs === null || eventMs > baselineMs) {
      acceptedEvents.push(event)
      nextDetail = applyThreadEventToDetail(nextDetail, event)
      baselineSeq = readLiveThreadEventSeq(nextDetail)
      continue
    }

    const replayDecision =
      nextDetail ?
        shouldReplayFilteredBaselineEvent(
          nextDetail,
          event,
          replayState,
        )
      : null

    if (nextDetail && replayDecision) {
      recoveredEvents.push(event)
      recordConversationLiveDiagnosticEvent({
        itemId: replayDecision.itemId ?? null,
        itemType: replayDecision.itemType ?? null,
        kind: 'baseline-replayed',
        metadata: {
          baselineEventSeq: baselineSeq,
          baselineUpdatedAt: detail.updatedAt,
          eventSeq,
          eventTs: event.ts,
          ...(replayDecision.metadata ?? {}),
        },
        method: event.method,
        reason: replayDecision.reason,
        serverRequestId: event.serverRequestId ?? null,
        source: 'thread-live',
        threadId: detail.id,
        turnId: replayDecision.turnId ?? event.turnId ?? null,
      })
      nextDetail = applyThreadEventToDetailPreservingUpdatedAt(nextDetail, event)
      continue
    }

    filteredEvents.push(event)
    const filteredTarget = summarizeLiveDiagnosticTarget(event)
    recordConversationLiveDiagnosticEvent({
      itemId: filteredTarget.itemId,
      itemType: filteredTarget.itemType,
      kind: 'baseline-filtered',
      metadata: {
        baselineEventSeq: baselineSeq,
        baselineUpdatedAt: detail.updatedAt,
        eventSeq,
        eventTs: event.ts,
      },
      method: event.method,
      reason: 'filtered: stale event already represented',
      serverRequestId: event.serverRequestId ?? null,
      source: 'thread-live',
      threadId: detail.id,
      turnId: filteredTarget.turnId ?? event.turnId ?? null,
    })
  }

  if (filteredEvents.length > 0) {
    frontendDebugLog('thread-live', 'baseline filtered live events', {
      baselineEventSeq: baselineSeq,
      baselineUpdatedAt: detail.updatedAt,
      baselineUpdatedAtMs: baselineMs,
      filteredCount: filteredEvents.length,
      filteredEvents: filteredEvents
        .slice(-16)
        .map(summarizeFilteredLiveEventForDebug),
      threadId: detail.id,
    })
  }

  frontendDebugLog('thread-live', 'applying baseline-accepted live events', {
    acceptedCount: acceptedEvents.length,
    baselineEventSeq: readLiveThreadEventSeq(detail),
    baselineUpdatedAt: detail.updatedAt,
    detail: summarizeThreadDetailForDebug(detail),
    recoveredCount: recoveredEvents.length,
    threadId: detail.id,
  })

  return nextDetail
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

  let nextDetail: ThreadDetail | undefined = detail

  switch (event.method) {
    case 'thread/tokenUsage/updated': {
      const parsed = readThreadTokenUsageFromEvent(event)
      if (!parsed || parsed.threadId !== detail.id) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = {
        ...detail,
        tokenUsage: parsed.usage,
        updatedAt: event.ts,
      }
      break
    }
    case 'thread/status/changed': {
      const status = stringField(asObject(payload.status).type)
      if (!status || status === detail.status) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = {
        ...detail,
        status,
        updatedAt: event.ts,
      }
      break
    }
    case 'turn/started':
    case 'turn/completed': {
      const turn = asObject(payload.turn)
      const turnId = stringField(turn.id) || event.turnId
      if (!turnId) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      const turnStatus =
        stringField(turn.status) || (event.method === 'turn/completed' ? 'completed' : 'inProgress')
      const incomingItems = readTurnItems(turn.items, [])

      nextDetail = {
        ...detail,
        updatedAt: event.ts,
        turns: upsertTurn(detail.turns, turnId, (current) => ({
          id: turnId,
          status: turnStatus || current?.status || 'inProgress',
          items: reconcileTurnPlanItemsForTerminalTurnStatus(
            incomingItems.length
              ? mergeLiveTurnItemsPreservingCurrentOrder(current?.items ?? [], incomingItems)
              : current?.items ?? [],
            turnStatus,
          ),
          error: hasOwn(turn, 'error') ? turn.error ?? undefined : current?.error,
        })),
      }
      break
    }
    case 'item/started':
    case 'item/completed': {
      const item = asObject(payload.item)
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(item.id)
      if (!turnId || !itemId) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(detail, turnId, itemId, (current) => {
        const merged = mergeThreadItem(current, item)
        const previousText = stringField(current?.text)
        const nextText = stringField(merged.text)
        if (
          merged.type === 'commandExecution' &&
          !stringField(merged.status)
        ) {
          merged.status = event.method === 'item/completed' ? 'completed' : 'inProgress'
        }
        if (merged.type === 'contextCompaction') {
          merged.status = event.method === 'item/completed' ? 'completed' : 'inProgress'
        }
        if (merged.type === 'fileChange') {
          merged.status = event.method === 'item/completed' ? 'completed' : 'inProgress'
        }
        if (
          event.method === 'item/started' &&
          merged.type === 'agentMessage' &&
          !stringField(merged.phase)
        ) {
          merged.phase = 'streaming'
          delete merged.clientRenderMode
        }
        if (event.method === 'item/completed' && merged.type === 'agentMessage') {
          delete merged.phase
          if (!previousText && nextText) {
            merged.clientRenderMode = 'animate-once'
          } else {
            delete merged.clientRenderMode
          }
        }
        return merged
      }, event.ts)
      break
    }
    case 'item/agentMessage/delta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'agentMessage',
        text: `${stringField(current?.text)}${delta}`,
        phase: 'streaming',
        clientRenderMode: undefined,
      }), event.ts)
      break
    }
    case 'item/plan/delta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'plan',
        text: `${stringField(current?.text)}${delta}`,
      }), event.ts)
      break
    }
    case 'turn/plan/updated': {
      const turnId = stringField(payload.turnId) || event.turnId
      if (!turnId) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(
        detail,
        turnId,
        turnPlanItemId(turnId),
        (current) => mergeThreadItem(current, buildTurnPlanItem(turnId, payload)),
        event.ts,
      )
      break
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(detail, turnId, itemId, (current) => {
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
      break
    }
    case 'item/commandExecution/outputDelta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'commandExecution',
        status: stringField(current?.status) || 'inProgress',
        aggregatedOutput: `${stringField(current?.aggregatedOutput)}${delta}`,
        clientLiveOutputHydrated: true,
      }), event.ts)
      break
    }
    case 'item/fileChange/outputDelta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      const delta = stringField(payload.delta)
      if (!turnId || !itemId || !delta) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(detail, turnId, itemId, (current) => ({
        ...current,
        id: itemId,
        type: 'fileChange',
        status: stringField(current?.status) || 'inProgress',
        text: `${stringField(current?.text)}${delta}`,
        clientLiveDiffHydrated: true,
      }), event.ts)
      break
    }
    case 'hook/started':
    case 'hook/completed': {
      const run = asObject(payload.run)
      const turnId = hookRunTurnId(run, event)
      const runId = stringField(run.id)
      if (!turnId || !runId) {
        nextDetail = withDetailUpdatedAt(detail, event.ts)
        break
      }

      nextDetail = updateTurnItem(
        detail,
        turnId,
        hookRunItemId(runId),
        (current) => mergeThreadItem(current, hookRunTimelineItem(run)),
        event.ts,
      )
      break
    }
    default:
      nextDetail = detail
      break
  }

  if (nextDetail !== detail && isLiveThreadDebugMethod(event.method)) {
    frontendDebugLog('thread-live', 'applied live thread event', {
      after: summarizeThreadDetailForDebug(nextDetail),
      before: summarizeThreadDetailForDebug(detail),
      event: summarizeServerEventForDebug(event),
    })
  }

  return withLiveThreadEventSeq(
    preserveThreadDetailUpdatedAt(detail, nextDetail),
    event.seq,
  )
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

function applyThreadEventToDetailPreservingUpdatedAt(
  detail: ThreadDetail,
  event: ServerEvent,
) {
  const nextDetail = applyThreadEventToDetail(detail, event)
  if (!nextDetail) {
    return nextDetail
  }

  const previousUpdatedAtMs = parseTimestamp(detail.updatedAt)
  const nextUpdatedAtMs = parseTimestamp(nextDetail.updatedAt)
  if (
    previousUpdatedAtMs !== null &&
    nextUpdatedAtMs !== null &&
    nextUpdatedAtMs <= previousUpdatedAtMs &&
    nextDetail.updatedAt !== detail.updatedAt
  ) {
    return {
      ...nextDetail,
      updatedAt: detail.updatedAt,
    }
  }

  return nextDetail
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
    const nextTurn = buildTurn()
    if (isSyntheticGovernanceTurnId(turnId)) {
      return [nextTurn, ...turns]
    }
    return [...turns, nextTurn]
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
    return insertLiveTurnItem(items, buildItem())
  }

  const nextItems = [...items]
  nextItems[index] = buildItem(items[index])
  return nextItems
}

function insertLiveTurnItem(
  items: Record<string, unknown>[],
  item: Record<string, unknown>,
) {
  if (stringField(item.type) === 'hookRun') {
    const relatedItemId = stringField(item.itemId)
    if (relatedItemId) {
      const relatedIndex = items.findIndex((existing) => stringField(existing.id) === relatedItemId)
      if (relatedIndex >= 0) {
        return [...items.slice(0, relatedIndex + 1), item, ...items.slice(relatedIndex + 1)]
      }
    }
  }

  return [...items, item]
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
  if (
    incoming.type === 'agentMessage' &&
    stringField(current.text).length > stringField(incoming.text).length
  ) {
    merged.text = current.text
  }

  if (incoming.type === 'plan' && !stringField(incoming.text) && stringField(current.text)) {
    merged.text = current.text
  }
  if (
    incoming.type === 'plan' &&
    stringField(current.text).length > stringField(incoming.text).length
  ) {
    merged.text = current.text
  }

  if (
    incoming.type === 'commandExecution' &&
    !stringField(incoming.aggregatedOutput) &&
    stringField(current.aggregatedOutput)
  ) {
    merged.aggregatedOutput = current.aggregatedOutput
  }
  if (
    incoming.type === 'commandExecution' &&
    stringField(current.aggregatedOutput).length > stringField(incoming.aggregatedOutput).length
  ) {
    merged.aggregatedOutput = current.aggregatedOutput
  }
  if (incoming.type === 'commandExecution' && !stringField(incoming.command) && stringField(current.command)) {
    merged.command = current.command
  }
  if (incoming.type === 'commandExecution' && !stringField(incoming.status) && stringField(current.status)) {
    merged.status = current.status
  }
  if (incoming.type === 'fileChange' && !stringField(incoming.text) && stringField(current.text)) {
    merged.text = current.text
  }
  if (
    incoming.type === 'fileChange' &&
    stringField(current.text).length > stringField(incoming.text).length
  ) {
    merged.text = current.text
  }
  if (incoming.type === 'fileChange' && !stringField(incoming.status) && stringField(current.status)) {
    merged.status = current.status
  }
  if (
    incoming.type === 'fileChange' &&
    fileChangeList(current).length > fileChangeList(incoming).length
  ) {
    merged.changes = current.changes
  }

  if (incoming.type === 'reasoning') {
    if (!stringList(incoming.summary).length && stringList(current.summary).length) {
      merged.summary = current.summary
    }
    if (
      stringList(current.summary).join('\n').length >
      stringList(incoming.summary).join('\n').length
    ) {
      merged.summary = current.summary
    }
    if (!stringList(incoming.content).length && stringList(current.content).length) {
      merged.content = current.content
    }
    if (
      stringList(current.content).join('\n').length >
      stringList(incoming.content).join('\n').length
    ) {
      merged.content = current.content
    }
  }

  return merged
}

function mergeLiveTurnItemsPreservingCurrentOrder(
  base: Record<string, unknown>[],
  overlay: Record<string, unknown>[],
) {
  if (overlay.length === 0) {
    return base
  }

  const nextItems = base.map((item) => ({ ...item }))
  for (const overlayItem of overlay) {
    const overlayItemId = stringField(overlayItem.id)
    if (!overlayItemId) {
      nextItems.push({ ...overlayItem })
      continue
    }

    let itemIndex = nextItems.findIndex((item) => stringField(item.id) === overlayItemId)
    let semanticMatch = false
    if (itemIndex < 0) {
      itemIndex = findEquivalentLiveTurnItemIndex(nextItems, overlayItem)
      semanticMatch = itemIndex >= 0
    }

    if (itemIndex < 0) {
      nextItems.push({ ...overlayItem })
      continue
    }

    const mergedItem = mergeThreadItem(nextItems[itemIndex], overlayItem)
    if (semanticMatch) {
      mergedItem.id = chooseCanonicalLiveTurnItemId(
        stringField(nextItems[itemIndex].id),
        overlayItemId,
      )
    }
    nextItems[itemIndex] = mergedItem
  }

  return nextItems
}

function findEquivalentLiveTurnItemIndex(
  items: Record<string, unknown>[],
  candidate: Record<string, unknown>,
) {
  const candidateType = stringField(candidate.type)
  if (!candidateType) {
    return -1
  }

  const candidateText = liveTurnItemSemanticText(candidate)
  const matchingTypeIndices: number[] = []

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    if (stringField(item.type) !== candidateType) {
      continue
    }

    matchingTypeIndices.push(index)
    if (candidateText && liveTurnItemSemanticText(item) === candidateText) {
      return index
    }
  }

  switch (candidateType) {
    case 'userMessage':
    case 'agentMessage':
    case 'reasoning':
      return matchingTypeIndices.length === 1 ? matchingTypeIndices[0] : -1
    default:
      return -1
  }
}

function liveTurnItemSemanticText(item: Record<string, unknown>) {
  switch (stringField(item.type)) {
    case 'userMessage':
      return normalizeLiveTurnItemText(liveUserMessageContentText(item))
    case 'agentMessage':
    case 'plan':
      return normalizeLiveTurnItemText(stringField(item.text))
    case 'reasoning':
      return normalizeLiveTurnItemText(
        `${stringList(item.summary).join('\n')}\n${stringList(item.content).join('\n')}`,
      )
    default:
      return ''
  }
}

function liveUserMessageContentText(item: Record<string, unknown>) {
  if (!Array.isArray(item.content) || item.content.length === 0) {
    return ''
  }

  const lines: string[] = []
  for (const rawEntry of item.content) {
    const entry = asObject(rawEntry)
    const text = stringField(entry.text).trim()
    if (text) {
      lines.push(text)
    }
  }

  return lines.join('\n')
}

function normalizeLiveTurnItemText(value: string) {
  return value.replace(/\r\n/g, '\n').trim()
}

function chooseCanonicalLiveTurnItemId(baseId: string, overlayId: string) {
  if (!baseId) {
    return overlayId
  }
  if (!overlayId) {
    return baseId
  }

  const baseTemporary = isTemporaryLiveTurnItemId(baseId)
  const overlayTemporary = isTemporaryLiveTurnItemId(overlayId)
  switch (true) {
    case baseTemporary && !overlayTemporary:
      return overlayId
    case !baseTemporary && overlayTemporary:
      return baseId
    default:
      return baseId
  }
}

function isTemporaryLiveTurnItemId(value: string) {
  if (!value.startsWith('item-')) {
    return false
  }

  for (const char of value.slice('item-'.length)) {
    if (char < '0' || char > '9') {
      return false
    }
  }

  return value.length > 'item-'.length
}

type FilteredEventReplayState = {
  agentMessageItemKeys: Set<string>
  commandExecutionItemKeys: Set<string>
  fileChangeItemKeys: Set<string>
  planItemKeys: Set<string>
  reasoningItemKeys: Set<string>
}

type FilteredBaselineReplayDecision = {
  itemId?: string | null
  itemType?: string | null
  metadata?: Record<string, boolean | number | string | null>
  reason: string
  turnId?: string | null
}

function createFilteredEventReplayState(): FilteredEventReplayState {
  return {
    agentMessageItemKeys: new Set<string>(),
    commandExecutionItemKeys: new Set<string>(),
    fileChangeItemKeys: new Set<string>(),
    planItemKeys: new Set<string>(),
    reasoningItemKeys: new Set<string>(),
  }
}

function shouldReplayFilteredBaselineEvent(
  detail: ThreadDetail,
  event: ServerEvent,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const payload = asObject(event.payload)

  switch (event.method) {
    case 'turn/started':
    case 'turn/completed': {
      const turn = asObject(payload.turn)
      const turnId = stringField(turn.id) || event.turnId
      if (!turnId) {
        return null
      }

      const currentTurn = detail.turns.find((entry) => entry.id === turnId)
      const incomingItems = readTurnItems(turn.items, [])
      if (!currentTurn) {
        return {
          metadata: {
            currentItemCount: 0,
            incomingItemCount: incomingItems.length,
          },
          reason: 'older event replayed: missing turn',
          turnId,
        }
      }

      if (currentTurn.items.length === 0 && incomingItems.length > 0) {
        return {
          metadata: {
            currentItemCount: currentTurn.items.length,
            incomingItemCount: incomingItems.length,
          },
          reason: 'older event replayed: turn missing items',
          turnId,
        }
      }

      for (const incomingItem of incomingItems) {
        const decision = shouldReplayIncomingTurnItem(
          turnId,
          currentTurn.items,
          incomingItem,
          replayState,
        )
        if (decision) {
          return decision
        }
      }

      return null
    }
    case 'item/started':
    case 'item/completed': {
      const item = asObject(payload.item)
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(item.id)
      if (!turnId || !itemId) {
        return null
      }

      const currentItem = findTurnItem(detail, turnId, itemId)
        switch (stringField(item.type)) {
          case 'agentMessage':
            return shouldReplayAgentMessageItem(
              turnId,
              itemId,
            currentItem,
            item,
            replayState,
          )
          case 'commandExecution':
            return shouldReplayCommandExecutionItem(
              turnId,
              itemId,
              currentItem,
              item,
              replayState,
            )
          case 'fileChange':
            return shouldReplayFileChangeItem(
              turnId,
              itemId,
              currentItem,
              item,
              replayState,
            )
          case 'plan':
            return shouldReplayPlanItem(
              turnId,
              itemId,
              currentItem,
            item,
            replayState,
          )
        case 'reasoning':
          return shouldReplayReasoningItem(
            turnId,
            itemId,
            currentItem,
            item,
            replayState,
          )
        default:
          return currentItem
            ? null
            : {
                itemId,
                itemType: stringField(item.type) || null,
                reason: 'older event replayed: missing item',
                turnId,
              }
      }
    }
    case 'item/agentMessage/delta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      if (!turnId || !itemId) {
        return null
      }

      return shouldReplayAgentMessageItem(
        turnId,
        itemId,
        findTurnItem(detail, turnId, itemId),
        undefined,
        replayState,
      )
    }
      case 'item/commandExecution/outputDelta': {
        const turnId = stringField(payload.turnId) || event.turnId
        const itemId = stringField(payload.itemId)
        if (!turnId || !itemId) {
          return null
      }

      return shouldReplayCommandExecutionItem(
        turnId,
        itemId,
        findTurnItem(detail, turnId, itemId),
        undefined,
          replayState,
        )
      }
      case 'item/fileChange/outputDelta': {
        const turnId = stringField(payload.turnId) || event.turnId
        const itemId = stringField(payload.itemId)
        if (!turnId || !itemId) {
          return null
        }

        return shouldReplayFileChangeItem(
          turnId,
          itemId,
          findTurnItem(detail, turnId, itemId),
          undefined,
          replayState,
        )
      }
      case 'item/plan/delta': {
        const turnId = stringField(payload.turnId) || event.turnId
        const itemId = stringField(payload.itemId)
        if (!turnId || !itemId) {
          return null
      }

      return shouldReplayPlanItem(
        turnId,
        itemId,
        findTurnItem(detail, turnId, itemId),
        undefined,
        replayState,
      )
    }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      if (!turnId || !itemId) {
        return null
      }

      return shouldReplayReasoningItem(
        turnId,
        itemId,
        findTurnItem(detail, turnId, itemId),
        undefined,
        replayState,
      )
    }
    default:
      return null
  }
}

function shouldReplayIncomingTurnItem(
  turnId: string,
  currentItems: Record<string, unknown>[],
  incomingItem: Record<string, unknown>,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const itemId = stringField(incomingItem.id)
  if (!itemId) {
    return null
  }

  const currentItem = currentItems.find((item) => stringField(item.id) === itemId)
    switch (stringField(incomingItem.type)) {
      case 'agentMessage':
        return shouldReplayAgentMessageItem(
          turnId,
          itemId,
        currentItem,
        incomingItem,
        replayState,
      )
      case 'commandExecution':
        return shouldReplayCommandExecutionItem(
          turnId,
          itemId,
          currentItem,
          incomingItem,
          replayState,
        )
      case 'fileChange':
        return shouldReplayFileChangeItem(
          turnId,
          itemId,
          currentItem,
          incomingItem,
          replayState,
        )
      case 'plan':
        return shouldReplayPlanItem(
          turnId,
          itemId,
          currentItem,
        incomingItem,
        replayState,
      )
    case 'reasoning':
      return shouldReplayReasoningItem(
        turnId,
        itemId,
        currentItem,
        incomingItem,
        replayState,
      )
    default:
      return currentItem
        ? null
        : {
            itemId,
            itemType: stringField(incomingItem.type) || null,
            reason: 'older event replayed: missing item',
            turnId,
          }
  }
}

function shouldReplayAgentMessageItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.agentMessageItemKeys.has(itemKey)) {
    return {
      itemId,
      itemType: 'agentMessage',
      reason: 'older event replayed: continuing recovered agent item',
      turnId,
    }
  }

  const currentText = stringField(currentItem?.text)
  const incomingText = stringField(incomingItem?.text)
  let reason: string | null = null
  if (!currentItem) {
    reason = 'older event replayed: missing agent item'
  } else if (incomingText.length > currentText.length) {
    reason = 'older event replayed: longer agent text'
  } else if (!currentText && Boolean(incomingText)) {
    reason = 'older event replayed: missing agent text'
  } else if (!currentText && stringField(currentItem.phase) === 'streaming') {
    reason = 'older event replayed: streaming agent placeholder'
  }

  if (reason) {
    replayState.agentMessageItemKeys.add(itemKey)
    return {
      itemId,
      itemType: 'agentMessage',
      metadata: {
        currentLength: currentText.length,
        incomingLength: incomingText.length,
      },
      reason,
      turnId,
    }
  }

  return null
}

function shouldReplayCommandExecutionItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.commandExecutionItemKeys.has(itemKey)) {
    return {
      itemId,
      itemType: 'commandExecution',
      reason: 'older event replayed: continuing recovered command output',
      turnId,
    }
  }

  const currentOutput = stringField(currentItem?.aggregatedOutput)
  const incomingOutput = stringField(incomingItem?.aggregatedOutput)
  const currentCommand = stringField(currentItem?.command)
  const incomingCommand = stringField(incomingItem?.command)
  const currentStatus = stringField(currentItem?.status)
  const incomingStatus = stringField(incomingItem?.status)
  const currentOutputContentMode = stringField(currentItem?.outputContentMode)
  const currentOutputEndLine = numberField(currentItem?.outputEndLine)
  const currentOutputLineCount = numberField(currentItem?.outputLineCount)
  const currentOutputTotalLength = numberField(currentItem?.outputTotalLength)
  const currentSummaryTruncated = booleanField(currentItem?.summaryTruncated)
  const currentOutputTruncated = booleanField(currentItem?.outputTruncated)
  const clientLiveOutputHydrated = booleanField(currentItem?.clientLiveOutputHydrated)
  let reason: string | null = null
  if (!currentItem) {
    reason = 'older event replayed: missing command execution item'
  } else if (isCommandExecutionRenderEmpty(currentItem) && incomingItem) {
    reason = 'older event replayed: empty command execution placeholder'
  } else if (incomingItem === undefined && !currentOutput) {
    reason = 'older event replayed: missing command output delta target'
  } else if (
    incomingItem === undefined &&
    !clientLiveOutputHydrated &&
    (
      currentSummaryTruncated ||
      currentOutputTruncated ||
      currentOutputContentMode === 'summary' ||
      currentOutputContentMode === 'tail' ||
      (
        typeof currentOutputTotalLength === 'number' &&
        currentOutputTotalLength > currentOutput.length
      ) ||
      (
        typeof currentOutputEndLine === 'number' &&
        typeof currentOutputLineCount === 'number' &&
        currentOutputEndLine < currentOutputLineCount
      )
    )
  ) {
    reason = 'older event replayed: incomplete command output window'
  } else if (incomingOutput.length > currentOutput.length) {
    reason = 'older event replayed: longer command output'
  } else if (!currentOutput && Boolean(incomingOutput)) {
    reason = 'older event replayed: missing command output'
  } else if (!currentCommand && Boolean(incomingCommand)) {
    reason = 'older event replayed: missing command metadata'
  } else if (!currentStatus && Boolean(incomingStatus)) {
    reason = 'older event replayed: missing command status'
  }

  if (reason) {
    replayState.commandExecutionItemKeys.add(itemKey)
    return {
      itemId,
      itemType: 'commandExecution',
      metadata: {
        currentLength: currentOutput.length,
        incomingLength: incomingOutput.length,
      },
      reason,
      turnId,
    }
  }

  return null
}

function shouldReplayFileChangeItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.fileChangeItemKeys.has(itemKey)) {
    return {
      itemId,
      itemType: 'fileChange',
      reason: 'older event replayed: continuing recovered file change item',
      turnId,
    }
  }

  const currentChanges = fileChangeList(currentItem)
  const incomingChanges = fileChangeList(incomingItem)
  const currentText = stringField(currentItem?.text)
  const incomingText = stringField(incomingItem?.text)
  const currentStatus = stringField(currentItem?.status)
  const incomingStatus = stringField(incomingItem?.status)
  const clientLiveDiffHydrated = booleanField(currentItem?.clientLiveDiffHydrated)
  let reason: string | null = null
  if (!currentItem) {
    reason = 'older event replayed: missing file change item'
  } else if (!currentChanges.length && incomingChanges.length > 0) {
    reason = 'older event replayed: missing file changes'
  } else if (incomingText.length > currentText.length) {
    reason = 'older event replayed: longer file change preview'
  } else if (incomingItem === undefined && !currentText && !clientLiveDiffHydrated) {
    reason = 'older event replayed: missing file change delta target'
  } else if (!currentText && Boolean(incomingText)) {
    reason = 'older event replayed: missing file change preview'
  } else if (!currentStatus && Boolean(incomingStatus)) {
    reason = 'older event replayed: missing file change status'
  }

  if (reason) {
    replayState.fileChangeItemKeys.add(itemKey)
    return {
      itemId,
      itemType: 'fileChange',
      metadata: {
        currentLength: currentText.length + currentChanges.length,
        incomingLength: incomingText.length + incomingChanges.length,
      },
      reason,
      turnId,
    }
  }

  return null
}

function shouldReplayPlanItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.planItemKeys.has(itemKey)) {
    return {
      itemId,
      itemType: 'plan',
      reason: 'older event replayed: continuing recovered plan item',
      turnId,
    }
  }

  const currentText = stringField(currentItem?.text)
  const incomingText = stringField(incomingItem?.text)
  let reason: string | null = null
  if (!currentItem) {
    reason = 'older event replayed: missing plan item'
  } else if (incomingText.length > currentText.length) {
    reason = 'older event replayed: longer plan text'
  } else if (!currentText && Boolean(incomingText)) {
    reason = 'older event replayed: missing plan text'
  }

  if (reason) {
    replayState.planItemKeys.add(itemKey)
    return {
      itemId,
      itemType: 'plan',
      metadata: {
        currentLength: currentText.length,
        incomingLength: incomingText.length,
      },
      reason,
      turnId,
    }
  }

  return null
}

function shouldReplayReasoningItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
): FilteredBaselineReplayDecision | null {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.reasoningItemKeys.has(itemKey)) {
    return {
      itemId,
      itemType: 'reasoning',
      reason: 'older event replayed: continuing recovered reasoning item',
      turnId,
    }
  }

  const currentSummary = stringList(currentItem?.summary)
  const currentContent = stringList(currentItem?.content)
  const incomingSummary = stringList(incomingItem?.summary)
  const incomingContent = stringList(incomingItem?.content)
  const currentSummaryTextLength = currentSummary.join('\n').length
  const currentContentTextLength = currentContent.join('\n').length
  const incomingSummaryTextLength = incomingSummary.join('\n').length
  const incomingContentTextLength = incomingContent.join('\n').length
  let reason: string | null = null
  if (!currentItem) {
    reason = 'older event replayed: missing reasoning item'
  } else if (incomingSummaryTextLength > currentSummaryTextLength) {
    reason = 'older event replayed: longer reasoning summary'
  } else if (incomingContentTextLength > currentContentTextLength) {
    reason = 'older event replayed: longer reasoning content'
  } else if (!currentSummary.length && incomingSummary.length > 0) {
    reason = 'older event replayed: missing reasoning summary'
  } else if (!currentContent.length && incomingContent.length > 0) {
    reason = 'older event replayed: missing reasoning content'
  }

  if (reason) {
    replayState.reasoningItemKeys.add(itemKey)
    return {
      itemId,
      itemType: 'reasoning',
      metadata: {
        currentLength: currentSummaryTextLength + currentContentTextLength,
        incomingLength: incomingSummaryTextLength + incomingContentTextLength,
      },
      reason,
      turnId,
    }
  }

  return null
}

function findTurnItem(
  detail: ThreadDetail,
  turnId: string,
  itemId: string,
) {
  const turn = detail.turns.find((entry) => entry.id === turnId)
  return turn?.items.find((item) => stringField(item.id) === itemId)
}

function buildLiveItemLookupKey(turnId: string, itemId: string) {
  return `${turnId}:${itemId}`
}

function summarizeLiveDiagnosticTarget(event: ServerEvent) {
  const payload = asObject(event.payload)
  switch (event.method) {
    case 'item/started':
    case 'item/completed': {
      const item = asObject(payload.item)
      return {
        itemId: stringField(item.id) || null,
        itemType: stringField(item.type) || null,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    }
    case 'item/agentMessage/delta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'agentMessage',
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/commandExecution/outputDelta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'commandExecution',
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/fileChange/outputDelta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'fileChange',
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/plan/delta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'plan',
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'reasoning',
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    default:
      return {
        itemId: null,
        itemType: null,
        turnId: event.turnId ?? null,
      }
  }
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

function fileChangeList(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return []
  }

  const changes = (value as Record<string, unknown>).changes
  return Array.isArray(changes)
    ? changes.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    : []
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanField(value: unknown) {
  return value === true
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

function preserveThreadDetailUpdatedAt(
  previousDetail: ThreadDetail | undefined,
  nextDetail: ThreadDetail | undefined,
) {
  if (!previousDetail || !nextDetail || previousDetail === nextDetail) {
    return nextDetail
  }

  const previousUpdatedAtMs = parseTimestamp(previousDetail.updatedAt)
  const nextUpdatedAtMs = parseTimestamp(nextDetail.updatedAt)
  if (
    previousUpdatedAtMs !== null &&
    nextUpdatedAtMs !== null &&
    nextUpdatedAtMs < previousUpdatedAtMs &&
    nextDetail.updatedAt !== previousDetail.updatedAt
  ) {
    return {
      ...nextDetail,
      updatedAt: previousDetail.updatedAt,
    }
  }

  return nextDetail
}

function readServerEventSeq(event: ServerEvent) {
  return typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : null
}

function readLiveThreadEventSeq(detail: ThreadDetail | undefined) {
  if (!detail) {
    return null
  }

  return typeof detail.clientLiveEventSeq === 'number' && Number.isFinite(detail.clientLiveEventSeq)
    ? detail.clientLiveEventSeq
    : null
}

function withLiveThreadEventSeq(
  detail: ThreadDetail | undefined,
  eventSeq: number | null | undefined,
) {
  if (!detail || typeof eventSeq !== 'number' || !Number.isFinite(eventSeq)) {
    return detail
  }

  const currentSeq = readLiveThreadEventSeq(detail)
  if (currentSeq !== null && currentSeq >= eventSeq) {
    return detail
  }

  return {
    ...detail,
    clientLiveEventSeq: eventSeq,
  }
}

function preserveLiveThreadEventSeq(
  detail: ThreadDetail,
  currentLiveDetail: ThreadDetail | undefined,
) {
  const currentSeq = readLiveThreadEventSeq(currentLiveDetail)
  return currentSeq === null ? detail : withLiveThreadEventSeq(detail, currentSeq)
}

function selectLiveThreadDetailBase(
  currentLiveDetail: ThreadDetail | undefined,
  threadDetail: ThreadDetail | undefined,
) {
  if (!currentLiveDetail) {
    return threadDetail
  }

  if (!threadDetail) {
    return currentLiveDetail
  }

  if (currentLiveDetail.id !== threadDetail.id) {
    return threadDetail
  }

  const currentMs = parseTimestamp(currentLiveDetail.updatedAt)
  const snapshotMs = parseTimestamp(threadDetail.updatedAt)
  if (currentMs === null) {
    return preserveLiveThreadEventSeq(threadDetail, currentLiveDetail)
  }

  if (snapshotMs === null) {
    return preserveLiveThreadEventSeq(currentLiveDetail, threadDetail)
  }

  return snapshotMs >= currentMs
    ? preserveLiveThreadEventSeq(
        reconcileStreamingSnapshotWithCurrentLiveDetail(
          threadDetail,
          currentLiveDetail,
        ),
        currentLiveDetail,
      )
    : preserveLiveThreadEventSeq(currentLiveDetail, threadDetail)
}

function reconcileStreamingSnapshotWithCurrentLiveDetail(
  threadDetail: ThreadDetail,
  currentLiveDetail: ThreadDetail,
) {
  let detailChanged = false
  let lastMatchedCurrentTurnIndex = -1

  const turns = threadDetail.turns.map((snapshotTurn) => {
    const currentTurnIndex = currentLiveDetail.turns.findIndex((turn) => turn.id === snapshotTurn.id)
    const currentTurn =
      currentTurnIndex >= 0 ? currentLiveDetail.turns[currentTurnIndex] : undefined
    if (!currentTurn) {
      return snapshotTurn
    }
    if (currentTurnIndex > lastMatchedCurrentTurnIndex) {
      lastMatchedCurrentTurnIndex = currentTurnIndex
    }

    let turnChanged = false
    let lastMatchedCurrentItemIndex = -1
    const items = snapshotTurn.items.map((snapshotItem) => {
      const snapshotItemId = stringField(snapshotItem.id)
      if (!snapshotItemId) {
        return snapshotItem
      }

      const currentItem = currentTurn.items.find(
        (item) => stringField(item.id) === snapshotItemId,
      )
      if (!currentItem) {
        const currentItemIndex = currentTurn.items.findIndex(
          (item) => stringField(item.id) === snapshotItemId,
        )
        if (currentItemIndex > lastMatchedCurrentItemIndex) {
          lastMatchedCurrentItemIndex = currentItemIndex
        }
        return snapshotItem
      }

      const currentItemIndex = currentTurn.items.findIndex(
        (item) => stringField(item.id) === snapshotItemId,
      )
      if (currentItemIndex > lastMatchedCurrentItemIndex) {
        lastMatchedCurrentItemIndex = currentItemIndex
      }

      const reconcileState = buildSnapshotPreservationState(
        snapshotTurn.status,
        currentItem,
        snapshotItem,
      )
      if (!reconcileState.shouldPreserve) {
        return snapshotItem
      }

      turnChanged = true
      recordConversationLiveDiagnosticEvent({
        itemId: snapshotItemId,
        itemType: stringField(snapshotItem.type) || null,
        kind: 'snapshot-reconciled',
        metadata: {
          currentLength: reconcileState.currentLength,
          currentUpdatedAt: currentLiveDetail.updatedAt,
          incomingLength: reconcileState.snapshotLength,
          preserveClientRenderMode: reconcileState.preserveClientRenderMode,
          preserveLongerCurrentText: reconcileState.preserveLongerCurrentText,
          preserveStreamingPhase: reconcileState.preserveStreamingPhase,
          snapshotUpdatedAt: threadDetail.updatedAt,
        },
        reason: summarizeSnapshotReconcileReason(reconcileState),
        source: 'thread-live',
        threadId: threadDetail.id,
        turnId: snapshotTurn.id,
      })
      frontendDebugLog('thread-live', 'reconciled snapshot agent item with live state', {
        currentItem: summarizeLiveItemForDebug(currentItem),
        reason: reconcileState,
        snapshotItem: summarizeLiveItemForDebug(snapshotItem),
        threadId: threadDetail.id,
        turnId: snapshotTurn.id,
      })
      const reconciledItem = mergeThreadItem(currentItem, snapshotItem)
      if (reconcileState.preserveStreamingPhase) {
        reconciledItem.phase = 'streaming'
      }
      if (reconcileState.preserveClientRenderMode) {
        reconciledItem.clientRenderMode = 'animate-once'
      }

      return reconciledItem
    })

    const trailingLiveItems = currentTurn.items.filter((currentItem, currentItemIndex) => {
      if (currentItemIndex <= lastMatchedCurrentItemIndex) {
        return false
      }

      const currentItemId = stringField(currentItem.id)
      if (!currentItemId) {
        return false
      }

      const alreadyPresent = snapshotTurn.items.some(
        (snapshotItem) => stringField(snapshotItem.id) === currentItemId,
      )
      if (alreadyPresent) {
        return false
      }

      return shouldPreserveMissingTrailingLiveItem(currentItem)
    })

    if (trailingLiveItems.length > 0) {
      turnChanged = true
      for (const trailingItem of trailingLiveItems) {
        recordConversationLiveDiagnosticEvent({
          itemId: stringField(trailingItem.id) || null,
          itemType: stringField(trailingItem.type) || null,
          kind: 'snapshot-trailing-item-preserved',
          metadata: {
            currentLength: stringField(trailingItem.text).length,
            currentUpdatedAt: currentLiveDetail.updatedAt,
            snapshotUpdatedAt: threadDetail.updatedAt,
          },
          reason: 'preserved trailing live item missing from snapshot',
          source: 'thread-live',
          threadId: threadDetail.id,
          turnId: snapshotTurn.id,
        })
      }
      frontendDebugLog('thread-live', 'preserved trailing live items missing from snapshot', {
        items: trailingLiveItems.map(summarizeLiveItemForDebug),
        snapshotTurnId: snapshotTurn.id,
        threadId: threadDetail.id,
      })
      items.push(...trailingLiveItems)
    }

    if (!turnChanged) {
      return snapshotTurn
    }

    detailChanged = true
    return {
      ...snapshotTurn,
      items,
    }
  })

  const trailingLiveTurns = currentLiveDetail.turns.filter((currentTurn, currentTurnIndex) => {
    if (currentTurnIndex <= lastMatchedCurrentTurnIndex) {
      return false
    }

    const currentTurnId = stringField(currentTurn.id)
    if (!currentTurnId) {
      return false
    }

    const alreadyPresent = threadDetail.turns.some((snapshotTurn) => snapshotTurn.id === currentTurnId)
    if (alreadyPresent) {
      return false
    }

    return shouldPreserveMissingTrailingLiveTurn(currentTurn)
  })

  if (trailingLiveTurns.length > 0) {
    detailChanged = true
    for (const trailingTurn of trailingLiveTurns) {
      for (const trailingItem of trailingTurn.items.filter(shouldPreserveMissingTrailingLiveItem)) {
        recordConversationLiveDiagnosticEvent({
          itemId: stringField(trailingItem.id) || null,
          itemType: stringField(trailingItem.type) || null,
          kind: 'snapshot-trailing-item-preserved',
          metadata: {
            currentLength: preservedLiveItemLength(trailingItem),
            currentUpdatedAt: currentLiveDetail.updatedAt,
            snapshotUpdatedAt: threadDetail.updatedAt,
          },
          reason: 'preserved trailing live turn missing from snapshot',
          source: 'thread-live',
          threadId: threadDetail.id,
          turnId: trailingTurn.id,
        })
      }
    }
    frontendDebugLog('thread-live', 'preserved trailing live turns missing from snapshot', {
      threadId: threadDetail.id,
      turns: trailingLiveTurns.map((turn) => ({
        id: turn.id,
        itemCount: turn.items.length,
        items: turn.items.map(summarizeLiveItemForDebug),
      })),
    })
  }

  if (!detailChanged) {
    return threadDetail
  }

  return {
    ...threadDetail,
    turns: [...turns, ...trailingLiveTurns],
  }
}

function shouldPreserveMissingTrailingLiveItem(item: Record<string, unknown>) {
  switch (stringField(item.type)) {
    case 'agentMessage':
      return (
        stringField(item.text).length > 0 ||
        stringsEqualFold(stringField(item.phase), 'streaming') ||
        stringField(item.clientRenderMode) === 'animate-once'
      )
    case 'commandExecution':
      return !isCommandExecutionRenderEmpty(item)
    case 'contextCompaction':
      return Boolean(stringField(item.status) || stringField(item.text) || stringField(item.message))
    case 'fileChange':
      return (
        fileChangeList(item).length > 0 ||
        Boolean(stringField(item.status) || stringField(item.text) || stringField(item.message))
      )
    case 'plan':
      return stringField(item.text).length > 0
    case 'reasoning':
      return stringList(item.summary).length > 0 || stringList(item.content).length > 0
    default:
      return false
  }
}

function shouldPreserveMissingTrailingLiveTurn(turn: ThreadTurn) {
  return (
    turn.items.some(shouldPreserveMissingTrailingLiveItem) ||
    Boolean(turn.error) ||
    turnStatusLooksInterruptible(turn.status)
  )
}

function preservedLiveItemLength(item: Record<string, unknown>) {
  switch (stringField(item.type)) {
    case 'commandExecution':
      return Math.max(
        stringField(item.command).length,
        stringField(item.aggregatedOutput).length,
      )
    case 'contextCompaction':
      return Math.max(
        stringField(item.status).length,
        stringField(item.text).length,
        stringField(item.message).length,
      )
    case 'fileChange':
      return Math.max(
        fileChangeList(item).length,
        stringField(item.status).length,
        stringField(item.text).length,
        stringField(item.message).length,
      )
    case 'reasoning':
      return stringList(item.summary).join('\n').length + stringList(item.content).join('\n').length
    default:
      return stringField(item.text).length
  }
}

function reconcileTurnPlanItemsForTerminalTurnStatus(
  items: Record<string, unknown>[],
  turnStatus: string,
) {
  if (!items.length || !isTerminalTurnStatus(turnStatus)) {
    return items
  }

  let changed = false
  const nextItems = items.map((item) => {
    const turnPlan = readTurnPlanItem(item)
    if (!turnPlan) {
      return item
    }

    const normalizedPlanStatus = normalizeTurnPlanStatus(turnPlan.status)
    if (normalizedPlanStatus === '' || normalizedPlanStatus === 'inprogress' || normalizedPlanStatus === 'pending') {
      changed = true
      return {
        ...item,
        status: turnStatus,
      }
    }

    return item
  })

  return changed ? nextItems : items
}

function isTerminalTurnStatus(value: string) {
  switch (normalizeTurnPlanStatus(value)) {
    case 'completed':
    case 'interrupted':
    case 'failed':
    case 'error':
    case 'cancelled':
    case 'canceled':
    case 'stopped':
      return true
    default:
      return false
  }
}

function summarizeSnapshotReconcileReason(flags: {
  itemType: string
  preserveCommandMetadata: boolean
  preserveClientRenderMode: boolean
  preserveLongerCurrentText: boolean
  preserveReasoningContent: boolean
  preserveStreamingPhase: boolean
  preserveStatusMetadata: boolean
  currentLength: number
  shouldPreserve: boolean
  snapshotLength: number
}) {
  const parts: string[] = []
  if (flags.preserveLongerCurrentText) {
    parts.push('preserved longer current text')
  }
  if (flags.preserveCommandMetadata) {
    parts.push('preserved command metadata')
  }
  if (flags.preserveStatusMetadata) {
    parts.push('preserved status metadata')
  }
  if (flags.preserveReasoningContent) {
    parts.push('preserved reasoning content')
  }
  if (flags.preserveStreamingPhase) {
    parts.push('preserved streaming phase')
  }
  if (flags.preserveClientRenderMode) {
    parts.push('preserved animate-once mode')
  }

  return parts.join('; ') || 'snapshot reconciled with live state'
}

function buildSnapshotPreservationState(
  snapshotTurnStatus: string,
  currentItem: Record<string, unknown>,
  snapshotItem: Record<string, unknown>,
) {
  const itemType = stringField(snapshotItem.type)
  const currentText = stringField(currentItem.text)
  const snapshotText = stringField(snapshotItem.text)
  const currentSummaryLength = stringList(currentItem.summary).join('\n').length
  const snapshotSummaryLength = stringList(snapshotItem.summary).join('\n').length
  const currentContentLength = stringList(currentItem.content).join('\n').length
  const snapshotContentLength = stringList(snapshotItem.content).join('\n').length
  const currentOutputLength = stringField(currentItem.aggregatedOutput).length
  const snapshotOutputLength = stringField(snapshotItem.aggregatedOutput).length

  const preserveLongerCurrentText =
    currentText.length > snapshotText.length ||
    currentOutputLength > snapshotOutputLength
  const preserveCommandMetadata =
    itemType === 'commandExecution' &&
    !stringField(snapshotItem.command) &&
    Boolean(stringField(currentItem.command))
  const preserveStatusMetadata =
    itemType === 'commandExecution' &&
    !stringField(snapshotItem.status) &&
    Boolean(stringField(currentItem.status))
  const preserveReasoningContent =
    itemType === 'reasoning' &&
    (currentSummaryLength > snapshotSummaryLength ||
      currentContentLength > snapshotContentLength)
  const preserveStreamingPhase =
    itemType === 'agentMessage' &&
    turnStatusLooksInterruptible(snapshotTurnStatus) &&
    stringsEqualFold(stringField(currentItem.phase), 'streaming')
  const preserveClientRenderMode =
    itemType === 'agentMessage' &&
    stringField(currentItem.clientRenderMode) === 'animate-once'

  return {
    currentLength: Math.max(
      currentText.length,
      currentOutputLength,
      currentSummaryLength + currentContentLength,
    ),
    itemType,
    preserveCommandMetadata,
    preserveClientRenderMode,
    preserveLongerCurrentText,
    preserveReasoningContent,
    preserveStatusMetadata,
    preserveStreamingPhase,
    shouldPreserve:
      preserveLongerCurrentText ||
      preserveCommandMetadata ||
      preserveStatusMetadata ||
      preserveReasoningContent ||
      preserveStreamingPhase ||
      preserveClientRenderMode,
    snapshotLength: Math.max(
      snapshotText.length,
      snapshotOutputLength,
      snapshotSummaryLength + snapshotContentLength,
    ),
  }
}

function isCommandExecutionRenderEmpty(item: Record<string, unknown>) {
  return (
    !stringField(item.command) &&
    !stringField(item.aggregatedOutput) &&
    !stringField(item.status)
  )
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

function hookRunTurnId(run: Record<string, unknown>, event: ServerEvent) {
  return stringField(run.turnId) || event.turnId || THREAD_GOVERNANCE_TURN_ID
}

function isSyntheticGovernanceTurnId(turnId: string) {
  return turnId === THREAD_GOVERNANCE_TURN_ID
}

function hookRunItemId(runId: string) {
  return `hook-run-${runId}`
}

function hookRunTimelineItem(run: Record<string, unknown>) {
  return {
    id: hookRunItemId(stringField(run.id)),
    type: 'hookRun',
    hookRunId: stringField(run.id),
    itemId: stringField(run.itemId),
    eventName: stringField(run.eventName),
    handlerKey: stringField(run.handlerKey),
    triggerMethod: stringField(run.triggerMethod),
    sessionStartSource: stringField(run.sessionStartSource),
    toolKind: stringField(run.toolKind),
    toolName: stringField(run.toolName),
    status: stringField(run.status),
    decision: stringField(run.decision),
    reason: stringField(run.reason),
    source: stringField(run.source),
    completedAt: stringField(run.completedAt) || undefined,
    durationMs: numberField(run.durationMs),
    error: stringField(run.error) || undefined,
    message: hookRunMessage(run),
  }
}

function hookRunMessage(run: Record<string, unknown>) {
  const feedback = formatHookRunFeedbackEntries(
    Array.isArray(run.entries) ? (run.entries as HookOutputEntry[]) : undefined,
  )

  return formatHookRunMessage({
    eventName: stringField(run.eventName),
    handlerKey: stringField(run.handlerKey),
    triggerMethod: stringField(run.triggerMethod),
    status: stringField(run.status),
    decision: stringField(run.decision),
    toolName: stringField(run.toolName),
    toolKind: stringField(run.toolKind),
    sessionStartSource: stringField(run.sessionStartSource),
    reason: stringField(run.reason),
    feedback,
  })
}

function turnStatusLooksInterruptible(value: string | undefined) {
  const normalized = stringField(value).toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(normalized)
}

function stringsEqualFold(left: string | undefined, right: string) {
  return stringField(left).toLowerCase() === right.toLowerCase()
}

function isLiveThreadDebugMethod(method: string) {
  return [
    'turn/started',
    'turn/completed',
    'item/started',
    'item/completed',
    'item/agentMessage/delta',
    'item/plan/delta',
    'item/reasoning/summaryTextDelta',
    'item/reasoning/textDelta',
    'item/commandExecution/outputDelta',
    'turn/plan/updated',
  ].includes(method)
}

function summarizeFilteredLiveEventForDebug(event: ServerEvent) {
  const payload = asObject(event.payload)
  return {
    itemId: stringField(payload.itemId) || stringField(asObject(payload.item).id) || null,
    method: event.method,
    threadId: event.threadId ?? null,
    ts: event.ts,
    turnId: event.turnId ?? (stringField(payload.turnId) || null),
  }
}

function summarizeLiveItemForDebug(item: Record<string, unknown>) {
  return {
    clientRenderMode: stringField(item.clientRenderMode) || null,
    id: stringField(item.id) || null,
    phase: stringField(item.phase) || null,
    textPreview: previewDebugText(stringField(item.text) || stringField(item.message)),
    type: stringField(item.type) || null,
  }
}

function previewDebugText(value: string) {
  const normalized = value.trim()
  if (normalized.length <= 120) {
    return normalized
  }

  return `${normalized.slice(0, 120)} ... [truncated, ${normalized.length - 120} more chars]`
}
