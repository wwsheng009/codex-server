import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { decodeBase64 } from '../components/thread/threadRender'
import { readThreadTokenUsageFromEvent } from '../lib/thread-token-usage'
import { getSelectedThreadIdForWorkspace } from './session-store-utils'
import type { CommandSession, ServerEvent, ThreadTokenUsage } from '../types/api'

export type CommandRuntimeSession = CommandSession & {
  combinedOutput: string
  stdout: string
  stderr: string
  exitCode?: number | null
  error?: string | null
  updatedAt: string
}

export type ThreadActivitySummary = {
  latestEventMethod: string
  latestEventTs: string
  latestStatus?: string
  threadId: string
  workspaceId: string
}

const ACTIVE_THREAD_EVENT_LIMIT = 80
const INACTIVE_THREAD_EVENT_LIMIT = 6
const WORKSPACE_EVENT_LIMIT = 40
const WORKSPACE_ACTIVITY_EVENT_LIMIT = 60

type SessionState = {
  hasHydrated: boolean
  selectedWorkspaceId?: string
  selectedThreadId?: string
  selectedThreadIdByWorkspace: Record<string, string>
  eventsByThread: Record<string, ServerEvent[]>
  threadActivityByThread: Record<string, ThreadActivitySummary>
  workspaceEventsByWorkspace: Record<string, ServerEvent[]>
  activityEventsByWorkspace: Record<string, ServerEvent[]>
  connectionByWorkspace: Record<string, string>
  commandSessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>
  tokenUsageByThread: Record<string, ThreadTokenUsage>
  setSelectedWorkspace: (workspaceId?: string) => void
  setSelectedThread: (workspaceId?: string, threadId?: string) => void
  setConnectionState: (workspaceId: string, state: string) => void
  ingestEvent: (event: ServerEvent) => void
  upsertCommandSession: (session: CommandSession) => void
  removeCommandSession: (workspaceId: string, processId: string) => void
  clearCompletedCommandSessions: (workspaceId: string) => void
  removeWorkspace: (workspaceId: string) => void
  removeThread: (workspaceId: string, threadId: string) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      selectedWorkspaceId: undefined,
      selectedThreadId: undefined,
      selectedThreadIdByWorkspace: {},
      eventsByThread: {},
      threadActivityByThread: {},
      workspaceEventsByWorkspace: {},
      activityEventsByWorkspace: {},
      connectionByWorkspace: {},
      commandSessionsByWorkspace: {},
      tokenUsageByThread: {},
      setSelectedWorkspace: (workspaceId) =>
        set((current) => ({
          selectedWorkspaceId: workspaceId,
          selectedThreadId: getSelectedThreadIdForWorkspace(current, workspaceId),
        })),
      setSelectedThread: (workspaceId, threadId) =>
        set((current) => {
          const nextByWorkspace = { ...current.selectedThreadIdByWorkspace }

          if (workspaceId && threadId) {
            nextByWorkspace[workspaceId] = threadId
          } else if (workspaceId && !threadId) {
            delete nextByWorkspace[workspaceId]
          }

          return {
            selectedThreadId:
              current.selectedWorkspaceId === workspaceId ? threadId : current.selectedThreadId,
            selectedThreadIdByWorkspace: nextByWorkspace,
          }
        }),
      setConnectionState: (workspaceId, state) =>
        set((current) => ({
          connectionByWorkspace: {
            ...current.connectionByWorkspace,
            [workspaceId]: state,
          },
        })),
      upsertCommandSession: (session) =>
        set((current) => ({
          commandSessionsByWorkspace: mergeCommandSession(current.commandSessionsByWorkspace, {
            ...session,
            combinedOutput: '',
            stdout: '',
            stderr: '',
            updatedAt: new Date().toISOString(),
          }),
        })),
      removeCommandSession: (workspaceId, processId) =>
        set((current) => ({
          commandSessionsByWorkspace: removeCommandSession(
            current.commandSessionsByWorkspace,
            workspaceId,
            processId,
          ),
        })),
      clearCompletedCommandSessions: (workspaceId) =>
        set((current) => ({
          commandSessionsByWorkspace: clearCompletedCommandSessions(
            current.commandSessionsByWorkspace,
            workspaceId,
          ),
        })),
      removeWorkspace: (workspaceId) =>
        set((current) => {
          const nextSelectedThreadIdByWorkspace = { ...current.selectedThreadIdByWorkspace }
          const removedSelectedThreadId = nextSelectedThreadIdByWorkspace[workspaceId]
          delete nextSelectedThreadIdByWorkspace[workspaceId]

          const nextWorkspaceEvents = { ...current.workspaceEventsByWorkspace }
          delete nextWorkspaceEvents[workspaceId]

          const nextActivityEvents = { ...current.activityEventsByWorkspace }
          delete nextActivityEvents[workspaceId]

          const nextConnectionByWorkspace = { ...current.connectionByWorkspace }
          delete nextConnectionByWorkspace[workspaceId]

          const nextCommandSessionsByWorkspace = { ...current.commandSessionsByWorkspace }
          delete nextCommandSessionsByWorkspace[workspaceId]

          const nextThreadActivityByThread = { ...current.threadActivityByThread }
          const nextEventsByThread = { ...current.eventsByThread }
          const nextTokenUsageByThread = { ...current.tokenUsageByThread }

          for (const [threadId, summary] of Object.entries(current.threadActivityByThread)) {
            if (summary.workspaceId !== workspaceId) {
              continue
            }

            delete nextThreadActivityByThread[threadId]
            delete nextEventsByThread[threadId]
            delete nextTokenUsageByThread[threadId]
          }

          if (removedSelectedThreadId) {
            delete nextEventsByThread[removedSelectedThreadId]
            delete nextTokenUsageByThread[removedSelectedThreadId]
          }

          return {
            selectedWorkspaceId:
              current.selectedWorkspaceId === workspaceId ? undefined : current.selectedWorkspaceId,
            selectedThreadId:
              current.selectedWorkspaceId === workspaceId ? undefined : current.selectedThreadId,
            selectedThreadIdByWorkspace: nextSelectedThreadIdByWorkspace,
            workspaceEventsByWorkspace: nextWorkspaceEvents,
            activityEventsByWorkspace: nextActivityEvents,
            connectionByWorkspace: nextConnectionByWorkspace,
            commandSessionsByWorkspace: nextCommandSessionsByWorkspace,
            eventsByThread: nextEventsByThread,
            threadActivityByThread: nextThreadActivityByThread,
            tokenUsageByThread: nextTokenUsageByThread,
          }
        }),
      removeThread: (workspaceId, threadId) =>
        set((current) => {
          const nextSelectedThreadIdByWorkspace = { ...current.selectedThreadIdByWorkspace }
          if (nextSelectedThreadIdByWorkspace[workspaceId] === threadId) {
            delete nextSelectedThreadIdByWorkspace[workspaceId]
          }

          const nextEventsByThread = { ...current.eventsByThread }
          delete nextEventsByThread[threadId]

          const nextThreadActivityByThread = { ...current.threadActivityByThread }
          delete nextThreadActivityByThread[threadId]

          const nextTokenUsageByThread = { ...current.tokenUsageByThread }
          delete nextTokenUsageByThread[threadId]

          return {
            selectedThreadId:
              current.selectedWorkspaceId === workspaceId && current.selectedThreadId === threadId
                ? undefined
                : current.selectedThreadId,
            selectedThreadIdByWorkspace: nextSelectedThreadIdByWorkspace,
            eventsByThread: nextEventsByThread,
            threadActivityByThread: nextThreadActivityByThread,
            tokenUsageByThread: nextTokenUsageByThread,
          }
        }),
      ingestEvent: (event) =>
        set((current) => {
          const nextCommandSessions = applyCommandEvent(current.commandSessionsByWorkspace, event)
          const nextThreadActivity = applyThreadActivityEvent(
            current.threadActivityByThread,
            event,
          )
          const nextTokenUsage = applyTokenUsageEvent(current.tokenUsageByThread, event)
          const nextActivityEvents = {
            ...current.activityEventsByWorkspace,
            [event.workspaceId]: [
              ...(current.activityEventsByWorkspace[event.workspaceId] ?? []),
              event,
            ].slice(-WORKSPACE_ACTIVITY_EVENT_LIMIT),
          }
          if (!event.threadId) {
            return {
              activityEventsByWorkspace: nextActivityEvents,
              commandSessionsByWorkspace: nextCommandSessions,
              threadActivityByThread: nextThreadActivity,
              tokenUsageByThread: nextTokenUsage,
              workspaceEventsByWorkspace: {
                ...current.workspaceEventsByWorkspace,
                [event.workspaceId]: [
                  ...(current.workspaceEventsByWorkspace[event.workspaceId] ?? []),
                  event,
                ].slice(-WORKSPACE_EVENT_LIMIT),
              },
            }
          }

          const currentEvents = current.eventsByThread[event.threadId] ?? []
          const selectedThreadIdForWorkspace = current.selectedThreadIdByWorkspace[event.workspaceId]
          const eventLimit =
            selectedThreadIdForWorkspace === event.threadId
              ? ACTIVE_THREAD_EVENT_LIMIT
              : INACTIVE_THREAD_EVENT_LIMIT

          return {
            activityEventsByWorkspace: nextActivityEvents,
            commandSessionsByWorkspace: nextCommandSessions,
            threadActivityByThread: nextThreadActivity,
            tokenUsageByThread: nextTokenUsage,
            eventsByThread: {
              ...current.eventsByThread,
              [event.threadId]: [...currentEvents, event].slice(-eventLimit),
            },
          }
        }),
    }),
    {
      name: 'codex-server-session-store',
      onRehydrateStorage: () => () => {
        useSessionStore.setState({ hasHydrated: true })
      },
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        selectedWorkspaceId: state.selectedWorkspaceId,
        selectedThreadId: state.selectedThreadId,
        selectedThreadIdByWorkspace: state.selectedThreadIdByWorkspace,
        tokenUsageByThread: state.tokenUsageByThread,
      }),
    },
  ),
)

function applyCommandEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  switch (event.method) {
    case 'command/exec/started':
      if (!isCommandSession(event.payload)) {
        return sessionsByWorkspace
      }
      return mergeCommandSession(sessionsByWorkspace, {
        ...event.payload,
        combinedOutput: '',
        stdout: '',
        stderr: '',
        updatedAt: event.ts,
      })
    case 'command/exec/outputDelta':
      return appendCommandOutput(sessionsByWorkspace, event)
    case 'command/exec/completed':
      return completeCommandSession(sessionsByWorkspace, event)
    default:
      return sessionsByWorkspace
  }
}

function applyThreadActivityEvent(
  threadActivityByThread: Record<string, ThreadActivitySummary>,
  event: ServerEvent,
) {
  if (!event.threadId) {
    return threadActivityByThread
  }

  const nextStatus = readThreadActivityStatus(event)
  const current = threadActivityByThread[event.threadId]

  return {
    ...threadActivityByThread,
    [event.threadId]: {
      latestEventMethod: event.method,
      latestEventTs: event.ts,
      latestStatus: nextStatus || current?.latestStatus,
      threadId: event.threadId,
      workspaceId: event.workspaceId,
    },
  }
}

function applyTokenUsageEvent(
  tokenUsageByThread: Record<string, ThreadTokenUsage>,
  event: ServerEvent,
) {
  const parsed = readThreadTokenUsageFromEvent(event)
  if (!parsed) {
    return tokenUsageByThread
  }

  return {
    ...tokenUsageByThread,
    [parsed.threadId]: parsed.usage,
  }
}

