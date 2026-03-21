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

export function latestSettledMessageKey(turns: ThreadTurn[]) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]

    for (let itemIndex = turn.items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turn.items[itemIndex]
      const type = typeof item.type === 'string' ? item.type : ''

      if (type === 'agentMessage') {
        const text = typeof item.text === 'string' ? item.text : ''
        const phase = typeof item.phase === 'string' ? item.phase : ''
        if (!text.trim() || phase === 'streaming') {
          continue
        }

        return `${turn.id}:${String(item.id ?? itemIndex)}:agent:${text.length}`
      }

      if (type === 'userMessage') {
        const text = userMessageText(item)
        if (!text.trim()) {
          continue
        }

        return `${turn.id}:${String(item.id ?? itemIndex)}:user:${text.length}`
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
