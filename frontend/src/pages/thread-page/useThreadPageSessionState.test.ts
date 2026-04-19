// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'

import type { ServerEvent, ThreadDetail } from '../../types/api'

let resolveThreadPageSessionProjection: typeof import('./useThreadPageSessionState').resolveThreadPageSessionProjection

beforeAll(async () => {
  ;({ resolveThreadPageSessionProjection } = await import('./useThreadPageSessionState'))
})

describe('resolveThreadPageSessionProjection', () => {
  it('returns the snapshot projection only (no event-replay) when the store projection is missing under single-truth', () => {
    const snapshot: ThreadDetail = {
      archived: false,
      createdAt: '2026-04-18T10:00:00.000Z',
      id: 'thread-1',
      name: 'Thread 1',
      status: 'inProgress',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [],
        },
      ],
      updatedAt: '2026-04-18T10:00:00.000Z',
      workspaceId: 'ws-1',
    }

    const selectedThreadEvents: ServerEvent[] = [
      {
        method: 'item/agentMessage/delta',
        payload: {
          delta: 'streamed reply',
          itemId: 'msg-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        seq: 41,
        threadId: 'thread-1',
        turnId: 'turn-1',
        ts: '2026-04-18T10:00:01.000Z',
        workspaceId: 'ws-1',
      },
    ]

    const resolved = resolveThreadPageSessionProjection({
      contentMode: 'summary',
      selectedThreadEvents,
      selectedThreadId: 'thread-1',
      threadDetail: snapshot,
      turnLimit: 40,
      workspaceId: 'ws-1',
    })

    expect(resolved).toMatchObject({
      id: 'thread-1',
      clientProjectionCompleteness: 'summary',
      turns: [
        {
          id: 'turn-1',
          items: [],
        },
      ],
    })
    expect((resolved as ThreadDetail | undefined)?.clientLiveEventSeq).toBeUndefined()
  })

  it('returns undefined (no projection, no replay) when neither snapshot nor store projection exists', () => {
    const selectedThreadEvents: ServerEvent[] = [
      {
        method: 'item/started',
        payload: {
          item: {
            id: 'cmd-1',
            type: 'commandExecution',
            command: 'npm test',
          },
          threadId: 'thread-2',
          turnId: 'turn-2',
        },
        seq: 7,
        threadId: 'thread-2',
        turnId: 'turn-2',
        ts: '2026-04-18T10:05:00.000Z',
        workspaceId: 'ws-1',
      },
      {
        method: 'item/commandExecution/outputDelta',
        payload: {
          delta: 'line 1\n',
          itemId: 'cmd-1',
          threadId: 'thread-2',
          turnId: 'turn-2',
        },
        seq: 8,
        threadId: 'thread-2',
        turnId: 'turn-2',
        ts: '2026-04-18T10:05:00.500Z',
        workspaceId: 'ws-1',
      },
    ]

    const resolved = resolveThreadPageSessionProjection({
      selectedThreadEvents,
      selectedThreadId: 'thread-2',
      workspaceId: 'ws-1',
    })

    expect(resolved).toBeUndefined()
  })

  it('prefers the store projection directly without touching buffered events', () => {
    const storeProjection: ThreadDetail = {
      archived: false,
      createdAt: '2026-04-18T10:00:00.000Z',
      id: 'thread-3',
      name: 'Thread 3',
      status: 'inProgress',
      turns: [
        {
          id: 'turn-3',
          status: 'inProgress',
          items: [
            {
              id: 'msg-3',
              type: 'agentMessage',
              text: 'from store projection',
              phase: 'streaming',
            },
          ],
        },
      ],
      updatedAt: '2026-04-18T10:00:10.000Z',
      workspaceId: 'ws-1',
      clientLiveEventSeq: 100,
      clientProjectionAppliedSeq: 100,
      clientProjectionCompleteness: 'live-only',
    }
    const selectedThreadEvents: ServerEvent[] = [
      {
        method: 'item/agentMessage/delta',
        payload: {
          delta: 'ignored',
          itemId: 'msg-3',
          threadId: 'thread-3',
          turnId: 'turn-3',
        },
        seq: 101,
        threadId: 'thread-3',
        turnId: 'turn-3',
        ts: '2026-04-18T10:00:11.000Z',
        workspaceId: 'ws-1',
      },
    ]

    const resolved = resolveThreadPageSessionProjection({
      selectedThreadEvents,
      selectedThreadId: 'thread-3',
      threadProjection: storeProjection,
      workspaceId: 'ws-1',
    })

    expect(resolved).toBe(storeProjection)
  })
})
