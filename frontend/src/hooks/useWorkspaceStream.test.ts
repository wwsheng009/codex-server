import { describe, expect, it, vi } from 'vitest'

import type { ServerEvent } from '../types/api'
import type { WorkspaceStream } from './useWorkspaceStreamTypes'
import {
  getWorkspaceStreamManagerDiagnosticsSnapshot,
  handleWorkspaceStreamEvent,
} from './useWorkspaceStream'

function makeStream(): WorkspaceStream {
  return {
    channel: null,
    deferredEvents: [],
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

describe('handleWorkspaceStreamEvent', () => {
  it('returns a stable diagnostics snapshot reference when no local stream state changes', () => {
    const firstSnapshot = getWorkspaceStreamManagerDiagnosticsSnapshot()
    const secondSnapshot = getWorkspaceStreamManagerDiagnosticsSnapshot()

    expect(secondSnapshot).toBe(firstSnapshot)
    expect(firstSnapshot.tabInstanceId).toMatch(/^tab-/)
    expect(firstSnapshot.streams).toEqual([])
  })

  it('flushes queued deltas before ingesting a terminal event immediately', () => {
    const stream = makeStream()
    const flushQueuedEvents = vi.fn(() => {
      stream.eventQueue = []
    })
    const flushDeferredEvents = vi.fn(() => {
      stream.deferredEvents = []
    })
    const ingestImmediateEvent = vi.fn()
    const scheduleDeferredFlush = vi.fn()
    const scheduleQueuedFlush = vi.fn()

    handleWorkspaceStreamEvent(
      stream,
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello',
        itemId: 'item-1',
      }),
      {
        flushDeferredEvents,
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleDeferredFlush,
        scheduleQueuedFlush,
      },
    )

    expect(stream.eventQueue).toEqual([
      expect.objectContaining({
        method: 'item/agentMessage/delta',
      }),
    ])
    expect(scheduleQueuedFlush).toHaveBeenCalledTimes(1)
    expect(flushQueuedEvents).not.toHaveBeenCalled()

    handleWorkspaceStreamEvent(
      stream,
      makeEvent('item/completed', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: 'Hello',
        },
      }),
      {
        flushDeferredEvents,
        flushQueuedEvents,
        ingestImmediateEvent,
        scheduleDeferredFlush,
        scheduleQueuedFlush,
      },
    )

    expect(flushQueuedEvents).toHaveBeenCalledTimes(1)
    expect(stream.eventQueue).toEqual([])
    expect(stream.deferredEvents).toEqual([])
    expect(flushDeferredEvents).not.toHaveBeenCalled()
    expect(scheduleDeferredFlush).not.toHaveBeenCalled()
    expect(ingestImmediateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'item/completed',
      }),
    )
  })

  it('keeps standalone non-delta events immediate when nothing is queued', () => {
    const stream = makeStream()
    const flushDeferredEvents = vi.fn()
    const flushQueuedEvents = vi.fn()
    const ingestImmediateEvent = vi.fn()
    const scheduleDeferredFlush = vi.fn()
    const scheduleQueuedFlush = vi.fn()
    const startedEvent = makeEvent('turn/started', {
      threadId: 'thread-1',
      turnId: 'turn-1',
    })

    handleWorkspaceStreamEvent(stream, startedEvent, {
      flushDeferredEvents,
      flushQueuedEvents,
      ingestImmediateEvent,
      scheduleDeferredFlush,
      scheduleQueuedFlush,
    })

    expect(ingestImmediateEvent).toHaveBeenCalledTimes(1)
    expect(ingestImmediateEvent).toHaveBeenCalledWith(startedEvent)
    expect(flushDeferredEvents).not.toHaveBeenCalled()
    expect(flushQueuedEvents).not.toHaveBeenCalled()
    expect(scheduleDeferredFlush).not.toHaveBeenCalled()
    expect(scheduleQueuedFlush).not.toHaveBeenCalled()
  })
})
