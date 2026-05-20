import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n/runtime'
import { useSessionStore } from '../stores/session-store'
import { buildThreadStoreKey } from '../stores/session-store-utils'
import type { ServerEvent } from '../types/api'
import type {
  WorkspaceStream,
  WorkspaceStreamLocalDiagnostics,
  WorkspaceStreamManagerDiagnostics,
} from './useWorkspaceStreamTypes'
import {
  buildWorkspaceStreamRecoveryNoticeFromDiagnostics,
  getWorkspaceStreamManagerDiagnosticsSnapshot,
  handleWorkspaceStreamBroadcastMessage,
  handleWorkspaceStreamEvent,
  subscribeWorkspaceStreamManagerDiagnostics,
} from './useWorkspaceStream'

function makeStream(): WorkspaceStream {
  return {
    channel: null,
    eventQueue: [],
    instanceId: 'tab-test',
    lastKnownConnectionState: 'idle',
    lifecycleEvents: [],
    peerSeenAt: {},
    reconnectAttempt: 0,
    socket: null,
    subscribers: 0,
  }
}

function makeOpenSocket() {
  const close = vi.fn()

  return {
    close,
    socket: {
      close,
      readyState: 1,
    } as unknown as WebSocket,
  }
}

function makeCloseAwareSocket() {
  const socket = {
    close: vi.fn(() => {
      socket.readyState = 3
    }),
    readyState: 1,
  } as unknown as WebSocket & { readyState: number }

  return socket
}

function makeBroadcastChannel() {
  const postMessage = vi.fn()
  return {
    channel: {
      close: vi.fn(),
      onmessage: null,
      postMessage,
    } as unknown as BroadcastChannel,
    postMessage,
  }
}

function makeEvent(method: string, payload: Record<string, unknown>): ServerEvent {
  return {
    method,
    payload,
    ts: '2026-03-28T10:00:00.000Z',
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
  }
}

function resetSessionStore(overrides: Partial<ReturnType<typeof useSessionStore.getState>> = {}) {
  useSessionStore.setState({
    activityEventsByWorkspace: {},
    commandSessionsByWorkspace: {},
    connectionByWorkspace: {},
    eventsByThread: {},
    lastEventSeqByWorkspace: {},
    selectedThreadId: undefined,
    selectedThreadIdByWorkspace: {},
    selectedWorkspaceId: undefined,
    threadActivityByThread: {},
    threadProjectionsById: {},
    tokenUsageByThread: {},
    workspaceEventsByWorkspace: {},
    ...overrides,
  })
}

function makeDiagnostics(
  streamOverrides: Partial<WorkspaceStreamLocalDiagnostics> = {},
): WorkspaceStreamManagerDiagnostics {
  const stream: WorkspaceStreamLocalDiagnostics = {
    activePeerCount: 0,
    channelOpen: false,
    closeScheduled: false,
    coordinationActive: true,
    coordinationMode: 'direct',
    expectedBackendRole: 'workspace-stream-direct',
    expectedBackendSource: 'api.workspace_stream:tab-test',
    flushScheduled: false,
    instanceId: 'tab-test',
    isLeader: true,
    lastKnownConnectionState: 'open',
    lastLeaderHeartbeatAt: null,
    latestLifecycleEvent: null,
    leaderId: 'tab-test',
    peerSeenAt: {},
    queueLength: 0,
    recentLifecycleEvents: [],
    reconnectAttempt: 0,
    reconnectScheduled: false,
    socketReadyState: 1,
    socketState: 'open',
    subscribers: 1,
    workspaceId: 'ws-1',
    ...streamOverrides,
  }

  return {
    broadcastSupported: false,
    capturedAt: '2026-03-28T10:00:00.000Z',
    directWorkspaceCount: stream.coordinationMode === 'direct' ? 1 : 0,
    followerWorkspaceCount:
      stream.coordinationMode === 'broadcast' && !stream.isLeader ? 1 : 0,
    leaderWorkspaceCount: stream.isLeader ? 1 : 0,
    streams: [stream],
    tabInstanceId: 'tab-test',
    trackedWorkspaceCount: 1,
  }
}

