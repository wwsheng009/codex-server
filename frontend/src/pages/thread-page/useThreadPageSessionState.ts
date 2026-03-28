import { useEffect, useMemo, useState } from 'react'

import {
  frontendDebugLog,
  summarizeServerEventForDebug,
  summarizeThreadDetailForDebug,
} from '../../lib/frontend-runtime-mode'
import { resolveLiveThreadDetail } from '../threadLiveState'
import { useSessionStore } from '../../stores/session-store'
import type { ServerEvent, ThreadDetail } from '../../types/api'
import type { UseThreadPageSessionStateInput } from './threadPageRuntimeTypes'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}

export function useThreadPageSessionState({
  isDocumentVisible,
  selectedProcessId,
  selectedThreadId,
  threadDetail,
  workspaceId,
}: UseThreadPageSessionStateInput) {
  const selectedThreadEvents = useSessionStore((state) =>
    !isDocumentVisible || !selectedThreadId
      ? EMPTY_EVENTS
      : state.eventsByThread[selectedThreadId] ?? EMPTY_EVENTS,
  )
  const selectedThreadTokenUsage = useSessionStore((state) =>
    selectedThreadId ? state.tokenUsageByThread[selectedThreadId] ?? null : null,
  )
  const workspaceEvents = useSessionStore((state) =>
    !isDocumentVisible || !workspaceId
      ? EMPTY_EVENTS
      : state.workspaceEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS,
  )
  const workspaceActivityEvents = useSessionStore((state) =>
    !isDocumentVisible || !workspaceId
      ? EMPTY_EVENTS
      : state.activityEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS,
  )
  const workspaceCommandSessions = useSessionStore((state) =>
    !isDocumentVisible || !workspaceId
      ? (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string])
      : workspaceId
      ? state.commandSessionsByWorkspace[workspaceId] ??
        (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string])
      : (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string]),
  )

  const [liveThreadDetailState, setLiveThreadDetailState] = useState<ThreadDetail | undefined>(
    () =>
      resolveLiveThreadDetail({
        currentLiveDetail: undefined,
        events: selectedThreadEvents,
        threadDetail,
      }),
  )

  useEffect(() => {
    setLiveThreadDetailState((current) =>
      resolveLiveThreadDetail({
        currentLiveDetail: current?.id === selectedThreadId ? current : undefined,
        events: selectedThreadEvents,
        threadDetail,
      }),
    )
  }, [selectedThreadEvents, selectedThreadId, threadDetail])

  useEffect(() => {
    if (!selectedThreadId || selectedThreadEvents.length === 0) {
      return
    }

    frontendDebugLog('thread-session', 'selected thread events updated', {
      workspaceId,
      selectedThreadId,
      eventCount: selectedThreadEvents.length,
      latestEvent: summarizeServerEventForDebug(selectedThreadEvents[selectedThreadEvents.length - 1]),
    })
  }, [selectedThreadEvents, selectedThreadId, workspaceId])

  const liveThreadDetail = useMemo(
    () =>
      liveThreadDetailState?.id === (selectedThreadId ?? threadDetail?.id)
        ? liveThreadDetailState
        : resolveLiveThreadDetail({
            currentLiveDetail: undefined,
            events: selectedThreadEvents,
            threadDetail,
          }),
    [liveThreadDetailState, selectedThreadEvents, selectedThreadId, threadDetail],
  )

  const commandSessions = useMemo(
    () =>
      Object.values(workspaceCommandSessions).sort(
        compareCommandSessionsByPriority,
      ),
    [workspaceCommandSessions],
  )

  const selectedCommandSession = useMemo(
    () => commandSessions.find((session) => session.id === selectedProcessId) ?? commandSessions[0],
    [commandSessions, selectedProcessId],
  )
  const commandSessionCount = commandSessions.length
  const activeCommandCount = useMemo(
    () =>
      commandSessions.reduce(
        (total, session) => total + (['running', 'starting'].includes(session.status) ? 1 : 0),
        0,
      ),
    [commandSessions],
  )

  useEffect(() => {
    if (!selectedThreadId || !liveThreadDetail) {
      return
    }

    frontendDebugLog('thread-session', 'live thread detail recalculated', {
      workspaceId,
      selectedThreadId,
      summary: summarizeThreadDetailForDebug(liveThreadDetail),
    })
  }, [liveThreadDetail, selectedThreadId, workspaceId])

  return {
    activeCommandCount,
    commandSessionCount,
    commandSessions,
    liveThreadDetail,
    selectedCommandSession,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    workspaceActivityEvents,
    workspaceEvents,
  }
}

function compareCommandSessionsByPriority(
  left: { pinned?: boolean; updatedAt: string },
  right: { pinned?: boolean; updatedAt: string },
) {
  if (Boolean(left.pinned) !== Boolean(right.pinned)) {
    return left.pinned ? -1 : 1
  }

  if (left.updatedAt === right.updatedAt) {
    return 0
  }

  return left.updatedAt < right.updatedAt ? 1 : -1
}
