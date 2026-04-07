import { parseWorkspaceThreadRoute } from '../../lib/thread-routes'
import { i18n } from '../../i18n/runtime'
import type { NotificationItem, ServerEvent } from '../../types/api'

export const NOTIFICATION_REALTIME_SUPPRESSION_WINDOW_MS = 24 * 60 * 60 * 1000
export const NOTIFICATION_REALTIME_DIAGNOSTICS_HISTORY_LIMIT = 8
const SUPPRESSION_NOTIFICATION_KINDS = new Set([
  'bot_duplicate_delivery_suppressed',
  'bot_recovery_replay_suppressed',
])

export type RealtimeNotificationWorkspaceReasonCode =
  | 'active_workspace'
  | 'unread_notification'
  | 'recent_suppression'

export type RealtimeNotificationWorkspaceSubscription = {
  workspaceId: string
  reasonCodes: RealtimeNotificationWorkspaceReasonCode[]
}

export type NotificationRealtimeDiagnosticsHistoryEntry = {
  activeWorkspaceId: string
  changeDetails: NotificationRealtimeDiagnosticsChangeDetails
  changeTriggerCodes: NotificationRealtimeDiagnosticsChangeTriggerCode[]
  changedAt: string
  routePath: string
  signature: string
  subscriptions: RealtimeNotificationWorkspaceSubscription[]
}

export type NotificationRealtimeDiagnosticsHistoryState = {
  history: NotificationRealtimeDiagnosticsHistoryEntry[]
  lastChangedAt: string
  signature: string
}

export type NotificationRealtimeDiagnosticsChangeDetails = {
  recentSuppressionClearedWorkspaceIds: string[]
  recentSuppressionEnteredWorkspaceIds: string[]
  unreadScopeClearedWorkspaceIds: string[]
  unreadScopeEnteredWorkspaceIds: string[]
  workspaceSubscriptionAddedIds: string[]
  workspaceSubscriptionRemovedIds: string[]
}

export type NotificationRealtimeDiagnosticsChangeTriggerCode =
  | 'initial_snapshot'
  | 'route_context_changed'
  | 'active_workspace_changed'
  | 'workspace_subscription_added'
  | 'workspace_subscription_removed'
  | 'unread_scope_entered'
  | 'unread_scope_cleared'
  | 'recent_suppression_entered'
  | 'recent_suppression_cleared'

export function buildNotificationItemFromEvent(
  event: ServerEvent,
  workspaceNameById: Record<string, string> = {},
) {
  if (event.method !== 'notification/created') {
    return null
  }

  const payload = event.payload
  if (typeof payload !== 'object' || payload === null) {
    return null
  }

  const notificationPayload = payload as Record<string, unknown>
  const id = readStringField(notificationPayload, 'notificationId')
  const kind = readStringField(notificationPayload, 'kind')
  const title = readStringField(notificationPayload, 'title')
  const message = readStringField(notificationPayload, 'message')
  const level = readStringField(notificationPayload, 'level')

  if (!id || !kind || !title || !message || !level) {
    return null
  }

  return {
    id,
    workspaceId: event.workspaceId,
    workspaceName: workspaceNameById[event.workspaceId] ?? event.workspaceId,
    automationId: readOptionalStringField(notificationPayload, 'automationId'),
    automationTitle: readOptionalStringField(notificationPayload, 'automationTitle'),
    runId: readOptionalStringField(notificationPayload, 'runId'),
    botConnectionId: readOptionalStringField(notificationPayload, 'botConnectionId'),
    botConnectionName: readOptionalStringField(notificationPayload, 'botConnectionName'),
    kind,
    title,
    message,
    level,
    read: Boolean(notificationPayload.read),
    createdAt: event.ts,
    readAt: null,
  } satisfies NotificationItem
}

export function upsertNotificationItem(
  current: NotificationItem[] | undefined,
  incoming: NotificationItem,
) {
  const notifications = current ?? []
  const existing = notifications.find((notification) => notification.id === incoming.id)
  const merged = mergeNotificationItem(existing, incoming)
  const remaining = notifications.filter((notification) => notification.id !== incoming.id)

  return [merged, ...remaining].sort(compareNotificationsByCreatedAtDesc)
}

