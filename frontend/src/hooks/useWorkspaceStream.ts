import { useEffect, useMemo, useRef } from 'react'

import { buildApiWebSocketUrl } from '../lib/api-client'
import {
  frontendDebugLog,
  summarizeServerEventForDebug,
} from '../lib/frontend-runtime-mode'
import {
  createWorkspaceStreamBroadcastChannel,
  getWorkspaceStreamInstanceId,
  isWorkspaceStreamBroadcastSupported,
  selectWorkspaceStreamLeaderCandidate,
  shouldYieldWorkspaceStreamLeadership,
  workspaceStreamLeaderHeartbeatIntervalMs,
  workspaceStreamLeaderStaleAfterMs,
  type WorkspaceStreamBroadcastMessage,
} from '../lib/workspace-stream-broadcast'
import { recordConversationLiveDiagnosticEvent } from '../components/workspace/threadConversationProfiler'
import { useSessionStore } from '../stores/session-store'
import type { ServerEvent } from '../types/api'
import type { ConversationLiveDiagnosticMetadata } from '../components/workspace/threadConversationProfilerTypes'
import type {
  ConnectionStateSetter,
  WorkspaceStreamLifecycleEvent,
  WorkspaceStreamLocalDiagnostics,
  WorkspaceStreamManagerDiagnostics,
  WorkspaceStream,
} from './useWorkspaceStreamTypes'

const workspaceStreams = new Map<string, WorkspaceStream>()
const workspaceEventListeners = new Map<string, Set<(event: ServerEvent) => void>>()
const workspaceStreamDiagnosticsListeners = new Set<() => void>()
const reconnectDelaysMs = [1_000, 2_000, 5_000]
const streamBatchFlushDelayMs = 16
const commandResumeSessionLimit = 16
const commandResumeTailLength = 512
const workspaceIdListSeparator = '\u001f'
const workspaceLeaderElectionDelayMs = 80
const workspaceStreamLifecycleLimit = 24
let workspaceStreamDiagnosticsEmitScheduled = false
let workspaceStreamDiagnosticsDirty = true
let workspaceStreamDiagnosticsSnapshotCache: WorkspaceStreamManagerDiagnostics | null = null

type WorkspaceStreamEventHandlers = {
  flushQueuedEvents: (stream: WorkspaceStream) => void
  ingestImmediateEvent: (event: ServerEvent) => void
  scheduleDeferredFlush: (stream: WorkspaceStream) => void
  scheduleQueuedFlush: (stream: WorkspaceStream) => void
}

export function subscribeWorkspaceStreamManagerDiagnostics(listener: () => void) {
  workspaceStreamDiagnosticsListeners.add(listener)
  return () => {
    workspaceStreamDiagnosticsListeners.delete(listener)
  }
}

export function getWorkspaceStreamManagerDiagnosticsSnapshot(): WorkspaceStreamManagerDiagnostics {
  if (!workspaceStreamDiagnosticsDirty && workspaceStreamDiagnosticsSnapshotCache) {
    return workspaceStreamDiagnosticsSnapshotCache
  }

  const tabInstanceId = getWorkspaceStreamInstanceId()
  const streams = [...workspaceStreams.entries()]
    .map(([workspaceId, stream]) => buildWorkspaceStreamLocalDiagnostics(workspaceId, stream))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))

  workspaceStreamDiagnosticsSnapshotCache = {
    broadcastSupported: isWorkspaceStreamBroadcastSupported(),
    capturedAt: new Date().toISOString(),
    directWorkspaceCount: streams.filter((stream) => stream.coordinationMode === 'direct').length,
    followerWorkspaceCount: streams.filter((stream) => !stream.isLeader && stream.coordinationMode === 'broadcast').length,
    leaderWorkspaceCount: streams.filter((stream) => stream.isLeader).length,
    streams,
    tabInstanceId,
    trackedWorkspaceCount: streams.length,
  }
  workspaceStreamDiagnosticsDirty = false
  return workspaceStreamDiagnosticsSnapshotCache
}

function scheduleWorkspaceStreamDiagnosticsChanged() {
  workspaceStreamDiagnosticsDirty = true
  if (workspaceStreamDiagnosticsEmitScheduled) {
    return
  }

  workspaceStreamDiagnosticsEmitScheduled = true
  queueMicrotask(() => {
    workspaceStreamDiagnosticsEmitScheduled = false
    for (const listener of [...workspaceStreamDiagnosticsListeners]) {
      listener()
    }
  })
}

