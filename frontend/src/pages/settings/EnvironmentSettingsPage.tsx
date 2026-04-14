import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  SettingsGroup,
  SettingsJsonPreview,
  SettingRow,
  SettingsPageHeader,
  SettingsRecord,
} from '../../components/settings/SettingsPrimitives'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import { SelectControl } from '../../components/ui/SelectControl'
import { Input } from '../../components/ui/Input'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { StatusPill } from '../../components/ui/StatusPill'
import {
  buildShellEnvironmentDiagnosis,
  createCoreWindowsShellEnvironmentPolicy,
  createInheritAllShellEnvironmentPolicy,
} from '../../features/settings/shell-environment-diagnostics'
import { runtimeSensitiveConfigItems } from '../../features/settings/runtime-sensitive-config'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import {
  readConfig,
  readRuntimeEventHubDiagnostics,
  readRuntimePreferences,
  writeConfigValue,
} from '../../features/settings/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getWorkspaceRuntimeState, restartWorkspace } from '../../features/workspaces/api'
import { RuntimeRecoveryActionGroup } from '../../features/workspaces/RuntimeRecoveryActionGroup'
import { RuntimeRecoveryNoticeContent } from '../../features/workspaces/RuntimeRecoveryNoticeContent'
import { buildWorkspaceRuntimeRecoverySummary } from '../../features/workspaces/runtimeRecovery'
import { formatLocalizedStatusLabel } from '../../i18n/display'
import { formatLocaleDateTime } from '../../i18n/format'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import {
  getWorkspaceStreamManagerDiagnosticsSnapshot,
  subscribeWorkspaceStreamManagerDiagnostics,
} from '../../hooks/useWorkspaceStream'
import type {
  WorkspaceStreamLifecycleEvent,
  WorkspaceStreamLocalDiagnostics,
} from '../../hooks/useWorkspaceStreamTypes'
import { workspaceStreamLeaderStaleAfterMs } from '../../lib/workspace-stream-broadcast'
import type {
  EventHubDiagnosticsSnapshot,
  EventHubSubscriberDiagnostics,
  EventHubWorkspaceDiagnostics,
} from '../../types/api'

type EventHubWorkspaceSortKey =
  | 'attention'
  | 'buffered'
  | 'dropped'
  | 'mergedBytes'
  | 'subscribers'
  | 'headSeq'
  | 'name'

type EventHubSubscriberSortKey =
  | 'attention'
  | 'queue'
  | 'dropped'
  | 'mergedBytes'
  | 'seq'
  | 'recent'
  | 'identity'

type FrontendWorkspaceStreamCorrelationReason = {
  code: string
  message: string
  severity: 'critical' | 'warning'
}

type FrontendWorkspaceStreamCorrelationAlert = {
  key: string
  latestLifecycleEvent: WorkspaceStreamLifecycleEvent | null | undefined
  matchingSubscriber: EventHubSubscriberDiagnostics | null
  reason: FrontendWorkspaceStreamCorrelationReason
  sourceSubscriber: EventHubSubscriberDiagnostics | null
  stream: WorkspaceStreamLocalDiagnostics
}

type WorkspaceHealthStatus = 'healthy' | 'warning' | 'critical'

type FrontendWorkspaceStreamEntry = {
  attentionReasons: string[]
  correlationReasons: FrontendWorkspaceStreamCorrelationReason[]
  localAttentionReasons: string[]
  matchingSubscriber: EventHubSubscriberDiagnostics | null
  needsAttention: boolean
  sourceSubscriber: EventHubSubscriberDiagnostics | null
  stream: WorkspaceStreamLocalDiagnostics
}

type WorkspaceHealthSummary = {
  backendBufferedCount: number
  backendDroppedCount: number
  backendHardDropCount: number
  correlationAlertCount: number
  criticalCorrelationCount: number
  frontendAttentionCount: number
  frontendStreamCount: number
  reasons: string[]
  score: number
  status: WorkspaceHealthStatus
  warningCorrelationCount: number
  workspaceId: string
}

function countBufferedEvents(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce(
    (total, subscriber) => total + subscriber.queueLen + subscriber.outputBufferLen,
    0,
  )
}

function countDroppedEvents(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce((total, subscriber) => total + subscriber.droppedCount, 0)
}

function countSoftDroppedEvents(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce((total, subscriber) => total + subscriber.softDroppedCount, 0)
}

function countHardDroppedEvents(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce((total, subscriber) => total + subscriber.hardDroppedCount, 0)
}

function countHardEvictedEvents(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce((total, subscriber) => total + subscriber.hardEvictedCount, 0)
}

function countMergedEvents(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce((total, subscriber) => total + subscriber.mergedCount, 0)
}

function countCoalescedCommandOutputBytes(subscribers: EventHubSubscriberDiagnostics[]) {
  return subscribers.reduce(
    (total, subscriber) => total + subscriber.coalescedCommandOutputBytes,
    0,
  )
}

function aggregateCoalescedByMethod(subscribers: EventHubSubscriberDiagnostics[]) {
  const totals: Record<string, number> = {}
  for (const subscriber of subscribers) {
    for (const [method, count] of Object.entries(subscriber.coalescedByMethod ?? {})) {
      if (!count) {
        continue
      }
      totals[method] = (totals[method] ?? 0) + count
    }
  }
  return totals
}

function formatMethodCounterSummary(counters: Record<string, number> | null | undefined) {
  const entries = Object.entries(counters ?? {})
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
  if (!entries.length) {
    return i18n._({
      id: 'No coalesced methods recorded yet',
      message: 'No coalesced methods recorded yet',
    })
  }

  return entries
    .slice(0, 3)
    .map(([method, count]) =>
      i18n._({
        id: '{method} × {count}',
        message: '{method} × {count}',
        values: { method, count },
      }),
    )
    .join(' · ')
}

function formatSubscriberIdentity(subscriber: EventHubSubscriberDiagnostics) {
  const parts = [subscriber.role?.trim(), subscriber.scope?.trim(), subscriber.source?.trim()].filter(
    (value): value is string => Boolean(value),
  )
  if (!parts.length) {
    return i18n._({
      id: 'Unlabeled subscriber',
      message: 'Unlabeled subscriber',
    })
  }
  return parts.join(' · ')
}

function formatEventHubSubscriberActivity(subscriber: EventHubSubscriberDiagnostics) {
  if (subscriber.lastQueuedAt) {
    return i18n._({
      id: 'last queued {time}',
      message: 'last queued {time}',
      values: {
        time: formatLocaleDateTime(subscriber.lastQueuedAt),
      },
    })
  }

  if (subscriber.lastDequeuedAt) {
    return i18n._({
      id: 'last dequeued {time}',
      message: 'last dequeued {time}',
      values: {
        time: formatLocaleDateTime(subscriber.lastDequeuedAt),
      },
    })
  }

  return i18n._({
    id: 'No activity recorded yet',
    message: 'No activity recorded yet',
  })
}

function buildEventHubWorkspaceSummary(workspace: EventHubWorkspaceDiagnostics) {
  const buffered = countBufferedEvents(workspace.subscribers)
  const dropped = countDroppedEvents(workspace.subscribers)
  const softDropped = countSoftDroppedEvents(workspace.subscribers)
  const hardDropped = countHardDroppedEvents(workspace.subscribers)
  const hardEvicted = countHardEvictedEvents(workspace.subscribers)
  const merged = countMergedEvents(workspace.subscribers)
  const coalescedCommandOutputBytes = countCoalescedCommandOutputBytes(workspace.subscribers)
  const coalescedByMethod = aggregateCoalescedByMethod(workspace.subscribers)

  return {
    buffered,
    dropped,
    softDropped,
    hardDropped,
    hardEvicted,
    merged,
    coalescedCommandOutputBytes,
    coalescedByMethod,
    needsAttention: buffered > 0 || dropped > 0,
  }
}

function normalizeFilterText(value: string) {
  return value.trim().toLowerCase()
}

function buildEventHubSubscriberEntryKey(
  kind: 'workspace' | 'global',
  workspaceId: string,
  subscriberId: number,
) {
  return `${kind}:${workspaceId || 'global'}:${subscriberId}`
}

function formatDeltaLabel(prefix: string, value: number) {
  const normalized = Number.isFinite(value) ? value : 0
  const sign = normalized > 0 ? '+' : ''
  return `${prefix} ${sign}${normalized}`
}

function formatWorkspaceStreamCoordinationLabel(stream: WorkspaceStreamLocalDiagnostics) {
  if (stream.coordinationMode === 'direct') {
    return i18n._({
      id: 'Direct websocket',
      message: 'Direct websocket',
    })
  }

  return stream.isLeader
    ? i18n._({
        id: 'Broadcast leader',
        message: 'Broadcast leader',
      })
    : i18n._({
        id: 'Broadcast follower',
        message: 'Broadcast follower',
      })
}

function findMatchingBackendWorkspaceStreamSubscriber(
  subscribers: EventHubSubscriberDiagnostics[],
  stream: WorkspaceStreamLocalDiagnostics,
) {
  const expectedSource = stream.expectedBackendSource
  const expectedRole = stream.expectedBackendRole
  if (!expectedSource || !expectedRole) {
    return null
  }

  return (
    subscribers.find(
      (subscriber) => subscriber.source === expectedSource && subscriber.role === expectedRole,
    ) ?? null
  )
}

function findBackendWorkspaceStreamSubscriberBySource(
  subscribers: EventHubSubscriberDiagnostics[],
  source: string | null | undefined,
) {
  if (!source) {
    return null
  }

  return subscribers.find((subscriber) => subscriber.source === source) ?? null
}

function buildFrontendWorkspaceStreamAttentionReasons(
  stream: WorkspaceStreamLocalDiagnostics,
  matchingSubscriber: EventHubSubscriberDiagnostics | null,
) {
  const reasons: string[] = []
  const queuedCount = stream.queueLength + stream.deferredEventCount
  const lastHeartbeatAgeMs = stream.lastLeaderHeartbeatAt
    ? Date.now() - Date.parse(stream.lastLeaderHeartbeatAt)
    : null

  if (stream.expectedBackendSource && !matchingSubscriber) {
    reasons.push(
      i18n._({
        id: 'Backend subscriber identity missing',
        message: 'Backend subscriber identity missing',
      }),
    )
  }

  if (stream.lastKnownConnectionState === 'error') {
    reasons.push(
      i18n._({
        id: 'Local socket is in error state',
        message: 'Local socket is in error state',
      }),
    )
  } else if (stream.lastKnownConnectionState === 'closed' && stream.subscribers > 0) {
    reasons.push(
      i18n._({
        id: 'Socket closed while subscribers are still attached',
        message: 'Socket closed while subscribers are still attached',
      }),
    )
  }

  if (!stream.isLeader && stream.leaderId && lastHeartbeatAgeMs !== null && lastHeartbeatAgeMs > workspaceStreamLeaderStaleAfterMs) {
    reasons.push(
      i18n._({
        id: 'Follower leader heartbeat looks stale',
        message: 'Follower leader heartbeat looks stale',
      }),
    )
  }

  if (queuedCount > 0) {
    reasons.push(
      i18n._({
        id: 'Local event backlog {count}',
        message: 'Local event backlog {count}',
        values: { count: queuedCount },
      }),
    )
  }

  if (stream.reconnectScheduled || stream.reconnectAttempt > 0) {
    reasons.push(
      i18n._({
        id: 'Reconnect activity attempt {count}',
        message: 'Reconnect activity attempt {count}',
        values: { count: stream.reconnectAttempt },
      }),
    )
  }

  return reasons
}

function findLatestFrontendWorkspaceLifecycleEvent(
  events: WorkspaceStreamLifecycleEvent[],
  kinds: string[],
) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (kinds.includes(event.kind)) {
      return event
    }
  }
  return null
}

function buildFrontendWorkspaceStreamCorrelationReasons(
  stream: WorkspaceStreamLocalDiagnostics,
  matchingSubscriber: EventHubSubscriberDiagnostics | null,
  sourceSubscriber: EventHubSubscriberDiagnostics | null,
  capturedAt: string | undefined,
) {
  const nowMs = capturedAt ? Date.parse(capturedAt) : Date.now()
  const reasons: FrontendWorkspaceStreamCorrelationReason[] = []
  const latestLeaderAttachEvent = findLatestFrontendWorkspaceLifecycleEvent(stream.recentLifecycleEvents, [
    'became-leader',
    'socket-opened',
    'socket-opening',
  ])
  const latestYieldEvent = findLatestFrontendWorkspaceLifecycleEvent(stream.recentLifecycleEvents, [
    'yielded-leader',
    'socket-close-requested',
    'leader-released',
  ])

  if (
    stream.isLeader &&
    stream.expectedBackendSource &&
    !matchingSubscriber &&
    latestLeaderAttachEvent &&
    nowMs - Date.parse(latestLeaderAttachEvent.ts) > 6_000
  ) {
    reasons.push(
      {
        code: 'leader-not-reflected',
        message: i18n._({
          id: 'Leader lifecycle is not reflected in backend diagnostics',
          message: 'Leader lifecycle is not reflected in backend diagnostics',
        }),
        severity: 'critical',
      },
    )
  }

  if (
    !stream.isLeader &&
    sourceSubscriber &&
    latestYieldEvent &&
    nowMs - Date.parse(latestYieldEvent.ts) > 6_000
  ) {
    reasons.push(
      {
        code: 'backend-stale-after-yield',
        message: i18n._({
          id: 'Backend still reports this tab after local leadership changed',
          message: 'Backend still reports this tab after local leadership changed',
        }),
        severity: 'warning',
      },
    )
  }

  if (
    stream.lastKnownConnectionState === 'open' &&
    sourceSubscriber?.closed
  ) {
    reasons.push(
      {
        code: 'backend-closed-local-open',
        message: i18n._({
          id: 'Backend subscriber is marked closed while local socket is open',
          message: 'Backend subscriber is marked closed while local socket is open',
        }),
        severity: 'critical',
      },
    )
  }

  if (
    stream.expectedBackendRole &&
    sourceSubscriber &&
    sourceSubscriber.role !== stream.expectedBackendRole
  ) {
    reasons.push(
      {
        code: 'backend-role-mismatch',
        message: i18n._({
          id: 'Backend subscriber role does not match the local stream role',
          message: 'Backend subscriber role does not match the local stream role',
        }),
        severity: 'warning',
      },
    )
  }

  return reasons.filter(
    (reason, index, list) =>
      list.findIndex((entry) => entry.code === reason.code) === index,
  )
}

