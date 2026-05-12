import { useEffect, useRef, useState } from 'react'

import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { UsePendingThreadTurnsInput } from './threadPageRuntimeTypes'

export function usePendingThreadTurns({
  selectedThreadId,
  workspaceId,
}: UsePendingThreadTurnsInput) {
  const [pendingTurnsByThread, setPendingTurnsByThread] = useState<Record<string, PendingThreadTurn>>(
    {},
  )
  const pendingTurnsRef = useRef<Record<string, PendingThreadTurn>>({})

  const activePendingTurn = selectedThreadId ? pendingTurnsByThread[selectedThreadId] ?? null : null

  function clearPendingTurn(threadId: string) {
    const current = pendingTurnsRef.current
    if (!(threadId in current)) {
      return
    }

    const next = { ...current }
    delete next[threadId]
    pendingTurnsRef.current = next
    setPendingTurnsByThread(next)
  }

  function updatePendingTurn(
    threadId: string,
    updater: (current: PendingThreadTurn | null) => PendingThreadTurn | null,
  ) {
    const current = pendingTurnsRef.current
    const nextValue = updater(current[threadId] ?? null)
    if (!nextValue) {
      if (!(threadId in current)) {
        return
      }

      const next = { ...current }
      delete next[threadId]
      pendingTurnsRef.current = next
      setPendingTurnsByThread(next)
      return
    }

    const next = {
      ...current,
      [threadId]: nextValue,
    }
    pendingTurnsRef.current = next
    setPendingTurnsByThread(next)
  }

  function getPendingTurn(threadId: string) {
    return pendingTurnsRef.current[threadId] ?? null
  }

  useEffect(() => {
    pendingTurnsRef.current = {}
    setPendingTurnsByThread({})
  }, [workspaceId])

  return {
    activePendingTurn,
    clearPendingTurn,
    getPendingTurn,
    pendingTurnsByThread,
    updatePendingTurn,
  }
}
