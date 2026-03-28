import { useEffect } from 'react'

import { buildApiWebSocketUrl } from '../lib/api-client'
import {
  frontendDebugLog,
  summarizeServerEventForDebug,
} from '../lib/frontend-runtime-mode'
import { useSessionStore } from '../stores/session-store'
import type { ServerEvent } from '../types/api'
import type {
  ConnectionStateSetter,
  WorkspaceStream,
} from './useWorkspaceStreamTypes'

const workspaceStreams = new Map<string, WorkspaceStream>()
const reconnectDelaysMs = [1_000, 2_000, 5_000]
const streamBatchFlushDelayMs = 16
const commandResumeSessionLimit = 16
const commandResumeTailLength = 512

type WorkspaceStreamEventHandlers = {
  flushQueuedEvents: (stream: WorkspaceStream) => void
  ingestImmediateEvent: (event: ServerEvent) => void
  scheduleDeferredFlush: (stream: WorkspaceStream) => void
  scheduleQueuedFlush: (stream: WorkspaceStream) => void
}

export function useWorkspaceStream(workspaceId?: string) {
  const setConnectionState = useSessionStore((state) => state.setConnectionState)

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    return subscribeWorkspaceStream(workspaceId, setConnectionState)
  }, [setConnectionState, workspaceId])

  return useSessionStore((state) =>
    workspaceId ? state.connectionByWorkspace[workspaceId] ?? 'idle' : 'idle',
  )
}

export function parseWorkspaceStreamEvent(messageData: unknown): ServerEvent | null {
  if (typeof messageData !== 'string') {
    return null
  }

  try {
    const payload = JSON.parse(messageData) as unknown
    return isServerEvent(payload) ? payload : null
  } catch {
    return null
  }
}

function isBatchableWorkspaceEvent(method?: string) {
  if (typeof method !== 'string' || method === '') {
    return false
  }

  return method.endsWith('Delta') || method.endsWith('/delta')
}

function subscribeWorkspaceStream(workspaceId: string, setConnectionState: ConnectionStateSetter) {
  const stream = getWorkspaceStream(workspaceId)
  stream.subscribers += 1

  if (stream.closeTimer) {
    window.clearTimeout(stream.closeTimer)
    stream.closeTimer = undefined
  }

  openWorkspaceStream(workspaceId, stream, setConnectionState)

  return () => {
    stream.subscribers = Math.max(0, stream.subscribers - 1)
    if (stream.subscribers > 0) {
      return
    }

    stream.closeTimer = window.setTimeout(() => {
      stream.closeTimer = undefined
      if (stream.subscribers > 0) {
        return
      }

      disposeWorkspaceStream(workspaceId, stream, setConnectionState)
    }, 0)
  }
}

function getWorkspaceStream(workspaceId: string) {
  let stream = workspaceStreams.get(workspaceId)
  if (!stream) {
    stream = {
      deferredEvents: [],
      eventQueue: [],
      subscribers: 0,
      socket: null,
      reconnectAttempt: 0,
    }
    workspaceStreams.set(workspaceId, stream)
  }

  return stream
}

function openWorkspaceStream(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (stream.socket && isSocketActive(stream.socket)) {
    return
  }

  if (stream.reconnectTimer) {
    window.clearTimeout(stream.reconnectTimer)
    stream.reconnectTimer = undefined
  }

  const socket = new WebSocket(
    buildApiWebSocketUrl(buildWorkspaceStreamPath(workspaceId)),
  )
  stream.socket = socket
  frontendDebugLog('workspace-stream', 'opening websocket', {
    workspaceId,
    path: buildWorkspaceStreamPath(workspaceId),
  })

  setConnectionState(workspaceId, 'connecting')

  socket.onopen = () => {
    if (stream.socket !== socket) {
      return
    }

    stream.reconnectAttempt = 0
    setConnectionState(workspaceId, 'open')
    frontendDebugLog('workspace-stream', 'websocket opened', { workspaceId })
  }

  socket.onmessage = (message) => {
    const event = parseWorkspaceStreamEvent(message.data)
    if (!event) {
      return
    }
    frontendDebugLog('workspace-stream', 'event received', summarizeServerEventForDebug(event))
    handleWorkspaceStreamEvent(stream, event)
  }

  socket.onerror = () => {
    if (stream.socket !== socket) {
      return
    }

    setConnectionState(workspaceId, 'error')
    frontendDebugLog('workspace-stream', 'websocket error', { workspaceId })
  }

  socket.onclose = () => {
    if (stream.socket === socket) {
      stream.socket = null
    }

    if (stream.deferredEventFlushHandle) {
      cancelDeferredWorkspaceEventFlush(stream)
    }
    if (stream.flushTimer) {
      window.clearTimeout(stream.flushTimer)
      stream.flushTimer = undefined
    }
    flushWorkspaceStreamEvents(stream)
    flushDeferredWorkspaceEvents(stream)

    if (stream.subscribers === 0) {
      setConnectionState(workspaceId, 'idle')
      workspaceStreams.delete(workspaceId)
      frontendDebugLog('workspace-stream', 'websocket closed without subscribers', { workspaceId })
      return
    }

    setConnectionState(workspaceId, 'closed')
    frontendDebugLog('workspace-stream', 'websocket closed, scheduling reconnect', {
      workspaceId,
      reconnectAttempt: stream.reconnectAttempt,
    })
    scheduleReconnect(workspaceId, stream, setConnectionState)
  }
}

function buildWorkspaceStreamPath(workspaceId: string) {
  const resumeState = buildCommandResumeStateParam(workspaceId)
  if (!resumeState) {
    return `/api/workspaces/${workspaceId}/stream`
  }

  return `/api/workspaces/${workspaceId}/stream?commandResumeState=${encodeURIComponent(resumeState)}`
}