describe('handleWorkspaceStreamEvent', () => {
  beforeEach(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
    vi.stubGlobal('WebSocket', {
      CLOSED: 3,
      CLOSING: 2,
      OPEN: 1,
    })
    resetSessionStore()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetSessionStore()
  })

  it('returns a stable diagnostics snapshot reference when no local stream state changes', () => {
    const firstSnapshot = getWorkspaceStreamManagerDiagnosticsSnapshot()
    const secondSnapshot = getWorkspaceStreamManagerDiagnosticsSnapshot()

    expect(secondSnapshot).toBe(firstSnapshot)
    expect(firstSnapshot.tabInstanceId).toMatch(/^tab-/)
    expect(firstSnapshot.streams).toEqual([])
  })

  it('coalesces workspace stream diagnostics notifications during event bursts', () => {
    vi.useFakeTimers()
    const stream = makeStream()
    const listener = vi.fn()
    const unsubscribe = subscribeWorkspaceStreamManagerDiagnostics(listener)

    try {
      handleWorkspaceStreamEvent(
        stream,
        makeEvent('item/agentMessage/delta', {
          delta: 'Hello',
          itemId: 'item-1',
        }),
        {
          flushQueuedEvents: vi.fn(),
          ingestImmediateEvent: vi.fn(),
          scheduleQueuedFlush: vi.fn(),
        },
      )
      handleWorkspaceStreamEvent(
        stream,
        makeEvent('item/agentMessage/delta', {
          delta: ' world',
          itemId: 'item-1',
        }),
        {
          flushQueuedEvents: vi.fn(),
          ingestImmediateEvent: vi.fn(),
          scheduleQueuedFlush: vi.fn(),
        },
      )

      expect(listener).not.toHaveBeenCalled()

      vi.advanceTimersByTime(99)
      expect(listener).not.toHaveBeenCalled()

      vi.advanceTimersByTime(1)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  it('flushes queued deltas before ingesting a terminal event immediately', () => {
    const stream = makeStream()
    const flushQueuedEvents = vi.fn(() => {
      stream.eventQueue = []
    })
    const ingestImmediateEvent = vi.fn()
    const scheduleQueuedFlush = vi.fn()

    const queuedResult = handleWorkspaceStreamEvent(
      stream,
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello',
        itemId: 'item-1',
      }),
      {
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleQueuedFlush,
      },
    )

    expect(queuedResult).toBe(true)
    expect(stream.eventQueue).toEqual([
      expect.objectContaining({
        method: 'item/agentMessage/delta',
      }),
    ])
    expect(scheduleQueuedFlush).toHaveBeenCalledTimes(1)
    expect(flushQueuedEvents).not.toHaveBeenCalled()

    const terminalResult = handleWorkspaceStreamEvent(
      stream,
      makeEvent('item/completed', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: 'Hello',
        },
      }),
      {
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleQueuedFlush,
      },
    )

    expect(terminalResult).toBe(true)
    expect(flushQueuedEvents).toHaveBeenCalledTimes(1)
    expect(stream.eventQueue).toEqual([])
    expect(ingestImmediateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'item/completed',
      }),
    )
  })

  it('tracks queued event sequence incrementally and resets it after a forced flush', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const flushQueuedEvents = vi.fn(() => {
      stream.eventQueue = []
    })
    const ingestImmediateEvent = vi.fn()
    const scheduleQueuedFlush = vi.fn()

    const firstResult = handleWorkspaceStreamEvent(
      stream,
      {
        ...makeEvent('item/agentMessage/delta', {
          delta: 'Hello',
          itemId: 'item-1',
        }),
        seq: 6,
      },
      {
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleQueuedFlush,
      },
    )
    const secondResult = handleWorkspaceStreamEvent(
      stream,
      {
        ...makeEvent('item/agentMessage/delta', {
          delta: ' world',
          itemId: 'item-1',
        }),
        seq: 7,
      },
      {
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleQueuedFlush,
      },
    )

    expect(firstResult).toBe(true)
    expect(secondResult).toBe(true)
    expect(stream.queuedSeqByWorkspace).toEqual({ 'ws-1': 7 })

    const terminalResult = handleWorkspaceStreamEvent(
      stream,
      makeEvent('turn/completed', {
        turn: {
          id: 'turn-1',
        },
      }),
      {
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleQueuedFlush,
      },
    )

    expect(terminalResult).toBe(true)
    expect(flushQueuedEvents).toHaveBeenCalledTimes(1)
    expect(stream.queuedSeqByWorkspace).toBeUndefined()
    expect(ingestImmediateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'turn/completed',
      }),
    )
  })

  it('keeps standalone non-delta events immediate when nothing is queued', () => {
    const stream = makeStream()
    const flushQueuedEvents = vi.fn()
    const ingestImmediateEvent = vi.fn()
    const scheduleQueuedFlush = vi.fn()
    const startedEvent = makeEvent('turn/started', {
      threadId: 'thread-1',
      turnId: 'turn-1',
    })

    const result = handleWorkspaceStreamEvent(stream, startedEvent, {
      flushQueuedEvents,
      ingestImmediateEvent,
      scheduleQueuedFlush,
    })

    expect(result).toBe(true)
    expect(ingestImmediateEvent).toHaveBeenCalledTimes(1)
    expect(ingestImmediateEvent).toHaveBeenCalledWith(startedEvent)
    expect(flushQueuedEvents).not.toHaveBeenCalled()
    expect(scheduleQueuedFlush).not.toHaveBeenCalled()
  })

  it('rejects a non-replay live event with a sequence gap before ingesting it', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const { close, socket } = makeOpenSocket()
    stream.socket = socket
    const flushQueuedEvents = vi.fn()
    const ingestImmediateEvent = vi.fn()
    const scheduleQueuedFlush = vi.fn()

    const result = handleWorkspaceStreamEvent(
      stream,
      {
        ...makeEvent('turn/started', {
          threadId: 'thread-1',
          turnId: 'turn-1',
        }),
        seq: 7,
      },
      {
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleQueuedFlush,
      },
    )

    expect(result).toBe(false)
    expect(ingestImmediateEvent).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
    expect(stream.eventQueue).toEqual([])
    expect(stream.lifecycleEvents.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'seq-gap-detected',
        metadata: expect.objectContaining({
          expectedSeq: 6,
          receivedSeq: 7,
        }),
      }),
    )
  })

  it('asks the current leader to replay when a follower receives a broadcast event with a sequence gap', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const { channel, postMessage } = makeBroadcastChannel()
    stream.channel = channel
    stream.isLeader = false
    stream.leaderId = 'tab-leader'

    const result = handleWorkspaceStreamEvent(stream, {
      ...makeEvent('item/agentMessage/delta', {
        delta: 'gap',
        itemId: 'item-1',
      }),
      seq: 8,
    })

    expect(result).toBe(false)
    expect(postMessage).toHaveBeenCalledTimes(1)
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        afterSeq: 5,
        expectedSeq: 6,
        instanceId: 'tab-test',
        method: 'item/agentMessage/delta',
        receivedSeq: 8,
        threadId: 'thread-1',
        turnId: 'turn-1',
        type: 'recovery-request',
        workspaceId: 'ws-1',
      }),
    )
    expect(stream.lifecycleEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['seq-gap-detected', 'follower-recovery-requested']),
    )
  })

  it('deduplicates repeated follower recovery requests for the same cursor within the cooldown window', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-28T10:00:00.000Z'))
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const { channel, postMessage } = makeBroadcastChannel()
    stream.channel = channel
    stream.isLeader = false
    stream.leaderId = 'tab-leader'

    const firstResult = handleWorkspaceStreamEvent(stream, {
      ...makeEvent('item/agentMessage/delta', {
        delta: 'gap 1',
        itemId: 'item-1',
      }),
      seq: 8,
    })
    const secondResult = handleWorkspaceStreamEvent(stream, {
      ...makeEvent('item/agentMessage/delta', {
        delta: 'gap 2',
        itemId: 'item-2',
      }),
      seq: 9,
    })

    expect(firstResult).toBe(false)
    expect(secondResult).toBe(false)
    expect(postMessage).toHaveBeenCalledTimes(1)
  })

  it('leader accepts follower replay recovery requests and reopens from the follower cursor', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 12,
      },
    })
    const stream = makeStream()
    stream.isLeader = true
    stream.socket = makeCloseAwareSocket()
    const setConnectionState = vi.fn()

    handleWorkspaceStreamBroadcastMessage(
      'ws-1',
      stream,
      {
        type: 'recovery-request',
        workspaceId: 'ws-1',
        instanceId: 'tab-follower',
        ts: Date.parse('2026-03-28T10:00:01.000Z'),
        afterSeq: 5,
        expectedSeq: 6,
        receivedSeq: 8,
        method: 'item/agentMessage/delta',
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      setConnectionState,
    )

    expect(stream.replayAfterSeqOverride).toBe(5)
    expect(stream.reconnectDelayOverrideMs).toBe(0)
    expect(stream.socket?.close).toHaveBeenCalledTimes(1)
    expect(setConnectionState).not.toHaveBeenCalled()
    expect(stream.lifecycleEvents.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'follower-recovery-accepted',
        metadata: expect.objectContaining({
          afterSeq: 5,
          followerInstanceId: 'tab-follower',
          replayAfterSeq: 5,
        }),
      }),
    )
  })

  it('uses the follower recovery cursor on the next leader websocket path', () => {
    vi.useFakeTimers()
    const openedUrls: string[] = []
    class FakeWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3
      onclose: (() => void) | null = null
      onerror: (() => void) | null = null
      onmessage: ((message: MessageEvent) => void) | null = null
      onopen: (() => void) | null = null
      readyState = FakeWebSocket.CONNECTING

      constructor(url: string) {
        openedUrls.push(url)
      }

      close = vi.fn(() => {
        this.readyState = FakeWebSocket.CLOSED
      })
    }
    vi.stubGlobal('WebSocket', FakeWebSocket)
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 12,
      },
    })
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      location: {
        host: 'localhost:3000',
        protocol: 'http:',
      },
      setTimeout: globalThis.setTimeout,
    })
    const stream = makeStream()
    stream.channel = makeBroadcastChannel().channel
    stream.isLeader = true
    stream.subscribers = 1

    handleWorkspaceStreamBroadcastMessage('ws-1', stream, {
      type: 'recovery-request',
      workspaceId: 'ws-1',
      instanceId: 'tab-follower',
      ts: Date.parse('2026-03-28T10:00:01.000Z'),
      afterSeq: 5,
      expectedSeq: 6,
      receivedSeq: 8,
      method: 'item/agentMessage/delta',
      threadId: 'thread-1',
      turnId: 'turn-1',
    })
    vi.advanceTimersByTime(0)

    expect(openedUrls).toHaveLength(1)
    expect(openedUrls[0]).toContain('/api/workspaces/ws-1/stream?')
    expect(openedUrls[0]).toContain('afterSeq=5')
    expect(openedUrls[0]).toContain('streamClientRole=leader')
    expect(stream.replayAfterSeqOverride).toBeUndefined()
  })

  it('accepts a coalesced event when coverage spans the missing sequence range', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const { close, socket } = makeOpenSocket()
    stream.socket = socket
    const ingestImmediateEvent = vi.fn()
    const coalescedEvent: ServerEvent = {
      ...makeEvent('turn/started', {
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      coalesced: true,
      coversSeqFrom: 6,
      coversSeqTo: 7,
      seq: 7,
    }

    const result = handleWorkspaceStreamEvent(stream, coalescedEvent, {
      flushQueuedEvents: vi.fn(),
      ingestImmediateEvent,
      scheduleQueuedFlush: vi.fn(),
    })

    expect(result).toBe(true)
    expect(ingestImmediateEvent).toHaveBeenCalledWith(coalescedEvent)
    expect(close).not.toHaveBeenCalled()
    expect(stream.lifecycleEvents.some((event) => event.kind === 'seq-gap-detected')).toBe(false)
  })

  it('continues replay when the replay completion response is incomplete but advances the cursor', () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    stream.isLeader = true
    stream.subscribers = 1
    stream.socket = makeCloseAwareSocket()

    const deltaResult = handleWorkspaceStreamEvent(stream, {
      ...makeEvent('item/agentMessage/delta', {
        delta: 'page 1',
        itemId: 'item-1',
      }),
      replay: true,
      seq: 6,
    })
    const replayCompletedResult = handleWorkspaceStreamEvent(stream, {
      method: 'workspace/replay/completed',
      payload: {
        afterSeq: 5,
        complete: false,
        fromSeq: 6,
        headSeq: 9,
        limit: 2000,
        nextAfterSeq: 6,
        oldestSeq: 1,
        replayed: 1,
        toSeq: 6,
      },
      ts: '2026-03-28T10:00:00.000Z',
      workspaceId: 'ws-1',
    })

    expect(deltaResult).toBe(true)
    expect(replayCompletedResult).toBe(false)
    expect(useSessionStore.getState().lastEventSeqByWorkspace['ws-1']).toBe(6)
    expect(stream.reconnectDelayOverrideMs).toBe(0)
    expect(stream.socket?.close).toHaveBeenCalledTimes(1)
    expect(stream.lifecycleEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining(['replay-incomplete', 'replay-continuation-requested']),
    )
  })

  it('records stalled replay completion when no forward page is available', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', {
      dispatchEvent,
    })
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    stream.isLeader = true
    stream.subscribers = 1
    stream.socket = makeCloseAwareSocket()

    const result = handleWorkspaceStreamEvent(stream, {
      method: 'workspace/replay/completed',
      payload: {
        afterSeq: 5,
        complete: false,
        fromSeq: 6,
        headSeq: 10,
        limit: 2000,
        nextAfterSeq: 5,
        oldestSeq: 1,
        replayed: 0,
        toSeq: 5,
      },
      ts: '2026-03-28T10:00:00.000Z',
      workspaceId: 'ws-1',
    })

    expect(result).toBe(false)
    expect(stream.socket?.close).not.toHaveBeenCalled()
    expect(stream.reconnectDelayOverrideMs).toBeUndefined()
    expect(stream.lifecycleEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        'replay-incomplete',
        'replay-incomplete-stalled',
        'snapshot-fallback-requested',
      ]),
    )
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect((dispatchEvent.mock.calls[0]?.[0] as CustomEvent).type).toBe(
      'codex-server-workspace-stream-recovery-required',
    )
    expect((dispatchEvent.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
      expect.objectContaining({
        afterSeq: 5,
        currentSeq: 5,
        reason: 'replay-incomplete-stalled',
        workspaceId: 'ws-1',
      }),
    )
  })

  it('requests snapshot fallback for retention gaps while continuing replay pages', () => {
    const dispatchEvent = vi.fn()
    vi.stubGlobal('window', {
      dispatchEvent,
    })
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 8,
      },
    })
    const stream = makeStream()
    stream.isLeader = true
    stream.subscribers = 1
    stream.socket = makeCloseAwareSocket()

    const result = handleWorkspaceStreamEvent(stream, {
      method: 'workspace/replay/completed',
      payload: {
        afterSeq: 5,
        complete: false,
        fromSeq: 8,
        headSeq: 10,
        limit: 2000,
        nextAfterSeq: 8,
        oldestSeq: 8,
        replayed: 1,
        toSeq: 8,
      },
      ts: '2026-03-28T10:00:00.000Z',
      workspaceId: 'ws-1',
    })

    expect(result).toBe(false)
    expect(dispatchEvent).toHaveBeenCalledTimes(1)
    expect((dispatchEvent.mock.calls[0]?.[0] as CustomEvent).detail).toEqual(
      expect.objectContaining({
        afterSeq: 5,
        currentSeq: 8,
        nextAfterSeq: 8,
        oldestSeq: 8,
        reason: 'replay-retention-gap',
        workspaceId: 'ws-1',
      }),
    )
    expect(stream.reconnectDelayOverrideMs).toBe(0)
    expect(stream.socket?.close).toHaveBeenCalledTimes(1)
    expect(stream.lifecycleEvents.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        'replay-incomplete',
        'snapshot-fallback-requested',
        'replay-continuation-requested',
      ]),
    )
  })

  it('records replay completion without reconnecting when replay is already complete', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 6,
      },
    })
    const stream = makeStream()
    stream.isLeader = true
    stream.subscribers = 1
    stream.socket = makeCloseAwareSocket()

    const result = handleWorkspaceStreamEvent(stream, {
      method: 'workspace/replay/completed',
      payload: {
        afterSeq: 5,
        complete: true,
        fromSeq: 6,
        headSeq: 6,
        limit: 2000,
        nextAfterSeq: 6,
        oldestSeq: 1,
        replayed: 1,
        toSeq: 6,
      },
      ts: '2026-03-28T10:00:00.000Z',
      workspaceId: 'ws-1',
    })

    expect(result).toBe(false)
    expect(stream.socket?.close).not.toHaveBeenCalled()
    expect(stream.reconnectDelayOverrideMs).toBeUndefined()
    expect(stream.lifecycleEvents.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'replay-completed',
      }),
    )
  })

  it('requests immediate recovery when the backend reports dropped workspace events', () => {
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const { close, socket } = makeOpenSocket()
    stream.socket = socket

    const result = handleWorkspaceStreamEvent(stream, {
      method: 'workspace/events/dropped',
      payload: {
        droppedMethod: 'item/agentMessage/delta',
        fromSeq: 6,
        reason: 'soft',
        seq: 6,
        threadId: 'thread-1',
        toSeq: 6,
        turnId: 'turn-1',
      },
      ts: '2026-03-28T10:00:00.000Z',
      workspaceId: 'ws-1',
    })

    expect(result).toBe(false)
    expect(useSessionStore.getState().lastEventSeqByWorkspace['ws-1']).toBe(5)
    expect(stream.reconnectDelayOverrideMs).toBe(0)
    expect(close).toHaveBeenCalledTimes(1)
    expect(stream.lifecycleEvents.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'events-dropped',
        metadata: expect.objectContaining({
          droppedMethod: 'item/agentMessage/delta',
          fromSeq: 6,
          reason: 'soft',
          toSeq: 6,
        }),
      }),
    )
  })

  it('flushes queued deltas before a gap and reconnects without applying later queued events', () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      clearTimeout: globalThis.clearTimeout,
      setTimeout: globalThis.setTimeout,
    })
    resetSessionStore({
      lastEventSeqByWorkspace: {
        'ws-1': 5,
      },
    })
    const stream = makeStream()
    const { close, socket } = makeOpenSocket()
    stream.socket = socket

    const firstResult = handleWorkspaceStreamEvent(stream, {
      ...makeEvent('item/agentMessage/delta', {
        delta: 'first',
        itemId: 'item-1',
      }),
      seq: 6,
    })
    const gapResult = handleWorkspaceStreamEvent(stream, {
      ...makeEvent('item/agentMessage/delta', {
        delta: 'skipped',
        itemId: 'item-2',
      }),
      seq: 8,
    })

    expect(firstResult).toBe(true)
    expect(gapResult).toBe(false)

    vi.advanceTimersByTime(16)

    expect(useSessionStore.getState().lastEventSeqByWorkspace['ws-1']).toBe(6)
    expect(useSessionStore.getState().eventsByThread[buildThreadStoreKey('ws-1', 'thread-1')]).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({
          delta: 'first',
        }),
        seq: 6,
      }),
    ])
    expect(stream.eventQueue).toEqual([])
    expect(close).toHaveBeenCalledTimes(1)
    expect(stream.lifecycleEvents.at(-1)).toEqual(
      expect.objectContaining({
        kind: 'seq-gap-detected',
        metadata: expect.objectContaining({
          expectedSeq: 7,
          receivedSeq: 8,
        }),
      }),
    )
  })
})

