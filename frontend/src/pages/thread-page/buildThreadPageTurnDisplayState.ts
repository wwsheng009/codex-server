import type { ThreadTurn } from '../../types/api'
import {
  collectThreadDisplayMetrics,
  primeThreadDisplayMetrics,
  primeThreadDisplayMetricsForTurnReplacements,
} from '../threadPageUtils'
import { normalizeTurnPlanStatus, readTurnPlanItem } from '../../lib/turn-plan'
import { buildPendingThreadTurn } from '../threadPageTurnHelpers'
import { recordConversationLiveDiagnosticEvent } from '../../components/workspace/threadConversationProfiler'
import { threadProjectionSingleTruth } from './threadRenderingFeatureFlags'
import type { ThreadPageTurnDisplayStateInput } from './threadPageDisplayTypes'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import { buildThreadContentSignature } from './threadContentSignature'
import type {
  ItemOverrideMetadata,
  PendingTurnMetadata,
  ThreadPageTurnDisplayStateResult,
  TurnArrayCacheEntry,
  TurnItemOverrideCacheNode,
  TurnMetadata,
  TurnOverrideCacheNode,
  TurnOverrideMetadata,
  TurnReplacementRef,
} from './threadPageTurnDisplayStateTypes'

const joinedCommandOutputCache = new WeakMap<object, string>()
const mergedItemContentOverrideCache = new WeakMap<
  Record<string, unknown>,
  WeakMap<Record<string, unknown>, Record<string, unknown>>
>()
const turnItemOverrideResultCache = new WeakMap<ThreadTurn, TurnItemOverrideCacheNode>()
const singleOverrideItemIdsCache = new WeakMap<Map<string, Record<string, unknown>>, string[]>()
const mergedOverrideItemIdsCache = new WeakMap<
  Map<string, Record<string, unknown>>,
  WeakMap<Map<string, Record<string, unknown>>, string[]>
>()
const mergedOverrideTurnIdsCache = new WeakMap<string[], WeakMap<string[], string[]>>()
const overrideTurnIdLookupCache = new WeakMap<string[], Set<string>>()
const itemOverrideMetadataCache = new WeakMap<
  Record<string, Record<string, unknown>>,
  ItemOverrideMetadata
>()
const turnOverrideMetadataCache = new WeakMap<Record<string, ThreadTurn>, TurnOverrideMetadata>()
const mergedTurnHistoryCache = new WeakMap<ThreadTurn[], WeakMap<ThreadTurn[], ThreadTurn[]>>()
const mergedTurnViewPatchCache = new WeakMap<ThreadTurn, WeakMap<ThreadTurn, ThreadTurn | null>>()
const turnIdSetCache = new WeakMap<ThreadTurn[], Set<string>>()
const turnMetadataCache = new WeakMap<ThreadTurn, TurnMetadata>()
const pendingTurnMetadataCache = new WeakMap<PendingThreadTurn, PendingTurnMetadata>()
const turnArrayCache = new WeakMap<ThreadTurn[], TurnArrayCacheEntry>()
const THREAD_GOVERNANCE_TURN_ID = 'thread-governance'
const guardedOverrideItemCache = new WeakMap<
  Record<string, unknown>,
  WeakMap<Record<string, unknown>, Record<string, unknown>>
>()

function readStringField(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return typeof value === 'string' ? value : ''
}

function guardOverrideAgainstLiveItem(
  baseItem: Record<string, unknown>,
  overrideItem: Record<string, unknown>,
  reason: 'turn-override' | 'item-override' | 'item-content-override',
) {
  if (!threadProjectionSingleTruth) {
    return overrideItem
  }
  if (baseItem === overrideItem) {
    return overrideItem
  }

  let cachedByBase = guardedOverrideItemCache.get(overrideItem)
  if (!cachedByBase) {
    cachedByBase = new WeakMap<Record<string, unknown>, Record<string, unknown>>()
    guardedOverrideItemCache.set(overrideItem, cachedByBase)
  }
  const cached = cachedByBase.get(baseItem)
  if (cached) {
    return cached
  }

  const baseType = readStringField(baseItem, 'type')
  const overrideType = readStringField(overrideItem, 'type')
  const preserveType = baseType && overrideType && baseType !== overrideType
  const patches: Record<string, unknown> = {}
  let guardTriggered = false
  const baseItemId = readStringField(baseItem, 'id') || null

  if (preserveType) {
    patches.type = baseType
    guardTriggered = true
  }

  const activeType = preserveType ? baseType : overrideType || baseType

  if (activeType === 'agentMessage') {
    const baseText = readStringField(baseItem, 'text')
    const overrideText = readStringField(overrideItem, 'text')
    if (baseText.length > overrideText.length) {
      patches.text = baseText
      guardTriggered = true
    }
    const basePhase = readStringField(baseItem, 'phase')
    const overridePhase = readStringField(overrideItem, 'phase')
    if (basePhase === 'streaming' && overridePhase !== 'streaming') {
      patches.phase = basePhase
      guardTriggered = true
    }
    const baseRenderMode = readStringField(baseItem, 'clientRenderMode')
    if (baseRenderMode === 'animate-once' && !('clientRenderMode' in overrideItem)) {
      patches.clientRenderMode = baseRenderMode
      guardTriggered = true
    }
  } else if (activeType === 'commandExecution') {
    const baseOutput = readStringField(baseItem, 'aggregatedOutput')
    const overrideOutput = readStringField(overrideItem, 'aggregatedOutput')
    const overrideChunks = overrideItem.aggregatedOutputChunks
    const overrideHasExplicitChunks = Array.isArray(overrideChunks) && overrideChunks.length > 0
    if (!overrideHasExplicitChunks && baseOutput.length > overrideOutput.length) {
      patches.aggregatedOutput = baseOutput
      guardTriggered = true
    }
  }

  if (!guardTriggered) {
    cachedByBase.set(baseItem, overrideItem)
    return overrideItem
  }

  const guarded = {
    ...overrideItem,
    ...patches,
  }
  cachedByBase.set(baseItem, guarded)

  recordConversationLiveDiagnosticEvent({
    itemId: baseItemId,
    itemType: activeType || null,
    kind: 'override-truth-guarded',
    metadata: {
      reason,
      guardedKeys: Object.keys(patches).join(','),
    },
    reason: `override truth guarded (${reason})`,
    source: 'thread-page-display',
  })

  return guarded
}

