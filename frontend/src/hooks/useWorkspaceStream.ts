import { useEffect } from 'react'

import { buildApiWebSocketUrl } from '../lib/api-client'
import { useSessionStore } from '../stores/session-store'
import type { ServerEvent } from '../types/api'

const workspaceStreams = new Map<string, WorkspaceStream>()
const reconnectDelaysMs = [1_000, 2_000, 5_000]
const streamBatchFlushDelayMs = 16

type ConnectionStateSetter = (workspaceId: string, state: string) => void

type WorkspaceStream = {
  eventQueue: ServerEvent[]
  flushTimer?: number
  subscribers: number
  socket: WebSocket | null
  reconnectTimer?: number
  closeTimer?: number
  reconnectAttempt: number
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

  const socket = new WebSocket(buildApiWebSocketUrl(`/api/workspaces/${workspaceId}/stream`))
  stream.socket = socket

  setConnectionState(workspaceId, 'connecting')

  socket.onopen = () => {
    if (stream.socket !== socket) {
      return
    }

    stream.reconnectAttempt = 0
    setConnectionState(workspaceId, 'open')
  }

  socket.onmessage = (message) => {
    const event = parseWorkspaceStreamEvent(message.data)
    if (!event) {
      return
    }

    if (!isBatchableWorkspaceEvent(event.method)) {
      flushWorkspaceStreamEvents(stream)
      useSessionStore.getState().ingestEvent(event)
      return
    }

    stream.eventQueue.push(event)
    scheduleWorkspaceStreamFlush(stream)
  }

  socket.onerror = () => {
    if (stream.socket !== socket) {
      return
    }

    setConnectionState(workspaceId, 'error')
  }

  socket.onclose = () => {
    if (stream.socket === socket) {
      stream.socket = null
    }

    if (stream.flushTimer) {
      window.clearTimeout(stream.flushTimer)
      stream.flushTimer = undefined
    }
    flushWorkspaceStreamEvents(stream)

    if (stream.subscribers === 0) {
      setConnectionState(workspaceId, 'idle')
      workspaceStreams.delete(workspaceId)
      return
    }

    setConnectionState(workspaceId, 'closed')
    scheduleReconnect(workspaceId, stream, setConnectionState)
  }
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

  flushWorkspaceStreamEvents(stream)

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
  useSessionStore.getState().ingestEvents(queuedEvents)
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
