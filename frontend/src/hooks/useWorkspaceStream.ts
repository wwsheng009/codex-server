import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'

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
import { i18n } from '../i18n/runtime'
import { dispatchWorkspaceStreamRecoveryRequired } from '../lib/workspace-stream-recovery'
import { useSessionStore } from '../stores/session-store'
import type { ServerEvent } from '../types/api'
import type { ConversationLiveDiagnosticMetadata } from '../components/workspace/threadConversationProfilerTypes'
import type {
  ConnectionStateSetter,
  WorkspaceStreamLifecycleEvent,
  WorkspaceStreamLocalDiagnostics,
  WorkspaceStreamManagerDiagnostics,
  WorkspaceStreamRecoveryNotice,
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
const workspaceFollowerRecoveryRequestCooldownMs = 1_000
const workspaceStreamRecoveryProblemNoticeTtlMs = 2 * 60_000
const workspaceStreamRecoverySnapshotNoticeTtlMs = 2 * 60_000
const workspaceStreamRecoveryRecoveredNoticeTtlMs = 30_000
const workspaceStreamDiagnosticsEmitThrottleMs = 100
let workspaceStreamDiagnosticsEmitScheduled = false
let workspaceStreamDiagnosticsDirty = true
let workspaceStreamDiagnosticsSnapshotCache: WorkspaceStreamManagerDiagnostics | null = null

const workspaceStreamRecoveryProblemKinds = new Set([
  'events-dropped',
  'follower-recovery-accepted',
  'follower-recovery-request-failed',
  'follower-recovery-requested',
  'reconnect-scheduled',
  'replay-continuation-requested',
  'replay-incomplete',
  'replay-incomplete-stalled',
  'seq-gap-detected',
  'socket-closed',
  'socket-error',
])

const workspaceStreamRecoveryStableKinds = new Set([
  'replay-completed',
  'socket-opened',
])

type WorkspaceStreamEventHandlers = {
  flushQueuedEvents: (stream: WorkspaceStream) => void
  ingestImmediateEvent: (event: ServerEvent) => void
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

export function buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
  diagnostics: WorkspaceStreamManagerDiagnostics,
  workspaceId?: string,
  nowMs: number = Date.now(),
): WorkspaceStreamRecoveryNotice | null {
  const normalizedWorkspaceId = workspaceId?.trim()
  if (!normalizedWorkspaceId) {
    return null
  }

  const stream = diagnostics.streams.find(
    (candidate) => candidate.workspaceId === normalizedWorkspaceId,
  )
  if (!stream || stream.subscribers <= 0) {
    return null
  }

  const recentEvents = stream.recentLifecycleEvents ?? []
  const latestEvent = stream.latestLifecycleEvent ?? recentEvents.at(-1) ?? null
  const latestProblemEvent = findLatestWorkspaceStreamLifecycleEvent(
    recentEvents,
    (event) => workspaceStreamRecoveryProblemKinds.has(event.kind),
  )
  const latestSnapshotEvent = findLatestWorkspaceStreamLifecycleEvent(
    recentEvents,
    (event) => event.kind === 'snapshot-fallback-requested',
  )
  const latestStableEvent = findLatestWorkspaceStreamLifecycleEvent(
    recentEvents,
    (event) => workspaceStreamRecoveryStableKinds.has(event.kind),
  )

  if (isWorkspaceStreamActivelyReconnecting(stream)) {
    return buildWorkspaceStreamRecoveryNotice({
      event: latestProblemEvent ?? latestEvent,
      expiresAt: null,
      message: i18n._({
        id: 'workspace-stream.reconnecting.message',
        message:
          'Live updates paused briefly. The page is reconnecting and will replay missed workspace and thread events automatically.',
      }),
      reason: 'connection-reconnecting',
      stream,
      title: i18n._({
        id: 'workspace-stream.reconnecting.title',
        message: 'Realtime sync is reconnecting',
      }),
      tone: 'error',
    })
  }

  const latestProblemTs = latestProblemEvent
    ? parseWorkspaceStreamLifecycleEventTs(latestProblemEvent)
    : null
  const latestSnapshotTs = latestSnapshotEvent
    ? parseWorkspaceStreamLifecycleEventTs(latestSnapshotEvent)
    : null

  if (
    latestSnapshotEvent &&
    latestSnapshotTs !== null &&
    isWorkspaceStreamEventWithinTtl(
      latestSnapshotEvent,
      nowMs,
      workspaceStreamRecoverySnapshotNoticeTtlMs,
    )
  ) {
    return buildWorkspaceStreamRecoveryNotice({
      event: latestSnapshotEvent,
      expiresAt:
        parseWorkspaceStreamLifecycleEventTs(latestSnapshotEvent) +
        workspaceStreamRecoverySnapshotNoticeTtlMs,
      message: i18n._({
        id: 'workspace-stream.snapshotFallback.message',
        message:
          'Some live events could not be replayed, so workspace and thread snapshots were refreshed to catch up.',
      }),
      reason: 'snapshot-fallback',
      stream,
      title: i18n._({
        id: 'workspace-stream.snapshotFallback.title',
        message: 'Realtime sync refreshed from snapshots',
      }),
      tone: 'info',
    })
  }

  if (latestProblemEvent && latestProblemTs !== null) {
    const stableAfterProblem =
      latestStableEvent &&
      parseWorkspaceStreamLifecycleEventTs(latestStableEvent) >= latestProblemTs

    if (
      stableAfterProblem &&
      isWorkspaceStreamEventWithinTtl(
        latestStableEvent,
        nowMs,
        workspaceStreamRecoveryRecoveredNoticeTtlMs,
      )
    ) {
      return buildWorkspaceStreamRecoveryNotice({
        event: latestStableEvent,
        expiresAt:
          parseWorkspaceStreamLifecycleEventTs(latestStableEvent) +
          workspaceStreamRecoveryRecoveredNoticeTtlMs,
        message: i18n._({
          id: 'workspace-stream.recovered.message',
          message:
            'Missed live events have been replayed or refreshed from snapshots. New user input and backend events should render normally.',
        }),
        reason: 'recovered',
        stream,
        title: i18n._({
          id: 'workspace-stream.recovered.title',
          message: 'Realtime sync recovered',
        }),
        tone: 'info',
      })
    }

    if (
      !stableAfterProblem &&
      isWorkspaceStreamEventWithinTtl(
        latestProblemEvent,
        nowMs,
        workspaceStreamRecoveryProblemNoticeTtlMs,
      )
    ) {
      return buildWorkspaceStreamRecoveryNotice({
        event: latestProblemEvent,
        expiresAt:
          latestProblemTs + workspaceStreamRecoveryProblemNoticeTtlMs,
        message: i18n._({
          id: 'workspace-stream.recovering.message',
          message:
            'Some live events arrived out of order or were dropped. The page is replaying missed workspace and thread events before applying newer updates.',
        }),
        reason: 'event-recovery',
        stream,
        title: i18n._({
          id: 'workspace-stream.recovering.title',
          message: 'Realtime sync is recovering',
        }),
        tone: 'error',
      })
    }
  }

  return null
}

function scheduleWorkspaceStreamDiagnosticsChanged() {
  workspaceStreamDiagnosticsDirty = true
  if (workspaceStreamDiagnosticsListeners.size === 0) {
    return
  }
  if (workspaceStreamDiagnosticsEmitScheduled) {
    return
  }

  workspaceStreamDiagnosticsEmitScheduled = true
  const emitDiagnosticsChanged = () => {
    workspaceStreamDiagnosticsEmitScheduled = false
    for (const listener of [...workspaceStreamDiagnosticsListeners]) {
      listener()
    }
  }

  if (typeof globalThis.setTimeout !== 'function') {
    queueMicrotask(emitDiagnosticsChanged)
    return
  }

  globalThis.setTimeout(emitDiagnosticsChanged, workspaceStreamDiagnosticsEmitThrottleMs)
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

function findLatestWorkspaceStreamLifecycleEvent(
  events: WorkspaceStreamLifecycleEvent[],
  predicate: (event: WorkspaceStreamLifecycleEvent) => boolean,
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && predicate(event)) {
      return event
    }
  }

  return null
}

