import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import type { NotificationItem, ServerEvent } from '../../types/api'
import {
  buildNotificationItemFromEvent,
  createEmptyNotificationRealtimeDiagnosticsHistoryState,
  collectRealtimeNotificationWorkspaceIds,
  describeNotificationRealtimeDiagnosticsChangeDetails,
  describeRealtimeNotificationWorkspaceSubscriptions,
  formatNotificationRealtimeDiagnosticsChangeTrigger,
  resolveActiveNotificationWorkspaceId,
  updateNotificationRealtimeDiagnosticsHistory,
  upsertNotificationItem,
} from './notificationStreamUtils'

function makeEvent(
  payload: Record<string, unknown>,
  overrides: Partial<ServerEvent> = {},
): ServerEvent {
  return {
    workspaceId: 'ws-1',
    threadId: '',
    turnId: '',
    method: 'notification/created',
    payload,
    ts: '2026-04-06T10:00:00.000Z',
    ...overrides,
  }
}

function makeNotification(
  id: string,
  overrides: Partial<NotificationItem> = {},
): NotificationItem {
  return {
    id,
    workspaceId: 'ws-1',
    workspaceName: 'Workspace One',
    kind: 'automation_run_completed',
    title: `Notification ${id}`,
    message: `Message ${id}`,
    level: 'info',
    read: false,
    createdAt: '2026-04-06T10:00:00.000Z',
    ...overrides,
  }
}

beforeAll(() => {
  i18n.loadAndActivate({ locale: 'en', messages: {} })
})

describe('buildNotificationItemFromEvent', () => {
  it('maps notification/created events into notification items', () => {
    const notification = buildNotificationItemFromEvent(
      makeEvent({
        notificationId: 'note-1',
        automationId: 'auto-1',
        runId: 'run-1',
        kind: 'automation_run_completed',
        title: 'Automation finished',
        message: 'The nightly run completed.',
        level: 'success',
        read: false,
      }),
      { 'ws-1': 'Workspace One' },
    )

    expect(notification).toEqual(
      expect.objectContaining({
        id: 'note-1',
        workspaceId: 'ws-1',
        workspaceName: 'Workspace One',
        automationId: 'auto-1',
        runId: 'run-1',
        kind: 'automation_run_completed',
        title: 'Automation finished',
        message: 'The nightly run completed.',
        level: 'success',
        read: false,
        createdAt: '2026-04-06T10:00:00.000Z',
      }),
    )
  })

  it('returns null for non-notification events or incomplete payloads', () => {
    expect(
      buildNotificationItemFromEvent(
        makeEvent(
          {
            notificationId: 'note-2',
          },
          {
            method: 'thread/updated',
          },
        ),
      ),
    ).toBeNull()

    expect(
      buildNotificationItemFromEvent(
        makeEvent({
          notificationId: 'note-3',
          kind: 'bot_duplicate_delivery_suppressed',
          title: 'Missing message',
          level: 'warning',
        }),
      ),
    ).toBeNull()
  })
})

describe('upsertNotificationItem', () => {
  it('prepends new notifications in descending createdAt order', () => {
    const current = [
      makeNotification('note-1', { createdAt: '2026-04-06T09:00:00.000Z' }),
      makeNotification('note-2', { createdAt: '2026-04-06T08:00:00.000Z' }),
    ]

    const next = upsertNotificationItem(
      current,
      makeNotification('note-3', { createdAt: '2026-04-06T10:00:00.000Z' }),
    )

    expect(next.map((notification) => notification.id)).toEqual(['note-3', 'note-1', 'note-2'])
  })

  it('merges duplicate notifications without reverting read state', () => {
    const current = [
      makeNotification('note-1', {
        read: true,
        readAt: '2026-04-06T10:05:00.000Z',
        botConnectionName: 'WeChat Bot',
      }),
    ]

    const next = upsertNotificationItem(
      current,
      makeNotification('note-1', {
        read: false,
        workspaceName: '',
        botConnectionName: '',
      }),
    )

    expect(next).toHaveLength(1)
    expect(next[0]).toEqual(
      expect.objectContaining({
        id: 'note-1',
        read: true,
        readAt: '2026-04-06T10:05:00.000Z',
        workspaceName: 'Workspace One',
        botConnectionName: 'WeChat Bot',
      }),
    )
  })
})

describe('resolveActiveNotificationWorkspaceId', () => {
  it('prefers workspace routes and bot log routes before the fallback selection', () => {
    expect(
      resolveActiveNotificationWorkspaceId('/workspaces/ws-thread-1/threads/thread-1', 'ws-fallback'),
    ).toBe('ws-thread-1')

    expect(
      resolveActiveNotificationWorkspaceId('/bots/ws-bot-1/connection-1/logs', 'ws-fallback'),
    ).toBe('ws-bot-1')

    expect(resolveActiveNotificationWorkspaceId('/automations', 'ws-fallback')).toBe('ws-fallback')
  })
})

