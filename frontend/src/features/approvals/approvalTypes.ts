import type { QueryClient } from '@tanstack/react-query'

import type { PendingApproval } from '../../types/api'

export type ApprovalCacheQueryClient = {
  setQueryData: QueryClient['setQueryData']
}

export type ApprovalQueryInvalidationClient = {
  invalidateQueries: QueryClient['invalidateQueries']
  isFetching: QueryClient['isFetching']
}

export type ApprovalSyncQueryClient =
  ApprovalCacheQueryClient & ApprovalQueryInvalidationClient

export type ApprovalRefetchQueryClient = {
  getQueryData: QueryClient['getQueryData']
  refetchQueries: QueryClient['refetchQueries']
}

export type ApprovalWorkspaceActivityEventSummary = {
  method: string
  serverRequestId?: string | null
  ts: string
}

export type ApprovalBuilderOverrides = Partial<PendingApproval> & {
  id: string
}

export type SyncApprovalQueriesFromWorkspaceActivityInput = {
  activityEventsByWorkspace: Record<string, import('../../types/api').ServerEvent[]>
  lastProcessedEventKeyByWorkspace: Map<string, string>
  pendingInvalidationByWorkspace: Map<string, import('./sync').ApprovalQueryInvalidationEntry>
  queryClient: ApprovalSyncQueryClient
}

export type ShouldRefetchApprovalsQueryInput = {
  cachedApprovals: PendingApproval[] | undefined
  connectionState?: string
}

export type RefetchApprovalsQueryIfNeededInput = {
  connectionState?: string
  queryClient: ApprovalRefetchQueryClient
  workspaceId: string
}

export type ScheduleApprovalQueryInvalidationInput = {
  pendingInvalidationByWorkspace: Map<string, import('./sync').ApprovalQueryInvalidationEntry>
  queryClient: ApprovalQueryInvalidationClient
  workspaceId: string
}

export type QueueApprovalQueryInvalidationFlushInput = {
  entry: import('./sync').ApprovalQueryInvalidationEntry
  pendingInvalidationByWorkspace: Map<string, import('./sync').ApprovalQueryInvalidationEntry>
  queryClient: ApprovalQueryInvalidationClient
  workspaceId: string
}

export type FlushApprovalQueryInvalidationInput = {
  entry: import('./sync').ApprovalQueryInvalidationEntry
  pendingInvalidationByWorkspace: Map<string, import('./sync').ApprovalQueryInvalidationEntry>
  queryClient: ApprovalQueryInvalidationClient
  workspaceId: string
}