function buildWorkspaceStreamLocalDiagnostics(
  workspaceId: string,
  stream: WorkspaceStream,
): WorkspaceStreamLocalDiagnostics {
  const coordinationMode = stream.channel ? 'broadcast' : 'direct'
  const socketReadyState = stream.socket?.readyState ?? null
  const isLeader = Boolean(stream.isLeader)
  const lastKnownConnectionState = stream.lastKnownConnectionState ?? 'idle'
  const peerSeenAt = Object.fromEntries(
    Object.entries(stream.peerSeenAt)
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([instanceId, ts]) => [instanceId, new Date(ts).toISOString()]),
  )

  return {
    activePeerCount: countActiveWorkspaceStreamPeers(stream.peerSeenAt),
    channelOpen: Boolean(stream.channel),
    closeScheduled: stream.closeTimer !== undefined,
    coordinationActive: stream.activityTimer !== undefined,
    coordinationMode,
    deferredEventCount: stream.deferredEvents.length,
    deferredFlushScheduled: stream.deferredEventFlushHandle !== undefined,
    expectedBackendRole:
      coordinationMode === 'direct'
        ? 'workspace-stream-direct'
        : isLeader
          ? 'workspace-stream-leader'
          : null,
    expectedBackendSource:
      coordinationMode === 'direct' || isLeader
        ? `api.workspace_stream:${stream.instanceId}`
        : null,
    flushScheduled: stream.flushTimer !== undefined,
    instanceId: stream.instanceId,
    isLeader,
    lastKnownConnectionState,
    lastLeaderHeartbeatAt:
      stream.lastLeaderHeartbeatAt !== undefined
        ? new Date(stream.lastLeaderHeartbeatAt).toISOString()
        : null,
    leaderId: stream.leaderId ?? null,
    peerSeenAt,
    queueLength: stream.eventQueue.length,
    reconnectAttempt: stream.reconnectAttempt,
    reconnectScheduled: stream.reconnectTimer !== undefined,
    socketReadyState,
    socketState: describeWorkspaceSocketState(socketReadyState),
    subscribers: stream.subscribers,
    workspaceId,
    latestLifecycleEvent: stream.lifecycleEvents[stream.lifecycleEvents.length - 1] ?? null,
    recentLifecycleEvents: [...stream.lifecycleEvents],
  }
}

