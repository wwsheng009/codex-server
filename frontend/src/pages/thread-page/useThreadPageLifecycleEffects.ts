import { useEffect, useLayoutEffect } from 'react'

import type { ThreadPageLifecycleEffectsInput } from './threadPageEffectTypes'

export function useThreadPageLifecycleEffects({
  activePendingTurn,
  clearPendingTurn,
  currentThreads,
  latestThreadDetailId,
  liveThreadTurns,
  selectedThreadId,
  setSelectedThread,
  setSelectedWorkspace,
  workspaceId,
}: ThreadPageLifecycleEffectsInput) {
  useEffect(() => {
    setSelectedWorkspace(workspaceId)
  }, [setSelectedWorkspace, workspaceId])

  useLayoutEffect(() => {
    if (!currentThreads.length) {
      return
    }

    if (!selectedThreadId) {
      setSelectedThread(workspaceId, currentThreads[0].id)
      return
    }

    const hasSelectedThread = currentThreads.some((thread) => thread.id === selectedThreadId)
    if (!hasSelectedThread && latestThreadDetailId !== selectedThreadId) {
      setSelectedThread(workspaceId, currentThreads[0].id)
    }
  }, [
    currentThreads,
    latestThreadDetailId,
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