describe('collectRealtimeNotificationWorkspaceIds', () => {
  it('keeps realtime subscriptions only for active, unread, or recent suppression workspaces', () => {
    const notifications = [
      makeNotification('note-unread', {
        workspaceId: 'ws-unread',
        read: false,
        createdAt: '2026-04-06T09:30:00.000Z',
      }),
      makeNotification('note-suppression-recent', {
        workspaceId: 'ws-suppression',
        kind: 'bot_duplicate_delivery_suppressed',
        read: true,
        createdAt: '2026-04-06T08:30:00.000Z',
      }),
      makeNotification('note-suppression-old', {
        workspaceId: 'ws-old',
        kind: 'bot_recovery_replay_suppressed',
        read: true,
        createdAt: '2026-04-04T08:30:00.000Z',
      }),
      makeNotification('note-read', {
        workspaceId: 'ws-read',
        read: true,
        createdAt: '2026-04-06T09:00:00.000Z',
      }),
    ]

    const next = collectRealtimeNotificationWorkspaceIds({
      activeWorkspaceId: 'ws-active',
      notifications,
      now: Date.parse('2026-04-06T10:00:00.000Z'),
    })

    expect(next).toEqual(['ws-active', 'ws-suppression', 'ws-unread'])
  })

  it('deduplicates workspace ids and ignores blank ids', () => {
    const notifications = [
      makeNotification('note-1', {
        workspaceId: 'ws-shared',
        read: false,
      }),
      makeNotification('note-2', {
        workspaceId: 'ws-shared',
        kind: 'bot_duplicate_delivery_suppressed',
        read: true,
      }),
      makeNotification('note-3', {
        workspaceId: '',
        read: false,
      }),
    ]

    const next = collectRealtimeNotificationWorkspaceIds({
      activeWorkspaceId: 'ws-shared',
      notifications,
      now: Date.parse('2026-04-06T10:00:00.000Z'),
    })

    expect(next).toEqual(['ws-shared'])
  })
})

describe('describeRealtimeNotificationWorkspaceSubscriptions', () => {
  it('explains each live workspace subscription with stable reason codes', () => {
    const notifications = [
      makeNotification('note-active-unread', {
        workspaceId: 'ws-active',
        read: false,
      }),
      makeNotification('note-suppression', {
        workspaceId: 'ws-bot',
        kind: 'bot_recovery_replay_suppressed',
        read: true,
        createdAt: '2026-04-06T09:40:00.000Z',
      }),
    ]

    const next = describeRealtimeNotificationWorkspaceSubscriptions({
      activeWorkspaceId: 'ws-active',
      notifications,
      now: Date.parse('2026-04-06T10:00:00.000Z'),
    })

    expect(next).toEqual([
      {
        workspaceId: 'ws-active',
        reasonCodes: ['active_workspace', 'unread_notification'],
      },
      {
        workspaceId: 'ws-bot',
        reasonCodes: ['recent_suppression'],
      },
    ])
  })
})

