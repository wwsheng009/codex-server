const assert = require('node:assert/strict')
const { chromium } = require('playwright')

const WORKSPACE_ID = 'ws-1'
const THREAD_ID = 'thread-1'
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:4173'

function buildIsoDate(offsetMinutes) {
  const base = new Date('2026-03-27T08:00:00.000Z')
  base.setMinutes(base.getMinutes() + offsetMinutes)
  return base.toISOString()
}

async function installMockWebSocket(page) {
  await page.addInitScript(() => {
    class MockWebSocket {
      static CONNECTING = 0
      static OPEN = 1
      static CLOSING = 2
      static CLOSED = 3

      constructor() {
        this.readyState = MockWebSocket.CONNECTING
        this.onopen = null
        this.onmessage = null
        this.onerror = null
        this.onclose = null

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

    window.WebSocket = MockWebSocket
  })
}

async function installRuntimeCatalogMocks(page) {
  let pluginListCalls = 0
  let pluginInstallCalls = 0
  let pluginReadCalls = 0
  let pluginUninstallCalls = 0
  let pluginState = {
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

    const fulfill = async (data) =>
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

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/skills/remote/list`) {
      return fulfill({ data: [] })
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

async function installThreadPageMocks(page) {
  let shellCommandCalls = 0
  let turnStartCalls = 0
  const shellCommandBodies = []

  await installMockWebSocket(page)
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname } = url

    const fulfill = async (data) =>
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

async function runRuntimeScenario(browser) {
  const page = await browser.newPage()
  const runtimeHarness = await installRuntimeCatalogMocks(page)

  await page.goto(`${BASE_URL}/runtime`)
  await page.getByText('Runtime tools').waitFor({ timeout: 30_000 })

  const pluginRow = page.locator('.runtime-item').filter({ hasText: 'Acme Plugin' })
  await assertTextContains(pluginRow, 'Not installed')
  await assertTextContains(pluginRow, 'Disabled')

  await pluginRow.getByRole('button', { name: 'Read' }).click()
  await waitForCount(runtimeHarness.getPluginReadCalls, 1)
  await assertInputValue(page, 'Marketplace path', 'marketplace://curated')
  await assertInputValue(page, 'Plugin name', 'Acme Plugin')
  await assertLocatorContains(page.locator('.mode-console__output'), '"mcpServers"')

  await pluginRow.getByRole('button', { name: 'Install' }).click()
  await waitForCount(runtimeHarness.getPluginInstallCalls, 1)
  await waitForCount(runtimeHarness.getPluginListCalls, 2)
  await assertTextContains(pluginRow, 'Installed')
  await assertTextContains(pluginRow, 'Enabled')

  await pluginRow.getByRole('button', { name: 'Uninstall' }).click()
  await waitForCount(runtimeHarness.getPluginUninstallCalls, 1)
  await waitForCount(runtimeHarness.getPluginListCalls, 3)
  await assertTextContains(pluginRow, 'Not installed')
  await assertTextContains(pluginRow, 'Disabled')
  await assertInputValue(page, 'Plugin ID', 'plugin-acme')

  await page.close()

  return {
    pluginInstallCalls: runtimeHarness.getPluginInstallCalls(),
    pluginListCalls: runtimeHarness.getPluginListCalls(),
    pluginReadCalls: runtimeHarness.getPluginReadCalls(),
    pluginUninstallCalls: runtimeHarness.getPluginUninstallCalls(),
  }
}

async function runThreadScenario(browser) {
  const page = await browser.newPage()
  const threadHarness = await installThreadPageMocks(page)

  await page.goto(`${BASE_URL}/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  const textarea = page.locator('textarea')
  await textarea.waitFor({ timeout: 30_000 })

  await textarea.fill('!pwd')
  await assertLocatorContains(
    page.getByText('This input will run through thread/shellCommand with unsandboxed full access.'),
    'thread/shellCommand',
  )
  await textarea.press('Enter')

  await waitForCount(threadHarness.getShellCommandCalls, 1)
  assert.equal(threadHarness.getTurnStartCalls(), 0)
  assert.deepEqual(threadHarness.getShellCommandBodies(), [{ command: 'pwd' }])

  const value = await textarea.inputValue()
  assert.equal(value, '')

  await page.close()

  return {
    shellCommandBodies: threadHarness.getShellCommandBodies(),
    shellCommandCalls: threadHarness.getShellCommandCalls(),
    turnStartCalls: threadHarness.getTurnStartCalls(),
  }
}

async function assertTextContains(locator, value) {
  const startedAt = Date.now()
  while (true) {
    const text = await locator.textContent()
    if (text && text.includes(value)) {
      return
    }
    if (Date.now() - startedAt > 10_000) {
      throw new Error(`Timed out waiting for text "${value}"`)
    }
    await locator.page().waitForTimeout(100)
  }
}

async function assertLocatorContains(locator, value) {
  const startedAt = Date.now()
  while (true) {
    const text = await locator.textContent()
    if (text && text.includes(value)) {
      return
    }
    if (Date.now() - startedAt > 10_000) {
      throw new Error(`Timed out waiting for locator text "${value}"`)
    }
    await locator.page().waitForTimeout(100)
  }
}

async function assertInputValue(page, label, expected) {
  const locator = page.getByLabel(label)
  const startedAt = Date.now()
  while (true) {
    const value = await locator.inputValue()
    if (value === expected) {
      return
    }
    if (Date.now() - startedAt > 10_000) {
      throw new Error(`Timed out waiting for ${label} to equal "${expected}", got "${value}"`)
    }
    await page.waitForTimeout(100)
  }
}

async function waitForCount(getter, expected) {
  const startedAt = Date.now()
  while (getter() < expected) {
    if (Date.now() - startedAt > 10_000) {
      throw new Error(`Timed out waiting for count ${expected}, got ${getter()}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  try {
    const runtime = await runRuntimeScenario(browser)
    const thread = await runThreadScenario(browser)

    console.log(JSON.stringify({ runtime, thread }, null, 2))
  } finally {
    await browser.close()
  }
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
