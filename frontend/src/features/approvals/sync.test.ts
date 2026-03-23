import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import { syncApprovalQueriesFromWorkspaceActivity } from './sync'
import type { PendingApproval, ServerEvent } from '../../types/api'

describe('approval workspace sync', () => {
  it('applies live approval events directly into the approvals query cache', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await syncApprovalQueriesFromWorkspaceActivity({
      activityEventsByWorkspace: {
        'ws-1': [
          {
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            method: 'item/tool/requestUserInput',
            payload: {
              questions: [{ id: 'q-1' }],
              threadId: 'thread-1',
            },
            serverRequestId: 'req-1',
            ts: '2026-03-23T12:00:00.000Z',
          },
        ],
      },
      lastProcessedEventKeyByWorkspace: new Map<string, string>(),
      queryClient,
    })

    expect(queryClient.getQueryData<PendingApproval[]>(['approvals', 'ws-1'])).toEqual([
      {
        id: 'req-1',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        kind: 'item/tool/requestUserInput',
        summary: '1 question(s) awaiting user input',
        status: 'pending',
        actions: ['accept', 'decline', 'cancel'],
        details: {
          questions: [{ id: 'q-1' }],
          threadId: 'thread-1',
        },
        requestedAt: '2026-03-23T12:00:00.000Z',
      },
    ])
    expect(invalidateSpy).not.toHaveBeenCalled()
  })

  it('falls back to invalidation when an approval-shaped event cannot be applied locally', async () => {
    const queryClient = new QueryClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    const lastProcessedEventKeyByWorkspace = new Map<string, string>()
    const events: ServerEvent[] = [
      {
        workspaceId: 'ws-1',
        method: 'server/request/resolved',
        payload: {},
        ts: '2026-03-23T12:05:00.000Z',
      },
    ]

    await syncApprovalQueriesFromWorkspaceActivity({
      activityEventsByWorkspace: { 'ws-1': events },
      lastProcessedEventKeyByWorkspace,
      queryClient,
    })
    await syncApprovalQueriesFromWorkspaceActivity({
      activityEventsByWorkspace: { 'ws-1': events },
      lastProcessedEventKeyByWorkspace,
      queryClient,
    })

    expect(invalidateSpy).toHaveBeenCalledTimes(1)
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['approvals', 'ws-1'] })
  })
})
