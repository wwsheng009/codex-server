import type { QueryClient } from '@tanstack/react-query'

import { shouldRefreshApprovalsForEvent } from '../../pages/threadPageUtils'
import type { PendingApproval, ServerEvent } from '../../types/api'
import { applyApprovalEventToCache } from './cache'

export const APPROVALS_QUERY_INVALIDATION_DEBOUNCE_MS = 180

type ApprovalSyncQueryClient = Pick<QueryClient, 'invalidateQueries' | 'isFetching' | 'setQueryData'>
export type ApprovalQueryInvalidationEntry = {
  inFlight: boolean
  needsAnotherPass: boolean
  timerId: ReturnType<typeof setTimeout> | null
}

export type ApprovalQueryInvalidationByWorkspace = Map<
  string,
  ApprovalQueryInvalidationEntry
>

export function syncApprovalQueriesFromWorkspaceActivity(options: {
  activityEventsByWorkspace: Record<string, ServerEvent[]>
  lastProcessedEventKeyByWorkspace: Map<string, string>
  pendingInvalidationByWorkspace: ApprovalQueryInvalidationByWorkspace
  queryClient: ApprovalSyncQueryClient
}) {
  const {
    activityEventsByWorkspace,
    lastProcessedEventKeyByWorkspace,
    pendingInvalidationByWorkspace,
    queryClient,
  } = options
  const activeWorkspaceIds = new Set(Object.keys(activityEventsByWorkspace))

  for (const workspaceId of Array.from(lastProcessedEventKeyByWorkspace.keys())) {
    if (!activeWorkspaceIds.has(workspaceId)) {
      lastProcessedEventKeyByWorkspace.delete(workspaceId)
    }
  }

  for (const [workspaceId, events] of Object.entries(activityEventsByWorkspace)) {
    if (!events.length) {
      continue
    }

    const latestEvent = events[events.length - 1]
    const latestEventKey = buildWorkspaceActivityEventKey(workspaceId, events.length, latestEvent)
    if (lastProcessedEventKeyByWorkspace.get(workspaceId) === latestEventKey) {
      continue
    }

    lastProcessedEventKeyByWorkspace.set(workspaceId, latestEventKey)

    const appliedApprovalEvent = applyApprovalEventToCache(queryClient, workspaceId, latestEvent)
    if (
      !appliedApprovalEvent &&
      shouldRefreshApprovalsForEvent(latestEvent.method, latestEvent.serverRequestId)
    ) {
      scheduleApprovalQueryInvalidation({
        pendingInvalidationByWorkspace,
        queryClient,
        workspaceId,
      })
    }
  }
}

export function clearPendingApprovalQueryInvalidations(
  pendingInvalidationByWorkspace: ApprovalQueryInvalidationByWorkspace,
) {
  for (const entry of pendingInvalidationByWorkspace.values()) {
    if (entry.timerId !== null) {
      clearTimeout(entry.timerId)
    }
  }

  pendingInvalidationByWorkspace.clear()
}

export function shouldRefetchApprovalsQuery(options: {
  cachedApprovals: PendingApproval[] | undefined
  connectionState?: string
}) {
  const { cachedApprovals, connectionState } = options
  if (cachedApprovals === undefined) {
    return true
  }

  return connectionState !== 'connecting' && connectionState !== 'open'
}

export async function refetchApprovalsQueryIfNeeded(options: {
  connectionState?: string
  queryClient: Pick<QueryClient, 'getQueryData' | 'refetchQueries'>
  workspaceId: string
}) {
  const { connectionState, queryClient, workspaceId } = options
  const cachedApprovals = queryClient.getQueryData<PendingApproval[]>(['approvals', workspaceId])
  if (
    !shouldRefetchApprovalsQuery({
      cachedApprovals,
      connectionState,
    })
  ) {
    return
  }

  await queryClient.refetchQueries({ queryKey: ['approvals', workspaceId] })
}

function buildWorkspaceActivityEventKey(
  workspaceId: string,
  eventCount: number,
  event: Pick<ServerEvent, 'method' | 'serverRequestId' | 'ts'>,
) {
  return `${workspaceId}:${eventCount}:${event.serverRequestId ?? ''}:${event.method}:${event.ts}`
}

function scheduleApprovalQueryInvalidation(options: {
  pendingInvalidationByWorkspace: ApprovalQueryInvalidationByWorkspace
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'isFetching'>
  workspaceId: string
}) {
  const { pendingInvalidationByWorkspace, queryClient, workspaceId } = options
  const existingEntry = pendingInvalidationByWorkspace.get(workspaceId)

  if (existingEntry) {
    existingEntry.needsAnotherPass = true
    if (!existingEntry.inFlight && existingEntry.timerId === null) {
      queueApprovalQueryInvalidationFlush({
        entry: existingEntry,
        pendingInvalidationByWorkspace,
        queryClient,
        workspaceId,
      })
    }
    return
  }

  const entry: ApprovalQueryInvalidationEntry = {
    inFlight: false,
    needsAnotherPass: true,
    timerId: null,
  }
  pendingInvalidationByWorkspace.set(workspaceId, entry)
  queueApprovalQueryInvalidationFlush({
    entry,
    pendingInvalidationByWorkspace,
    queryClient,
    workspaceId,
  })
}

function queueApprovalQueryInvalidationFlush(options: {
  entry: ApprovalQueryInvalidationEntry
  pendingInvalidationByWorkspace: ApprovalQueryInvalidationByWorkspace
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'isFetching'>
  workspaceId: string
}) {
  const { entry, pendingInvalidationByWorkspace, queryClient, workspaceId } = options
  if (entry.timerId !== null) {
    clearTimeout(entry.timerId)
  }

  entry.timerId = setTimeout(() => {
    entry.timerId = null
    void flushApprovalQueryInvalidation({
      entry,
      pendingInvalidationByWorkspace,
      queryClient,
      workspaceId,
    })
  }, APPROVALS_QUERY_INVALIDATION_DEBOUNCE_MS)
}

async function flushApprovalQueryInvalidation(options: {
  entry: ApprovalQueryInvalidationEntry
  pendingInvalidationByWorkspace: ApprovalQueryInvalidationByWorkspace
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'isFetching'>
  workspaceId: string
}) {
  const { entry, pendingInvalidationByWorkspace, queryClient, workspaceId } = options
  const queryKey = approvalQueryKey(workspaceId)

  if (queryClient.isFetching({ queryKey }) > 0) {
    queueApprovalQueryInvalidationFlush({
      entry,
      pendingInvalidationByWorkspace,
      queryClient,
      workspaceId,
    })
    return
  }

  if (!entry.needsAnotherPass) {
    pendingInvalidationByWorkspace.delete(workspaceId)
    return
  }

  entry.needsAnotherPass = false
  entry.inFlight = true

  try {
    await queryClient.invalidateQueries({ queryKey })
  } catch {
    // Keep the queue recoverable even if the background refetch fails.
  } finally {
    entry.inFlight = false
  }

  if (entry.needsAnotherPass) {
    queueApprovalQueryInvalidationFlush({
      entry,
      pendingInvalidationByWorkspace,
      queryClient,
      workspaceId,
    })
    return
  }

  pendingInvalidationByWorkspace.delete(workspaceId)
}

function approvalQueryKey(workspaceId: string) {
  return ['approvals', workspaceId] as const
}