export function resolveActiveNotificationWorkspaceId(
  pathname: string,
  fallbackWorkspaceId?: string,
) {
  const threadRoute = parseWorkspaceThreadRoute(pathname)
  if (threadRoute.workspaceId) {
    return normalizeWorkspaceId(threadRoute.workspaceId)
  }

  const botLogsRouteMatch = pathname.match(/^\/bots\/([^/]+)\/[^/]+\/logs\/?$/)
  if (botLogsRouteMatch) {
    return normalizeWorkspaceId(decodeURIComponent(botLogsRouteMatch[1]))
  }

  return normalizeWorkspaceId(fallbackWorkspaceId)
}

export function collectRealtimeNotificationWorkspaceIds({
  activeWorkspaceId,
  notifications,
  now = Date.now(),
  suppressionWindowMs = NOTIFICATION_REALTIME_SUPPRESSION_WINDOW_MS,
}: {
  activeWorkspaceId?: string
  notifications: NotificationItem[]
  now?: number
  suppressionWindowMs?: number
}) {
  return describeRealtimeNotificationWorkspaceSubscriptions({
    activeWorkspaceId,
    notifications,
    now,
    suppressionWindowMs,
  }).map((subscription) => subscription.workspaceId)
}

export function describeRealtimeNotificationWorkspaceSubscriptions({
  activeWorkspaceId,
  notifications,
  now = Date.now(),
  suppressionWindowMs = NOTIFICATION_REALTIME_SUPPRESSION_WINDOW_MS,
}: {
  activeWorkspaceId?: string
  notifications: NotificationItem[]
  now?: number
  suppressionWindowMs?: number
}) {
  const subscriptions = new Map<string, Set<RealtimeNotificationWorkspaceReasonCode>>()
  const normalizedActiveWorkspaceId = normalizeWorkspaceId(activeWorkspaceId)

  if (normalizedActiveWorkspaceId) {
    addWorkspaceSubscriptionReason(subscriptions, normalizedActiveWorkspaceId, 'active_workspace')
  }

  for (const notification of notifications) {
    const notificationWorkspaceId = normalizeWorkspaceId(notification.workspaceId)
    if (!notificationWorkspaceId) {
      continue
    }

    if (!notification.read) {
      addWorkspaceSubscriptionReason(subscriptions, notificationWorkspaceId, 'unread_notification')
    }

    if (
      isSuppressionNotificationKind(notification.kind) &&
      isRecentNotification(notification.createdAt, now, suppressionWindowMs)
    ) {
      addWorkspaceSubscriptionReason(subscriptions, notificationWorkspaceId, 'recent_suppression')
    }
  }

  return [...subscriptions.entries()]
    .sort(([leftWorkspaceId], [rightWorkspaceId]) => leftWorkspaceId.localeCompare(rightWorkspaceId))
    .map(([workspaceId, reasonCodes]) => ({
      workspaceId,
      reasonCodes: [...reasonCodes],
    }))
}

export function isSuppressionNotificationKind(kind: string) {
  return SUPPRESSION_NOTIFICATION_KINDS.has(kind.trim().toLowerCase())
}

export function formatRealtimeNotificationWorkspaceReason(
  reasonCode: RealtimeNotificationWorkspaceReasonCode,
) {
  switch (reasonCode) {
    case 'active_workspace':
      return i18n._({
        id: 'Active route',
        message: 'Active route',
      })
    case 'unread_notification':
      return i18n._({
        id: 'Unread notifications',
        message: 'Unread notifications',
      })
    case 'recent_suppression':
      return i18n._({
        id: 'Recent suppression',
        message: 'Recent suppression',
      })
    default:
      return reasonCode
  }
}

export function formatNotificationRealtimeDiagnosticsChangeTrigger(
  triggerCode: NotificationRealtimeDiagnosticsChangeTriggerCode,
) {
  switch (triggerCode) {
    case 'initial_snapshot':
      return i18n._({
        id: 'Session start',
        message: 'Session start',
      })
    case 'route_context_changed':
      return i18n._({
        id: 'Route changed',
        message: 'Route changed',
      })
    case 'active_workspace_changed':
      return i18n._({
        id: 'Active workspace changed',
        message: 'Active workspace changed',
      })
    case 'workspace_subscription_added':
      return i18n._({
        id: 'Workspace added',
        message: 'Workspace added',
      })
    case 'workspace_subscription_removed':
      return i18n._({
        id: 'Workspace removed',
        message: 'Workspace removed',
      })
    case 'unread_scope_entered':
      return i18n._({
        id: 'Unread entered',
        message: 'Unread entered',
      })
    case 'unread_scope_cleared':
      return i18n._({
        id: 'Unread cleared',
        message: 'Unread cleared',
      })
    case 'recent_suppression_entered':
      return i18n._({
        id: 'Suppression entered',
        message: 'Suppression entered',
      })
    case 'recent_suppression_cleared':
      return i18n._({
        id: 'Suppression cleared',
        message: 'Suppression cleared',
      })
    default:
      return triggerCode
  }
}

