// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n/runtime'

const botsApiState = vi.hoisted(() => ({
  getBotConnectionById: vi.fn(),
  listBotConnectionLogsById: vi.fn(),
  listBotConversations: vi.fn(),
  listBotDeliveryTargets: vi.fn(),
  listBotOutboundDeliveries: vi.fn(),
  listWeChatAccounts: vi.fn(),
}))

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}))

vi.mock('../features/bots/api', () => ({
  getBotConnectionById: botsApiState.getBotConnectionById,
  listBotConnectionLogsById: botsApiState.listBotConnectionLogsById,
  listBotConversations: botsApiState.listBotConversations,
  listBotDeliveryTargets: botsApiState.listBotDeliveryTargets,
  listBotOutboundDeliveries: botsApiState.listBotOutboundDeliveries,
  listWeChatAccounts: botsApiState.listWeChatAccounts,
}))

vi.mock('../features/workspaces/api', () => ({
  listWorkspaces: workspacesApiState.listWorkspaces,
}))

describe('BotConnectionDetailPage', () => {
  let BotConnectionDetailPageComponent: Awaited<typeof import('./BotConnectionDetailPage')>['BotConnectionDetailPage']

  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeAll(async () => {
    ;({ BotConnectionDetailPage: BotConnectionDetailPageComponent } = await import('./BotConnectionDetailPage'))
  })

  beforeEach(() => {
    vi.clearAllMocks()

    workspacesApiState.listWorkspaces.mockResolvedValue([
      {
        id: 'ws-1',
        name: 'Alpha Workspace',
        rootPath: 'E:/alpha',
        runtimeStatus: 'ready',
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ])

    botsApiState.getBotConnectionById.mockResolvedValue({
      id: 'conn-1',
      botId: 'bot-1',
      workspaceId: 'ws-1',
      provider: 'telegram',
      name: 'Telegram Endpoint',
      status: 'active',
      aiBackend: 'workspace_thread',
      aiConfig: {
        permission_preset: 'default',
      },
      settings: {
        telegram_delivery_mode: 'webhook',
        runtime_mode: 'normal',
        command_output_mode: 'brief',
      },
      capabilities: ['supportsTextOutbound', 'supportsSessionlessPush'],
      secretKeys: ['telegram_bot_token'],
      lastError: null,
      lastPollAt: '2026-04-23T00:00:00.000Z',
      lastPollStatus: 'success',
      lastPollMessage: 'Poll completed successfully. No new messages.',
      lastPollMessageKey: 'bot.poll-idle.no-new-messages',
      lastPollMessageParams: null,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
    })

    botsApiState.listBotConnectionLogsById.mockResolvedValue([])
    botsApiState.listWeChatAccounts.mockResolvedValue([])
    botsApiState.listBotDeliveryTargets.mockResolvedValue([
      {
        id: 'target-1',
        workspaceId: 'ws-1',
        botId: 'bot-1',
        endpointId: 'endpoint-1',
        provider: 'telegram',
        targetType: 'conversation',
        routeType: 'thread',
        routeKey: 'thread-1',
        title: 'Primary Recipient',
        labels: ['priority'],
        capabilities: ['supportsTextOutbound'],
        providerState: null,
        status: 'active',
        deliveryReadiness: 'ready',
        deliveryReadinessMessage: null,
        lastContextSeenAt: '2026-04-23T00:00:00.000Z',
        lastVerifiedAt: '2026-04-23T00:00:00.000Z',
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ])
    botsApiState.listBotOutboundDeliveries.mockResolvedValue([
      {
        id: 'delivery-1',
        botId: 'bot-1',
        endpointId: 'endpoint-1',
        sessionId: null,
        deliveryTargetId: 'target-1',
        runId: null,
        triggerId: null,
        sourceType: 'manual',
        sourceRefType: 'conversation',
        sourceRefId: 'conv-1',
        originWorkspaceId: 'ws-1',
        originThreadId: 'thread-1',
        originTurnId: 'turn-1',
        messages: [{ text: 'Hello world' }],
        status: 'delivered',
        attemptCount: 1,
        idempotencyKey: null,
        providerMessageIds: ['provider-message-1'],
        lastError: null,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:01:00.000Z',
        deliveredAt: '2026-04-23T00:01:00.000Z',
      },
    ])
    botsApiState.listBotConversations.mockResolvedValue([
      {
        id: 'conversation-1',
        botId: 'bot-1',
        workspaceId: 'ws-1',
        connectionId: 'conn-1',
        provider: 'telegram',
        externalChatId: 'chat-1',
        threadId: 'thread-1',
        lastInboundText: 'Incoming message',
        lastOutboundText: 'Outgoing message',
        lastOutboundDeliveryStatus: 'delivered',
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ])
  })

  afterEach(() => {
    cleanup()
  })

  it('renders a dedicated endpoint detail page with its related workspace data', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/bots/ws-1/conn-1']}>
          <Routes>
            <Route path="/bots/:workspaceId/:connectionId" element={<BotConnectionDetailPageComponent />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    expect(await screen.findByRole('heading', { name: 'Telegram Endpoint' })).toBeInTheDocument()
    expect(screen.getByText('Endpoint Detail')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Endpoints' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View Logs' })).toBeInTheDocument()
    expect(screen.getByText('Alpha Workspace')).toBeInTheDocument()
    expect(screen.getByText('Endpoint ID')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('Outbound Deliveries')).toBeInTheDocument()

    await waitFor(() => {
      expect(botsApiState.getBotConnectionById).toHaveBeenCalledWith('conn-1')
      expect(botsApiState.listBotDeliveryTargets).toHaveBeenCalledWith('ws-1', 'bot-1')
      expect(botsApiState.listBotOutboundDeliveries).toHaveBeenCalledWith('ws-1', 'bot-1')
      expect(botsApiState.listBotConversations).toHaveBeenCalledWith('ws-1', 'conn-1')
      expect(botsApiState.listBotConnectionLogsById).toHaveBeenCalledWith('conn-1')
      expect(botsApiState.listWeChatAccounts).toHaveBeenCalledWith('ws-1')
    })

    expect(await screen.findByRole('link', { name: 'Open Thread' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Overview' }))

    expect(await screen.findByRole('dialog', { name: 'Connection Overview' })).toBeInTheDocument()
  })
})
