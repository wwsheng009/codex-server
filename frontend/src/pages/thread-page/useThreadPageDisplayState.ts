import { useEffect, useMemo } from 'react'

import { buildThreadPageSelectionDisplayState } from './buildThreadPageSelectionDisplayState'
import { buildThreadPageTurnDisplayState } from './buildThreadPageTurnDisplayState'
import type { ThreadPageDisplayStateInput } from './threadPageDisplayTypes'

export function useThreadPageDisplayState(input: ThreadPageDisplayStateInput) {
  useEffect(() => {
    input.setContextCompactionFeedback(null)
  }, [input.selectedThreadId, input.setContextCompactionFeedback, input.workspaceId])

  const turnDisplayState = useMemo(
    () => buildThreadPageTurnDisplayState(input),
    [
      input.activePendingTurn,
      input.fullTurnItemContentOverridesById,
      input.fullTurnItemOverridesById,
      input.fullTurnOverridesById,
      input.historicalTurns,
      input.liveThreadDetail?.turns,
      input.selectedThreadId,
    ],
  )

  const selectionDisplayState = useMemo(
    () => buildThreadPageSelectionDisplayState(input),
    [
      input.approvals,
      input.contextCompactionFeedback,
      input.liveThreadDetail,
      input.loadedThreadIds,
      input.selectedCommandSession,
      input.selectedThreadEvents,
      input.selectedThreadId,
      input.selectedThreadTokenUsage,
      input.workspaceEvents,
    ],
  )

  return {
    ...selectionDisplayState,
    ...turnDisplayState,
  }
}
