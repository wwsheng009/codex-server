import { describe, expect, it } from 'vitest'

import {
  isViewportNearBottom,
  latestMessageUpdateKey,
  latestRenderableThreadItemKey,
  latestSettledMessageKey,
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

  it('tracks only settled text messages for auto-scroll follow decisions', () => {
    expect(
      latestSettledMessageKey([
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'user-1',
              type: 'userMessage',
              content: [{ type: 'inputText', text: 'Inspect the tool rows' }],
            },
            {
              id: 'tool-1',
              type: 'commandExecution',
              command: 'git status',
              status: 'inProgress',
            },
            {
              id: 'assistant-1',
              type: 'agentMessage',
              text: 'Streaming reply',
              phase: 'streaming',
            },
          ],
        },
      ]),
    ).toBe('turn-1:user-1:user:21')

    expect(
      latestSettledMessageKey([
        {
          id: 'turn-2',
          status: 'completed',
          items: [
            {
              id: 'assistant-2',
              type: 'agentMessage',
              text: 'Final reply',
            },
          ],
        },
      ]),
    ).toBe('turn-2:assistant-2:agent:11')
  })

  it('tracks message updates for streaming assistant replies', () => {
    expect(
      latestMessageUpdateKey([
        {
          id: 'turn-3',
          status: 'inProgress',
          items: [
            {
              id: 'assistant-3',
              type: 'agentMessage',
              text: 'Streaming reply',
              phase: 'streaming',
            },
          ],
        },
      ]),
    ).toBe('turn-3:assistant-3:agent:streaming:15')
  })

  it('tracks the latest renderable timeline item and ignores hidden reasoning deltas', () => {
    expect(
      latestRenderableThreadItemKey([
        {
          id: 'turn-4',
          status: 'inProgress',
          items: [
            {
              id: 'command-1',
              type: 'commandExecution',
              command: 'npm test',
              aggregatedOutput: 'line 1',
              status: 'inProgress',
            },
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: ['internal summary'],
              content: ['internal detail'],
            },
          ],
        },
      ]),
    ).toBe('turn-4:command-1:command:inProgress:8:6')
  })
})
