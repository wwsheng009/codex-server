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
  lastServerHeartbeatAt?: string | null
  lastServerMessageAt?: string | null
  peerSeenAt: Record<string, string>
  activePeerCount: number
  socketState: 'absent' | 'connecting' | 'open' | 'closing' | 'closed'
  socketReadyState: number | null
  lastKnownConnectionState: string
  reconnectAttempt: number
  reconnectScheduled: boolean
  queueLength: number
  flushScheduled: boolean
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

export type WorkspaceStreamRecoveryNotice = {
  details: string
  expiresAt?: number | null
  latestEventKind?: string
  latestEventTs?: string
  message: string
  noticeKey: string
  reason:
    | 'connection-reconnecting'
    | 'event-recovery'
    | 'snapshot-fallback'
    | 'recovered'
  title: string
  tone: 'info' | 'error'
}

export type WorkspaceStream = {
  activityTimer?: number
  channel?: BroadcastChannel | null
  eventQueue: ServerEvent[]
  flushTimer?: number
  instanceId: string
  isLeader?: boolean
  lastKnownConnectionState?: string
  leaderId?: string
  lastLeaderHeartbeatAt?: number
  lastServerHeartbeatAt?: number
  lastServerMessageAt?: number
  lifecycleEvents: WorkspaceStreamLifecycleEvent[]
  peerSeenAt: Record<string, number>
  queuedSeqByWorkspace?: Record<string, number>
  lastFollowerRecoveryRequestAfterSeq?: number
  lastFollowerRecoveryRequestAt?: number
  reconnectDelayOverrideMs?: number
  replayAfterSeqOverride?: number
  subscribers: number
  socket: WebSocket | null
  reconnectTimer?: number
  serverActivityTimer?: number
  closeTimer?: number
  reconnectAttempt: number
}
