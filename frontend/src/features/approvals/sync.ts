import type { QueryClient } from '@tanstack/react-query'

import { shouldRefreshApprovalsForEvent } from '../../pages/threadPageUtils'
import type { ServerEvent } from '../../types/api'
import { applyApprovalEventToCache } from './cache'

export async function syncApprovalQueriesFromWorkspaceActivity(options: {
  activityEventsByWorkspace: Record<string, ServerEvent[]>
  lastProcessedEventKeyByWorkspace: Map<string, string>
  queryClient: Pick<QueryClient, 'invalidateQueries' | 'setQueryData'>
}) {
  const { activityEventsByWorkspace, lastProcessedEventKeyByWorkspace, queryClient } = options
  const activeWorkspaceIds = new Set(Object.keys(activityEventsByWorkspace))

  for (const workspaceId of Array.from(lastProcessedEventKeyByWorkspace.keys())) {
    if (!activeWorkspaceIds.has(workspaceId)) {
      lastProcessedEventKeyByWorkspace.delete(workspaceId)
    }
  }

  for (const [workspaceId, events] of Object.entries(activityEventsByWorkspace)) {
    if (!events.length) {
      continue
    }

    const latestEvent = events[events.length - 1]
    const latestEventKey = buildWorkspaceActivityEventKey(workspaceId, events.length, latestEvent)
    if (lastProcessedEventKeyByWorkspace.get(workspaceId) === latestEventKey) {
      continue
    }

    lastProcessedEventKeyByWorkspace.set(workspaceId, latestEventKey)

    const appliedApprovalEvent = applyApprovalEventToCache(queryClient, workspaceId, latestEvent)
    if (
      !appliedApprovalEvent &&
      shouldRefreshApprovalsForEvent(latestEvent.method, latestEvent.serverRequestId)
    ) {
      await queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    }
  }
}

function buildWorkspaceActivityEventKey(
  workspaceId: string,
  eventCount: number,
  event: Pick<ServerEvent, 'method' | 'serverRequestId' | 'ts'>,
) {
  return `${workspaceId}:${eventCount}:${event.serverRequestId ?? ''}:${event.method}:${event.ts}`
}
