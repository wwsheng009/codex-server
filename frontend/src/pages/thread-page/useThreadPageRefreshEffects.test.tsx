// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react'
import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n/runtime'

let useThreadPageRefreshEffects: typeof import('./useThreadPageRefreshEffects').useThreadPageRefreshEffects

function createBaseInput() {
  return {
    activePendingTurn: null as {
      phase: 'sending' | 'waiting'
      submittedAt: string
      turnId?: string
    } | null,
    contextCompactionFeedback: null,
    isDocumentVisible: true,
    isThreadPinnedToLatest: true,
    isThreadViewportInteracting: false,
    queryClient: {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      setQueryData: vi.fn(),
    },
    selectedThreadEvents: [] as Array<{ method: string; payload?: unknown; ts: string }>,
    selectedThreadId: 'thread-1',
    setContextCompactionFeedback: vi.fn(),
    streamState: 'idle',
    threadDetailRefreshTimerRef: { current: null as number | null },
    threadListRefreshTimerRef: { current: null as number | null },
    workspaceActivityEvents: [],
    workspaceId: 'ws-1',
  }
}

describe('useThreadPageRefreshEffects', () => {
  beforeAll(async () => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
    ;({ useThreadPageRefreshEffects } = await import('./useThreadPageRefreshEffects'))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('schedules a thread detail refresh after item completion when the stream is not open', async () => {
    vi.useFakeTimers()
    const input = createBaseInput()
    input.selectedThreadEvents = [
      {
        method: 'item/completed',
        ts: '2026-04-15T02:00:21.954Z',
      },
    ]

    renderHook((props) => useThreadPageRefreshEffects(props), {
      initialProps: input,
    })

    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })
  })

  it('avoids immediate thread detail refresh for agent deltas during an open stream but falls back once the stream goes stale', async () => {
    vi.useFakeTimers()
    const input = createBaseInput()
    input.activePendingTurn = {
      phase: 'waiting',
      submittedAt: '2026-04-15T02:00:00.000Z',
      turnId: 'turn-1',
    }
    input.streamState = 'open'
    input.selectedThreadEvents = [
      {
        method: 'item/agentMessage/delta',
        ts: '2026-04-15T02:00:16.886Z',
      },
    ]

    renderHook((props) => useThreadPageRefreshEffects(props), {
      initialProps: input,
    })

    await act(async () => {
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })

    await act(async () => {
      vi.advanceTimersByTime(3_500)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })
  })

  it('throttles a thread detail refresh for command output deltas during an open stream', async () => {
    vi.useFakeTimers()
    const input = createBaseInput()
    input.activePendingTurn = {
      phase: 'waiting',
      submittedAt: '2026-04-15T02:00:00.000Z',
      turnId: 'turn-1',
    }
    input.streamState = 'open'
    input.selectedThreadEvents = [
      {
        method: 'item/commandExecution/outputDelta',
        ts: '2026-04-15T02:00:17.200Z',
      },
    ]

    renderHook((props) => useThreadPageRefreshEffects(props), {
      initialProps: input,
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })
  })

  it('throttles a thread detail refresh for command lifecycle placeholders during an open stream', async () => {
    vi.useFakeTimers()
    const input = createBaseInput()
    input.activePendingTurn = {
      phase: 'waiting',
      submittedAt: '2026-04-15T02:00:00.000Z',
      turnId: 'turn-1',
    }
    input.streamState = 'open'
    input.selectedThreadEvents = [
      {
        method: 'item/started',
        payload: {
          item: {
            id: 'cmd-1',
            type: 'commandExecution',
          },
        },
        ts: '2026-04-15T02:00:17.200Z',
      },
    ]

    renderHook((props) => useThreadPageRefreshEffects(props), {
      initialProps: input,
    })

    await act(async () => {
      vi.advanceTimersByTime(400)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })
  })

  it('keeps hook lifecycle events on their side queries without refreshing thread detail during an open stream', async () => {
    vi.useFakeTimers()
    const input = createBaseInput()
    input.streamState = 'open'
    input.selectedThreadEvents = [
      {
        method: 'hook/completed',
        payload: {
          run: {
            id: 'hook-1',
            turnId: 'turn-1',
            eventName: 'PostToolUse',
            status: 'completed',
          },
        },
        ts: '2026-04-15T02:00:17.200Z',
      },
    ]

    renderHook((props) => useThreadPageRefreshEffects(props), {
      initialProps: input,
    })

    await act(async () => {
      vi.advanceTimersByTime(100)
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['hook-runs', 'ws-1', 'thread-1'],
    })
    expect(input.queryClient.invalidateQueries).not.toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })
  })

  it('forces a thread detail refresh when realtime closes after an open stream', async () => {
    vi.useFakeTimers()
    const input = createBaseInput()
    input.streamState = 'open'

    const { rerender } = renderHook((props) => useThreadPageRefreshEffects(props), {
      initialProps: input,
    })

    input.streamState = 'closed'
    rerender(input)

    await act(async () => {
      await Promise.resolve()
    })

    expect(input.queryClient.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['thread-detail', 'ws-1', 'thread-1'],
    })
  })
})