function formatFrontendWorkspaceStreamAttentionSummary(reasons: string[]) {
  if (!reasons.length) {
    return i18n._({
      id: 'No local attention signals detected',
      message: 'No local attention signals detected',
    })
  }

  return reasons.slice(0, 3).join(' · ')
}

function formatFrontendWorkspaceStreamCorrelationSummary(
  reasons: FrontendWorkspaceStreamCorrelationReason[],
  limit: number = 3,
) {
  if (!reasons.length) {
    return i18n._({
      id: 'No front/back correlation anomalies detected',
      message: 'No front/back correlation anomalies detected',
    })
  }

  return reasons
    .slice(0, limit)
    .map((reason) => reason.message)
    .join(' · ')
}

function formatFrontendWorkspaceStreamLifecycleEventLabel(event: WorkspaceStreamLifecycleEvent) {
  return `${event.summary} (${formatRelativeTimeShort(event.ts)})`
}

function formatFrontendWorkspaceStreamLifecycleSummary(
  events: WorkspaceStreamLifecycleEvent[],
  limit: number = 3,
) {
  if (!events.length) {
    return i18n._({
      id: 'No recent lifecycle transitions recorded',
      message: 'No recent lifecycle transitions recorded',
    })
  }

  return events
    .slice(-limit)
    .map((event) => formatFrontendWorkspaceStreamLifecycleEventLabel(event))
    .join(' · ')
}

function formatWorkspaceHealthStatusLabel(status: WorkspaceHealthStatus) {
  switch (status) {
    case 'critical':
      return i18n._({ id: 'Critical', message: 'Critical' })
    case 'warning':
      return i18n._({ id: 'Warning', message: 'Warning' })
    default:
      return i18n._({ id: 'Healthy', message: 'Healthy' })
  }
}

function buildWorkspaceHealthStatus(
  input: {
    backendHardDropCount: number
    backendDroppedCount: number
    correlationCriticalCount: number
    correlationWarningCount: number
    frontendAttentionCount: number
  },
): WorkspaceHealthStatus {
  if (
    input.correlationCriticalCount > 0 ||
    input.backendHardDropCount > 0
  ) {
    return 'critical'
  }

  if (
    input.backendDroppedCount > 0 ||
    input.correlationWarningCount > 0 ||
    input.frontendAttentionCount > 0
  ) {
    return 'warning'
  }

  return 'healthy'
}

function buildWorkspaceHealthScore(input: {
  backendBufferedCount: number
  backendDroppedCount: number
  backendHardDropCount: number
  correlationCriticalCount: number
  correlationWarningCount: number
  frontendAttentionCount: number
}) {
  const score =
    input.correlationCriticalCount * 40 +
    input.backendHardDropCount * 25 +
    input.backendDroppedCount * 12 +
    input.correlationWarningCount * 10 +
    input.frontendAttentionCount * 6 +
    Math.min(input.backendBufferedCount, 20)

  return Math.min(100, score)
}

function getWorkspaceHealthStatusRank(status: WorkspaceHealthStatus) {
  switch (status) {
    case 'critical':
      return 2
    case 'warning':
      return 1
    default:
      return 0
  }
}

