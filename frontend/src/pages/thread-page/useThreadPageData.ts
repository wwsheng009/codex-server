import { useEffect, useMemo } from 'react'

import { buildShellEnvironmentDiagnosis } from '../../features/settings/shell-environment-diagnostics'
import { useSessionStore } from '../../stores/session-store'
import { useThreadPagePanelQueries } from './useThreadPagePanelQueries'
import { useThreadPageQueries } from './useThreadPageQueries'
import { useThreadPageSelectedThread } from './useThreadPageSelectedThread'
import { useThreadPageSessionState } from './useThreadPageSessionState'
import type { ComposerAssistPanel } from './threadPageComposerShared'

export function useThreadPageData({
  activeComposerMatchMode,
  activeComposerPanel,
  hasPendingTurn,
  isDocumentVisible,
  normalizedDeferredComposerQuery,
  selectedProcessId,
  selectedThreadId,
  streamState,
  threadTurnWindowSize,
  workspaceId,
}: {
  activeComposerMatchMode?: 'command' | 'mention' | 'skill'
  activeComposerPanel: ComposerAssistPanel | null
  hasPendingTurn: boolean
  isDocumentVisible: boolean
  normalizedDeferredComposerQuery: string
  selectedProcessId?: string
  selectedThreadId?: string
  streamState: string
  threadTurnWindowSize: number
  workspaceId: string
}) {
  const {
    accountQuery,
    approvalsQuery,
    commandSessionsQuery,
    environmentConfigQuery,
    fileSearchQuery,
    loadedThreadsQuery,
    modelsQuery,
    resolvedSelectedThreadId,
    skillsQuery,
    threadDetailQuery,
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

  const {
    activeCommandCount,
    commandSessionCount,
    commandSessions,
    liveThreadDetail,
    selectedCommandSession,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    workspaceActivityEvents,
    workspaceEvents,
  } = useThreadPageSessionState({
    isDocumentVisible,
    selectedProcessId,
    selectedThreadId: resolvedSelectedThreadId,
    threadDetail: threadDetailQuery.data,
    workspaceId,
  })

  const selectedThread = useThreadPageSelectedThread({
    selectedThreadId: resolvedSelectedThreadId,
    threadDetail: threadDetailQuery.data,
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

  return {
    activeCommandCount,
    accountQuery,
    approvalsQuery,
    commandSessionCount,
    commandSessions,
    environmentConfigQuery,
    fileSearchQuery,
    liveThreadDetail,
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
    threadsQuery,
    workspaceRuntimeStateQuery,
    workspaceActivityEvents,
    workspaceEvents,
    workspaceQuery,
  }
}
