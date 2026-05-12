import { expect, test } from '@playwright/test'

const WORKSPACE_ID = 'ws-1'
const THREAD_ID = 'thread-1'

declare global {
  interface Window {
    __workspaceStreamSockets?: Array<{
      emitServerEvent: (event: unknown) => void
      readyState: number
    }>
  }
}

function buildIsoDate(offsetMinutes: number) {
  const base = new Date('2026-03-28T10:00:00.000Z')
  base.setMinutes(base.getMinutes() + offsetMinutes)
  return base.toISOString()
}

async function installThreadPageMocks(page: Parameters<typeof test>[0]['page']) {
  const apiRequests: Array<{ method: string; pathname: string }> = []
  let threadDetailRequests = 0
  const turnStartBodies: Array<Record<string, unknown>> = []

  await page.addInitScript(() => {
    window.localStorage.clear()

    Object.defineProperty(window, 'BroadcastChannel', {
      configurable: true,
      value: undefined,
    })

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
        window.__workspaceStreamSockets = window.__workspaceStreamSockets ?? []
        window.__workspaceStreamSockets.push(this)
        window.setTimeout(() => {
          if (this.readyState !== MockWebSocket.CONNECTING) {
            return
          }

          this.readyState = MockWebSocket.OPEN
          this.onopen?.(new Event('open'))
        }, 0)
      }

      close() {
        if (this.readyState === MockWebSocket.CLOSED) {
          return
        }

        this.readyState = MockWebSocket.CLOSED
        this.onclose?.(new CloseEvent('close'))
      }

      emitServerEvent(event: unknown) {
        if (this.readyState !== MockWebSocket.OPEN) {
          throw new Error('Cannot emit to a closed workspace stream socket')
        }

        this.onmessage?.(
          new MessageEvent('message', {
            data: JSON.stringify(event),
          }),
        )
      }

      send() {}
    }

    window.WebSocket = MockWebSocket as unknown as typeof WebSocket
  })

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    const { pathname } = url
    apiRequests.push({
      method: route.request().method(),
      pathname,
    })

    const fulfill = async (data: unknown) =>
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
      return fulfill({
        data: [
          {
            archived: false,
            createdAt: buildIsoDate(-180),
            id: THREAD_ID,
            messageCount: 1,
            name: 'Realtime recovery thread',
            status: 'completed',
            turnCount: 1,
            updatedAt: buildIsoDate(0),
            workspaceId: WORKSPACE_ID,
          },
        ],
        nextCursor: null,
      })
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
      threadDetailRequests += 1
      return fulfill({
        archived: false,
        createdAt: buildIsoDate(-180),
        cwd: 'E:/projects/ai/codex-server',
        hasMoreTurns: false,
        id: THREAD_ID,
        messageCount: 1,
        name: 'Realtime recovery thread',
        preview: 'Thread baseline response',
        status: 'completed',
        turnCount: 1,
        turns: [
          {
            id: 'turn-1',
            items: [
              {
                id: 'item-1',
                text: 'Thread baseline response',
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

    if (pathname === `/api/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}/turns`) {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      turnStartBodies.push(body)
      return route.fulfill({
        body: JSON.stringify({
          error: {
            message: 'Simulated stale HTTP turn start failure',
          },
        }),
        contentType: 'application/json',
        status: 500,
      })
    }

    return fulfill([])
  })

  return {
    getApiRequests: () => apiRequests,
    getThreadDetailRequests: () => threadDetailRequests,
    getTurnStartBodies: () => turnStartBodies,
  }
}

test('thread page surfaces realtime recovery status after a workspace stream sequence gap', async ({
  page,
}) => {
  await installThreadPageMocks(page)

  await page.goto(`/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  await expect(page.getByText('Thread baseline response')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.__workspaceStreamSockets?.length ?? 0))
    .toBeGreaterThan(0)

  await page.evaluate(({ workspaceId }) => {
    const socket = window.__workspaceStreamSockets?.find(
      (candidate) =>
        candidate.readyState === 1 &&
        Boolean((candidate as typeof candidate & { onmessage?: unknown }).onmessage),
    )
    if (!socket) {
      throw new Error('Expected workspace stream socket')
    }

    socket.emitServerEvent({
      method: 'workspace/connected',
      payload: {
        headSeq: 1,
        oldestSeq: 1,
      },
      seq: 1,
      ts: '2026-03-28T10:00:04.000Z',
      workspaceId,
    })
  }, {
    workspaceId: WORKSPACE_ID,
  })

  await expect
    .poll(() =>
      page.evaluate(async ({ workspaceId }) => {
        const sessionModule = await import('/src/stores/session-store.ts')
        return sessionModule.useSessionStore.getState().lastEventSeqByWorkspace[
          workspaceId
        ] ?? 0
      }, {
        workspaceId: WORKSPACE_ID,
      }),
    )
    .toBe(1)

  await page.evaluate(({ threadId, workspaceId }) => {
    const socket = window.__workspaceStreamSockets?.find(
      (candidate) =>
        candidate.readyState === 1 &&
        Boolean((candidate as typeof candidate & { onmessage?: unknown }).onmessage),
    )
    if (!socket) {
      throw new Error('Expected workspace stream socket')
    }

    socket.emitServerEvent({
      method: 'item/agentMessage/delta',
      payload: {
        delta: 'late delta',
        itemId: 'item-live',
      },
      seq: 3,
      threadId,
      ts: '2026-03-28T10:00:05.000Z',
      turnId: 'turn-live',
      workspaceId,
    })

  }, {
    threadId: THREAD_ID,
    workspaceId: WORKSPACE_ID,
  })

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const streamModule = await import('/src/hooks/useWorkspaceStream.ts')
        return streamModule
          .getWorkspaceStreamManagerDiagnosticsSnapshot()
          .streams[0]?.recentLifecycleEvents.map((event) => event.kind) ?? []
      }),
    )
    .toContain('seq-gap-detected')

  const recoveryNotice = page.locator('.notice').filter({
    hasText: /Realtime sync (is reconnecting|is recovering|recovered)/,
  })
  await expect(recoveryNotice).toBeVisible()
  await expect(recoveryNotice).toContainText(/workspace and thread events|render normally/)
  await expect(recoveryNotice.getByText('Copy details')).toBeVisible()
})

test('thread page refreshes snapshots and surfaces snapshot fallback recovery status after a replay retention gap', async ({
  page,
}) => {
  const harness = await installThreadPageMocks(page)

  await page.goto(`/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  await expect(page.getByText('Thread baseline response')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.__workspaceStreamSockets?.length ?? 0))
    .toBeGreaterThan(0)

  const initialThreadDetailRequests = harness.getThreadDetailRequests()

  await page.evaluate(({ workspaceId }) => {
    const socket = window.__workspaceStreamSockets?.find(
      (candidate) =>
        candidate.readyState === 1 &&
        Boolean((candidate as typeof candidate & { onmessage?: unknown }).onmessage),
    )
    if (!socket) {
      throw new Error('Expected workspace stream socket')
    }

    socket.emitServerEvent({
      method: 'workspace/connected',
      payload: {
        headSeq: 1,
        oldestSeq: 1,
      },
      seq: 1,
      ts: '2026-03-28T10:00:04.000Z',
      workspaceId,
    })
    socket.emitServerEvent({
      method: 'workspace/replay/completed',
      payload: {
        afterSeq: 0,
        complete: false,
        fromSeq: 3,
        headSeq: 1,
        limit: 2000,
        nextAfterSeq: 1,
        oldestSeq: 3,
        replayed: 0,
        toSeq: 1,
      },
      ts: '2026-03-28T10:00:05.000Z',
      workspaceId,
    })
  }, {
    workspaceId: WORKSPACE_ID,
  })

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const streamModule = await import('/src/hooks/useWorkspaceStream.ts')
        return streamModule
          .getWorkspaceStreamManagerDiagnosticsSnapshot()
          .streams[0]?.recentLifecycleEvents.map((event) => event.kind) ?? []
      }),
    )
    .toContain('snapshot-fallback-requested')

  const snapshotNotice = page.locator('.notice').filter({
    hasText: 'Realtime sync refreshed from snapshots',
  })
  await expect(snapshotNotice).toBeVisible()
  await expect(snapshotNotice).toContainText('snapshots were refreshed')

  await expect
    .poll(() => harness.getThreadDetailRequests(), {
      timeout: 5_000,
    })
    .toBeGreaterThan(initialThreadDetailRequests)
})