export function EnvironmentSettingsPage() {
  const queryClient = useQueryClient()
  const {
    workspaceId,
    workspaceName,
    workspaces,
    workspacesLoading,
    workspacesError,
  } = useSettingsShellContext()
  const [eventHubWorkspaceFilter, setEventHubWorkspaceFilter] = useState('')
  const [eventHubSubscriberFilter, setEventHubSubscriberFilter] = useState('')
  const [eventHubWorkspaceSort, setEventHubWorkspaceSort] =
    useState<EventHubWorkspaceSortKey>('attention')
  const [eventHubSubscriberSort, setEventHubSubscriberSort] =
    useState<EventHubSubscriberSortKey>('attention')
  const [eventHubAttentionOnly, setEventHubAttentionOnly] = useState(false)
  const [frontendWorkspaceStreamFilter, setFrontendWorkspaceStreamFilter] = useState('')
  const [frontendWorkspaceStreamAttentionOnly, setFrontendWorkspaceStreamAttentionOnly] = useState(false)
  const [workspaceDiagnosticsDrilldownWorkspaceId, setWorkspaceDiagnosticsDrilldownWorkspaceId] =
    useState('')
  const [eventHubExpandedSubscriberKeys, setEventHubExpandedSubscriberKeys] = useState<Record<string, boolean>>({})
  const previousEventHubSnapshotRef = useRef<EventHubDiagnosticsSnapshot | null>(null)
  const previousFrontendCorrelationAlertsRef = useRef<FrontendWorkspaceStreamCorrelationAlert[]>([])
  const previousWorkspaceHealthSummariesRef = useRef<WorkspaceHealthSummary[]>([])
  const frontendCorrelationAlertsInitializedRef = useRef(false)
  const workspaceHealthInitializedRef = useRef(false)
  const [eventHubPreviousSnapshot, setEventHubPreviousSnapshot] =
    useState<EventHubDiagnosticsSnapshot | null>(null)
  const [frontendCorrelationAlertDelta, setFrontendCorrelationAlertDelta] = useState<{
    newAlerts: FrontendWorkspaceStreamCorrelationAlert[]
    resolvedAlerts: FrontendWorkspaceStreamCorrelationAlert[]
  }>({
    newAlerts: [],
    resolvedAlerts: [],
  })
  const [workspaceHealthDelta, setWorkspaceHealthDelta] = useState<{
    improved: WorkspaceHealthSummary[]
    regressed: WorkspaceHealthSummary[]
  }>({
    improved: [],
    regressed: [],
  })
  const frontendWorkspaceStreamDiagnostics = useSyncExternalStore(
    subscribeWorkspaceStreamManagerDiagnostics,
    getWorkspaceStreamManagerDiagnosticsSnapshot,
    getWorkspaceStreamManagerDiagnosticsSnapshot,
  )

  function applyWorkspaceDiagnosticsDrilldown(nextWorkspaceId: string) {
    setWorkspaceDiagnosticsDrilldownWorkspaceId(nextWorkspaceId)
    setEventHubWorkspaceFilter(nextWorkspaceId)
    setEventHubSubscriberFilter(nextWorkspaceId)
    setFrontendWorkspaceStreamFilter(nextWorkspaceId)
  }

  function clearWorkspaceDiagnosticsDrilldown() {
    setWorkspaceDiagnosticsDrilldownWorkspaceId('')
    setEventHubWorkspaceFilter('')
    setEventHubSubscriberFilter('')
    setFrontendWorkspaceStreamFilter('')
  }

  const healthyWorkspaces = useMemo(
    () => workspaces.filter((workspace) => ['ready', 'active', 'connected'].includes(workspace.runtimeStatus)).length,
    [workspaces],
  )
  const attentionWorkspaces = workspaces.length - healthyWorkspaces
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === workspaceId),
    [workspaceId, workspaces],
  )

  const runtimePreferencesQuery = useQuery({
    queryKey: ['settings-runtime-preferences'],
    queryFn: readRuntimePreferences,
  })
  const eventHubDiagnosticsQuery = useQuery({
    queryKey: ['runtime-event-hub-diagnostics'],
    queryFn: readRuntimeEventHubDiagnostics,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  })
  useEffect(() => {
    const snapshot = eventHubDiagnosticsQuery.data
    if (!snapshot) {
      return
    }
    if (previousEventHubSnapshotRef.current?.capturedAt === snapshot.capturedAt) {
      return
    }

    setEventHubPreviousSnapshot(previousEventHubSnapshotRef.current)
    previousEventHubSnapshotRef.current = snapshot
  }, [eventHubDiagnosticsQuery.data])
  const selectedWorkspaceConfigQuery = useQuery({
    queryKey: ['environment-config', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfig(workspaceId!, { includeLayers: true }),
  })
  const workspaceRuntimeStateQuery = useQuery({
    queryKey: ['environment-runtime-state', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => getWorkspaceRuntimeState(workspaceId!),
  })
  const runtimeRecoverySummary = useMemo(
    () => buildWorkspaceRuntimeRecoverySummary(workspaceRuntimeStateQuery.data),
    [workspaceRuntimeStateQuery.data],
  )
  const restartWorkspaceMutation = useMutation({
    mutationFn: (selectedId: string) => restartWorkspace(selectedId),
    onSuccess: async (_, selectedId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-config', selectedId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-runtime-state', selectedId] }),
      ])
    },
  })
  const applyShellEnvironmentPolicyPresetMutation = useMutation({
    mutationFn: async (preset: 'inherit-all' | 'core-windows') => {
      if (!workspaceId) {
        throw new Error('A workspace must be selected before applying a shell environment preset.')
      }

      const value =
        preset === 'core-windows'
          ? createCoreWindowsShellEnvironmentPolicy()
          : createInheritAllShellEnvironmentPolicy()

      await writeConfigValue(workspaceId, {
        keyPath: 'shell_environment_policy',
        mergeStrategy: 'upsert',
        value,
      })

      return restartWorkspace(workspaceId)
    },
    onSuccess: async (_, __) => {
      if (!workspaceId) {
        return
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-requirements', workspaceId] }),
      ])
    },
  })

  const shellEnvironmentPolicy = useMemo<Record<string, unknown> | null>(() => {
    const config = selectedWorkspaceConfigQuery.data?.config
    if (!config || typeof config !== 'object') {
      return null
    }

    const value = config['shell_environment_policy']
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }, [selectedWorkspaceConfigQuery.data?.config])

  const shellEnvironmentOrigins = useMemo(() => {
    const origins = selectedWorkspaceConfigQuery.data?.origins
    if (!origins || typeof origins !== 'object') {
      return null
    }

    const matchedEntries = Object.entries(origins).filter(([key]) =>
      key === 'shell_environment_policy' || key.startsWith('shell_environment_policy.'),
    )
    if (!matchedEntries.length) {
      return null
    }

    return Object.fromEntries(matchedEntries)
  }, [selectedWorkspaceConfigQuery.data?.origins])
  const shellEnvironmentDiagnosis = useMemo(
    () => buildShellEnvironmentDiagnosis(shellEnvironmentPolicy),
    [shellEnvironmentPolicy],
  )
  const workspaceNameById = useMemo(
    () => Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  )
  const backendWorkspaceSubscribersByWorkspaceId = useMemo(
    () =>
      Object.fromEntries(
        (eventHubDiagnosticsQuery.data?.workspaces ?? []).map((workspace) => [
          workspace.workspaceId,
          workspace.subscribers,
        ]),
      ),
    [eventHubDiagnosticsQuery.data?.workspaces],
  )
  const normalizedFrontendWorkspaceStreamFilter = normalizeFilterText(frontendWorkspaceStreamFilter)
  const frontendWorkspaceStreamEntries = useMemo<FrontendWorkspaceStreamEntry[]>(
    () =>
      frontendWorkspaceStreamDiagnostics.streams
        .map((stream) => {
          const sourceSubscriber = findBackendWorkspaceStreamSubscriberBySource(
            backendWorkspaceSubscribersByWorkspaceId[stream.workspaceId] ?? [],
            `api.workspace_stream:${stream.instanceId}`,
          )
          const matchingSubscriber = findMatchingBackendWorkspaceStreamSubscriber(
            backendWorkspaceSubscribersByWorkspaceId[stream.workspaceId] ?? [],
            stream,
          )
          const localAttentionReasons = buildFrontendWorkspaceStreamAttentionReasons(
            stream,
            matchingSubscriber,
          )
          const correlationReasons = buildFrontendWorkspaceStreamCorrelationReasons(
            stream,
            matchingSubscriber,
            sourceSubscriber,
            eventHubDiagnosticsQuery.data?.capturedAt,
          )
          const attentionReasons = [
            ...new Set([
              ...localAttentionReasons,
              ...correlationReasons.map((reason) => reason.message),
            ]),
          ]
          return {
            attentionReasons,
            correlationReasons,
            localAttentionReasons,
            matchingSubscriber,
            sourceSubscriber,
            needsAttention: attentionReasons.length > 0,
            stream,
          }
        })
        .sort((left, right) => {
          if (left.needsAttention !== right.needsAttention) {
            return Number(right.needsAttention) - Number(left.needsAttention)
          }
          if (left.stream.isLeader !== right.stream.isLeader) {
            return Number(right.stream.isLeader) - Number(left.stream.isLeader)
          }
          return left.stream.workspaceId.localeCompare(right.stream.workspaceId)
        }),
    [
      backendWorkspaceSubscribersByWorkspaceId,
      eventHubDiagnosticsQuery.data?.capturedAt,
      frontendWorkspaceStreamDiagnostics.streams,
    ],
  )
  const frontendWorkspaceStreamAttentionCount = useMemo(
    () => frontendWorkspaceStreamEntries.filter((entry) => entry.needsAttention).length,
    [frontendWorkspaceStreamEntries],
  )
  const frontendWorkspaceStreamBackendMismatchCount = useMemo(
    () =>
      frontendWorkspaceStreamEntries.filter(
        (entry) => Boolean(entry.stream.expectedBackendSource) && !entry.matchingSubscriber,
      ).length,
    [frontendWorkspaceStreamEntries],
  )
  const frontendWorkspaceStreamReconnectCount = useMemo(
    () =>
      frontendWorkspaceStreamEntries.filter(
        (entry) => entry.stream.reconnectScheduled || entry.stream.reconnectAttempt > 0,
      ).length,
    [frontendWorkspaceStreamEntries],
  )
  const frontendWorkspaceStreamCorrelationCount = useMemo(
    () =>
      frontendWorkspaceStreamEntries.filter((entry) => entry.correlationReasons.length > 0).length,
    [frontendWorkspaceStreamEntries],
  )
  const frontendWorkspaceStreamCriticalCorrelationCount = useMemo(
    () =>
      frontendWorkspaceStreamEntries.reduce(
        (total, entry) =>
          total + entry.correlationReasons.filter((reason) => reason.severity === 'critical').length,
        0,
      ),
    [frontendWorkspaceStreamEntries],
  )
  const frontendWorkspaceStreamWarningCorrelationCount = useMemo(
    () =>
      frontendWorkspaceStreamEntries.reduce(
        (total, entry) =>
          total + entry.correlationReasons.filter((reason) => reason.severity === 'warning').length,
        0,
      ),
    [frontendWorkspaceStreamEntries],
  )
  const frontendWorkspaceStreamBufferedCount = useMemo(
    () =>
      frontendWorkspaceStreamEntries.filter(
        (entry) => entry.stream.queueLength > 0 || entry.stream.deferredEventCount > 0,
      ).length,
    [frontendWorkspaceStreamEntries],
  )
  const filteredFrontendWorkspaceStreams = useMemo(
    () =>
      frontendWorkspaceStreamEntries.filter(({ stream, matchingSubscriber, needsAttention, attentionReasons, correlationReasons }) => {
        if (frontendWorkspaceStreamAttentionOnly && !needsAttention) {
          return false
        }
        if (!normalizedFrontendWorkspaceStreamFilter) {
          return true
        }

        const haystack = [
          stream.workspaceId,
          workspaceNameById[stream.workspaceId] ?? '',
          stream.instanceId,
          stream.leaderId ?? '',
          stream.expectedBackendSource ?? '',
          stream.expectedBackendRole ?? '',
          formatWorkspaceStreamCoordinationLabel(stream),
          matchingSubscriber?.source ?? '',
          matchingSubscriber?.role ?? '',
          ...attentionReasons,
          ...correlationReasons.map((reason) => reason.message),
        ]
          .join(' ')
          .toLowerCase()

        return haystack.includes(normalizedFrontendWorkspaceStreamFilter)
      }),
    [
      frontendWorkspaceStreamAttentionOnly,
      frontendWorkspaceStreamEntries,
      normalizedFrontendWorkspaceStreamFilter,
      workspaceNameById,
    ],
  )
  const frontendWorkspaceStreamCorrelationAlerts = useMemo<FrontendWorkspaceStreamCorrelationAlert[]>(
    () =>
      frontendWorkspaceStreamEntries
        .flatMap(({ stream, matchingSubscriber, sourceSubscriber, correlationReasons }) =>
          correlationReasons.map((reason, index) => ({
            key: `${stream.workspaceId}:${stream.instanceId}:${index}:${reason.code}`,
            latestLifecycleEvent: stream.latestLifecycleEvent,
            matchingSubscriber,
            reason,
            sourceSubscriber,
            stream,
          })),
        )
        .sort((left, right) => {
          const rightTs = right.latestLifecycleEvent ? Date.parse(right.latestLifecycleEvent.ts) : 0
          const leftTs = left.latestLifecycleEvent ? Date.parse(left.latestLifecycleEvent.ts) : 0
          if (rightTs !== leftTs) {
            return rightTs - leftTs
          }
          return left.stream.workspaceId.localeCompare(right.stream.workspaceId)
        }),
    [frontendWorkspaceStreamEntries],
  )
  const filteredFrontendWorkspaceStreamCorrelationAlerts = useMemo(
    () =>
      workspaceDiagnosticsDrilldownWorkspaceId
        ? frontendWorkspaceStreamCorrelationAlerts.filter(
            (alert) => alert.stream.workspaceId === workspaceDiagnosticsDrilldownWorkspaceId,
          )
        : frontendWorkspaceStreamCorrelationAlerts,
    [frontendWorkspaceStreamCorrelationAlerts, workspaceDiagnosticsDrilldownWorkspaceId],
  )
  const filteredFrontendCorrelationAlertDelta = useMemo(
    () =>
      workspaceDiagnosticsDrilldownWorkspaceId
        ? {
            newAlerts: frontendCorrelationAlertDelta.newAlerts.filter(
              (alert) => alert.stream.workspaceId === workspaceDiagnosticsDrilldownWorkspaceId,
            ),
            resolvedAlerts: frontendCorrelationAlertDelta.resolvedAlerts.filter(
              (alert) => alert.stream.workspaceId === workspaceDiagnosticsDrilldownWorkspaceId,
            ),
          }
        : frontendCorrelationAlertDelta,
    [frontendCorrelationAlertDelta, workspaceDiagnosticsDrilldownWorkspaceId],
  )
  const frontendWorkspaceStreamEntriesByWorkspaceId = useMemo(
    () =>
      frontendWorkspaceStreamEntries.reduce<Record<string, FrontendWorkspaceStreamEntry[]>>(
        (result, entry) => {
          if (!result[entry.stream.workspaceId]) {
            result[entry.stream.workspaceId] = []
          }
          result[entry.stream.workspaceId].push(entry)
          return result
        },
        {},
      ),
    [frontendWorkspaceStreamEntries],
  )
  useEffect(() => {
    const previousAlerts = previousFrontendCorrelationAlertsRef.current
    if (!frontendCorrelationAlertsInitializedRef.current) {
      frontendCorrelationAlertsInitializedRef.current = true
      previousFrontendCorrelationAlertsRef.current = frontendWorkspaceStreamCorrelationAlerts
      setFrontendCorrelationAlertDelta({ newAlerts: [], resolvedAlerts: [] })
      return
    }
    const previousByKey = new Map(previousAlerts.map((alert) => [alert.key, alert]))
    const currentByKey = new Map(frontendWorkspaceStreamCorrelationAlerts.map((alert) => [alert.key, alert]))

    const newAlerts = frontendWorkspaceStreamCorrelationAlerts.filter(
      (alert) => !previousByKey.has(alert.key),
    )
    const resolvedAlerts = previousAlerts.filter((alert) => !currentByKey.has(alert.key))

    setFrontendCorrelationAlertDelta({ newAlerts, resolvedAlerts })
    previousFrontendCorrelationAlertsRef.current = frontendWorkspaceStreamCorrelationAlerts
  }, [frontendWorkspaceStreamCorrelationAlerts])
  const eventHubWorkspaceSummaries = useMemo(
    () =>
      (eventHubDiagnosticsQuery.data?.workspaces ?? []).map((workspace) => ({
        workspace,
        ...buildEventHubWorkspaceSummary(workspace),
      })),
    [eventHubDiagnosticsQuery.data?.workspaces],
  )
  const eventHubWorkspaceSummaryById = useMemo(
    () =>
      Object.fromEntries(
        eventHubWorkspaceSummaries.map((summary) => [summary.workspace.workspaceId, summary]),
      ),
    [eventHubWorkspaceSummaries],
  )
  const workspaceHealthSummaries = useMemo<WorkspaceHealthSummary[]>(() => {
    const workspaceIds = Array.from(
      new Set([
        ...workspaces.map((workspace) => workspace.id),
        ...eventHubWorkspaceSummaries.map((summary) => summary.workspace.workspaceId),
        ...frontendWorkspaceStreamEntries.map((entry) => entry.stream.workspaceId),
      ]),
    ).sort()

    return workspaceIds
      .map((workspaceId) => {
        const backendSummary = eventHubWorkspaceSummaryById[workspaceId]
        const frontendEntries = frontendWorkspaceStreamEntriesByWorkspaceId[workspaceId] ?? []
        const correlationAlerts = frontendWorkspaceStreamCorrelationAlerts.filter(
          (alert) => alert.stream.workspaceId === workspaceId,
        )
        const criticalCorrelationCount = correlationAlerts.filter(
          (alert) => alert.reason.severity === 'critical',
        ).length
        const warningCorrelationCount = correlationAlerts.filter(
          (alert) => alert.reason.severity === 'warning',
        ).length
        const frontendAttentionCount = frontendEntries.filter((entry) => entry.needsAttention).length
        const backendBufferedCount = backendSummary?.buffered ?? 0
        const backendDroppedCount = backendSummary?.dropped ?? 0
        const backendHardDropCount =
          (backendSummary?.hardDropped ?? 0) + (backendSummary?.hardEvicted ?? 0)
        const status = buildWorkspaceHealthStatus({
          backendDroppedCount,
          backendHardDropCount,
          correlationCriticalCount: criticalCorrelationCount,
          correlationWarningCount: warningCorrelationCount,
          frontendAttentionCount,
        })
        const score = buildWorkspaceHealthScore({
          backendBufferedCount,
          backendDroppedCount,
          backendHardDropCount,
          correlationCriticalCount: criticalCorrelationCount,
          correlationWarningCount: warningCorrelationCount,
          frontendAttentionCount,
        })

        const reasons: string[] = []
        if (criticalCorrelationCount > 0) {
          reasons.push(
            i18n._({
              id: '{count} critical front/back alerts',
              message: '{count} critical front/back alerts',
              values: { count: criticalCorrelationCount },
            }),
          )
        }
        if (warningCorrelationCount > 0) {
          reasons.push(
            i18n._({
              id: '{count} warning front/back alerts',
              message: '{count} warning front/back alerts',
              values: { count: warningCorrelationCount },
            }),
          )
        }
        if (backendDroppedCount > 0) {
          reasons.push(
            i18n._({
              id: 'backend dropped {count}',
              message: 'backend dropped {count}',
              values: { count: backendDroppedCount },
            }),
          )
        }
        if (backendBufferedCount > 0) {
          reasons.push(
            i18n._({
              id: 'backend buffered {count}',
              message: 'backend buffered {count}',
              values: { count: backendBufferedCount },
            }),
          )
        }
        if (frontendAttentionCount > 0) {
          reasons.push(
            i18n._({
              id: '{count} local stream attention flags',
              message: '{count} local stream attention flags',
              values: { count: frontendAttentionCount },
            }),
          )
        }
        if (!reasons.length) {
          reasons.push(
            i18n._({
              id: 'No backend drop, backlog, or front/back mismatch signal in the latest sample',
              message: 'No backend drop, backlog, or front/back mismatch signal in the latest sample',
            }),
          )
        }

        return {
          backendBufferedCount,
          backendDroppedCount,
          backendHardDropCount,
          correlationAlertCount: correlationAlerts.length,
          criticalCorrelationCount,
          frontendAttentionCount,
          frontendStreamCount: frontendEntries.length,
          reasons,
          score,
          status,
          warningCorrelationCount,
          workspaceId,
        }
      })
      .sort((left, right) => {
        if (getWorkspaceHealthStatusRank(left.status) !== getWorkspaceHealthStatusRank(right.status)) {
          return getWorkspaceHealthStatusRank(right.status) - getWorkspaceHealthStatusRank(left.status)
        }
        if (left.score !== right.score) {
          return right.score - left.score
        }
        return (workspaceNameById[left.workspaceId] ?? left.workspaceId).localeCompare(
          workspaceNameById[right.workspaceId] ?? right.workspaceId,
        )
      })
  }, [
    eventHubWorkspaceSummaries,
    eventHubWorkspaceSummaryById,
    frontendWorkspaceStreamCorrelationAlerts,
    frontendWorkspaceStreamEntries,
    frontendWorkspaceStreamEntriesByWorkspaceId,
    workspaceNameById,
    workspaces,
  ])
  const workspaceHealthCounts = useMemo(
    () => ({
      critical: workspaceHealthSummaries.filter((summary) => summary.status === 'critical').length,
      healthy: workspaceHealthSummaries.filter((summary) => summary.status === 'healthy').length,
      warning: workspaceHealthSummaries.filter((summary) => summary.status === 'warning').length,
    }),
    [workspaceHealthSummaries],
  )
  useEffect(() => {
    const previousSummaries = previousWorkspaceHealthSummariesRef.current
    if (!workspaceHealthInitializedRef.current) {
      workspaceHealthInitializedRef.current = true
      previousWorkspaceHealthSummariesRef.current = workspaceHealthSummaries
      setWorkspaceHealthDelta({ improved: [], regressed: [] })
      return
    }

    const previousByWorkspaceId = new Map(
      previousSummaries.map((summary) => [summary.workspaceId, summary]),
    )
    const improved: WorkspaceHealthSummary[] = []
    const regressed: WorkspaceHealthSummary[] = []

    for (const summary of workspaceHealthSummaries) {
      const previous = previousByWorkspaceId.get(summary.workspaceId)
      if (!previous) {
        if (summary.status !== 'healthy' || summary.score > 0) {
          regressed.push(summary)
        }
        continue
      }

      const statusDelta =
        getWorkspaceHealthStatusRank(summary.status) - getWorkspaceHealthStatusRank(previous.status)
      const scoreDelta = summary.score - previous.score

      if (statusDelta > 0 || (statusDelta === 0 && scoreDelta >= 10)) {
        regressed.push(summary)
      } else if (statusDelta < 0 || (statusDelta === 0 && scoreDelta <= -10)) {
        improved.push(summary)
      }
    }

    setWorkspaceHealthDelta({ improved, regressed })
    previousWorkspaceHealthSummariesRef.current = workspaceHealthSummaries
  }, [workspaceHealthSummaries])
  const attentionWorkspaceCount = eventHubWorkspaceSummaries.filter((item) => item.needsAttention).length
  const previousEventHubWorkspaceByID = useMemo(
    () =>
      Object.fromEntries(
        (eventHubPreviousSnapshot?.workspaces ?? []).map((workspace) => [workspace.workspaceId, workspace]),
      ),
    [eventHubPreviousSnapshot?.workspaces],
  )
  const previousEventHubSubscriberByKey = useMemo(() => {
    const entries: Array<[string, EventHubSubscriberDiagnostics]> = []
    for (const workspace of eventHubPreviousSnapshot?.workspaces ?? []) {
      for (const subscriber of workspace.subscribers) {
        entries.push([
          buildEventHubSubscriberEntryKey('workspace', workspace.workspaceId, subscriber.id),
          subscriber,
        ])
      }
    }
    for (const subscriber of eventHubPreviousSnapshot?.globalSubscribers ?? []) {
      entries.push([buildEventHubSubscriberEntryKey('global', '', subscriber.id), subscriber])
    }
    return Object.fromEntries(entries)
  }, [eventHubPreviousSnapshot])
  const eventHubSummaryDelta = useMemo(() => {
    const current = eventHubDiagnosticsQuery.data
    const previous = eventHubPreviousSnapshot
    if (!current || !previous) {
      return null
    }
    return {
      buffered: current.totalBufferedEventCount - previous.totalBufferedEventCount,
      dropped: current.totalDroppedCount - previous.totalDroppedCount,
      softDropped: current.totalSoftDroppedCount - previous.totalSoftDroppedCount,
      hardDropped: current.totalHardDroppedCount - previous.totalHardDroppedCount,
      hardEvicted: current.totalHardEvictedCount - previous.totalHardEvictedCount,
      merged: current.totalMergedCount - previous.totalMergedCount,
      mergedBytes:
        current.totalCoalescedCommandOutputBytes - previous.totalCoalescedCommandOutputBytes,
    }
  }, [eventHubDiagnosticsQuery.data, eventHubPreviousSnapshot])
  const normalizedEventHubWorkspaceFilter = normalizeFilterText(eventHubWorkspaceFilter)
  const normalizedEventHubSubscriberFilter = normalizeFilterText(eventHubSubscriberFilter)
  const eventHubWorkspaceSortOptions = useMemo(
    () => [
      {
        value: 'attention',
        label: i18n._({ id: 'Attention first', message: 'Attention first' }),
      },
      {
        value: 'dropped',
        label: i18n._({ id: 'Dropped desc', message: 'Dropped desc' }),
      },
      {
        value: 'buffered',
        label: i18n._({ id: 'Buffered desc', message: 'Buffered desc' }),
      },
      {
        value: 'mergedBytes',
        label: i18n._({ id: 'Merged bytes desc', message: 'Merged bytes desc' }),
      },
      {
        value: 'subscribers',
        label: i18n._({ id: 'Subscribers desc', message: 'Subscribers desc' }),
      },
      {
        value: 'headSeq',
        label: i18n._({ id: 'Head seq desc', message: 'Head seq desc' }),
      },
      {
        value: 'name',
        label: i18n._({ id: 'Name A-Z', message: 'Name A-Z' }),
      },
    ],
    [],
  )
  const eventHubSubscriberSortOptions = useMemo(
    () => [
      {
        value: 'attention',
        label: i18n._({ id: 'Attention first', message: 'Attention first' }),
      },
      {
        value: 'dropped',
        label: i18n._({ id: 'Dropped desc', message: 'Dropped desc' }),
      },
      {
        value: 'queue',
        label: i18n._({ id: 'Queue desc', message: 'Queue desc' }),
      },
      {
        value: 'mergedBytes',
        label: i18n._({ id: 'Merged bytes desc', message: 'Merged bytes desc' }),
      },
      {
        value: 'seq',
        label: i18n._({ id: 'Seq desc', message: 'Seq desc' }),
      },
      {
        value: 'recent',
        label: i18n._({ id: 'Recent activity', message: 'Recent activity' }),
      },
      {
        value: 'identity',
        label: i18n._({ id: 'Identity A-Z', message: 'Identity A-Z' }),
      },
    ],
    [],
  )
  const filteredEventHubWorkspaceSummaries = useMemo(() => {
    const items = eventHubWorkspaceSummaries
      .map((item) => {
        const previousWorkspace = previousEventHubWorkspaceByID[item.workspace.workspaceId]
        const previousSummary = previousWorkspace
          ? buildEventHubWorkspaceSummary(previousWorkspace)
          : null
        return {
          ...item,
          delta: previousSummary
            ? {
                buffered: item.buffered - previousSummary.buffered,
                dropped: item.dropped - previousSummary.dropped,
                softDropped: item.softDropped - previousSummary.softDropped,
                hardDropped: item.hardDropped - previousSummary.hardDropped,
                hardEvicted: item.hardEvicted - previousSummary.hardEvicted,
                merged: item.merged - previousSummary.merged,
                mergedBytes:
                  item.coalescedCommandOutputBytes - previousSummary.coalescedCommandOutputBytes,
              }
            : null,
        }
      })
      .filter((item) => {
      if (eventHubAttentionOnly && !item.needsAttention) {
        return false
      }
      if (!normalizedEventHubWorkspaceFilter) {
        return true
      }

      const haystack = [
        item.workspace.workspaceId,
        workspaceNameById[item.workspace.workspaceId] ?? '',
        ...item.workspace.subscribers.flatMap((subscriber) => [
          subscriber.role ?? '',
          subscriber.source ?? '',
          subscriber.lastMethod ?? '',
        ]),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedEventHubWorkspaceFilter)
      })

    const compareByAttention = (left: (typeof items)[number], right: (typeof items)[number]) =>
      Number(right.needsAttention) - Number(left.needsAttention) ||
      right.dropped - left.dropped ||
      right.buffered - left.buffered ||
      right.coalescedCommandOutputBytes - left.coalescedCommandOutputBytes ||
      (workspaceNameById[left.workspace.workspaceId] ?? left.workspace.workspaceId).localeCompare(
        workspaceNameById[right.workspace.workspaceId] ?? right.workspace.workspaceId,
      )

    return [...items].sort((left, right) => {
      switch (eventHubWorkspaceSort) {
        case 'dropped':
          return (
            right.dropped - left.dropped ||
            right.softDropped - left.softDropped ||
            right.hardDropped - left.hardDropped ||
            compareByAttention(left, right)
          )
        case 'buffered':
          return right.buffered - left.buffered || compareByAttention(left, right)
        case 'mergedBytes':
          return (
            right.coalescedCommandOutputBytes - left.coalescedCommandOutputBytes ||
            right.merged - left.merged ||
            compareByAttention(left, right)
          )
        case 'subscribers':
          return right.workspace.subscriberCount - left.workspace.subscriberCount || compareByAttention(left, right)
        case 'headSeq':
          return (right.workspace.headSeq ?? 0) - (left.workspace.headSeq ?? 0) || compareByAttention(left, right)
        case 'name':
          return (
            (workspaceNameById[left.workspace.workspaceId] ?? left.workspace.workspaceId).localeCompare(
              workspaceNameById[right.workspace.workspaceId] ?? right.workspace.workspaceId,
            ) || compareByAttention(left, right)
          )
        case 'attention':
        default:
          return compareByAttention(left, right)
      }
    })
  }, [
    eventHubAttentionOnly,
    eventHubWorkspaceSort,
    eventHubWorkspaceSummaries,
    normalizedEventHubWorkspaceFilter,
    previousEventHubWorkspaceByID,
    workspaceNameById,
  ])
  const filteredEventHubSubscriberEntries = useMemo(() => {
    const entries = [
      ...filteredEventHubWorkspaceSummaries.flatMap((item) =>
        item.workspace.subscribers.map((subscriber) => ({
          kind: 'workspace' as const,
          workspaceId: item.workspace.workspaceId,
          workspaceName: workspaceNameById[item.workspace.workspaceId] ?? item.workspace.workspaceId,
          subscriber,
          needsAttention:
            subscriber.queueLen + subscriber.outputBufferLen > 0 || subscriber.droppedCount > 0,
        })),
      ),
      ...(eventHubDiagnosticsQuery.data?.globalSubscribers ?? []).map((subscriber) => ({
        kind: 'global' as const,
        workspaceId: '',
        workspaceName: i18n._({ id: 'Global', message: 'Global' }),
        subscriber,
        needsAttention:
          subscriber.queueLen + subscriber.outputBufferLen > 0 || subscriber.droppedCount > 0,
      })),
    ].filter((entry) => {
      if (eventHubAttentionOnly && !entry.needsAttention) {
        return false
      }
      if (!normalizedEventHubSubscriberFilter) {
        return true
      }
      const haystack = [
        entry.workspaceId,
        entry.workspaceName,
        entry.subscriber.role ?? '',
        entry.subscriber.source ?? '',
        entry.subscriber.scope ?? '',
        entry.subscriber.lastMethod ?? '',
        formatSubscriberIdentity(entry.subscriber),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedEventHubSubscriberFilter)
    })

    const entriesWithDelta = entries.map((entry) => {
      const previousSubscriber =
        previousEventHubSubscriberByKey[
          buildEventHubSubscriberEntryKey(entry.kind, entry.workspaceId, entry.subscriber.id)
        ]
      return {
        ...entry,
        delta: previousSubscriber
          ? {
              queue:
                entry.subscriber.queueLen +
                entry.subscriber.outputBufferLen -
                (previousSubscriber.queueLen + previousSubscriber.outputBufferLen),
              dropped: entry.subscriber.droppedCount - previousSubscriber.droppedCount,
              softDropped:
                entry.subscriber.softDroppedCount - previousSubscriber.softDroppedCount,
              hardDropped:
                entry.subscriber.hardDroppedCount - previousSubscriber.hardDroppedCount,
              hardEvicted:
                entry.subscriber.hardEvictedCount - previousSubscriber.hardEvictedCount,
              merged: entry.subscriber.mergedCount - previousSubscriber.mergedCount,
              mergedBytes:
                entry.subscriber.coalescedCommandOutputBytes -
                previousSubscriber.coalescedCommandOutputBytes,
            }
          : null,
      }
    })

    const subscriberActivityTime = (subscriber: EventHubSubscriberDiagnostics) =>
      Date.parse(
        subscriber.lastQueuedAt ??
          subscriber.lastDequeuedAt ??
          subscriber.lastMergedAt ??
          subscriber.lastDroppedAt ??
          '',
      ) || 0

    const compareByAttention = (
      left: (typeof entriesWithDelta)[number],
      right: (typeof entriesWithDelta)[number],
    ) =>
      Number(right.needsAttention) - Number(left.needsAttention) ||
      right.subscriber.droppedCount - left.subscriber.droppedCount ||
      (right.subscriber.queueLen + right.subscriber.outputBufferLen) -
        (left.subscriber.queueLen + left.subscriber.outputBufferLen) ||
      right.subscriber.coalescedCommandOutputBytes - left.subscriber.coalescedCommandOutputBytes ||
      formatSubscriberIdentity(left.subscriber).localeCompare(formatSubscriberIdentity(right.subscriber))

    return [...entriesWithDelta].sort((left, right) => {
      switch (eventHubSubscriberSort) {
        case 'dropped':
          return right.subscriber.droppedCount - left.subscriber.droppedCount || compareByAttention(left, right)
        case 'queue':
          return (
            (right.subscriber.queueLen + right.subscriber.outputBufferLen) -
              (left.subscriber.queueLen + left.subscriber.outputBufferLen) ||
            compareByAttention(left, right)
          )
        case 'mergedBytes':
          return (
            right.subscriber.coalescedCommandOutputBytes - left.subscriber.coalescedCommandOutputBytes ||
            right.subscriber.mergedCount - left.subscriber.mergedCount ||
            compareByAttention(left, right)
          )
        case 'seq':
          return (right.subscriber.lastSeq ?? 0) - (left.subscriber.lastSeq ?? 0) || compareByAttention(left, right)
        case 'recent':
          return subscriberActivityTime(right.subscriber) - subscriberActivityTime(left.subscriber) || compareByAttention(left, right)
        case 'identity':
          return formatSubscriberIdentity(left.subscriber).localeCompare(formatSubscriberIdentity(right.subscriber)) || compareByAttention(left, right)
        case 'attention':
        default:
          return compareByAttention(left, right)
      }
    })
  }, [
    eventHubAttentionOnly,
    eventHubDiagnosticsQuery.data?.globalSubscribers,
    eventHubSubscriberSort,
    filteredEventHubWorkspaceSummaries,
    normalizedEventHubSubscriberFilter,
    previousEventHubSubscriberByKey,
    workspaceNameById,
  ])
  const toggleEventHubSubscriberExpanded = (
    key: string,
  ) => {
    setEventHubExpandedSubscriberKeys((current) => ({
      ...current,
      [key]: !current[key],
    }))
  }
  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Inspect the registered project roots and runtime posture for the current client environment.',
          message: 'Inspect the registered project roots and runtime posture for the current client environment.',
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">
              {i18n._({
                id: '{count} roots',
                message: '{count} roots',
                values: { count: workspaces.length },
              })}
            </span>
          </>
        }
        title={i18n._({ id: 'Environment', message: 'Environment' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Global environment snapshot across all registered workspaces.',
            message: 'Global environment snapshot across all registered workspaces.',
          })}
          title={i18n._({ id: 'Workspace Registry', message: 'Workspace Registry' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Review the current runtime footprint and health across all registered roots.',
              message: 'Review the current runtime footprint and health across all registered roots.',
            })}
            title={i18n._({ id: 'Summary', message: 'Summary' })}
          >
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>{i18n._({ id: 'Total', message: 'Total' })}</span>
                <strong>{workspaces.length}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Healthy', message: 'Healthy' })}</span>
                <strong>{healthyWorkspaces}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Attention', message: 'Attention' })}</span>
                <strong>{attentionWorkspaces}</strong>
              </div>
            </div>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Each registered workspace acts as an environment root for threads, runtime tools, and settings-scoped actions.',
              message:
                'Each registered workspace acts as an environment root for threads, runtime tools, and settings-scoped actions.',
            })}
            title={i18n._({ id: 'Registered Roots', message: 'Registered Roots' })}
          >
            {workspacesLoading ? (
              <div className="notice">{i18n._({ id: 'Loading workspaces…', message: 'Loading workspaces…' })}</div>
            ) : null}
            {workspacesError ? (
              <InlineNotice
                dismissible
                noticeKey={`environment-workspaces-${workspacesError}`}
                title={i18n._({ id: 'Failed To Load Workspaces', message: 'Failed To Load Workspaces' })}
                tone="error"
              >
                {workspacesError}
              </InlineNotice>
            ) : null}
            {!workspacesLoading && !workspaces.length ? (
              <div className="empty-state">
                {i18n._({
                  id: 'No workspaces registered yet.',
                  message: 'No workspaces registered yet.',
                })}
              </div>
            ) : null}
            <div className="settings-record-list">
              {workspaces.map((workspace) => (
                <SettingsRecord
                  action={
                    <span className="meta-pill">
                      {i18n._({ id: 'Environment Root', message: 'Environment Root' })}
                    </span>
                  }
                  description={i18n._({
                    id: '{root} · updated {time}',
                    message: '{root} · updated {time}',
                    values: {
                      root: workspace.rootPath,
                      time: formatRelativeTimeShort(workspace.updatedAt),
                    },
                  })}
                  key={workspace.id}
                  marker="EN"
                  meta={
                    <>
                      <span className="meta-pill">{workspace.id.slice(0, 8)}</span>
                      <StatusPill status={workspace.runtimeStatus} />
                    </>
                  }
                  title={workspace.name}
                />
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Inspect the effective app-server command and the shell environment policy currently resolved for the selected workspace.',
            message:
              'Inspect the effective app-server command and the shell environment policy currently resolved for the selected workspace.',
          })}
          title={i18n._({ id: 'Runtime Inspection', message: 'Runtime Inspection' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Switch the focused workspace to inspect its runtime-backed config and restart behavior.',
              message:
                'Switch the focused workspace to inspect its runtime-backed config and restart behavior.',
            })}
            title={i18n._({ id: 'Selected Workspace', message: 'Selected Workspace' })}
          >
            <div className="form-stack">
              <SettingsWorkspaceScopePanel
                description={i18n._({
                  id: 'Choose the workspace whose live runtime config and process state you want to inspect.',
                  message:
                    'Choose the workspace whose live runtime config and process state you want to inspect.',
                })}
                title={i18n._({ id: 'Workspace Runtime Scope', message: 'Workspace Runtime Scope' })}
              />
              <div className="header-actions">
                {selectedWorkspace?.runtimeStatus ? (
                  <StatusPill status={selectedWorkspace.runtimeStatus} />
                ) : (
                  <span className="meta-pill">
                    {i18n._({ id: 'Unknown', message: 'Unknown' })}
                  </span>
                )}
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!workspaceId || restartWorkspaceMutation.isPending}
                  onClick={() => workspaceId && restartWorkspaceMutation.mutate(workspaceId)}
                  type="button"
                >
                  {restartWorkspaceMutation.isPending
                    ? i18n._({ id: 'Restarting…', message: 'Restarting…' })
                    : i18n._({ id: 'Restart Runtime', message: 'Restart Runtime' })}
                </button>
              </div>
              <p className="config-inline-note">
                {i18n._({
                  id: 'Changing shell_environment_policy affects new child processes. Restart the workspace runtime to force app-server to reload Codex config.',
                  message:
                    'Changing shell_environment_policy affects new child processes. Restart the workspace runtime to force app-server to reload Codex config.',
                })}
              </p>
              {workspaceRuntimeStateQuery.data ? (
                <SettingsJsonPreview
                  collapsible={false}
                  description={i18n._({
                    id: 'Observed runtime process state for the selected workspace.',
                    message: 'Observed runtime process state for the selected workspace.',
                  })}
                  title={i18n._({ id: 'Runtime State', message: 'Runtime State' })}
                  value={workspaceRuntimeStateQuery.data}
                />
              ) : null}
              {runtimeRecoverySummary && workspaceRuntimeStateQuery.data ? (
                <InlineNotice
                  action={RuntimeRecoveryActionGroup({
                    configSettingsPath: '/settings/config',
                    environmentSettingsPath: '/settings/environment',
                    onRestartRuntime: workspaceId
                      ? () => restartWorkspaceMutation.mutate(workspaceId)
                      : undefined,
                    restartRuntimePending: restartWorkspaceMutation.isPending,
                    summary: runtimeRecoverySummary,
                  })}
                  details={runtimeRecoverySummary.details}
                  noticeKey={`environment-runtime-recovery-${workspaceId}-${workspaceRuntimeStateQuery.data.updatedAt}-${workspaceRuntimeStateQuery.data.lastErrorCategory ?? ''}-${workspaceRuntimeStateQuery.data.lastErrorRecoveryAction ?? ''}-${workspaceRuntimeStateQuery.data.lastError ?? ''}`}
                  title={runtimeRecoverySummary.title}
                  tone={runtimeRecoverySummary.tone}
                >
                  <RuntimeRecoveryNoticeContent summary={runtimeRecoverySummary} />
                </InlineNotice>
              ) : null}
              {workspaceRuntimeStateQuery.data ? (
                <InlineNotice
                  noticeKey={`runtime-load-status-${workspaceId}-${workspaceRuntimeStateQuery.data.configLoadStatus}`}
                  title={i18n._({
                    id: 'Config Load Status: {status}',
                    message: 'Config Load Status: {status}',
                    values: {
                      status: formatLocalizedStatusLabel(workspaceRuntimeStateQuery.data.configLoadStatus),
                    },
                  })}
                  tone={workspaceRuntimeStateQuery.data.restartRequired ? 'error' : 'info'}
                >
                  {workspaceRuntimeStateQuery.data.restartRequired
                    ? i18n._({
                        id: 'The tracked runtime-affecting config was changed after the current runtime process started. Restart is required to guarantee the live process has loaded the latest configuration.',
                        message:
                          'The tracked runtime-affecting config was changed after the current runtime process started. Restart is required to guarantee the live process has loaded the latest configuration.',
                      })
                    : i18n._({
                        id: 'The current runtime process started after the last tracked runtime-affecting config change, or no tracked config change exists.',
                        message:
                          'The current runtime process started after the last tracked runtime-affecting config change, or no tracked config change exists.',
                      })}
                </InlineNotice>
              ) : null}
            </div>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'These config keys are treated as runtime-sensitive by codex-server. Writing any of them marks the current workspace runtime as potentially stale until restart.',
              message:
                'These config keys are treated as runtime-sensitive by codex-server. Writing any of them marks the current workspace runtime as potentially stale until restart.',
            })}
            title={i18n._({ id: 'Tracked Runtime-Sensitive Keys', message: 'Tracked Runtime-Sensitive Keys' })}
          >
            <div className="settings-record-list">
              {runtimeSensitiveConfigItems.map((item) => (
                <SettingsRecord
                  key={item.keyPath}
                  marker="RT"
                  title={item.keyPath}
                  description={item.description}
                />
              ))}
            </div>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Global app-server launch command after codex-server runtime preference resolution.',
              message:
                'Global app-server launch command after codex-server runtime preference resolution.',
            })}
            title={i18n._({ id: 'Effective Command', message: 'Effective Command' })}
          >
            {runtimePreferencesQuery.data ? (
              <SettingsJsonPreview
                collapsible={false}
                description={i18n._({
                  id: 'This is the command codex-server will use when it starts or restarts a workspace runtime.',
                  message:
                    'This is the command codex-server will use when it starts or restarts a workspace runtime.',
                })}
                title={i18n._({ id: 'App-Server Command', message: 'App-Server Command' })}
                value={{ effectiveCommand: runtimePreferencesQuery.data.effectiveCommand }}
              />
            ) : (
              <div className="notice">{i18n._({ id: 'Loading runtime preferences…', message: 'Loading runtime preferences…' })}</div>
            )}
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Resolved shell_environment_policy from config/read for the currently selected workspace.',
              message:
                'Resolved shell_environment_policy from config/read for the currently selected workspace.',
            })}
            title={i18n._({ id: 'Shell Environment Policy', message: 'Shell Environment Policy' })}
          >
            <div className="form-stack">
              {selectedWorkspaceConfigQuery.isLoading ? (
                <div className="notice">{i18n._({ id: 'Loading workspace config…', message: 'Loading workspace config…' })}</div>
              ) : null}
              {selectedWorkspaceConfigQuery.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`environment-config-${workspaceId}`}
                  title={i18n._({ id: 'Failed To Load Runtime Config', message: 'Failed To Load Runtime Config' })}
                  tone="error"
                >
                  {getErrorMessage(selectedWorkspaceConfigQuery.error)}
                </InlineNotice>
              ) : null}
              <SettingsJsonPreview
                collapsible={false}
                description={i18n._({
                  id: 'Structured diagnosis derived from the currently resolved shell_environment_policy object.',
                  message:
                    'Structured diagnosis derived from the currently resolved shell_environment_policy object.',
                })}
                title={i18n._({ id: 'Diagnosis', message: 'Diagnosis' })}
                value={shellEnvironmentDiagnosis.summary}
              />
              {shellEnvironmentDiagnosis.warning ? (
                <InlineNotice
                  noticeKey={`shell-environment-warning-${workspaceId}-${shellEnvironmentDiagnosis.summary.inherit}`}
                  title={i18n._({ id: 'Potential Windows Execution Risk', message: 'Potential Windows Execution Risk' })}
                  tone="error"
                >
                  {shellEnvironmentDiagnosis.warning}
                </InlineNotice>
              ) : (
                <InlineNotice
                  noticeKey={`shell-environment-info-${workspaceId}-${shellEnvironmentDiagnosis.summary.inherit}`}
                  title={i18n._({ id: 'Environment Check', message: 'Environment Check' })}
                >
                  {shellEnvironmentDiagnosis.info}
                </InlineNotice>
              )}
              <div className="header-actions">
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!workspaceId || applyShellEnvironmentPolicyPresetMutation.isPending}
                  onClick={() => applyShellEnvironmentPolicyPresetMutation.mutate('inherit-all')}
                  type="button"
                >
                  {applyShellEnvironmentPolicyPresetMutation.isPending
                    ? i18n._({ id: 'Applying…', message: 'Applying…' })
                    : i18n._({ id: 'Apply inherit=all + Restart', message: 'Apply inherit=all + Restart' })}
                </button>
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!workspaceId || applyShellEnvironmentPolicyPresetMutation.isPending}
                  onClick={() => applyShellEnvironmentPolicyPresetMutation.mutate('core-windows')}
                  type="button"
                >
                  {applyShellEnvironmentPolicyPresetMutation.isPending
                    ? i18n._({ id: 'Applying…', message: 'Applying…' })
                    : i18n._({ id: 'Apply core+Windows + Restart', message: 'Apply core+Windows + Restart' })}
                </button>
              </div>
              {applyShellEnvironmentPolicyPresetMutation.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`shell-environment-preset-${workspaceId}`}
                  title={i18n._({ id: 'Preset Apply Failed', message: 'Preset Apply Failed' })}
                  tone="error"
                >
                  {getErrorMessage(applyShellEnvironmentPolicyPresetMutation.error)}
                </InlineNotice>
              ) : null}
              {shellEnvironmentPolicy ? (
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Effective shell_environment_policy returned by app-server config/read.',
                    message:
                      'Effective shell_environment_policy returned by app-server config/read.',
                  })}
                  title="shell_environment_policy"
                  value={shellEnvironmentPolicy}
                />
              ) : (
                <div className="empty-state">
                  {i18n._({
                    id: 'No shell_environment_policy key is currently present in the resolved config.',
                    message:
                      'No shell_environment_policy key is currently present in the resolved config.',
                  })}
                </div>
              )}
              {shellEnvironmentOrigins ? (
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Origin entries for shell_environment_policy and its nested keys.',
                    message:
                      'Origin entries for shell_environment_policy and its nested keys.',
                  })}
                  title={i18n._({ id: 'Origins', message: 'Origins' })}
                  value={shellEnvironmentOrigins}
                />
              ) : null}
              {selectedWorkspaceConfigQuery.data?.layers ? (
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Merged config layers returned by app-server for this workspace.',
                    message:
                      'Merged config layers returned by app-server for this workspace.',
                  })}
                  title={i18n._({ id: 'Layers', message: 'Layers' })}
                  value={selectedWorkspaceConfigQuery.data.layers}
                />
              ) : null}
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Observe realtime websocket fan-out pressure, buffered events, and per-workspace subscriber health from the backend event hub.',
            message:
              'Observe realtime websocket fan-out pressure, buffered events, and per-workspace subscriber health from the backend event hub.',
          })}
          meta={
            <>
              <span className="meta-pill">
                {eventHubDiagnosticsQuery.data
                  ? i18n._({
                      id: 'Captured {time}',
                      message: 'Captured {time}',
                      values: {
                        time: formatLocaleDateTime(eventHubDiagnosticsQuery.data.capturedAt),
                      },
                    })
                  : i18n._({
                      id: 'Awaiting sample',
                      message: 'Awaiting sample',
                    })}
              </span>
              <button
                className="notice__tool"
                disabled={eventHubDiagnosticsQuery.isFetching}
                onClick={() => void eventHubDiagnosticsQuery.refetch()}
                type="button"
              >
                {eventHubDiagnosticsQuery.isFetching
                  ? i18n._({ id: 'Refreshing…', message: 'Refreshing…' })
                  : i18n._({ id: 'Refresh', message: 'Refresh' })}
              </button>
            </>
          }
          title={i18n._({ id: 'Realtime Event Hub', message: 'Realtime Event Hub' })}
        >
          <SettingRow
            description={i18n._({
              id: 'This snapshot is sampled from backend /api/runtime/event-hub and refreshes every 5 seconds while this page is open.',
              message:
                'This snapshot is sampled from backend /api/runtime/event-hub and refreshes every 5 seconds while this page is open.',
            })}
            title={i18n._({ id: 'Hub Summary', message: 'Hub Summary' })}
          >
            {eventHubDiagnosticsQuery.isLoading ? (
              <div className="notice">
                {i18n._({
                  id: 'Loading event hub diagnostics…',
                  message: 'Loading event hub diagnostics…',
                })}
              </div>
            ) : null}
            {eventHubDiagnosticsQuery.error ? (
              <InlineNotice
                dismissible
                noticeKey={`runtime-event-hub-${getErrorMessage(eventHubDiagnosticsQuery.error)}`}
                title={i18n._({
                  id: 'Event Hub Diagnostics Failed',
                  message: 'Event Hub Diagnostics Failed',
                })}
                tone="error"
              >
                {getErrorMessage(eventHubDiagnosticsQuery.error)}
              </InlineNotice>
            ) : null}
            {eventHubDiagnosticsQuery.data ? (
              <div className="form-stack">
                <div className="mode-metrics">
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Workspaces', message: 'Workspaces' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.workspaceCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Subscribers', message: 'Subscribers' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalSubscriberCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Buffered', message: 'Buffered' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalBufferedEventCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Dropped', message: 'Dropped' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalDroppedCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Soft Drop', message: 'Soft Drop' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalSoftDroppedCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Hard Drop', message: 'Hard Drop' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalHardDroppedCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Evicted', message: 'Evicted' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalHardEvictedCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Merged', message: 'Merged' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalMergedCount}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Merged Bytes', message: 'Merged Bytes' })}</span>
                    <strong>{eventHubDiagnosticsQuery.data.totalCoalescedCommandOutputBytes}</strong>
                  </div>
                </div>
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Global subscribers: {globalCount}. Workspaces currently showing buffered or dropped pressure: {workspaceCount}.',
                    message:
                      'Global subscribers: {globalCount}. Workspaces currently showing buffered or dropped pressure: {workspaceCount}.',
                    values: {
                      globalCount: eventHubDiagnosticsQuery.data.globalSubscriberCount,
                      workspaceCount: attentionWorkspaceCount,
                    },
                  })}
                </p>
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Drop breakdown: soft {soft}, hard {hard}, hard-evicted {evicted}. Top coalesced methods: {methods}.',
                    message:
                      'Drop breakdown: soft {soft}, hard {hard}, hard-evicted {evicted}. Top coalesced methods: {methods}.',
                    values: {
                      soft: eventHubDiagnosticsQuery.data.totalSoftDroppedCount,
                      hard: eventHubDiagnosticsQuery.data.totalHardDroppedCount,
                      evicted: eventHubDiagnosticsQuery.data.totalHardEvictedCount,
                      methods: formatMethodCounterSummary(
                        eventHubDiagnosticsQuery.data.totalCoalescedByMethod,
                      ),
                    },
                  })}
                </p>
                {eventHubSummaryDelta ? (
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Since the previous sample: buffered {buffered}, dropped {dropped}, merged {merged}, merged bytes {mergedBytes}.',
                      message:
                        'Since the previous sample: buffered {buffered}, dropped {dropped}, merged {merged}, merged bytes {mergedBytes}.',
                      values: {
                        buffered: formatDeltaLabel('Δbuffered', eventHubSummaryDelta.buffered),
                        dropped: formatDeltaLabel('Δdropped', eventHubSummaryDelta.dropped),
                        merged: formatDeltaLabel('Δmerged', eventHubSummaryDelta.merged),
                        mergedBytes: formatDeltaLabel('Δbytes', eventHubSummaryDelta.mergedBytes),
                      },
                    })}
                  </p>
                ) : null}
                {eventHubDiagnosticsQuery.data.totalDroppedCount > 0 ? (
                  <InlineNotice
                    noticeKey={`event-hub-pressure-${eventHubDiagnosticsQuery.data.totalDroppedCount}-${eventHubDiagnosticsQuery.data.totalBufferedEventCount}`}
                    title={i18n._({
                      id: 'Backpressure Detected',
                      message: 'Backpressure Detected',
                    })}
                    tone="error"
                  >
                    {i18n._({
                      id: 'At least one subscriber has dropped droppable events. Inspect the per-workspace list below to find the slow or bursty consumer.',
                      message:
                        'At least one subscriber has dropped droppable events. Inspect the per-workspace list below to find the slow or bursty consumer.',
                    })}
                  </InlineNotice>
                ) : eventHubDiagnosticsQuery.data.totalBufferedEventCount > 0 ? (
                  <InlineNotice
                    noticeKey={`event-hub-buffered-${eventHubDiagnosticsQuery.data.totalBufferedEventCount}`}
                    title={i18n._({
                      id: 'Buffered Events In Flight',
                      message: 'Buffered Events In Flight',
                    })}
                  >
                    {i18n._({
                      id: 'Subscribers currently have pending queue or output buffer backlog, but no droppable events have been discarded in this snapshot.',
                      message:
                        'Subscribers currently have pending queue or output buffer backlog, but no droppable events have been discarded in this snapshot.',
                    })}
                  </InlineNotice>
                ) : (
                  <InlineNotice
                    noticeKey={`event-hub-healthy-${eventHubDiagnosticsQuery.data.totalSubscriberCount}`}
                    title={i18n._({
                      id: 'Realtime Fan-Out Healthy',
                      message: 'Realtime Fan-Out Healthy',
                    })}
                  >
                    {i18n._({
                      id: 'No buffered backlog or dropped droppable events were observed in the latest sample.',
                      message:
                        'No buffered backlog or dropped droppable events were observed in the latest sample.',
                    })}
                  </InlineNotice>
                )}
              </div>
            ) : null}
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Local browser-side workspace stream manager state, including leader election, queue depth, reconnect scheduling, and the expected backend subscriber identity.',
              message:
                'Local browser-side workspace stream manager state, including leader election, queue depth, reconnect scheduling, and the expected backend subscriber identity.',
            })}
            title={i18n._({
              id: 'Frontend Workspace Stream Manager',
              message: 'Frontend Workspace Stream Manager',
            })}
          >
            <div className="form-stack">
              <div className="mode-metrics">
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Tab Instance', message: 'Tab Instance' })}</span>
                  <strong>{frontendWorkspaceStreamDiagnostics.tabInstanceId}</strong>
                </div>
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Tracked', message: 'Tracked' })}</span>
                  <strong>{frontendWorkspaceStreamDiagnostics.trackedWorkspaceCount}</strong>
                </div>
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Leaders', message: 'Leaders' })}</span>
                  <strong>{frontendWorkspaceStreamDiagnostics.leaderWorkspaceCount}</strong>
                </div>
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Followers', message: 'Followers' })}</span>
                  <strong>{frontendWorkspaceStreamDiagnostics.followerWorkspaceCount}</strong>
                </div>
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Direct', message: 'Direct' })}</span>
                  <strong>{frontendWorkspaceStreamDiagnostics.directWorkspaceCount}</strong>
                </div>
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Broadcast', message: 'Broadcast' })}</span>
                  <strong>
                    {frontendWorkspaceStreamDiagnostics.broadcastSupported
                      ? i18n._({ id: 'Supported', message: 'Supported' })
                      : i18n._({ id: 'Unavailable', message: 'Unavailable' })}
                  </strong>
                </div>
                <div className="mode-metric">
                  <span>{i18n._({ id: 'Attention', message: 'Attention' })}</span>
                  <strong>{frontendWorkspaceStreamAttentionCount}</strong>
                </div>
              </div>
              <p className="config-inline-note">
                {i18n._({
                  id: 'Snapshot captured {time}. Use this pane together with backend subscriber source/role to confirm whether the current tab is the live websocket owner or only a follower.',
                  message:
                    'Snapshot captured {time}. Use this pane together with backend subscriber source/role to confirm whether the current tab is the live websocket owner or only a follower.',
                  values: {
                    time: formatLocaleDateTime(frontendWorkspaceStreamDiagnostics.capturedAt),
                  },
                })}
              </p>
              <p className="config-inline-note">
                {i18n._({
                  id: 'Attention summary: backend identity mismatches {mismatchCount} · correlation anomalies {correlationCount} (critical {criticalCount} / warning {warningCount}) · reconnect activity {reconnectCount} · local backlog {bufferedCount}.',
                  message:
                    'Attention summary: backend identity mismatches {mismatchCount} · correlation anomalies {correlationCount} (critical {criticalCount} / warning {warningCount}) · reconnect activity {reconnectCount} · local backlog {bufferedCount}.',
                  values: {
                    bufferedCount: frontendWorkspaceStreamBufferedCount,
                    correlationCount: frontendWorkspaceStreamCorrelationCount,
                    criticalCount: frontendWorkspaceStreamCriticalCorrelationCount,
                    mismatchCount: frontendWorkspaceStreamBackendMismatchCount,
                    reconnectCount: frontendWorkspaceStreamReconnectCount,
                    warningCount: frontendWorkspaceStreamWarningCorrelationCount,
                  },
                })}
              </p>
              {frontendCorrelationAlertDelta.newAlerts.length || frontendCorrelationAlertDelta.resolvedAlerts.length ? (
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Alert delta since the previous local sample: new {newCount} · resolved {resolvedCount}.',
                    message:
                      'Alert delta since the previous local sample: new {newCount} · resolved {resolvedCount}.',
                    values: {
                      newCount: frontendCorrelationAlertDelta.newAlerts.length,
                      resolvedCount: frontendCorrelationAlertDelta.resolvedAlerts.length,
                    },
                  })}
                </p>
              ) : null}
              {frontendWorkspaceStreamAttentionCount > 0 ? (
                <InlineNotice
                  noticeKey={`frontend-workspace-stream-attention-${frontendWorkspaceStreamAttentionCount}-${frontendWorkspaceStreamBackendMismatchCount}-${frontendWorkspaceStreamReconnectCount}`}
                  title={i18n._({
                    id: 'Browser Stream Attention Required',
                    message: 'Browser Stream Attention Required',
                  })}
                  tone="error"
                >
                  {i18n._({
                    id: 'At least one local workspace stream shows a backend mismatch, reconnect attempt, stale leader heartbeat, or queued backlog. Use the records below to correlate with backend subscribers.',
                    message:
                      'At least one local workspace stream shows a backend mismatch, reconnect attempt, stale leader heartbeat, or queued backlog. Use the records below to correlate with backend subscribers.',
                  })}
                </InlineNotice>
              ) : (
                <InlineNotice
                  noticeKey={`frontend-workspace-stream-healthy-${frontendWorkspaceStreamDiagnostics.trackedWorkspaceCount}`}
                  title={i18n._({
                    id: 'Browser Stream Coordination Healthy',
                    message: 'Browser Stream Coordination Healthy',
                  })}
                >
                  {i18n._({
                    id: 'No local browser-side attention signals are visible in the latest workspace stream manager snapshot.',
                    message:
                    'No local browser-side attention signals are visible in the latest workspace stream manager snapshot.',
                  })}
                </InlineNotice>
              )}
              <div className="settings-subsection settings-output-card">
                <div className="settings-subsection__header">
                  <div className="settings-output-card__title-block">
                    <strong>
                      {i18n._({
                        id: 'Workspace Health Overview',
                        message: 'Workspace Health Overview',
                      })}
                    </strong>
                    <p>
                      {i18n._({
                        id: 'Aggregates backend fan-out pressure, front/back correlation alerts, and local browser stream attention into one per-workspace health score.',
                        message:
                          'Aggregates backend fan-out pressure, front/back correlation alerts, and local browser stream attention into one per-workspace health score.',
                      })}
                    </p>
                  </div>
                  {workspaceDiagnosticsDrilldownWorkspaceId ? (
                    <div className="settings-output-card__actions">
                      <button className="notice__tool" onClick={() => clearWorkspaceDiagnosticsDrilldown()} type="button">
                        {i18n._({ id: 'Clear focus', message: 'Clear focus' })}
                      </button>
                    </div>
                  ) : null}
                </div>
                <div className="mode-metrics">
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Healthy', message: 'Healthy' })}</span>
                    <strong>{workspaceHealthCounts.healthy}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Warning', message: 'Warning' })}</span>
                    <strong>{workspaceHealthCounts.warning}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Critical', message: 'Critical' })}</span>
                    <strong>{workspaceHealthCounts.critical}</strong>
                  </div>
                </div>
                {workspaceHealthDelta.regressed.length || workspaceHealthDelta.improved.length ? (
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Health delta since the previous local sample: regressed {regressedCount} · improved {improvedCount}.',
                      message:
                        'Health delta since the previous local sample: regressed {regressedCount} · improved {improvedCount}.',
                      values: {
                        improvedCount: workspaceHealthDelta.improved.length,
                        regressedCount: workspaceHealthDelta.regressed.length,
                      },
                    })}
                  </p>
                ) : null}
                {workspaceDiagnosticsDrilldownWorkspaceId ? (
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Focused workspace diagnostics: {workspaceId}. Frontend streams, backend workspace subscribers, backend subscriber details, and correlation alerts are filtered to this workspace.',
                      message:
                        'Focused workspace diagnostics: {workspaceId}. Frontend streams, backend workspace subscribers, backend subscriber details, and correlation alerts are filtered to this workspace.',
                      values: {
                        workspaceId: workspaceDiagnosticsDrilldownWorkspaceId,
                      },
                    })}
                  </p>
                ) : null}
                {workspaceHealthSummaries.length ? (
                  <div className="settings-record-list">
                    {workspaceHealthSummaries.map((summary) => {
                      const workspaceLabel = workspaceNameById[summary.workspaceId] ?? summary.workspaceId
                      const statusLabel = formatWorkspaceHealthStatusLabel(summary.status)
                      const regressed = workspaceHealthDelta.regressed.some(
                        (candidate) => candidate.workspaceId === summary.workspaceId,
                      )
                      const improved = workspaceHealthDelta.improved.some(
                        (candidate) => candidate.workspaceId === summary.workspaceId,
                      )

                      return (
                        <SettingsRecord
                          action={
                            <div className="setting-row__meta">
                              <span
                                className={
                                  summary.status === 'critical'
                                    ? 'meta-pill meta-pill--warning'
                                    : 'meta-pill'
                                }
                              >
                                {statusLabel}
                              </span>
                              {regressed ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({ id: 'Regressed', message: 'Regressed' })}
                                </span>
                              ) : null}
                              {improved ? (
                                <span className="meta-pill">
                                  {i18n._({ id: 'Improved', message: 'Improved' })}
                                </span>
                              ) : null}
                              <button
                                className="notice__tool"
                                onClick={() => applyWorkspaceDiagnosticsDrilldown(summary.workspaceId)}
                                type="button"
                              >
                                {workspaceDiagnosticsDrilldownWorkspaceId === summary.workspaceId
                                  ? i18n._({ id: 'Focused', message: 'Focused' })
                                  : i18n._({ id: 'Drill-down', message: 'Drill-down' })}
                              </button>
                            </div>
                          }
                          description={i18n._({
                            id: 'Score {score}/100 · backend dropped {dropped} · backend buffered {buffered} · correlation alerts {alerts} · local attention {localAttention}',
                            message:
                              'Score {score}/100 · backend dropped {dropped} · backend buffered {buffered} · correlation alerts {alerts} · local attention {localAttention}',
                            values: {
                              alerts: summary.correlationAlertCount,
                              buffered: summary.backendBufferedCount,
                              dropped: summary.backendDroppedCount,
                              localAttention: summary.frontendAttentionCount,
                              score: summary.score,
                            },
                          })}
                          key={`workspace-health:${summary.workspaceId}`}
                          marker="WH"
                          meta={
                            <>
                              <span className="meta-pill">{summary.workspaceId}</span>
                              <span className="meta-pill">
                                {i18n._({
                                  id: 'streams {count}',
                                  message: 'streams {count}',
                                  values: { count: summary.frontendStreamCount },
                                })}
                              </span>
                              <span className="meta-pill">
                                {summary.reasons.slice(0, 2).join(' · ')}
                              </span>
                            </>
                          }
                          title={workspaceLabel}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No workspace health summaries are available yet.',
                      message: 'No workspace health summaries are available yet.',
                    })}
                  </div>
                )}
                {workspaceHealthDelta.regressed.length || workspaceHealthDelta.improved.length ? (
                  <div className="settings-record-list">
                    {workspaceHealthDelta.regressed.slice(0, 5).map((summary) => (
                      <SettingsRecord
                        action={<span className="meta-pill meta-pill--warning">{i18n._({ id: 'Regressed', message: 'Regressed' })}</span>}
                        description={i18n._({
                          id: 'Workspace score is now {score}/100 with status {status}.',
                          message: 'Workspace score is now {score}/100 with status {status}.',
                          values: {
                            score: summary.score,
                            status: formatWorkspaceHealthStatusLabel(summary.status),
                          },
                        })}
                        key={`health-regressed:${summary.workspaceId}`}
                        marker="HR"
                        meta={
                          <>
                            <span className="meta-pill">{summary.workspaceId}</span>
                            <span className="meta-pill">{summary.reasons.slice(0, 1).join('')}</span>
                          </>
                        }
                        title={workspaceNameById[summary.workspaceId] ?? summary.workspaceId}
                      />
                    ))}
                    {workspaceHealthDelta.improved.slice(0, 5).map((summary) => (
                      <SettingsRecord
                        action={<span className="meta-pill">{i18n._({ id: 'Improved', message: 'Improved' })}</span>}
                        description={i18n._({
                          id: 'Workspace score is now {score}/100 with status {status}.',
                          message: 'Workspace score is now {score}/100 with status {status}.',
                          values: {
                            score: summary.score,
                            status: formatWorkspaceHealthStatusLabel(summary.status),
                          },
                        })}
                        key={`health-improved:${summary.workspaceId}`}
                        marker="HI"
                        meta={
                          <>
                            <span className="meta-pill">{summary.workspaceId}</span>
                            <span className="meta-pill">{summary.reasons.slice(0, 1).join('')}</span>
                          </>
                        }
                        title={workspaceNameById[summary.workspaceId] ?? summary.workspaceId}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
              <div className="settings-subsection settings-output-card">
                <div className="settings-subsection__header">
                  <div className="settings-output-card__title-block">
                    <strong>
                      {i18n._({
                        id: 'Correlation Alerts',
                        message: 'Correlation Alerts',
                      })}
                    </strong>
                    <p>
                      {i18n._({
                        id: 'Cross-check local lifecycle transitions against backend subscriber snapshots to surface role mismatches, delayed attach/detach, and closed/open contradictions.',
                        message:
                          'Cross-check local lifecycle transitions against backend subscriber snapshots to surface role mismatches, delayed attach/detach, and closed/open contradictions.',
                      })}
                    </p>
                  </div>
                </div>
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Active alerts {activeCount}. New {newCount}. Resolved {resolvedCount}.',
                    message: 'Active alerts {activeCount}. New {newCount}. Resolved {resolvedCount}.',
                    values: {
                      activeCount: filteredFrontendWorkspaceStreamCorrelationAlerts.length,
                      newCount: filteredFrontendCorrelationAlertDelta.newAlerts.length,
                      resolvedCount: filteredFrontendCorrelationAlertDelta.resolvedAlerts.length,
                    },
                  })}
                </p>
                {filteredFrontendWorkspaceStreamCorrelationAlerts.length ? (
                  <div className="settings-record-list">
                    {filteredFrontendWorkspaceStreamCorrelationAlerts.map((alert) => {
                      const workspaceLabel =
                        workspaceNameById[alert.stream.workspaceId] ?? alert.stream.workspaceId
                      const latestLifecycleLabel = alert.latestLifecycleEvent
                        ? formatFrontendWorkspaceStreamLifecycleEventLabel(alert.latestLifecycleEvent)
                        : i18n._({
                            id: 'No local lifecycle event captured yet',
                            message: 'No local lifecycle event captured yet',
                          })

                      return (
                        <SettingsRecord
                          action={
                            <div className="setting-row__meta">
                              <span
                                className={
                                  alert.reason.severity === 'critical'
                                    ? 'meta-pill meta-pill--warning'
                                    : 'meta-pill'
                                }
                              >
                                {alert.reason.severity === 'critical'
                                  ? i18n._({ id: 'Critical', message: 'Critical' })
                                  : i18n._({ id: 'Warning', message: 'Warning' })}
                              </span>
                              {filteredFrontendCorrelationAlertDelta.newAlerts.some(
                                (candidate) => candidate.key === alert.key,
                              ) ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({ id: 'New', message: 'New' })}
                                </span>
                              ) : null}
                            </div>
                          }
                          description={i18n._({
                            id: '{reason} · latest lifecycle {latestLifecycle} · local role {localRole}',
                            message:
                              '{reason} · latest lifecycle {latestLifecycle} · local role {localRole}',
                            values: {
                              latestLifecycle: latestLifecycleLabel,
                              localRole: alert.stream.expectedBackendRole ?? 'none',
                              reason: alert.reason.message,
                            },
                          })}
                          key={alert.key}
                          marker="CA"
                          meta={
                            <>
                              <span className="meta-pill">{alert.stream.workspaceId}</span>
                              <span className="meta-pill">{alert.stream.instanceId}</span>
                              {alert.stream.expectedBackendSource ? (
                                <span className="meta-pill">{alert.stream.expectedBackendSource}</span>
                              ) : null}
                              {alert.sourceSubscriber?.role ? (
                                <span className="meta-pill">
                                  {i18n._({
                                    id: 'backend role {role}',
                                    message: 'backend role {role}',
                                    values: { role: alert.sourceSubscriber.role },
                                  })}
                                </span>
                              ) : null}
                              {alert.sourceSubscriber?.closed ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({
                                    id: 'backend closed',
                                    message: 'backend closed',
                                  })}
                                </span>
                              ) : null}
                            </>
                          }
                          title={workspaceLabel}
                        />
                      )
                    })}
                  </div>
                ) : (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No front/back correlation alerts are active in the latest sample.',
                      message: 'No front/back correlation alerts are active in the latest sample.',
                    })}
                  </div>
                )}
                {filteredFrontendCorrelationAlertDelta.resolvedAlerts.length ? (
                  <div className="settings-record-list">
                    {filteredFrontendCorrelationAlertDelta.resolvedAlerts.slice(0, 5).map((alert) => {
                      const workspaceLabel =
                        workspaceNameById[alert.stream.workspaceId] ?? alert.stream.workspaceId
                      return (
                        <SettingsRecord
                          action={<span className="meta-pill">{i18n._({ id: 'Resolved', message: 'Resolved' })}</span>}
                          description={i18n._({
                            id: '{reason} · last lifecycle {latestLifecycle}',
                            message: '{reason} · last lifecycle {latestLifecycle}',
                            values: {
                              latestLifecycle: alert.latestLifecycleEvent
                                ? formatFrontendWorkspaceStreamLifecycleEventLabel(alert.latestLifecycleEvent)
                                : i18n._({ id: 'n/a', message: 'n/a' }),
                              reason: alert.reason.message,
                            },
                          })}
                          key={`resolved:${alert.key}`}
                          marker="RS"
                          meta={
                            <>
                              <span className="meta-pill">{alert.stream.workspaceId}</span>
                              <span className="meta-pill">{alert.stream.instanceId}</span>
                            </>
                          }
                          title={workspaceLabel}
                        />
                      )
                    })}
                  </div>
                ) : null}
              </div>
              <div className="header-actions">
                <Input
                  aria-label={i18n._({
                    id: 'Filter frontend streams',
                    message: 'Filter frontend streams',
                  })}
                  fullWidth={false}
                  onChange={(event) => setFrontendWorkspaceStreamFilter(event.target.value)}
                  placeholder={i18n._({
                    id: 'Filter by workspace, tab id, backend source…',
                    message: 'Filter by workspace, tab id, backend source…',
                  })}
                  value={frontendWorkspaceStreamFilter}
                />
                <button
                  className={
                    frontendWorkspaceStreamAttentionOnly
                      ? 'ide-button'
                      : 'ide-button ide-button--secondary'
                  }
                  onClick={() => setFrontendWorkspaceStreamAttentionOnly((current) => !current)}
                  type="button"
                >
                  {frontendWorkspaceStreamAttentionOnly
                    ? i18n._({ id: 'Show all', message: 'Show all' })
                    : i18n._({ id: 'Attention only', message: 'Attention only' })}
                </button>
              </div>
              <p className="config-inline-note">
                {i18n._({
                  id: 'Showing {visible} of {total} locally tracked workspace stream coordinators.',
                  message: 'Showing {visible} of {total} locally tracked workspace stream coordinators.',
                  values: {
                    visible: filteredFrontendWorkspaceStreams.length,
                    total: frontendWorkspaceStreamDiagnostics.streams.length,
                  },
                })}
              </p>
              {filteredFrontendWorkspaceStreams.length ? (
                <div className="settings-record-list">
                  {filteredFrontendWorkspaceStreams.map(
                    ({
                      stream,
                      matchingSubscriber,
                      sourceSubscriber,
                      attentionReasons,
                      correlationReasons,
                      localAttentionReasons,
                      needsAttention,
                    }) => {
                    const workspaceLabel = workspaceNameById[stream.workspaceId] ?? stream.workspaceId
                    const leaderHeartbeatLabel = stream.lastLeaderHeartbeatAt
                      ? formatRelativeTimeShort(stream.lastLeaderHeartbeatAt)
                      : i18n._({ id: 'n/a', message: 'n/a' })
                    const lifecycleSummary = formatFrontendWorkspaceStreamLifecycleSummary(
                      stream.recentLifecycleEvents,
                    )
                    const latestLifecycleEvent = stream.latestLifecycleEvent
                    const backendIdentityLabel = matchingSubscriber
                      ? i18n._({
                          id: 'Matched backend subscriber #{id}',
                          message: 'Matched backend subscriber #{id}',
                          values: { id: matchingSubscriber.id },
                        })
                      : stream.expectedBackendSource
                        ? i18n._({
                            id: 'Expected backend subscriber not present in latest snapshot',
                            message: 'Expected backend subscriber not present in latest snapshot',
                          })
                        : i18n._({
                            id: 'Follower tab; no backend websocket expected',
                            message: 'Follower tab; no backend websocket expected',
                          })

                    return (
                      <div className="form-stack" key={`${stream.workspaceId}:${stream.instanceId}`}>
                        <SettingsRecord
                          action={
                            <span
                              className={
                                matchingSubscriber
                                  ? 'meta-pill'
                                  : needsAttention && stream.expectedBackendSource
                                    ? 'meta-pill meta-pill--warning'
                                    : 'meta-pill'
                              }
                            >
                              {matchingSubscriber
                                ? i18n._({ id: 'Matched', message: 'Matched' })
                                : stream.expectedBackendSource
                                  ? i18n._({ id: 'Missing', message: 'Missing' })
                                  : i18n._({ id: 'Follower', message: 'Follower' })}
                            </span>
                          }
                          description={i18n._({
                            id: '{mode} · subscribers {subscribers} · connection {connection} · socket {socket} · reconnect attempt {reconnectAttempt} · queued {queued} · deferred {deferred} · peers {peers} · leader heartbeat {leaderHeartbeat}',
                            message:
                              '{mode} · subscribers {subscribers} · connection {connection} · socket {socket} · reconnect attempt {reconnectAttempt} · queued {queued} · deferred {deferred} · peers {peers} · leader heartbeat {leaderHeartbeat}',
                            values: {
                              mode: formatWorkspaceStreamCoordinationLabel(stream),
                              subscribers: stream.subscribers,
                              connection: stream.lastKnownConnectionState,
                              socket: stream.socketState,
                              reconnectAttempt: stream.reconnectAttempt,
                              queued: stream.queueLength,
                              deferred: stream.deferredEventCount,
                              peers: stream.activePeerCount,
                              leaderHeartbeat: leaderHeartbeatLabel,
                            },
                          })}
                          marker="FE"
                          meta={
                            <>
                              <span className="meta-pill">{stream.workspaceId}</span>
                              <span className="meta-pill">{stream.instanceId}</span>
                              <span className="meta-pill">
                                {stream.isLeader
                                  ? i18n._({ id: 'Leader', message: 'Leader' })
                                  : i18n._({ id: 'Follower', message: 'Follower' })}
                              </span>
                              {needsAttention ? (
                                <span className="meta-pill meta-pill--warning">
                                  {formatFrontendWorkspaceStreamAttentionSummary(attentionReasons)}
                                </span>
                              ) : null}
                              {correlationReasons.length ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({
                                    id: 'Correlation alert',
                                    message: 'Correlation alert',
                                  })}
                                </span>
                              ) : null}
                              {stream.leaderId ? (
                                <span className="meta-pill">
                                  {i18n._({
                                    id: 'leader {leaderId}',
                                    message: 'leader {leaderId}',
                                    values: { leaderId: stream.leaderId },
                                  })}
                                </span>
                              ) : null}
                              {stream.expectedBackendRole ? (
                                <span className="meta-pill">{stream.expectedBackendRole}</span>
                              ) : null}
                              {latestLifecycleEvent ? (
                                <span className="meta-pill">
                                  {latestLifecycleEvent.kind}
                                </span>
                              ) : null}
                              {matchingSubscriber?.source ? (
                                <span className="meta-pill">{matchingSubscriber.source}</span>
                              ) : null}
                            </>
                          }
                          title={workspaceLabel}
                        />
                        <p className="config-inline-note">{backendIdentityLabel}</p>
                        {correlationReasons.length ? (
                          <p className="config-inline-note">
                            {i18n._({
                              id: 'Front/back correlation: {summary}',
                              message: 'Front/back correlation: {summary}',
                              values: {
                                summary: formatFrontendWorkspaceStreamCorrelationSummary(correlationReasons),
                              },
                            })}
                          </p>
                        ) : null}
                        <p className="config-inline-note">
                          {i18n._({
                            id: 'Recent lifecycle: {summary}',
                            message: 'Recent lifecycle: {summary}',
                            values: {
                              summary: lifecycleSummary,
                            },
                          })}
                        </p>
                        <SettingsJsonPreview
                          description={i18n._({
                            id: 'Local stream coordination snapshot with queue, timer, peer, lifecycle timeline, and expected backend identity fields.',
                            message:
                              'Local stream coordination snapshot with queue, timer, peer, lifecycle timeline, and expected backend identity fields.',
                          })}
                          title={i18n._({
                            id: 'Frontend Stream Snapshot · {workspace}',
                            message: 'Frontend Stream Snapshot · {workspace}',
                            values: { workspace: workspaceLabel },
                          })}
                          value={{
                            ...stream,
                            attentionReasons,
                            localAttentionReasons,
                            correlationReasons,
                            backendMatch: matchingSubscriber
                              ? {
                                  id: matchingSubscriber.id,
                                  role: matchingSubscriber.role ?? null,
                                  source: matchingSubscriber.source ?? null,
                                  lastMethod: matchingSubscriber.lastMethod ?? null,
                                  lastSeq: matchingSubscriber.lastSeq ?? null,
                                  queueLen: matchingSubscriber.queueLen,
                                  droppedCount: matchingSubscriber.droppedCount,
                                }
                              : null,
                            backendSourceSubscriber: sourceSubscriber
                              ? {
                                  id: sourceSubscriber.id,
                                  role: sourceSubscriber.role ?? null,
                                  source: sourceSubscriber.source ?? null,
                                  closed: sourceSubscriber.closed,
                                  lastMethod: sourceSubscriber.lastMethod ?? null,
                                  lastSeq: sourceSubscriber.lastSeq ?? null,
                                }
                              : null,
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="empty-state">
                  {i18n._({
                    id: 'No local workspace stream coordinators match the current filter.',
                    message: 'No local workspace stream coordinators match the current filter.',
                  })}
                </div>
              )}
              <SettingsJsonPreview
                description={i18n._({
                  id: 'Raw browser-side workspace stream manager snapshot for copy-paste or comparison against backend diagnostics.',
                  message:
                    'Raw browser-side workspace stream manager snapshot for copy-paste or comparison against backend diagnostics.',
                })}
                title={i18n._({
                  id: 'Frontend Raw Snapshot',
                  message: 'Frontend Raw Snapshot',
                })}
                value={frontendWorkspaceStreamDiagnostics}
              />
            </div>
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Per-workspace subscribers with queue depth, head seq, merge activity, and drop counts.',
              message:
                'Per-workspace subscribers with queue depth, head seq, merge activity, and drop counts.',
            })}
            title={i18n._({ id: 'Workspace Subscribers', message: 'Workspace Subscribers' })}
          >
            {eventHubDiagnosticsQuery.data ? (
              <div className="form-stack">
                <div className="header-actions">
                  <Input
                    aria-label={i18n._({
                      id: 'Filter workspaces',
                      message: 'Filter workspaces',
                    })}
                    fullWidth={false}
                    onChange={(event) => setEventHubWorkspaceFilter(event.target.value)}
                    placeholder={i18n._({
                      id: 'Filter by workspace, role, source…',
                      message: 'Filter by workspace, role, source…',
                    })}
                    value={eventHubWorkspaceFilter}
                  />
                  <SelectControl
                    ariaLabel={i18n._({
                      id: 'Sort workspace diagnostics',
                      message: 'Sort workspace diagnostics',
                    })}
                    menuLabel={i18n._({
                      id: 'Sort workspace diagnostics',
                      message: 'Sort workspace diagnostics',
                    })}
                    onChange={(value) => setEventHubWorkspaceSort(value as EventHubWorkspaceSortKey)}
                    options={eventHubWorkspaceSortOptions}
                    value={eventHubWorkspaceSort}
                  />
                  <button
                    className={eventHubAttentionOnly ? 'ide-button' : 'ide-button ide-button--secondary'}
                    onClick={() => setEventHubAttentionOnly((current) => !current)}
                    type="button"
                  >
                    {eventHubAttentionOnly
                      ? i18n._({ id: 'Show all', message: 'Show all' })
                      : i18n._({ id: 'Attention only', message: 'Attention only' })}
                  </button>
                </div>
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Showing {visible} of {total} workspace groups after filtering and sorting.',
                    message:
                      'Showing {visible} of {total} workspace groups after filtering and sorting.',
                    values: {
                      visible: filteredEventHubWorkspaceSummaries.length,
                      total: eventHubWorkspaceSummaries.length,
                    },
                  })}
                </p>
                {filteredEventHubWorkspaceSummaries.length ? (
                  <div className="settings-record-list">
                    {filteredEventHubWorkspaceSummaries.map(
                      ({
                        workspace,
                        buffered,
                        dropped,
                        softDropped,
                        hardDropped,
                        hardEvicted,
                        merged,
                        coalescedCommandOutputBytes,
                        coalescedByMethod,
                        delta,
                        needsAttention,
                      }) => (
                        <SettingsRecord
                          action={
                            <span className={needsAttention ? 'meta-pill meta-pill--warning' : 'meta-pill'}>
                              {needsAttention
                                ? i18n._({ id: 'Attention', message: 'Attention' })
                                : i18n._({ id: 'Stable', message: 'Stable' })}
                            </span>
                          }
                          description={i18n._({
                            id: '{subscriberCount} subscribers · head seq {headSeq} · buffered {buffered} · dropped {dropped} (soft {softDropped} / hard {hardDropped} / evicted {hardEvicted}) · merged {merged} · merged bytes {mergedBytes}',
                            message:
                              '{subscriberCount} subscribers · head seq {headSeq} · buffered {buffered} · dropped {dropped} (soft {softDropped} / hard {hardDropped} / evicted {hardEvicted}) · merged {merged} · merged bytes {mergedBytes}',
                            values: {
                              subscriberCount: workspace.subscriberCount,
                              headSeq: workspace.headSeq ?? 0,
                              buffered,
                              dropped,
                              softDropped,
                              hardDropped,
                              hardEvicted,
                              merged,
                              mergedBytes: coalescedCommandOutputBytes,
                            },
                          })}
                          key={workspace.workspaceId}
                          marker="EH"
                          meta={
                            <>
                              <span className="meta-pill">{workspace.workspaceId}</span>
                              {workspace.subscribers.some((subscriber) => subscriber.lastMethod) ? (
                                <span className="meta-pill">
                                  {workspace.subscribers.find((subscriber) => subscriber.lastMethod)?.lastMethod}
                                </span>
                              ) : null}
                              {workspace.subscribers[0]?.role ? (
                                <span className="meta-pill">{workspace.subscribers[0].role}</span>
                              ) : null}
                              {delta && (
                                <>
                                  <span className="meta-pill">
                                    {formatDeltaLabel('Δdrop', delta.dropped)}
                                  </span>
                                  <span className="meta-pill">
                                    {formatDeltaLabel('Δqueue', delta.buffered)}
                                  </span>
                                </>
                              )}
                              <span className="meta-pill">
                                {formatMethodCounterSummary(coalescedByMethod)}
                              </span>
                            </>
                          }
                          title={workspaceNameById[workspace.workspaceId] ?? workspace.workspaceId}
                        />
                      ),
                    )}
                  </div>
                ) : (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No workspace diagnostics match the current filter.',
                      message: 'No workspace diagnostics match the current filter.',
                    })}
                  </div>
                )}
              </div>
            ) : null}
          </SettingRow>

          <SettingRow
            description={i18n._({
              id: 'Inspect each subscriber directly when you need to correlate queue growth, last activity, and output buffer occupancy.',
              message:
                'Inspect each subscriber directly when you need to correlate queue growth, last activity, and output buffer occupancy.',
            })}
            title={i18n._({ id: 'Subscriber Details', message: 'Subscriber Details' })}
          >
            {eventHubDiagnosticsQuery.data ? (
              <div className="form-stack">
                <div className="header-actions">
                  <Input
                    aria-label={i18n._({
                      id: 'Filter subscribers',
                      message: 'Filter subscribers',
                    })}
                    fullWidth={false}
                    onChange={(event) => setEventHubSubscriberFilter(event.target.value)}
                    placeholder={i18n._({
                      id: 'Filter by role, source, method…',
                      message: 'Filter by role, source, method…',
                    })}
                    value={eventHubSubscriberFilter}
                  />
                  <SelectControl
                    ariaLabel={i18n._({
                      id: 'Sort subscriber diagnostics',
                      message: 'Sort subscriber diagnostics',
                    })}
                    menuLabel={i18n._({
                      id: 'Sort subscriber diagnostics',
                      message: 'Sort subscriber diagnostics',
                    })}
                    onChange={(value) => setEventHubSubscriberSort(value as EventHubSubscriberSortKey)}
                    options={eventHubSubscriberSortOptions}
                    value={eventHubSubscriberSort}
                  />
                </div>
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Showing {visible} subscriber entries after filtering and sorting.',
                    message: 'Showing {visible} subscriber entries after filtering and sorting.',
                    values: {
                      visible: filteredEventHubSubscriberEntries.length,
                    },
                  })}
                </p>
                {filteredEventHubSubscriberEntries.map(({ kind, workspaceId: subscriberWorkspaceId, workspaceName, subscriber, delta }) => {
                  const subscriberKey = buildEventHubSubscriberEntryKey(
                    kind,
                    subscriberWorkspaceId,
                    subscriber.id,
                  )
                  const expanded = Boolean(eventHubExpandedSubscriberKeys[subscriberKey])
                  const subscriberIdentity = formatSubscriberIdentity(subscriber)
                  return (
                    <div className="form-stack" key={subscriberKey}>
                      <SettingsRecord
                        action={
                          <button
                            className="notice__tool"
                            onClick={() => toggleEventHubSubscriberExpanded(subscriberKey)}
                            type="button"
                          >
                            {expanded
                              ? i18n._({ id: 'Collapse', message: 'Collapse' })
                              : i18n._({ id: 'Expand', message: 'Expand' })}
                          </button>
                        }
                        description={i18n._({
                          id: 'queue {queueLen} · out {outputBufferLen}/{outputBufferCap} · dropped {droppedCount} (soft {softDropped} / hard {hardDropped} / evicted {hardEvicted}) · merged {mergedCount} · merged bytes {mergedBytes} · {activity}',
                          message:
                            'queue {queueLen} · out {outputBufferLen}/{outputBufferCap} · dropped {droppedCount} (soft {softDropped} / hard {hardDropped} / evicted {hardEvicted}) · merged {mergedCount} · merged bytes {mergedBytes} · {activity}',
                          values: {
                            queueLen: subscriber.queueLen,
                            outputBufferLen: subscriber.outputBufferLen,
                            outputBufferCap: subscriber.outputBufferCap,
                            droppedCount: subscriber.droppedCount,
                            softDropped: subscriber.softDroppedCount,
                            hardDropped: subscriber.hardDroppedCount,
                            hardEvicted: subscriber.hardEvictedCount,
                            mergedCount: subscriber.mergedCount,
                            mergedBytes: subscriber.coalescedCommandOutputBytes,
                            activity: formatEventHubSubscriberActivity(subscriber),
                          },
                        })}
                        marker={kind === 'global' ? 'GL' : 'WS'}
                        meta={
                          <>
                            <span className="meta-pill">#{subscriber.id}</span>
                            {kind === 'workspace' ? (
                              <span className="meta-pill">{subscriberWorkspaceId}</span>
                            ) : (
                              <span className="meta-pill">{i18n._({ id: 'Global', message: 'Global' })}</span>
                            )}
                            {subscriber.role ? <span className="meta-pill">{subscriber.role}</span> : null}
                            {subscriber.source ? <span className="meta-pill">{subscriber.source}</span> : null}
                            {subscriber.lastSeq ? (
                              <span className="meta-pill">
                                {i18n._({
                                  id: 'seq {seq}',
                                  message: 'seq {seq}',
                            values: { seq: subscriber.lastSeq },
                          })}
                        </span>
                      ) : null}
                      {delta ? (
                        <>
                          <span className="meta-pill">
                            {formatDeltaLabel('Δdrop', delta.dropped)}
                          </span>
                          <span className="meta-pill">
                            {formatDeltaLabel('Δqueue', delta.queue)}
                          </span>
                          <span className="meta-pill">
                            {formatDeltaLabel('Δbytes', delta.mergedBytes)}
                          </span>
                        </>
                      ) : null}
                      <span className="meta-pill">
                        {formatMethodCounterSummary(subscriber.coalescedByMethod)}
                      </span>
                          </>
                        }
                        title={
                          subscriber.lastMethod
                            ? i18n._({
                                id: kind === 'global' ? 'Global subscriber · {method}' : 'Last method: {method}',
                                message: kind === 'global' ? 'Global subscriber · {method}' : 'Last method: {method}',
                                values: { method: subscriber.lastMethod },
                              })
                            : subscriberIdentity
                        }
                      />
                      {expanded ? (
                        <SettingsJsonPreview
                          collapsible={false}
                          description={i18n._({
                            id: 'Expanded subscriber drill-down with identity, counters, timestamps, and coalesced method breakdown.',
                            message:
                              'Expanded subscriber drill-down with identity, counters, timestamps, and coalesced method breakdown.',
                          })}
                          title={i18n._({
                            id: 'Subscriber Drill-Down · {identity}',
                            message: 'Subscriber Drill-Down · {identity}',
                            values: { identity: subscriberIdentity },
                          })}
                          value={{
                            key: subscriberKey,
                            kind,
                            workspaceId: subscriberWorkspaceId || null,
                            workspaceName,
                            identity: subscriberIdentity,
                            scope: subscriber.scope ?? null,
                            role: subscriber.role ?? null,
                            source: subscriber.source ?? null,
                            lastMethod: subscriber.lastMethod ?? null,
                            lastSeq: subscriber.lastSeq ?? null,
                            queue: {
                              queueLen: subscriber.queueLen,
                              outputBufferLen: subscriber.outputBufferLen,
                              outputBufferCap: subscriber.outputBufferCap,
                            },
                            drops: {
                              total: subscriber.droppedCount,
                              soft: subscriber.softDroppedCount,
                              hard: subscriber.hardDroppedCount,
                              hardEvicted: subscriber.hardEvictedCount,
                            },
                            merges: {
                              total: subscriber.mergedCount,
                              coalescedCommandOutputBytes: subscriber.coalescedCommandOutputBytes,
                              byMethod: subscriber.coalescedByMethod ?? {},
                            },
                            delta: delta
                              ? {
                                  queue: delta.queue,
                                  dropped: delta.dropped,
                                  softDropped: delta.softDropped,
                                  hardDropped: delta.hardDropped,
                                  hardEvicted: delta.hardEvicted,
                                  merged: delta.merged,
                                  mergedBytes: delta.mergedBytes,
                                }
                              : null,
                            timestamps: {
                              lastQueuedAt: subscriber.lastQueuedAt ?? null,
                              lastDequeuedAt: subscriber.lastDequeuedAt ?? null,
                              lastMergedAt: subscriber.lastMergedAt ?? null,
                              lastDroppedAt: subscriber.lastDroppedAt ?? null,
                            },
                          }}
                        />
                      ) : null}
                    </div>
                  )
                })}
                {!filteredEventHubSubscriberEntries.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No subscriber diagnostics match the current filter.',
                      message: 'No subscriber diagnostics match the current filter.',
                    })}
                  </div>
                ) : null}
                <SettingsJsonPreview
                  description={i18n._({
                    id: 'Raw backend snapshot for deeper debugging, copy-paste, or external comparison.',
                    message:
                      'Raw backend snapshot for deeper debugging, copy-paste, or external comparison.',
                  })}
                  title={i18n._({ id: 'Raw Snapshot', message: 'Raw Snapshot' })}
                  value={eventHubDiagnosticsQuery.data}
                />
              </div>
            ) : null}
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
