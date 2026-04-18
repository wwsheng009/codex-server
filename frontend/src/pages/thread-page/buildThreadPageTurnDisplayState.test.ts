import { describe, expect, it, vi } from 'vitest'

import type { ThreadDetail, ThreadTurn } from '../../types/api'
import { buildThreadPageTurnDisplayState } from './buildThreadPageTurnDisplayState'
import { threadTurnItemOverrideKey } from './threadPageContentOverrideUtils'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'

describe('buildThreadPageTurnDisplayState', () => {
  it('applies full item overrides without replacing the whole turn', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              text: 'summary body',
              summaryTruncated: true,
            },
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'working tree clean',
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'msg-1')]: {
          id: 'msg-1',
          type: 'agentMessage',
          text: 'full body',
        },
      },
      fullTurnOverridesById: {},
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns).toHaveLength(1)
    expect(state.displayedTurns[0].items[0]).toMatchObject({
      id: 'msg-1',
      text: 'full body',
      type: 'agentMessage',
    })
    expect(state.displayedTurns[0].items[1]).toMatchObject({
      id: 'cmd-1',
      aggregatedOutput: 'working tree clean',
      type: 'commandExecution',
    })
  })

  it('merges item content overrides without replacing the base item fields', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'line 1\n…\nline 1200',
              outputLineCount: 1200,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: {
          aggregatedOutput: 'line 1\nline 2\nline 3',
          outputLineCount: 3,
        },
      },
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns[0].items[0]).toMatchObject({
      id: 'cmd-1',
      type: 'commandExecution',
      command: 'git status',
      aggregatedOutput: 'line 1\nline 2\nline 3',
      outputLineCount: 3,
      summaryTruncated: true,
      status: 'completed',
    })
  })

  it('joins command output chunks from content overrides into a single display payload', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'tail chunk',
              outputLineCount: 10,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: {
          aggregatedOutputChunks: ['older chunk\n', 'tail chunk'],
          outputContentMode: 'tail',
          outputEndLine: 10,
          outputLineCount: 10,
          outputStartLine: 0,
        },
      },
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns[0].items[0]).toMatchObject({
      aggregatedOutput: 'older chunk\ntail chunk',
      outputContentMode: 'tail',
      outputEndLine: 10,
      outputStartLine: 0,
    })
  })

  it('reuses cached joined command output for the same override object', () => {
    const chunks = ['older chunk\n', 'tail chunk']
    const joinSpy = vi.spyOn(chunks, 'join')
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'tail chunk',
              outputLineCount: 10,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }
    const fullTurnItemContentOverridesById = {
      [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: {
        aggregatedOutputChunks: chunks,
        outputContentMode: 'tail',
        outputEndLine: 10,
        outputLineCount: 10,
        outputStartLine: 0,
      },
    }
    const emptyItemOverrides = {}
    const emptyTurnOverrides = {}

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(firstState.displayedTurns[0].items[0]).toMatchObject({
      aggregatedOutput: 'older chunk\ntail chunk',
    })
    expect(secondState.displayedTurns[0].items[0]).toMatchObject({
      aggregatedOutput: 'older chunk\ntail chunk',
    })
    expect(joinSpy).toHaveBeenCalledTimes(1)
  })

  it('reuses cached joined command output across different override objects that share chunks', () => {
    const chunks = ['older chunk\n', 'tail chunk']
    const joinSpy = vi.spyOn(chunks, 'join')
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'tail chunk',
              outputLineCount: 10,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }
    const emptyItemOverrides = {}
    const emptyTurnOverrides = {}

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: {
          aggregatedOutputChunks: chunks,
          outputContentMode: 'tail',
          outputEndLine: 10,
          outputLineCount: 10,
          outputStartLine: 0,
        },
      },
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: {
          aggregatedOutputChunks: chunks,
          outputContentMode: 'tail',
          outputEndLine: 10,
          outputLineCount: 10,
          outputStartLine: 0,
        },
      },
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(firstState.displayedTurns[0].items[0]).toMatchObject({
      aggregatedOutput: 'older chunk\ntail chunk',
    })
    expect(secondState.displayedTurns[0].items[0]).toMatchObject({
      aggregatedOutput: 'older chunk\ntail chunk',
    })
    expect(joinSpy).toHaveBeenCalledTimes(1)
  })

  it('reuses merged content-override items for the same base item and override object', () => {
    const contentOverride = {
      aggregatedOutputChunks: ['older chunk\n', 'tail chunk'],
      outputContentMode: 'tail',
      outputEndLine: 10,
      outputLineCount: 10,
      outputStartLine: 0,
    }
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'tail chunk',
              outputLineCount: 10,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }
    const emptyItemOverrides = {}
    const emptyTurnOverrides = {}

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: contentOverride,
      },
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: contentOverride,
      },
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(secondState).toBe(firstState)
    expect(secondState.displayedTurns).toBe(firstState.displayedTurns)
    expect(secondState.displayedTurns[0]).toBe(firstState.displayedTurns[0])
    expect(secondState.displayedTurns[0].items[0]).toBe(firstState.displayedTurns[0].items[0])
  })

  it('reuses turn-override results across different override map objects that share override refs', () => {
    const overrideTurn = {
      id: 'turn-1',
      status: 'completed',
      items: [
        {
          id: 'msg-1',
          type: 'agentMessage',
          text: 'full body',
        },
      ],
    }
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              text: 'summary body',
            },
          ],
        },
      ],
    }
    const emptyItemOverrides = {}

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: emptyItemOverrides,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: {
        'turn-1': overrideTurn,
      },
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: emptyItemOverrides,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: {
        'turn-1': overrideTurn,
      },
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(secondState).toBe(firstState)
    expect(secondState.displayedTurns).toBe(firstState.displayedTurns)
    expect(secondState.displayedTurns[0]).toBe(firstState.displayedTurns[0])
    expect(secondState.displayedTurns[0]).not.toBe(overrideTurn)
    expect(secondState.displayedTurns[0]).toMatchObject({
      id: 'turn-1',
      status: 'completed',
    })
    expect(secondState.displayedTurns[0].items[0]).toMatchObject({
      id: 'msg-1',
      type: 'agentMessage',
      text: 'full body',
    })
  })

  it('applies item content overrides on top of full turn view patches', () => {
    const overrideTurn = {
      id: 'turn-1',
      status: 'completed',
      items: [
        {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'git status',
          aggregatedOutput: 'tail chunk',
          outputLineCount: 10,
          status: 'completed',
          summaryTruncated: true,
        },
      ],
    }
    const contentOverride = {
      aggregatedOutputChunks: ['older chunk\n', 'tail chunk'],
      outputContentMode: 'tail',
      outputEndLine: 10,
      outputLineCount: 10,
      outputStartLine: 0,
    }
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'summary chunk',
              outputLineCount: 10,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }
    const emptyItemOverrides = {}

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: contentOverride,
      },
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: {
        'turn-1': overrideTurn,
      },
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: contentOverride,
      },
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: {
        'turn-1': overrideTurn,
      },
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(firstState.displayedTurns[0].items[0]).toMatchObject({
      id: 'cmd-1',
      aggregatedOutput: 'older chunk\ntail chunk',
      outputContentMode: 'tail',
      status: 'completed',
      summaryTruncated: true,
    })
    expect(secondState).toBe(firstState)
    expect(secondState.displayedTurns).toBe(firstState.displayedTurns)
    expect(secondState.displayedTurns[0]).toBe(firstState.displayedTurns[0])
    expect(secondState.displayedTurns[0].items[0]).toBe(firstState.displayedTurns[0].items[0])
  })

  it('does not let full turn overrides introduce new items that are missing from the projection', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              text: 'summary body',
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {
        'turn-1': {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'full output',
              status: 'completed',
            },
          ],
        },
      },
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns[0].items).toHaveLength(1)
    expect(state.displayedTurns[0].items[0]).toMatchObject({
      id: 'msg-1',
      type: 'agentMessage',
      text: 'summary body',
    })
  })

  it('preserves references for turns and items that do not receive overrides', () => {
    const untouchedItem = {
      id: 'msg-1',
      type: 'agentMessage',
      text: 'stable body',
    }
    const untouchedTurn = {
      id: 'turn-1',
      status: 'completed',
      items: [untouchedItem],
    }
    const touchedTurn = {
      id: 'turn-2',
      status: 'completed',
      items: [
        {
          id: 'cmd-1',
          type: 'commandExecution',
          command: 'git status',
          aggregatedOutput: 'tail chunk',
          outputLineCount: 10,
          status: 'completed',
          summaryTruncated: true,
        },
        {
          id: 'msg-2',
          type: 'agentMessage',
          text: 'keep me stable',
        },
      ],
    }
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 2,
      messageCount: 2,
      turns: [untouchedTurn, touchedTurn],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {
        [threadTurnItemOverrideKey('turn-2', 'cmd-1')]: {
          aggregatedOutputChunks: ['older chunk\n', 'tail chunk'],
          outputContentMode: 'tail',
          outputEndLine: 10,
          outputLineCount: 10,
          outputStartLine: 0,
        },
      },
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns[0]).toBe(untouchedTurn)
    expect(state.displayedTurns[0].items[0]).toBe(untouchedItem)
    expect(state.displayedTurns[1]).not.toBe(touchedTurn)
    expect(state.displayedTurns[1].items[0]).not.toBe(touchedTurn.items[0])
    expect(state.displayedTurns[1].items[1]).toBe(touchedTurn.items[1])
  })

  it('reuses pending-turn display results for identical turns and pending turn inputs', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [],
        },
      ],
    }
    const pendingTurn: PendingThreadTurn = {
      input: 'hello',
      localId: 'pending-1',
      phase: 'sending',
      submittedAt: '2026-03-22T00:00:00.000Z',
      threadId: 'thread-1',
      turnId: 'turn-1',
    }
    const emptyItemOverrides = {}
    const emptyTurnOverrides = {}

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: pendingTurn,
      fullTurnItemContentOverridesById: emptyItemOverrides,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: pendingTurn,
      fullTurnItemContentOverridesById: emptyItemOverrides,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(secondState.displayedTurns).toBe(firstState.displayedTurns)
    expect(secondState.displayedTurns[0]).toBe(firstState.displayedTurns[0])
  })

  it('prefers live turns over overlapping historical turns so streamed updates stay visible', () => {
    const historicalTurns: ThreadDetail['turns'] = [
      {
        id: 'turn-1',
        status: 'inProgress',
        items: [
          {
            id: 'msg-1',
            type: 'agentMessage',
            text: '',
            phase: 'streaming',
          },
        ],
      },
    ]
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'inProgress',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:02.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              text: 'streamed text',
              phase: 'streaming',
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns,
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns).toHaveLength(1)
    expect(state.displayedTurns[0]).toBe(threadProjection.turns[0])
    expect(state.displayedTurns[0].items[0]).toMatchObject({
      id: 'msg-1',
      type: 'agentMessage',
      text: 'streamed text',
      phase: 'streaming',
    })
  })

  it('normalizes stale turn plan status to completed in display state when the turn is completed', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:02.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'turn-plan-turn-1',
              type: 'turnPlan',
              explanation: 'Stabilize the event flow',
              status: 'inProgress',
              steps: [
                {
                  step: 'Inspect runtime events',
                  status: 'completed',
                },
                {
                  step: 'Render step states',
                  status: 'inProgress',
                },
              ],
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns[0].items[0]).toMatchObject({
      id: 'turn-plan-turn-1',
      type: 'turnPlan',
      status: 'completed',
    })
  })

  it('excludes the synthetic governance turn from display turn counts and latest-turn selection', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:02.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'thread-governance',
          status: 'completed',
          items: [
            {
              id: 'hook-run-hook-1',
              type: 'hookRun',
              eventName: 'UserPromptSubmit',
              message: 'governance event',
            },
          ],
        },
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              text: 'real content',
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns: [],
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns).toHaveLength(2)
    expect(state.turnCount).toBe(1)
    expect(state.latestDisplayedTurn?.id).toBe('turn-1')
  })

  it('keeps a live-only synthetic governance turn pinned ahead of merged historical turns', () => {
    const historicalTurns: ThreadTurn[] = [
      {
        id: 'turn-1',
        status: 'completed',
        items: [
          {
            id: 'msg-1',
            type: 'agentMessage',
            text: 'historical content',
          },
        ],
      },
    ]
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:02.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'thread-governance',
          status: 'completed',
          items: [
            {
              id: 'hook-run-hook-1',
              type: 'hookRun',
              eventName: 'SessionStart',
              message: 'governance event',
            },
          ],
        },
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              text: 'live content',
            },
          ],
        },
      ],
    }

    const state = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {},
      fullTurnOverridesById: {},
      historicalTurns,
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(state.displayedTurns).toHaveLength(2)
    expect(state.displayedTurns[0]?.id).toBe('thread-governance')
    expect(state.displayedTurns[1]?.id).toBe('turn-1')
    expect(state.displayedTurns[1]?.items[0]).toMatchObject({
      id: 'msg-1',
      type: 'agentMessage',
      text: 'live content',
    })
  })

  it('reuses the same display-state result for identical inputs', () => {
    const threadProjection: ThreadDetail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'completed',
      archived: false,
      createdAt: '2026-03-22T00:00:00.000Z',
      updatedAt: '2026-03-22T00:00:00.000Z',
      turnCount: 1,
      messageCount: 1,
      turns: [
        {
          id: 'turn-1',
          status: 'completed',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'git status',
              aggregatedOutput: 'tail chunk',
              outputLineCount: 10,
              status: 'completed',
              summaryTruncated: true,
            },
          ],
        },
      ],
    }
    const fullTurnItemContentOverridesById = {
      [threadTurnItemOverrideKey('turn-1', 'cmd-1')]: {
        aggregatedOutputChunks: ['older chunk\n', 'tail chunk'],
        outputContentMode: 'tail',
        outputEndLine: 10,
        outputLineCount: 10,
        outputStartLine: 0,
      },
    }
    const emptyItemOverrides = {}
    const emptyTurnOverrides = {}
    const historicalTurns: ThreadDetail['turns'] = []

    const firstState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns,
      threadProjection,
      selectedThreadId: 'thread-1',
    })
    const secondState = buildThreadPageTurnDisplayState({
      activePendingTurn: null,
      fullTurnItemContentOverridesById,
      fullTurnItemOverridesById: emptyItemOverrides,
      fullTurnOverridesById: emptyTurnOverrides,
      historicalTurns,
      threadProjection,
      selectedThreadId: 'thread-1',
    })

    expect(secondState).toBe(firstState)
    expect(secondState.displayedTurns).toBe(firstState.displayedTurns)
  })

})