export function describeNotificationRealtimeDiagnosticsChangeDetails(
  changeDetails: NotificationRealtimeDiagnosticsChangeDetails,
  workspaceNameById: Record<string, string> = {},
) {
  const detailLines: string[] = []

  if (changeDetails.workspaceSubscriptionAddedIds.length) {
    detailLines.push(
      i18n._({
        id: 'Workspaces added: {workspaces}',
        message: 'Workspaces added: {workspaces}',
        values: {
          workspaces: formatNotificationRealtimeDiagnosticsWorkspaceList(
            changeDetails.workspaceSubscriptionAddedIds,
            workspaceNameById,
          ),
        },
      }),
    )
  }

  if (changeDetails.workspaceSubscriptionRemovedIds.length) {
    detailLines.push(
      i18n._({
        id: 'Workspaces removed: {workspaces}',
        message: 'Workspaces removed: {workspaces}',
        values: {
          workspaces: formatNotificationRealtimeDiagnosticsWorkspaceList(
            changeDetails.workspaceSubscriptionRemovedIds,
            workspaceNameById,
          ),
        },
      }),
    )
  }

  if (changeDetails.unreadScopeEnteredWorkspaceIds.length) {
    detailLines.push(
      i18n._({
        id: 'Unread entered: {workspaces}',
        message: 'Unread entered: {workspaces}',
        values: {
          workspaces: formatNotificationRealtimeDiagnosticsWorkspaceList(
            changeDetails.unreadScopeEnteredWorkspaceIds,
            workspaceNameById,
          ),
        },
      }),
    )
  }

  if (changeDetails.unreadScopeClearedWorkspaceIds.length) {
    detailLines.push(
      i18n._({
        id: 'Unread cleared: {workspaces}',
        message: 'Unread cleared: {workspaces}',
        values: {
          workspaces: formatNotificationRealtimeDiagnosticsWorkspaceList(
            changeDetails.unreadScopeClearedWorkspaceIds,
            workspaceNameById,
          ),
        },
      }),
    )
  }

  if (changeDetails.recentSuppressionEnteredWorkspaceIds.length) {
    detailLines.push(
      i18n._({
        id: 'Suppression entered: {workspaces}',
        message: 'Suppression entered: {workspaces}',
        values: {
          workspaces: formatNotificationRealtimeDiagnosticsWorkspaceList(
            changeDetails.recentSuppressionEnteredWorkspaceIds,
            workspaceNameById,
          ),
        },
      }),
    )
  }

  if (changeDetails.recentSuppressionClearedWorkspaceIds.length) {
    detailLines.push(
      i18n._({
        id: 'Suppression cleared: {workspaces}',
        message: 'Suppression cleared: {workspaces}',
        values: {
          workspaces: formatNotificationRealtimeDiagnosticsWorkspaceList(
            changeDetails.recentSuppressionClearedWorkspaceIds,
            workspaceNameById,
          ),
        },
      }),
    )
  }

  return detailLines
}

export function createEmptyNotificationRealtimeDiagnosticsHistoryState(): NotificationRealtimeDiagnosticsHistoryState {
  return {
    history: [],
    lastChangedAt: '',
    signature: '',
  }
}

export function updateNotificationRealtimeDiagnosticsHistory(
  current: NotificationRealtimeDiagnosticsHistoryState,
  input: {
    activeWorkspaceId?: string
    changedAt: string
    routePath?: string
    subscriptions: RealtimeNotificationWorkspaceSubscription[]
  },
  limit = NOTIFICATION_REALTIME_DIAGNOSTICS_HISTORY_LIMIT,
) {
  const activeWorkspaceId = normalizeWorkspaceId(input.activeWorkspaceId)
  const routePath = normalizeRoutePath(input.routePath)
  const subscriptions = input.subscriptions.map((subscription) => ({
    workspaceId: subscription.workspaceId,
    reasonCodes: [...subscription.reasonCodes],
  }))
  const signature = serializeNotificationRealtimeDiagnosticsSignature(
    activeWorkspaceId,
    routePath,
    subscriptions,
  )

  if (signature === current.signature) {
    return current
  }

  const previousEntry = current.history[0]
  const changeDetails = buildNotificationRealtimeDiagnosticsChangeDetails(previousEntry, subscriptions)
  const entry: NotificationRealtimeDiagnosticsHistoryEntry = {
    activeWorkspaceId,
    changeDetails,
    changeTriggerCodes: buildNotificationRealtimeDiagnosticsChangeTriggerCodes(
      previousEntry,
      activeWorkspaceId,
      routePath,
      changeDetails,
    ),
    changedAt: input.changedAt,
    routePath,
    signature,
    subscriptions,
  }

  return {
    history: [entry, ...current.history].slice(0, Math.max(1, limit)),
    lastChangedAt: input.changedAt,
    signature,
  }
}

