import { useEffect, useLayoutEffect } from 'react'

import { buildWorkspaceThreadRoute } from '../../lib/thread-routes'
import type { ThreadPageLifecycleEffectsInput } from './threadPageEffectTypes'

export function resolveThreadPageLifecycleSelection({
  currentThreads,
  isThreadDetailLoading,
  isThreadsLoaded,
  latestThreadDetailId,
  routeThreadId,
  selectedThreadId,
  workspaceId,
}: {
  currentThreads: Array<{ id: string }>
  isThreadDetailLoading: boolean
  isThreadsLoaded: boolean
  latestThreadDetailId?: string
  routeThreadId?: string
  selectedThreadId?: string
  workspaceId: string
}) {
  if (!workspaceId || !isThreadsLoaded) {
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
      workspaceId,
    })
    if (!resolution) {
      return
    }

    const { navigateTo, nextThreadId } = resolution
    if (nextThreadId !== selectedThreadId) {
      setSelectedThread(workspaceId, nextThreadId)
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
  ])

  useEffect(() => {
    if (!selectedThreadId || !activePendingTurn?.turnId) {
      return
    }

    const turns = liveThreadTurns ?? []
    if (!turns.some((turn) => turn.id === activePendingTurn.turnId)) {
      return
    }

    const submittedAtMs = new Date(activePendingTurn.submittedAt).getTime()
    const elapsedMs = Number.isNaN(submittedAtMs) ? 700 : Date.now() - submittedAtMs
    const remainingMs = Math.max(0, 700 - elapsedMs)

    if (remainingMs === 0) {
      clearPendingTurn(selectedThreadId)
      return
    }

    const timeoutId = window.setTimeout(() => {
      clearPendingTurn(selectedThreadId)
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [activePendingTurn, clearPendingTurn, liveThreadTurns, selectedThreadId])
}