export function buildThreadPageTurnDisplayState({
  activePendingTurn,
  fullTurnItemContentOverridesById,
  fullTurnItemOverridesById,
  fullTurnOverridesById,
  historicalTurns,
  threadProjection,
  selectedThreadId,
}: ThreadPageTurnDisplayStateInput) {
  const turnsWithOverrides = applyTurnAndItemOverrides(
    composeRenderedTurns(historicalTurns, threadProjection?.turns ?? []),
    fullTurnOverridesById,
    fullTurnItemOverridesById,
    fullTurnItemContentOverridesById,
  )
  const displayedTurns = reconcileDisplayTurnPlanStatuses(
    applyPendingTurnDisplay(turnsWithOverrides, activePendingTurn),
  )

  assertProjectionItemsVisibleInTimeline(threadProjection?.turns ?? [], displayedTurns, selectedThreadId ?? null)

  const selectedThreadCacheKey = selectedThreadId ?? ''
  const cachedResult = getCachedTurnDisplayStateResult(
    displayedTurns,
    selectedThreadCacheKey,
    activePendingTurn,
  )
  if (cachedResult) {
    return cachedResult
  }

  const metrics = collectThreadDisplayMetrics(displayedTurns)
  const latestDisplayedTurn = findLatestDisplayTurn(displayedTurns)
  const turnCount = countDisplayableTurns(displayedTurns)
  const threadContentSignature = buildThreadContentSignature({
    latestRenderableItemKey: metrics.latestRenderableItemKey,
    latestTurnId: latestDisplayedTurn?.id ?? '',
    latestTurnStatus: latestDisplayedTurn?.status ?? '',
    pendingPhase: activePendingTurn?.phase ?? '',
    pendingTurnId: activePendingTurn?.turnId ?? '',
    selectedThreadId: selectedThreadCacheKey,
    timelineItemCount: metrics.timelineItemCount,
    turnCount,
  })

  const result: ThreadPageTurnDisplayStateResult = {
    displayedTurns,
    loadedAssistantMessageCount: metrics.loadedAssistantMessageCount,
    loadedMessageCount: metrics.loadedMessageCount,
    loadedUserMessageCount: metrics.loadedUserMessageCount,
    oldestDisplayedTurnId: displayedTurns[0]?.id,
    latestDisplayedTurn,
    settledMessageAutoScrollKey: metrics.settledMessageAutoScrollKey,
    threadUnreadUpdateKey: metrics.threadUnreadUpdateKey,
    threadContentSignature,
    timelineItemCount: metrics.timelineItemCount,
    turnCount,
  }

  setCachedTurnDisplayStateResult(displayedTurns, selectedThreadCacheKey, activePendingTurn, result)
  return result
}

const projectionAlertSignatureCache = new WeakMap<ThreadTurn[], WeakMap<ThreadTurn[], string>>()

function assertProjectionItemsVisibleInTimeline(
  projectionTurns: ThreadTurn[],
  displayedTurns: ThreadTurn[],
  threadId: string | null,
) {
  if (!threadProjectionSingleTruth) {
    return
  }
  if (!projectionTurns.length) {
    return
  }

  let cachedByDisplay = projectionAlertSignatureCache.get(projectionTurns)
  if (!cachedByDisplay) {
    cachedByDisplay = new WeakMap<ThreadTurn[], string>()
    projectionAlertSignatureCache.set(projectionTurns, cachedByDisplay)
  }
  if (cachedByDisplay.has(displayedTurns)) {
    return
  }

  const displayedItemIds = new Set<string>()
  for (const turn of displayedTurns) {
    for (const item of turn.items) {
      const itemId = typeof item.id === 'string' ? item.id : ''
      if (itemId) {
        displayedItemIds.add(`${turn.id}::${itemId}`)
      }
    }
  }

  const missing: Array<{ turnId: string; itemId: string; itemType: string }> = []
  for (const turn of projectionTurns) {
    for (const item of turn.items) {
      const itemId = typeof item.id === 'string' ? item.id : ''
      if (!itemId) {
        continue
      }
      if (!displayedItemIds.has(`${turn.id}::${itemId}`)) {
        missing.push({
          turnId: turn.id,
          itemId,
          itemType: typeof item.type === 'string' ? item.type : '',
        })
      }
    }
  }

  cachedByDisplay.set(displayedTurns, missing.length ? 'missing' : 'ok')

  for (const entry of missing) {
    recordConversationLiveDiagnosticEvent({
      itemId: entry.itemId,
      itemType: entry.itemType || null,
      kind: 'projection-item-missing-in-timeline',
      metadata: {
        missingCount: missing.length,
      },
      reason: 'projection item missing from rendered timeline',
      source: 'thread-page-display',
      threadId,
      turnId: entry.turnId,
    })
  }
}

function countDisplayableTurns(turns: ThreadTurn[]) {
  let count = 0
  for (const turn of turns) {
    if (isSyntheticGovernanceTurn(turn)) {
      continue
    }
    count += 1
  }
  return count
}

function findLatestDisplayTurn(turns: ThreadTurn[]) {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (!isSyntheticGovernanceTurn(turns[index])) {
      return turns[index]
    }
  }

  return turns[turns.length - 1]
}

function isSyntheticGovernanceTurn(turn: ThreadTurn | undefined) {
  return turn?.id === THREAD_GOVERNANCE_TURN_ID
}

function reconcileDisplayTurnPlanStatuses(turns: ThreadTurn[]) {
  let nextTurns: ThreadTurn[] | null = null

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex]
    const terminalStatus = normalizeDisplayTerminalTurnStatus(turn.status)
    if (!terminalStatus) {
      continue
    }

    let nextItems: ThreadTurn['items'] | null = null
    for (let itemIndex = 0; itemIndex < turn.items.length; itemIndex += 1) {
      const item = turn.items[itemIndex]
      const turnPlan = readTurnPlanItem(item)
      if (!turnPlan) {
        continue
      }

      const normalizedPlanStatus = normalizeTurnPlanStatus(turnPlan.status)
      if (normalizedPlanStatus && normalizedPlanStatus !== 'inprogress' && normalizedPlanStatus !== 'pending') {
        continue
      }

      if (!nextTurns) {
        nextTurns = [...turns]
      }
      if (!nextItems) {
        nextItems = [...turn.items]
        nextTurns[turnIndex] = {
          ...turn,
          items: nextItems,
        }
      }

      nextItems[itemIndex] = {
        ...item,
        status: terminalStatus,
      }
    }

    if (nextItems) {
      primeTurnMetadata(nextTurns![turnIndex])
    }
  }

  if (!nextTurns) {
    return turns
  }

  return nextTurns
}

function normalizeDisplayTerminalTurnStatus(value: string | undefined) {
  switch (normalizeTurnPlanStatus(value)) {
    case 'completed':
      return 'completed'
    case 'interrupted':
    case 'stopped':
      return 'interrupted'
    case 'failed':
    case 'error':
      return 'failed'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return ''
  }
}

function getCachedTurnDisplayStateResult(
  displayedTurns: ThreadTurn[],
  selectedThreadId: string,
  pendingTurn: PendingThreadTurn | null,
) {
  const bucket = getTurnArrayCacheEntry(displayedTurns).displayState

  if (!pendingTurn) {
    return bucket.nullPendingByThreadId.get(selectedThreadId)
  }

  return bucket.pendingByThreadId.get(selectedThreadId)?.get(pendingTurn)
}

