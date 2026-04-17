// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n/runtime'

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}))

const botsApiState = vi.hoisted(() => ({
  listAvailableBots: vi.fn(),
  listAvailableBotDeliveryTargets: vi.fn(),
}))

const notificationCenterApiState = vi.hoisted(() => ({
  listNotificationSubscriptions: vi.fn(),
  createNotificationSubscription: vi.fn(),
  updateNotificationSubscription: vi.fn(),
  deleteNotificationSubscription: vi.fn(),
  getNotificationMailServerConfig: vi.fn(),
  upsertNotificationMailServerConfig: vi.fn(),
  listNotificationEmailTargets: vi.fn(),
  createNotificationEmailTarget: vi.fn(),
  listNotificationDispatches: vi.fn(),
  retryNotificationDispatch: vi.fn(),
}))

vi.mock('../features/workspaces/api', () => ({
  listWorkspaces: workspacesApiState.listWorkspaces,
}))

vi.mock('../features/bots/api', () => ({
  listAvailableBots: botsApiState.listAvailableBots,
  listAvailableBotDeliveryTargets: botsApiState.listAvailableBotDeliveryTargets,
}))

vi.mock('../features/notification-center/api', () => ({
  listNotificationSubscriptions: notificationCenterApiState.listNotificationSubscriptions,
  createNotificationSubscription: notificationCenterApiState.createNotificationSubscription,
  updateNotificationSubscription: notificationCenterApiState.updateNotificationSubscription,
  deleteNotificationSubscription: notificationCenterApiState.deleteNotificationSubscription,
  getNotificationMailServerConfig: notificationCenterApiState.getNotificationMailServerConfig,
  upsertNotificationMailServerConfig: notificationCenterApiState.upsertNotificationMailServerConfig,
  listNotificationEmailTargets: notificationCenterApiState.listNotificationEmailTargets,
  createNotificationEmailTarget: notificationCenterApiState.createNotificationEmailTarget,
  listNotificationDispatches: notificationCenterApiState.listNotificationDispatches,
  retryNotificationDispatch: notificationCenterApiState.retryNotificationDispatch,
}))

