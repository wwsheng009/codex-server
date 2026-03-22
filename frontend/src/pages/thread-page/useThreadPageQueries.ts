import { useQuery } from '@tanstack/react-query'

import { getAccount } from '../../features/account/api'
import { listPendingApprovals } from '../../features/approvals/api'
import { listModels, listSkills } from '../../features/catalog/api'
import { fuzzyFileSearch, readConfig } from '../../features/settings/api'
import { getThread, listLoadedThreadIds, listThreads } from '../../features/threads/api'
import { getWorkspace } from '../../features/workspaces/api'

export function useThreadPageQueries({
  composerFileSearchQuery,
  hasPendingTurn,
  selectedThreadId,
  streamState,
  workspaceId,
}: {
  composerFileSearchQuery: string
  hasPendingTurn: boolean
  selectedThreadId?: string
  streamState: string
  workspaceId: string
}) {
  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: getAccount,
    staleTime: 15_000,
  })

  const threadsQuery = useQuery({
    queryKey: ['threads', workspaceId],
    queryFn: () => listThreads(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const loadedThreadsQuery = useQuery({
    queryKey: ['loaded-threads', workspaceId],
    queryFn: () => listLoadedThreadIds(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: workspaceId && streamState !== 'open' ? 5_000 : false,
    staleTime: 5_000,
  })

  const modelsQuery = useQuery({
    queryKey: ['models', workspaceId],
    queryFn: () => listModels(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  const skillsQuery = useQuery({
    queryKey: ['skills', workspaceId],
    queryFn: () => listSkills(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  const threadDetailQuery = useQuery({
    queryKey: ['thread-detail', workspaceId, selectedThreadId],
    queryFn: () => getThread(workspaceId, selectedThreadId ?? ''),
    enabled: Boolean(workspaceId && selectedThreadId),
    refetchInterval:
      selectedThreadId && hasPendingTurn
        ? 1_000
        : selectedThreadId && streamState !== 'open'
          ? 5_000
          : false,
  })

  const approvalsQuery = useQuery({
    queryKey: ['approvals', workspaceId],
    queryFn: () => listPendingApprovals(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: workspaceId && streamState !== 'open' ? 4_000 : false,
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
    enabled: Boolean(workspaceId),
    staleTime: 15_000,
  })

  return {
    accountQuery,
    approvalsQuery,
    environmentConfigQuery,
    fileSearchQuery,
    loadedThreadsQuery,
    modelsQuery,
    skillsQuery,
    threadDetailQuery,
    threadsQuery,
    workspaceQuery,
  }
}