function setCachedTurnDisplayStateResult(
  displayedTurns: ThreadTurn[],
  selectedThreadId: string,
  pendingTurn: PendingThreadTurn | null,
  result: ThreadPageTurnDisplayStateResult,
) {
  const bucket = getTurnArrayCacheEntry(displayedTurns).displayState

  if (!pendingTurn) {
    bucket.nullPendingByThreadId.set(selectedThreadId, result)
    return
  }

  let pendingCache = bucket.pendingByThreadId.get(selectedThreadId)
  if (!pendingCache) {
    pendingCache = new WeakMap<PendingThreadTurn, ThreadPageTurnDisplayStateResult>()
    bucket.pendingByThreadId.set(selectedThreadId, pendingCache)
  }
  pendingCache.set(pendingTurn, result)
}

function applyPendingTurnDisplay(
  turns: ThreadTurn[],
  pendingTurn: PendingThreadTurn | null,
) {
  if (!pendingTurn) {
    return turns
  }

  const cacheEntry = getTurnArrayCacheEntry(turns)
  const cached = cacheEntry.pendingTurnResults.get(pendingTurn)
  if (cached) {
    return cached
  }

  const turnIndex =
    pendingTurn.turnId ? getTurnIndexById(turns).get(pendingTurn.turnId) : undefined
  const result =
    typeof turnIndex === 'number'
      ? injectPendingUserMessageAtIndex(turns, turnIndex, pendingTurn)
      : appendPendingThreadTurn(turns, pendingTurn)

  cacheEntry.pendingTurnResults.set(pendingTurn, result)
  return result
}

function buildCachedPendingThreadTurn(pendingTurn: PendingThreadTurn) {
  const metadata = getPendingTurnMetadata(pendingTurn)
  if (metadata.standaloneTurn) {
    return metadata.standaloneTurn
  }

  const turn = buildPendingThreadTurn(pendingTurn)
  primeTurnMetadata(turn)
  metadata.standaloneTurn = turn
  return turn
}

function appendPendingThreadTurn(turns: ThreadTurn[], pendingTurn: PendingThreadTurn) {
  const pendingTurnDisplay = buildCachedPendingThreadTurn(pendingTurn)
  const nextTurns = [...turns, pendingTurnDisplay]
  const nextIndexById = new Map(getTurnIndexById(turns))
  nextIndexById.set(pendingTurnDisplay.id, turns.length)
  const nextTurnArrayEntry = getTurnArrayCacheEntry(nextTurns)
  nextTurnArrayEntry.turnIndexById = nextIndexById
  primeThreadDisplayMetrics(
    nextTurns,
    getStandalonePendingMetrics(nextTurnArrayEntry, turns, pendingTurnDisplay, pendingTurn),
  )
  return nextTurns
}

function injectPendingUserMessageAtIndex(
  turns: ThreadTurn[],
  turnIndex: number,
  pendingTurn: PendingThreadTurn,
) {
  const turn = turns[turnIndex]
  if (turnHasUserMessage(turn)) {
    return turns
  }

  const nextTurns = [...turns]
  nextTurns[turnIndex] = {
    ...turn,
    items: [buildPendingUserMessageItem(pendingTurn), ...turn.items],
  }
  primeTurnMetadata(nextTurns[turnIndex])
  const nextTurnArrayEntry = getTurnArrayCacheEntry(nextTurns)
  nextTurnArrayEntry.turnIndexById = getTurnIndexById(turns)
  primeThreadDisplayMetrics(
    nextTurns,
    getInjectedPendingMetrics(nextTurnArrayEntry, turns, turnIndex, nextTurns[turnIndex], pendingTurn),
  )
  return nextTurns
}

function buildPendingUserMessageItem(pendingTurn: PendingThreadTurn) {
  const metadata = getPendingTurnMetadata(pendingTurn)
  if (metadata.userMessageItem) {
    return metadata.userMessageItem
  }

  const item = {
    content: [
      {
        text: pendingTurn.input,
        type: 'inputText',
      },
    ],
    id: `pending-user-${pendingTurn.localId}`,
    type: 'userMessage',
  }
  metadata.userMessageItem = item
  return item
}

function extendMetricsWithStandalonePendingTurn(
  turns: ThreadTurn[],
  pendingTurnDisplay: ThreadTurn,
  pendingTurn: PendingThreadTurn,
) {
  const baseMetrics = collectThreadDisplayMetrics(turns)
  const pendingMessageKey = getPendingTurnMessageKey(pendingTurnDisplay.id, pendingTurn)

  return {
    latestRenderableItemKey: pendingMessageKey,
    loadedAssistantMessageCount: baseMetrics.loadedAssistantMessageCount,
    loadedMessageCount: baseMetrics.loadedMessageCount + 1,
    loadedUserMessageCount: baseMetrics.loadedUserMessageCount + 1,
    settledMessageAutoScrollKey: pendingMessageKey,
    threadUnreadUpdateKey: pendingMessageKey,
    timelineItemCount: baseMetrics.timelineItemCount + 1,
  }
}

function extendMetricsWithInjectedPendingUserMessage(
  turns: ThreadTurn[],
  turnIndex: number,
  pendingTurnDisplay: ThreadTurn,
  pendingTurn: PendingThreadTurn,
) {
  const baseMetrics = collectThreadDisplayMetrics(turns)
  const isLastTurn = turnIndex === turns.length - 1
  const hadNoItems = pendingTurnDisplay.items.length === 1
  const pendingMessageKey = getPendingTurnMessageKey(pendingTurnDisplay.id, pendingTurn)

  return {
    latestRenderableItemKey:
      isLastTurn && hadNoItems ? pendingMessageKey : baseMetrics.latestRenderableItemKey,
    loadedAssistantMessageCount: baseMetrics.loadedAssistantMessageCount,
    loadedMessageCount: baseMetrics.loadedMessageCount + 1,
    loadedUserMessageCount: baseMetrics.loadedUserMessageCount + 1,
    settledMessageAutoScrollKey:
      isLastTurn && hadNoItems ? pendingMessageKey : baseMetrics.settledMessageAutoScrollKey,
    threadUnreadUpdateKey:
      isLastTurn && hadNoItems ? pendingMessageKey : baseMetrics.threadUnreadUpdateKey,
    timelineItemCount: baseMetrics.timelineItemCount + 1,
  }
}

function getStandalonePendingMetrics(
  turnArrayEntry: TurnArrayCacheEntry,
  turns: ThreadTurn[],
  pendingTurnDisplay: ThreadTurn,
  pendingTurn: PendingThreadTurn,
) {
  const cached = turnArrayEntry.pendingStandaloneMetrics.get(pendingTurn)
  if (cached) {
    return cached
  }

  const metrics = extendMetricsWithStandalonePendingTurn(turns, pendingTurnDisplay, pendingTurn)
  turnArrayEntry.pendingStandaloneMetrics.set(pendingTurn, metrics)
  return metrics
}