describe('buildWorkspaceStreamRecoveryNoticeFromDiagnostics', () => {
  beforeEach(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('surfaces a reconnecting notice when the stream is actively retrying', () => {
    const notice = buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
      makeDiagnostics({
        lastKnownConnectionState: 'closed',
        latestLifecycleEvent: {
          kind: 'socket-closed',
          metadata: null,
          summary: 'workspace websocket closed while subscribers are still attached',
          ts: '2026-03-28T10:00:00.000Z',
        },
        recentLifecycleEvents: [
          {
            kind: 'seq-gap-detected',
            metadata: null,
            summary: 'workspace event seq gap detected',
            ts: '2026-03-28T09:59:59.000Z',
          },
          {
            kind: 'socket-closed',
            metadata: null,
            summary: 'workspace websocket closed while subscribers are still attached',
            ts: '2026-03-28T10:00:00.000Z',
          },
        ],
        reconnectScheduled: true,
      }),
      'ws-1',
      Date.parse('2026-03-28T10:00:01.000Z'),
    )

    expect(notice).toEqual(
      expect.objectContaining({
        reason: 'connection-reconnecting',
        tone: 'error',
        title: 'Realtime sync is reconnecting',
      }),
    )
    expect(notice?.message).toContain('reconnecting')
    expect(notice?.details).toContain('Workspace ID: ws-1')
    expect(notice?.details).toContain('Reconnect scheduled: yes')
  })

  it('surfaces a snapshot fallback notice when replay requires a query refresh', () => {
    const notice = buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
      makeDiagnostics({
        latestLifecycleEvent: {
          kind: 'snapshot-fallback-requested',
          metadata: {
            reason: 'replay-incomplete-stalled',
          },
          summary: 'workspace replay stalled; snapshot fallback requested',
          ts: '2026-03-28T10:00:00.000Z',
        },
        recentLifecycleEvents: [
          {
            kind: 'snapshot-fallback-requested',
            metadata: {
              reason: 'replay-incomplete-stalled',
            },
            summary: 'workspace replay stalled; snapshot fallback requested',
            ts: '2026-03-28T10:00:00.000Z',
          },
        ],
      }),
      'ws-1',
      Date.parse('2026-03-28T10:00:30.000Z'),
    )

    expect(notice).toEqual(
      expect.objectContaining({
        reason: 'snapshot-fallback',
        tone: 'info',
        title: 'Realtime sync refreshed from snapshots',
      }),
    )
    expect(notice?.message).toContain('snapshots were refreshed')
    expect(notice?.expiresAt).toBe(Date.parse('2026-03-28T10:00:00.000Z') + 2 * 60_000)
  })

  it('keeps the snapshot fallback notice specific when replay records a follow-up recovery lifecycle event', () => {
    const notice = buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
      makeDiagnostics({
        latestLifecycleEvent: {
          kind: 'replay-continuation-requested',
          metadata: null,
          summary: 'workspace replay continuation requested after seq 8',
          ts: '2026-03-28T10:00:02.000Z',
        },
        recentLifecycleEvents: [
          {
            kind: 'snapshot-fallback-requested',
            metadata: {
              reason: 'replay-retention-gap',
            },
            summary: 'workspace replay retention gap detected; snapshot fallback requested',
            ts: '2026-03-28T10:00:00.000Z',
          },
          {
            kind: 'replay-continuation-requested',
            metadata: null,
            summary: 'workspace replay continuation requested after seq 8',
            ts: '2026-03-28T10:00:02.000Z',
          },
        ],
      }),
      'ws-1',
      Date.parse('2026-03-28T10:00:30.000Z'),
    )

    expect(notice).toEqual(
      expect.objectContaining({
        latestEventKind: 'snapshot-fallback-requested',
        reason: 'snapshot-fallback',
        title: 'Realtime sync refreshed from snapshots',
      }),
    )
  })

  it('surfaces a recovered notice shortly after a stable replay completes', () => {
    const notice = buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
      makeDiagnostics({
        latestLifecycleEvent: {
          kind: 'replay-completed',
          metadata: null,
          summary: 'workspace replay completed',
          ts: '2026-03-28T10:00:10.000Z',
        },
        recentLifecycleEvents: [
          {
            kind: 'seq-gap-detected',
            metadata: null,
            summary: 'workspace event seq gap detected: expected 6, received 8',
            ts: '2026-03-28T10:00:00.000Z',
          },
          {
            kind: 'replay-completed',
            metadata: null,
            summary: 'workspace replay completed',
            ts: '2026-03-28T10:00:10.000Z',
          },
        ],
      }),
      'ws-1',
      Date.parse('2026-03-28T10:00:20.000Z'),
    )

    expect(notice).toEqual(
      expect.objectContaining({
        reason: 'recovered',
        tone: 'info',
        title: 'Realtime sync recovered',
      }),
    )
    expect(notice?.message).toContain('render normally')
  })

  it('suppresses stale recovery notices once the TTL has elapsed', () => {
    const notice = buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
      makeDiagnostics({
        latestLifecycleEvent: {
          kind: 'seq-gap-detected',
          metadata: null,
          summary: 'workspace event seq gap detected',
          ts: '2026-03-28T09:55:00.000Z',
        },
        recentLifecycleEvents: [
          {
            kind: 'seq-gap-detected',
            metadata: null,
            summary: 'workspace event seq gap detected',
            ts: '2026-03-28T09:55:00.000Z',
          },
        ],
      }),
      'ws-1',
      Date.parse('2026-03-28T10:00:00.000Z'),
    )

    expect(notice).toBeNull()
  })
})
