import { describe, expect, it } from 'vitest'

import {
  isViewportNearBottom,
  shouldRefreshApprovalsForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from './threadPageUtils'

describe('threadPageUtils', () => {
  it('marks turn lifecycle events for thread list refresh', () => {
    expect(shouldRefreshThreadsForEvent('turn/started')).toBe(true)
    expect(shouldRefreshThreadsForEvent('turn/completed')).toBe(true)
    expect(shouldRefreshThreadsForEvent('item/agentMessage/delta')).toBe(false)
  })

  it('marks item deltas for thread detail refresh', () => {
    expect(shouldRefreshThreadDetailForEvent('item/agentMessage/delta')).toBe(true)
    expect(shouldRefreshThreadDetailForEvent('item/completed')).toBe(true)
    expect(shouldRefreshThreadDetailForEvent('workspace/connected')).toBe(false)
  })

  it('throttles only streaming item events', () => {
    expect(shouldThrottleThreadDetailRefreshForEvent('item/agentMessage/delta')).toBe(true)
    expect(shouldThrottleThreadDetailRefreshForEvent('item/reasoning/textDelta')).toBe(true)
    expect(shouldThrottleThreadDetailRefreshForEvent('turn/completed')).toBe(false)
  })

  it('refreshes approvals for server requests and resolutions', () => {
    expect(shouldRefreshApprovalsForEvent('item/tool/requestUserInput', 'req_123')).toBe(true)
    expect(shouldRefreshApprovalsForEvent('server/request/resolved', null)).toBe(true)
    expect(shouldRefreshApprovalsForEvent('turn/completed', null)).toBe(false)
  })

  it('treats the thread viewport as pinned when it is close to the bottom', () => {
    expect(isViewportNearBottom(430, 1_000, 520)).toBe(true)
    expect(isViewportNearBottom(320, 1_000, 520)).toBe(false)
  })
})
