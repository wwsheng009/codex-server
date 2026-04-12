import type { HookOutputEntry, ServerEvent, ThreadDetail, ThreadTurn } from '../types/api'
import {
  frontendDebugLog,
  summarizeServerEventForDebug,
  summarizeThreadDetailForDebug,
} from '../lib/frontend-runtime-mode'
import { formatHookRunFeedbackEntries, formatHookRunMessage } from '../lib/hook-run-display'
import { buildTurnPlanItem, turnPlanItemId } from '../lib/turn-plan'
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
  if (baselineMs === null) {
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
    const eventMs = parseTimestamp(event.ts)
    if (eventMs === null || eventMs > baselineMs) {
      acceptedEvents.push(event)
      nextDetail = applyThreadEventToDetail(nextDetail, event)
      continue
    }

    if (
      nextDetail &&
      shouldReplayFilteredBaselineEvent(
        nextDetail,
        event,
        replayState,
      )
    ) {
      recoveredEvents.push(event)
      nextDetail = applyThreadEventToDetailPreservingUpdatedAt(nextDetail, event)
      continue
    }

    filteredEvents.push(event)
  }

  if (filteredEvents.length > 0) {
    frontendDebugLog('thread-live', 'baseline filtered live events', {
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
          items: incomingItems.length
            ? mergeLiveTurnItemsPreservingCurrentOrder(current?.items ?? [], incomingItems)
            : current?.items ?? [],
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

  return nextDetail
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
  planItemKeys: Set<string>
  reasoningItemKeys: Set<string>
}

function createFilteredEventReplayState(): FilteredEventReplayState {
  return {
    agentMessageItemKeys: new Set<string>(),
    commandExecutionItemKeys: new Set<string>(),
    planItemKeys: new Set<string>(),
    reasoningItemKeys: new Set<string>(),
  }
}

function shouldReplayFilteredBaselineEvent(
  detail: ThreadDetail,
  event: ServerEvent,
  replayState: FilteredEventReplayState,
) {
  const payload = asObject(event.payload)

  switch (event.method) {
    case 'turn/started':
    case 'turn/completed': {
      const turn = asObject(payload.turn)
      const turnId = stringField(turn.id) || event.turnId
      if (!turnId) {
        return false
      }

      const currentTurn = detail.turns.find((entry) => entry.id === turnId)
      const incomingItems = readTurnItems(turn.items, [])
      return !currentTurn || (currentTurn.items.length === 0 && incomingItems.length > 0)
    }
    case 'item/started':
    case 'item/completed': {
      const item = asObject(payload.item)
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(item.id)
      if (!turnId || !itemId) {
        return false
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
          return !currentItem
      }
    }
    case 'item/agentMessage/delta': {
      const turnId = stringField(payload.turnId) || event.turnId
      const itemId = stringField(payload.itemId)
      if (!turnId || !itemId) {
        return false
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
        return false
      }

      return shouldReplayCommandExecutionItem(
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
        return false
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
        return false
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
      return false
  }
}

function shouldReplayAgentMessageItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
) {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.agentMessageItemKeys.has(itemKey)) {
    return true
  }

  const currentText = stringField(currentItem?.text)
  const incomingText = stringField(incomingItem?.text)
  if (!currentItem || (!currentText && Boolean(incomingText || currentItem?.phase === 'streaming'))) {
    replayState.agentMessageItemKeys.add(itemKey)
    return true
  }

  return false
}

function shouldReplayCommandExecutionItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
) {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.commandExecutionItemKeys.has(itemKey)) {
    return true
  }

  const currentOutput = stringField(currentItem?.aggregatedOutput)
  const incomingOutput = stringField(incomingItem?.aggregatedOutput)
  if (!currentItem || (!currentOutput && Boolean(incomingOutput))) {
    replayState.commandExecutionItemKeys.add(itemKey)
    return true
  }

  return false
}

function shouldReplayPlanItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
) {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.planItemKeys.has(itemKey)) {
    return true
  }

  const currentText = stringField(currentItem?.text)
  const incomingText = stringField(incomingItem?.text)
  if (!currentItem || (!currentText && Boolean(incomingText))) {
    replayState.planItemKeys.add(itemKey)
    return true
  }

  return false
}