function recordWorkspaceStreamLifecycleEvent(
  workspaceId: string,
  stream: WorkspaceStream,
  kind: string,
  summary: string,
  metadata?: Record<string, unknown> | null,
) {
  const event: WorkspaceStreamLifecycleEvent = {
    kind,
    metadata: metadata ?? null,
    summary,
    ts: new Date().toISOString(),
  }

  stream.lifecycleEvents = [...stream.lifecycleEvents, event].slice(-workspaceStreamLifecycleLimit)
  frontendDebugLog('workspace-stream', 'lifecycle event', {
    kind,
    metadata: event.metadata ?? undefined,
    summary,
    workspaceId,
  })
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function describeWorkspaceSocketState(
  readyState: number | null,
): WorkspaceStreamLocalDiagnostics['socketState'] {
  switch (readyState) {
    case 0:
      return 'connecting'
    case 1:
      return 'open'
    case 2:
      return 'closing'
    case 3:
      return 'closed'
    default:
      return 'absent'
  }
}

function countActiveWorkspaceStreamPeers(peerSeenAt: Record<string, number>) {
  const now = Date.now()
  let count = 0
  for (const seenAt of Object.values(peerSeenAt)) {
    if (now - seenAt <= workspaceStreamLeaderStaleAfterMs) {
      count += 1
    }
  }
  return count
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

export function useWorkspaceStreams(workspaceIds?: string[]) {
  const setConnectionState = useSessionStore((state) => state.setConnectionState)
  const normalizedWorkspaceIds = useNormalizedWorkspaceIds(workspaceIds)
  const workspaceIdListKey = normalizedWorkspaceIds.join(workspaceIdListSeparator)

  useEffect(() => {
    if (!normalizedWorkspaceIds.length) {
      return
    }

    const unsubscribeFns = normalizedWorkspaceIds.map((workspaceId) =>
      subscribeWorkspaceStream(workspaceId, setConnectionState),
    )

    return () => {
      unsubscribeFns.forEach((unsubscribe) => unsubscribe())
    }
  }, [normalizedWorkspaceIds, setConnectionState, workspaceIdListKey])
}

export function useWorkspaceEventSubscription(
  workspaceIds: string[] | undefined,
  listener: (event: ServerEvent) => void,
) {
  const normalizedWorkspaceIds = useNormalizedWorkspaceIds(workspaceIds)
  const workspaceIdListKey = normalizedWorkspaceIds.join(workspaceIdListSeparator)
  const listenerRef = useRef(listener)

  useEffect(() => {
    listenerRef.current = listener
  }, [listener])

  useEffect(() => {
    if (!normalizedWorkspaceIds.length) {
      return
    }

    const unsubscribeFns = normalizedWorkspaceIds.map((workspaceId) =>
      subscribeWorkspaceEventListener(workspaceId, (event) => {
        listenerRef.current(event)
      }),
    )

    return () => {
      unsubscribeFns.forEach((unsubscribe) => unsubscribe())
    }
  }, [normalizedWorkspaceIds, workspaceIdListKey])
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

function extractWorkspaceStreamLiveDiagnosticTarget(event: ServerEvent) {
  const payload = asObject(event.payload)

  switch (event.method) {
    case 'item/started':
    case 'item/completed': {
      const item = asObject(payload.item)
      const metadata: ConversationLiveDiagnosticMetadata = {
        textLength: measureWorkspaceStreamItemTextLength(item),
      }
      return {
        itemId: stringField(item.id) || null,
        itemType: stringField(item.type) || null,
        metadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    }
    case 'item/agentMessage/delta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'agentMessage',
        metadata: { deltaLength: stringField(payload.delta).length } satisfies ConversationLiveDiagnosticMetadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/commandExecution/outputDelta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'commandExecution',
        metadata: { deltaLength: stringField(payload.delta).length } satisfies ConversationLiveDiagnosticMetadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/fileChange/outputDelta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'fileChange',
        metadata: { deltaLength: stringField(payload.delta).length } satisfies ConversationLiveDiagnosticMetadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/plan/delta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'plan',
        metadata: { deltaLength: stringField(payload.delta).length } satisfies ConversationLiveDiagnosticMetadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'turn/diff/updated':
      return {
        itemId: null,
        itemType: 'turnDiff',
        metadata: {
          deltaLength: measureWorkspaceStreamTurnDiffLength(payload),
        } satisfies ConversationLiveDiagnosticMetadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return {
        itemId: stringField(payload.itemId) || null,
        itemType: 'reasoning',
        metadata: { deltaLength: stringField(payload.delta).length } satisfies ConversationLiveDiagnosticMetadata,
        turnId: stringField(payload.turnId) || event.turnId || null,
      }
    default:
      return {
        itemId: null,
        itemType: null,
        metadata: undefined,
        turnId: event.turnId ?? null,
      }
  }
}

function measureWorkspaceStreamItemTextLength(item: Record<string, unknown>) {
  switch (stringField(item.type)) {
    case 'agentMessage':
    case 'plan':
      return stringField(item.text).length
    case 'commandExecution':
      return stringField(item.aggregatedOutput).length
    case 'reasoning':
      return [
        ...stringList(item.summary),
        ...stringList(item.content),
      ].join('\n').length
    case 'userMessage':
      return stringField(item.message).length
    default:
      return Math.max(
        stringField(item.text).length,
        stringField(item.message).length,
      )
  }
}

function measureWorkspaceStreamTurnDiffLength(payload: Record<string, unknown>) {
  const diff = payload.diff
  if (typeof diff === 'string') {
    return diff.length
  }

  const delta = payload.delta
  if (typeof delta === 'string') {
    return delta.length
  }

  if (typeof diff === 'object' && diff !== null) {
    try {
      return JSON.stringify(diff).length
    } catch {
      return 0
    }
  }

  return 0
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function subscribeWorkspaceStream(workspaceId: string, setConnectionState: ConnectionStateSetter) {
  const stream = getWorkspaceStream(workspaceId)
  stream.subscribers += 1
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'subscriber-added',
    `subscriber attached (${stream.subscribers})`,
    { subscribers: stream.subscribers },
  )
  scheduleWorkspaceStreamDiagnosticsChanged()
  startWorkspaceStreamCoordination(workspaceId, stream, setConnectionState)

  if (stream.closeTimer) {
    window.clearTimeout(stream.closeTimer)
    stream.closeTimer = undefined
  }

  ensureWorkspaceStreamLeadership(workspaceId, stream, setConnectionState)

  return () => {
    stream.subscribers = Math.max(0, stream.subscribers - 1)
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      'subscriber-removed',
      `subscriber detached (${stream.subscribers})`,
      { subscribers: stream.subscribers },
    )
    scheduleWorkspaceStreamDiagnosticsChanged()
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
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      'dispose-scheduled',
      'dispose scheduled after final subscriber left',
    )
    scheduleWorkspaceStreamDiagnosticsChanged()
  }
}

function getWorkspaceStream(workspaceId: string) {
  let stream = workspaceStreams.get(workspaceId)
  if (!stream) {
    stream = {
      channel: createWorkspaceStreamBroadcastChannel(workspaceId),
      deferredEvents: [],
      eventQueue: [],
      instanceId: getWorkspaceStreamInstanceId(),
      lastKnownConnectionState: 'idle',
      lifecycleEvents: [],
      peerSeenAt: {},
      subscribers: 0,
      socket: null,
      reconnectAttempt: 0,
    }
    bindWorkspaceStreamBroadcastChannel(workspaceId, stream)
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      'stream-created',
      stream.channel ? 'local stream manager created with broadcast coordination' : 'local stream manager created in direct mode',
      { coordinationMode: stream.channel ? 'broadcast' : 'direct' },
    )
    workspaceStreams.set(workspaceId, stream)
    scheduleWorkspaceStreamDiagnosticsChanged()
  }

  return stream
}

function openWorkspaceSocket(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (!stream.isLeader) {
    return
  }
  if (stream.socket && isSocketActive(stream.socket)) {
    return
  }

  if (stream.reconnectTimer) {
    window.clearTimeout(stream.reconnectTimer)
    stream.reconnectTimer = undefined
  }

  const socket = new WebSocket(
    buildApiWebSocketUrl(buildWorkspaceStreamPath(workspaceId, stream)),
  )
  stream.socket = socket
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'socket-opening',
    'opening workspace websocket',
    { reconnectAttempt: stream.reconnectAttempt },
  )
  scheduleWorkspaceStreamDiagnosticsChanged()
  frontendDebugLog('workspace-stream', 'opening websocket', {
    workspaceId,
    path: buildWorkspaceStreamPath(workspaceId, stream),
  })

  setWorkspaceConnectionState(workspaceId, stream, setConnectionState, 'connecting')

  socket.onopen = () => {
    if (stream.socket !== socket) {
      return
    }

    stream.reconnectAttempt = 0
    setWorkspaceConnectionState(workspaceId, stream, setConnectionState, 'open')
    frontendDebugLog('workspace-stream', 'websocket opened', { workspaceId })
    broadcastWorkspaceStreamHeartbeat(workspaceId, stream)
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      'socket-opened',
      'workspace websocket opened',
    )
    scheduleWorkspaceStreamDiagnosticsChanged()
  }

  socket.onmessage = (message) => {
    const event = parseWorkspaceStreamEvent(message.data)
    if (!event) {
      return
    }
    const diagnosticTarget = extractWorkspaceStreamLiveDiagnosticTarget(event)
    frontendDebugLog('workspace-stream', 'event received', summarizeServerEventForDebug(event))
    recordConversationLiveDiagnosticEvent({
      itemId: diagnosticTarget.itemId,
      itemType: diagnosticTarget.itemType,
      kind: 'stream-received',
      metadata: {
        ...(diagnosticTarget.metadata ?? {}),
        isBatchable: isBatchableWorkspaceEvent(event.method),
        isReplay: Boolean(event.replay),
        workspaceId: event.workspaceId,
      },
      method: event.method,
      serverRequestId: event.serverRequestId ?? null,
      source: 'workspace-stream',
      threadId: event.threadId ?? null,
      turnId: diagnosticTarget.turnId,
    })
    handleWorkspaceStreamEvent(stream, event)
    broadcastWorkspaceStreamEvent(workspaceId, stream, event)
  }

  socket.onerror = () => {
    if (stream.socket !== socket) {
      return
    }

    setWorkspaceConnectionState(workspaceId, stream, setConnectionState, 'error')
    frontendDebugLog('workspace-stream', 'websocket error', { workspaceId })
    broadcastWorkspaceStreamHeartbeat(workspaceId, stream)
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      'socket-error',
      'workspace websocket signaled an error',
    )
    scheduleWorkspaceStreamDiagnosticsChanged()
  }

  socket.onclose = () => {
    if (stream.socket === socket) {
      stream.socket = null
    }
    scheduleWorkspaceStreamDiagnosticsChanged()

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
      setWorkspaceConnectionState(workspaceId, stream, setConnectionState, 'idle')
      workspaceStreams.delete(workspaceId)
      frontendDebugLog('workspace-stream', 'websocket closed without subscribers', { workspaceId })
      recordWorkspaceStreamLifecycleEvent(
        workspaceId,
        stream,
        'socket-closed',
        'workspace websocket closed after subscribers reached zero',
      )
      scheduleWorkspaceStreamDiagnosticsChanged()
      return
    }

    setWorkspaceConnectionState(workspaceId, stream, setConnectionState, 'closed')
    frontendDebugLog('workspace-stream', 'websocket closed, scheduling reconnect', {
      workspaceId,
      reconnectAttempt: stream.reconnectAttempt,
    })
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      'socket-closed',
      'workspace websocket closed while subscribers are still attached',
      { subscribers: stream.subscribers },
    )
    scheduleReconnect(workspaceId, stream, setConnectionState)
    scheduleWorkspaceStreamDiagnosticsChanged()
  }
}

