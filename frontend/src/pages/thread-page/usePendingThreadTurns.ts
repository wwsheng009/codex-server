import { useEffect, useState } from 'react'

import type { PendingThreadTurn } from '../threadPageTurnHelpers'

export function usePendingThreadTurns({
  selectedThreadId,
  workspaceId,
}: {
  selectedThreadId?: string
  workspaceId: string
}) {
  const [pendingTurnsByThread, setPendingTurnsByThread] = useState<Record<string, PendingThreadTurn>>(
    {},
  )

  const activePendingTurn = selectedThreadId ? pendingTurnsByThread[selectedThreadId] ?? null : null

  function clearPendingTurn(threadId: string) {
    setPendingTurnsByThread((current) => {
      if (!(threadId in current)) {
        return current
      }

      const next = { ...current }
      delete next[threadId]
      return next
    })
  }

  function updatePendingTurn(
    threadId: string,
    updater: (current: PendingThreadTurn | null) => PendingThreadTurn | null,
  ) {
    setPendingTurnsByThread((current) => {
      const nextValue = updater(current[threadId] ?? null)
      if (!nextValue) {
        if (!(threadId in current)) {
          return current
        }

        const next = { ...current }
        delete next[threadId]
        return next
      }

      return {
        ...current,
        [threadId]: nextValue,
      }
    })
  }

  useEffect(() => {
    setPendingTurnsByThread({})
  }, [workspaceId])

  return {
    activePendingTurn,
    clearPendingTurn,
    pendingTurnsByThread,
    updatePendingTurn,
  }
}
