import { useQuery } from '@tanstack/react-query'

import { getRateLimits, rateLimitsQueryKey } from '../../features/account/api'
import { listMcpServerStatus } from '../../features/catalog/api'
import type { ComposerAssistPanel } from './threadPageComposerShared'

export function useThreadPagePanelQueries({
  activeComposerPanel,
  workspaceId,
}: {
  activeComposerPanel: ComposerAssistPanel | null
  workspaceId: string
}) {
  const rateLimitsQuery = useQuery({
    queryKey: rateLimitsQueryKey(workspaceId),
    queryFn: () => getRateLimits(workspaceId),
    staleTime: 15_000,
    enabled: Boolean(workspaceId && activeComposerPanel === 'status'),
  })

  const mcpServerStatusQuery = useQuery({
    queryKey: ['mcp-server-status', workspaceId],
    queryFn: () => listMcpServerStatus(workspaceId),
    enabled: Boolean(workspaceId && activeComposerPanel === 'mcp'),
    staleTime: 30_000,
  })

  return {
    mcpServerStatusQuery,
    rateLimitsQuery,
  }
}
