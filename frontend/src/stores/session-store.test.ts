import { beforeAll, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n/runtime'
import type { ServerEvent, ThreadDetail } from '../types/api'
import type {
  ApplySessionEventsState,
  CommandRuntimeSession,
} from './session-store-types'
import { buildThreadStoreKey } from './session-store-utils'

type SessionStoreModule = typeof import('./session-store')

const localStorageStub = {
  getItem() {
    return null
  },
  removeItem() {},
  setItem() {},
}

let sessionStoreModule: SessionStoreModule

beforeAll(async () => {
  vi.stubGlobal('window', {
    atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
    localStorage: localStorageStub,
  })

  i18n.loadAndActivate({ locale: 'en', messages: {} })
  sessionStoreModule = await import('./session-store')
})

describe('applySessionEvents command/exec replay handling', () => {
  it('batches replay append deltas into the combined output', () => {
    const nextState = sessionStoreModule.applySessionEvents(createState(), [
      makeEvent(
        'command/exec/outputDelta',
        {
          deltaText: 'line 1\r\n',
          processId: 'proc_001',
          replay: true,
          replayBytes: 8,
          replayReason: 'cursor_match',
          stream: 'stdout',
        },
        '2026-03-27T01:00:01.000Z',
      ),
      makeEvent(
        'command/exec/outputDelta',
        {
          deltaText: 'line 2\r\n',
          processId: 'proc_001',
          replay: true,
          replayBytes: 8,
          replayReason: 'cursor_match',
          stream: 'stdout',
        },
        '2026-03-27T01:00:01.800Z',
      ),
    ])

    const session = nextState.commandSessionsByWorkspace['ws-1'].proc_001
    expect(session.combinedOutput).toBe('line 1\r\nline 2\r\n')
    expect(session.lastReplayMode).toBe('append')
    expect(session.lastReplayReason).toBe('cursor_match')
    expect(session.replayAppendCount).toBe(2)
    expect(session.replayByteCount).toBe(16)
    expect(session.replayReplaceCount).toBe(0)
    expect(session.status).toBe('running')
    expect(session.updatedAt).toBe('2026-03-27T01:00:01.800Z')
  })

  it('replaces stale output when replay requests a full replace', () => {
    const nextState = sessionStoreModule.applySessionEvents(createState({ combinedOutput: 'stale\r\n' }), [
      makeEvent(
        'command/exec/outputDelta',
        {
          deltaText: 'fresh\r\n',
          processId: 'proc_001',
          replay: true,
          replayBytes: 7,
          replayReason: 'tail_mismatch',
          replace: true,
          stream: 'stdout',
        },
        '2026-03-27T01:00:02.000Z',
      ),
    ])

    const session = nextState.commandSessionsByWorkspace['ws-1'].proc_001
    expect(session.combinedOutput).toBe('fresh\r\n')
    expect(session.lastReplayMode).toBe('replace')
    expect(session.lastReplayReason).toBe('tail_mismatch')
    expect(session.replayAppendCount).toBe(0)
    expect(session.replayReplaceCount).toBe(1)
    expect(session.replayByteCount).toBe(7)
  })

  it('keeps accumulated output and replay metadata across state snapshots', () => {
    const nextState = sessionStoreModule.applySessionEvents(
      createState({
        combinedOutput: 'line 1\r\nline 2\r\n',
        lastReplayMode: 'append',
        lastReplayReason: 'cursor_match',
        replayAppendCount: 2,
        replayByteCount: 16,
        updatedAt: '2026-03-27T01:00:01.800Z',
      }),
      [
        makeEvent(
          'command/exec/stateSnapshot',
          {
            sessions: [
              {
                combinedOutput: '',
                command: 'tail -f app.log',
                createdAt: '2026-03-27T01:00:00.000Z',
                id: 'proc_001',
                status: 'running',
                stderr: '',
                stdout: '',
                updatedAt: '2026-03-27T01:00:03.000Z',
                workspaceId: 'ws-1',
              },
            ],
          },
          '2026-03-27T01:00:03.000Z',
        ),
      ],
    )

    const session = nextState.commandSessionsByWorkspace['ws-1'].proc_001
    expect(session.combinedOutput).toBe('line 1\r\nline 2\r\n')
    expect(session.lastReplayMode).toBe('append')
    expect(session.lastReplayReason).toBe('cursor_match')
    expect(session.replayAppendCount).toBe(2)
    expect(session.replayByteCount).toBe(16)
    expect(session.updatedAt).toBe('2026-03-27T01:00:03.000Z')
  })

  it('appends only the missing completion tail when completed arrives after streaming', () => {
    const nextState = sessionStoreModule.applySessionEvents(createState({ combinedOutput: 'line 1\r\n' }), [
      makeEvent(
        'command/exec/completed',
        {
          processId: 'proc_001',
          status: 'completed',
          stdout: 'line 1\r\nline 2\r\n',
        },
        '2026-03-27T01:00:04.000Z',
      ),
    ])

    const session = nextState.commandSessionsByWorkspace['ws-1'].proc_001
    expect(session.combinedOutput).toBe('line 1\r\nline 2\r\n')
    expect(session.status).toBe('completed')
    expect(session.updatedAt).toBe('2026-03-27T01:00:04.000Z')
  })
})

function createState(
  overrides: Partial<CommandRuntimeSession> = {},
): ApplySessionEventsState {
  const session = createSession(overrides)

  return {
    activityEventsByWorkspace: {},
    commandSessionsByWorkspace: {
      'ws-1': {
        [session.id]: session,
      },
    },
    eventsByThread: {},
    threadProjectionsById: {},
    lastEventSeqByWorkspace: {},
    selectedThreadIdByWorkspace: {},
    threadActivityByThread: {},
    tokenUsageByThread: {},
    workspaceEventsByWorkspace: {},
  }
}

function createSession(
  overrides: Partial<CommandRuntimeSession> = {},
): CommandRuntimeSession {
  return {
    combinedOutput: '',
    command: 'tail -f app.log',
    createdAt: '2026-03-27T01:00:00.000Z',
    id: 'proc_001',
    lastReplayMode: null,
    lastReplayReason: null,
    replayAppendCount: 0,
    replayByteCount: 0,
    replayReplaceCount: 0,
    status: 'running',
    stderr: '',
    stdout: '',
    updatedAt: '2026-03-27T01:00:00.000Z',
    workspaceId: 'ws-1',
    ...overrides,
  }
}

function makeEvent(
  method: string,
  payload: Record<string, unknown>,
  ts: string,
): ServerEvent {
  return {
    method,
    payload,
    ts,
    workspaceId: 'ws-1',
  }
}

describe('applySessionEvents seq replay dedupe', () => {
  it('ignores replayed or duplicate seq events that are already applied', () => {
    const nextState = sessionStoreModule.applySessionEvents(
      {
        ...createState(),
        lastEventSeqByWorkspace: {
          'ws-1': 5,
        },
      },
      [
        {
          ...makeEvent(
            'command/exec/completed',
            {
              processId: 'proc_001',
              status: 'completed',
            },
            '2026-03-27T01:00:05.000Z',
          ),
          seq: 4,
          replay: true,
        },
        {
          ...makeEvent(
            'command/exec/completed',
            {
              processId: 'proc_001',
              status: 'completed',
            },
            '2026-03-27T01:00:06.000Z',
          ),
          seq: 6,
        },
      ],
    )

    expect(nextState.lastEventSeqByWorkspace['ws-1']).toBe(6)
    expect(nextState.commandSessionsByWorkspace['ws-1'].proc_001.status).toBe('completed')
    expect(nextState.commandSessionsByWorkspace['ws-1'].proc_001.updatedAt).toBe(
      '2026-03-27T01:00:06.000Z',
    )
    expect(nextState.workspaceEventsByWorkspace['ws-1']).toEqual([
      expect.objectContaining({
        method: 'command/exec/completed',
        seq: 6,
      }),
    ])
  })

  it('skips non-replay live events with a known sequence gap', () => {
    const nextState = sessionStoreModule.applySessionEvents(
      {
        ...createState(),
        lastEventSeqByWorkspace: {
          'ws-1': 5,
        },
      },
      [
        {
          ...makeEvent(
            'command/exec/completed',
            {
              processId: 'proc_001',
              status: 'completed',
            },
            '2026-03-27T01:00:07.000Z',
          ),
          seq: 7,
        },
      ],
    )

    expect(nextState.lastEventSeqByWorkspace['ws-1']).toBe(5)
    expect(nextState.commandSessionsByWorkspace['ws-1'].proc_001.status).toBe('running')
    expect(nextState.workspaceEventsByWorkspace['ws-1']).toBeUndefined()
  })

  it('accepts coalesced live events whose coverage spans a known sequence gap', () => {
    const nextState = sessionStoreModule.applySessionEvents(
      {
        ...createState(),
        lastEventSeqByWorkspace: {
          'ws-1': 5,
        },
      },
      [
        {
          ...makeEvent(
            'command/exec/completed',
            {
              processId: 'proc_001',
              status: 'completed',
            },
            '2026-03-27T01:00:07.000Z',
          ),
          coalesced: true,
          coversSeqFrom: 6,
          coversSeqTo: 7,
          seq: 7,
        },
      ],
    )

    expect(nextState.lastEventSeqByWorkspace['ws-1']).toBe(7)
    expect(nextState.commandSessionsByWorkspace['ws-1'].proc_001.status).toBe('completed')
    expect(nextState.workspaceEventsByWorkspace['ws-1']).toEqual([
      expect.objectContaining({
        coversSeqFrom: 6,
        coversSeqTo: 7,
        method: 'command/exec/completed',
        seq: 7,
      }),
    ])
  })
})

describe('applySessionEvents thread activity status', () => {
  it('updates thread activity to completed when turn completion arrives without a thread status refresh', () => {
    const nextState = sessionStoreModule.applySessionEvents(
      {
        ...createState(),
        threadActivityByThread: {
          'thread-1': {
            latestEventMethod: 'turn/started',
            latestEventTs: '2026-03-27T01:00:00.000Z',
            latestStatus: 'running',
            threadId: 'thread-1',
            workspaceId: 'ws-1',
          },
        },
      },
      [
        {
          ...makeEvent(
            'turn/completed',
            {
              turn: {
                id: 'turn-1',
                status: 'completed',
              },
            },
            '2026-03-27T01:00:07.000Z',
          ),
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      ],
    )

    expect(nextState.threadActivityByThread[buildThreadStoreKey('ws-1', 'thread-1')]).toEqual({
      latestEventMethod: 'turn/completed',
      latestEventTs: '2026-03-27T01:00:07.000Z',
      latestStatus: 'completed',
      threadId: 'thread-1',
      workspaceId: 'ws-1',
    })
  })

  it('marks failed, interrupted, and cancelled turn events as terminal activity statuses', () => {
    const nextState = sessionStoreModule.applySessionEvents(createState(), [
      {
        ...makeEvent(
          'turn/failed',
          {
            turn: {
              id: 'turn-1',
            },
          },
          '2026-03-27T01:00:08.000Z',
        ),
        threadId: 'thread-1',
        turnId: 'turn-1',
      },
      {
        ...makeEvent(
          'turn/interrupted',
          {
            turn: {
              id: 'turn-2',
            },
          },
          '2026-03-27T01:00:09.000Z',
        ),
        threadId: 'thread-2',
        turnId: 'turn-2',
      },
      {
        ...makeEvent(
          'turn/canceled',
          {
            turn: {
              id: 'turn-3',
            },
          },
          '2026-03-27T01:00:10.000Z',
        ),
        threadId: 'thread-3',
        turnId: 'turn-3',
      },
    ])

    expect(
      nextState.threadActivityByThread[buildThreadStoreKey('ws-1', 'thread-1')]?.latestStatus,
    ).toBe('failed')
    expect(
      nextState.threadActivityByThread[buildThreadStoreKey('ws-1', 'thread-2')]?.latestStatus,
    ).toBe('interrupted')
    expect(
      nextState.threadActivityByThread[buildThreadStoreKey('ws-1', 'thread-3')]?.latestStatus,
    ).toBe('cancelled')
  })
})

describe('live thread detail projection', () => {
  it('projects selected-thread realtime command output directly in the session store', () => {
    const nextState = sessionStoreModule.applySessionEvents(
      {
        ...createState(),
        selectedThreadIdByWorkspace: {
          'ws-1': 'thread-1',
        },
      },
      [
        {
          ...makeEvent(
            'item/started',
            {
              item: {
                id: 'cmd-1',
                type: 'commandExecution',
                command: 'npm test',
              },
              threadId: 'thread-1',
              turnId: 'turn-1',
            },
            '2026-03-27T01:00:01.000Z',
          ),
          seq: 10,
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
        {
          ...makeEvent(
            'item/commandExecution/outputDelta',
            {
              delta: 'line 1\n',
              itemId: 'cmd-1',
              threadId: 'thread-1',
              turnId: 'turn-1',
            },
            '2026-03-27T01:00:01.500Z',
          ),
          seq: 11,
          threadId: 'thread-1',
          turnId: 'turn-1',
        },
      ],
    )

    expect(nextState.threadProjectionsById[buildThreadStoreKey('ws-1', 'thread-1')]).toMatchObject({
      clientLiveEventSeq: 11,
      clientProjectionAppliedSeq: 11,
      clientProjectionCompleteness: 'live-only',
      clientProjectionUpdatedAt: '2026-03-27T01:00:01.500Z',
      id: 'thread-1',
      workspaceId: 'ws-1',
      turns: [
        {
          id: 'turn-1',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'npm test',
              aggregatedOutput: 'line 1\n',
              status: 'inProgress',
            },
          ],
        },
      ],
    })
  })

  it('materializes a projection for inactive threads before they become selected', () => {
    const nextState = sessionStoreModule.applySessionEvents(createState(), [
      {
        ...makeEvent(
          'item/started',
          {
            item: {
              id: 'msg-1',
              type: 'agentMessage',
              text: '',
            },
            threadId: 'thread-2',
            turnId: 'turn-2',
          },
          '2026-03-27T01:00:10.000Z',
        ),
        seq: 20,
        threadId: 'thread-2',
        turnId: 'turn-2',
      },
      {
        ...makeEvent(
          'item/agentMessage/delta',
          {
            delta: 'hello from background thread',
            itemId: 'msg-1',
            threadId: 'thread-2',
            turnId: 'turn-2',
          },
          '2026-03-27T01:00:10.500Z',
        ),
        seq: 21,
        threadId: 'thread-2',
        turnId: 'turn-2',
      },
    ])

    expect(nextState.threadProjectionsById[buildThreadStoreKey('ws-1', 'thread-2')]).toMatchObject({
      clientLiveEventSeq: 21,
      clientProjectionAppliedSeq: 21,
      clientProjectionCompleteness: 'live-only',
      id: 'thread-2',
      status: 'inProgress',
      turns: [
        {
          id: 'turn-2',
          items: [
            {
              id: 'msg-1',
              type: 'agentMessage',
              phase: 'streaming',
              text: 'hello from background thread',
            },
          ],
        },
      ],
      workspaceId: 'ws-1',
    })
  })

  it('isolates live thread state for matching thread ids across workspaces', () => {
    const nextState = sessionStoreModule.applySessionEvents(createState(), [
      {
        ...makeEvent(
          'item/started',
          {
            item: {
              id: 'msg-ws-1',
              type: 'agentMessage',
              text: '',
            },
            threadId: 'thread-shared',
            turnId: 'turn-ws-1',
          },
          '2026-03-27T01:00:11.000Z',
        ),
        seq: 31,
        threadId: 'thread-shared',
        turnId: 'turn-ws-1',
        workspaceId: 'ws-1',
      },
      {
        ...makeEvent(
          'item/started',
          {
            item: {
              id: 'msg-ws-2',
              type: 'agentMessage',
              text: '',
            },
            threadId: 'thread-shared',
            turnId: 'turn-ws-2',
          },
          '2026-03-27T01:00:12.000Z',
        ),
        seq: 1,
        threadId: 'thread-shared',
        turnId: 'turn-ws-2',
        workspaceId: 'ws-2',
      },
    ])

    const ws1Key = buildThreadStoreKey('ws-1', 'thread-shared')
    const ws2Key = buildThreadStoreKey('ws-2', 'thread-shared')

    expect(nextState.eventsByThread[ws1Key]).toEqual([
      expect.objectContaining({
        turnId: 'turn-ws-1',
        workspaceId: 'ws-1',
      }),
    ])
    expect(nextState.eventsByThread[ws2Key]).toEqual([
      expect.objectContaining({
        turnId: 'turn-ws-2',
        workspaceId: 'ws-2',
      }),
    ])
    expect(nextState.threadActivityByThread[ws1Key]).toMatchObject({
      latestEventMethod: 'item/started',
      threadId: 'thread-shared',
      workspaceId: 'ws-1',
    })
    expect(nextState.threadActivityByThread[ws2Key]).toMatchObject({
      latestEventMethod: 'item/started',
      threadId: 'thread-shared',
      workspaceId: 'ws-2',
    })
    expect(nextState.threadProjectionsById[ws1Key]).toMatchObject({
      turns: [
        {
          id: 'turn-ws-1',
        },
      ],
      workspaceId: 'ws-1',
    })
    expect(nextState.threadProjectionsById[ws2Key]).toMatchObject({
      turns: [
        {
          id: 'turn-ws-2',
        },
      ],
      workspaceId: 'ws-2',
    })
  })

  it('keeps projected realtime items when a summary snapshot arrives without them', () => {
    const currentDetail: ThreadDetail = {
      archived: false,
      createdAt: '2026-03-27T01:00:00.000Z',
      id: 'thread-1',
      name: 'Thread 1',
      status: 'inProgress',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              command: 'npm test',
              aggregatedOutput: 'line 1\nline 2\n',
              status: 'completed',
              clientLiveOutputHydrated: true,
            },
          ],
        },
      ],
      updatedAt: '2026-03-27T01:00:02.000Z',
      workspaceId: 'ws-1',
      clientLiveEventSeq: 12,
      clientProjectionAppliedSeq: 12,
      clientProjectionCompleteness: 'live-only',
      clientProjectionUpdatedAt: '2026-03-27T01:00:02.000Z',
    }

    sessionStoreModule.useSessionStore.setState((state) => ({
      ...state,
      threadProjectionsById: {
        ...state.threadProjectionsById,
        [buildThreadStoreKey('ws-1', 'thread-1')]: currentDetail,
      },
    }))

    sessionStoreModule.useSessionStore
      .getState()
      .syncThreadProjectionSnapshot(
        {
          archived: false,
          createdAt: '2026-03-27T01:00:00.000Z',
          id: 'thread-1',
          name: 'Thread 1',
          status: 'completed',
          turns: [
            {
              id: 'turn-1',
              status: 'completed',
              items: [],
            },
          ],
          updatedAt: '2026-03-27T01:00:03.000Z',
          workspaceId: 'ws-1',
        },
        {
          contentMode: 'summary',
          turnLimit: 40,
        },
      )

    expect(
      sessionStoreModule.useSessionStore.getState().threadProjectionsById[
        buildThreadStoreKey('ws-1', 'thread-1')
      ],
    ).toMatchObject({
      clientLiveEventSeq: 12,
      clientProjectionAppliedSeq: 12,
      clientProjectionCompleteness: 'summary',
      clientProjectionUpdatedAt: '2026-03-27T01:00:02.000Z',
      clientSnapshotContentMode: 'summary',
      clientSnapshotTurnLimit: 40,
      clientSnapshotUpdatedAt: '2026-03-27T01:00:03.000Z',
      turns: [
        {
          id: 'turn-1',
          items: [
            {
              id: 'cmd-1',
              type: 'commandExecution',
              aggregatedOutput: 'line 1\nline 2\n',
              status: 'completed',
            },
          ],
        },
      ],
    })
  })
})
