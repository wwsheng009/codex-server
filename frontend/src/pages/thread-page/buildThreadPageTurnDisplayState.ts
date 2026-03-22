import type { ThreadTurn } from '../../types/api'
import { latestSettledMessageKey } from '../threadPageUtils'
import { buildPendingThreadTurn } from '../threadPageTurnHelpers'
import { upsertPendingUserMessage } from '../threadLiveState'
import type { ThreadPageTurnDisplayStateInput } from './threadPageDisplayTypes'

export function buildThreadPageTurnDisplayState({
  activePendingTurn,
  historicalTurns,
  liveThreadDetail,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
}: ThreadPageTurnDisplayStateInput) {
  const turns = mergeThreadTurnHistory(historicalTurns, liveThreadDetail?.turns ?? [])
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
    oldestDisplayedTurnId: displayedTurns[0]?.id,
    latestDisplayedTurn,
    settledMessageAutoScrollKey: latestSettledMessageKey(displayedTurns),
    threadContentKey,
    timelineItemCount,
    turnCount,
  }
}

function mergeThreadTurnHistory(historicalTurns: ThreadTurn[], liveTurns: ThreadTurn[]) {
  if (!historicalTurns.length) {
    return liveTurns
  }

  if (!liveTurns.length) {
    return historicalTurns
  }

  const seenTurnIds = new Set<string>()
  const mergedTurns: ThreadTurn[] = []

  for (const turn of historicalTurns) {
    if (seenTurnIds.has(turn.id)) {
      continue
    }

    seenTurnIds.add(turn.id)
    mergedTurns.push(turn)
  }

  for (const turn of liveTurns) {
    if (seenTurnIds.has(turn.id)) {
      continue
    }

    seenTurnIds.add(turn.id)
    mergedTurns.push(turn)
  }

  return mergedTurns
}
