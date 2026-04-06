import { parseWorkspaceThreadRoute } from '../../lib/thread-routes'
import type { NotificationItem, ServerEvent } from '../../types/api'

export const NOTIFICATION_REALTIME_SUPPRESSION_WINDOW_MS = 24 * 60 * 60 * 1000
const SUPPRESSION_NOTIFICATION_KINDS = new Set([
  'bot_duplicate_delivery_suppressed',
  'bot_recovery_replay_suppressed',
])

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
  const workspaceIds = new Set<string>()
  const normalizedActiveWorkspaceId = normalizeWorkspaceId(activeWorkspaceId)

  if (normalizedActiveWorkspaceId) {
    workspaceIds.add(normalizedActiveWorkspaceId)
  }

  for (const notification of notifications) {
    const notificationWorkspaceId = normalizeWorkspaceId(notification.workspaceId)
    if (!notificationWorkspaceId) {
      continue
    }

    if (!notification.read) {
      workspaceIds.add(notificationWorkspaceId)
      continue
    }

    if (
      isSuppressionNotificationKind(notification.kind) &&
      isRecentNotification(notification.createdAt, now, suppressionWindowMs)
    ) {
      workspaceIds.add(notificationWorkspaceId)
    }
  }

  return [...workspaceIds].sort()
}

export function isSuppressionNotificationKind(kind: string) {
  return SUPPRESSION_NOTIFICATION_KINDS.has(kind.trim().toLowerCase())
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