function buildWorkspaceStreamPath(workspaceId: string, stream?: WorkspaceStream) {
  const params = new URLSearchParams()
  const afterSeq = useSessionStore.getState().lastEventSeqByWorkspace[workspaceId]
  if (typeof afterSeq === 'number' && Number.isFinite(afterSeq) && afterSeq > 0) {
    params.set('afterSeq', String(afterSeq))
  }

  const resumeState = buildCommandResumeStateParam(workspaceId)
  if (resumeState) {
    params.set('commandResumeState', resumeState)
  }

  if (stream?.instanceId) {
    params.set('streamInstanceId', stream.instanceId)
  }
  if (stream) {
    params.set(
      'streamClientRole',
      stream.channel ? 'leader' : 'direct',
    )
  }

  const query = params.toString()
  return query
    ? `/api/workspaces/${workspaceId}/stream?${query}`
    : `/api/workspaces/${workspaceId}/stream`
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
  if (stream.reconnectTimer || stream.subscribers === 0 || !stream.isLeader) {
    return
  }

  const delay = reconnectDelaysMs[Math.min(stream.reconnectAttempt, reconnectDelaysMs.length - 1)]
  stream.reconnectAttempt += 1
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'reconnect-scheduled',
    `reconnect scheduled in ${delay}ms`,
    {
      delayMs: delay,
      reconnectAttempt: stream.reconnectAttempt,
    },
  )
  scheduleWorkspaceStreamDiagnosticsChanged()
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

    openWorkspaceSocket(workspaceId, stream, setConnectionState)
  }, delay)
  scheduleWorkspaceStreamDiagnosticsChanged()
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
  if (stream.isLeader) {
    broadcastWorkspaceStreamRelease(workspaceId, stream)
  }
  stopWorkspaceStreamCoordination(workspaceId, stream)
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'stream-disposed',
    'disposed local workspace stream manager',
  )

  const socket = stream.socket
  stream.socket = null
  workspaceStreams.delete(workspaceId)
  scheduleWorkspaceStreamDiagnosticsChanged()

  if (socket && socket.readyState !== WebSocket.CLOSED) {
    socket.onopen = null
    socket.onmessage = null
    socket.onerror = null
    socket.onclose = null
    socket.close()
  }

  stream.isLeader = false
  stream.leaderId = undefined
  stream.lastLeaderHeartbeatAt = undefined
  setWorkspaceConnectionState(workspaceId, stream, setConnectionState, 'idle')
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function isSocketActive(socket: WebSocket) {
  return socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN
}

