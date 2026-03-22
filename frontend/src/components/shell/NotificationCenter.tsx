import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'

import {
  clearReadNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../features/notifications/api'
import { formatLocaleDateTime, formatLocaleNumber } from '../../i18n/format'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import type { NotificationItem } from '../../types/api'
import { Button } from '../ui/Button'
import { InlineNotice } from '../ui/InlineNotice'

type NotificationCenterProps = {
  compact?: boolean
}

type MenuPosition = {
  top: number
  left: number
  width: number
  transformOrigin: string
}

type ToastNotification = NotificationItem

function BellIcon() {
  return (
    <svg aria-hidden="true" fill="none" viewBox="0 0 20 20">
      <path
        d="M10 3.2a3.3 3.3 0 0 0-3.3 3.3v1.3c0 1.3-.4 2.6-1.3 3.7l-.9 1.1h11l-.9-1.1c-.9-1.1-1.3-2.4-1.3-3.7V6.5A3.3 3.3 0 0 0 10 3.2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
      <path
        d="M8.3 15a1.9 1.9 0 0 0 3.4 0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.5"
      />
    </svg>
  )
}

export function NotificationCenter({ compact = false }: NotificationCenterProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isOpen, setIsOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)
  const [toasts, setToasts] = useState<ToastNotification[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const toastTimersRef = useRef<Record<string, number>>({})
  const seenNotificationIdsRef = useRef<Set<string>>(new Set())
  const notificationsInitializedRef = useRef(false)
  const dialogId = useId()

  const notificationsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: listNotifications,
    refetchInterval: 15_000,
    staleTime: 15_000,
  })
  const markReadMutation = useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  const markAllReadMutation = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
  const clearReadMutation = useMutation({
    mutationFn: clearReadNotifications,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['notifications'] })
    },
  })

  const notifications = notificationsQuery.data ?? []
  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.read).length,
    [notifications],
  )
  const hasRead = useMemo(
    () => notifications.some((notification) => notification.read),
    [notifications],
  )

  useEffect(() => {
    if (!notificationsInitializedRef.current) {
      notifications.forEach((notification) => seenNotificationIdsRef.current.add(notification.id))
      notificationsInitializedRef.current = true
      return
    }

    if (!notifications.length) {
      return
    }

    const nextToasts = notifications.filter(
      (notification) => !seenNotificationIdsRef.current.has(notification.id) && !notification.read,
    )
    if (!nextToasts.length) {
      return
    }

    nextToasts.forEach((notification) => {
      seenNotificationIdsRef.current.add(notification.id)
      setToasts((current) => [notification, ...current.filter((item) => item.id !== notification.id)].slice(0, 4))
      toastTimersRef.current[notification.id] = window.setTimeout(() => {
        setToasts((current) => current.filter((item) => item.id !== notification.id))
        delete toastTimersRef.current[notification.id]
      }, 7_000)
    })
  }, [notifications])

  useEffect(() => {
    return () => {
      Object.values(toastTimersRef.current).forEach((timer) => window.clearTimeout(timer))
    }
  }, [])

  useEffect(() => {
    if (!isOpen || !menuPosition) {
      return
    }

    popoverRef.current?.focus()
  }, [isOpen, menuPosition])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updatePosition() {
      const trigger = triggerRef.current
      if (!trigger) {
        return
      }

      const rect = trigger.getBoundingClientRect()
      const viewportPadding = 12
      const menuGap = 4
      const width = Math.min(Math.max(rect.width, compact ? 300 : 340), window.innerWidth - viewportPadding * 2)
      const estimatedHeight = 420
      const menuHeight = popoverRef.current?.offsetHeight ?? estimatedHeight
      const openAbove =
        rect.bottom + menuGap + menuHeight > window.innerHeight - viewportPadding &&
        rect.top > window.innerHeight - rect.bottom
      const top = openAbove
        ? Math.max(viewportPadding, rect.top - menuHeight - menuGap)
        : Math.min(rect.bottom + menuGap, window.innerHeight - viewportPadding - menuHeight)
      const left = Math.max(
        viewportPadding,
        Math.min(rect.right - width, window.innerWidth - viewportPadding - width),
      )

      setMenuPosition({
        top,
        left,
        width,
        transformOrigin: openAbove ? 'bottom right' : 'top right',
      })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }
      if (rootRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return
      }
      setIsOpen(false)
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    const frameId = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.cancelAnimationFrame(frameId)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [compact, isOpen])

  async function handleOpenNotification(notification: NotificationItem) {
    if (!notification.read) {
      await markReadMutation.mutateAsync(notification.id)
    }

    setToasts((current) => current.filter((item) => item.id !== notification.id))
    setIsOpen(false)

    if (notification.automationId) {
      navigate(`/automations/${notification.automationId}`)
      return
    }

    if (notification.workspaceId) {
      navigate(`/workspaces/${notification.workspaceId}`)
    }
  }

  const triggerClassName = compact
    ? 'web-ide__notification-trigger web-ide__notification-trigger--mobile'
    : 'web-ide__notification-trigger'

  const popover =
    isOpen && menuPosition
      ? createPortal(
          <div
            aria-label={i18n._({ id: 'Notifications', message: 'Notifications' })}
            className="web-ide__notification-popover"
            id={dialogId}
            ref={popoverRef}
            role="dialog"
            style={{
              top: `${menuPosition.top}px`,
              left: `${menuPosition.left}px`,
              width: `${menuPosition.width}px`,
              transformOrigin: menuPosition.transformOrigin,
            }}
            tabIndex={-1}
          >
            <div className="web-ide__notification-popover-header">
              <div>
                <strong>{i18n._({ id: 'Notifications', message: 'Notifications' })}</strong>
                <span>
                  {i18n._({
                    id: 'Automation runs, failures, and saved outcomes.',
                    message: 'Automation runs, failures, and saved outcomes.',
                  })}
                </span>
              </div>
              {notifications.length > 0 ? (
                <div className="web-ide__notification-popover-actions">
                  {unreadCount > 0 ? (
                    <Button
                      intent="ghost"
                      isLoading={markAllReadMutation.isPending}
                      onClick={() => markAllReadMutation.mutate()}
                      size="sm"
                    >
                      {i18n._({ id: 'Mark all read', message: 'Mark all read' })}
                    </Button>
                  ) : null}
                  {hasRead ? (
                    <Button
                      intent="ghost"
                      isLoading={clearReadMutation.isPending}
                      onClick={() => clearReadMutation.mutate()}
                      size="sm"
                    >
                      {i18n._({ id: 'Clear read', message: 'Clear read' })}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            {notificationsQuery.error ? (
              <InlineNotice
                dismissible
                noticeKey={`notification-center-${getErrorMessage(notificationsQuery.error)}`}
                title={i18n._({ id: 'Notifications Failed', message: 'Notifications Failed' })}
                tone="error"
              >
                {getErrorMessage(notificationsQuery.error)}
              </InlineNotice>
            ) : null}

            <div className="web-ide__notification-list">
              {notifications.length ? (
                notifications.map((notification) => (
                  <button
                    className={
                      notification.read
                        ? 'web-ide__notification-item'
                        : 'web-ide__notification-item web-ide__notification-item--unread'
                    }
                    key={notification.id}
                    onClick={() => void handleOpenNotification(notification)}
                    type="button"
                  >
                    <div className="web-ide__notification-item-header">
                      <strong>{notification.title}</strong>
                      <span className={`status-pill status-pill--${notificationTone(notification.level)}`}>
                        {formatNotificationLevel(notification.level)}
                      </span>
                    </div>
                    <p>{notification.message}</p>
                    <div className="web-ide__notification-item-meta">
                      <span>{formatTimestamp(notification.createdAt)}</span>
                      <span>{notification.automationTitle || notification.workspaceName}</span>
                    </div>
                  </button>
                ))
              ) : (
                <div className="notice">
                  {i18n._({ id: 'No notifications yet.', message: 'No notifications yet.' })}
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null

  const toastPortal = toasts.length
    ? createPortal(
        <div className="web-ide__notification-toast-stack">
          {toasts.map((notification) => (
            <button
              className={`web-ide__notification-toast web-ide__notification-toast--${notificationTone(notification.level)}`}
              key={notification.id}
              onClick={() => void handleOpenNotification(notification)}
              type="button"
            >
              <strong>{notification.title}</strong>
              <span>{notification.message}</span>
            </button>
          ))}
        </div>,
        document.body,
      )
    : null

  return (
    <div className="web-ide__notification-center" ref={rootRef}>
      <button
        aria-controls={dialogId}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={
          unreadCount
            ? i18n._({
                id: 'Notifications. {count} unread',
                message: 'Notifications. {count} unread',
                values: { count: formatLocaleNumber(unreadCount) },
              })
            : i18n._({ id: 'Notifications', message: 'Notifications' })
        }
        className={triggerClassName}
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title={
          unreadCount
            ? i18n._({
                id: '{count} unread notifications',
                message: '{count} unread notifications',
                values: { count: formatLocaleNumber(unreadCount) },
              })
            : i18n._({ id: 'Notifications', message: 'Notifications' })
        }
        type="button"
      >
        <span className="web-ide__notification-trigger-icon" aria-hidden="true">
          <BellIcon />
        </span>
        {!compact ? (
          <span className="web-ide__notification-trigger-label">
            {i18n._({ id: 'Notifications', message: 'Notifications' })}
          </span>
        ) : null}
        {unreadCount ? <span className="web-ide__notification-badge">{unreadCount}</span> : null}
      </button>
      {popover}
      {toastPortal}
    </div>
  )
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return formatLocaleDateTime(value)
}

function formatNotificationLevel(level: string) {
  switch (level) {
    case 'success':
      return i18n._({ id: 'Success', message: 'Success' })
    case 'warning':
      return i18n._({ id: 'Warning', message: 'Warning' })
    case 'error':
      return i18n._({ id: 'Error', message: 'Error' })
    case 'info':
      return i18n._({ id: 'Info', message: 'Info' })
    default:
      return level
  }
}

function notificationTone(level: string) {
  switch (level) {
    case 'success':
      return 'connected'
    case 'error':
      return 'error'
    case 'warning':
      return 'paused'
    default:
      return 'idle'
  }
}
