import { useThreadPagePanelQueries } from './useThreadPagePanelQueries'
import { useThreadPageQueries } from './useThreadPageQueries'
import { useThreadPageSelectedThread } from './useThreadPageSelectedThread'
import { useThreadPageSessionState } from './useThreadPageSessionState'
import type { ComposerAssistPanel } from './threadPageComposerShared'

export function useThreadPageData({
  activeComposerMatchMode,
  activeComposerPanel,
  hasPendingTurn,
  normalizedDeferredComposerQuery,
  selectedThreadId,
  streamState,
  workspaceId,
}: {
  activeComposerMatchMode?: 'command' | 'mention' | 'skill'
  activeComposerPanel: ComposerAssistPanel | null
  hasPendingTurn: boolean
  normalizedDeferredComposerQuery: string
  selectedThreadId?: string
  streamState: string
  workspaceId: string
}) {
  const {
    accountQuery,
    approvalsQuery,
    fileSearchQuery,
    loadedThreadsQuery,
    modelsQuery,
    skillsQuery,
    threadDetailQuery,
    threadsQuery,
    workspaceQuery,
  } = useThreadPageQueries({
    composerFileSearchQuery:
      activeComposerMatchMode === 'mention' ? normalizedDeferredComposerQuery : '',
    hasPendingTurn,
    selectedThreadId,
    streamState,
    workspaceId,
  })

  const { mcpServerStatusQuery, rateLimitsQuery } = useThreadPagePanelQueries({
    activeComposerPanel,
    workspaceId,
  })

  const {
    commandSessions,
    liveThreadDetail,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    workspaceActivityEvents,
    workspaceEvents,
  } = useThreadPageSessionState({
    selectedThreadId,
    threadDetail: threadDetailQuery.data,
    workspaceId,
  })

  const selectedThread = useThreadPageSelectedThread({
    selectedThreadId,
    threadDetail: threadDetailQuery.data,
    threads: threadsQuery.data,
  })

  return {
    accountQuery,
    approvalsQuery,
    commandSessions,
    fileSearchQuery,
    liveThreadDetail,
    loadedThreadsQuery,
    mcpServerStatusQuery,
    modelsQuery,
    rateLimitsQuery,
    selectedThread,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    skillsQuery,
    threadDetailQuery,
    threadsQuery,
    workspaceActivityEvents,
    workspaceEvents,
    workspaceQuery,
  }
}