function getInjectedPendingMetrics(
  turnArrayEntry: TurnArrayCacheEntry,
  turns: ThreadTurn[],
  turnIndex: number,
  pendingTurnDisplay: ThreadTurn,
  pendingTurn: PendingThreadTurn,
) {
  const cached = turnArrayEntry.pendingInjectedMetrics.get(pendingTurn)
  if (cached) {
    return cached
  }

  const metrics = extendMetricsWithInjectedPendingUserMessage(
    turns,
    turnIndex,
    pendingTurnDisplay,
    pendingTurn,
  )
  turnArrayEntry.pendingInjectedMetrics.set(pendingTurn, metrics)
  return metrics
}

function applyTurnOverrides(
  turns: ThreadTurn[],
  fullTurnOverridesById: Record<string, ThreadTurn>,
  overrideMetadata: TurnOverrideMetadata = getTurnOverrideMetadata(fullTurnOverridesById),
) {
  if (!turns.length || overrideMetadata.count === 0) {
    return turns
  }
  const turnArrayEntry = getTurnArrayCacheEntry(turns)
  const cachedResult = turnArrayEntry.turnOverrideResults.get(fullTurnOverridesById)
  if (cachedResult) {
    return cachedResult
  }

  const turnIndexById = getTurnIndexById(turns)
  const structuredCachedResult = getCachedTurnOverrideResult(
    turnArrayEntry.turnOverrideResultTree,
    overrideMetadata.turnIds,
    fullTurnOverridesById,
    turnIndexById,
  )
  if (structuredCachedResult) {
    turnArrayEntry.turnOverrideResults.set(fullTurnOverridesById, structuredCachedResult)
    return structuredCachedResult
  }

  let nextTurns: ThreadTurn[] | null = null
  let cacheNode: TurnOverrideCacheNode | null = null
  const resolvedTurnReplacements: TurnReplacementRef[] = []
  let turnChanged = false
  for (const turnId of overrideMetadata.turnIds) {
    const index = turnIndexById.get(turnId)
    if (typeof index !== 'number') {
      continue
    }

    const override = fullTurnOverridesById[turnId]
    if (!override) {
      continue
    }

    const patchedTurn = applyTurnViewPatch(turns[index], override)
    if (!patchedTurn) {
      continue
    }
    if (!nextTurns) {
      nextTurns = [...turns]
    }
    if (!cacheNode) {
      cacheNode = turnArrayEntry.turnOverrideResultTree
    }
    nextTurns[index] = patchedTurn
    resolvedTurnReplacements.push({
      turnIndex: index,
      turnRef: patchedTurn,
    })
    cacheNode = getOrCreateTurnOverrideCacheChild(cacheNode, index, override)
    turnChanged = true
  }

  const result = nextTurns ?? turns
  if (turnChanged && cacheNode) {
    cacheNode.result = result
  }
  if (nextTurns) {
    getTurnArrayCacheEntry(nextTurns).turnIndexById = getTurnIndexById(turns)
    primeThreadDisplayMetricsForTurnReplacements(turns, nextTurns, resolvedTurnReplacements)
  }
  turnArrayEntry.turnOverrideResults.set(fullTurnOverridesById, result)
  return result
}

function applyTurnAndItemOverrides(
  turns: ThreadTurn[],
  fullTurnOverridesById: Record<string, ThreadTurn>,
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>,
  fullTurnItemContentOverridesById: Record<string, Record<string, unknown>>,
) {
  const turnOverrideMetadata = getTurnOverrideMetadata(fullTurnOverridesById)
  const itemOverrideMetadata = getItemOverrideMetadata(fullTurnItemOverridesById)
  const itemContentOverrideMetadata = getItemOverrideMetadata(fullTurnItemContentOverridesById)

  if (
    !turns.length ||
    (turnOverrideMetadata.count === 0 &&
      itemOverrideMetadata.count === 0 &&
      itemContentOverrideMetadata.count === 0)
  ) {
    return turns
  }

  if (itemOverrideMetadata.count === 0 && itemContentOverrideMetadata.count === 0) {
    return applyTurnOverrides(turns, fullTurnOverridesById, turnOverrideMetadata)
  }

  if (turnOverrideMetadata.count === 0) {
    return applyTurnItemOverrides(
      turns,
      fullTurnItemOverridesById,
      fullTurnItemContentOverridesById,
      itemOverrideMetadata,
      itemContentOverrideMetadata,
    )
  }

  const turnArrayEntry = getTurnArrayCacheEntry(turns)
  const cachedResult = turnArrayEntry.combinedOverrideResults
    .get(fullTurnOverridesById)
    ?.get(fullTurnItemOverridesById)
    ?.get(fullTurnItemContentOverridesById)
  if (cachedResult) {
    return cachedResult
  }

  const turnIndexById = getTurnIndexById(turns)
  const targetTurnIds = collectOverrideTurnIds(
    collectOverrideTurnIds(turnOverrideMetadata.turnIds, itemOverrideMetadata.turnIds),
    itemContentOverrideMetadata.turnIds,
  )
  const resolvedTurnReplacements: TurnReplacementRef[] = []
  for (const turnId of targetTurnIds) {
    const turnIndex = turnIndexById.get(turnId)
    if (typeof turnIndex !== 'number') {
      continue
    }

    const baseOverrideTurn = fullTurnOverridesById[turnId]
    const baseTurn =
      baseOverrideTurn ? applyTurnViewPatch(turns[turnIndex], baseOverrideTurn) ?? turns[turnIndex] : turns[turnIndex]

    const itemOverridesForTurn = itemOverrideMetadata.byTurnId.get(baseTurn.id)
    const itemContentOverridesForTurn = itemContentOverrideMetadata.byTurnId.get(baseTurn.id)
    if (!itemOverridesForTurn && !itemContentOverridesForTurn) {
      if (baseTurn === turns[turnIndex]) {
        continue
      }

      resolvedTurnReplacements.push({
        turnIndex,
        turnRef: baseTurn,
      })
      continue
    }
    const resolvedTurn = resolveTurnItemOverrides(
      baseTurn,
      itemOverridesForTurn,
      itemContentOverridesForTurn,
    )
    if (!resolvedTurn) {
      if (!baseOverrideTurn) {
        continue
      }

      resolvedTurnReplacements.push({
        turnIndex,
        turnRef: baseTurn,
      })
      continue
    }
    resolvedTurnReplacements.push({
      turnIndex,
      turnRef: resolvedTurn,
    })
  }

  const structuredCachedResult =
    resolvedTurnReplacements.length > 0
      ? getCachedTurnReplacementResultFromRefs(
          turnArrayEntry.turnOverrideResultTree,
          resolvedTurnReplacements,
        )
      : undefined
  const result =
    structuredCachedResult ??
    (resolvedTurnReplacements.length > 0
      ? applyTurnReplacements(turns, resolvedTurnReplacements)
      : turns)
  if (!structuredCachedResult && resolvedTurnReplacements.length > 0) {
    cacheTurnReplacementResultFromRefs(
      turnArrayEntry.turnOverrideResultTree,
      resolvedTurnReplacements,
      result,
    )
    getTurnArrayCacheEntry(result).turnIndexById = getTurnIndexById(turns)
    primeThreadDisplayMetricsForTurnReplacements(turns, result, resolvedTurnReplacements)
  }
  let cacheByTurnOverride = turnArrayEntry.combinedOverrideResults.get(fullTurnOverridesById)
  if (!cacheByTurnOverride) {
    cacheByTurnOverride = new WeakMap<
      Record<string, Record<string, unknown>>,
      WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>
    >()
    turnArrayEntry.combinedOverrideResults.set(fullTurnOverridesById, cacheByTurnOverride)
  }
  let cacheByItemOverride = cacheByTurnOverride.get(fullTurnItemOverridesById)
  if (!cacheByItemOverride) {
    cacheByItemOverride = new WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>()
    cacheByTurnOverride.set(fullTurnItemOverridesById, cacheByItemOverride)
  }
  cacheByItemOverride.set(fullTurnItemContentOverridesById, result)
  return result
}

