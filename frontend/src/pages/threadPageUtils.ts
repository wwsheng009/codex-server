import type { ThreadTurn } from '../types/api'
import { readTurnPlanItem } from '../lib/turn-plan'
import type {
  ThreadDisplayMetrics,
  ThreadItemDisplayMetrics,
} from './threadPageUtilsTypes'
export type { ThreadDisplayMetrics } from './threadPageUtilsTypes'

const threadQueryRefreshMethods = new Set([
  'thread/started',
  'thread/archived',
  'thread/unarchived',
  'thread/name/updated',
  'thread/compacted',
])

const loadedThreadQueryRefreshMethods = new Set([
  'thread/started',
  'thread/closed',
])

const mcpServerStatusRefreshMethods = new Set([
  'mcpServer/oauthLogin/completed',
  'mcpServer/startupStatus/updated',
])

const runtimeCatalogRefreshMethods = new Set([
  'app/list/updated',
  'mcpServer/oauthLogin/completed',
  'skills/changed',
])

const hookRunRefreshMethods = new Set(['hook/started', 'hook/completed'])
const turnPolicyGovernanceRefreshMethods = new Set(['hook/completed'])

const threadDetailRefreshMethods = new Set([
  ...threadQueryRefreshMethods,
  'item/started',
  'item/completed',
  'turn/plan/updated',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])

const threadDetailStreamingMethods = new Set([
  'turn/plan/updated',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])

const THREAD_VIEWPORT_NEAR_BOTTOM_THRESHOLD_PX = 72
const THREAD_DETAIL_OPEN_STREAM_STALE_EVENT_THRESHOLD_MS = 2_000
const COMPLETED_AGENT_MESSAGE_REVEAL_CHARACTERS_PER_SECOND = 90
const COMPLETED_AGENT_MESSAGE_REVEAL_MIN_DELAY_MS = 480
const COMPLETED_AGENT_MESSAGE_REVEAL_MAX_DELAY_MS = 2_200

const threadDisplayMetricsCache = new WeakMap<ThreadTurn[], ThreadDisplayMetrics>()
const threadTurnDisplayMetricsCache = new WeakMap<ThreadTurn, ThreadDisplayMetrics>()
const threadItemDisplayMetricsCache = new WeakMap<
  Record<string, unknown>,
  ThreadItemDisplayMetrics
>()
const serializedValueLengthCache = new WeakMap<object, number>()
const userMessageTextCache = new WeakMap<Record<string, unknown>, string>()

export function shouldRefreshThreadsForEvent(method?: string) {
  return typeof method === 'string' && threadQueryRefreshMethods.has(method)
}

export function shouldRefreshLoadedThreadsForEvent(method?: string) {
  return typeof method === 'string' && loadedThreadQueryRefreshMethods.has(method)
}

export function shouldRefreshMcpServerStatusForEvent(method?: string) {
  return typeof method === 'string' && mcpServerStatusRefreshMethods.has(method)
}

export function shouldRefreshRuntimeCatalogForEvent(method?: string) {
  return typeof method === 'string' && runtimeCatalogRefreshMethods.has(method)
}

export function shouldRefreshHookRunsForEvent(method?: string) {
  return typeof method === 'string' && hookRunRefreshMethods.has(method)
}

export function shouldRefreshTurnPolicyGovernanceForEvent(method?: string) {
  return typeof method === 'string' && turnPolicyGovernanceRefreshMethods.has(method)
}

export function shouldRefreshThreadDetailForEvent(method?: string) {
  return typeof method === 'string' && threadDetailRefreshMethods.has(method)
}

export function shouldThrottleThreadDetailRefreshForEvent(method?: string) {
  return typeof method === 'string' && threadDetailStreamingMethods.has(method)
}

export function shouldFallbackRefreshThreadDetailDuringOpenStream(
  lastLiveThreadEventAtMs: number | null,
  nowMs: number,
  staleAfterMs = THREAD_DETAIL_OPEN_STREAM_STALE_EVENT_THRESHOLD_MS,
) {
  if (lastLiveThreadEventAtMs === null) {
    return true
  }

  return nowMs - lastLiveThreadEventAtMs >= staleAfterMs
}

export function completedAgentMessageRefreshDelayMs(event: {
  method?: string
  payload?: unknown
}) {
  if (event.method !== 'item/completed') {
    return null
  }

  const item = asObject(asObject(event.payload).item)
  if (stringField(item.type) !== 'agentMessage') {
    return null
  }

  const textLength = stringField(item.text).length
  if (textLength === 0) {
    return null
  }

  const revealDurationMs = Math.ceil(
    (textLength / COMPLETED_AGENT_MESSAGE_REVEAL_CHARACTERS_PER_SECOND) * 1_000,
  )
  return Math.max(
    COMPLETED_AGENT_MESSAGE_REVEAL_MIN_DELAY_MS,
    Math.min(COMPLETED_AGENT_MESSAGE_REVEAL_MAX_DELAY_MS, revealDurationMs + 120),
  )
}

