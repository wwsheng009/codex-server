import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { decodeBase64 } from '../components/thread/threadRender'
import { getCompletedCommandOutputDelta } from '../lib/command-output'
import { readThreadTokenUsageFromEvent } from '../lib/thread-token-usage'
import { getSelectedThreadIdForWorkspace } from './session-store-utils'
import type {
  CommandSession,
  CommandSessionSnapshot,
  ServerEvent,
  ThreadTokenUsage,
} from '../types/api'

export type CommandRuntimeSession = CommandSessionSnapshot

export const COMMAND_SESSION_OUTPUT_LIMIT = 128_000

export type ThreadActivitySummary = {
  latestEventMethod: string
  latestEventTs: string
  latestStatus?: string
  threadId: string
  workspaceId: string
}

const ACTIVE_THREAD_EVENT_LIMIT = 40
const INACTIVE_THREAD_EVENT_LIMIT = 4
const WORKSPACE_EVENT_LIMIT = 20
const WORKSPACE_ACTIVITY_EVENT_LIMIT = 30

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
  ingestEvents: (events: ServerEvent[]) => void
  hydrateCommandSessions: (workspaceId: string, sessions: CommandSessionSnapshot[]) => void
  syncCommandSessions: (workspaceId: string, sessions: CommandSessionSnapshot[]) => void
  upsertCommandSession: (session: CommandSession) => void
  removeCommandSession: (workspaceId: string, processId: string) => void
  clearCompletedCommandSessions: (workspaceId: string) => void
  updateCommandSession: (
    workspaceId: string,
    processId: string,
    patch: Partial<CommandRuntimeSession>,
  ) => void
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
      ingestEvents: (events) =>
        set((current) => applySessionEvents(current, events)),
      hydrateCommandSessions: (workspaceId, sessions) =>
        set((current) => ({
          commandSessionsByWorkspace: hydrateCommandSessions(
            current.commandSessionsByWorkspace,
            workspaceId,
            sessions,
          ),
        })),
      syncCommandSessions: (workspaceId, sessions) =>
        set((current) => ({
          commandSessionsByWorkspace: syncCommandSessions(
            current.commandSessionsByWorkspace,
            workspaceId,
            sessions.map(sanitizeCommandSnapshot),
          ),
        })),
      upsertCommandSession: (session) =>
        set((current) => ({
          commandSessionsByWorkspace: mergeCommandSession(
            current.commandSessionsByWorkspace,
            sanitizeCommandSnapshot({
              ...session,
              combinedOutput: '',
              stdout: '',
              stderr: '',
              updatedAt: new Date().toISOString(),
            }),
          ),
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
      updateCommandSession: (workspaceId, processId, patch) =>
        set((current) => ({
          commandSessionsByWorkspace: updateCommandSession(
            current.commandSessionsByWorkspace,
            workspaceId,
            processId,
            patch,
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
        set((current) => applySessionEvents(current, [event])),
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

function applySessionEvents(
  current: Pick<
    SessionState,
    | 'activityEventsByWorkspace'
    | 'commandSessionsByWorkspace'
    | 'eventsByThread'
    | 'selectedThreadIdByWorkspace'
    | 'threadActivityByThread'
    | 'tokenUsageByThread'
    | 'workspaceEventsByWorkspace'
  >,
  events: ServerEvent[],
) {
  if (events.length === 0) {
    return current
  }

  let nextCommandSessions = current.commandSessionsByWorkspace
  let nextThreadActivity = current.threadActivityByThread
  let nextTokenUsage = current.tokenUsageByThread
  let nextActivityEvents = current.activityEventsByWorkspace
  let nextWorkspaceEvents = current.workspaceEventsByWorkspace
  let nextEventsByThread = current.eventsByThread

  for (const event of events) {
    nextCommandSessions = applyCommandEvent(nextCommandSessions, event)
    nextThreadActivity = applyThreadActivityEvent(nextThreadActivity, event)
    nextTokenUsage = applyTokenUsageEvent(nextTokenUsage, event)
    nextActivityEvents = {
      ...nextActivityEvents,
      [event.workspaceId]: [
        ...(nextActivityEvents[event.workspaceId] ?? []),
        event,
      ].slice(-WORKSPACE_ACTIVITY_EVENT_LIMIT),
    }

    if (!event.threadId) {
      nextWorkspaceEvents = {
        ...nextWorkspaceEvents,
        [event.workspaceId]: [
          ...(nextWorkspaceEvents[event.workspaceId] ?? []),
          event,
        ].slice(-WORKSPACE_EVENT_LIMIT),
      }
      continue
    }

    const currentEvents = nextEventsByThread[event.threadId] ?? []
    const selectedThreadIdForWorkspace = current.selectedThreadIdByWorkspace[event.workspaceId]
    const eventLimit =
      selectedThreadIdForWorkspace === event.threadId
        ? ACTIVE_THREAD_EVENT_LIMIT
        : INACTIVE_THREAD_EVENT_LIMIT

    nextEventsByThread = {
      ...nextEventsByThread,
      [event.threadId]: [...currentEvents, event].slice(-eventLimit),
    }
  }

  return {
    activityEventsByWorkspace: nextActivityEvents,
    commandSessionsByWorkspace: nextCommandSessions,
    eventsByThread: nextEventsByThread,
    threadActivityByThread: nextThreadActivity,
    tokenUsageByThread: nextTokenUsage,
    workspaceEventsByWorkspace: nextWorkspaceEvents,
  }
}

function applyCommandEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  switch (event.method) {
    case 'command/exec/started':
      if (!isCommandSession(event.payload)) {
        return sessionsByWorkspace
      }
      return mergeCommandSession(
        sessionsByWorkspace,
        sanitizeCommandSnapshot({
          ...event.payload,
          combinedOutput: '',
          stdout: '',
          stderr: '',
          updatedAt: event.ts,
        }),
      )
    case 'command/exec/outputDelta':
      return appendCommandOutput(sessionsByWorkspace, event)
    case 'command/exec/snapshot':
      return syncCommandSessionsFromEvent(sessionsByWorkspace, event)
    case 'command/exec/completed':
      return completeCommandSession(sessionsByWorkspace, event)
    case 'command/exec/prompt':
      return applyCommandShellPromptEvent(sessionsByWorkspace, event)
    case 'command/exec/commandStarted':
      return applyCommandShellStartedEvent(sessionsByWorkspace, event)
    case 'command/exec/commandFinished':
      return applyCommandShellFinishedEvent(sessionsByWorkspace, event)
    case 'command/exec/cwdChanged':
      return applyCommandCwdChangedEvent(sessionsByWorkspace, event)
    case 'command/exec/archived':
      return archiveCommandSessionFromEvent(sessionsByWorkspace, event)
    case 'command/exec/pinned':
      return pinCommandSessionFromEvent(sessionsByWorkspace, event)
    case 'command/exec/removed':
      return removeCommandSessionFromEvent(sessionsByWorkspace, event)
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

function hydrateCommandSessions(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  workspaceId: string,
  sessions: CommandSessionSnapshot[],
) {
  if (!workspaceId || sessions.length === 0) {
    return sessionsByWorkspace
  }

  const workspaceSessions = sessionsByWorkspace[workspaceId] ?? {}
  const nextWorkspaceSessions = { ...workspaceSessions }

  for (const session of sessions) {
    const current = nextWorkspaceSessions[session.id]
    if (
      current &&
      Date.parse(current.updatedAt) > Date.parse(session.updatedAt)
    ) {
      continue
    }

    nextWorkspaceSessions[session.id] = {
      ...current,
      ...session,
    }
  }

  return {
    ...sessionsByWorkspace,
    [workspaceId]: nextWorkspaceSessions,
  }
}

function syncCommandSessions(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  workspaceId: string,
  sessions: CommandSessionSnapshot[],
) {
  if (!workspaceId) {
    return sessionsByWorkspace
  }

  if (sessions.length === 0) {
    if (!sessionsByWorkspace[workspaceId]) {
      return sessionsByWorkspace
    }

    const nextSessionsByWorkspace = { ...sessionsByWorkspace }
    delete nextSessionsByWorkspace[workspaceId]
    return nextSessionsByWorkspace
  }

  const nextWorkspaceSessions = Object.fromEntries(
    sessions.map((session) => [session.id, session]),
  )

  return {
    ...sessionsByWorkspace,
    [workspaceId]: nextWorkspaceSessions,
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

function updateCommandSession(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  workspaceId: string,
  processId: string,
  patch: Partial<CommandRuntimeSession>,
) {
  const workspaceSessions = sessionsByWorkspace[workspaceId]
  const current = workspaceSessions?.[processId]
  if (!workspaceSessions || !current) {
    return sessionsByWorkspace
  }

  return {
    ...sessionsByWorkspace,
    [workspaceId]: {
      ...workspaceSessions,
      [processId]: {
        ...current,
        ...patch,
      },
    },
  }
}

function removeCommandSessionFromEvent(
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

  return removeCommandSession(
    sessionsByWorkspace,
    event.workspaceId,
    String(payload.processId),
  )
}

function pinCommandSessionFromEvent(
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

  const processId = String(payload.processId)
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
        pinned: Boolean((payload as Record<string, unknown>).pinned),
        updatedAt: event.ts,
      },
    },
  }
}

function archiveCommandSessionFromEvent(
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

  const processId = String(payload.processId)
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
        archived: Boolean((payload as Record<string, unknown>).archived),
        updatedAt: event.ts,
      },
    },
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
  const workspaceSessions = sessionsByWorkspace[event.workspaceId] ?? {}
  const current = workspaceSessions[processId]

  if (!current) {
    return sessionsByWorkspace
  }

  return {
    ...sessionsByWorkspace,
    [event.workspaceId]: {
      ...workspaceSessions,
      [processId]: sanitizeCommandSnapshot({
        ...current,
        status: 'running',
        combinedOutput: trimOutput(current.combinedOutput + delta),
        updatedAt: event.ts,
      }),
    },
  }
}

function syncCommandSessionsFromEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  const payload = event.payload
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('sessions' in payload) ||
    !Array.isArray((payload as Record<string, unknown>).sessions)
  ) {
    return sessionsByWorkspace
  }

  const sessions = ((payload as Record<string, unknown>).sessions as unknown[]).filter(
    (session): session is CommandSessionSnapshot =>
      typeof session === 'object' &&
      session !== null &&
      'id' in session &&
      'workspaceId' in session,
  )

  return syncCommandSessions(sessionsByWorkspace, event.workspaceId, sessions)
}

function applyCommandShellPromptEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  return updateCommandSessionFromPayload(sessionsByWorkspace, event, (current, payload) => ({
    ...current,
    shellState:
      typeof payload.shellState === 'string' && payload.shellState
        ? payload.shellState
        : 'prompt',
    updatedAt: event.ts,
  }))
}

function applyCommandShellStartedEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  return updateCommandSessionFromPayload(sessionsByWorkspace, event, (current, payload) => ({
    ...current,
    shellState:
      typeof payload.shellState === 'string' && payload.shellState
        ? payload.shellState
        : 'running',
    updatedAt: event.ts,
  }))
}

function applyCommandShellFinishedEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  return updateCommandSessionFromPayload(sessionsByWorkspace, event, (current, payload) => ({
    ...current,
    lastExitCode:
      typeof payload.exitCode === 'number' ? payload.exitCode : current.lastExitCode ?? null,
    shellState:
      typeof payload.shellState === 'string' && payload.shellState
        ? payload.shellState
        : 'prompt',
    updatedAt: event.ts,
  }))
}

