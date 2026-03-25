import type {
  CommandSession,
  CommandSessionSnapshot,
  ServerEvent,
  ThreadTokenUsage,
} from '../types/api'

export type CommandRuntimeSession = CommandSessionSnapshot & {
  lastReplayMode?: 'append' | 'replace' | null
  lastReplayReason?: string | null
  replayAppendCount?: number
  replayByteCount?: number
  replayReplaceCount?: number
}

export type ThreadActivitySummary = {
  latestEventMethod: string
  latestEventTs: string
  latestStatus?: string
  threadId: string
  workspaceId: string
}

export type SessionState = {
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

export type ApplySessionEventsState = {
  activityEventsByWorkspace: Record<string, ServerEvent[]>
  commandSessionsByWorkspace: Record<string, Record<string, CommandRuntimeSession>>
  eventsByThread: Record<string, ServerEvent[]>
  selectedThreadIdByWorkspace: Record<string, string>
  threadActivityByThread: Record<string, ThreadActivitySummary>
  tokenUsageByThread: Record<string, ThreadTokenUsage>
  workspaceEventsByWorkspace: Record<string, ServerEvent[]>
}

export type CommandOutputBatchUpdate = {
  delta: string
  processId: string
  replayAppendCount: number
  replayBytes: number
  replayOutput: boolean
  replayReason?: string | null
  replayReplaceCount: number
  replaceOutput: boolean
  updatedAt: string
  workspaceId: string
}
