import { useEffect, useState } from 'react'

import type { ServerEvent } from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'

const MIN_SEND_FEEDBACK_MS = 700

export function usePendingThreadTurns({
  allThreadEvents,
  selectedThreadId,
  workspaceId,
}: {
  allThreadEvents: Record<string, ServerEvent[] | undefined>
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

  useEffect(() => {
    const entries = Object.values(pendingTurnsByThread)
    if (!entries.length) {
      return
    }

    const timeoutIds: number[] = []

    for (const entry of entries) {
      if (!entry.turnId) {
        continue
      }

      const hasCompletedEvent = (allThreadEvents[entry.threadId] ?? []).some(
        (event) => event.turnId === entry.turnId && event.method === 'turn/completed',
      )
      if (!hasCompletedEvent) {
        continue
      }

      const submittedAtMs = new Date(entry.submittedAt).getTime()
      const elapsedMs = Number.isNaN(submittedAtMs)
        ? MIN_SEND_FEEDBACK_MS
        : Date.now() - submittedAtMs
      const remainingMs = Math.max(0, MIN_SEND_FEEDBACK_MS - elapsedMs)

      if (remainingMs === 0) {
        setPendingTurnsByThread((current) => {
          if (!(entry.threadId in current)) {
            return current
          }

          const next = { ...current }
          delete next[entry.threadId]
          return next
        })
        continue
      }

      timeoutIds.push(
        window.setTimeout(() => {
          setPendingTurnsByThread((current) => {
            if (!(entry.threadId in current)) {
              return current
            }

            const next = { ...current }
            delete next[entry.threadId]
            return next
          })
        }, remainingMs),
      )
    }

    return () => {
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId))
    }
  }, [allThreadEvents, pendingTurnsByThread])

  return {
    activePendingTurn,
    clearPendingTurn,
    pendingTurnsByThread,
    updatePendingTurn,
  }
}
