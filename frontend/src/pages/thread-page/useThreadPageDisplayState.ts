import { useEffect, useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import { computeContextUsage } from '../../lib/thread-token-usage'
import { buildLiveTimelineEntries } from '../../components/workspace/timeline-utils'
import type { CommandRuntimeSession } from '../../stores/session-store'
import type {
  PendingApproval,
  ServerEvent,
  Thread,
  ThreadDetail,
  ThreadTokenUsage,
} from '../../types/api'
import { latestSettledMessageKey } from '../threadPageUtils'
import {
  buildPendingThreadTurn,
  type PendingThreadTurn,
} from '../threadPageTurnHelpers'
import { upsertPendingUserMessage } from '../threadLiveState'
import type { ContextCompactionFeedback } from './threadPageComposerShared'

export function useThreadPageDisplayState({
  activePendingTurn,
  approvals,
  commandSessions,
  contextCompactionFeedback,
  liveThreadDetail,
  loadedThreadIds,
  selectedProcessId,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
  selectedThreadTokenUsage,
  setContextCompactionFeedback,
  workspaceEvents,
  workspaceId,
}: {
  activePendingTurn:
    | PendingThreadTurn
    | null
  approvals: PendingApproval[]
  commandSessions: CommandRuntimeSession[]
  contextCompactionFeedback: ContextCompactionFeedback | null
  liveThreadDetail?: ThreadDetail
  loadedThreadIds?: string[]
  selectedProcessId?: string
  selectedThread?: Thread
  selectedThreadEvents: ServerEvent[]
  selectedThreadId?: string
  selectedThreadTokenUsage: ThreadTokenUsage | null
  setContextCompactionFeedback: Dispatch<SetStateAction<ContextCompactionFeedback | null>>
  workspaceEvents: ServerEvent[]
  workspaceId: string
}) {
  useEffect(() => {
    setContextCompactionFeedback(null)
  }, [selectedThreadId, setContextCompactionFeedback, workspaceId])

  const displayedTurns = useMemo(() => {
    const turns = liveThreadDetail?.turns ?? []

    if (!activePendingTurn) {
      return turns
    }

    if (activePendingTurn.turnId && turns.some((turn) => turn.id === activePendingTurn.turnId)) {
      return upsertPendingUserMessage(turns, activePendingTurn)
    }

    return [...turns, buildPendingThreadTurn(activePendingTurn)]
  }, [activePendingTurn, liveThreadDetail?.turns])

  const liveTimelineEntries = useMemo(
    () =>
      buildLiveTimelineEntries(
        [...workspaceEvents, ...selectedThreadEvents].sort(
          (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime(),
        ),
      ),
    [selectedThreadEvents, workspaceEvents],
  )

  const selectedCommandSession = useMemo(
    () => commandSessions.find((session) => session.id === selectedProcessId) ?? commandSessions[0],
    [commandSessions, selectedProcessId],
  )

  const resolvedThreadTokenUsage = liveThreadDetail?.tokenUsage ?? selectedThreadTokenUsage
  const contextUsage = useMemo(
    () => computeContextUsage(resolvedThreadTokenUsage),
    [resolvedThreadTokenUsage],
  )

  const activeContextCompactionFeedback =
    contextCompactionFeedback?.threadId === selectedThreadId ? contextCompactionFeedback : null

  const activeComposerApproval = useMemo(() => {
    if (!approvals.length) {
      return null
    }

    const threadApproval = selectedThreadId
      ? approvals.find((approval) => approval.threadId === selectedThreadId)
      : undefined

    return threadApproval ?? approvals[0]
  }, [approvals, selectedThreadId])

  const latestDisplayedTurn = displayedTurns[displayedTurns.length - 1]

  const isSelectedThreadLoaded = useMemo(() => {
    if (!selectedThreadId) {
      return null
    }

    if (!loadedThreadIds) {
      return null
    }

    return loadedThreadIds.includes(selectedThreadId)
  }, [loadedThreadIds, selectedThreadId])

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

  const settledMessageAutoScrollKey = useMemo(
    () => latestSettledMessageKey(displayedTurns),
    [displayedTurns],
  )

  return {
    activeComposerApproval,
    activeContextCompactionFeedback,
    contextUsage,
    displayedTurns,
    liveTimelineEntries,
    latestDisplayedTurn,
    resolvedThreadTokenUsage,
    selectedCommandSession,
    settledMessageAutoScrollKey,
    threadContentKey,
    timelineItemCount,
    turnCount,
    isSelectedThreadLoaded,
  }
}
