import { latestSettledMessageKey } from '../threadPageUtils'
import { buildPendingThreadTurn } from '../threadPageTurnHelpers'
import { upsertPendingUserMessage } from '../threadLiveState'
import type { ThreadPageTurnDisplayStateInput } from './threadPageDisplayTypes'

export function buildThreadPageTurnDisplayState({
  activePendingTurn,
  liveThreadDetail,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
}: ThreadPageTurnDisplayStateInput) {
  const turns = liveThreadDetail?.turns ?? []
  const displayedTurns = !activePendingTurn
    ? turns
    : activePendingTurn.turnId && turns.some((turn) => turn.id === activePendingTurn.turnId)
      ? upsertPendingUserMessage(turns, activePendingTurn)
      : [...turns, buildPendingThreadTurn(activePendingTurn)]

  const latestDisplayedTurn = displayedTurns[displayedTurns.length - 1]
  const turnCount = displayedTurns.length
  const timelineItemCount = displayedTurns.reduce((count, turn) => count + turn.items.length, 0)
  const latestThreadEventTs = selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ?? ''
  const threadContentKey = [
    selectedThreadId ?? '',
    turnCount,
    timelineItemCount,
    latestDisplayedTurn?.id ?? '',
    latestDisplayedTurn?.status ?? '',
    latestThreadEventTs,
    activePendingTurn?.phase ?? '',
    activePendingTurn?.turnId ?? '',
    liveThreadDetail?.updatedAt ?? '',
    selectedThread?.updatedAt ?? '',
  ].join('|')

  return {
    displayedTurns,
    latestDisplayedTurn,
    settledMessageAutoScrollKey: latestSettledMessageKey(displayedTurns),
    threadContentKey,
    timelineItemCount,
    turnCount,
  }
}