function startWorkspaceStreamCoordination(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (stream.activityTimer) {
    return
  }

  broadcastWorkspaceStreamPresence(workspaceId, stream)
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'coordination-started',
    stream.channel ? 'broadcast coordination loop started' : 'direct coordination loop started',
    { coordinationMode: stream.channel ? 'broadcast' : 'direct' },
  )
  scheduleWorkspaceStreamDiagnosticsChanged()
  stream.activityTimer = window.setInterval(() => {
    broadcastWorkspaceStreamPresence(workspaceId, stream)
    if (stream.isLeader) {
      broadcastWorkspaceStreamHeartbeat(workspaceId, stream)
      return
    }

    ensureWorkspaceStreamLeadership(workspaceId, stream, setConnectionState)
  }, workspaceStreamLeaderHeartbeatIntervalMs)

  window.setTimeout(() => {
    if (stream.subscribers <= 0) {
      return
    }
    ensureWorkspaceStreamLeadership(workspaceId, stream, setConnectionState)
  }, workspaceLeaderElectionDelayMs)
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function stopWorkspaceStreamCoordination(workspaceId: string, stream: WorkspaceStream) {
  if (stream.activityTimer) {
    window.clearInterval(stream.activityTimer)
    stream.activityTimer = undefined
  }
  if (stream.channel) {
    stream.channel.onmessage = null
    stream.channel.close()
    stream.channel = null
  }
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'coordination-stopped',
    'workspace coordination loop stopped',
  )
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function ensureWorkspaceStreamLeadership(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (stream.subscribers <= 0) {
    return
  }

  const now = Date.now()
  const currentLeaderIsFresh =
    stream.leaderId &&
    stream.lastLeaderHeartbeatAt !== undefined &&
    now - stream.lastLeaderHeartbeatAt <= workspaceStreamLeaderStaleAfterMs

  const preferredLeader = selectWorkspaceStreamLeaderCandidate(
    stream.instanceId,
    stream.peerSeenAt,
    now,
    workspaceStreamLeaderStaleAfterMs,
  )

  if (currentLeaderIsFresh && stream.leaderId !== stream.instanceId && preferredLeader !== stream.instanceId) {
    setWorkspaceConnectionState(
      workspaceId,
      stream,
      setConnectionState,
      stream.lastKnownConnectionState ?? 'connecting',
    )
    scheduleWorkspaceStreamDiagnosticsChanged()
    return
  }

  becomeWorkspaceStreamLeader(workspaceId, stream, setConnectionState)
}

