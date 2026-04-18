import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { accountQueryKey, getAccount } from '../../features/account/api'
import { listPendingApprovals } from '../../features/approvals/api'
import { listModels, listSkills } from '../../features/catalog/api'
import { listCommandSessions } from '../../features/commands/api'
import {
  fuzzyFileSearch,
  readConfig,
} from '../../features/settings/api'
import {
  getTurnPolicyMetrics,
  getThread,
  listHookRuns,
  listLoadedThreadIds,
  listThreadsPage,
  listTurnPolicyDecisions,
} from '../../features/threads/api'
import {
  getWorkspace,
  getWorkspaceHookConfiguration,
  getWorkspaceRuntimeState,
} from '../../features/workspaces/api'
import type { PendingApproval } from '../../types/api'
import type { UseThreadPageQueriesInput } from './threadPageRuntimeTypes'

export function useThreadPageQueries({
  composerFileSearchQuery,
  hasPendingTurn,
  isDocumentVisible,
  selectedThreadId,
  streamState,
  turnLimit,
  workspaceId,
}: UseThreadPageQueriesInput) {
  const queryClient = useQueryClient()
  const [areBackgroundQueriesEnabled, setAreBackgroundQueriesEnabled] = useState(false)
  const threadDetailContentMode = resolveThreadDetailContentMode({
    hasPendingTurn,
    isDocumentVisible,
    streamState,
  })

  useEffect(() => {
    if (!workspaceId) {
      setAreBackgroundQueriesEnabled(false)
      return
    }

    setAreBackgroundQueriesEnabled(false)
    if (typeof window === 'undefined') {
      setAreBackgroundQueriesEnabled(true)
      return
    }

    const enableBackgroundQueries = () => {
      setAreBackgroundQueriesEnabled(true)
    }

    if (typeof window.requestIdleCallback === 'function') {
      const idleCallbackId = window.requestIdleCallback(enableBackgroundQueries, {
        timeout: 800,
      })
      return () => {
        window.cancelIdleCallback(idleCallbackId)
      }
    }

    const timeoutId = window.setTimeout(enableBackgroundQueries, 250)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [workspaceId])

  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const workspaceRuntimeStateQuery = useQuery({
    queryKey: ['workspace-runtime-state', workspaceId],
    queryFn: () => getWorkspaceRuntimeState(workspaceId),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 10_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const hookConfigurationQuery = useQuery({
    queryKey: ['workspace-hook-configuration', workspaceId],
    queryFn: () => getWorkspaceHookConfiguration(workspaceId),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const accountQuery = useQuery({
    queryKey: accountQueryKey(workspaceId),
    queryFn: () => getAccount(workspaceId),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const threadsQuery = useQuery({
    queryKey: ['threads', workspaceId],
    queryFn: () =>
      listThreadsPage(workspaceId, {
        archived: false,
        limit: 200,
        preferCached: true,
        sortKey: 'created_at',
      }).then((page) => page.data),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })
  const resolvedSelectedThreadId = selectedThreadId ?? threadsQuery.data?.[0]?.id

  const loadedThreadsQuery = useQuery({
    queryKey: ['loaded-threads', workspaceId],
    queryFn: () => listLoadedThreadIds(workspaceId),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const modelsQuery = useQuery({
    queryKey: ['models', workspaceId],
    queryFn: () => listModels(workspaceId),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const skillsQuery = useQuery({
    queryKey: ['skills', workspaceId],
    queryFn: () => listSkills(workspaceId),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 60_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const threadDetailQuery = useQuery({
    queryKey: [
      'thread-detail',
      workspaceId,
      resolvedSelectedThreadId,
      turnLimit,
      threadDetailContentMode,
    ],
    queryFn: () =>
      getThread(workspaceId, resolvedSelectedThreadId ?? '', {
        contentMode: threadDetailContentMode,
        turnLimit,
      }),
    enabled: Boolean(workspaceId && resolvedSelectedThreadId),
    gcTime: 60_000,
    staleTime: 15_000,
    placeholderData: (previous) =>
      previous?.id === resolvedSelectedThreadId ? previous : undefined,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    refetchInterval:
      isDocumentVisible && resolvedSelectedThreadId && hasPendingTurn && streamState !== 'open'
        ? 1_000
        : false,
  })

  const turnPolicyDecisionsQuery = useQuery({
    queryKey: ['turn-policy-decisions', workspaceId, resolvedSelectedThreadId, 5],
    queryFn: () =>
      listTurnPolicyDecisions(workspaceId, {
        threadId: resolvedSelectedThreadId ?? '',
        limit: 5,
      }),
    enabled: Boolean(workspaceId && resolvedSelectedThreadId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const hookRunsQuery = useQuery({
    queryKey: ['hook-runs', workspaceId, resolvedSelectedThreadId, 5],
    queryFn: () =>
      listHookRuns(workspaceId, {
        threadId: resolvedSelectedThreadId ?? '',
        limit: 5,
      }),
    enabled: Boolean(workspaceId && resolvedSelectedThreadId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const turnPolicyMetricsQuery = useQuery({
    queryKey: ['turn-policy-metrics', workspaceId, resolvedSelectedThreadId],
    queryFn: () =>
      getTurnPolicyMetrics(workspaceId, {
        threadId: resolvedSelectedThreadId ?? '',
      }),
    enabled: Boolean(workspaceId && resolvedSelectedThreadId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const cachedApprovals = queryClient.getQueryData<PendingApproval[]>(['approvals', workspaceId])
  const hasLiveApprovalCache =
    cachedApprovals !== undefined && (streamState === 'connecting' || streamState === 'open')

  const approvalsQuery = useQuery({
    queryKey: ['approvals', workspaceId],
    queryFn: () => listPendingApprovals(workspaceId),
    enabled: Boolean(workspaceId) && !hasLiveApprovalCache,
    staleTime: hasLiveApprovalCache ? Number.POSITIVE_INFINITY : 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const fileSearchQuery = useQuery({
    queryKey: ['composer-file-search', workspaceId, composerFileSearchQuery],
    queryFn: () => fuzzyFileSearch(workspaceId, { query: composerFileSearchQuery }),
    enabled: Boolean(workspaceId && composerFileSearchQuery),
    staleTime: 15_000,
  })

  const environmentConfigQuery = useQuery({
    queryKey: ['thread-page-environment-config', workspaceId],
    queryFn: () => readConfig(workspaceId, { includeLayers: false }),
    enabled: Boolean(workspaceId) && areBackgroundQueriesEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const shouldUseCommandSessionsFallbackQuery =
    streamState === 'closed' || streamState === 'error'

  const commandSessionsQuery = useQuery({
    queryKey: ['command-sessions', workspaceId],
    queryFn: () => listCommandSessions(workspaceId),
    enabled: Boolean(workspaceId) && shouldUseCommandSessionsFallbackQuery,
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  return {
    accountQuery,
    approvalsQuery,
    commandSessionsQuery,
    environmentConfigQuery,
    fileSearchQuery,
    hookRunsQuery,
    hookConfigurationQuery,
    loadedThreadsQuery,
    modelsQuery,
    resolvedSelectedThreadId,
    skillsQuery,
    threadDetailQuery,
    threadDetailContentMode,
    turnPolicyDecisionsQuery,
    turnPolicyMetricsQuery,
    threadsQuery,
    workspaceRuntimeStateQuery,
    workspaceQuery,
  }
}

function resolveThreadDetailContentMode({
  hasPendingTurn,
  isDocumentVisible,
  streamState,
}: Pick<
  UseThreadPageQueriesInput,
  'hasPendingTurn' | 'isDocumentVisible' | 'streamState'
>) {
  if (!isDocumentVisible) {
    return 'summary' as const
  }

  if (hasPendingTurn || streamState === 'connecting' || streamState === 'open') {
    return 'full' as const
  }

  return 'summary' as const
}
