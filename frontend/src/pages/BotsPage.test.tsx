// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n/runtime'

const botsApiState = vi.hoisted(() => ({
  listAllBots: vi.fn(),
  listAllBotConnections: vi.fn(),
  listAllWeChatAccounts: vi.fn(),
  listBotBindings: vi.fn(),
  listBotDeliveryTargets: vi.fn(),
  listBotOutboundDeliveries: vi.fn(),
  listBotTriggers: vi.fn(),
  listBotConversations: vi.fn(),
  listBotConnectionRecipientCandidates: vi.fn(),
}))

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}))

const threadsApiState = vi.hoisted(() => ({
  listThreadsPage: vi.fn(),
  getThread: vi.fn(),
}))

const workspaceStreamState = vi.hoisted(() => ({
  useWorkspaceEventSubscription: vi.fn(),
}))

vi.mock('../features/bots/api', async () => {
  const actual = await vi.importActual<typeof import('../features/bots/api')>('../features/bots/api')
  return {
    ...actual,
    listAllBots: botsApiState.listAllBots,
    listAllBotConnections: botsApiState.listAllBotConnections,
    listAllWeChatAccounts: botsApiState.listAllWeChatAccounts,
    listBotBindings: botsApiState.listBotBindings,
    listBotDeliveryTargets: botsApiState.listBotDeliveryTargets,
    listBotOutboundDeliveries: botsApiState.listBotOutboundDeliveries,
    listBotTriggers: botsApiState.listBotTriggers,
    listBotConversations: botsApiState.listBotConversations,
    listBotConnectionRecipientCandidates: botsApiState.listBotConnectionRecipientCandidates,
  }
})

vi.mock('../features/workspaces/api', async () => {
  const actual = await vi.importActual<typeof import('../features/workspaces/api')>('../features/workspaces/api')
  return {
    ...actual,
    listWorkspaces: workspacesApiState.listWorkspaces,
  }
})

vi.mock('../features/threads/api', async () => {
  const actual = await vi.importActual<typeof import('../features/threads/api')>('../features/threads/api')
  return {
    ...actual,
    listThreadsPage: threadsApiState.listThreadsPage,
    getThread: threadsApiState.getThread,
  }
})

vi.mock('../hooks/useWorkspaceStream', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useWorkspaceStream')>('../hooks/useWorkspaceStream')
  return {
    ...actual,
    useWorkspaceEventSubscription: workspaceStreamState.useWorkspaceEventSubscription,
  }
})

describe('BotsPage', () => {
  let BotsPageComponent: Awaited<typeof import('./BotsPage')>['BotsPage']

  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeAll(async () => {
    ;({ BotsPage: BotsPageComponent } = await import('./BotsPage'))
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

    botsApiState.listAllBots.mockResolvedValue([
      {
        id: 'bot-1',
        workspaceId: 'ws-1',
        scope: 'workspace',
        sharingMode: 'owner_only',
        sharedWorkspaceIds: [],
        name: 'Solo Bot',
        description: 'Bot without endpoints',
        status: 'active',
        defaultBindingId: null,
        defaultBindingMode: null,
        defaultTargetWorkspaceId: null,
        defaultTargetThreadId: null,
        endpointCount: 0,
        conversationCount: 0,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ])
    botsApiState.listAllBotConnections.mockResolvedValue([])
    botsApiState.listAllWeChatAccounts.mockResolvedValue([])
    botsApiState.listBotBindings.mockResolvedValue([])
    botsApiState.listBotDeliveryTargets.mockResolvedValue([])
    botsApiState.listBotOutboundDeliveries.mockResolvedValue([])
    botsApiState.listBotTriggers.mockResolvedValue([])
    botsApiState.listBotConversations.mockResolvedValue([])
    botsApiState.listBotConnectionRecipientCandidates.mockResolvedValue([])

    threadsApiState.listThreadsPage.mockResolvedValue({
      data: [],
      nextCursor: null,
    })
    threadsApiState.getThread.mockResolvedValue({
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Placeholder Thread',
      status: 'idle',
      archived: false,
      createdAt: '2026-04-23T00:00:00.000Z',
      updatedAt: '2026-04-23T00:00:00.000Z',
    })

    workspaceStreamState.useWorkspaceEventSubscription.mockImplementation(() => undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('stabilizes selection when bots exist but the global connection list is empty', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/bots']}>
          <BotsPageComponent />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(botsApiState.listBotBindings).toHaveBeenCalledWith('ws-1', 'bot-1')
    })

    expect(screen.getAllByText('Solo Bot').length).toBeGreaterThan(0)

    await new Promise((resolve) => window.setTimeout(resolve, 50))

    expect(botsApiState.listBotBindings.mock.calls).toHaveLength(1)
    expect(botsApiState.listBotDeliveryTargets.mock.calls).toHaveLength(1)
    expect(botsApiState.listBotOutboundDeliveries.mock.calls).toHaveLength(1)
    expect(botsApiState.listBotTriggers.mock.calls).toHaveLength(1)
  })

  it('opens the configuration summary in a modal from the compact preview', async () => {
    botsApiState.listAllBots.mockResolvedValue([
      {
        id: 'bot-1',
        workspaceId: 'ws-1',
        scope: 'workspace',
        sharingMode: 'owner_only',
        sharedWorkspaceIds: [],
        name: 'Solo Bot',
        description: 'Bot with one endpoint',
        status: 'active',
        defaultBindingId: null,
        defaultBindingMode: null,
        defaultTargetWorkspaceId: null,
        defaultTargetThreadId: null,
        endpointCount: 1,
        conversationCount: 0,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
      },
    ])
    botsApiState.listAllBotConnections.mockResolvedValue([
      {
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
        lastPollAt: null,
        lastPollStatus: null,
        lastPollMessage: null,
        lastPollMessageKey: null,
        lastPollMessageParams: null,
        createdAt: '2026-04-23T00:00:00.000Z',
        updatedAt: '2026-04-23T00:00:00.000Z',
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
        <MemoryRouter initialEntries={['/bots']} >
          <BotsPageComponent />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open Details' })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Open Details' }))

    const dialog = await screen.findByRole('dialog', { name: 'Configuration Summary' })
    expect(within(dialog).getByText('Endpoint ID')).toBeInTheDocument()
    expect(within(dialog).getByText('Provider')).toBeInTheDocument()
    expect(within(dialog).getByText('Delivery Mode')).toBeInTheDocument()
  })
})