function getTurnIndexById(turns: ThreadTurn[]) {
  const turnArrayEntry = getTurnArrayCacheEntry(turns)
  const cached = turnArrayEntry.turnIndexById
  if (cached) {
    return cached
  }

  const indexById = buildTurnIndexById(turns)
  turnArrayEntry.turnIndexById = indexById
  return indexById
}

function applyTurnItemOverrides(
  turns: ThreadTurn[],
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>,
  fullTurnItemContentOverridesById: Record<string, Record<string, unknown>>,
  itemOverrideMetadata: ItemOverrideMetadata = getItemOverrideMetadata(fullTurnItemOverridesById),
  itemContentOverrideMetadata: ItemOverrideMetadata = getItemOverrideMetadata(
    fullTurnItemContentOverridesById,
  ),
) {
  if (
    !turns.length ||
    (itemOverrideMetadata.count === 0 && itemContentOverrideMetadata.count === 0)
  ) {
    return turns
  }
  const turnArrayEntry = getTurnArrayCacheEntry(turns)
  const cachedResult = turnArrayEntry.itemOverrideResults
    .get(fullTurnItemOverridesById)
    ?.get(fullTurnItemContentOverridesById)
  if (cachedResult) {
    return cachedResult
  }

  const turnIndexById = getTurnIndexById(turns)
  const targetTurnIds = collectOverrideTurnIds(
    itemOverrideMetadata.turnIds,
    itemContentOverrideMetadata.turnIds,
  )
  const resolvedTurnReplacements: TurnReplacementRef[] = []
  for (const turnId of targetTurnIds) {
    const turnIndex = turnIndexById.get(turnId)
    if (typeof turnIndex !== 'number') {
      continue
    }

    const turn = turns[turnIndex]
    const itemOverridesForTurn = itemOverrideMetadata.byTurnId.get(turn.id)
    const itemContentOverridesForTurn = itemContentOverrideMetadata.byTurnId.get(turn.id)
    const resolvedTurn = resolveTurnItemOverrides(
      turn,
      itemOverridesForTurn,
      itemContentOverridesForTurn,
    )
    if (!resolvedTurn) {
      continue
    }
    resolvedTurnReplacements.push({
      turnIndex,
      turnRef: resolvedTurn,
    })
  }

  const structuredCachedResult =
    resolvedTurnReplacements.length > 0
      ? getCachedTurnReplacementResultFromRefs(
          turnArrayEntry.turnOverrideResultTree,
          resolvedTurnReplacements,
        )
      : undefined
  const result =
    structuredCachedResult ??
    (resolvedTurnReplacements.length > 0
      ? applyTurnReplacements(turns, resolvedTurnReplacements)
      : turns)
  if (!structuredCachedResult && resolvedTurnReplacements.length > 0) {
    cacheTurnReplacementResultFromRefs(
      turnArrayEntry.turnOverrideResultTree,
      resolvedTurnReplacements,
      result,
    )
    getTurnArrayCacheEntry(result).turnIndexById = getTurnIndexById(turns)
    primeThreadDisplayMetricsForTurnReplacements(turns, result, resolvedTurnReplacements)
  }
  let cacheByContentOverride = turnArrayEntry.itemOverrideResults.get(fullTurnItemOverridesById)
  if (!cacheByContentOverride) {
    cacheByContentOverride = new WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>()
    turnArrayEntry.itemOverrideResults.set(fullTurnItemOverridesById, cacheByContentOverride)
  }

  cacheByContentOverride.set(fullTurnItemContentOverridesById, result)
  return result
}

function getItemIndexById(turn: ThreadTurn) {
  const metadata = getTurnMetadata(turn)
  if (metadata.itemIndexById) {
    return metadata.itemIndexById
  }

  const indexById = buildItemIndexById(turn)
  metadata.itemIndexById = indexById
  return indexById
}

function collectOverrideItemIds(
  itemOverridesForTurn: Map<string, Record<string, unknown>> | undefined,
  itemContentOverridesForTurn: Map<string, Record<string, unknown>> | undefined,
) {
  if (!itemOverridesForTurn && !itemContentOverridesForTurn) {
    return [] as string[]
  }

  if (!itemOverridesForTurn) {
    return getSingleOverrideItemIds(itemContentOverridesForTurn!)
  }

  if (!itemContentOverridesForTurn) {
    return getSingleOverrideItemIds(itemOverridesForTurn)
  }

  if (itemOverridesForTurn === itemContentOverridesForTurn) {
    return getSingleOverrideItemIds(itemOverridesForTurn)
  }

  let mergedBySecondary = mergedOverrideItemIdsCache.get(itemOverridesForTurn)
  if (!mergedBySecondary) {
    mergedBySecondary = new WeakMap<Map<string, Record<string, unknown>>, string[]>()
    mergedOverrideItemIdsCache.set(itemOverridesForTurn, mergedBySecondary)
  }

  const cached = mergedBySecondary.get(itemContentOverridesForTurn)
  if (cached) {
    return cached
  }

  const primaryItemIds = getSingleOverrideItemIds(itemOverridesForTurn)
  const secondaryItemIds = getSingleOverrideItemIds(itemContentOverridesForTurn)
  let merged: string[] | null = null
  for (const itemId of secondaryItemIds) {
    if (itemOverridesForTurn.has(itemId)) {
      continue
    }

    if (!merged) {
      merged = [...primaryItemIds]
    }
    merged.push(itemId)
  }

  const result = merged ?? primaryItemIds
  mergedBySecondary.set(itemContentOverridesForTurn, result)
  return result
}

function collectOverrideTurnIds(primary: string[], secondary: string[]) {
  if (primary.length === 0) {
    return secondary
  }

  if (secondary.length === 0) {
    return primary
  }

  if (primary === secondary) {
    return primary
  }

  let mergedBySecondary = mergedOverrideTurnIdsCache.get(primary)
  if (!mergedBySecondary) {
    mergedBySecondary = new WeakMap<string[], string[]>()
    mergedOverrideTurnIdsCache.set(primary, mergedBySecondary)
  }

  const cached = mergedBySecondary.get(secondary)
  if (cached) {
    return cached
  }

  const primaryTurnIds = getOverrideTurnIdLookup(primary)
  let turnIds: string[] | null = null
  for (const turnId of secondary) {
    if (primaryTurnIds.has(turnId)) {
      continue
    }

    if (!turnIds) {
      turnIds = [...primary]
    }
    turnIds.push(turnId)
  }

  const result = turnIds ?? primary
  mergedBySecondary.set(secondary, result)
  return result
}

