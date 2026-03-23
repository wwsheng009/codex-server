import { expect, test } from '@playwright/test'
import { promises as fs } from 'node:fs'

const WORKSPACE_ID = 'ws-1'
const THREAD_ID = 'thread-1'

type ScrollSummary = {
  programmaticAfterUserIntentSources: string[]
  programmaticSources: string[]
  topSources: Array<{ count: number; source: string }>
  totalEvents: number
}

function buildIsoDate(offsetMinutes: number) {
  const base = new Date('2026-03-23T10:00:00.000Z')
  base.setMinutes(base.getMinutes() + offsetMinutes)
  return base.toISOString()
}

function buildTurns(start: number, end: number) {
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

async function installThreadPageMocks(page: Parameters<typeof test>[0]['page']) {
  const initialTurns = buildTurns(80, 159)
  const historicalTurns = buildTurns(0, 79)

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

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname, searchParams } = url

    const fulfill = async (data: unknown) =>
      route.fulfill({
        body: JSON.stringify({ data }),
        contentType: 'application/json',
        status: 200,
      })

    if (pathname === '/api/account') {
      return fulfill({
        email: 'vince@example.com',
        id: 'acct-1',
        lastSyncedAt: buildIsoDate(0),
        status: 'active',
      })
    }

    if (pathname === '/api/account/rate-limits') {
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

async function enableScrollDiagnostics(page: Parameters<typeof test>[0]['page']) {
  await page.evaluate(async () => {
    const profiler = await import('/src/components/workspace/threadConversationProfiler.tsx')
    profiler.resetConversationRenderProfiler()
    profiler.setConversationScrollDiagnosticsEnabled(true)
  })
}

async function exportScrollDiagnostics(
  page: Parameters<typeof test>[0]['page'],
  outputPath: string,
) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate(async () => {
      const profiler = await import('/src/components/workspace/threadConversationProfiler.tsx')
      profiler.exportConversationRenderProfilerAnalysis()
    }),
  ])

  await download.saveAs(outputPath)
  const content = await fs.readFile(outputPath, 'utf8')
  return JSON.parse(content)
}

async function measureThreadBottomClearance(
  page: Parameters<typeof test>[0]['page'],
) {
  return page.evaluate(() => {
    const workbenchLog = document.querySelector('.workbench-log')
    const viewport = document.querySelector('.workbench-log__viewport')
    const composerShell = document.querySelector('.composer-dock__shell')
    const composerForm = document.querySelector('.composer-dock--workbench')
    const anchor = document.querySelector('.workbench-log__bottom-anchor')

    if (
      !(workbenchLog instanceof HTMLElement) ||
      !(viewport instanceof HTMLElement) ||
      !(composerShell instanceof HTMLElement) ||
      !(composerForm instanceof HTMLElement) ||
      !(anchor instanceof HTMLElement)
    ) {
      throw new Error('Expected thread viewport, composer shell, and bottom anchor')
    }

    const clearancePx = Number.parseFloat(
      getComputedStyle(workbenchLog).getPropertyValue('--thread-bottom-clearance'),
    )
    const shellRect = composerShell.getBoundingClientRect()
    const formRect = composerForm.getBoundingClientRect()
    const anchorRect = anchor.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()

    return {
      anchorBottomToComposerTop: Number((formRect.top - anchorRect.bottom).toFixed(2)),
      clearancePx: Number(clearancePx.toFixed(2)),
      composerFormHeight: Number(formRect.height.toFixed(2)),
      composerShellHeight: Number(shellRect.height.toFixed(2)),
      gapToViewportBottom: Number((viewportRect.bottom - anchorRect.bottom).toFixed(2)),
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
    }
  })
}

function summarizeScrollDiagnostics(payload: any): ScrollSummary {
  const events = payload.scrollDiagnostics?.events ?? []
  const firstUserIntentTs =
    events.find((event: any) => event.source === 'mark-user-scroll-intent')?.ts ?? null
  const programmaticEvents = events.filter((event: any) => event.kind === 'programmatic-scroll')

  return {
    programmaticAfterUserIntentSources:
      firstUserIntentTs === null
        ? []
        : programmaticEvents
            .filter((event: any) => event.ts >= firstUserIntentTs)
            .map((event: any) => event.source),
    programmaticSources: programmaticEvents.map((event: any) => event.source),
    topSources: payload.scrollDiagnostics?.summary?.topSources ?? [],
    totalEvents: events.length,
  }
}

test('captures thread scroll diagnostics in a real browser scenario', async ({ page }, testInfo) => {
  await installThreadPageMocks(page)

  await page.goto(`/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  await page.locator('.workbench-log__viewport').waitFor()
  await expect(page.locator('.conversation-stream')).not.toHaveText('')

  await enableScrollDiagnostics(page)

  const viewport = page.locator('.workbench-log__viewport')
  await page.locator('textarea').fill('short baseline')
  await page.waitForTimeout(300)
  await viewport.evaluate((element) => {
    element.scrollTo({
      top: element.scrollHeight,
      behavior: 'auto',
    })
  })
  await page.waitForTimeout(300)
  const beforeClearance = await measureThreadBottomClearance(page)
  await page.locator('textarea').fill(
    Array.from({ length: 8 }, (_, index) => `Composer growth line ${index + 1}`).join('\n'),
  )
  await page.waitForTimeout(300)
  const afterClearance = await measureThreadBottomClearance(page)

  await testInfo.attach('thread-clearance-measurements.json', {
    body: JSON.stringify(
      {
        after: afterClearance,
        before: beforeClearance,
        deltas: {
          anchorBottomToComposerTop: Number(
            (
              afterClearance.anchorBottomToComposerTop - beforeClearance.anchorBottomToComposerTop
            ).toFixed(2),
          ),
          clearancePx: Number((afterClearance.clearancePx - beforeClearance.clearancePx).toFixed(2)),
          composerFormHeight: Number(
            (afterClearance.composerFormHeight - beforeClearance.composerFormHeight).toFixed(2),
          ),
          composerShellHeight: Number(
            (afterClearance.composerShellHeight - beforeClearance.composerShellHeight).toFixed(2),
          ),
          gapToViewportBottom: Number(
            (afterClearance.gapToViewportBottom - beforeClearance.gapToViewportBottom).toFixed(2),
          ),
          scrollTop: Number((afterClearance.scrollTop - beforeClearance.scrollTop).toFixed(2)),
        },
      },
      null,
      2,
    ),
    contentType: 'application/json',
  })

  expect(afterClearance.clearancePx).toBeGreaterThan(beforeClearance.clearancePx)
  expect(afterClearance.clearancePx).toBeCloseTo(
    afterClearance.composerShellHeight + 16,
    0,
  )
  expect(afterClearance.anchorBottomToComposerTop).toBeCloseTo(16, 0)
  expect(afterClearance.scrollTop).toBeGreaterThan(beforeClearance.scrollTop)

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

  const diagnosticsPath = testInfo.outputPath('thread-scroll-diagnostics.json')
  const payload = await exportScrollDiagnostics(page, diagnosticsPath)
  const summary = summarizeScrollDiagnostics(payload)

  await testInfo.attach('thread-scroll-summary.json', {
    body: JSON.stringify(summary, null, 2),
    contentType: 'application/json',
  })

  expect(summary.totalEvents).toBeGreaterThan(0)
  expect(summary.programmaticSources).toEqual(
    expect.arrayContaining([
      'bottom-clearance-change',
      'older-turn-restore',
      'stop-auto-scroll',
    ]),
  )
  expect(summary.programmaticAfterUserIntentSources).toContain('older-turn-restore')
})
