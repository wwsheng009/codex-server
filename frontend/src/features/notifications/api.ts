import { apiRequest } from '../../lib/api-client'
import type { NotificationItem } from '../../types/api'

export function listNotifications() {
  return apiRequest<NotificationItem[]>('/api/notifications')
}

export function markNotificationRead(notificationId: string) {
  return apiRequest<NotificationItem>(`/api/notifications/${notificationId}/read`, {
    method: 'POST',
  })
}

export function markAllNotificationsRead() {
  return apiRequest<NotificationItem[]>('/api/notifications/read-all', {
    method: 'POST',
  })
}
