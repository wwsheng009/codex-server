import { useMemo } from 'react'

import { applyLiveThreadEvents } from '../threadLiveState'
import { useSessionStore } from '../../stores/session-store'
import type { ServerEvent, ThreadDetail } from '../../types/api'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}

export function useThreadPageSessionState({
  isDocumentVisible,
  selectedProcessId,
  selectedThreadId,
  threadDetail,
  workspaceId,
}: {
  isDocumentVisible: boolean
  selectedProcessId?: string
  selectedThreadId?: string
  threadDetail?: ThreadDetail
  workspaceId: string
}) {
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

  const liveThreadDetail = useMemo(
    () => applyLiveThreadEvents(threadDetail, selectedThreadEvents),
    [selectedThreadEvents, threadDetail],
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
