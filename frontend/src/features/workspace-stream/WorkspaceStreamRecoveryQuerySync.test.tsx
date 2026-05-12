import { QueryClient } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clearWorkspaceStreamRecoveryQueryInvalidations,
  invalidateWorkspaceStreamRecoveryQueries,
  scheduleWorkspaceStreamRecoveryQueryInvalidation,
  type WorkspaceStreamRecoveryScheduledInvalidation,
} from './WorkspaceStreamRecoveryQuerySync'

describe('invalidateWorkspaceStreamRecoveryQueries', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('invalidates workspace and thread snapshot fallback query families', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await invalidateWorkspaceStreamRecoveryQueries(queryClient, {
      afterSeq: 5,
      currentSeq: 5,
      reason: 'replay-incomplete-stalled',
      workspaceId: ' ws-1 ',
    })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['threads', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['shell-threads', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['loaded-threads', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['thread-detail', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['approvals', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['command-sessions', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['workspace-hook-configuration', 'ws-1'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['hook-runs', 'ws-1'] })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['turn-policy-decisions', 'ws-1'],
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['turn-policy-metrics', 'ws-1'],
    })
  })

  it('ignores empty workspace ids', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    await invalidateWorkspaceStreamRecoveryQueries(queryClient, {
      reason: 'replay-retention-gap',
      workspaceId: '   ',
    })

    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('debounces repeated recovery invalidations for the same workspace', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.fn().mockResolvedValue(undefined)
    const pendingByWorkspace = new Map<
      string,
      WorkspaceStreamRecoveryScheduledInvalidation
    >()

    const firstScheduled = scheduleWorkspaceStreamRecoveryQueryInvalidation(
      queryClient,
      {
        afterSeq: 5,
        currentSeq: 5,
        reason: 'replay-incomplete-stalled',
        workspaceId: ' ws-1 ',
      },
      {
        debounceMs: 50,
        invalidate,
        pendingByWorkspace,
      },
    )
    const secondScheduled = scheduleWorkspaceStreamRecoveryQueryInvalidation(
      queryClient,
      {
        afterSeq: 8,
        currentSeq: 8,
        reason: 'replay-retention-gap',
        workspaceId: 'ws-1',
      },
      {
        debounceMs: 50,
        invalidate,
        pendingByWorkspace,
      },
    )

    expect(firstScheduled).toBe(true)
    expect(secondScheduled).toBe(true)
    expect(pendingByWorkspace.size).toBe(1)
    expect(invalidate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(49)
    expect(invalidate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith(
      queryClient,
      expect.objectContaining({
        afterSeq: 8,
        currentSeq: 8,
        reason: 'replay-retention-gap',
        workspaceId: 'ws-1',
      }),
    )
    expect(pendingByWorkspace.size).toBe(0)
  })

  it('keeps recovery invalidation timers isolated by workspace and clears pending timers', async () => {
    vi.useFakeTimers()
    const queryClient = new QueryClient()
    const invalidate = vi.fn().mockResolvedValue(undefined)
    const pendingByWorkspace = new Map<
      string,
      WorkspaceStreamRecoveryScheduledInvalidation
    >()

    scheduleWorkspaceStreamRecoveryQueryInvalidation(
      queryClient,
      {
        reason: 'replay-incomplete-stalled',
        workspaceId: 'ws-1',
      },
      {
        debounceMs: 50,
        invalidate,
        pendingByWorkspace,
      },
    )
    scheduleWorkspaceStreamRecoveryQueryInvalidation(
      queryClient,
      {
        reason: 'replay-retention-gap',
        workspaceId: 'ws-2',
      },
      {
        debounceMs: 50,
        invalidate,
        pendingByWorkspace,
      },
    )

    expect(pendingByWorkspace.size).toBe(2)
    clearWorkspaceStreamRecoveryQueryInvalidations(pendingByWorkspace)
    expect(pendingByWorkspace.size).toBe(0)

    await vi.advanceTimersByTimeAsync(50)
    expect(invalidate).not.toHaveBeenCalled()
  })
})