function applyItemContentOverride(
  override: Record<string, unknown>,
  item: Record<string, unknown>,
) {
  let cachedByOverride = mergedItemContentOverrideCache.get(item)
  if (!cachedByOverride) {
    cachedByOverride = new WeakMap<Record<string, unknown>, Record<string, unknown>>()
    mergedItemContentOverrideCache.set(item, cachedByOverride)
  }

  const cached = cachedByOverride.get(override)
  if (cached) {
    return cached
  }

  const mergedItem = {
    ...item,
    ...override,
    aggregatedOutput: resolveCommandOutputContent(override, item),
  }
  const guardedItem = guardOverrideAgainstLiveItem(item, mergedItem, 'item-content-override')
  cachedByOverride.set(override, guardedItem)
  return guardedItem
}

function resolveTurnItemOverrides(
  turn: ThreadTurn,
  itemOverridesForTurn: Map<string, Record<string, unknown>> | undefined,
  itemContentOverridesForTurn: Map<string, Record<string, unknown>> | undefined,
) {
  if (!itemOverridesForTurn && !itemContentOverridesForTurn) {
    return undefined
  }

  const itemIndexById = getItemIndexById(turn)
  const targetItemIds = collectOverrideItemIds(itemOverridesForTurn, itemContentOverridesForTurn)
  const cachedTurn = getCachedTurnItemOverrideResult(
    turn,
    targetItemIds,
    itemIndexById,
    itemOverridesForTurn,
    itemContentOverridesForTurn,
  )
  if (cachedTurn) {
    return cachedTurn
  }

  let nextItems: ThreadTurn['items'] | null = null
  let cacheNode: TurnItemOverrideCacheNode | null = null
  let turnChanged = false
  for (const itemId of targetItemIds) {
    const itemIndex = itemIndexById.get(itemId)
    if (typeof itemIndex !== 'number') {
      continue
    }

    const item = turn.items[itemIndex]
    const itemOverride = itemOverridesForTurn?.get(itemId)
    const itemContentOverride = itemContentOverridesForTurn?.get(itemId)
    if (!itemOverride && !itemContentOverride) {
      continue
    }

    if (!nextItems) {
      nextItems = [...turn.items]
    }
    if (!cacheNode) {
      cacheNode = getOrCreateTurnItemOverrideCacheRoot(turn)
    }

    if (itemOverride) {
      nextItems[itemIndex] = guardOverrideAgainstLiveItem(item, itemOverride, 'item-override')
      cacheNode = getOrCreateTurnItemOverrideCacheChild(cacheNode, itemIndex, 0, itemOverride)
    } else {
      nextItems[itemIndex] = applyItemContentOverride(itemContentOverride!, item)
      cacheNode = getOrCreateTurnItemOverrideCacheChild(
        cacheNode,
        itemIndex,
        1,
        itemContentOverride!,
      )
    }
    turnChanged = true
  }

  if (!turnChanged || !nextItems) {
    return undefined
  }

  const nextTurn = {
    ...turn,
    items: nextItems,
  }
  primeTurnMetadata(nextTurn)
  if (cacheNode) {
    cacheNode.result = nextTurn
  }
  return nextTurn
}

function getCachedTurnItemOverrideResult(
  turn: ThreadTurn,
  targetItemIds: string[],
  itemIndexById: Map<string, number>,
  itemOverridesForTurn: Map<string, Record<string, unknown>> | undefined,
  itemContentOverridesForTurn: Map<string, Record<string, unknown>> | undefined,
) {
  let node = turnItemOverrideResultCache.get(turn)
  if (!node) {
    return undefined
  }

  let hasResolvedOverride = false
  for (const itemId of targetItemIds) {
    const itemIndex = itemIndexById.get(itemId)
    if (typeof itemIndex !== 'number') {
      continue
    }

    const itemOverride = itemOverridesForTurn?.get(itemId)
    const itemContentOverride = itemContentOverridesForTurn?.get(itemId)
    if (!itemOverride && !itemContentOverride) {
      continue
    }

    hasResolvedOverride = true
    const overrideKind = itemOverride ? 0 : 1
    const overrideRef = itemOverride ?? itemContentOverride!
    node = node.byItemIndex?.get(itemIndex)
    if (!node) {
      return undefined
    }

    node = node.byOverrideKind?.get(overrideKind)
    if (!node) {
      return undefined
    }

    node = node.byOverrideRef?.get(overrideRef)
    if (!node) {
      return undefined
    }
  }

  return hasResolvedOverride ? node.result : undefined
}

function getCachedTurnOverrideResult(
  root: TurnOverrideCacheNode,
  turnIds: string[],
  overridesById: Record<string, ThreadTurn>,
  turnIndexById: Map<string, number>,
) {
  let node: TurnOverrideCacheNode | undefined = root
  let hasResolvedOverride = false

  for (const turnId of turnIds) {
    const turnIndex = turnIndexById.get(turnId)
    if (typeof turnIndex !== 'number') {
      continue
    }

    const override = overridesById[turnId]
    if (!override) {
      continue
    }

    hasResolvedOverride = true
    node = node.byTurnIndex?.get(turnIndex)
    if (!node) {
      return undefined
    }

    node = node.byOverrideRef?.get(override)
    if (!node) {
      return undefined
    }
  }

  return hasResolvedOverride ? node.result : undefined
}

function getCachedTurnReplacementResultFromRefs(
  root: TurnOverrideCacheNode,
  replacements: TurnReplacementRef[],
) {
  let node: TurnOverrideCacheNode | undefined = root
  for (const { turnIndex, turnRef } of replacements) {
    node = node.byTurnIndex?.get(turnIndex)
    if (!node) {
      return undefined
    }

    node = node.byOverrideRef?.get(turnRef)
    if (!node) {
      return undefined
    }
  }

  return replacements.length > 0 ? node.result : undefined
}

function getOrCreateTurnItemOverrideCacheRoot(turn: ThreadTurn) {
  let node = turnItemOverrideResultCache.get(turn)
  if (!node) {
    node = {}
    turnItemOverrideResultCache.set(turn, node)
  }
  return node
}