describe('updateNotificationRealtimeDiagnosticsHistory', () => {
  it('records the first diagnostics snapshot and preserves reason details', () => {
    const next = updateNotificationRealtimeDiagnosticsHistory(
      createEmptyNotificationRealtimeDiagnosticsHistoryState(),
      {
        activeWorkspaceId: 'ws-active',
        changedAt: '2026-04-06T10:00:00.000Z',
        routePath: '/workspaces/ws-active',
        subscriptions: [
          {
            workspaceId: 'ws-active',
            reasonCodes: ['active_workspace', 'unread_notification'],
          },
        ],
      },
    )

    expect(next.lastChangedAt).toBe('2026-04-06T10:00:00.000Z')
    expect(next.history).toEqual([
      {
        activeWorkspaceId: 'ws-active',
        changeDetails: {
          recentSuppressionClearedWorkspaceIds: [],
          recentSuppressionEnteredWorkspaceIds: [],
          unreadScopeClearedWorkspaceIds: [],
          unreadScopeEnteredWorkspaceIds: [],
          workspaceSubscriptionAddedIds: [],
          workspaceSubscriptionRemovedIds: [],
        },
        changeTriggerCodes: ['initial_snapshot'],
        changedAt: '2026-04-06T10:00:00.000Z',
        routePath: '/workspaces/ws-active',
        signature: 'ws-active>>/workspaces/ws-active>>ws-active:active_workspace,unread_notification',
        subscriptions: [
          {
            workspaceId: 'ws-active',
            reasonCodes: ['active_workspace', 'unread_notification'],
          },
        ],
      },
    ])
  })

  it('deduplicates identical snapshots and appends only real changes', () => {
    const initial = updateNotificationRealtimeDiagnosticsHistory(
      createEmptyNotificationRealtimeDiagnosticsHistoryState(),
      {
        activeWorkspaceId: 'ws-active',
        changedAt: '2026-04-06T10:00:00.000Z',
        routePath: '/workspaces/ws-active',
        subscriptions: [
          {
            workspaceId: 'ws-active',
            reasonCodes: ['active_workspace'],
          },
        ],
      },
    )

    const unchanged = updateNotificationRealtimeDiagnosticsHistory(initial, {
      activeWorkspaceId: 'ws-active',
      changedAt: '2026-04-06T10:01:00.000Z',
      routePath: '/workspaces/ws-active',
      subscriptions: [
        {
          workspaceId: 'ws-active',
          reasonCodes: ['active_workspace'],
        },
      ],
    })

    const changed = updateNotificationRealtimeDiagnosticsHistory(initial, {
      activeWorkspaceId: 'ws-active',
      changedAt: '2026-04-06T10:02:00.000Z',
      routePath: '/bots/ws-active/connection-1/logs',
      subscriptions: [
        {
          workspaceId: 'ws-active',
          reasonCodes: ['active_workspace'],
        },
        {
          workspaceId: 'ws-bot',
          reasonCodes: ['recent_suppression'],
        },
      ],
    })

    expect(unchanged).toBe(initial)
    expect(changed.lastChangedAt).toBe('2026-04-06T10:02:00.000Z')
    expect(changed.history).toHaveLength(2)
    expect(changed.history[0]).toEqual(
      expect.objectContaining({
        changedAt: '2026-04-06T10:02:00.000Z',
        routePath: '/bots/ws-active/connection-1/logs',
        changeDetails: {
          recentSuppressionClearedWorkspaceIds: [],
          recentSuppressionEnteredWorkspaceIds: ['ws-bot'],
          unreadScopeClearedWorkspaceIds: [],
          unreadScopeEnteredWorkspaceIds: [],
          workspaceSubscriptionAddedIds: ['ws-bot'],
          workspaceSubscriptionRemovedIds: [],
        },
        changeTriggerCodes: [
          'route_context_changed',
          'workspace_subscription_added',
          'recent_suppression_entered',
        ],
      }),
    )
    expect(changed.history[1]).toEqual(
      expect.objectContaining({
        changedAt: '2026-04-06T10:00:00.000Z',
      }),
    )
  })

  it('records route-only changes even when the live workspace set stays the same', () => {
    const initial = updateNotificationRealtimeDiagnosticsHistory(
      createEmptyNotificationRealtimeDiagnosticsHistoryState(),
      {
        activeWorkspaceId: 'ws-active',
        changedAt: '2026-04-06T10:00:00.000Z',
        routePath: '/workspaces/ws-active',
        subscriptions: [
          {
            workspaceId: 'ws-active',
            reasonCodes: ['active_workspace'],
          },
        ],
      },
    )

    const changed = updateNotificationRealtimeDiagnosticsHistory(initial, {
      activeWorkspaceId: 'ws-active',
      changedAt: '2026-04-06T10:05:00.000Z',
      routePath: '/workspaces/ws-active/threads/thread-1',
      subscriptions: [
        {
          workspaceId: 'ws-active',
          reasonCodes: ['active_workspace'],
        },
      ],
    })

    expect(changed).not.toBe(initial)
    expect(changed.history[0]).toEqual(
      expect.objectContaining({
        changedAt: '2026-04-06T10:05:00.000Z',
        routePath: '/workspaces/ws-active/threads/thread-1',
        changeDetails: {
          recentSuppressionClearedWorkspaceIds: [],
          recentSuppressionEnteredWorkspaceIds: [],
          unreadScopeClearedWorkspaceIds: [],
          unreadScopeEnteredWorkspaceIds: [],
          workspaceSubscriptionAddedIds: [],
          workspaceSubscriptionRemovedIds: [],
        },
        changeTriggerCodes: ['route_context_changed'],
      }),
    )
  })
})

describe('formatNotificationRealtimeDiagnosticsChangeTrigger', () => {
  it('maps change trigger codes to readable labels', () => {
    expect(formatNotificationRealtimeDiagnosticsChangeTrigger('initial_snapshot')).toBe('Session start')
    expect(formatNotificationRealtimeDiagnosticsChangeTrigger('route_context_changed')).toBe('Route changed')
    expect(formatNotificationRealtimeDiagnosticsChangeTrigger('recent_suppression_cleared')).toBe(
      'Suppression cleared',
    )
  })
})

describe('describeNotificationRealtimeDiagnosticsChangeDetails', () => {
  it('renders stable debug copy for workspace deltas', () => {
    expect(
      describeNotificationRealtimeDiagnosticsChangeDetails(
        {
          recentSuppressionClearedWorkspaceIds: ['ws-c'],
          recentSuppressionEnteredWorkspaceIds: ['ws-b'],
          unreadScopeClearedWorkspaceIds: ['ws-d'],
          unreadScopeEnteredWorkspaceIds: ['ws-a'],
          workspaceSubscriptionAddedIds: ['ws-a', 'ws-b'],
          workspaceSubscriptionRemovedIds: ['ws-c'],
        },
        {
          'ws-a': 'Workspace A',
          'ws-b': 'Workspace B',
          'ws-c': 'Workspace C',
          'ws-d': 'Workspace D',
        },
      ),
    ).toEqual([
      'Workspaces added: Workspace A, Workspace B',
      'Workspaces removed: Workspace C',
      'Unread entered: Workspace A',
      'Unread cleared: Workspace D',
      'Suppression entered: Workspace B',
      'Suppression cleared: Workspace C',
    ])
  })
})
