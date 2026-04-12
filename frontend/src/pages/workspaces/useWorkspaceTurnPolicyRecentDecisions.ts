import { useQuery } from '@tanstack/react-query'

import { listTurnPolicyDecisions } from '../../features/threads/api'
import { getErrorMessage } from '../../lib/error-utils'
import type { TurnPolicyDecision } from '../../types/api'

export type WorkspaceTurnPolicyDecisionFilters = {
  threadId?: string
  policyName?: string
  action?: string
  actionStatus?: string
  source?: string
  reason?: string
}

type UseWorkspaceTurnPolicyRecentDecisionsInput = {
  selectedWorkspaceId: string
  filters?: WorkspaceTurnPolicyDecisionFilters
  limit?: number
}

type UseWorkspaceTurnPolicyRecentDecisionsResult = {
  turnPolicyDecisions: TurnPolicyDecision[]
  hasAnyDecisions: boolean
  turnPolicyDecisionsLoading: boolean
  turnPolicyDecisionsError: string | null
}

function normalizeFilters(
  filters: WorkspaceTurnPolicyDecisionFilters = {},
): WorkspaceTurnPolicyDecisionFilters {
  return {
    threadId: filters.threadId?.trim() ?? '',
    policyName: filters.policyName?.trim() ?? '',
    action: filters.action?.trim() ?? '',
    actionStatus: filters.actionStatus?.trim() ?? '',
    source: filters.source?.trim() ?? '',
    reason: filters.reason?.trim() ?? '',
  }
}

function hasActiveFilters(filters: WorkspaceTurnPolicyDecisionFilters) {
  return Boolean(
    filters.threadId ||
      filters.policyName ||
      filters.action ||
      filters.actionStatus ||
      filters.source ||
      filters.reason,
  )
}

export function useWorkspaceTurnPolicyRecentDecisions({
  selectedWorkspaceId,
  filters,
  limit = 5,
}: UseWorkspaceTurnPolicyRecentDecisionsInput): UseWorkspaceTurnPolicyRecentDecisionsResult {
  const normalizedFilters = normalizeFilters(filters)
  const filteredView = hasActiveFilters(normalizedFilters)
  const turnPolicyDecisionsQuery = useQuery({
    queryKey: [
      'turn-policy-decisions',
      selectedWorkspaceId,
      'workspace-recent',
      normalizedFilters.threadId,
      normalizedFilters.policyName,
      normalizedFilters.action,
      normalizedFilters.actionStatus,
      normalizedFilters.source,
      normalizedFilters.reason,
      limit,
    ],
    queryFn: () =>
      listTurnPolicyDecisions(selectedWorkspaceId, {
        threadId: normalizedFilters.threadId,
        policyName: normalizedFilters.policyName,
        action: normalizedFilters.action,
        actionStatus: normalizedFilters.actionStatus,
        source: normalizedFilters.source,
        reason: normalizedFilters.reason,
        limit,
      }),
    enabled: Boolean(selectedWorkspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const workspaceDecisionExistenceQuery = useQuery({
    queryKey: ['turn-policy-decisions', selectedWorkspaceId, 'workspace-any'],
    queryFn: () =>
      listTurnPolicyDecisions(selectedWorkspaceId, {
        limit: 1,
      }),
    enabled: Boolean(selectedWorkspaceId) && filteredView,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    turnPolicyDecisions: turnPolicyDecisionsQuery.data ?? [],
    hasAnyDecisions: filteredView
      ? (workspaceDecisionExistenceQuery.data?.length ?? 0) > 0
      : (turnPolicyDecisionsQuery.data?.length ?? 0) > 0,
    turnPolicyDecisionsLoading: turnPolicyDecisionsQuery.isLoading,
    turnPolicyDecisionsError: turnPolicyDecisionsQuery.error
      ? getErrorMessage(turnPolicyDecisionsQuery.error)
      : null,
  }
}
