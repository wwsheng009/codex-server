import { useQuery } from '@tanstack/react-query'

import { listCollaborationModes } from '../../features/catalog/api'
import { normalizeCollaborationMode } from './threadPageComposerShared'

export function useThreadPagePlanModeSupport(workspaceId: string) {
  const collaborationModesQuery = useQuery({
    queryKey: ['collaboration-modes', workspaceId],
    queryFn: () => listCollaborationModes(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })

  const supportsPlanMode = (collaborationModesQuery.data ?? []).some(
    (mode) => normalizeCollaborationMode(mode.mode ?? mode.id) === 'plan',
  )

  return {
    collaborationModesQuery,
    supportsPlanMode,
  }
}