export function shouldRefreshApprovalsForEvent(method?: string, serverRequestId?: string | null) {
  if (typeof serverRequestId === 'string' && serverRequestId.trim() !== '') {
    return true
  }

  return method === 'server/request/resolved'
}

export function isViewportNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  thresholdPx = THREAD_VIEWPORT_NEAR_BOTTOM_THRESHOLD_PX,
) {
  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx
}

export function latestMessageUpdateKey(turns: ThreadTurn[]) {
  return collectThreadDisplayMetrics(turns).threadUnreadUpdateKey
}

export function latestSettledMessageKey(turns: ThreadTurn[]) {
  return collectThreadDisplayMetrics(turns).settledMessageAutoScrollKey
}

export function latestRenderableThreadItemKey(turns: ThreadTurn[]) {
  return collectThreadDisplayMetrics(turns).latestRenderableItemKey
}

export function collectThreadDisplayMetrics(turns: ThreadTurn[]) {
  const cached = threadDisplayMetricsCache.get(turns)
  if (cached) {
    return cached
  }

  const metrics = computeThreadDisplayMetrics(turns)
  threadDisplayMetricsCache.set(turns, metrics)
  return metrics
}

function computeThreadDisplayMetrics(turns: ThreadTurn[]) {
  let latestRenderableItemKey = ''
  let loadedAssistantMessageCount = 0
  let loadedMessageCount = 0
  let loadedUserMessageCount = 0
  let settledMessageAutoScrollKey = ''
  let threadUnreadUpdateKey = ''
  let timelineItemCount = 0

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turnMetrics = collectThreadTurnDisplayMetrics(turns[turnIndex])
    timelineItemCount += turnMetrics.timelineItemCount
    loadedAssistantMessageCount += turnMetrics.loadedAssistantMessageCount
    loadedMessageCount += turnMetrics.loadedMessageCount
    loadedUserMessageCount += turnMetrics.loadedUserMessageCount

    if (!latestRenderableItemKey && turnMetrics.latestRenderableItemKey) {
      latestRenderableItemKey = turnMetrics.latestRenderableItemKey
    }
    if (!settledMessageAutoScrollKey && turnMetrics.settledMessageAutoScrollKey) {
      settledMessageAutoScrollKey = turnMetrics.settledMessageAutoScrollKey
    }
    if (!threadUnreadUpdateKey && turnMetrics.threadUnreadUpdateKey) {
      threadUnreadUpdateKey = turnMetrics.threadUnreadUpdateKey
    }
  }

  return {
    latestRenderableItemKey,
    loadedAssistantMessageCount,
    loadedMessageCount,
    loadedUserMessageCount,
    settledMessageAutoScrollKey,
    threadUnreadUpdateKey,
    timelineItemCount,
  }
}

export function primeThreadDisplayMetrics(turns: ThreadTurn[], metrics: ThreadDisplayMetrics) {
  threadDisplayMetricsCache.set(turns, metrics)
  return metrics
}

