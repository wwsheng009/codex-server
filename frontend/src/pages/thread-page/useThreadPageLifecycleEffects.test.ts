import { describe, expect, it } from 'vitest'

import { resolveThreadPageLifecycleSelection } from './useThreadPageLifecycleEffects'

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