function becomeWorkspaceStreamLeader(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
) {
  if (stream.isLeader) {
    openWorkspaceSocket(workspaceId, stream, setConnectionState)
    return
  }

  stream.isLeader = true
  stream.leaderId = stream.instanceId
  stream.lastLeaderHeartbeatAt = Date.now()
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'became-leader',
    'local tab became workspace stream leader',
    { instanceId: stream.instanceId },
  )
  scheduleWorkspaceStreamDiagnosticsChanged()
  frontendDebugLog('workspace-stream', 'tab elected as leader', {
    workspaceId,
    instanceId: stream.instanceId,
  })
  broadcastWorkspaceStreamHeartbeat(workspaceId, stream)
  openWorkspaceSocket(workspaceId, stream, setConnectionState)
}

function becomeWorkspaceStreamFollower(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
  leaderId: string,
  connectionState: string,
) {
  const previousLeaderId = stream.leaderId
  const previousIsLeader = Boolean(stream.isLeader)
  stream.leaderId = leaderId
  stream.lastLeaderHeartbeatAt = Date.now()
  if (stream.isLeader) {
    frontendDebugLog('workspace-stream', 'yielding leadership to peer tab', {
      workspaceId,
      instanceId: stream.instanceId,
      leaderId,
    })
    closeWorkspaceSocket(workspaceId, stream)
  }
  stream.isLeader = false
  setWorkspaceConnectionState(workspaceId, stream, setConnectionState, connectionState)
  if (previousIsLeader || previousLeaderId !== leaderId) {
    recordWorkspaceStreamLifecycleEvent(
      workspaceId,
      stream,
      previousIsLeader ? 'yielded-leader' : 'observed-leader',
      previousIsLeader
        ? `yielded leadership to ${leaderId}`
        : `following leader ${leaderId}`,
      {
        connectionState,
        leaderId,
      },
    )
  }
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function bindWorkspaceStreamBroadcastChannel(workspaceId: string, stream: WorkspaceStream) {
  if (!stream.channel) {
    return
  }

  stream.channel.onmessage = (message: MessageEvent<WorkspaceStreamBroadcastMessage>) => {
    const payload = message.data
    if (!payload || payload.workspaceId !== workspaceId || payload.instanceId === stream.instanceId) {
      return
    }

    switch (payload.type) {
      case 'presence':
        stream.peerSeenAt[payload.instanceId] = payload.ts
        scheduleWorkspaceStreamDiagnosticsChanged()
        if (stream.isLeader) {
          broadcastWorkspaceStreamHeartbeat(workspaceId, stream)
        }
        break
      case 'heartbeat':
        stream.peerSeenAt[payload.instanceId] = payload.ts
        scheduleWorkspaceStreamDiagnosticsChanged()
        if (stream.isLeader && shouldYieldWorkspaceStreamLeadership(stream.instanceId, payload.instanceId)) {
          becomeWorkspaceStreamFollower(
            workspaceId,
            stream,
            useSessionStore.getState().setConnectionState,
            payload.instanceId,
            payload.connectionState,
          )
          return
        }
        if (!stream.isLeader || payload.instanceId !== stream.instanceId) {
          becomeWorkspaceStreamFollower(
            workspaceId,
            stream,
            useSessionStore.getState().setConnectionState,
            payload.instanceId,
            payload.connectionState,
          )
        }
        break
      case 'release':
        if (stream.leaderId === payload.instanceId) {
          stream.leaderId = undefined
          stream.lastLeaderHeartbeatAt = undefined
          recordWorkspaceStreamLifecycleEvent(
            workspaceId,
            stream,
            'leader-released',
            `leader ${payload.instanceId} released coordination`,
          )
          scheduleWorkspaceStreamDiagnosticsChanged()
          ensureWorkspaceStreamLeadership(
            workspaceId,
            stream,
            useSessionStore.getState().setConnectionState,
          )
        }
        break
      case 'event':
        if (!isServerEvent(payload.event)) {
          return
        }
        frontendDebugLog('workspace-stream', 'event received via broadcast channel', {
          workspaceId,
          method: payload.event.method,
        })
        handleWorkspaceStreamEvent(stream, payload.event)
        break
    }
  }
}

function broadcastWorkspaceStreamPresence(workspaceId: string, stream: WorkspaceStream) {
  stream.channel?.postMessage({
    type: 'presence',
    workspaceId,
    instanceId: stream.instanceId,
    ts: Date.now(),
  } satisfies WorkspaceStreamBroadcastMessage)
}

function broadcastWorkspaceStreamHeartbeat(workspaceId: string, stream: WorkspaceStream) {
  stream.channel?.postMessage({
    type: 'heartbeat',
    workspaceId,
    instanceId: stream.instanceId,
    ts: Date.now(),
    connectionState: (stream.lastKnownConnectionState ?? 'idle') as
      | 'idle'
      | 'connecting'
      | 'open'
      | 'closed'
      | 'error',
  } satisfies WorkspaceStreamBroadcastMessage)
}

function broadcastWorkspaceStreamRelease(workspaceId: string, stream: WorkspaceStream) {
  stream.channel?.postMessage({
    type: 'release',
    workspaceId,
    instanceId: stream.instanceId,
    ts: Date.now(),
  } satisfies WorkspaceStreamBroadcastMessage)
}

function broadcastWorkspaceStreamEvent(
  workspaceId: string,
  stream: WorkspaceStream,
  event: ServerEvent,
) {
  if (!stream.isLeader) {
    return
  }

  stream.channel?.postMessage({
    type: 'event',
    workspaceId,
    instanceId: stream.instanceId,
    event,
  } satisfies WorkspaceStreamBroadcastMessage)
}

function closeWorkspaceSocket(workspaceId: string, stream: WorkspaceStream) {
  if (stream.reconnectTimer) {
    window.clearTimeout(stream.reconnectTimer)
    stream.reconnectTimer = undefined
  }

  const socket = stream.socket
  stream.socket = null
  scheduleWorkspaceStreamDiagnosticsChanged()
  if (!socket || socket.readyState === WebSocket.CLOSED) {
    return
  }

  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'socket-close-requested',
    'local tab requested websocket close',
  )
  socket.onopen = null
  socket.onmessage = null
  socket.onerror = null
  socket.onclose = null
  socket.close()
}

