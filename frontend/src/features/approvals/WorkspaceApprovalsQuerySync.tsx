import { useEffect, useRef } from 'react'

import { useQueryClient } from '@tanstack/react-query'

import { useSessionStore } from '../../stores/session-store'
import {
  clearPendingApprovalQueryInvalidations,
  syncApprovalQueriesFromWorkspaceActivity,
} from './sync'
import type { ApprovalQueryInvalidationByWorkspace } from './approvalTypes'

export function WorkspaceApprovalsQuerySync() {
  const queryClient = useQueryClient()
  const activityEventsByWorkspace = useSessionStore((state) => state.activityEventsByWorkspace)
  const lastProcessedEventKeyByWorkspaceRef = useRef(new Map<string, string>())
  const pendingInvalidationByWorkspaceRef = useRef<ApprovalQueryInvalidationByWorkspace>(new Map())

  useEffect(() => {
    syncApprovalQueriesFromWorkspaceActivity({
      activityEventsByWorkspace,
      lastProcessedEventKeyByWorkspace: lastProcessedEventKeyByWorkspaceRef.current,
      pendingInvalidationByWorkspace: pendingInvalidationByWorkspaceRef.current,
      queryClient,
    })
  }, [activityEventsByWorkspace, queryClient])

  useEffect(
    () => () => {
      clearPendingApprovalQueryInvalidations(pendingInvalidationByWorkspaceRef.current)
    },
    [],
  )

  return null
}