function buildCommandResumeStateParam(workspaceId: string) {
  const workspaceSessions =
    useSessionStore.getState().commandSessionsByWorkspace[workspaceId] ?? {}
  const sessions = Object.values(workspaceSessions)
    .filter((session) => (session.combinedOutput ?? '').length > 0)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, commandResumeSessionLimit)
    .map((session) => ({
      id: session.id,
      outputLength: new TextEncoder().encode(session.combinedOutput ?? '').length,
      outputTail: (session.combinedOutput ?? '').slice(-commandResumeTailLength),
      updatedAt: session.updatedAt,
    }))

  if (!sessions.length) {
    return ''
  }

  return encodeWebSocketResumeState(JSON.stringify({ sessions }))
}

function encodeWebSocketResumeState(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function scheduleReconnect(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (stream.reconnectTimer || stream.subscribers === 0) {
    return
  }

  const delay = reconnectDelaysMs[Math.min(stream.reconnectAttempt, reconnectDelaysMs.length - 1)]
  stream.reconnectAttempt += 1
  frontendDebugLog('workspace-stream', 'reconnect scheduled', {
    workspaceId,
    delay,
    reconnectAttempt: stream.reconnectAttempt,
  })
  stream.reconnectTimer = window.setTimeout(() => {
    stream.reconnectTimer = undefined
    if (stream.subscribers === 0) {
      return
    }

    openWorkspaceStream(workspaceId, stream, setConnectionState)
  }, delay)
}

function disposeWorkspaceStream(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (stream.reconnectTimer) {
    window.clearTimeout(stream.reconnectTimer)
    stream.reconnectTimer = undefined
  }
  if (stream.flushTimer) {
    window.clearTimeout(stream.flushTimer)
    stream.flushTimer = undefined
  }
  if (stream.deferredEventFlushHandle) {
    cancelDeferredWorkspaceEventFlush(stream)
  }

  flushWorkspaceStreamEvents(stream)
  flushDeferredWorkspaceEvents(stream)

  const socket = stream.socket
  stream.socket = null
  workspaceStreams.delete(workspaceId)

  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    socket.close()
  }

  setConnectionState(workspaceId, 'idle')
}

function isSocketActive(socket: WebSocket) {
  return socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN
}

export function handleWorkspaceStreamEvent(
  stream: WorkspaceStream,
  event: ServerEvent,
  handlers: WorkspaceStreamEventHandlers = {
    flushQueuedEvents: flushWorkspaceStreamEvents,
    ingestImmediateEvent: (nextEvent) => useSessionStore.getState().ingestEvent(nextEvent),
    scheduleDeferredFlush: scheduleDeferredWorkspaceEventFlush,
    scheduleQueuedFlush: scheduleWorkspaceStreamFlush,
  },
) {
  if (!isBatchableWorkspaceEvent(event.method)) {
    if (stream.eventQueue.length > 0 || stream.deferredEvents.length > 0) {
      handlers.flushQueuedEvents(stream)
      stream.deferredEvents.push(event)
      handlers.scheduleDeferredFlush(stream)
      return
    }

    handlers.ingestImmediateEvent(event)
    return
  }

  stream.eventQueue.push(event)
  handlers.scheduleQueuedFlush(stream)
}

function scheduleWorkspaceStreamFlush(stream: WorkspaceStream) {
  if (stream.flushTimer) {
    return
  }

  stream.flushTimer = window.setTimeout(() => {
    stream.flushTimer = undefined
    flushWorkspaceStreamEvents(stream)
  }, streamBatchFlushDelayMs)
}

function flushWorkspaceStreamEvents(stream: WorkspaceStream) {
  if (!stream.eventQueue.length) {
    return
  }

  const queuedEvents = stream.eventQueue
  stream.eventQueue = []
  frontendDebugLog('workspace-stream', 'flushing queued delta events', {
    count: queuedEvents.length,
    methods: queuedEvents.map((event) => event.method),
    lastEvent: summarizeServerEventForDebug(queuedEvents[queuedEvents.length - 1]),
  })
  useSessionStore.getState().ingestEvents(queuedEvents)
}

function scheduleDeferredWorkspaceEventFlush(stream: WorkspaceStream) {
  if (stream.deferredEventFlushHandle) {
    return
  }

  const scheduleFrame =
    typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame.bind(window)
      : (callback: FrameRequestCallback) =>
          window.setTimeout(() => callback(Date.now()), 0)

  stream.deferredEventFlushHandle = scheduleFrame(() => {
    stream.deferredEventFlushHandle = undefined
    flushDeferredWorkspaceEvents(stream)
  })
}

function cancelDeferredWorkspaceEventFlush(stream: WorkspaceStream) {
  if (!stream.deferredEventFlushHandle) {
    return
  }

  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
    window.cancelAnimationFrame(stream.deferredEventFlushHandle)
  } else {
    window.clearTimeout(stream.deferredEventFlushHandle)
  }
  stream.deferredEventFlushHandle = undefined
}

function flushDeferredWorkspaceEvents(stream: WorkspaceStream) {
  if (!stream.deferredEvents.length) {
    return
  }

  const deferredEvents = stream.deferredEvents
  stream.deferredEvents = []
  frontendDebugLog('workspace-stream', 'flushing deferred non-delta events', {
    count: deferredEvents.length,
    methods: deferredEvents.map((event) => event.method),
    lastEvent: summarizeServerEventForDebug(deferredEvents[deferredEvents.length - 1]),
  })
  useSessionStore.getState().ingestEvents(deferredEvents)
}

function isServerEvent(value: unknown): value is ServerEvent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'workspaceId' in value &&
    'method' in value &&
    'ts' in value
  )
}
