import { useEffect, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { threadSnapshotFromDetail, updateThreadInThreadCaches } from '../../features/threads/cache'
import { buildShellEnvironmentDiagnosis } from '../../features/settings/shell-environment-diagnostics'
import { useSessionStore } from '../../stores/session-store'
import { useThreadPageBotSendQueries } from './useThreadPageBotSendQueries'
import { useThreadPagePanelQueries } from './useThreadPagePanelQueries'
import { useThreadPageQueries } from './useThreadPageQueries'
import { useThreadPageSelectedThread } from './useThreadPageSelectedThread'
import { useThreadPageSessionState } from './useThreadPageSessionState'
import type { UseThreadPageDataInput } from './threadPageRuntimeTypes'

export function useThreadPageData({
  activeComposerMatchMode,
  activeComposerPanel,
  hasPendingTurn,
  isDocumentVisible,
  normalizedDeferredComposerQuery,
  selectedBotId,
  selectedProcessId,
  selectedThreadId,
  streamState,
  threadTurnWindowSize,
  workspaceId,
}: UseThreadPageDataInput) {
  const queryClient = useQueryClient()
  const {
    accountQuery,
    approvalsQuery,
    commandSessionsQuery,
    environmentConfigQuery,
    fileSearchQuery,
    hookConfigurationQuery,
    hookRunsQuery,
    loadedThreadsQuery,
    modelsQuery,
    resolvedSelectedThreadId,
    skillsQuery,
    threadDetailContentMode,
    threadDetailQuery,
    turnPolicyDecisionsQuery,
    turnPolicyMetricsQuery,
    threadsQuery,
    workspaceRuntimeStateQuery,
    workspaceQuery,
  } = useThreadPageQueries({
    composerFileSearchQuery:
      activeComposerMatchMode === 'mention' ? normalizedDeferredComposerQuery : '',
    hasPendingTurn,
    isDocumentVisible,
    selectedThreadId,
    streamState,
    turnLimit: threadTurnWindowSize,
    workspaceId,
  })

  const { mcpServerStatusQuery, rateLimitsQuery } = useThreadPagePanelQueries({
    activeComposerPanel,
    workspaceId,
  })
  const { botSendBotsQuery, botSendDeliveryTargetsQuery, threadBotBindingQuery } =
    useThreadPageBotSendQueries({
      selectedBotId,
      selectedThreadId: resolvedSelectedThreadId,
      workspaceId,
    })

  const {
    activeCommandCount,
    commandSessionCount,
    commandSessions,
    threadProjection,
    selectedCommandSession,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    workspaceActivityEvents,
    workspaceEvents,
  } = useThreadPageSessionState({
    isDocumentVisible,
    selectedProcessId,
    selectedThreadId: resolvedSelectedThreadId,
    threadDetailContentMode,
    threadDetail: threadDetailQuery.data,
    threadDetailTurnLimit: threadTurnWindowSize,
    workspaceId,
  })

  const selectedThread = useThreadPageSelectedThread({
    selectedThreadId: resolvedSelectedThreadId,
    threadDetail: threadProjection,
    threads: threadsQuery.data,
  })

  const shellEnvironmentPolicy = useMemo(() => {
    const config = environmentConfigQuery.data?.config
    if (!config || typeof config !== 'object') {
      return null
    }

    const value = config['shell_environment_policy']
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }, [environmentConfigQuery.data?.config])

  const shellEnvironmentDiagnosis = useMemo(
    () => buildShellEnvironmentDiagnosis(shellEnvironmentPolicy),
    [shellEnvironmentPolicy],
  )

  useEffect(() => {
    if (!workspaceId || !commandSessionsQuery.isSuccess) {
      return
    }

    useSessionStore
      .getState()
      .syncCommandSessions(workspaceId, commandSessionsQuery.data ?? [])
  }, [commandSessionsQuery.data, commandSessionsQuery.isSuccess, workspaceId])

  useEffect(() => {
    const detail = threadDetailQuery.data
    if (!workspaceId || !detail) {
      return
    }

    updateThreadInThreadCaches(queryClient, workspaceId, threadSnapshotFromDetail(detail))
  }, [queryClient, threadDetailQuery.data, workspaceId])

  return {
    activeCommandCount,
    accountQuery,
    approvalsQuery,
    botSendBotsQuery,
    botSendDeliveryTargetsQuery,
    commandSessionCount,
    commandSessions,
    environmentConfigQuery,
    fileSearchQuery,
    hookConfigurationQuery,
    hookRunsQuery,
    threadProjection,
    loadedThreadsQuery,
    mcpServerStatusQuery,
    modelsQuery,
    rateLimitsQuery,
    resolvedSelectedThreadId,
    selectedCommandSession,
    selectedThread,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    shellEnvironmentDiagnosis,
    shellEnvironmentPolicy,
    skillsQuery,
    threadDetailQuery,
    threadBotBindingQuery,
    turnPolicyDecisionsQuery,
    turnPolicyMetricsQuery,
    threadsQuery,
    workspaceRuntimeStateQuery,
    workspaceActivityEvents,
    workspaceEvents,
    workspaceQuery,
  }
}