function parseWorkspaceStreamLifecycleEventTs(event: WorkspaceStreamLifecycleEvent) {
  const timestamp = Date.parse(event.ts)
  return Number.isFinite(timestamp) ? timestamp : 0
}

function isWorkspaceStreamEventWithinTtl(
  event: WorkspaceStreamLifecycleEvent,
  nowMs: number,
  ttlMs: number,
) {
  const eventTs = parseWorkspaceStreamLifecycleEventTs(event)
  if (eventTs <= 0) {
    return false
  }

  return Math.max(0, nowMs - eventTs) <= ttlMs
}

function isWorkspaceStreamActivelyReconnecting(
  stream: WorkspaceStreamLocalDiagnostics,
) {
  return (
    stream.reconnectScheduled ||
    stream.lastKnownConnectionState === 'closed' ||
    stream.lastKnownConnectionState === 'error'
  )
}

function buildWorkspaceStreamRecoveryNotice({
  event,
  expiresAt,
  message,
  reason,
  stream,
  title,
  tone,
}: {
  event?: WorkspaceStreamLifecycleEvent | null
  expiresAt?: number | null
  message: string
  reason: WorkspaceStreamRecoveryNotice['reason']
  stream: WorkspaceStreamLocalDiagnostics
  title: string
  tone: WorkspaceStreamRecoveryNotice['tone']
}): WorkspaceStreamRecoveryNotice {
  const eventKey = event ? `${event.kind}-${event.ts}` : 'no-event'
  return {
    details: buildWorkspaceStreamRecoveryNoticeDetails(stream, reason, event),
    expiresAt,
    latestEventKind: event?.kind,
    latestEventTs: event?.ts,
    message,
    noticeKey: `workspace-stream-${stream.workspaceId}-${reason}-${eventKey}-${stream.lastKnownConnectionState}-${stream.reconnectAttempt}`,
    reason,
    title,
    tone,
  }
}

