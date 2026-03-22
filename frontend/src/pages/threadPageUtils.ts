import type { ThreadTurn } from '../types/api'

const threadQueryRefreshMethods = new Set([
  'thread/started',
  'thread/status/changed',
  'thread/archived',
  'thread/unarchived',
  'thread/closed',
  'thread/name/updated',
  'thread/compacted',
  'turn/started',
  'turn/completed',
])

const threadDetailRefreshMethods = new Set([
  ...threadQueryRefreshMethods,
  'item/started',
  'item/completed',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])

const threadDetailStreamingMethods = new Set([
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])

const THREAD_VIEWPORT_NEAR_BOTTOM_THRESHOLD_PX = 72

export function shouldRefreshThreadsForEvent(method?: string) {
  return typeof method === 'string' && threadQueryRefreshMethods.has(method)
}

export function shouldRefreshThreadDetailForEvent(method?: string) {
  return typeof method === 'string' && threadDetailRefreshMethods.has(method)
}

export function shouldThrottleThreadDetailRefreshForEvent(method?: string) {
  return typeof method === 'string' && threadDetailStreamingMethods.has(method)
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
  return latestThreadMessageKey(turns, { includeStreamingAgentMessages: true })
}

export function latestSettledMessageKey(turns: ThreadTurn[]) {
  return latestThreadMessageKey(turns, { includeStreamingAgentMessages: false })
}

export function latestRenderableThreadItemKey(turns: ThreadTurn[]) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]

    if (turn.error !== null && turn.error !== undefined) {
      return `${turn.id}:error:${serializedValueLength(turn.error)}`
    }

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex]
      const key = renderableThreadItemKey(turn.id, item, itemIndex)
      if (key) {
        return key
      }
    }
  }

  return ''
}

function latestThreadMessageKey(
  turns: ThreadTurn[],
  options: { includeStreamingAgentMessages: boolean },
) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex]
      const type = stringField(item.type)

      if (type === 'agentMessage') {
        const text = stringField(item.text)
        const phase = stringField(item.phase)
        const hasVisibleStreamingBubble = phase === 'streaming'
        if (!text.trim() && !hasVisibleStreamingBubble) {
          continue
        }
        if (phase === 'streaming' && !options.includeStreamingAgentMessages) {
          continue
        }

        return phase === 'streaming'
          ? `${turn.id}:${threadItemId(item, itemIndex)}:agent:streaming:${text.length}`
          : `${turn.id}:${threadItemId(item, itemIndex)}:agent:${text.length}`
      }

      if (type === 'userMessage') {
        const text = userMessageText(item)
        if (!text.trim()) {
          continue
        }

        return `${turn.id}:${threadItemId(item, itemIndex)}:user:${text.length}`
      }
    }
  }

  return ''
}

function userMessageText(item: Record<string, unknown>) {
  if (!Array.isArray(item.content)) {
    return ''
  }

  return item.content
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
}

function renderableThreadItemKey(turnId: string, item: Record<string, unknown>, itemIndex: number) {
  const type = stringField(item.type)
  const itemId = threadItemId(item, itemIndex)

  switch (type) {
    case 'userMessage': {
      const text = userMessageText(item)
      return text.trim() ? `${turnId}:${itemId}:user:${text.length}` : ''
    }
    case 'agentMessage': {
      const text = stringField(item.text)
      const phase = stringField(item.phase)
      const hasVisibleStreamingBubble = phase === 'streaming'
      if (!text.trim() && !hasVisibleStreamingBubble) {
        return ''
      }

      return phase === 'streaming'
        ? `${turnId}:${itemId}:agent:streaming:${text.length}`
        : `${turnId}:${itemId}:agent:${text.length}`
    }
    case 'commandExecution': {
      const command = stringField(item.command)
      const output = stringField(item.aggregatedOutput)
      const status = stringField(item.status)
      if (!command && !output && !status) {
        return ''
      }

      return `${turnId}:${itemId}:command:${status}:${command.length}:${output.length}`
    }
    case 'plan': {
      const text = stringField(item.text)
      return text.trim() ? `${turnId}:${itemId}:plan:${text.length}` : ''
    }
    case 'fileChange': {
      const changeCount = Array.isArray(item.changes) ? item.changes.length : 0
      return changeCount > 0 ? `${turnId}:${itemId}:file:${changeCount}` : ''
    }
    case 'reasoning':
      return ''
    default: {
      const text = stringField(item.text) || stringField(item.message)
      const status = stringField(item.status)
      const phase = stringField(item.phase)
      const snapshotLength = serializedValueLength(item)
      if (!text.trim() && !status && !phase && snapshotLength === 0) {
        return ''
      }

      return `${turnId}:${itemId}:${type || 'item'}:${status}:${phase}:${text.length}:${snapshotLength}`
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

  try {
    return JSON.stringify(value)?.length ?? 0
  } catch {
    return 0
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}
