import { describe, expect, it } from 'vitest'

import { ApiClientError } from '../lib/api-client'
import {
  reconcileInterruptedThreadDetail,
  settleInterruptedThreadStatusInList,
  shouldReconcileNoActiveTurn,
  shouldRetryTurnAfterResume,
} from './threadPageTurnHelpers'

describe('threadPageTurnHelpers', () => {
  it('retries turn start after a thread-not-found error', () => {
    const error = new ApiClientError('thread not found', {
      code: 'thread_not_found',
      status: 404,
    })

    expect(shouldRetryTurnAfterResume(error)).toBe(true)
  })

  it('reconciles stale interrupt state when the backend reports no active turn', () => {
    const error = new ApiClientError('no active turn', {
      code: 'no_active_turn',
      status: 409,
    })

    expect(shouldReconcileNoActiveTurn(error)).toBe(true)
  })

  it('does not treat unrelated interrupt errors as a settled turn', () => {
    const error = new ApiClientError('runtime unavailable', {
      code: 'upstream_error',
      status: 502,
    })

    expect(shouldReconcileNoActiveTurn(error)).toBe(false)
  })

  it('optimistically settles stale running turns after interrupt succeeds', () => {
    const reconciled = reconcileInterruptedThreadDetail(
      {
        id: 'thread-1',
        workspaceId: 'ws-1',
        name: 'Thread 1',
        status: 'active',
        archived: false,
        createdAt: '2026-03-28T00:00:00.000Z',
        updatedAt: '2026-03-28T00:00:01.000Z',
        turns: [
          {
            id: 'turn-1',
            status: 'inProgress',
            items: [
              {
                id: 'msg-1',
                type: 'agentMessage',
                phase: 'streaming',
                text: 'partial',
              },
              {
                id: 'cmd-1',
                type: 'commandExecution',
                status: 'inProgress',
              },
            ],
          },
        ],
      },
      '2026-03-28T00:00:05.000Z',
    )

    expect(reconciled?.updatedAt).toBe('2026-03-28T00:00:05.000Z')
    expect(reconciled?.turns[0].status).toBe('interrupted')
    expect(reconciled?.turns[0].items[0]).not.toHaveProperty('phase')
    expect(reconciled?.turns[0].items[1]).toMatchObject({
      status: 'interrupted',
    })
  })

  it('preserves waiting approval turns when a server request is still pending', () => {
    const detail = {
      id: 'thread-1',
      workspaceId: 'ws-1',
      name: 'Thread 1',
      status: 'active',
      archived: false,
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:01.000Z',
      turns: [
        {
          id: 'turn-1',
          status: 'inProgress',
          items: [
            {
              id: 'server-request-1',
              type: 'serverRequest',
              status: 'pending',
            },
          ],
        },
      ],
    }

    expect(reconcileInterruptedThreadDetail(detail, '2026-03-28T00:00:05.000Z')).toBe(detail)
  })

  it('settles running thread list entries back to active after interrupt', () => {
    const updated = settleInterruptedThreadStatusInList(
      [
        {
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Thread 1',
          status: 'running',
          archived: false,
          createdAt: '2026-03-28T00:00:00.000Z',
          updatedAt: '2026-03-28T00:00:01.000Z',
        },
      ],
      'thread-1',
      '2026-03-28T00:00:05.000Z',
    )

    expect(updated?.[0]).toMatchObject({
      status: 'active',
      updatedAt: '2026-03-28T00:00:05.000Z',
    })
  })
})