function buildWorkspaceStreamRecoveryNoticeDetails(
  stream: WorkspaceStreamLocalDiagnostics,
  reason: WorkspaceStreamRecoveryNotice['reason'],
  event?: WorkspaceStreamLifecycleEvent | null,
) {
  const lines = [
    `Workspace ID: ${stream.workspaceId}`,
    `Notice reason: ${reason}`,
    `Connection state: ${stream.lastKnownConnectionState}`,
    `Socket state: ${stream.socketState}`,
    `Reconnect scheduled: ${stream.reconnectScheduled ? 'yes' : 'no'}`,
    `Reconnect attempt: ${stream.reconnectAttempt}`,
    `Coordination: ${stream.coordinationMode}${stream.isLeader ? ' leader' : ' follower'}`,
    `Queue length: ${stream.queueLength}`,
  ]

  if (event) {
    lines.push(
      `Latest lifecycle event: ${event.kind}`,
      `Latest lifecycle timestamp: ${event.ts}`,
      `Latest lifecycle summary: ${event.summary}`,
    )

    if (event.metadata) {
      try {
        lines.push(`Latest lifecycle metadata: ${JSON.stringify(event.metadata, null, 2)}`)
      } catch {
        lines.push('Latest lifecycle metadata: [unserializable]')
      }
    }
  }

  return lines.join('\n')
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

export function useWorkspaceStreamRecoveryNotice(workspaceId?: string) {
  const diagnostics = useSyncExternalStore(
    subscribeWorkspaceStreamManagerDiagnostics,
    getWorkspaceStreamManagerDiagnosticsSnapshot,
    getWorkspaceStreamManagerDiagnosticsSnapshot,
  )
  const [expiryTick, setExpiryTick] = useState(0)
  const notice = useMemo(
    () =>
      buildWorkspaceStreamRecoveryNoticeFromDiagnostics(
        diagnostics,
        workspaceId,
        Date.now(),
      ),
    [diagnostics, expiryTick, workspaceId],
  )

  useEffect(() => {
    if (!notice?.expiresAt) {
      return
    }

    const timeoutMs = Math.max(0, notice.expiresAt - Date.now() + 50)
    const timeoutId = window.setTimeout(() => {
      setExpiryTick((current) => current + 1)
    }, timeoutMs)

    return () => window.clearTimeout(timeoutId)
  }, [notice?.expiresAt, notice?.noticeKey])

  return notice
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

  const replayAfterSeqOverride = stream.replayAfterSeqOverride
  stream.replayAfterSeqOverride = undefined
  const socketPath = buildWorkspaceStreamPath(workspaceId, stream, replayAfterSeqOverride)
  const socket = new WebSocket(buildApiWebSocketUrl(socketPath))
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
    path: socketPath,
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
    if (handleWorkspaceStreamEvent(stream, event)) {
      broadcastWorkspaceStreamEvent(workspaceId, stream, event)
    }
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

    if (stream.flushTimer) {
      window.clearTimeout(stream.flushTimer)
      stream.flushTimer = undefined
    }
    flushWorkspaceStreamEvents(stream)

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

function buildWorkspaceStreamPath(
  workspaceId: string,
  stream?: WorkspaceStream,
  afterSeqOverride?: number,
) {
  const params = new URLSearchParams()
  const afterSeq =
    typeof afterSeqOverride === 'number' && Number.isFinite(afterSeqOverride)
      ? Math.max(0, Math.floor(afterSeqOverride))
      : useSessionStore.getState().lastEventSeqByWorkspace[workspaceId]
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

  const delay =
    stream.reconnectDelayOverrideMs !== undefined
      ? stream.reconnectDelayOverrideMs
      : reconnectDelaysMs[Math.min(stream.reconnectAttempt, reconnectDelaysMs.length - 1)]
  stream.reconnectDelayOverrideMs = undefined
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

  flushWorkspaceStreamEvents(stream)
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
    handleWorkspaceStreamBroadcastMessage(workspaceId, stream, message.data)
  }
}

export function handleWorkspaceStreamBroadcastMessage(
  workspaceId: string,
  stream: WorkspaceStream,
  payload: WorkspaceStreamBroadcastMessage,
  setConnectionState: ConnectionStateSetter = useSessionStore.getState().setConnectionState,
) {
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
          setConnectionState,
          payload.instanceId,
          payload.connectionState,
        )
        return
      }
      if (!stream.isLeader || payload.instanceId !== stream.instanceId) {
        becomeWorkspaceStreamFollower(
          workspaceId,
          stream,
          setConnectionState,
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
        ensureWorkspaceStreamLeadership(workspaceId, stream, setConnectionState)
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
    case 'recovery-request':
      stream.peerSeenAt[payload.instanceId] = payload.ts
      scheduleWorkspaceStreamDiagnosticsChanged()
      handleWorkspaceStreamFollowerRecoveryRequest(
        workspaceId,
        stream,
        payload,
        setConnectionState,
      )
      break
  }
}

