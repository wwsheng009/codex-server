import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'

import { listWorkspaces } from '../workspaces/api'
import { useSessionStore } from '../../stores/session-store'
import {
  createEmptyNotificationRealtimeDiagnosticsHistoryState,
  describeRealtimeNotificationWorkspaceSubscriptions,
  resolveActiveNotificationWorkspaceId,
  updateNotificationRealtimeDiagnosticsHistory,
} from './notificationStreamUtils'
import { listNotifications } from './api'

const notificationRealtimeDiagnosticsListeners = new Set<() => void>()
let notificationRealtimeDiagnosticsHistoryState =
  createEmptyNotificationRealtimeDiagnosticsHistoryState()

export function useNotificationRealtimeDiagnostics() {
  const location = useLocation()
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId)
  const workspacesQuery = useQuery({
    queryKey: ['shell-workspaces'],
    queryFn: listWorkspaces,
    staleTime: 30_000,
  })
  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    refetchInterval: 15_000,
    staleTime: 15_000,
  })

  const notifications = notificationsQuery.data ?? []
  const workspaceNameById = useMemo(
    () =>
      Object.fromEntries(
        (workspacesQuery.data ?? []).map((workspace) => [workspace.id, workspace.name]),
      ),
    [workspacesQuery.data],
  )
  const activeWorkspaceId = useMemo(
    () => resolveActiveNotificationWorkspaceId(location.pathname, selectedWorkspaceId),
    [location.pathname, selectedWorkspaceId],
  )
  const liveWorkspaceDiagnostics = useMemo(
    () =>
      describeRealtimeNotificationWorkspaceSubscriptions({
        activeWorkspaceId,
        notifications,
      }),
    [activeWorkspaceId, notifications],
  )
  const liveWorkspaceIds = useMemo(
    () => liveWorkspaceDiagnostics.map((subscription) => subscription.workspaceId),
    [liveWorkspaceDiagnostics],
  )
  const diagnosticsHistoryState = useSyncExternalStore(
    subscribeNotificationRealtimeDiagnosticsHistory,
    getNotificationRealtimeDiagnosticsHistorySnapshot,
    getNotificationRealtimeDiagnosticsHistorySnapshot,
  )

  useEffect(() => {
    updateSharedNotificationRealtimeDiagnosticsHistory({
      activeWorkspaceId,
      changedAt: new Date().toISOString(),
      routePath: location.pathname,
      subscriptions: liveWorkspaceDiagnostics,
    })
  }, [activeWorkspaceId, liveWorkspaceDiagnostics, location.pathname])

  return {
    activeWorkspaceId,
    diagnosticsHistory: diagnosticsHistoryState.history,
    diagnosticsLastChangedAt: diagnosticsHistoryState.lastChangedAt,
    liveWorkspaceDiagnostics,
    liveWorkspaceIds,
    notifications,
    notificationsQuery,
    workspaceNameById,
    workspacesQuery,
  }
}

function subscribeNotificationRealtimeDiagnosticsHistory(listener: () => void) {
  notificationRealtimeDiagnosticsListeners.add(listener)

  return () => {
    notificationRealtimeDiagnosticsListeners.delete(listener)
  }
}

function getNotificationRealtimeDiagnosticsHistorySnapshot() {
  return notificationRealtimeDiagnosticsHistoryState
}

function updateSharedNotificationRealtimeDiagnosticsHistory(input: {
  activeWorkspaceId?: string
  changedAt: string
  routePath?: string
  subscriptions: ReturnType<typeof describeRealtimeNotificationWorkspaceSubscriptions>
}) {
  const nextState = updateNotificationRealtimeDiagnosticsHistory(
    notificationRealtimeDiagnosticsHistoryState,
    input,
  )

  if (nextState === notificationRealtimeDiagnosticsHistoryState) {
    return
  }

  notificationRealtimeDiagnosticsHistoryState = nextState
  for (const listener of [...notificationRealtimeDiagnosticsListeners]) {
    listener()
  }
}
