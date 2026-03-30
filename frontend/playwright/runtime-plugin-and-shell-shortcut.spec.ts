import { expect, test } from '@playwright/test'

const WORKSPACE_ID = 'ws-1'
const THREAD_ID = 'thread-1'

type PluginItem = {
  id: string
  name: string
  description: string
  marketplaceName: string
  marketplacePath: string
  installed: boolean
  enabled: boolean
  authPolicy: string
  installPolicy: string
  sourceType: string
  sourcePath: string
  capabilities: string[]
  category: string
}

function buildIsoDate(offsetMinutes: number) {
  const base = new Date('2026-03-27T08:00:00.000Z')
  base.setMinutes(base.getMinutes() + offsetMinutes)
  return base.toISOString()
}

async function installMockWebSocket(page: Parameters<typeof test>[0]['page']) {
  await page.addInitScript(() => {
    class MockWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      readyState = MockWebSocket.CONNECTING
      onopen: ((event: Event) => void) | null = null
      onmessage: ((event: MessageEvent) => void) | null = null
      onerror: ((event: Event) => void) | null = null
      onclose: ((event: CloseEvent) => void) | null = null

      constructor() {
        window.setTimeout(() => {
          this.readyState = MockWebSocket.OPEN
          this.onopen?.(new Event('open'))
        }, 0)
      }

      close() {
        this.readyState = MockWebSocket.CLOSED
        this.onclose?.(new CloseEvent('close'))
      }

      send() {}
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })
}

async function installRuntimeCatalogMocks(page: Parameters<typeof test>[0]['page']) {
  let pluginListCalls = 0
  let pluginInstallCalls = 0
  let pluginReadCalls = 0
  let pluginUninstallCalls = 0
  let pluginState: PluginItem = {
    id: 'plugin-acme',
    name: 'Acme Plugin',
    description: 'Adds curated Acme workflow actions.',
    marketplaceName: 'Curated Marketplace',
    marketplacePath: 'marketplace://curated',
    installed: false,
    enabled: false,
    authPolicy: 'never',
    installPolicy: 'allowed',
    sourceType: 'marketplace',
    sourcePath: 'marketplace://curated/acme',
    capabilities: ['search', 'actions'],
    category: 'productivity',
  }

  await installMockWebSocket(page)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname } = url

    const fulfill = async (data: unknown) =>
      route.fulfill({
        body: JSON.stringify({ data }),
        contentType: 'application/json',
        status: 200,
      })
    if (pathname === '/api/notifications') {
      return fulfill([])
    }

    if (pathname === '/api/workspaces') {
      return fulfill([
        {
          createdAt: buildIsoDate(-120),
          id: WORKSPACE_ID,
          name: 'Playwright Workspace',
          rootPath: 'E:/projects/ai/codex-server',
          runtimeStatus: 'ready',
          updatedAt: buildIsoDate(0),
        },
      ])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/models`) {
      return fulfill([
        {
          description: 'Playwright runtime model',
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          value: 'gpt-5.4',
        },
      ])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/skills`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/apps`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/plugins`) {
      pluginListCalls += 1
      return fulfill({
        plugins: [{ ...pluginState }],
        remoteSyncError: null,
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/plugins/read`) {
      pluginReadCalls += 1
      return fulfill({
        plugin: {
          apps: [],
          description: 'Acme Plugin browser detail',
          marketplaceName: pluginState.marketplaceName,
          marketplacePath: pluginState.marketplacePath,
          mcpServers: ['acme-mcp'],
          skills: [],
          summary: {
            authPolicy: pluginState.authPolicy,
            enabled: pluginState.enabled,
            id: pluginState.id,
            installed: pluginState.installed,
            installPolicy: pluginState.installPolicy,
            name: pluginState.name,
          },
        },
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/plugins/install`) {
      pluginInstallCalls += 1
      pluginState = {
        ...pluginState,
        enabled: true,
        installed: true,
      }
      return fulfill({
        appsNeedingAuth: [],
        authPolicy: 'never',
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/plugins/uninstall`) {
      pluginUninstallCalls += 1
      pluginState = {
        ...pluginState,
        enabled: false,
        installed: false,
      }
      return fulfill({
        status: 'ok',
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/collaboration-modes`) {
      return fulfill([])
    }

    return fulfill([])
  })

  return {
    getPluginInstallCalls: () => pluginInstallCalls,
    getPluginListCalls: () => pluginListCalls,
    getPluginReadCalls: () => pluginReadCalls,
    getPluginUninstallCalls: () => pluginUninstallCalls,
  }
}

async function installThreadPageMocks(page: Parameters<typeof test>[0]['page']) {
  let shellCommandCalls = 0
  let turnStartCalls = 0
  const shellCommandBodies: Array<Record<string, unknown>> = []

  await installMockWebSocket(page)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname } = url

    const fulfill = async (data: unknown) =>
      route.fulfill({
        body: JSON.stringify({ data }),
        contentType: 'application/json',
        status: 200,
      })

    if (pathname === '/api/notifications') {
      return fulfill([])
    }

    if (pathname === '/api/workspaces') {
      return fulfill([
        {
          createdAt: buildIsoDate(-120),
          id: WORKSPACE_ID,
          name: 'Playwright Workspace',
          rootPath: 'E:/projects/ai/codex-server',
          runtimeStatus: 'ready',
          updatedAt: buildIsoDate(0),
        },
      ])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}`) {
      return fulfill({
        createdAt: buildIsoDate(-120),
        id: WORKSPACE_ID,
        name: 'Playwright Workspace',
        rootPath: 'E:/projects/ai/codex-server',
        runtimeStatus: 'ready',
        updatedAt: buildIsoDate(0),
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/runtime-state`) {
      return fulfill({
        command: 'codex-server',
        configLoadStatus: 'loaded',
        restartRequired: false,
        rootPath: 'E:/projects/ai/codex-server',
        startedAt: buildIsoDate(-30),
        status: 'ready',
        updatedAt: buildIsoDate(0),
        workspaceId: WORKSPACE_ID,
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/account`) {
      return fulfill({
        email: 'vince@example.com',
        id: 'acct-1',
        lastSyncedAt: buildIsoDate(0),
        status: 'active',
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/account/rate-limits`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads`) {
      return fulfill([
        {
          archived: false,
          createdAt: buildIsoDate(-90),
          id: THREAD_ID,
          messageCount: 1,
          name: 'Bang shortcut thread',
          status: 'completed',
          turnCount: 1,
          updatedAt: buildIsoDate(0),
          workspaceId: WORKSPACE_ID,
        },
      ])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads/loaded`) {
      return fulfill([THREAD_ID])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/models`) {
      return fulfill([
        {
          description: 'Playwright runtime model',
          id: 'gpt-5.4',
          name: 'GPT-5.4',
          value: 'gpt-5.4',
        },
      ])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/skills`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/collaboration-modes`) {
      return fulfill([
        {
          description: 'Planning mode',
          id: 'plan',
          mode: 'plan',
          name: 'Plan',
        },
      ])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/pending-approvals`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/config/read`) {
      return fulfill({
        config: {},
        origins: {},
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`) {
      return fulfill({
        archived: false,
        createdAt: buildIsoDate(-90),
        cwd: 'E:/projects/ai/codex-server',
        hasMoreTurns: false,
        id: THREAD_ID,
        messageCount: 1,
        name: 'Bang shortcut thread',
        preview: 'thread shortcut preview',
        status: 'completed',
        turnCount: 1,
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'item-1',
                text: 'Existing assistant reply',
                type: 'agentMessage',
              },
            ],
            status: 'completed',
          },
        ],
        updatedAt: buildIsoDate(0),
        workspaceId: WORKSPACE_ID,
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}/shell-command`) {
      shellCommandCalls += 1
      shellCommandBodies.push(JSON.parse(route.request().postData() ?? '{}'))
      return fulfill({ status: 'queued' })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}/turns`) {
      turnStartCalls += 1
      return fulfill({ status: 'running', turnId: 'turn-new' })
    }

    return fulfill([])
  })

  return {
    getShellCommandBodies: () => shellCommandBodies,
    getShellCommandCalls: () => shellCommandCalls,
    getTurnStartCalls: () => turnStartCalls,
  }
}