function handleWorkspaceStreamFollowerRecoveryRequest(
  workspaceId: string,
  stream: WorkspaceStream,
  payload: Extract<WorkspaceStreamBroadcastMessage, { type: 'recovery-request' }>,
  setConnectionState: ConnectionStateSetter,
) {
  if (!stream.isLeader) {
    return
  }

  const requestedAfterSeq = finiteNonNegativeNumber(payload.afterSeq)
  if (requestedAfterSeq === null) {
    return
  }

  const currentOverride = finiteNonNegativeNumber(stream.replayAfterSeqOverride)
  const replayAfterSeq =
    currentOverride === null
      ? requestedAfterSeq
      : Math.min(currentOverride, requestedAfterSeq)
  stream.replayAfterSeqOverride = replayAfterSeq
  stream.reconnectDelayOverrideMs = 0

  frontendDebugLog('workspace-stream', 'follower requested workspace replay recovery', {
    afterSeq: requestedAfterSeq,
    expectedSeq: payload.expectedSeq,
    followerInstanceId: payload.instanceId,
    method: payload.method,
    receivedSeq: payload.receivedSeq,
    replayAfterSeq,
    workspaceId,
  })
  recordWorkspaceStreamLifecycleEvent(
    workspaceId,
    stream,
    'follower-recovery-accepted',
    `accepted follower replay recovery request after seq ${requestedAfterSeq}`,
    {
      afterSeq: requestedAfterSeq,
      expectedSeq: payload.expectedSeq,
      followerInstanceId: payload.instanceId,
      method: payload.method ?? null,
      receivedSeq: payload.receivedSeq,
      replayAfterSeq,
      threadId: payload.threadId ?? null,
      turnId: payload.turnId ?? null,
    },
  )

  if (stream.reconnectTimer) {
    window.clearTimeout(stream.reconnectTimer)
    stream.reconnectTimer = undefined
  }

  const socket = stream.socket
  if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.close()
    return
  }

  scheduleReconnect(workspaceId, stream, setConnectionState)
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
    scheduleQueuedFlush: scheduleWorkspaceStreamFlush,
  },
): boolean {
  if (!isBatchableWorkspaceEvent(event.method)) {
    if (stream.eventQueue.length > 0) {
      handlers.flushQueuedEvents(stream)
      resetWorkspaceStreamQueuedSeq(stream)
    }

    if (event.method === 'workspace/replay/completed') {
      handleWorkspaceReplayCompletedEvent(stream, event)
      return false
    }
    if (event.method === 'workspace/events/dropped') {
      handleWorkspaceEventsDroppedEvent(stream, event)
      return false
    }

    const gap = detectWorkspaceSeqGapBeforeApply([event])
    if (gap) {
      requestWorkspaceStreamSeqRecovery(stream, event, gap)
      return false
    }

    handlers.ingestImmediateEvent(event)
    emitWorkspaceStreamEvents([event])
    return true
  }

  const gap = detectWorkspaceSeqGapForQueuedEvent(stream, event)
  if (gap) {
    scheduleWorkspaceStreamDiagnosticsChanged()
    if (stream.eventQueue.length > 0) {
      handlers.flushQueuedEvents(stream)
      resetWorkspaceStreamQueuedSeq(stream)
    }
    requestWorkspaceStreamSeqRecovery(stream, gap.event, gap)
    return false
  }

  stream.eventQueue.push(event)
  recordWorkspaceStreamQueuedSeq(stream, event)
  scheduleWorkspaceStreamDiagnosticsChanged()
  handlers.scheduleQueuedFlush(stream)
  return true
}

