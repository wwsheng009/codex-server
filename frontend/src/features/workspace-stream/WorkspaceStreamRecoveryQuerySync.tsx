import { useEffect, useRef } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import {
  readWorkspaceStreamRecoveryRequiredDetail,
  WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT,
  type WorkspaceStreamRecoveryRequiredDetail,
} from '../../lib/workspace-stream-recovery'

export const workspaceStreamRecoveryInvalidationDebounceMs = 750

export type WorkspaceStreamRecoveryScheduledInvalidation = {
  detail: WorkspaceStreamRecoveryRequiredDetail
  timerId: ReturnType<typeof setTimeout>
}

export function WorkspaceStreamRecoveryQuerySync() {
  const queryClient = useQueryClient()
  const pendingInvalidationsRef = useRef(
    new Map<string, WorkspaceStreamRecoveryScheduledInvalidation>(),
  )

  useEffect(() => {
    const handleRecoveryRequired = (event: Event) => {
      const detail = readWorkspaceStreamRecoveryRequiredDetail(event)
      if (!detail) {
        return
      }

      scheduleWorkspaceStreamRecoveryQueryInvalidation(
        queryClient,
        detail,
        {
          pendingByWorkspace: pendingInvalidationsRef.current,
        },
      )
    }

    window.addEventListener(
      WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT,
      handleRecoveryRequired,
    )
    return () => {
      window.removeEventListener(
        WORKSPACE_STREAM_RECOVERY_REQUIRED_EVENT,
        handleRecoveryRequired,
      )
      clearWorkspaceStreamRecoveryQueryInvalidations(
        pendingInvalidationsRef.current,
      )
    }
  }, [queryClient])

  return null
}

export function scheduleWorkspaceStreamRecoveryQueryInvalidation(
  queryClient: QueryClient,
  detail: WorkspaceStreamRecoveryRequiredDetail,
  options: {
    clearTimeoutFn?: typeof clearTimeout
    debounceMs?: number
    invalidate?: typeof invalidateWorkspaceStreamRecoveryQueries
    pendingByWorkspace: Map<string, WorkspaceStreamRecoveryScheduledInvalidation>
    setTimeoutFn?: typeof setTimeout
  },
) {
  const workspaceId = detail.workspaceId.trim()
  if (!workspaceId) {
    return false
  }

  const {
    clearTimeoutFn = clearTimeout,
    debounceMs = workspaceStreamRecoveryInvalidationDebounceMs,
    invalidate = invalidateWorkspaceStreamRecoveryQueries,
    pendingByWorkspace,
    setTimeoutFn = setTimeout,
  } = options
  const normalizedDetail: WorkspaceStreamRecoveryRequiredDetail = {
    ...detail,
    workspaceId,
  }
  const existing = pendingByWorkspace.get(workspaceId)
  if (existing) {
    clearTimeoutFn(existing.timerId)
  }

  const timerId = setTimeoutFn(() => {
    pendingByWorkspace.delete(workspaceId)
    void invalidate(queryClient, normalizedDetail)
  }, debounceMs)
  pendingByWorkspace.set(workspaceId, {
    detail: normalizedDetail,
    timerId,
  })
  return true
}

export function clearWorkspaceStreamRecoveryQueryInvalidations(
  pendingByWorkspace: Map<string, WorkspaceStreamRecoveryScheduledInvalidation>,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
) {
  for (const pending of pendingByWorkspace.values()) {
    clearTimeoutFn(pending.timerId)
  }
  pendingByWorkspace.clear()
}

export async function invalidateWorkspaceStreamRecoveryQueries(
  queryClient: QueryClient,
  detail: WorkspaceStreamRecoveryRequiredDetail,
) {
  const workspaceId = detail.workspaceId.trim()
  if (!workspaceId) {
    return
  }

  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['command-sessions', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['workspace-hook-configuration', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['hook-runs', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['turn-policy-decisions', workspaceId] }),
    queryClient.invalidateQueries({ queryKey: ['turn-policy-metrics', workspaceId] }),
  ])
}