test('runtime page supports plugin row actions and refreshes plugin state', async ({ page }) => {
  const runtimeHarness = await installRuntimeCatalogMocks(page)

  await page.goto('/runtime')
  await expect(page.getByText('Runtime tools')).toBeVisible()

  const pluginRow = page.locator('.runtime-item').filter({ hasText: 'Acme Plugin' })
  await expect(pluginRow).toContainText('Not installed')
  await expect(pluginRow).toContainText('Disabled')

  await pluginRow.getByRole('button', { name: 'Read' }).click()
  await expect.poll(() => runtimeHarness.getPluginReadCalls()).toBe(1)
  await expect(page.getByLabel('Marketplace path')).toHaveValue('marketplace://curated')
  await expect(page.getByLabel('Plugin name')).toHaveValue('Acme Plugin')
  await expect(page.locator('.mode-console__output')).toContainText('"mcpServers"')

  await pluginRow.getByRole('button', { name: 'Install' }).click()
  await expect.poll(() => runtimeHarness.getPluginInstallCalls()).toBe(1)
  await expect.poll(() => runtimeHarness.getPluginListCalls()).toBeGreaterThan(1)
  await expect(pluginRow).toContainText('Installed')
  await expect(pluginRow).toContainText('Enabled')

  await pluginRow.getByRole('button', { name: 'Uninstall' }).click()
  await expect.poll(() => runtimeHarness.getPluginUninstallCalls()).toBe(1)
  await expect.poll(() => runtimeHarness.getPluginListCalls()).toBeGreaterThan(2)
  await expect(pluginRow).toContainText('Not installed')
  await expect(pluginRow).toContainText('Disabled')
  await expect(page.getByLabel('Plugin ID')).toHaveValue('plugin-acme')
})

test('thread composer routes bang commands to thread shell command instead of turn start', async ({ page }) => {
  const threadHarness = await installThreadPageMocks(page)

  await page.goto(`/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  const textarea = page.locator('textarea')
  await textarea.waitFor()

  await textarea.fill('!pwd')
  await expect(
    page.getByText('This input will run through thread/shellCommand with unsandboxed full access.'),
  ).toBeVisible()

  await textarea.press('Enter')

  await expect.poll(() => threadHarness.getShellCommandCalls()).toBe(1)
  await expect.poll(() => threadHarness.getTurnStartCalls()).toBe(0)
  await expect(textarea).toHaveValue('')
  expect(threadHarness.getShellCommandBodies()).toEqual([{ command: 'pwd' }])
})