function getOrCreateTurnItemOverrideCacheChild(
  node: TurnItemOverrideCacheNode,
  itemIndex: number,
  overrideKind: 0 | 1,
  overrideRef: Record<string, unknown>,
) {
  if (!node.byItemIndex) {
    node.byItemIndex = new Map<number, TurnItemOverrideCacheNode>()
  }
  let nextNode = node.byItemIndex.get(itemIndex)
  if (!nextNode) {
    nextNode = {}
    node.byItemIndex.set(itemIndex, nextNode)
  }
  node = nextNode

  if (!node.byOverrideKind) {
    node.byOverrideKind = new Map<number, TurnItemOverrideCacheNode>()
  }
  nextNode = node.byOverrideKind.get(overrideKind)
  if (!nextNode) {
    nextNode = {}
    node.byOverrideKind.set(overrideKind, nextNode)
  }
  node = nextNode

  if (!node.byOverrideRef) {
    node.byOverrideRef = new WeakMap<Record<string, unknown>, TurnItemOverrideCacheNode>()
  }
  nextNode = node.byOverrideRef.get(overrideRef)
  if (!nextNode) {
    nextNode = {}
    node.byOverrideRef.set(overrideRef, nextNode)
  }

  return nextNode
}

function getOrCreateTurnOverrideCacheChild(
  node: TurnOverrideCacheNode,
  turnIndex: number,
  override: ThreadTurn,
) {
  if (!node.byTurnIndex) {
    node.byTurnIndex = new Map<number, TurnOverrideCacheNode>()
  }
  let nextNode = node.byTurnIndex.get(turnIndex)
  if (!nextNode) {
    nextNode = {}
    node.byTurnIndex.set(turnIndex, nextNode)
  }
  node = nextNode

  if (!node.byOverrideRef) {
    node.byOverrideRef = new WeakMap<ThreadTurn, TurnOverrideCacheNode>()
  }
  nextNode = node.byOverrideRef.get(override)
  if (!nextNode) {
    nextNode = {}
    node.byOverrideRef.set(override, nextNode)
  }

  return nextNode
}

function cacheTurnReplacementResultFromRefs(
  root: TurnOverrideCacheNode,
  replacements: TurnReplacementRef[],
  result: ThreadTurn[],
) {
  let node = root
  for (const { turnIndex, turnRef } of replacements) {
    node = getOrCreateTurnOverrideCacheChild(node, turnIndex, turnRef)
  }

  node.result = result
}

function applyTurnReplacements(
  turns: ThreadTurn[],
  replacements: TurnReplacementRef[],
) {
  const nextTurns = [...turns]
  for (const { turnIndex, turnRef } of replacements) {
    nextTurns[turnIndex] = turnRef
  }
  return nextTurns
}

function applyTurnViewPatch(turn: ThreadTurn, overrideTurn: ThreadTurn) {
  let cachedByOverride = mergedTurnViewPatchCache.get(turn)
  if (!cachedByOverride) {
    cachedByOverride = new WeakMap<ThreadTurn, ThreadTurn | null>()
    mergedTurnViewPatchCache.set(turn, cachedByOverride)
  }

  if (cachedByOverride.has(overrideTurn)) {
    return cachedByOverride.get(overrideTurn) ?? undefined
  }

  const overrideItemsById = new Map<string, Record<string, unknown>>()
  for (const item of overrideTurn.items) {
    const itemId = typeof item.id === 'string' ? item.id : ''
    if (!itemId) {
      continue
    }

    overrideItemsById.set(itemId, item)
  }

  let nextItems: ThreadTurn['items'] | null = null
  let turnChanged = false
  for (let itemIndex = 0; itemIndex < turn.items.length; itemIndex += 1) {
    const item = turn.items[itemIndex]
    const itemId = typeof item.id === 'string' ? item.id : ''
    if (!itemId) {
      continue
    }

    const overrideItem = overrideItemsById.get(itemId)
    if (!overrideItem || overrideItem === item) {
      continue
    }

    const guardedOverrideItem = guardOverrideAgainstLiveItem(item, overrideItem, 'turn-override')
    if (guardedOverrideItem === item) {
      continue
    }

    if (!nextItems) {
      nextItems = [...turn.items]
    }
    nextItems[itemIndex] = guardedOverrideItem
    turnChanged = true
  }

  const { items: _overrideItems, ...overrideFields } = overrideTurn
  for (const key in overrideFields) {
    if (!Object.prototype.hasOwnProperty.call(overrideFields, key)) {
      continue
    }

    if ((turn as Record<string, unknown>)[key] === (overrideFields as Record<string, unknown>)[key]) {
      continue
    }

    turnChanged = true
    break
  }

  if (!turnChanged) {
    cachedByOverride.set(overrideTurn, null)
    return undefined
  }

  const nextTurn = {
    ...turn,
    ...overrideFields,
    items: nextItems ?? turn.items,
  }
  primeTurnMetadata(nextTurn)
  cachedByOverride.set(overrideTurn, nextTurn)
  return nextTurn
}

function resolveCommandOutputContent(
  override: Record<string, unknown>,
  item: Record<string, unknown>,
) {
  const chunks = override.aggregatedOutputChunks
  if (!Array.isArray(chunks) || !chunks.length) {
    return override.aggregatedOutput ?? item.aggregatedOutput
  }

  const cached = joinedCommandOutputCache.get(chunks)
  if (cached) {
    return cached
  }

  for (const chunk of chunks) {
    if (typeof chunk !== 'string') {
      return override.aggregatedOutput ?? item.aggregatedOutput
    }
  }

  const value = chunks.join('')
  joinedCommandOutputCache.set(chunks, value)
  return value
}

function getItemOverrideMetadata(overridesById: Record<string, Record<string, unknown>>) {
  const cached = itemOverrideMetadataCache.get(overridesById)
  if (cached) {
    return cached
  }

  const grouped = new Map<string, Map<string, Record<string, unknown>>>()
  const turnIds: string[] = []
  let count = 0

  for (const key in overridesById) {
    if (!Object.prototype.hasOwnProperty.call(overridesById, key)) {
      continue
    }

    const override = overridesById[key]
    const separatorIndex = key.indexOf('::')
    if (separatorIndex <= 0 || separatorIndex === key.length - 2) {
      continue
    }

    const turnId = key.slice(0, separatorIndex)
    const itemId = key.slice(separatorIndex + 2)
    let turnOverrides = grouped.get(turnId)
    if (!turnOverrides) {
      turnOverrides = new Map<string, Record<string, unknown>>()
      grouped.set(turnId, turnOverrides)
      turnIds.push(turnId)
    }

    turnOverrides.set(itemId, override)
    count += 1
  }

  const metadata = {
    byTurnId: grouped,
    count,
    turnIds,
  }
  itemOverrideMetadataCache.set(overridesById, metadata)
  return metadata
}

function getTurnOverrideMetadata(overridesById: Record<string, ThreadTurn>) {
  const cached = turnOverrideMetadataCache.get(overridesById)
  if (cached) {
    return cached
  }

  const turnIds: string[] = []
  let count = 0
  for (const turnId in overridesById) {
    if (!Object.prototype.hasOwnProperty.call(overridesById, turnId)) {
      continue
    }

    turnIds.push(turnId)
    count += 1
  }

  const metadata = {
    count,
    turnIds,
  }
  turnOverrideMetadataCache.set(overridesById, metadata)
  return metadata
}