function mergeNotificationItem(
  existing: NotificationItem | undefined,
  incoming: NotificationItem,
) {
  if (!existing) {
    return incoming
  }

  return {
    ...existing,
    ...incoming,
    workspaceName: incoming.workspaceName || existing.workspaceName,
    automationTitle: incoming.automationTitle || existing.automationTitle,
    botConnectionName: incoming.botConnectionName || existing.botConnectionName,
    read: existing.read || incoming.read,
    readAt: existing.readAt ?? incoming.readAt,
  }
}

function compareNotificationsByCreatedAtDesc(left: NotificationItem, right: NotificationItem) {
  const leftTime = Date.parse(left.createdAt)
  const rightTime = Date.parse(right.createdAt)

  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) {
    return right.id.localeCompare(left.id)
  }

  return rightTime - leftTime
}

function readOptionalStringField(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function readStringField(payload: Record<string, unknown>, key: string) {
  return readOptionalStringField(payload, key) ?? ''
}

function isRecentNotification(value: string, now: number, windowMs: number) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) {
    return false
  }

  const ageMs = now - timestamp
  return ageMs >= 0 && ageMs <= windowMs
}

function normalizeWorkspaceId(workspaceId?: string) {
  return typeof workspaceId === 'string' && workspaceId.trim() ? workspaceId.trim() : ''
}

function addWorkspaceSubscriptionReason(
  subscriptions: Map<string, Set<RealtimeNotificationWorkspaceReasonCode>>,
  workspaceId: string,
  reasonCode: RealtimeNotificationWorkspaceReasonCode,
) {
  let reasonCodes = subscriptions.get(workspaceId)
  if (!reasonCodes) {
    reasonCodes = new Set()
    subscriptions.set(workspaceId, reasonCodes)
  }

  reasonCodes.add(reasonCode)
}

function serializeNotificationRealtimeDiagnosticsSignature(
  activeWorkspaceId: string,
  routePath: string,
  subscriptions: RealtimeNotificationWorkspaceSubscription[],
) {
  const subscriptionSignature = subscriptions
    .map((subscription) => `${subscription.workspaceId}:${subscription.reasonCodes.join(',')}`)
    .join('|')

  return `${activeWorkspaceId}>>${routePath}>>${subscriptionSignature}`
}

function buildNotificationRealtimeDiagnosticsChangeTriggerCodes(
  previousEntry: NotificationRealtimeDiagnosticsHistoryEntry | undefined,
  activeWorkspaceId: string,
  routePath: string,
  changeDetails: NotificationRealtimeDiagnosticsChangeDetails,
): NotificationRealtimeDiagnosticsChangeTriggerCode[] {
  if (!previousEntry) {
    return ['initial_snapshot'] satisfies NotificationRealtimeDiagnosticsChangeTriggerCode[]
  }

  const triggerCodes = new Set<NotificationRealtimeDiagnosticsChangeTriggerCode>()
  if (previousEntry.routePath !== routePath) {
    triggerCodes.add('route_context_changed')
  }
  if (previousEntry.activeWorkspaceId !== activeWorkspaceId) {
    triggerCodes.add('active_workspace_changed')
  }

  if (changeDetails.workspaceSubscriptionAddedIds.length) {
    triggerCodes.add('workspace_subscription_added')
  }
  if (changeDetails.workspaceSubscriptionRemovedIds.length) {
    triggerCodes.add('workspace_subscription_removed')
  }
  if (changeDetails.unreadScopeEnteredWorkspaceIds.length) {
    triggerCodes.add('unread_scope_entered')
  }
  if (changeDetails.unreadScopeClearedWorkspaceIds.length) {
    triggerCodes.add('unread_scope_cleared')
  }
  if (changeDetails.recentSuppressionEnteredWorkspaceIds.length) {
    triggerCodes.add('recent_suppression_entered')
  }
  if (changeDetails.recentSuppressionClearedWorkspaceIds.length) {
    triggerCodes.add('recent_suppression_cleared')
  }

  return [...triggerCodes] satisfies NotificationRealtimeDiagnosticsChangeTriggerCode[]
}

