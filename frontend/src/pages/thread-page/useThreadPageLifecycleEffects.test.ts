import { describe, expect, it } from 'vitest'

import {
  findMatchingLiveTurnForPendingTurn,
  pendingTurnMatchesLiveTurn,
  resolveThreadPageLifecycleSelection,
} from './useThreadPageLifecycleEffects'

describe('resolveThreadPageLifecycleSelection', () => {
  it('does not redirect away from a route thread before the thread list has loaded', () => {
    expect(
      resolveThreadPageLifecycleSelection({
        currentThreads: [],
        isThreadDetailLoading: true,
        isThreadsLoaded: false,
        latestThreadDetailId: undefined,
        routeThreadId: 'thread-route',
        selectedThreadId: 'thread-route',
        workspaceId: 'ws-1',
      }),
    ).toBeNull()
  })

  it('keeps the explicit route thread selected while its detail is still loading', () => {
    expect(
      resolveThreadPageLifecycleSelection({
        currentThreads: [{ id: 'thread-a' }, { id: 'thread-b' }],
        isThreadDetailLoading: true,
        isThreadsLoaded: true,
        latestThreadDetailId: undefined,
        routeThreadId: 'thread-route',
        selectedThreadId: 'thread-route',
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      navigateTo: undefined,
      nextThreadId: 'thread-route',
    })
  })

  it('falls back to the first thread once the explicit route thread is confirmed absent', () => {
    expect(
      resolveThreadPageLifecycleSelection({
        currentThreads: [{ id: 'thread-a' }, { id: 'thread-b' }],
        isThreadDetailLoading: false,
        isThreadsLoaded: true,
        latestThreadDetailId: undefined,
        routeThreadId: 'thread-route',
        selectedThreadId: 'thread-route',
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      navigateTo: '/workspaces/ws-1/threads/thread-a',
      nextThreadId: 'thread-a',
    })
  })

  it('returns to the workspace list when the current workspace is confirmed absent', () => {
    expect(
      resolveThreadPageLifecycleSelection({
        currentThreads: [],
        isThreadDetailLoading: false,
        isThreadsLoaded: false,
        latestThreadDetailId: undefined,
        routeThreadId: 'thread-route',
        selectedThreadId: 'thread-route',
        workspaceId: 'ws-missing',
        workspaceMissing: true,
      }),
    ).toEqual({
      navigateTo: '/workspaces',
      nextThreadId: undefined,
    })
  })

  it('returns to the workspace root when the list is loaded and there are no threads', () => {
    expect(
      resolveThreadPageLifecycleSelection({
        currentThreads: [],
        isThreadDetailLoading: false,
        isThreadsLoaded: true,
        latestThreadDetailId: undefined,
        routeThreadId: 'thread-route',
        selectedThreadId: 'thread-route',
        workspaceId: 'ws-1',
      }),
    ).toEqual({
      navigateTo: '/workspaces/ws-1',
      nextThreadId: undefined,
    })
  })
})

describe('pending turn live matching', () => {
  it('matches a pending turn by server turn id', () => {
    expect(
      pendingTurnMatchesLiveTurn(
        {
          phase: 'waiting',
          submittedAt: '2026-05-12T00:00:00.000Z',
          turnId: 'turn-1',
        },
        {
          id: 'turn-1',
        },
      ),
    ).toBe(true)
  })

  it('matches a pending turn by client turn request id before HTTP turn id is known', () => {
    const match = findMatchingLiveTurnForPendingTurn(
      {
        clientTurnRequestId: 'client-turn-1',
        phase: 'sending',
        submittedAt: '2026-05-12T00:00:00.000Z',
      },
      [
        {
          clientTurnRequestId: 'client-turn-1',
          id: 'turn-from-stream',
        },
      ],
    )

    expect(match?.id).toBe('turn-from-stream')
  })

  it('does not match unrelated client turn request ids', () => {
    expect(
      findMatchingLiveTurnForPendingTurn(
        {
          clientTurnRequestId: 'client-turn-1',
          phase: 'sending',
          submittedAt: '2026-05-12T00:00:00.000Z',
        },
        [
          {
            clientTurnRequestId: 'client-turn-2',
            id: 'turn-from-stream',
          },
        ],
      ),
    ).toBeUndefined()
  })
})
