import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

import {
  APPROVALS_QUERY_INVALIDATION_DEBOUNCE_MS,
  refetchApprovalsQueryIfNeeded,
  shouldRefetchApprovalsQuery,
  syncApprovalQueriesFromWorkspaceActivity,
} from './sync'
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
      pendingInvalidationByWorkspace: new Map(),
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

  it('debounces fallback invalidation when approval events cannot be applied locally', async () => {
    vi.useFakeTimers()

    try {
      const invalidateSpy = vi.fn().mockResolvedValue(undefined)
      const queryClient = {
        invalidateQueries: invalidateSpy,
        isFetching: vi.fn().mockReturnValue(0),
        setQueryData: vi.fn(),
      } as unknown as Pick<QueryClient, 'invalidateQueries' | 'isFetching' | 'setQueryData'>
      const lastProcessedEventKeyByWorkspace = new Map<string, string>()
      const pendingInvalidationByWorkspace = new Map()

      syncApprovalQueriesFromWorkspaceActivity({
        activityEventsByWorkspace: {
          'ws-1': [
            {
              workspaceId: 'ws-1',
              method: 'server/request/resolved',
              payload: {},
              ts: '2026-03-23T12:05:00.000Z',
            },
          ],
        },
        lastProcessedEventKeyByWorkspace,
        pendingInvalidationByWorkspace,
        queryClient,
      })
      syncApprovalQueriesFromWorkspaceActivity({
        activityEventsByWorkspace: {
          'ws-1': [
            {
              workspaceId: 'ws-1',
              method: 'server/request/resolved',
              payload: {},
              ts: '2026-03-23T12:05:00.000Z',
            },
            {
              workspaceId: 'ws-1',
              method: 'server/request/resolved',
              payload: {},
              ts: '2026-03-23T12:05:01.000Z',
            },
          ],
        },
        lastProcessedEventKeyByWorkspace,
        pendingInvalidationByWorkspace,
        queryClient,
      })

      expect(invalidateSpy).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(APPROVALS_QUERY_INVALIDATION_DEBOUNCE_MS)

      expect(invalidateSpy).toHaveBeenCalledTimes(1)
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['approvals', 'ws-1'] })
      expect(pendingInvalidationByWorkspace.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('schedules a trailing fallback invalidation when the current approvals refresh is in flight', async () => {
    vi.useFakeTimers()

    try {
      const invalidateControl: { resolve: (() => void) | null } = { resolve: null }
      const invalidateSpy = vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            invalidateControl.resolve = resolve
          }),
      )
      const queryClient = {
        invalidateQueries: invalidateSpy,
        isFetching: vi.fn().mockReturnValue(0),
        setQueryData: vi.fn(),
      } as unknown as Pick<QueryClient, 'invalidateQueries' | 'isFetching' | 'setQueryData'>
      const lastProcessedEventKeyByWorkspace = new Map<string, string>()
      const pendingInvalidationByWorkspace = new Map()
      const firstEvent: ServerEvent = {
        workspaceId: 'ws-1',
        method: 'server/request/resolved',
        payload: {},
        ts: '2026-03-23T12:05:00.000Z',
      }

      syncApprovalQueriesFromWorkspaceActivity({
        activityEventsByWorkspace: { 'ws-1': [firstEvent] },
        lastProcessedEventKeyByWorkspace,
        pendingInvalidationByWorkspace,
        queryClient,
      })

      await vi.advanceTimersByTimeAsync(APPROVALS_QUERY_INVALIDATION_DEBOUNCE_MS)

      expect(invalidateSpy).toHaveBeenCalledTimes(1)

      syncApprovalQueriesFromWorkspaceActivity({
        activityEventsByWorkspace: {
          'ws-1': [
            firstEvent,
            {
              workspaceId: 'ws-1',
              method: 'server/request/resolved',
              payload: {},
              ts: '2026-03-23T12:05:01.000Z',
            },
          ],
        },
        lastProcessedEventKeyByWorkspace,
        pendingInvalidationByWorkspace,
        queryClient,
      })

      expect(invalidateSpy).toHaveBeenCalledTimes(1)

      const resolveCurrentInvalidate = invalidateControl.resolve
      if (resolveCurrentInvalidate) {
        resolveCurrentInvalidate()
      }
      await Promise.resolve()

      expect(invalidateSpy).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(APPROVALS_QUERY_INVALIDATION_DEBOUNCE_MS)

      expect(invalidateSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('skips manual approval refetch while live cache is connected', async () => {
    const queryClient = new QueryClient()
    queryClient.setQueryData<PendingApproval[]>(['approvals', 'ws-1'], [
      {
        id: 'req-1',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        kind: 'item/tool/requestUserInput',
        summary: 'approval',
        status: 'pending',
        actions: ['accept', 'decline', 'cancel'],
        details: null,
        requestedAt: '2026-03-23T12:00:00.000Z',
      },
    ])
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries')

    expect(
      shouldRefetchApprovalsQuery({
        cachedApprovals: queryClient.getQueryData(['approvals', 'ws-1']),
        connectionState: 'open',
      }),
    ).toBe(false)

    await refetchApprovalsQueryIfNeeded({
      connectionState: 'open',
      queryClient,
      workspaceId: 'ws-1',
    })

    expect(refetchSpy).not.toHaveBeenCalled()
  })

  it('keeps manual approval refetch when no live cache coverage exists', async () => {
    const queryClient = new QueryClient()
    const refetchSpy = vi.spyOn(queryClient, 'refetchQueries').mockResolvedValue(undefined)

    expect(
      shouldRefetchApprovalsQuery({
        cachedApprovals: undefined,
        connectionState: 'open',
      }),
    ).toBe(true)

    await refetchApprovalsQueryIfNeeded({
      connectionState: 'closed',
      queryClient,
      workspaceId: 'ws-1',
    })

    expect(refetchSpy).toHaveBeenCalledWith({ queryKey: ['approvals', 'ws-1'] })
  })
})
