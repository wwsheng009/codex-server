import { useEffect, useLayoutEffect } from 'react'

import { ApiClientError } from '../../lib/api-client'
import { buildWorkspaceThreadRoute } from '../../lib/thread-routes'
import type { ThreadPageLifecycleEffectsInput } from './threadPageEffectTypes'

type PendingTurnLifecycleMatchInput = NonNullable<
  ThreadPageLifecycleEffectsInput['activePendingTurn']
>

type LiveThreadTurnLifecycleMatchInput = NonNullable<
  ThreadPageLifecycleEffectsInput['liveThreadTurns']
>[number]

export function resolveThreadPageLifecycleSelection({
  currentThreads,
  isThreadDetailLoading,
  isThreadsLoaded,
  latestThreadDetailId,
  routeThreadId,
  selectedThreadId,
  workspaceMissing,
  workspaceId,
}: {
  currentThreads: Array<{ id: string }>
  isThreadDetailLoading: boolean
  isThreadsLoaded: boolean
  latestThreadDetailId?: string
  routeThreadId?: string
  selectedThreadId?: string
  workspaceMissing?: boolean
  workspaceId: string
}) {
  if (!workspaceId) {
    return null
  }

  if (workspaceMissing) {
    return {
      navigateTo: '/workspaces',
      nextThreadId: undefined,
    }
  }

  if (!isThreadsLoaded) {
    return null
  }

  if (!currentThreads.length) {
    if (!routeThreadId) {
      return null
    }

    return {
      navigateTo: buildWorkspaceThreadRoute(workspaceId),
      nextThreadId: undefined,
    }
  }

  let nextThreadId = selectedThreadId
  if (!nextThreadId) {
    nextThreadId = currentThreads[0].id
  } else {
    const hasSelectedThread = currentThreads.some((thread) => thread.id === nextThreadId)
    const shouldAwaitRouteThreadDetail =
      routeThreadId === nextThreadId &&
      latestThreadDetailId !== nextThreadId &&
      isThreadDetailLoading

    if (!hasSelectedThread && !shouldAwaitRouteThreadDetail && latestThreadDetailId !== nextThreadId) {
      nextThreadId = currentThreads[0].id
    }
  }

  return {
    navigateTo:
      nextThreadId && routeThreadId !== nextThreadId
        ? buildWorkspaceThreadRoute(workspaceId, nextThreadId)
        : undefined,
    nextThreadId,
  }
}

export function pendingTurnMatchesLiveTurn(
  pendingTurn: PendingTurnLifecycleMatchInput,
  liveTurn: LiveThreadTurnLifecycleMatchInput,
) {
  if (pendingTurn.turnId && liveTurn.id === pendingTurn.turnId) {
    return true
  }

  return Boolean(
    pendingTurn.clientTurnRequestId &&
      liveTurn.clientTurnRequestId === pendingTurn.clientTurnRequestId,
  )
}

export function findMatchingLiveTurnForPendingTurn(
  pendingTurn: PendingTurnLifecycleMatchInput,
  liveThreadTurns: LiveThreadTurnLifecycleMatchInput[] | undefined,
) {
  return (liveThreadTurns ?? []).find((turn) =>
    pendingTurnMatchesLiveTurn(pendingTurn, turn),
  )
}

export function useThreadPageLifecycleEffects({
  activePendingTurn,
  clearPendingTurn,
  currentThreads,
  isThreadDetailLoading,
  isThreadsLoaded,
  latestThreadDetailId,
  liveThreadTurns,
  navigate,
  routeThreadId,
  selectedThreadId,
  setSelectedThread,
  setSelectedWorkspace,
  workspaceError,
  workspaceId,
}: ThreadPageLifecycleEffectsInput) {
  useEffect(() => {
    setSelectedWorkspace(workspaceId)
  }, [setSelectedWorkspace, workspaceId])

  useEffect(() => {
    if (workspaceId && routeThreadId) {
      setSelectedThread(workspaceId, routeThreadId)
    }
  }, [routeThreadId, setSelectedThread, workspaceId])

  useLayoutEffect(() => {
    const resolution = resolveThreadPageLifecycleSelection({
      currentThreads,
      isThreadDetailLoading,
      isThreadsLoaded,
      latestThreadDetailId,
      routeThreadId,
      selectedThreadId,
      workspaceMissing: isWorkspaceNotFoundError(workspaceError),
      workspaceId,
    })
    if (!resolution) {
      return
    }

    const { navigateTo, nextThreadId } = resolution
    if (nextThreadId !== selectedThreadId) {
      setSelectedThread(workspaceId, nextThreadId)
    }

    if (navigateTo === '/workspaces') {
      setSelectedWorkspace(undefined)
    }

    if (navigateTo) {
      navigate(navigateTo, { replace: true })
    }
  }, [
    currentThreads,
    isThreadDetailLoading,
    isThreadsLoaded,
    latestThreadDetailId,
    navigate,
    routeThreadId,
    selectedThreadId,
    setSelectedThread,
    workspaceId,
    workspaceError,
    setSelectedWorkspace,
  ])

  useEffect(() => {
    if (!selectedThreadId || !activePendingTurn) {
      return
    }

    if (!findMatchingLiveTurnForPendingTurn(activePendingTurn, liveThreadTurns)) {
      return
    }

    clearPendingTurn(selectedThreadId)
  }, [activePendingTurn, clearPendingTurn, liveThreadTurns, selectedThreadId])
}

function isWorkspaceNotFoundError(error: unknown) {
  return error instanceof ApiClientError && error.status === 404 && error.code === 'workspace_not_found'
}