type WorkspaceSeqGap = {
  event: ServerEvent
  expectedSeq: number
  receivedSeq: number
  workspaceId: string
}

function splitWorkspaceEventsAtSeqGap(events: ServerEvent[]) {
  const workingSeqByWorkspace = {
    ...useSessionStore.getState().lastEventSeqByWorkspace,
  }
  const acceptedEvents: ServerEvent[] = []

  for (const event of events) {
    const gap = detectWorkspaceSeqGap(event, workingSeqByWorkspace)
    if (gap) {
      return { acceptedEvents, gap }
    }

    acceptedEvents.push(event)
    updateWorkingWorkspaceSeq(event, workingSeqByWorkspace)
  }

  return { acceptedEvents, gap: null as WorkspaceSeqGap | null }
}

function detectWorkspaceSeqGapBeforeApply(events: ServerEvent[]) {
  return splitWorkspaceEventsAtSeqGap(events).gap
}

function detectWorkspaceSeqGapForQueuedEvent(stream: WorkspaceStream, event: ServerEvent) {
  const queuedSeq = stream.queuedSeqByWorkspace?.[event.workspaceId]
  const hasQueuedSeq =
    stream.eventQueue.length > 0 &&
    stream.queuedSeqByWorkspace !== undefined &&
    Object.prototype.hasOwnProperty.call(stream.queuedSeqByWorkspace, event.workspaceId)
  const lastSeqByWorkspace = useSessionStore.getState().lastEventSeqByWorkspace
  const hasLastSeq = Object.prototype.hasOwnProperty.call(lastSeqByWorkspace, event.workspaceId)

  if (!hasQueuedSeq && !hasLastSeq) {
    return null
  }

  return detectWorkspaceSeqGap(event, {
    [event.workspaceId]: hasQueuedSeq ? queuedSeq ?? 0 : lastSeqByWorkspace[event.workspaceId] ?? 0,
  })
}

function recordWorkspaceStreamQueuedSeq(stream: WorkspaceStream, event: ServerEvent) {
  const eventSeq = finitePositiveNumber(event.seq)
  if (eventSeq === null) {
    return
  }

  const currentSeq = stream.queuedSeqByWorkspace?.[event.workspaceId] ?? 0
  if (eventSeq <= currentSeq) {
    return
  }

  stream.queuedSeqByWorkspace = {
    ...(stream.queuedSeqByWorkspace ?? {}),
    [event.workspaceId]: eventSeq,
  }
}

function resetWorkspaceStreamQueuedSeq(stream: WorkspaceStream) {
  stream.queuedSeqByWorkspace = undefined
}

function detectWorkspaceSeqGap(
  event: ServerEvent,
  workingSeqByWorkspace: Record<string, number>,
): WorkspaceSeqGap | null {
  if (event.replay) {
    return null
  }

  const eventSeq = finitePositiveNumber(event.seq)
  if (eventSeq === null) {
    return null
  }

  if (!Object.prototype.hasOwnProperty.call(workingSeqByWorkspace, event.workspaceId)) {
    return null
  }

  const currentSeq = workingSeqByWorkspace[event.workspaceId] ?? 0
  if (eventSeq <= currentSeq + 1) {
    return null
  }

  if (eventCoversCurrentWorkspaceSeq(event, currentSeq)) {
    return null
  }

  return {
    event,
    expectedSeq: currentSeq + 1,
    receivedSeq: eventSeq,
    workspaceId: event.workspaceId,
  }
}

