import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

import { decodeBase64 } from '../components/thread/threadRender'
import type { CommandSession, ServerEvent } from '../types/api'

export type CommandRuntimeSession = CommandSession & {
  combinedOutput: string
  stdout: string
  stderr: string
  exitCode?: number | null
  error?: string | null
  updatedAt: string
}

type SessionState = {
  selectedWorkspaceId?: string
  selectedThreadId?: string
  selectedThreadIdByWorkspace: Record<string, string>
  eventsByThread: Record<string, ServerEvent[]>
  workspaceEventsByWorkspace: Record<string, ServerEvent[]>
  connectionByWorkspace: Record<string, string>
  commandSessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>
  setSelectedWorkspace: (workspaceId?: string) => void
  setSelectedThread: (workspaceId?: string, threadId?: string) => void
  setConnectionState: (workspaceId: string, state: string) => void
  ingestEvent: (event: ServerEvent) => void
  upsertCommandSession: (session: CommandSession) => void
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      selectedWorkspaceId: undefined,
      selectedThreadId: undefined,
      selectedThreadIdByWorkspace: {},
      eventsByThread: {},
      workspaceEventsByWorkspace: {},
      connectionByWorkspace: {},
      commandSessionsByWorkspace: {},
      setSelectedWorkspace: (workspaceId) =>
        set((current) => ({
          selectedWorkspaceId: workspaceId,
          selectedThreadId: workspaceId ? current.selectedThreadIdByWorkspace[workspaceId] : undefined,
        })),
      setSelectedThread: (workspaceId, threadId) =>
        set((current) => {
          const nextByWorkspace = { ...current.selectedThreadIdByWorkspace }

          if (workspaceId && threadId) {
            nextByWorkspace[workspaceId] = threadId
          }

          return {
            selectedThreadId: threadId,
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
      ingestEvent: (event) =>
        set((current) => {
          const nextCommandSessions = applyCommandEvent(current.commandSessionsByWorkspace, event)
          if (!event.threadId) {
            return {
              commandSessionsByWorkspace: nextCommandSessions,
              workspaceEventsByWorkspace: {
                ...current.workspaceEventsByWorkspace,
                [event.workspaceId]: [
                  ...(current.workspaceEventsByWorkspace[event.workspaceId] ?? []),
                  event,
                ].slice(-100),
              },
            }
          }

          const currentEvents = current.eventsByThread[event.threadId] ?? []

          return {
            commandSessionsByWorkspace: nextCommandSessions,
            eventsByThread: {
              ...current.eventsByThread,
              [event.threadId]: [...currentEvents, event].slice(-100),
            },
          }
        }),
    }),
    {
      name: 'codex-server-session-store',
      storage: createJSONStorage(() => window.localStorage),
      partialize: (state) => ({
        selectedWorkspaceId: state.selectedWorkspaceId,
        selectedThreadId: state.selectedThreadId,
        selectedThreadIdByWorkspace: state.selectedThreadIdByWorkspace,
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
