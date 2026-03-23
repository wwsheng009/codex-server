import { describe, expect, it } from 'vitest'

import type { ServerEvent, ThreadDetail } from '../types/api'
import {
  applyLiveThreadEvents,
  applyThreadEventToDetail,
  applyThreadEventsToDetail,
  resolveLiveThreadDetail,
  upsertPendingUserMessage,
} from './threadLiveState'

function makeDetail(): ThreadDetail {
  return {
    id: 'thread-1',
    workspaceId: 'ws-1',
    name: 'Thread',
    status: 'idle',
    archived: false,
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    turns: [],
  }
}

function makeEvent(method: string, payload: unknown): ServerEvent {
  return {
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    method,
    payload,
    ts: '2026-03-20T00:00:01.000Z',
  }
}

function makeAgentDeltaEvent(index: number, delta: string): ServerEvent {
  return {
    workspaceId: 'ws-1',
    threadId: 'thread-1',
    turnId: 'turn-1',
    method: 'item/agentMessage/delta',
    payload: {
      delta,
      itemId: 'item-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
    },
    ts: `2026-03-20T00:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  }
}

describe('threadLiveState', () => {
  it('applies agent message deltas directly to thread detail', () => {
    const detail = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(detail?.turns[0]?.id).toBe('turn-1')
    expect(detail?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello',
      phase: 'streaming',
    })
  })

  it('merges completed items with streamed content instead of wiping it', () => {
    const streamed = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    const completed = applyThreadEventToDetail(
      streamed,
      makeEvent('item/completed', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: '',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(completed?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello',
    })
    expect(completed?.turns[0]?.items[0]?.phase).toBeUndefined()
  })

  it('appends live command output chunks into the running command item', () => {
    const started = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('item/started', {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'git status',
          aggregatedOutput: '',
          status: 'inProgress',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    const updated = applyThreadEventToDetail(
      started,
      makeEvent('item/commandExecution/outputDelta', {
        delta: 'On branch main',
        itemId: 'cmd-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(updated?.turns[0]?.items[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      command: 'git status',
      aggregatedOutput: 'On branch main',
    })
  })

  it('applies turn completion payloads without requiring a follow-up thread refresh', () => {
    const detail = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('turn/completed', {
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'assistant-1',
              type: 'agentMessage',
              text: 'Finished',
            },
          ],
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(detail?.turns[0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
      items: [
        {
          id: 'assistant-1',
          type: 'agentMessage',
          text: 'Finished',
        },
      ],
    })
  })

  it('reapplies live events over a stale thread/read payload so tool calls do not disappear', () => {
    const baseDetail = makeDetail()
    const events: ServerEvent[] = [
      makeEvent('item/started', {
        item: {
          id: 'tool-1',
          type: 'dynamicToolCall',
          tool: 'search_query',
          status: 'inProgress',
          arguments: { q: 'codex' },
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ]

    const liveDetail = applyThreadEventsToDetail(baseDetail, events)
    const staleRefresh = makeDetail()
    const recoveredDetail = applyThreadEventsToDetail(staleRefresh, events)

    expect(liveDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'tool-1',
      type: 'dynamicToolCall',
    })
    expect(recoveredDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'tool-1',
      type: 'dynamicToolCall',
      tool: 'search_query',
    })
  })

  it('does not replay events already reflected in thread detail', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Hello',
            },
          ],
        },
      ],
    }

    const nextDetail = applyLiveThreadEvents(detail, [
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ])

    expect(nextDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello',
    })
  })

  it('still applies events newer than the thread detail snapshot', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Hello',
            },
          ],
        },
      ],
    }

    const nextDetail = applyLiveThreadEvents(detail, [
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'item/agentMessage/delta',
        payload: {
          delta: ' world',
          itemId: 'item-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(nextDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
    })
  })

  it('keeps accumulated streaming text when a refreshed snapshot lags behind the live state', () => {
    const chunks = Array.from({ length: 240 }, (_, index) => `chunk-${index.toString().padStart(3, '0')} `)
    const allEvents = chunks.map((chunk, index) => makeAgentDeltaEvent(index + 1, chunk))
    const firstBatch = allEvents.slice(0, 80)
    const lastBufferedBatch = allEvents.slice(-160)
    const staleSnapshot = applyThreadEventsToDetail(makeDetail(), allEvents.slice(0, 40))

    const liveAfterFirstBatch = resolveLiveThreadDetail({
      currentLiveDetail: undefined,
      events: firstBatch,
      threadDetail: makeDetail(),
    })
    const liveAfterStaleRefresh = resolveLiveThreadDetail({
      currentLiveDetail: liveAfterFirstBatch,
      events: lastBufferedBatch,
      threadDetail: staleSnapshot,
    })

    expect(applyLiveThreadEvents(staleSnapshot, lastBufferedBatch)?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: `${chunks.slice(0, 40).join('')}${chunks.slice(80).join('')}`,
    })
    expect(liveAfterStaleRefresh?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: chunks.join(''),
      phase: 'streaming',
    })
  })

  it('rebases to a newer snapshot once the backend catches up', () => {
    const chunks = Array.from({ length: 120 }, (_, index) => `chunk-${index.toString().padStart(3, '0')} `)
    const events = chunks.map((chunk, index) => makeAgentDeltaEvent(index + 1, chunk))
    const liveDetail = applyThreadEventsToDetail(makeDetail(), events.slice(0, 60))
    const refreshedSnapshot = applyThreadEventsToDetail(makeDetail(), events)

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail: liveDetail,
      events,
      threadDetail: refreshedSnapshot,
    })

    expect(resolved?.updatedAt).toBe(refreshedSnapshot?.updatedAt)
    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: chunks.join(''),
      phase: 'streaming',
    })
  })

  it('projects pending and resolved server requests into the live thread detail', () => {
    const detail = applyThreadEventsToDetail(makeDetail(), [
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'item/commandExecution/requestApproval',
        payload: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          command: 'rm -rf build',
        },
        serverRequestId: 'req-1',
        ts: '2026-03-20T00:00:01.000Z',
      },
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'server/request/resolved',
        payload: {
          method: 'item/commandExecution/requestApproval',
        },
        serverRequestId: 'req-1',
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(detail?.turns[0]?.items[0]).toMatchObject({
      id: 'server-request-req-1',
      type: 'serverRequest',
      requestKind: 'item/commandExecution/requestApproval',
      status: 'resolved',
    })
  })

  it('marks expired server requests in the live thread detail', () => {
    const detail = applyThreadEventsToDetail(makeDetail(), [
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'item/tool/requestUserInput',
        payload: {
          threadId: 'thread-1',
          turnId: 'turn-1',
          questions: [],
        },
        serverRequestId: 'req-2',
        ts: '2026-03-20T00:00:01.000Z',
      },
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'server/request/expired',
        payload: {
          method: 'item/tool/requestUserInput',
          reason: 'runtime_closed',
        },
        serverRequestId: 'req-2',
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(detail?.turns[0]?.items[0]).toMatchObject({
      id: 'server-request-req-2',
      type: 'serverRequest',
      status: 'expired',
      expireReason: 'runtime_closed',
    })
  })

  it('keeps the optimistic user message inside a live turn until the real item arrives', () => {
    const turns = upsertPendingUserMessage(
      [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Hello',
            },
          ],
        },
      ],
      {
        input: 'Inspect the repo',
        localId: 'pending-1',
        turnId: 'turn-1',
      },
    )

    expect(turns[0]?.items[0]).toMatchObject({
      type: 'userMessage',
    })
    expect(turns[0]?.items[1]).toMatchObject({
      type: 'agentMessage',
      text: 'Hello',
    })
  })
})