function buildNotificationRealtimeDiagnosticsChangeDetails(
  previousEntry: NotificationRealtimeDiagnosticsHistoryEntry | undefined,
  subscriptions: RealtimeNotificationWorkspaceSubscription[],
): NotificationRealtimeDiagnosticsChangeDetails {
  const changeDetails: NotificationRealtimeDiagnosticsChangeDetails = {
    recentSuppressionClearedWorkspaceIds: [],
    recentSuppressionEnteredWorkspaceIds: [],
    unreadScopeClearedWorkspaceIds: [],
    unreadScopeEnteredWorkspaceIds: [],
    workspaceSubscriptionAddedIds: [],
    workspaceSubscriptionRemovedIds: [],
  }

  if (!previousEntry) {
    return changeDetails
  }

  const previousSubscriptionsByWorkspace = buildRealtimeDiagnosticsSubscriptionLookup(
    previousEntry.subscriptions,
  )
  const nextSubscriptionsByWorkspace = buildRealtimeDiagnosticsSubscriptionLookup(subscriptions)
  const workspaceIds = new Set([
    ...previousSubscriptionsByWorkspace.keys(),
    ...nextSubscriptionsByWorkspace.keys(),
  ])

  for (const workspaceId of workspaceIds) {
    const previousReasons =
      previousSubscriptionsByWorkspace.get(workspaceId) ??
      new Set<RealtimeNotificationWorkspaceReasonCode>()
    const nextReasons =
      nextSubscriptionsByWorkspace.get(workspaceId) ??
      new Set<RealtimeNotificationWorkspaceReasonCode>()

    if (!previousReasons.size && nextReasons.size) {
      changeDetails.workspaceSubscriptionAddedIds.push(workspaceId)
    }
    if (previousReasons.size && !nextReasons.size) {
      changeDetails.workspaceSubscriptionRemovedIds.push(workspaceId)
    }
    if (!previousReasons.has('unread_notification') && nextReasons.has('unread_notification')) {
      changeDetails.unreadScopeEnteredWorkspaceIds.push(workspaceId)
    }
    if (previousReasons.has('unread_notification') && !nextReasons.has('unread_notification')) {
      changeDetails.unreadScopeClearedWorkspaceIds.push(workspaceId)
    }
    if (!previousReasons.has('recent_suppression') && nextReasons.has('recent_suppression')) {
      changeDetails.recentSuppressionEnteredWorkspaceIds.push(workspaceId)
    }
    if (previousReasons.has('recent_suppression') && !nextReasons.has('recent_suppression')) {
      changeDetails.recentSuppressionClearedWorkspaceIds.push(workspaceId)
    }
  }

  return {
    recentSuppressionClearedWorkspaceIds:
      changeDetails.recentSuppressionClearedWorkspaceIds.sort(),
    recentSuppressionEnteredWorkspaceIds:
      changeDetails.recentSuppressionEnteredWorkspaceIds.sort(),
    unreadScopeClearedWorkspaceIds: changeDetails.unreadScopeClearedWorkspaceIds.sort(),
    unreadScopeEnteredWorkspaceIds: changeDetails.unreadScopeEnteredWorkspaceIds.sort(),
    workspaceSubscriptionAddedIds: changeDetails.workspaceSubscriptionAddedIds.sort(),
    workspaceSubscriptionRemovedIds: changeDetails.workspaceSubscriptionRemovedIds.sort(),
  }
}

function buildRealtimeDiagnosticsSubscriptionLookup(
  subscriptions: RealtimeNotificationWorkspaceSubscription[],
) {
  return new Map<string, Set<RealtimeNotificationWorkspaceReasonCode>>(
    subscriptions.map((subscription) => [subscription.workspaceId, new Set(subscription.reasonCodes)]),
  )
}

function normalizeRoutePath(routePath?: string) {
  return typeof routePath === 'string' && routePath.trim() ? routePath.trim() : ''
}

function formatNotificationRealtimeDiagnosticsWorkspaceList(
  workspaceIds: string[],
  workspaceNameById: Record<string, string>,
) {
  return workspaceIds.map((workspaceId) => workspaceNameById[workspaceId] || workspaceId).join(', ')
}
