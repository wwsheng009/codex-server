// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'

import type { ServerEvent, ThreadDetail } from '../../types/api'

let resolveThreadPageSessionProjection: typeof import('./useThreadPageSessionState').resolveThreadPageSessionProjection

beforeAll(async () => {
  ;({ resolveThreadPageSessionProjection } = await import('./useThreadPageSessionState'))
})

describe('resolveThreadPageSessionProjection', () => {
  it('replays buffered thread events onto the snapshot when the store projection is missing', () => {
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
      clientLiveEventSeq: 41,
      clientProjectionAppliedSeq: 41,
      clientProjectionCompleteness: 'summary',
      turns: [
        {
          id: 'turn-1',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              phase: 'streaming',
              text: 'streamed reply',
            },
          ],
        },
      ],
    })
  })

  it('can build a temporary projection directly from buffered events without a snapshot', () => {
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

    expect(resolved).toMatchObject({
      clientLiveEventSeq: 8,
      clientProjectionAppliedSeq: 8,
      clientProjectionCompleteness: 'live-only',
      id: 'thread-2',
      turns: [
        {
          id: 'turn-2',
          items: [
            {
              aggregatedOutput: 'line 1\n',
              command: 'npm test',
              id: 'cmd-1',
              status: 'inProgress',
              type: 'commandExecution',
            },
          ],
        },
      ],
      workspaceId: 'ws-1',
    })
  })
})
