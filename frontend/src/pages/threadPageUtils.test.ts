import { describe, expect, it } from 'vitest'

import {
  completedAgentMessageRefreshDelayMs,
  collectThreadDisplayMetrics,
  isViewportNearBottom,
  latestMessageUpdateKey,
  latestRenderableThreadItemKey,
  latestSettledMessageKey,
  primeThreadDisplayMetrics,
  primeThreadDisplayMetricsForTurnReplacements,
  shouldRefreshApprovalsForEvent,
  shouldFallbackRefreshThreadDetailDuringOpenStream,
  shouldRefreshLoadedThreadsForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from './threadPageUtils'

describe('threadPageUtils', () => {
  it('refreshes thread list only for structural thread mutations', () => {
    expect(shouldRefreshThreadsForEvent('thread/status/changed')).toBe(false)
    expect(shouldRefreshThreadsForEvent('thread/compacted')).toBe(true)
    expect(shouldRefreshThreadsForEvent('thread/closed')).toBe(false)
    expect(shouldRefreshThreadsForEvent('turn/started')).toBe(false)
    expect(shouldRefreshThreadsForEvent('turn/completed')).toBe(false)
    expect(shouldRefreshThreadsForEvent('item/agentMessage/delta')).toBe(false)
  })

  it('refreshes loaded thread ids only for load-state changes', () => {
    expect(shouldRefreshLoadedThreadsForEvent('thread/started')).toBe(true)
    expect(shouldRefreshLoadedThreadsForEvent('thread/closed')).toBe(true)
    expect(shouldRefreshLoadedThreadsForEvent('thread/name/updated')).toBe(false)
    expect(shouldRefreshLoadedThreadsForEvent('turn/completed')).toBe(false)
  })

  it('marks item deltas for thread detail refresh', () => {
    expect(shouldRefreshThreadDetailForEvent('item/agentMessage/delta')).toBe(true)
    expect(shouldRefreshThreadDetailForEvent('turn/plan/updated')).toBe(true)
    expect(shouldRefreshThreadDetailForEvent('item/completed')).toBe(true)
    expect(shouldRefreshThreadDetailForEvent('workspace/connected')).toBe(false)
  })

  it('throttles only streaming item events', () => {
    expect(shouldThrottleThreadDetailRefreshForEvent('item/agentMessage/delta')).toBe(true)
    expect(shouldThrottleThreadDetailRefreshForEvent('turn/plan/updated')).toBe(true)
    expect(shouldThrottleThreadDetailRefreshForEvent('item/reasoning/textDelta')).toBe(true)
    expect(shouldThrottleThreadDetailRefreshForEvent('turn/completed')).toBe(false)
  })

  it('only falls back to thread-detail refresh when the open stream has gone stale', () => {
    expect(shouldFallbackRefreshThreadDetailDuringOpenStream(null, 10_000)).toBe(true)
    expect(shouldFallbackRefreshThreadDetailDuringOpenStream(9_000, 10_500)).toBe(false)
    expect(shouldFallbackRefreshThreadDetailDuringOpenStream(8_000, 10_500)).toBe(true)
  })

  it('delays snapshot refresh long enough for completed-only agent messages to animate', () => {
    expect(
      completedAgentMessageRefreshDelayMs({
        method: 'item/completed',
        payload: {
          item: {
            type: 'agentMessage',
            text: 'short reply',
          },
        },
      }),
    ).toBe(480)

    expect(
      completedAgentMessageRefreshDelayMs({
        method: 'item/completed',
        payload: {
          item: {
            type: 'agentMessage',
            text: 'x'.repeat(180),
          },
        },
      }),
    ).toBeGreaterThan(1_900)
  })

  it('does not delay snapshot refresh for non-agent or empty completion events', () => {
    expect(
      completedAgentMessageRefreshDelayMs({
        method: 'item/completed',
        payload: {
          item: {
            type: 'commandExecution',
            aggregatedOutput: 'done',
          },
        },
      }),
    ).toBeNull()

    expect(
      completedAgentMessageRefreshDelayMs({
        method: 'item/completed',
        payload: {
          item: {
            type: 'agentMessage',
            text: '',
          },
        },
      }),
    ).toBeNull()

    expect(
      completedAgentMessageRefreshDelayMs({
        method: 'item/agentMessage/delta',
        payload: {
          delta: 'hello',
        },
      }),
    ).toBeNull()
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

  it('tracks the latest renderable timeline item and ignores empty reasoning items', () => {
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
              aggregatedOutput: 'line 1\n…\nline 1200',
              outputLineCount: 1200,
              status: 'inProgress',
            },
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: [],
              content: [],
            },
          ],
        },
      ]),
    ).toBe('turn-4:command-1:command:inProgress:8:18:1200')
  })

  it('treats status-only command placeholders as renderable timeline items', () => {
    expect(
      latestRenderableThreadItemKey([
        {
          id: 'turn-4b',
          status: 'inProgress',
          items: [
            {
              id: 'command-1',
              type: 'commandExecution',
              status: 'inProgress',
            },
          ],
        },
      ]),
    ).toBe('turn-4b:command-1:command:inProgress:0:0:0')
  })

  it('treats populated reasoning items as renderable timeline entries', () => {
    expect(
      latestRenderableThreadItemKey([
        {
          id: 'turn-5',
          status: 'inProgress',
          items: [
            {
              id: 'command-1',
              type: 'commandExecution',
              command: 'npm test',
              aggregatedOutput: 'line 1\n…\nline 1200',
              outputLineCount: 1200,
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
    ).toBe('turn-5:reasoning-1:reasoning:16:15')
  })

  it('treats turn plan status items as renderable timeline entries', () => {
    expect(
      latestRenderableThreadItemKey([
        {
          id: 'turn-5b',
          status: 'inProgress',
          items: [
            {
              id: 'turn-plan-turn-5b',
              type: 'turnPlan',
              explanation: 'Stabilize the event flow',
              status: 'inProgress',
              steps: [
                {
                  step: 'Inspect runtime events',
                  status: 'completed',
                },
                {
                  step: 'Render status badges',
                  status: 'inProgress',
                },
              ],
            },
          ],
        },
      ]),
    ).toBe('turn-5b:turn-plan-turn-5b:turnPlan:inProgress:24:2:42')
  })

  it('collects thread display metrics in a single pass', () => {
    const turns = [
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
            id: 'assistant-1',
            type: 'agentMessage',
            text: 'Streaming reply',
            phase: 'streaming',
          },
        ],
      },
      {
        id: 'turn-2',
        status: 'completed',
        items: [
          {
            id: 'command-1',
            type: 'commandExecution',
            command: 'npm test',
            aggregatedOutput: 'line 1\n…\nline 1200',
            outputLineCount: 1200,
            status: 'completed',
          },
          {
            id: 'user-2',
            type: 'userMessage',
            content: [{ type: 'inputText', text: 'Done?' }],
          },
        ],
        error: { message: 'boom' },
      },
    ]

    const metrics = collectThreadDisplayMetrics(turns)
    expect(metrics).toMatchObject({
      latestRenderableItemKey: 'turn-2:error:18',
      loadedAssistantMessageCount: 1,
      loadedMessageCount: 3,
      loadedUserMessageCount: 2,
      settledMessageAutoScrollKey: 'turn-2:user-2:user:5',
      threadUnreadUpdateKey: 'turn-2:user-2:user:5',
      timelineItemCount: 4,
    })
    expect(collectThreadDisplayMetrics(turns)).toBe(metrics)
  })

  it('reuses primed display metrics without recomputing', () => {
    const turns = [
      {
        id: 'turn-1',
        status: 'completed',
        items: [],
      },
    ]
    const primed = primeThreadDisplayMetrics(turns, {
      latestRenderableItemKey: 'cached',
      loadedAssistantMessageCount: 0,
      loadedMessageCount: 0,
      loadedUserMessageCount: 0,
      settledMessageAutoScrollKey: '',
      threadUnreadUpdateKey: '',
      timelineItemCount: 0,
    })

    expect(collectThreadDisplayMetrics(turns)).toBe(primed)
  })

  it('reuses cached turn metrics across new array shells with the same turn objects', () => {
    let textReadCount = 0
    const item: Record<string, unknown> = {
      id: 'assistant-1',
      phase: 'streaming',
      type: 'agentMessage',
    }
    Object.defineProperty(item, 'text', {
      configurable: true,
      enumerable: true,
      get() {
        textReadCount += 1
        return 'Streaming reply'
      },
    })
    const turn = {
      id: 'turn-1',
      status: 'inProgress',
      items: [item],
    }

    const firstMetrics = collectThreadDisplayMetrics([turn])
    const readsAfterFirstPass = textReadCount
    const secondMetrics = collectThreadDisplayMetrics([turn])

    expect(secondMetrics).toEqual(firstMetrics)
    expect(textReadCount).toBe(readsAfterFirstPass)
  })

  it('reuses cached item metrics across new turn objects with the same item objects', () => {
    let textReadCount = 0
    const item: Record<string, unknown> = {
      id: 'assistant-1',
      phase: 'streaming',
      type: 'agentMessage',
    }
    Object.defineProperty(item, 'text', {
      configurable: true,
      enumerable: true,
      get() {
        textReadCount += 1
        return 'Streaming reply'
      },
    })
    const firstTurn = {
      id: 'turn-1',
      status: 'inProgress',
      items: [item],
    }
    const secondTurn = {
      id: 'turn-1',
      status: 'inProgress',
      items: [item],
    }

    const firstMetrics = collectThreadDisplayMetrics([firstTurn])
    const readsAfterFirstPass = textReadCount
    const secondMetrics = collectThreadDisplayMetrics([secondTurn])

    expect(secondMetrics).toEqual(firstMetrics)
    expect(textReadCount).toBe(readsAfterFirstPass)
  })

  it('primes metrics for replacement arrays without requiring a follow-up recompute', () => {
    let textReadCount = 0
    const baseTurn = {
      id: 'turn-1',
      status: 'completed',
      items: [],
    }
    const item: Record<string, unknown> = {
      id: 'assistant-1',
      phase: 'streaming',
      type: 'agentMessage',
    }
    Object.defineProperty(item, 'text', {
      configurable: true,
      enumerable: true,
      get() {
        textReadCount += 1
        return 'Streaming reply'
      },
    })
    const nextTurn = {
      id: 'turn-1',
      status: 'inProgress',
      items: [item],
    }
    const baseTurns = [baseTurn]
    const nextTurns = [nextTurn]

    const primed = primeThreadDisplayMetricsForTurnReplacements(baseTurns, nextTurns, [
      {
        turnIndex: 0,
        turnRef: nextTurn,
      },
    ])
    const readsAfterPrime = textReadCount

    expect(collectThreadDisplayMetrics(nextTurns)).toBe(primed)
    expect(textReadCount).toBe(readsAfterPrime)
  })
})
