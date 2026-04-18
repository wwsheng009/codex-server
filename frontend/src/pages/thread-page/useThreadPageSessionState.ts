import { useEffect, useMemo } from 'react'

import {
  frontendDebugLog,
  summarizeServerEventForDebug,
  summarizeThreadDetailForDebug,
} from '../../lib/frontend-runtime-mode'
import {
  applyLiveThreadEvents,
  applyThreadEventToDetail,
  reconcileLiveThreadDetailSnapshot,
} from '../threadLiveState'
import { useSessionStore } from '../../stores/session-store'
import type { ServerEvent, ThreadDetail } from '../../types/api'
import type { UseThreadPageSessionStateInput } from './threadPageRuntimeTypes'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}

export function useThreadPageSessionState({
  isDocumentVisible,
  selectedProcessId,
  selectedThreadId,
  threadDetailContentMode,
  threadDetail,
  threadDetailTurnLimit,
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
  const threadProjection = useSessionStore((state) => {
    const projectionThreadId = selectedThreadId ?? threadDetail?.id
    return projectionThreadId ? state.threadProjectionsById[projectionThreadId] : undefined
  })
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

  useEffect(() => {
    if (!threadDetail) {
      return
    }

    useSessionStore.getState().syncThreadProjectionSnapshot(threadDetail, {
      contentMode: threadDetailContentMode,
      turnLimit: threadDetailTurnLimit,
    })
  }, [threadDetail, threadDetailContentMode, threadDetailTurnLimit])

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

  const resolvedThreadProjection = useMemo(() => {
    return resolveThreadPageSessionProjection({
      selectedThreadEvents,
      selectedThreadId,
      threadDetail,
      contentMode: threadDetailContentMode,
      turnLimit: threadDetailTurnLimit,
      threadProjection,
      workspaceId,
    })
  }, [
    selectedThreadEvents,
    selectedThreadId,
    threadProjection,
    threadDetail,
    threadDetailContentMode,
    threadDetailTurnLimit,
    workspaceId,
  ])

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
    if (!selectedThreadId || !resolvedThreadProjection) {
      return
    }

    frontendDebugLog('thread-session', 'live thread detail recalculated', {
      workspaceId,
      selectedThreadId,
      summary: summarizeThreadDetailForDebug(resolvedThreadProjection),
    })
  }, [resolvedThreadProjection, selectedThreadId, workspaceId])

  return {
    activeCommandCount,
    commandSessionCount,
    commandSessions,
    threadProjection: resolvedThreadProjection,
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

type ResolveThreadPageSessionProjectionInput = {
  contentMode?: 'full' | 'summary'
  selectedThreadEvents: ServerEvent[]
  selectedThreadId?: string
  threadDetail?: ThreadDetail
  threadProjection?: ThreadDetail
  turnLimit?: number
  workspaceId: string
}

export function resolveThreadPageSessionProjection({
  contentMode,
  selectedThreadEvents,
  selectedThreadId,
  threadDetail,
  threadProjection,
  turnLimit,
  workspaceId,
}: ResolveThreadPageSessionProjectionInput) {
  if (threadProjection) {
    return threadProjection
  }

  const snapshotProjection = threadDetail
    ? reconcileLiveThreadDetailSnapshot(undefined, threadDetail, {
        contentMode,
        turnLimit,
      })
    : undefined

  if (selectedThreadEvents.length === 0) {
    return snapshotProjection
  }

  if (snapshotProjection) {
    return applyLiveThreadEvents(snapshotProjection, selectedThreadEvents)
  }

  const eventThreadId =
    selectedThreadId ?? threadDetail?.id ?? selectedThreadEvents[selectedThreadEvents.length - 1]?.threadId
  if (!eventThreadId) {
    return undefined
  }

  const placeholderTs = selectedThreadEvents[0]?.ts ?? new Date(0).toISOString()
  return selectedThreadEvents.reduce<ThreadDetail>(
    (current, event) => applyThreadEventToDetail(current, event) ?? current,
    buildBufferedThreadProjectionPlaceholder({
      threadId: eventThreadId,
      ts: placeholderTs,
      workspaceId,
    }),
  )
}

function buildBufferedThreadProjectionPlaceholder({
  threadId,
  ts,
  workspaceId,
}: {
  threadId: string
  ts: string
  workspaceId: string
}): ThreadDetail {
  return {
    archived: false,
    createdAt: ts,
    id: threadId,
    name: '',
    status: 'idle',
    turns: [],
    updatedAt: new Date(0).toISOString(),
    workspaceId,
  }
}
