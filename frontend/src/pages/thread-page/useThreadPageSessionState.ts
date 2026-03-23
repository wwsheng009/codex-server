import { useMemo } from 'react'

import { applyLiveThreadEvents } from '../threadLiveState'
import { useSessionStore } from '../../stores/session-store'
import type { ServerEvent, ThreadDetail } from '../../types/api'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}

export function useThreadPageSessionState({
  isDocumentVisible,
  selectedThreadId,
  threadDetail,
  workspaceId,
}: {
  isDocumentVisible: boolean
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
        (left, right) => {
          if (Boolean(left.pinned) !== Boolean(right.pinned)) {
            return left.pinned ? -1 : 1
          }

          return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        },
      ),
    [workspaceCommandSessions],
  )

  return {
    commandSessions,
    liveThreadDetail,
    selectedThreadEvents,
    selectedThreadTokenUsage,
    workspaceActivityEvents,
    workspaceEvents,
  }
}
