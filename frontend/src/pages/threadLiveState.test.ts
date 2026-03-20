import { describe, expect, it } from 'vitest'

import type { ServerEvent, ThreadDetail } from '../types/api'
import { applyThreadEventToDetail, upsertPendingUserMessage } from './threadLiveState'

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
