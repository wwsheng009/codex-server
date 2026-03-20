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