function updateWorkingWorkspaceSeq(
  event: ServerEvent,
  workingSeqByWorkspace: Record<string, number>,
) {
  const eventSeq = finitePositiveNumber(event.seq)
  if (eventSeq === null) {
    return
  }

  const currentSeq = workingSeqByWorkspace[event.workspaceId] ?? 0
  if (eventSeq > currentSeq) {
    workingSeqByWorkspace[event.workspaceId] = eventSeq
  }
}

function eventCoversCurrentWorkspaceSeq(event: ServerEvent, currentSeq: number) {
  const eventSeq = finitePositiveNumber(event.seq)
  const coversSeqFrom = finitePositiveNumber(event.coversSeqFrom)
  const coversSeqTo = finitePositiveNumber(event.coversSeqTo)
  if (eventSeq === null || coversSeqFrom === null || coversSeqTo === null) {
    return false
  }

  return coversSeqFrom <= currentSeq + 1 && coversSeqTo >= eventSeq
}

function finitePositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null
}

function finiteNonNegativeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null
}

function handleWorkspaceReplayCompletedEvent(stream: WorkspaceStream, event: ServerEvent) {
  const payload = asObject(event.payload)
  const afterSeq = finiteNonNegativeNumber(payload.afterSeq)
  const fromSeq = finitePositiveNumber(payload.fromSeq)
  const toSeq = finitePositiveNumber(payload.toSeq)
  const headSeq = finitePositiveNumber(payload.headSeq)
  const oldestSeq = finitePositiveNumber(payload.oldestSeq)
  const nextAfterSeq = finitePositiveNumber(payload.nextAfterSeq) ?? toSeq
  const replayed = finiteNonNegativeNumber(payload.replayed)
  const limit = finitePositiveNumber(payload.limit)
  const complete = payload.complete === true
  const currentSeq = useSessionStore.getState().lastEventSeqByWorkspace[event.workspaceId] ?? 0
  const retentionGap =
    afterSeq !== null &&
    oldestSeq !== null &&
    afterSeq + 1 < oldestSeq

  const metadata = {
    afterSeq,
    complete,
    currentSeq,
    fromSeq,
    headSeq,
    limit,
    nextAfterSeq,
    oldestSeq,
    replayed,
    retentionGap,
    toSeq,
  }

  if (complete) {
    recordWorkspaceStreamLifecycleEvent(
      event.workspaceId,
      stream,
      'replay-completed',
      'workspace replay completed',
      metadata,
    )
    return
  }

  recordWorkspaceStreamLifecycleEvent(
    event.workspaceId,
    stream,
    'replay-incomplete',
    retentionGap
      ? 'workspace replay incomplete because requested events are older than retention'
      : 'workspace replay incomplete',
    metadata,
  )
  if (retentionGap) {
    requestWorkspaceStreamSnapshotFallback(
      stream,
      event,
      'replay-retention-gap',
      metadata,
    )
  }

  const madeForwardProgress =
    nextAfterSeq !== null &&
    nextAfterSeq > (afterSeq ?? 0) &&
    currentSeq >= nextAfterSeq
  const canContinueReplay =
    madeForwardProgress &&
    (headSeq === null || currentSeq < headSeq)

  if (!canContinueReplay) {
    recordWorkspaceStreamLifecycleEvent(
      event.workspaceId,
      stream,
      'replay-incomplete-stalled',
      'workspace replay incomplete and no forward replay page is available',
      metadata,
    )
    if (!retentionGap) {
      requestWorkspaceStreamSnapshotFallback(
        stream,
        event,
        'replay-incomplete-stalled',
        metadata,
      )
    }
    return
  }

  frontendDebugLog('workspace-stream', 'workspace replay incomplete; reconnecting to continue replay', {
    currentSeq,
    nextAfterSeq,
    workspaceId: event.workspaceId,
  })
  recordWorkspaceStreamLifecycleEvent(
    event.workspaceId,
    stream,
    'replay-continuation-requested',
    `workspace replay continuation requested after seq ${currentSeq}`,
    metadata,
  )

  stream.reconnectDelayOverrideMs = 0
  const socket = stream.socket
  if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.close()
  }
}

