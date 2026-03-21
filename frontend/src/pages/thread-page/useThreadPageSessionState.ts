import { useMemo } from 'react'

import { applyLiveThreadEvents } from '../threadLiveState'
import { useSessionStore } from '../../stores/session-store'
import type { ServerEvent, ThreadDetail } from '../../types/api'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}

export function useThreadPageSessionState({
  selectedThreadId,
  threadDetail,
  workspaceId,
}: {
  selectedThreadId?: string
  threadDetail?: ThreadDetail
  workspaceId: string
}) {
  const allThreadEvents = useSessionStore((state) => state.eventsByThread)
  const selectedThreadEvents = useSessionStore((state) =>
    selectedThreadId ? state.eventsByThread[selectedThreadId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const selectedThreadTokenUsage = useSessionStore((state) =>
    selectedThreadId ? state.tokenUsageByThread[selectedThreadId] ?? null : null,
  )
  const workspaceEvents = useSessionStore((state) =>
    workspaceId ? state.workspaceEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceActivityEvents = useSessionStore((state) =>
    workspaceId ? state.activityEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceCommandSessions = useSessionStore((state) =>
    workspaceId
      ? state.commandSessionsByWorkspace[workspaceId] ??
        (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string])
      : (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string]),
  )

  const liveThreadDetail = useMemo(
    () => applyLiveThreadEvents(threadDetail, selectedThreadEvents),
    [selectedThreadEvents, threadDetail],
  )

  const commandSessions = useMemo(
    () =>
      Object.values(workspaceCommandSessions).sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [workspaceCommandSessions],
  )

  return {
    allThreadEvents,
    commandSessions,
    liveThreadDetail,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    workspaceActivityEvents,
    workspaceEvents,
  }
}