function setWorkspaceConnectionState(
  workspaceId: string,
  stream: WorkspaceStream,
  setConnectionState: ConnectionStateSetter,
  state: string,
) {
  stream.lastKnownConnectionState = state
  setConnectionState(workspaceId, state)
  scheduleWorkspaceStreamDiagnosticsChanged()
  if (stream.isLeader) {
    broadcastWorkspaceStreamHeartbeat(workspaceId, stream)
  }
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
      scheduleWorkspaceStreamDiagnosticsChanged()
      handlers.scheduleDeferredFlush(stream)
      return
    }

    handlers.ingestImmediateEvent(event)
    emitWorkspaceStreamEvents([event])
    return
  }

  stream.eventQueue.push(event)
  scheduleWorkspaceStreamDiagnosticsChanged()
  handlers.scheduleQueuedFlush(stream)
}

function scheduleWorkspaceStreamFlush(stream: WorkspaceStream) {
  if (stream.flushTimer) {
    return
  }

  stream.flushTimer = window.setTimeout(() => {
    stream.flushTimer = undefined
    scheduleWorkspaceStreamDiagnosticsChanged()
    flushWorkspaceStreamEvents(stream)
  }, streamBatchFlushDelayMs)
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function flushWorkspaceStreamEvents(stream: WorkspaceStream) {
  if (!stream.eventQueue.length) {
    return
  }

  const queuedEvents = stream.eventQueue
  stream.eventQueue = []
  scheduleWorkspaceStreamDiagnosticsChanged()
  const lastEvent = queuedEvents[queuedEvents.length - 1]
  frontendDebugLog('workspace-stream', 'flushing queued delta events', {
    count: queuedEvents.length,
    methods: queuedEvents.map((event) => event.method),
    lastEvent: summarizeServerEventForDebug(lastEvent),
  })
  recordConversationLiveDiagnosticEvent({
    kind: 'stream-batch-flush',
    metadata: {
      count: queuedEvents.length,
      queuedCount: queuedEvents.length,
      uniqueMethods: new Set(queuedEvents.map((event) => event.method)).size,
    },
    method: lastEvent?.method,
    serverRequestId: lastEvent?.serverRequestId ?? null,
    source: 'workspace-stream',
    threadId: lastEvent?.threadId ?? null,
    turnId: lastEvent?.turnId ?? null,
  })
  recordWorkspaceStreamLifecycleEvent(
    lastEvent?.workspaceId ?? 'unknown',
    stream,
    'queued-events-flushed',
    `flushed ${queuedEvents.length} queued delta events`,
    {
      count: queuedEvents.length,
      lastMethod: lastEvent?.method ?? null,
    },
  )
  useSessionStore.getState().ingestEvents(queuedEvents)
  emitWorkspaceStreamEvents(queuedEvents)
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
    scheduleWorkspaceStreamDiagnosticsChanged()
    flushDeferredWorkspaceEvents(stream)
  })
  scheduleWorkspaceStreamDiagnosticsChanged()
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
  scheduleWorkspaceStreamDiagnosticsChanged()
}

