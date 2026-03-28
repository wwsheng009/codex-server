import type { ServerEvent } from '../types/api'

export type ConnectionStateSetter = (workspaceId: string, state: string) => void

export type WorkspaceStream = {
  deferredEventFlushHandle?: number
  deferredEvents: ServerEvent[]
  eventQueue: ServerEvent[]
  flushTimer?: number
  subscribers: number
  socket: WebSocket | null
  reconnectTimer?: number
  closeTimer?: number
  reconnectAttempt: number
}