function requestWorkspaceStreamSnapshotFallback(
  stream: WorkspaceStream,
  event: ServerEvent,
  reason: 'replay-incomplete-stalled' | 'replay-retention-gap',
  metadata: {
    afterSeq: number | null
    currentSeq: number
    fromSeq: number | null
    headSeq: number | null
    limit: number | null
    nextAfterSeq: number | null
    oldestSeq: number | null
    replayed: number | null
    toSeq: number | null
  },
) {
  frontendDebugLog('workspace-stream', 'workspace stream snapshot fallback requested', {
    reason,
    workspaceId: event.workspaceId,
    ...metadata,
  })
  recordWorkspaceStreamLifecycleEvent(
    event.workspaceId,
    stream,
    'snapshot-fallback-requested',
    reason === 'replay-retention-gap'
      ? 'workspace replay retention gap detected; snapshot fallback requested'
      : 'workspace replay stalled; snapshot fallback requested',
    {
      ...metadata,
      reason,
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
    },
  )
  dispatchWorkspaceStreamRecoveryRequired({
    workspaceId: event.workspaceId,
    reason,
    afterSeq: metadata.afterSeq,
    currentSeq: metadata.currentSeq,
    fromSeq: metadata.fromSeq,
    headSeq: metadata.headSeq,
    limit: metadata.limit,
    nextAfterSeq: metadata.nextAfterSeq,
    oldestSeq: metadata.oldestSeq,
    replayed: metadata.replayed,
    threadId: event.threadId ?? null,
    toSeq: metadata.toSeq,
    turnId: event.turnId ?? null,
  })
}

function handleWorkspaceEventsDroppedEvent(stream: WorkspaceStream, event: ServerEvent) {
  const payload = asObject(event.payload)
  const droppedMethod = stringField(payload.droppedMethod)
  const reason = stringField(payload.reason)
  const fromSeq = finitePositiveNumber(payload.fromSeq)
  const toSeq = finitePositiveNumber(payload.toSeq)
  const seq = finitePositiveNumber(payload.seq)
  const currentSeq = useSessionStore.getState().lastEventSeqByWorkspace[event.workspaceId] ?? 0

  frontendDebugLog('workspace-stream', 'workspace events dropped control event received; reconnecting stream', {
    currentSeq,
    droppedMethod,
    fromSeq,
    reason,
    toSeq,
    workspaceId: event.workspaceId,
  })
  recordWorkspaceStreamLifecycleEvent(
    event.workspaceId,
    stream,
    'events-dropped',
    'workspace events dropped by subscriber backpressure; reconnecting stream',
    {
      currentSeq,
      droppedMethod: droppedMethod || null,
      fromSeq,
      reason: reason || null,
      seq,
      threadId: event.threadId ?? (stringField(payload.threadId) || null),
      toSeq,
      turnId: event.turnId ?? (stringField(payload.turnId) || null),
    },
  )

  stream.reconnectDelayOverrideMs = 0
  const socket = stream.socket
  if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.close()
  }
}

function requestWorkspaceStreamSeqRecovery(
  stream: WorkspaceStream,
  event: ServerEvent,
  gap: WorkspaceSeqGap,
) {
  frontendDebugLog('workspace-stream', 'workspace seq gap detected; reconnecting stream', {
    expectedSeq: gap.expectedSeq,
    method: event.method,
    receivedSeq: gap.receivedSeq,
    workspaceId: gap.workspaceId,
  })
  recordWorkspaceStreamLifecycleEvent(
    gap.workspaceId,
    stream,
    'seq-gap-detected',
    `workspace event seq gap detected: expected ${gap.expectedSeq}, received ${gap.receivedSeq}`,
    {
      expectedSeq: gap.expectedSeq,
      method: event.method,
      receivedSeq: gap.receivedSeq,
      replay: Boolean(event.replay),
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
    },
  )

  if (stream.flushTimer) {
    window.clearTimeout(stream.flushTimer)
    stream.flushTimer = undefined
  }
  stream.eventQueue = []
  scheduleWorkspaceStreamDiagnosticsChanged()

  if (!stream.isLeader && stream.channel) {
    requestWorkspaceStreamFollowerRecovery(stream, event, gap)
    return
  }

  stream.reconnectDelayOverrideMs = 0
  const socket = stream.socket
  if (socket && socket.readyState !== WebSocket.CLOSING && socket.readyState !== WebSocket.CLOSED) {
    socket.close()
  }
}