function mergeCommandSession(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  session: CommandRuntimeSession,
) {
  const workspaceSessions = sessionsByWorkspace[session.workspaceId] ?? {}
  const current = workspaceSessions[session.id]

  return {
    ...sessionsByWorkspace,
    [session.workspaceId]: {
      ...workspaceSessions,
      [session.id]: {
        ...current,
        ...session,
      },
    },
  }
}

function removeCommandSession(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  workspaceId: string,
  processId: string,
) {
  const workspaceSessions = sessionsByWorkspace[workspaceId]
  if (!workspaceSessions?.[processId]) {
    return sessionsByWorkspace
  }

  const nextWorkspaceSessions = { ...workspaceSessions }
  delete nextWorkspaceSessions[processId]

  if (!Object.keys(nextWorkspaceSessions).length) {
    const nextSessionsByWorkspace = { ...sessionsByWorkspace }
    delete nextSessionsByWorkspace[workspaceId]
    return nextSessionsByWorkspace
  }

  return {
    ...sessionsByWorkspace,
    [workspaceId]: nextWorkspaceSessions,
  }
}

function clearCompletedCommandSessions(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  workspaceId: string,
) {
  const workspaceSessions = sessionsByWorkspace[workspaceId]
  if (!workspaceSessions) {
    return sessionsByWorkspace
  }

  const nextWorkspaceSessions = Object.fromEntries(
    Object.entries(workspaceSessions).filter(([, session]) =>
      ['running', 'starting'].includes(session.status),
    ),
  )

  if (!Object.keys(nextWorkspaceSessions).length) {
    const nextSessionsByWorkspace = { ...sessionsByWorkspace }
    delete nextSessionsByWorkspace[workspaceId]
    return nextSessionsByWorkspace
  }

  return {
    ...sessionsByWorkspace,
    [workspaceId]: nextWorkspaceSessions,
  }
}

