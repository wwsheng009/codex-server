import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../i18n/runtime'
import type { ServerEvent, ThreadDetail } from '../types/api'
import {
  applyLiveThreadEvents,
  applyThreadEventToDetail,
  applyThreadEventsToDetail,
  resolveLiveThreadDetail,
  upsertPendingUserMessage,
} from './threadLiveState'

beforeAll(() => {
  i18n.loadAndActivate({ locale: 'en', messages: {} })
})

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

  it('updates thread token usage from realtime token usage events', () => {
    const detail = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('thread/tokenUsage/updated', {
        threadId: 'thread-1',
        tokenUsage: {
          last: {
            cachedInputTokens: 5,
            inputTokens: 100,
            outputTokens: 20,
            reasoningOutputTokens: 3,
            totalTokens: 123,
          },
          total: {
            cachedInputTokens: 10,
            inputTokens: 1000,
            outputTokens: 200,
            reasoningOutputTokens: 30,
            totalTokens: 1240,
          },
          modelContextWindow: 128000,
        },
      }),
    )

    expect(detail?.tokenUsage).toEqual({
      last: {
        cachedInputTokens: 5,
        inputTokens: 100,
        outputTokens: 20,
        reasoningOutputTokens: 3,
        totalTokens: 123,
      },
      total: {
        cachedInputTokens: 10,
        inputTokens: 1000,
        outputTokens: 200,
        reasoningOutputTokens: 30,
        totalTokens: 1240,
      },
      modelContextWindow: 128000,
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

  it('marks completed-only agent messages for a one-shot client reveal', () => {
    const started = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('item/started', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: '',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    const completed = applyThreadEventToDetail(
      started,
      makeEvent('item/completed', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: 'Hello',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(completed?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello',
      clientRenderMode: 'animate-once',
    })
    expect(completed?.turns[0]?.items[0]?.phase).toBeUndefined()
  })

  it('marks started agent messages as streaming before the first text delta arrives', () => {
    const detail = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('item/started', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: '',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(detail?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      phase: 'streaming',
    })
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

  it('materializes a visible command execution placeholder from started events', () => {
    const detail = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('item/started', {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(detail?.turns[0]?.items[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      status: 'inProgress',
    })
  })

  it('projects turn plan updates into a dedicated status item', () => {
    const started = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('turn/plan/updated', {
        explanation: 'Stabilize the thread plan pipeline',
        plan: [
          {
            step: 'Inspect runtime events',
            status: 'completed',
          },
          {
            step: 'Render step states',
            status: 'inProgress',
          },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    const updated = applyThreadEventToDetail(
      started,
      makeEvent('turn/plan/updated', {
        explanation: 'Stabilize the thread plan pipeline',
        plan: [
          {
            step: 'Inspect runtime events',
            status: 'completed',
          },
          {
            step: 'Render step states',
            status: 'completed',
          },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(updated?.turns[0]?.items).toHaveLength(1)
    expect(updated?.turns[0]?.items[0]).toMatchObject({
      id: 'turn-plan-turn-1',
      type: 'turnPlan',
      explanation: 'Stabilize the thread plan pipeline',
      status: 'completed',
      steps: [
        {
          step: 'Inspect runtime events',
          status: 'completed',
        },
        {
          step: 'Render step states',
          status: 'completed',
        },
      ],
    })
  })

  it('finalizes stale turn plan status when the turn completes without another plan update', () => {
    const withPlan = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('turn/plan/updated', {
        explanation: 'Stabilize the thread plan pipeline',
        plan: [
          {
            step: 'Inspect runtime events',
            status: 'completed',
          },
          {
            step: 'Render step states',
            status: 'inProgress',
          },
        ],
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    const completed = applyThreadEventToDetail(
      withPlan,
      makeEvent('turn/completed', {
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [],
        },
      }),
    )

    expect(completed?.turns[0]?.items[0]).toMatchObject({
      id: 'turn-plan-turn-1',
      type: 'turnPlan',
      status: 'completed',
    })
  })

  it('merges hook lifecycle events into the live thread detail', () => {
    const started = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('hook/started', {
        run: {
          id: 'hook-1',
          turnId: 'turn-1',
          eventName: 'PostToolUse',
          handlerKey: 'builtin.posttooluse.failed-validation-rescue',
          triggerMethod: 'item/completed',
          toolName: 'command/exec',
          status: 'running',
          decision: 'continueTurn',
          reason: 'validation_command_failed',
          entries: [
            {
              kind: 'feedback',
              text: 'command=go test ./...',
            },
          ],
        },
      }),
    )

    const completed = applyThreadEventToDetail(
      started,
      makeEvent('hook/completed', {
        run: {
          id: 'hook-1',
          turnId: 'turn-1',
          eventName: 'PostToolUse',
          handlerKey: 'builtin.posttooluse.failed-validation-rescue',
          triggerMethod: 'item/completed',
          toolName: 'command/exec',
          status: 'completed',
          decision: 'continueTurn',
          reason: 'validation_command_failed',
          durationMs: 18,
        },
      }),
    )

    expect(completed?.turns[0]?.items[0]).toMatchObject({
      id: 'hook-run-hook-1',
      type: 'hookRun',
      eventName: 'PostToolUse',
      status: 'completed',
      decision: 'continueTurn',
      reason: 'validation_command_failed',
      durationMs: 18,
    })
    expect(String(completed?.turns[0]?.items[0]?.message ?? '')).toBe(
      'Event: Post-Tool Use\nHandler: Failed Validation Rescue\nStatus: Completed\nDecision: Continue Turn\nTrigger: Item Completed\nTool: Command Execution\nReason: Validation command failed',
    )
  })

  it('inserts hook lifecycle items after their related turn item instead of appending them to the bottom', () => {
    const withItems = applyThreadEventsToDetail(makeDetail(), [
      makeEvent('item/completed', {
        item: {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'go test ./...',
          status: 'completed',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/completed', {
        item: {
          id: 'msg-1',
          type: 'agentMessage',
          text: 'done',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ])

    const updated = applyThreadEventToDetail(
      withItems,
      makeEvent('hook/completed', {
        run: {
          id: 'hook-1',
          turnId: 'turn-1',
          itemId: 'cmd-1',
          eventName: 'PostToolUse',
          handlerKey: 'builtin.posttooluse.failed-validation-rescue',
          triggerMethod: 'item/completed',
          toolName: 'command/exec',
          status: 'completed',
          decision: 'continueTurn',
          reason: 'validation_command_failed',
        },
      }),
    )

    expect(updated?.turns[0]?.items).toHaveLength(3)
    expect(updated?.turns[0]?.items[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
    })
    expect(updated?.turns[0]?.items[1]).toMatchObject({
      id: 'hook-run-hook-1',
      type: 'hookRun',
      itemId: 'cmd-1',
    })
    expect(updated?.turns[0]?.items[2]).toMatchObject({
      id: 'msg-1',
      type: 'agentMessage',
    })
  })

  it('places turnless hook lifecycle events into a synthetic governance turn', () => {
    const detailWithExistingTurn = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('turn/completed', {
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [],
        },
      }),
    )

    const updated = applyThreadEventToDetail(
      detailWithExistingTurn,
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        method: 'hook/completed',
        payload: {
          run: {
            id: 'hook-thread-1',
            threadId: 'thread-1',
            eventName: 'UserPromptSubmit',
            handlerKey: 'builtin.userpromptsubmit.block-secret-paste',
            triggerMethod: 'turn/start',
            status: 'completed',
            decision: 'block',
            reason: 'secret_like_input_blocked',
          },
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    )

    expect(updated?.turns[0]?.id).toBe('thread-governance')
    expect(updated?.turns[0]?.items[0]).toMatchObject({
      id: 'hook-run-hook-thread-1',
      type: 'hookRun',
      eventName: 'UserPromptSubmit',
      status: 'completed',
      decision: 'block',
      reason: 'secret_like_input_blocked',
    })
    expect(String(updated?.turns[0]?.items[0]?.message ?? '')).toBe(
      'Event: User Prompt Submit\nHandler: Secret Paste Guard\nStatus: Completed\nDecision: Block\nTrigger: Turn Start\nReason: Secret-like input blocked',
    )
    expect(updated?.turns[1]?.id).toBe('turn-1')
  })

  it('includes session start source in projected hook run timeline messages', () => {
    const detail = applyThreadEventToDetail(
      makeDetail(),
      makeEvent('hook/completed', {
        run: {
          id: 'hook-session-1',
          eventName: 'SessionStart',
          handlerKey: 'builtin.sessionstart.inject-project-context',
          triggerMethod: 'turn/start',
          status: 'completed',
          decision: 'continue',
          sessionStartSource: 'resume',
          reason: 'project_context_injected',
        },
      }),
    )

    expect(detail?.turns[0]?.items[0]).toMatchObject({
      id: 'hook-run-hook-session-1',
      type: 'hookRun',
      eventName: 'SessionStart',
      sessionStartSource: 'resume',
    })
    expect(String(detail?.turns[0]?.items[0]?.message ?? '')).toBe(
      'Event: Session Start\nHandler: Project Context Injection\nStatus: Completed\nDecision: Continue\nTrigger: Turn Start\nSession Start Source: Resume\nReason: Project context injected',
    )
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

  it('merges turn completion payload items with streamed content instead of wiping the live reply', () => {
    const streamed = applyThreadEventsToDetail(makeDetail(), [
      makeEvent('turn/started', {
        turn: {
          id: 'turn-1',
          status: 'inProgress',
          items: [],
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello world',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ])

    const completed = applyThreadEventToDetail(
      streamed,
      makeEvent('turn/completed', {
        turn: {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: '',
            },
          ],
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    )

    expect(completed?.turns[0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
      items: [
        {
          id: 'item-1',
          type: 'agentMessage',
          text: 'Hello world',
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

  it('replays older agent deltas when a newer snapshot still has an empty streaming placeholder', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: '',
              phase: 'streaming',
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
          delta: 'Hello world',
          itemId: 'item-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(nextDetail?.updatedAt).toBe('2026-03-20T00:00:03.000Z')
    expect(nextDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
      phase: 'streaming',
    })
  })

  it('replays older turn completion payloads when a newer snapshot still lacks the completed items', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [],
        },
      ],
    }

    const nextDetail = applyLiveThreadEvents(detail, [
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'turn/completed',
        payload: {
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
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(nextDetail?.updatedAt).toBe('2026-03-20T00:00:03.000Z')
    expect(nextDetail?.turns[0]).toMatchObject({
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

  it('replays older completed agent items when a newer snapshot only has a shorter partial message', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
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
        method: 'item/completed',
        payload: {
          item: {
            id: 'item-1',
            type: 'agentMessage',
            text: 'Hello world',
          },
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(nextDetail?.updatedAt).toBe('2026-03-20T00:00:03.000Z')
    expect(nextDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
    })
  })

  it('replays older turn completion payloads when a newer snapshot has shorter completed item text', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
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
      ],
    }

    const nextDetail = applyLiveThreadEvents(detail, [
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'turn/completed',
        payload: {
          turn: {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                id: 'assistant-1',
                type: 'agentMessage',
                text: 'Finished with full details',
              },
            ],
          },
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(nextDetail?.updatedAt).toBe('2026-03-20T00:00:03.000Z')
    expect(nextDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'assistant-1',
      type: 'agentMessage',
      text: 'Finished with full details',
    })
  })

  it('replays older reasoning items when a newer snapshot has shorter reasoning content', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: ['Checked snapshot'],
              content: ['Compared'],
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
        method: 'item/completed',
        payload: {
          item: {
            id: 'reasoning-1',
            type: 'reasoning',
            summary: ['Checked snapshot and live event order'],
            content: ['Compared websocket events with rendered entries'],
          },
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        ts: '2026-03-20T00:00:02.000Z',
      },
    ])

    expect(nextDetail?.updatedAt).toBe('2026-03-20T00:00:03.000Z')
    expect(nextDetail?.turns[0]?.items[0]).toMatchObject({
      id: 'reasoning-1',
      type: 'reasoning',
      summary: ['Checked snapshot and live event order'],
      content: ['Compared websocket events with rendered entries'],
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

  it('preserves streaming phase when a newer in-progress snapshot omits it', () => {
    const currentLiveDetail = applyThreadEventsToDetail(makeDetail(), [
      makeEvent('turn/started', {
        turn: {
          id: 'turn-1',
          status: 'inProgress',
          items: [],
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello world',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ]) as ThreadDetail

    const newerSnapshot: ThreadDetail = {
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
              text: 'Hello world',
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: newerSnapshot,
    })

    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
      phase: 'streaming',
    })
  })

  it('does not let a newer snapshot with empty agent text wipe the live reply', () => {
    const currentLiveDetail = applyThreadEventsToDetail(makeDetail(), [
      makeEvent('turn/started', {
        turn: {
          id: 'turn-1',
          status: 'inProgress',
          items: [],
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello world',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/completed', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: '',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ]) as ThreadDetail

    const newerSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: '',
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: newerSnapshot,
    })

    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
    })
  })

  it('preserves a trailing live agent message when a newer snapshot temporarily omits it', () => {
    const currentLiveDetail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: ['Checking order'],
              content: [],
            },
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Newest reply',
            },
          ],
        },
      ],
    }

    const newerSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: ['Checking order'],
              content: [],
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: newerSnapshot,
    })

    expect(resolved?.turns[0]?.items).toHaveLength(2)
    expect(resolved?.turns[0]?.items[1]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Newest reply',
    })
  })

  it('preserves a trailing live command execution item when a newer snapshot temporarily omits it', () => {
    const currentLiveDetail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: ['Checking order'],
              content: [],
            },
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'working tree clean',
              status: 'completed',
            },
          ],
        },
      ],
    }

    const newerSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'reasoning-1',
              type: 'reasoning',
              summary: ['Checking order'],
              content: [],
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: newerSnapshot,
    })

    expect(resolved?.turns[0]?.items).toHaveLength(2)
    expect(resolved?.turns[0]?.items[1]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      command: 'git status',
      aggregatedOutput: 'working tree clean',
      status: 'completed',
    })
  })

  it('preserves an entire trailing live turn when a newer snapshot temporarily omits the newest turn', () => {
    const currentLiveDetail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Earlier reply',
            },
          ],
        },
        {
          id: 'turn-2',
          status: 'completed',
          items: [
            {
              id: 'cmd-2',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'working tree clean',
              status: 'completed',
            },
          ],
        },
      ],
    }

    const newerSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Earlier reply',
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: newerSnapshot,
    })

    expect(resolved?.turns).toHaveLength(2)
    expect(resolved?.turns[1]).toMatchObject({
      id: 'turn-2',
      status: 'completed',
    })
    expect(resolved?.turns[1]?.items[0]).toMatchObject({
      id: 'cmd-2',
      type: 'commandExecution',
      command: 'git status',
      aggregatedOutput: 'working tree clean',
      status: 'completed',
    })
  })

  it('does not let a newer snapshot with blank command execution fields wipe live output', () => {
    const currentLiveDetail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'working tree clean',
              status: 'completed',
            },
          ],
        },
      ],
    }

    const newerSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: '',
              aggregatedOutput: '',
              status: '',
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: newerSnapshot,
    })

    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      command: 'git status',
      aggregatedOutput: 'working tree clean',
      status: 'completed',
    })
  })

  it('replays stale command execution completion events when the snapshot only has an empty placeholder', () => {
    const detail: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:05.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: '',
              aggregatedOutput: '',
              status: '',
            },
          ],
        },
      ],
    }

    const resolved = applyLiveThreadEvents(detail, [
      {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        method: 'item/completed',
        payload: {
          item: {
            id: 'cmd-1',
            type: 'commandExecution',
          },
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        ts: '2026-03-20T00:00:04.000Z',
      },
    ])

    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      status: 'completed',
    })
  })

  it('does not preserve streaming phase once a newer snapshot marks the turn completed', () => {
    const currentLiveDetail = applyThreadEventsToDetail(makeDetail(), [
      makeEvent('turn/started', {
        turn: {
          id: 'turn-1',
          status: 'inProgress',
          items: [],
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/agentMessage/delta', {
        delta: 'Hello world',
        itemId: 'item-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ]) as ThreadDetail

    const completedSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Hello world',
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: completedSnapshot,
    })

    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
    })
    expect(resolved?.turns[0]?.items[0]?.phase).toBeUndefined()
  })

  it('preserves completed-only client reveal markers across newer snapshots', () => {
    const currentLiveDetail = applyThreadEventsToDetail(makeDetail(), [
      makeEvent('item/started', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: '',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
      makeEvent('item/completed', {
        item: {
          id: 'item-1',
          type: 'agentMessage',
          text: 'Hello world',
        },
        threadId: 'thread-1',
        turnId: 'turn-1',
      }),
    ]) as ThreadDetail

    const completedSnapshot: ThreadDetail = {
      ...makeDetail(),
      updatedAt: '2026-03-20T00:00:02.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'item-1',
              type: 'agentMessage',
              text: 'Hello world',
            },
          ],
        },
      ],
    }

    const resolved = resolveLiveThreadDetail({
      currentLiveDetail,
      events: [],
      threadDetail: completedSnapshot,
    })

    expect(resolved?.turns[0]?.items[0]).toMatchObject({
      id: 'item-1',
      type: 'agentMessage',
      text: 'Hello world',
      clientRenderMode: 'animate-once',
    })
    expect(resolved?.turns[0]?.items[0]?.phase).toBeUndefined()
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