test('thread page surfaces recovery status when the backend reports dropped workspace events', async ({
  page,
}) => {
  await installThreadPageMocks(page)

  await page.goto(`/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  await expect(page.getByText('Thread baseline response')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.__workspaceStreamSockets?.length ?? 0))
    .toBeGreaterThan(0)

  await page.evaluate(({ workspaceId }) => {
    const socket = window.__workspaceStreamSockets?.find(
      (candidate) =>
        candidate.readyState === 1 &&
        Boolean((candidate as typeof candidate & { onmessage?: unknown }).onmessage),
    )
    if (!socket) {
      throw new Error('Expected workspace stream socket')
    }

    socket.emitServerEvent({
      method: 'workspace/connected',
      payload: {
        headSeq: 1,
        oldestSeq: 1,
      },
      seq: 1,
      ts: '2026-03-28T10:00:04.000Z',
      workspaceId,
    })
    socket.emitServerEvent({
      method: 'workspace/events/dropped',
      payload: {
        droppedMethod: 'item/agentMessage/delta',
        fromSeq: 2,
        reason: 'soft',
        seq: 3,
        toSeq: 3,
      },
      seq: 3,
      ts: '2026-03-28T10:00:05.000Z',
      workspaceId,
    })
  }, {
    workspaceId: WORKSPACE_ID,
  })

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const streamModule = await import('/src/hooks/useWorkspaceStream.ts')
        return streamModule
          .getWorkspaceStreamManagerDiagnosticsSnapshot()
          .streams[0]?.recentLifecycleEvents.map((event) => event.kind) ?? []
      }),
    )
    .toContain('events-dropped')

  const recoveryNotice = page.locator('.notice').filter({
    hasText: /Realtime sync (is reconnecting|is recovering|recovered)/,
  })
  await expect(recoveryNotice).toBeVisible()
  await expect(recoveryNotice).toContainText(/workspace and thread events|render normally/)
})

test('thread composer suppresses a stale HTTP send error when the stream already started the turn', async ({
  page,
}) => {
  const harness = await installThreadPageMocks(page)

  await page.goto(`/workspaces/${WORKSPACE_ID}/threads/${THREAD_ID}`)
  await expect(page.getByText('Thread baseline response')).toBeVisible()
  await expect
    .poll(() => page.evaluate(() => window.__workspaceStreamSockets?.length ?? 0))
    .toBeGreaterThan(0)

  await page.evaluate(({ workspaceId }) => {
    const socket = window.__workspaceStreamSockets?.find(
      (candidate) =>
        candidate.readyState === 1 &&
        Boolean((candidate as typeof candidate & { onmessage?: unknown }).onmessage),
    )
    if (!socket) {
      throw new Error('Expected workspace stream socket')
    }

    socket.emitServerEvent({
      method: 'workspace/connected',
      payload: {
        headSeq: 1,
        oldestSeq: 1,
      },
      seq: 1,
      ts: '2026-03-28T10:00:04.000Z',
      workspaceId,
    })
  }, {
    workspaceId: WORKSPACE_ID,
  })

  const textarea = page.locator('textarea')
  await textarea.fill('Race prompt from browser')
  await page.getByRole('button', { name: 'Send' }).click()

  await expect.poll(() => harness.getTurnStartBodies().length, {
    message: () => JSON.stringify(harness.getApiRequests(), null, 2),
  }).toBe(1)
  const turnStartBody = harness.getTurnStartBodies()[0]
  expect(turnStartBody).toEqual(
    expect.objectContaining({
      clientTurnRequestId: expect.any(String),
      input: 'Race prompt from browser',
      permissionPreset: 'default',
      reasoningEffort: 'medium',
    }),
  )

  await page.evaluate(({ clientTurnRequestId, input, threadId, workspaceId }) => {
    const socket = window.__workspaceStreamSockets?.find(
      (candidate) =>
        candidate.readyState === 1 &&
        Boolean((candidate as typeof candidate & { onmessage?: unknown }).onmessage),
    )
    if (!socket) {
      throw new Error('Expected workspace stream socket')
    }

    socket.emitServerEvent({
      method: 'turn/started',
      payload: {
        clientTurnRequestId,
        turn: {
          clientTurnRequestId,
          id: 'turn-stream-race',
          items: [
            {
              content: [
                {
                  text: input,
                  type: 'inputText',
                },
              ],
              id: 'item-stream-user',
              type: 'userMessage',
            },
          ],
          status: 'inProgress',
        },
      },
      seq: 2,
      threadId,
      ts: '2026-03-28T10:00:06.000Z',
      turnId: 'turn-stream-race',
      workspaceId,
    })
  }, {
    clientTurnRequestId: String(turnStartBody.clientTurnRequestId),
    input: 'Race prompt from browser',
    threadId: THREAD_ID,
    workspaceId: WORKSPACE_ID,
  })

  await expect(page.getByText('Thread send error')).toHaveCount(0, {
    timeout: 2_000,
  })
  await expect(page.getByText('Simulated stale HTTP turn start failure')).toHaveCount(0)
  await expect(textarea).toHaveValue('')
  await expect(page.getByText('Race prompt from browser')).toHaveCount(1)
  await expect(page.getByText('Sending message to Codex…')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sending…' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Stop' })).toBeEnabled()

  await expect
    .poll(() =>
      page.evaluate(async () => {
        const streamModule = await import('/src/hooks/useWorkspaceStream.ts')
        return streamModule
          .getWorkspaceStreamManagerDiagnosticsSnapshot()
          .streams[0]?.recentLifecycleEvents.map((event) => event.kind) ?? []
      }),
    )
    .not.toContain('seq-gap-detected')
})