function appendCommandOutput(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  const payload = event.payload
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('processId' in payload) ||
    !('deltaBase64' in payload) ||
    !('stream' in payload)
  ) {
    return sessionsByWorkspace
  }

  const processId = String(payload.processId)
  const delta = decodeBase64(String(payload.deltaBase64))
  const stream = String(payload.stream)
  const workspaceSessions = sessionsByWorkspace[event.workspaceId] ?? {}
  const current = workspaceSessions[processId]

  if (!current) {
    return sessionsByWorkspace
  }

  return {
    ...sessionsByWorkspace,
    [event.workspaceId]: {
      ...workspaceSessions,
      [processId]: {
        ...current,
        status: 'running',
        stdout: stream === 'stdout' ? trimOutput(current.stdout + delta) : current.stdout,
        stderr: stream === 'stderr' ? trimOutput(current.stderr + delta) : current.stderr,
        combinedOutput: trimOutput(current.combinedOutput + delta),
        updatedAt: event.ts,
      },
    },
  }
}

function completeCommandSession(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  const payload = event.payload
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('processId' in payload)
  ) {
    return sessionsByWorkspace
  }

  const typedPayload = payload as {
    processId: string
    stdout?: string
    stderr?: string
    error?: string
    status?: string
    exitCode?: number
  }

  const processId = String(typedPayload.processId)
  const workspaceSessions = sessionsByWorkspace[event.workspaceId] ?? {}
  const current = workspaceSessions[processId]

  if (!current) {
    return sessionsByWorkspace
  }

  const stdout =
    typeof typedPayload.stdout === 'string' && typedPayload.stdout ? typedPayload.stdout : ''
  const stderr =
    typeof typedPayload.stderr === 'string' && typedPayload.stderr ? typedPayload.stderr : ''
  const error = typeof typedPayload.error === 'string' ? typedPayload.error : null
  const nextCombinedOutput = trimOutput(
    current.combinedOutput + (stdout ? stdout : '') + (stderr ? stderr : ''),
  )

  return {
    ...sessionsByWorkspace,
    [event.workspaceId]: {
      ...workspaceSessions,
      [processId]: {
        ...current,
        status:
          typeof typedPayload.status === 'string'
            ? typedPayload.status
            : error
              ? 'failed'
              : 'completed',
        stdout: trimOutput(current.stdout + stdout),
        stderr: trimOutput(current.stderr + stderr),
        combinedOutput: nextCombinedOutput,
        exitCode:
          typeof typedPayload.exitCode === 'number'
            ? typedPayload.exitCode
            : current.exitCode ?? null,
        error,
        updatedAt: event.ts,
      },
    },
  }
}

function trimOutput(value: string, limit = 32_000) {
  if (value.length <= limit) {
    return value
  }

  return value.slice(value.length - limit)
}

function isCommandSession(value: unknown): value is CommandSession {
  return typeof value === 'object' && value !== null && 'id' in value && 'workspaceId' in value
}

function readThreadActivityStatus(event: ServerEvent) {
  if (event.method !== 'thread/status/changed') {
    return ''
  }

  if (typeof event.payload !== 'object' || event.payload === null) {
    return ''
  }

  const payload = event.payload as Record<string, unknown>
  const status = payload.status
  if (typeof status !== 'object' || status === null) {
    return ''
  }

  return typeof (status as Record<string, unknown>).type === 'string'
    ? String((status as Record<string, unknown>).type)
    : ''
}