function turnHasUserMessage(turn: ThreadTurn) {
  const metadata = getTurnMetadata(turn)
  if (metadata.hasUserMessage !== undefined) {
    return metadata.hasUserMessage
  }

  const hasUserMessage = turn.items.some((item) => item.type === 'userMessage')
  metadata.hasUserMessage = hasUserMessage
  return hasUserMessage
}

function composeRenderedTurns(historicalTurns: ThreadTurn[], liveTurns: ThreadTurn[]) {
  if (!historicalTurns.length) {
    return liveTurns
  }

  if (!liveTurns.length) {
    return historicalTurns
  }

  const cached = mergedTurnHistoryCache.get(historicalTurns)?.get(liveTurns)
  if (cached) {
    return cached
  }

  const historicalTurnIds = getTurnIdSet(historicalTurns)
  const liveTurnIds = getTurnIdSet(liveTurns)
  const mergedTurns: ThreadTurn[] = []
  const seenTurnIds = new Set<string>()

  prependLeadingGovernanceTurns(mergedTurns, seenTurnIds, historicalTurnIds, liveTurns)

  for (const turn of historicalTurns) {
    if (seenTurnIds.has(turn.id) || liveTurnIds.has(turn.id)) {
      continue
    }

    seenTurnIds.add(turn.id)
    mergedTurns.push(turn)
  }

  for (const turn of liveTurns) {
    if (seenTurnIds.has(turn.id)) {
      continue
    }

    seenTurnIds.add(turn.id)
    mergedTurns.push(turn)
  }

  let cacheByLiveTurns = mergedTurnHistoryCache.get(historicalTurns)
  if (!cacheByLiveTurns) {
    cacheByLiveTurns = new WeakMap<ThreadTurn[], ThreadTurn[]>()
    mergedTurnHistoryCache.set(historicalTurns, cacheByLiveTurns)
  }
  getTurnArrayCacheEntry(mergedTurns).turnIndexById = buildTurnIndexById(mergedTurns)
  turnIdSetCache.set(mergedTurns, seenTurnIds)
  cacheByLiveTurns.set(liveTurns, mergedTurns)
  return mergedTurns
}

function prependLeadingGovernanceTurns(
  mergedTurns: ThreadTurn[],
  seenTurnIds: Set<string>,
  historicalTurnIds: Set<string>,
  liveTurns: ThreadTurn[],
) {
  for (const turn of liveTurns) {
    if (!isSyntheticGovernanceTurn(turn) || historicalTurnIds.has(turn.id) || seenTurnIds.has(turn.id)) {
      continue
    }

    seenTurnIds.add(turn.id)
    mergedTurns.push(turn)
  }
}

function buildTurnIndexById(turns: ThreadTurn[]) {
  const indexById = new Map<string, number>()
  for (let index = 0; index < turns.length; index += 1) {
    indexById.set(turns[index].id, index)
  }
  return indexById
}

function getTurnIdSet(turns: ThreadTurn[]) {
  const cached = turnIdSetCache.get(turns)
  if (cached) {
    return cached
  }

  const turnIds = new Set<string>()
  for (let index = 0; index < turns.length; index += 1) {
    turnIds.add(turns[index].id)
  }
  turnIdSetCache.set(turns, turnIds)
  return turnIds
}

function getTurnArrayCacheEntry(turns: ThreadTurn[]) {
  let entry = turnArrayCache.get(turns)
  if (entry) {
    return entry
  }

  entry = {
    combinedOverrideResults: new WeakMap<
      Record<string, ThreadTurn>,
      WeakMap<
        Record<string, Record<string, unknown>>,
        WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>
      >
    >(),
    displayState: {
      nullPendingByThreadId: new Map<string, ThreadPageTurnDisplayStateResult>(),
      pendingByThreadId: new Map<
        string,
        WeakMap<PendingThreadTurn, ThreadPageTurnDisplayStateResult>
      >(),
    },
    itemOverrideResults: new WeakMap<
      Record<string, Record<string, unknown>>,
      WeakMap<Record<string, Record<string, unknown>>, ThreadTurn[]>
    >(),
    pendingInjectedMetrics: new WeakMap<
      PendingThreadTurn,
      import('../threadPageUtils').ThreadDisplayMetrics
    >(),
    pendingStandaloneMetrics: new WeakMap<
      PendingThreadTurn,
      import('../threadPageUtils').ThreadDisplayMetrics
    >(),
    pendingTurnResults: new WeakMap<PendingThreadTurn, ThreadTurn[]>(),
    turnOverrideResultTree: {},
    turnOverrideResults: new WeakMap<Record<string, ThreadTurn>, ThreadTurn[]>(),
  }
  turnArrayCache.set(turns, entry)
  return entry
}

function buildItemIndexById(turn: ThreadTurn) {
  const indexById = new Map<string, number>()
  for (let index = 0; index < turn.items.length; index += 1) {
    const item = turn.items[index]
    const itemId = item && typeof item.id === 'string' ? item.id : ''
    if (!itemId) {
      continue
    }
    indexById.set(itemId, index)
  }
  return indexById
}

function getPendingTurnMetadata(pendingTurn: PendingThreadTurn) {
  let metadata = pendingTurnMetadataCache.get(pendingTurn)
  if (!metadata) {
    metadata = {}
    pendingTurnMetadataCache.set(pendingTurn, metadata)
  }
  return metadata
}

function getPendingTurnMessageKey(turnId: string, pendingTurn: PendingThreadTurn) {
  const metadata = getPendingTurnMetadata(pendingTurn)
  if (metadata.messageKey) {
    return metadata.messageKey
  }

  const messageKey = [
    turnId,
    `pending-user-${pendingTurn.localId}`,
    'user',
    pendingTurn.input.length,
  ].join(':')
  metadata.messageKey = messageKey
  return messageKey
}

function getSingleOverrideItemIds(itemOverridesForTurn: Map<string, Record<string, unknown>>) {
  const cached = singleOverrideItemIdsCache.get(itemOverridesForTurn)
  if (cached) {
    return cached
  }

  const itemIds = Array.from(itemOverridesForTurn.keys())
  singleOverrideItemIdsCache.set(itemOverridesForTurn, itemIds)
  return itemIds
}

function getOverrideTurnIdLookup(turnIds: string[]) {
  const cached = overrideTurnIdLookupCache.get(turnIds)
  if (cached) {
    return cached
  }

  const lookup = new Set(turnIds)
  overrideTurnIdLookupCache.set(turnIds, lookup)
  return lookup
}

function getTurnMetadata(turn: ThreadTurn) {
  let metadata = turnMetadataCache.get(turn)
  if (!metadata) {
    metadata = {}
    turnMetadataCache.set(turn, metadata)
  }
  return metadata
}

function primeTurnMetadata(turn: ThreadTurn) {
  const metadata = getTurnMetadata(turn)
  if (metadata.hasUserMessage !== undefined && metadata.itemIndexById) {
    return
  }
  metadata.hasUserMessage = turn.items.some((item) => item.type === 'userMessage')
  metadata.itemIndexById = buildItemIndexById(turn)
}
