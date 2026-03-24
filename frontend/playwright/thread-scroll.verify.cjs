const { chromium } = require('playwright')
const fs = require('node:fs/promises')
const path = require('node:path')

const WORKSPACE_ID = 'ws-1'
const THREAD_ID = 'thread-1'

function buildIsoDate(offsetMinutes) {
  const base = new Date('2026-03-23T10:00:00.000Z')
  base.setMinutes(base.getMinutes() + offsetMinutes)
  return base.toISOString()
}

function buildTurns(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => {
    const number = start + index
    return {
      id: `turn-${number}`,
      items: [
        {
          id: `item-${number}`,
          text: Array.from(
            { length: 8 },
            (_, line) =>
              `Turn ${number} line ${line} keeps the thread page tall for scroll verification.`,
          ).join('\n'),
          type: 'agentMessage',
        },
      ],
      status: 'completed',
    }
  })
}

async function installThreadPageMocks(page) {
  const initialTurns = buildTurns(80, 159)
  const historicalTurns = buildTurns(0, 79)

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

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname, searchParams } = url

    const fulfill = async (data) =>
      route.fulfill({
        body: JSON.stringify({ data }),
        contentType: 'application/json',
        status: 200,
      })

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

    if (pathname === '/api/notifications') {
      return fulfill([])
    }

    if (pathname === '/api/workspaces') {
      return fulfill([
        {
          createdAt: buildIsoDate(-180),
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
        createdAt: buildIsoDate(-180),
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
        startedAt: buildIsoDate(-60),
        status: 'ready',
        updatedAt: buildIsoDate(0),
        workspaceId: WORKSPACE_ID,
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads`) {
      return fulfill([
        {
          archived: false,
          createdAt: buildIsoDate(-180),
          id: THREAD_ID,
          messageCount: 160,
          name: 'Scroll investigation',
          status: 'completed',
          turnCount: 160,
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
          description: 'Playwright model',
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
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/pending-approvals`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/commands`) {
      return fulfill([])
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/config/read`) {
      return fulfill({
        config: {},
        origins: {},
      })
    }

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`) {
      const beforeTurnId = searchParams.get('beforeTurnId')
      if (beforeTurnId) {
        await new Promise((resolve) => setTimeout(resolve, 450))
        return fulfill({
          archived: false,
          createdAt: buildIsoDate(-180),
          cwd: 'E:/projects/ai/codex-server',
          hasMoreTurns: false,
          id: THREAD_ID,
          messageCount: 160,
          name: 'Scroll investigation',
          preview: 'Playwright thread detail',
          status: 'completed',
          turnCount: 160,
          turns: historicalTurns,
          updatedAt: buildIsoDate(0),
          workspaceId: WORKSPACE_ID,
        })
      }

      return fulfill({
        archived: false,
        createdAt: buildIsoDate(-180),
        cwd: 'E:/projects/ai/codex-server',
        hasMoreTurns: true,
        id: THREAD_ID,
        messageCount: 160,
        name: 'Scroll investigation',
        preview: 'Playwright thread detail',
        status: 'completed',
        turnCount: 160,
        turns: initialTurns,
        updatedAt: buildIsoDate(0),
        workspaceId: WORKSPACE_ID,
      })
    }

    return fulfill([])
  })
}

async function enableScrollDiagnostics(page) {
  await page.evaluate(async () => {
    const profiler = await import('/src/components/workspace/threadConversationProfiler.tsx')
    profiler.resetConversationRenderProfiler()
    profiler.setConversationScrollDiagnosticsEnabled(true)
  })
}

async function exportScrollDiagnostics(page, outputPath) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    page.evaluate(async () => {
      const profiler = await import('/src/components/workspace/threadConversationProfiler.tsx')
      profiler.exportConversationRenderProfilerAnalysis()
    }),
  ])

  await download.saveAs(outputPath)
  const content = await fs.readFile(outputPath, 'utf8')
  return JSON.parse(content)
}

function summarizeScrollDiagnostics(payload) {
  const events = payload.scrollDiagnostics?.events ?? []
  const firstUserIntentTs =
    events.find((event) => event.source === 'mark-user-scroll-intent')?.ts ?? null
  const programmaticEvents = events.filter((event) => event.kind === 'programmatic-scroll')

  return {
    layoutChangeCount: payload.scrollDiagnostics?.summary?.layoutChangeCount ?? 0,
    programmaticAfterUserIntentSources:
      firstUserIntentTs === null
        ? []
        : programmaticEvents
            .filter((event) => event.ts >= firstUserIntentTs)
            .map((event) => event.source),
    programmaticEvents,
    topSources: payload.scrollDiagnostics?.summary?.topSources ?? [],
    totalEvents: events.length,
  }
}

async function run() {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 1440, height: 960 },
  })

  await installThreadPageMocks(page)

  await page.goto(`http://127.0.0.1:4173/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  await page.locator('.workbench-log__viewport').waitFor({ timeout: 30_000 })

  await enableScrollDiagnostics(page)

  await page.locator('textarea').fill(
    Array.from({ length: 8 }, (_, index) => `Composer growth line ${index + 1}`).join('\n'),
  )
  await page.waitForTimeout(300)

  const viewport = page.locator('.workbench-log__viewport')
  await viewport.hover()
  for (let index = 0; index < 18; index += 1) {
    await page.mouse.wheel(0, -1200)
    await page.waitForTimeout(30)
  }
  for (let index = 0; index < 8; index += 1) {
    await page.mouse.wheel(0, -400)
    await page.waitForTimeout(60)
  }

  await page.waitForTimeout(1_000)

  const outputPath = path.join(process.cwd(), 'playwright-thread-scroll-diagnostics.json')
  const payload = await exportScrollDiagnostics(page, outputPath)
  const summary = summarizeScrollDiagnostics(payload)

  await browser.close()

  console.log(JSON.stringify(summary, null, 2))
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