export function primeThreadDisplayMetricsForTurnReplacements(
  turns: ThreadTurn[],
  nextTurns: ThreadTurn[],
  replacements: Array<{ turnIndex: number; turnRef: ThreadTurn }>,
) {
  const baseMetrics = collectThreadDisplayMetrics(turns)
  let loadedAssistantMessageCount = baseMetrics.loadedAssistantMessageCount
  let loadedMessageCount = baseMetrics.loadedMessageCount
  let loadedUserMessageCount = baseMetrics.loadedUserMessageCount
  let timelineItemCount = baseMetrics.timelineItemCount
  const replacementMetricsByIndex = new Map<number, ThreadDisplayMetrics>()

  for (const { turnIndex, turnRef } of replacements) {
    const previousTurn = turns[turnIndex]
    const previousMetrics = collectThreadTurnDisplayMetrics(previousTurn)
    const nextMetrics = collectThreadTurnDisplayMetrics(turnRef)
    loadedAssistantMessageCount +=
      nextMetrics.loadedAssistantMessageCount - previousMetrics.loadedAssistantMessageCount
    loadedMessageCount += nextMetrics.loadedMessageCount - previousMetrics.loadedMessageCount
    loadedUserMessageCount +=
      nextMetrics.loadedUserMessageCount - previousMetrics.loadedUserMessageCount
    timelineItemCount += nextMetrics.timelineItemCount - previousMetrics.timelineItemCount
    replacementMetricsByIndex.set(turnIndex, nextMetrics)
  }

  let latestRenderableItemKey = ''
  let settledMessageAutoScrollKey = ''
  let threadUnreadUpdateKey = ''
  for (let turnIndex = nextTurns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turnMetrics =
      replacementMetricsByIndex.get(turnIndex) ??
      collectThreadTurnDisplayMetrics(nextTurns[turnIndex])

    if (!latestRenderableItemKey && turnMetrics.latestRenderableItemKey) {
      latestRenderableItemKey = turnMetrics.latestRenderableItemKey
    }
    if (!settledMessageAutoScrollKey && turnMetrics.settledMessageAutoScrollKey) {
      settledMessageAutoScrollKey = turnMetrics.settledMessageAutoScrollKey
    }
    if (!threadUnreadUpdateKey && turnMetrics.threadUnreadUpdateKey) {
      threadUnreadUpdateKey = turnMetrics.threadUnreadUpdateKey
    }

    if (latestRenderableItemKey && settledMessageAutoScrollKey && threadUnreadUpdateKey) {
      break
    }
  }

  return primeThreadDisplayMetrics(nextTurns, {
    latestRenderableItemKey,
    loadedAssistantMessageCount,
    loadedMessageCount,
    loadedUserMessageCount,
    settledMessageAutoScrollKey,
    threadUnreadUpdateKey,
    timelineItemCount,
  })
}

function collectThreadTurnDisplayMetrics(turn: ThreadTurn) {
  const cached = threadTurnDisplayMetricsCache.get(turn)
  if (cached) {
    return cached
  }

  const metrics = computeThreadTurnDisplayMetrics(turn)
  threadTurnDisplayMetricsCache.set(turn, metrics)
  return metrics
}

function computeThreadTurnDisplayMetrics(turn: ThreadTurn) {
  let latestRenderableItemKey =
    turn.error !== null && turn.error !== undefined
      ? `${turn.id}:error:${serializedValueLength(turn.error)}`
      : ''
  let loadedAssistantMessageCount = 0
  let loadedMessageCount = 0
  let loadedUserMessageCount = 0
  let settledMessageAutoScrollKey = ''
  let threadUnreadUpdateKey = ''

  for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
    const item = turn.items[itemIndex]
    const itemMetrics = collectThreadItemDisplayMetrics(item)
    const itemKeyPrefix = `${turn.id}:${threadItemId(item, itemIndex)}`
    loadedAssistantMessageCount += itemMetrics.loadedAssistantMessageCount
    loadedMessageCount += itemMetrics.loadedMessageCount
    loadedUserMessageCount += itemMetrics.loadedUserMessageCount

    if (!threadUnreadUpdateKey && itemMetrics.threadUnreadKeySuffix) {
      threadUnreadUpdateKey = `${itemKeyPrefix}:${itemMetrics.threadUnreadKeySuffix}`
    }
    if (!settledMessageAutoScrollKey && itemMetrics.settledMessageKeySuffix) {
      settledMessageAutoScrollKey = `${itemKeyPrefix}:${itemMetrics.settledMessageKeySuffix}`
    }
    if (!latestRenderableItemKey && itemMetrics.renderableKeySuffix) {
      latestRenderableItemKey = `${itemKeyPrefix}:${itemMetrics.renderableKeySuffix}`
    }
  }

  return {
    latestRenderableItemKey,
    loadedAssistantMessageCount,
    loadedMessageCount,
    loadedUserMessageCount,
    settledMessageAutoScrollKey,
    threadUnreadUpdateKey,
    timelineItemCount: turn.items.length,
  }
}

function userMessageText(item: Record<string, unknown>) {
  const cached = userMessageTextCache.get(item)
  if (cached !== undefined) {
    return cached
  }

  if (!Array.isArray(item.content)) {
    return ''
  }

  const text = item.content
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return ''
      }

      return typeof (entry as Record<string, unknown>).text === 'string'
        ? String((entry as Record<string, unknown>).text)
        : ''
    })
    .filter(Boolean)
    .join('\n')
  userMessageTextCache.set(item, text)
  return text
}

function collectThreadItemDisplayMetrics(item: Record<string, unknown>) {
  const cached = threadItemDisplayMetricsCache.get(item)
  if (cached) {
    return cached
  }

  const metrics = computeThreadItemDisplayMetrics(item)
  threadItemDisplayMetricsCache.set(item, metrics)
  return metrics
}