function requestWorkspaceStreamFollowerRecovery(
  stream: WorkspaceStream,
  event: ServerEvent,
  gap: WorkspaceSeqGap,
) {
  const currentSeq = useSessionStore.getState().lastEventSeqByWorkspace[gap.workspaceId] ?? 0
  const afterSeq = Math.max(0, Math.min(currentSeq, gap.expectedSeq - 1))
  const now = Date.now()
  const hasRecentMatchingRequest =
    stream.lastFollowerRecoveryRequestAfterSeq === afterSeq &&
    stream.lastFollowerRecoveryRequestAt !== undefined &&
    now - stream.lastFollowerRecoveryRequestAt < workspaceFollowerRecoveryRequestCooldownMs

  if (hasRecentMatchingRequest) {
    frontendDebugLog('workspace-stream', 'follower recovery request suppressed by cooldown', {
      afterSeq,
      expectedSeq: gap.expectedSeq,
      receivedSeq: gap.receivedSeq,
      workspaceId: gap.workspaceId,
    })
    return
  }

  stream.lastFollowerRecoveryRequestAfterSeq = afterSeq
  stream.lastFollowerRecoveryRequestAt = now
  frontendDebugLog('workspace-stream', 'follower requesting replay recovery from leader', {
    afterSeq,
    expectedSeq: gap.expectedSeq,
    method: event.method,
    receivedSeq: gap.receivedSeq,
    workspaceId: gap.workspaceId,
  })
  recordWorkspaceStreamLifecycleEvent(
    gap.workspaceId,
    stream,
    'follower-recovery-requested',
    `requested leader replay recovery after seq ${afterSeq}`,
    {
      afterSeq,
      expectedSeq: gap.expectedSeq,
      leaderId: stream.leaderId ?? null,
      method: event.method,
      receivedSeq: gap.receivedSeq,
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
    },
  )

  try {
    stream.channel?.postMessage({
      type: 'recovery-request',
      workspaceId: gap.workspaceId,
      instanceId: stream.instanceId,
      ts: now,
      afterSeq,
      expectedSeq: gap.expectedSeq,
      receivedSeq: gap.receivedSeq,
      method: event.method,
      threadId: event.threadId ?? null,
      turnId: event.turnId ?? null,
    } satisfies WorkspaceStreamBroadcastMessage)
  } catch (error) {
    frontendDebugLog('workspace-stream', 'failed to post follower recovery request', {
      error: error instanceof Error ? error.message : String(error),
      workspaceId: gap.workspaceId,
    })
    recordWorkspaceStreamLifecycleEvent(
      gap.workspaceId,
      stream,
      'follower-recovery-request-failed',
      'failed to post follower replay recovery request',
      {
        afterSeq,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
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
  resetWorkspaceStreamQueuedSeq(stream)
  scheduleWorkspaceStreamDiagnosticsChanged()
  const { acceptedEvents, gap } = splitWorkspaceEventsAtSeqGap(queuedEvents)
  if (acceptedEvents.length === 0 && gap) {
    requestWorkspaceStreamSeqRecovery(stream, gap.event, gap)
    return
  }

  const eventsToFlush = acceptedEvents
  const lastEvent = eventsToFlush[eventsToFlush.length - 1]
  frontendDebugLog('workspace-stream', 'flushing queued delta events', {
    count: eventsToFlush.length,
    methods: eventsToFlush.map((event) => event.method),
    seqRecoverySkippedCount: gap ? queuedEvents.length - eventsToFlush.length : 0,
    lastEvent: summarizeServerEventForDebug(lastEvent),
  })
  recordConversationLiveDiagnosticEvent({
    kind: 'stream-batch-flush',
    metadata: {
      count: eventsToFlush.length,
      queuedCount: queuedEvents.length,
      seqRecoverySkippedCount: gap ? queuedEvents.length - eventsToFlush.length : 0,
      uniqueMethods: new Set(eventsToFlush.map((event) => event.method)).size,
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
    `flushed ${eventsToFlush.length} queued delta events`,
    {
      count: eventsToFlush.length,
      lastMethod: lastEvent?.method ?? null,
      seqRecoverySkippedCount: gap ? queuedEvents.length - eventsToFlush.length : 0,
    },
  )
  useSessionStore.getState().ingestEvents(eventsToFlush)
  emitWorkspaceStreamEvents(eventsToFlush)

  if (gap) {
    requestWorkspaceStreamSeqRecovery(stream, gap.event, gap)
  }
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
