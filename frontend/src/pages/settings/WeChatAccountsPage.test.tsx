// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n/runtime'

const botsApiState = vi.hoisted(() => ({
  deleteWeChatAccount: vi.fn(),
  listBotConnections: vi.fn(),
  listWeChatAccounts: vi.fn(),
}))

const shellContextState = vi.hoisted(() => ({
  useSettingsShellContext: vi.fn(),
}))

vi.mock('../../features/bots/api', async () => {
  const actual = await vi.importActual<typeof import('../../features/bots/api')>('../../features/bots/api')
  return {
    ...actual,
    deleteWeChatAccount: botsApiState.deleteWeChatAccount,
    listBotConnections: botsApiState.listBotConnections,
    listWeChatAccounts: botsApiState.listWeChatAccounts,
  }
})

vi.mock('../../features/settings/shell-context', async () => {
  const actual = await vi.importActual<typeof import('../../features/settings/shell-context')>('../../features/settings/shell-context')
  return {
    ...actual,
    useSettingsShellContext: shellContextState.useSettingsShellContext,
  }
})

describe('WeChatAccountsPage', () => {
  let WeChatAccountsPageComponent: Awaited<typeof import('./WeChatAccountsPage')>['WeChatAccountsPage']

  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeAll(async () => {
    ;({ WeChatAccountsPage: WeChatAccountsPageComponent } = await import('./WeChatAccountsPage'))
  })

  beforeEach(() => {
    vi.clearAllMocks()

    shellContextState.useSettingsShellContext.mockReturnValue({
      workspaceId: 'ws-1',
      workspaceName: 'Alpha Workspace',
      workspaces: [
        {
          id: 'ws-1',
          name: 'Alpha Workspace',
        },
      ],
      workspacesLoading: false,
      workspacesError: '',
      setSelectedWorkspaceId: vi.fn(),
    })

    botsApiState.listWeChatAccounts.mockResolvedValue([
      {
        id: 'wechat-account-1',
        workspaceId: 'ws-1',
        alias: 'Support Login',
        note: 'Primary QA account',
        baseUrl: 'https://wechat.example.com',
        accountId: 'acct-123',
        userId: 'owner-456',
        lastConfirmedAt: '2026-04-30T12:00:00.000Z',
        createdAt: '2026-04-30T12:00:00.000Z',
        updatedAt: '2026-04-30T12:00:00.000Z',
      },
    ])
    botsApiState.listBotConnections.mockResolvedValue([
      {
        id: 'conn-1',
        botId: 'bot-1',
        workspaceId: 'ws-1',
        provider: 'wechat',
        name: 'Support Endpoint',
        status: 'active',
        aiBackend: 'workspace_thread',
        aiConfig: {
          permission_preset: 'default',
        },
        settings: {
          wechat_account_id: 'acct-123',
          wechat_owner_user_id: 'owner-456',
          wechat_base_url: 'https://wechat.example.com',
          runtime_mode: 'normal',
        },
        capabilities: ['supportsTextOutbound'],
        secretKeys: [],
        lastPollAt: null,
        lastPollStatus: null,
        lastPollMessage: null,
        lastPollMessageKey: null,
        lastPollMessageParams: null,
        createdAt: '2026-04-30T12:00:00.000Z',
        updatedAt: '2026-04-30T12:00:00.000Z',
      },
    ])
  })

  afterEach(() => {
    cleanup()
  })

  it('renders workspace scoped saved WeChat accounts', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    })

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/settings/wechat-accounts']}>
          <WeChatAccountsPageComponent />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'WeChat Accounts' })).toBeInTheDocument()
    })

    await waitFor(() => {
      expect(screen.getByText('Support Login · acct-123 · owner-456')).toBeInTheDocument()
    })
    expect(screen.getByText('Primary QA account')).toBeInTheDocument()

    const accountRow = screen.getByText('Support Login · acct-123 · owner-456').closest('article')
    expect(accountRow).not.toBeNull()
    expect(within(accountRow as HTMLElement).getByRole('button', { name: 'Open in Bots' })).toBeInTheDocument()
    expect(within(accountRow as HTMLElement).getByRole('button', { name: 'Logs' })).toBeInTheDocument()
  })
})