function computeThreadItemDisplayMetrics(item: Record<string, unknown>) {
  const type = stringField(item.type)

  switch (type) {
    case 'agentMessage': {
      const text = stringField(item.text)
      const phase = stringField(item.phase)
      const hasVisibleStreamingBubble = phase === 'streaming'
      const messageKeySuffix =
        text.trim() || hasVisibleStreamingBubble
          ? phase === 'streaming'
            ? `agent:streaming:${text.length}`
            : `agent:${text.length}`
          : ''

      return {
        loadedAssistantMessageCount: 1,
        loadedMessageCount: 1,
        loadedUserMessageCount: 0,
        renderableKeySuffix: messageKeySuffix,
        settledMessageKeySuffix: phase !== 'streaming' ? messageKeySuffix : '',
        threadUnreadKeySuffix: messageKeySuffix,
      }
    }
    case 'userMessage': {
      const text = userMessageText(item)
      const messageKeySuffix = text.trim() ? `user:${text.length}` : ''

      return {
        loadedAssistantMessageCount: 0,
        loadedMessageCount: 1,
        loadedUserMessageCount: 1,
        renderableKeySuffix: messageKeySuffix,
        settledMessageKeySuffix: messageKeySuffix,
        threadUnreadKeySuffix: messageKeySuffix,
      }
    }
    default:
      return {
        loadedAssistantMessageCount: 0,
        loadedMessageCount: 0,
        loadedUserMessageCount: 0,
        renderableKeySuffix: renderableThreadItemKeySuffix(item),
        settledMessageKeySuffix: '',
        threadUnreadKeySuffix: '',
      }
  }
}

function renderableThreadItemKeySuffix(item: Record<string, unknown>) {
  const type = stringField(item.type)

  switch (type) {
    case 'userMessage': {
      const text = userMessageText(item)
      return text.trim() ? `user:${text.length}` : ''
    }
    case 'agentMessage': {
      const text = stringField(item.text)
      const phase = stringField(item.phase)
      const hasVisibleStreamingBubble = phase === 'streaming'
      if (!text.trim() && !hasVisibleStreamingBubble) {
        return ''
      }

      return phase === 'streaming'
        ? `agent:streaming:${text.length}`
        : `agent:${text.length}`
    }
    case 'commandExecution': {
      const command = stringField(item.command)
      const output = stringField(item.aggregatedOutput)
      const outputLineCount = numberField(item.outputLineCount) ?? 0
      const status = stringField(item.status)
      if (!command && !output && !status) {
        return ''
      }

      return `command:${status}:${command.length}:${output.length}:${outputLineCount}`
    }
    case 'plan': {
      const text = stringField(item.text)
      return text.trim() ? `plan:${text.length}` : ''
    }
    case 'turnPlan': {
      const turnPlan = readTurnPlanItem(item)
      if (!turnPlan) {
        return ''
      }

      const explanationLength = turnPlan.explanation?.length ?? 0
      const totalStepLength = turnPlan.steps.reduce((sum, entry) => sum + entry.step.length, 0)
      return explanationLength || turnPlan.steps.length
        ? `turnPlan:${turnPlan.status}:${explanationLength}:${turnPlan.steps.length}:${totalStepLength}`
        : ''
    }
    case 'fileChange': {
      const changeCount = Array.isArray(item.changes) ? item.changes.length : 0
      return changeCount > 0 ? `file:${changeCount}` : ''
    }
    case 'reasoning': {
      const summary = Array.isArray(item.summary)
        ? item.summary.filter((entry): entry is string => typeof entry === 'string').join('\n').trim()
        : ''
      const content = Array.isArray(item.content)
        ? item.content.filter((entry): entry is string => typeof entry === 'string').join('\n').trim()
        : ''
      if (!summary && !content) {
        return ''
      }

      return `reasoning:${summary.length}:${content.length}`
    }
    default: {
      const text = stringField(item.text) || stringField(item.message)
      const status = stringField(item.status)
      const phase = stringField(item.phase)
      const snapshotLength = serializedValueLength(item)
      if (!text.trim() && !status && !phase && snapshotLength === 0) {
        return ''
      }

      return `${type || 'item'}:${status}:${phase}:${text.length}:${snapshotLength}`
    }
  }
}

function threadItemId(item: Record<string, unknown>, itemIndex: number) {
  return String(item.id ?? itemIndex)
}

function serializedValueLength(value: unknown) {
  if (typeof value === 'string') {
    return value.length
  }

  if (typeof value === 'object' && value !== null) {
    const cached = serializedValueLengthCache.get(value)
    if (typeof cached === 'number') {
      return cached
    }

    try {
      const length = JSON.stringify(value)?.length ?? 0
      serializedValueLengthCache.set(value, length)
      return length
    } catch {
      return 0
    }
  }

  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asObject(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}