function shouldReplayReasoningItem(
  turnId: string,
  itemId: string,
  currentItem: Record<string, unknown> | undefined,
  incomingItem: Record<string, unknown> | undefined,
  replayState: FilteredEventReplayState,
) {
  const itemKey = buildLiveItemLookupKey(turnId, itemId)
  if (replayState.reasoningItemKeys.has(itemKey)) {
    return true
  }

  const currentSummary = stringList(currentItem?.summary)
  const currentContent = stringList(currentItem?.content)
  const incomingSummary = stringList(incomingItem?.summary)
  const incomingContent = stringList(incomingItem?.content)
  if (
    !currentItem ||
    (!currentSummary.length && incomingSummary.length > 0) ||
    (!currentContent.length && incomingContent.length > 0)
  ) {
    replayState.reasoningItemKeys.add(itemKey)
    return true
  }

  return false
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
    return threadDetail
  }

  if (snapshotMs === null) {
    return currentLiveDetail
  }

  return snapshotMs >= currentMs
    ? reconcileStreamingSnapshotWithCurrentLiveDetail(
        threadDetail,
        currentLiveDetail,
      )
    : currentLiveDetail
}

function reconcileStreamingSnapshotWithCurrentLiveDetail(
  threadDetail: ThreadDetail,
  currentLiveDetail: ThreadDetail,
) {
  let detailChanged = false

  const turns = threadDetail.turns.map((snapshotTurn) => {
    const currentTurn = currentLiveDetail.turns.find(
      (turn) => turn.id === snapshotTurn.id,
    )
    if (!currentTurn) {
      return snapshotTurn
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
      if (!currentItem || stringField(snapshotItem.type) !== 'agentMessage') {
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

      const currentText = stringField(currentItem.text)
      const snapshotText = stringField(snapshotItem.text)
      if (snapshotText.length > currentText.length) {
        return snapshotItem
      }

      const shouldPreserveLongerCurrentText =
        currentText.length > snapshotText.length

      const shouldPreserveStreamingPhase =
        stringField(currentItem.type) === 'agentMessage' &&
        turnStatusLooksInterruptible(snapshotTurn.status) &&
        stringsEqualFold(stringField(currentItem.phase), 'streaming')
      const shouldPreserveClientRenderMode =
        stringField(currentItem.type) === 'agentMessage' &&
        stringField(currentItem.clientRenderMode) === 'animate-once'

      if (
        !shouldPreserveLongerCurrentText &&
        !shouldPreserveStreamingPhase &&
        !shouldPreserveClientRenderMode
      ) {
        return snapshotItem
      }

      turnChanged = true
      frontendDebugLog('thread-live', 'reconciled snapshot agent item with live state', {
        currentItem: summarizeLiveItemForDebug(currentItem),
        reason: {
          preserveClientRenderMode: shouldPreserveClientRenderMode,
          preserveLongerCurrentText: shouldPreserveLongerCurrentText,
          preserveStreamingPhase: shouldPreserveStreamingPhase,
        },
        snapshotItem: summarizeLiveItemForDebug(snapshotItem),
        threadId: threadDetail.id,
        turnId: snapshotTurn.id,
      })
      const reconciledItem: Record<string, unknown> = {
        ...snapshotItem,
        text: currentText || snapshotText,
      }
      if (shouldPreserveStreamingPhase) {
        reconciledItem.phase = 'streaming'
      }
      if (shouldPreserveClientRenderMode) {
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

  if (!detailChanged) {
    return threadDetail
  }

  return {
    ...threadDetail,
    turns,
  }
}

function shouldPreserveMissingTrailingLiveItem(item: Record<string, unknown>) {
  if (stringField(item.type) !== 'agentMessage') {
    return false
  }

  return (
    stringField(item.text).length > 0 ||
    stringsEqualFold(stringField(item.phase), 'streaming') ||
    stringField(item.clientRenderMode) === 'animate-once'
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
