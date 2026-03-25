import type { NotificationItem } from '../../types/api'

export type NotificationCenterProps = {
  compact?: boolean
}

export type NotificationMenuPosition = {
  top: number
  left: number
  width: number
  transformOrigin: string
}

export type ToastNotification = NotificationItem
