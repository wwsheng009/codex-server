import type { ServerEvent } from '../types/api'

export type ConnectionStateSetter = (workspaceId: string, state: string) => void

export type WorkspaceStreamLifecycleEvent = {
  ts: string
  kind: string
  summary: string
  metadata?: Record<string, unknown> | null
}

export type WorkspaceStreamLocalDiagnostics = {
  workspaceId: string
  instanceId: string
  subscribers: number
  coordinationMode: 'broadcast' | 'direct'
  channelOpen: boolean
  isLeader: boolean
  leaderId?: string | null
  lastLeaderHeartbeatAt?: string | null
  peerSeenAt: Record<string, string>
  activePeerCount: number
  socketState: 'absent' | 'connecting' | 'open' | 'closing' | 'closed'
  socketReadyState: number | null
  lastKnownConnectionState: string
  reconnectAttempt: number
  reconnectScheduled: boolean
  queueLength: number
  deferredEventCount: number
  flushScheduled: boolean
  deferredFlushScheduled: boolean
  coordinationActive: boolean
  closeScheduled: boolean
  expectedBackendSource?: string | null
  expectedBackendRole?: string | null
  latestLifecycleEvent?: WorkspaceStreamLifecycleEvent | null
  recentLifecycleEvents: WorkspaceStreamLifecycleEvent[]
}

export type WorkspaceStreamManagerDiagnostics = {
  capturedAt: string
  tabInstanceId: string
  broadcastSupported: boolean
  trackedWorkspaceCount: number
  leaderWorkspaceCount: number
  followerWorkspaceCount: number
  directWorkspaceCount: number
  streams: WorkspaceStreamLocalDiagnostics[]
}

export type WorkspaceStream = {
  activityTimer?: number
  channel?: BroadcastChannel | null
  deferredEventFlushHandle?: number
  deferredEvents: ServerEvent[]
  eventQueue: ServerEvent[]
  flushTimer?: number
  instanceId: string
  isLeader?: boolean
  lastKnownConnectionState?: string
  leaderId?: string
  lastLeaderHeartbeatAt?: number
  lifecycleEvents: WorkspaceStreamLifecycleEvent[]
  peerSeenAt: Record<string, number>
  subscribers: number
  socket: WebSocket | null
  reconnectTimer?: number
  closeTimer?: number
  reconnectAttempt: number
}
