import { useEffect, useRef } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { useSessionStore } from '../../stores/session-store'
import { syncApprovalQueriesFromWorkspaceActivity } from './sync'

export function WorkspaceApprovalsQuerySync() {
  const queryClient = useQueryClient()
  const activityEventsByWorkspace = useSessionStore((state) => state.activityEventsByWorkspace)
  const lastProcessedEventKeyByWorkspaceRef = useRef(new Map<string, string>())

  useEffect(() => {
    void syncApprovalQueriesFromWorkspaceActivity({
      activityEventsByWorkspace,
      lastProcessedEventKeyByWorkspace: lastProcessedEventKeyByWorkspaceRef.current,
      queryClient,
    })
  }, [activityEventsByWorkspace, queryClient])

  return null
}
