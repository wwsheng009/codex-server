import { apiRequest } from '../../lib/api-client'
import type {
  NotificationDispatch,
  NotificationEmailTarget,
  NotificationMailServerConfig,
  NotificationSubscription,
} from '../../types/api'

export type NotificationSubscriptionChannelInput = {
  channel: string
  targetRefType: string
  targetRefId?: string
  titleTemplate?: string
  bodyTemplate?: string
  settings?: Record<string, string>
}

export type UpsertNotificationSubscriptionInput = {
  topic: string
  sourceType?: string
  filter?: Record<string, string>
  channels?: NotificationSubscriptionChannelInput[]
  enabled?: boolean
}

export type CreateNotificationEmailTargetInput = {
  name: string
  emails?: string[]
  subjectTemplate?: string
  bodyTemplate?: string
  enabled?: boolean
}

export type UpsertNotificationMailServerConfigInput = {
  enabled: boolean
  host?: string
  port: number
  username?: string
  password?: string
  clearPassword?: boolean
  from?: string
  requireTls: boolean
  skipVerify: boolean
}

export type ListNotificationDispatchesInput = {
  subscriptionId?: string
  topic?: string
  channel?: string
  status?: string
  targetRefType?: string
  targetRefId?: string
  sourceRefType?: string
  sourceRefId?: string
  eventKey?: string
}

export function listNotificationSubscriptions(workspaceId: string) {
  return apiRequest<NotificationSubscription[]>(
    `/api/workspaces/${workspaceId}/notification-subscriptions`,
  )
}

export function createNotificationSubscription(
  workspaceId: string,
  input: UpsertNotificationSubscriptionInput,
) {
  return apiRequest<NotificationSubscription>(`/api/workspaces/${workspaceId}/notification-subscriptions`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateNotificationSubscription(
  workspaceId: string,
  subscriptionId: string,
  input: UpsertNotificationSubscriptionInput,
) {
  return apiRequest<NotificationSubscription>(
    `/api/workspaces/${workspaceId}/notification-subscriptions/${subscriptionId}`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function deleteNotificationSubscription(workspaceId: string, subscriptionId: string) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/notification-subscriptions/${subscriptionId}`,
    { method: 'DELETE' },
  )
}

export function getNotificationMailServerConfig(workspaceId: string) {
  return apiRequest<NotificationMailServerConfig>(
    `/api/workspaces/${workspaceId}/notification-mail-server`,
  )
}

export function upsertNotificationMailServerConfig(
  workspaceId: string,
  input: UpsertNotificationMailServerConfigInput,
) {
  return apiRequest<NotificationMailServerConfig>(
    `/api/workspaces/${workspaceId}/notification-mail-server`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}

export function listNotificationEmailTargets(workspaceId: string) {
  return apiRequest<NotificationEmailTarget[]>(
    `/api/workspaces/${workspaceId}/notification-email-targets`,
  )
}

export function createNotificationEmailTarget(
  workspaceId: string,
  input: CreateNotificationEmailTargetInput,
) {
  return apiRequest<NotificationEmailTarget>(`/api/workspaces/${workspaceId}/notification-email-targets`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function listNotificationDispatches(
  workspaceId: string,
  input: ListNotificationDispatchesInput = {},
) {
  const query = new URLSearchParams()
  if (input.subscriptionId) query.set('subscriptionId', input.subscriptionId)
  if (input.topic) query.set('topic', input.topic)
  if (input.channel) query.set('channel', input.channel)
  if (input.status) query.set('status', input.status)
  if (input.targetRefType) query.set('targetRefType', input.targetRefType)
  if (input.targetRefId) query.set('targetRefId', input.targetRefId)
  if (input.sourceRefType) query.set('sourceRefType', input.sourceRefType)
  if (input.sourceRefId) query.set('sourceRefId', input.sourceRefId)
  if (input.eventKey) query.set('eventKey', input.eventKey)
  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<NotificationDispatch[]>(
    `/api/workspaces/${workspaceId}/notification-dispatches${suffix}`,
  )
}

export function getNotificationDispatch(workspaceId: string, dispatchId: string) {
  return apiRequest<NotificationDispatch>(
    `/api/workspaces/${workspaceId}/notification-dispatches/${dispatchId}`,
  )
}

export function retryNotificationDispatch(workspaceId: string, dispatchId: string) {
  return apiRequest<NotificationDispatch>(
    `/api/workspaces/${workspaceId}/notification-dispatches/${dispatchId}/retry`,
    { method: 'POST' },
  )
}