function applyCommandCwdChangedEvent(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
) {
  return updateCommandSessionFromPayload(sessionsByWorkspace, event, (current, payload) => ({
    ...current,
    currentCwd:
      typeof payload.currentCwd === 'string' && payload.currentCwd
        ? payload.currentCwd
        : current.currentCwd,
    updatedAt: event.ts,
  }))
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
  const completedOutput = stdout + stderr
  const completionDelta = getCompletedCommandOutputDelta(current.combinedOutput, completedOutput)
  const nextCombinedOutput = trimOutput(current.combinedOutput + completionDelta)

  return {
    ...sessionsByWorkspace,
    [event.workspaceId]: {
      ...workspaceSessions,
      [processId]: sanitizeCommandSnapshot({
        ...current,
        status:
          typeof typedPayload.status === 'string'
            ? typedPayload.status
            : error
              ? 'failed'
              : 'completed',
        combinedOutput: nextCombinedOutput,
        exitCode:
          typeof typedPayload.exitCode === 'number'
            ? typedPayload.exitCode
            : current.exitCode ?? null,
        error,
        updatedAt: event.ts,
      }),
    },
  }
}

function updateCommandSessionFromPayload(
  sessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>,
  event: ServerEvent,
  updater: (
    current: CommandRuntimeSession,
    payload: Record<string, unknown>,
  ) => CommandRuntimeSession,
) {
  const payload = event.payload
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('processId' in payload)
  ) {
    return sessionsByWorkspace
  }

  const processId = String(payload.processId)
  const workspaceSessions = sessionsByWorkspace[event.workspaceId] ?? {}
  const current = workspaceSessions[processId]
  if (!current) {
    return sessionsByWorkspace
  }

  return {
    ...sessionsByWorkspace,
    [event.workspaceId]: {
      ...workspaceSessions,
      [processId]: updater(current, payload as Record<string, unknown>),
    },
  }
}

function trimOutput(value: string, limit = COMMAND_SESSION_OUTPUT_LIMIT) {
  if (value.length <= limit) {
    return value
  }

  return value.slice(value.length - limit)
}

function isCommandSession(value: unknown): value is CommandSession {
  return typeof value === 'object' && value !== null && 'id' in value && 'workspaceId' in value
}

function sanitizeCommandSnapshot<T extends CommandRuntimeSession>(session: T): T {
  return {
    ...session,
    stderr: '',
    stdout: '',
  }
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
