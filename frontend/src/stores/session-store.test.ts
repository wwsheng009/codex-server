import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { ServerEvent } from '../types/api'
import type {
  ApplySessionEventsState,
  CommandRuntimeSession,
} from './session-store-types'

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

    expect(nextState.threadActivityByThread['thread-1']).toEqual({
      latestEventMethod: 'turn/completed',
      latestEventTs: '2026-03-27T01:00:07.000Z',
      latestStatus: 'completed',
      threadId: 'thread-1',
      workspaceId: 'ws-1',
    })
  })
})
