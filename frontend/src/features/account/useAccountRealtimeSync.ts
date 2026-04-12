import { useQueryClient } from '@tanstack/react-query'

import { useWorkspaceEventSubscription, useWorkspaceStream } from '../../hooks/useWorkspaceStream'
import { syncAccountQueriesFromEvent } from './realtime'

export function useAccountRealtimeSync(workspaceId?: string) {
  const queryClient = useQueryClient()
  const resolvedWorkspaceId = workspaceId ?? ''

  useWorkspaceStream(resolvedWorkspaceId)
  useWorkspaceEventSubscription(
    resolvedWorkspaceId ? [resolvedWorkspaceId] : undefined,
    (event) => {
      void syncAccountQueriesFromEvent(queryClient, resolvedWorkspaceId, event)
    },
  )
}
