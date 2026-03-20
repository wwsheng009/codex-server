import { describe, expect, it } from 'vitest'

import type { ServerEvent, ThreadDetail } from '../types/api'
import {
  applyThreadEventToDetail,
  applyThreadEventsToDetail,
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
