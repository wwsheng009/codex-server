import { useEffect, useLayoutEffect } from 'react'

import { buildWorkspaceThreadRoute } from '../../lib/thread-routes'
import type { ThreadPageLifecycleEffectsInput } from './threadPageEffectTypes'

export function useThreadPageLifecycleEffects({
  activePendingTurn,
  clearPendingTurn,
  currentThreads,
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
    if (!workspaceId) {
      return
    }

    if (!currentThreads.length) {
      if (routeThreadId) {
        setSelectedThread(workspaceId, undefined)
        navigate(buildWorkspaceThreadRoute(workspaceId), { replace: true })
      }
      return
    }

    let nextThreadId = selectedThreadId
    if (!nextThreadId) {
      nextThreadId = currentThreads[0].id
    } else {
      const hasSelectedThread = currentThreads.some((thread) => thread.id === nextThreadId)
      if (!hasSelectedThread && latestThreadDetailId !== nextThreadId) {
        nextThreadId = currentThreads[0].id
      }
    }

    if (nextThreadId !== selectedThreadId) {
      setSelectedThread(workspaceId, nextThreadId)
    }

    if (nextThreadId && routeThreadId !== nextThreadId) {
      navigate(buildWorkspaceThreadRoute(workspaceId, nextThreadId), { replace: true })
    }
  }, [
    currentThreads,
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