function flushDeferredWorkspaceEvents(stream: WorkspaceStream) {
  if (!stream.deferredEvents.length) {
    return
  }

  const deferredEvents = stream.deferredEvents
  stream.deferredEvents = []
  scheduleWorkspaceStreamDiagnosticsChanged()
  const lastEvent = deferredEvents[deferredEvents.length - 1]
  frontendDebugLog('workspace-stream', 'flushing deferred non-delta events', {
    count: deferredEvents.length,
    methods: deferredEvents.map((event) => event.method),
    lastEvent: summarizeServerEventForDebug(lastEvent),
  })
  recordConversationLiveDiagnosticEvent({
    kind: 'stream-deferred-flush',
    metadata: {
      count: deferredEvents.length,
      deferredCount: deferredEvents.length,
      uniqueMethods: new Set(deferredEvents.map((event) => event.method)).size,
    },
    method: lastEvent?.method,
    serverRequestId: lastEvent?.serverRequestId ?? null,
    source: 'workspace-stream',
    threadId: lastEvent?.threadId ?? null,
    turnId: lastEvent?.turnId ?? null,
  })
  recordWorkspaceStreamLifecycleEvent(
    lastEvent?.workspaceId ?? 'unknown',
    stream,
    'deferred-events-flushed',
    `flushed ${deferredEvents.length} deferred events`,
    {
      count: deferredEvents.length,
      lastMethod: lastEvent?.method ?? null,
    },
  )
  useSessionStore.getState().ingestEvents(deferredEvents)
  emitWorkspaceStreamEvents(deferredEvents)
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

function useNormalizedWorkspaceIds(workspaceIds?: string[]) {
  const workspaceIdListKey = useMemo(
    () => normalizeWorkspaceIds(workspaceIds).join(workspaceIdListSeparator),
    [workspaceIds],
  )

  return useMemo(
    () => (workspaceIdListKey ? workspaceIdListKey.split(workspaceIdListSeparator) : []),
    [workspaceIdListKey],
  )
}

function normalizeWorkspaceIds(workspaceIds?: string[]) {
  return Array.from(
    new Set(
      (workspaceIds ?? [])
        .map((workspaceId) => workspaceId.trim())
        .filter((workspaceId) => workspaceId.length > 0),
    ),
  ).sort()
}

function subscribeWorkspaceEventListener(
  workspaceId: string,
  listener: (event: ServerEvent) => void,
) {
  let listeners = workspaceEventListeners.get(workspaceId)
  if (!listeners) {
    listeners = new Set()
    workspaceEventListeners.set(workspaceId, listeners)
  }

  listeners.add(listener)

  return () => {
    const currentListeners = workspaceEventListeners.get(workspaceId)
    if (!currentListeners) {
      return
    }

    currentListeners.delete(listener)
    if (currentListeners.size === 0) {
      workspaceEventListeners.delete(workspaceId)
    }
  }
}

function emitWorkspaceStreamEvents(events: ServerEvent[]) {
  for (const event of events) {
    const listeners = workspaceEventListeners.get(event.workspaceId)
    if (!listeners?.size) {
      continue
    }

    for (const listener of [...listeners]) {
      try {
        listener(event)
      } catch (error) {
        frontendDebugLog('workspace-stream', 'event listener failed', {
          error: error instanceof Error ? error.message : String(error),
          method: event.method,
          workspaceId: event.workspaceId,
        })
      }
    }
  }
}