describe('NotificationCenterPage', () => {
  let NotificationCenterPageComponent: Awaited<
    typeof import('./NotificationCenterPage')
  >['NotificationCenterPage']

  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeAll(async () => {
    ;({ NotificationCenterPage: NotificationCenterPageComponent } = await import('./NotificationCenterPage'))
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders subscription, delivery target, and dispatch audit data for the selected workspace', async () => {
    workspacesApiState.listWorkspaces.mockResolvedValue([
      {
        id: 'ws-1',
        name: 'Alpha Workspace',
        rootPath: 'E:/alpha',
        runtimeStatus: 'ready',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    botsApiState.listAvailableBots.mockResolvedValue([
      {
        id: 'bot-1',
        workspaceId: 'ws-2',
        scope: 'global',
        sharingMode: 'all_workspaces',
        sharedWorkspaceIds: [],
        name: 'Ops Bot',
        description: '',
        status: 'active',
        defaultBindingId: null,
        defaultBindingMode: null,
        defaultTargetWorkspaceId: null,
        defaultTargetThreadId: null,
        endpointCount: 1,
        conversationCount: 0,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    botsApiState.listAvailableBotDeliveryTargets.mockResolvedValue([
      {
        id: 'target-1',
        workspaceId: 'ws-2',
        botId: 'bot-1',
        endpointId: 'endpoint-1',
        sessionId: null,
        provider: 'telegram',
        targetType: 'chat',
        routeType: 'telegram_chat',
        routeKey: '-100123456',
        title: 'Ops Alerts',
        labels: [],
        capabilities: [],
        providerState: null,
        status: 'ready',
        deliveryReadiness: 'ready',
        deliveryReadinessMessage: null,
        lastContextSeenAt: null,
        lastVerifiedAt: null,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
      {
        id: 'target-2',
        workspaceId: 'ws-2',
        botId: 'bot-1',
        endpointId: 'endpoint-1',
        sessionId: null,
        provider: 'wechat',
        targetType: 'route_backed',
        routeType: 'wechat_session',
        routeKey: 'user:wxid_waiting',
        title: 'Waiting Contact',
        labels: [],
        capabilities: [],
        providerState: null,
        status: 'active',
        deliveryReadiness: 'waiting_for_context',
        deliveryReadinessMessage: 'wait for the user to send a message first',
        lastContextSeenAt: null,
        lastVerifiedAt: null,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    notificationCenterApiState.listNotificationSubscriptions.mockResolvedValue([
      {
        id: 'sub-1',
        workspaceId: 'ws-1',
        topic: 'hook.blocked',
        sourceType: 'hook',
        filter: { decision: 'block' },
        channels: [
          {
            channel: 'in_app',
            targetRefType: 'workspace',
            targetRefId: 'ws-1',
            titleTemplate: '',
            bodyTemplate: '',
            settings: null,
          },
          {
            channel: 'bot',
            targetRefType: 'bot_delivery_target',
            targetRefId: 'target-1',
            titleTemplate: '',
            bodyTemplate: '',
            settings: null,
          },
        ],
        enabled: true,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    notificationCenterApiState.listNotificationEmailTargets.mockResolvedValue([
      {
        id: 'email-1',
        workspaceId: 'ws-1',
        name: 'Ops Email',
        emails: ['ops@example.com'],
        subjectTemplate: '',
        bodyTemplate: '',
        enabled: true,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    notificationCenterApiState.getNotificationMailServerConfig.mockResolvedValue({
      workspaceId: 'ws-1',
      enabled: true,
      host: 'smtp.example.com',
      port: 587,
      username: 'mailer',
      passwordSet: true,
      from: 'alerts@example.com',
      requireTls: true,
      skipVerify: false,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    })
    notificationCenterApiState.listNotificationDispatches.mockResolvedValue([
      {
        id: 'dispatch-1',
        workspaceId: 'ws-1',
        subscriptionId: 'sub-1',
        eventKey: 'hook-run-1',
        dedupKey: 'hook-run-1|bot|target-1',
        topic: 'hook.blocked',
        sourceType: 'hook',
        sourceRefType: 'hook_run',
        sourceRefId: 'hook-run-1',
        channel: 'bot',
        targetRefType: 'bot_delivery_target',
        targetRefId: 'target-1',
        title: 'Blocked command',
        message: 'A hook blocked the command.',
        level: 'warning',
        status: 'failed',
        error: 'provider unavailable',
        attemptCount: 1,
        notificationId: '',
        botOutboundDeliveryId: '',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
        deliveredAt: null,
      },
    ])

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NotificationCenterPageComponent />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getAllByText('Alpha Workspace').length).toBeGreaterThan(0)
    })

    expect(screen.getAllByText('Alpha Workspace').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Hook blocked').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Mail server').length).toBeGreaterThan(0)
    expect(screen.getByText('smtp.example.com:587')).toBeTruthy()
    expect(screen.getByText('Delivery targets')).toBeTruthy()
    expect(screen.getByText('provider unavailable')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(botsApiState.listAvailableBots).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(botsApiState.listAvailableBotDeliveryTargets).toHaveBeenCalledWith('ws-1')
    })

    // Open the subscription dialog to verify template variables
    const createSubscriptionButton = screen.getByRole('button', { name: 'Create subscription' })
    createSubscriptionButton.click()

    await waitFor(() => {
      expect(screen.getByRole('note').textContent).toContain(
        'Use {{title}}, {{message}}, {{threadId}}, {{turnId}}, {{topic}}, and {{level}}.',
      )
    })

    await waitFor(() => {
      expect(screen.getAllByText('Delivery target channel').length).toBeGreaterThan(0)
    })

    screen.getByLabelText('Send to delivery target').click()

    await waitFor(() => {
      expect(screen.getByLabelText('Available delivery target')).toBeTruthy()
    })

    expect(screen.getByRole('option', { name: /Ops Alerts/ })).toBeTruthy()
    expect(screen.queryByRole('option', { name: /Waiting Contact/ })).toBeNull()
  })

  it('shows guidance when no ready delivery target is available', async () => {
    workspacesApiState.listWorkspaces.mockResolvedValue([
      {
        id: 'ws-1',
        name: 'Alpha Workspace',
        rootPath: 'E:/alpha',
        runtimeStatus: 'ready',
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    botsApiState.listAvailableBots.mockResolvedValue([])
    botsApiState.listAvailableBotDeliveryTargets.mockResolvedValue([
      {
        id: 'target-2',
        workspaceId: 'ws-2',
        botId: 'bot-2',
        endpointId: 'endpoint-2',
        sessionId: null,
        provider: 'wechat',
        targetType: 'route_backed',
        routeType: 'wechat_session',
        routeKey: 'user:wxid_waiting',
        title: 'Waiting Contact',
        labels: [],
        capabilities: [],
        providerState: null,
        status: 'active',
        deliveryReadiness: 'waiting_for_context',
        deliveryReadinessMessage: 'wait for the user to send a message first',
        lastContextSeenAt: null,
        lastVerifiedAt: null,
        createdAt: '2026-04-16T08:00:00.000Z',
        updatedAt: '2026-04-16T08:00:00.000Z',
      },
    ])
    notificationCenterApiState.listNotificationSubscriptions.mockResolvedValue([])
    notificationCenterApiState.listNotificationEmailTargets.mockResolvedValue([])
    notificationCenterApiState.getNotificationMailServerConfig.mockResolvedValue({
      workspaceId: 'ws-1',
      enabled: false,
      host: '',
      port: 587,
      username: '',
      passwordSet: false,
      from: '',
      requireTls: true,
      skipVerify: false,
      createdAt: '2026-04-16T08:00:00.000Z',
      updatedAt: '2026-04-16T08:00:00.000Z',
    })
    notificationCenterApiState.listNotificationDispatches.mockResolvedValue([])

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <NotificationCenterPageComponent />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getAllByText('Alpha Workspace').length).toBeGreaterThan(0)
    })

    screen.getByRole('button', { name: 'Create subscription' }).click()

    await waitFor(() => {
      expect(screen.getAllByText('Delivery target channel').length).toBeGreaterThan(0)
    })

    screen.getByLabelText('Send to delivery target').click()

    await waitFor(() => {
      expect(screen.getByText('No ready delivery targets')).toBeTruthy()
    })

    expect(
      screen.getByText(
        'Notification Center can only use delivery targets that are ready to send. Create or save a contact on the Bots page. For WeChat, ask the recipient to send a message to the bot first.',
      ),
    ).toBeTruthy()
    expect(screen.getAllByRole('link', { name: 'Open Bots page' }).length).toBeGreaterThan(0)
  })
})
