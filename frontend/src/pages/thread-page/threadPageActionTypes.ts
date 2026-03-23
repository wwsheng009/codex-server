import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'

import type { ThreadDetail, ThreadTurn, TurnResult } from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type {
  ComposerAssistPanel,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'

export type CommandRunMode = 'command-exec' | 'thread-shell'

export type ThreadPageActionsInput = {
  archiveThreadMutation: {
    mutate: (threadId: string) => void
  }
  clearCompletedCommandSessions: (workspaceId: string) => void
  closeDeleteThreadDialog: () => void
  command: string
  commandRunMode: CommandRunMode
  commandSessions: Array<{ archived?: boolean; id: string; pinned?: boolean; status: string }>
  compactDisabledReason: string | null
  compactThreadMutation: {
    isPending: boolean
    mutate: (threadId: string) => void
  }
  composerPreferences: ComposerPreferences
  confirmingThreadDelete: { id: string } | null
  deleteThreadMutation: {
    isPending: boolean
    mutate: (threadId: string) => void
    reset: () => void
  }
  editingThreadName: string
  interruptTurnMutation: {
    isPending: boolean
    mutate: () => void
  }
  invalidateThreadQueries: () => Promise<unknown>
  isInterruptMode: boolean
  isLoadingOlderTurns: boolean
  message: string
  oldestDisplayedTurnId?: string
  queryClient: QueryClient
  removeCommandSession: (workspaceId: string, processId: string) => void
  updateCommandSession: (
    workspaceId: string,
    processId: string,
    patch: Partial<{ archived?: boolean; pinned?: boolean; updatedAt?: string }>,
  ) => void
  renameThreadMutation: {
    mutate: (input: { threadId: string; name: string }) => void
  }
  requestDeleteSelectedThread: () => void
  respondApprovalMutation: {
    mutate: (input: {
      requestId: string
      action: string
      answers?: Record<string, string[]>
    }) => void
  }
  fullTurnOverridesById: Record<string, ThreadTurn>
  fullTurnItemContentOverridesById: Record<string, Record<string, unknown>>
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>
  fullTurnItemRetainCountById: Record<string, number>
  fullTurnRetainCountById: Record<string, number>
  historicalTurns: ThreadTurn[]
  scrollThreadToLatest: (behavior?: ScrollBehavior) => void
  selectedCommandSession?: {
    id: string
    mode?: string
    pinned?: boolean
    shellState?: string
    status?: string
  }
  selectedProcessId?: string
  selectedThread?: { id: string; archived: boolean }
  selectedThreadId?: string
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setApprovalAnswers: Dispatch<SetStateAction<Record<string, Record<string, string>>>>
  setAuthRecoveryRequestedAt: (value: number | null) => void
  setComposerCaret: (value: number) => void
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setFullTurnItemContentOverridesById: Dispatch<SetStateAction<Record<string, Record<string, unknown>>>>
  setFullTurnItemOverridesById: Dispatch<SetStateAction<Record<string, Record<string, unknown>>>>
  setFullTurnItemRetainCountById: Dispatch<SetStateAction<Record<string, number>>>
  setHasMoreHistoricalTurnsBefore: Dispatch<SetStateAction<boolean | null>>
  setHistoricalTurns: Dispatch<SetStateAction<ThreadTurn[]>>
  setFullTurnOverridesById: Dispatch<SetStateAction<Record<string, ThreadTurn>>>
  setFullTurnRetainCountById: Dispatch<SetStateAction<Record<string, number>>>
  setIsTerminalDockExpanded: (value: boolean) => void
  setIsLoadingOlderTurns: Dispatch<SetStateAction<boolean>>
  setMessage: (value: string) => void
  setCommandRunMode: Dispatch<SetStateAction<CommandRunMode>>
  setSelectedProcessId: (value: string | undefined) => void
  setSendError: (value: string | null) => void
  setThreadTurnWindowSize: Dispatch<SetStateAction<number>>
  threadDetail?: ThreadDetail
  startCommandMutation: {
    mutate: (input: { command?: string; mode?: 'command' | 'shell' }) => void
  }
  threadShellCommandMutation: {
    isPending: boolean
    mutate: (input: { command: string; threadId: string }) => void
  }
  startTurnMutation: {
    mutateAsync: (input: {
      threadId: string
      input: string
      model?: string
      reasoningEffort?: string
      permissionPreset?: string
      collaborationMode?: string
    }) => Promise<TurnResult>
  }
  stdinValue: string
  terminateCommandMutation: {
    mutate: (processId: string) => void
  }
  unarchiveThreadMutation: {
    mutate: (threadId: string) => void
  }
  updatePendingTurn: (
    threadId: string,
    updater: (current: PendingThreadTurn | null) => PendingThreadTurn | null,
  ) => void
  workspaceId: string
  writeCommandMutation: {
    mutate: (input: { processId: string; input: string }) => void
  }
}

export type ThreadPageThreadActionsInput = Pick<
  ThreadPageActionsInput,
  | 'archiveThreadMutation'
  | 'closeDeleteThreadDialog'
  | 'compactDisabledReason'
  | 'compactThreadMutation'
  | 'composerPreferences'
  | 'confirmingThreadDelete'
  | 'deleteThreadMutation'
  | 'editingThreadName'
  | 'fullTurnItemContentOverridesById'
  | 'fullTurnItemOverridesById'
  | 'fullTurnItemRetainCountById'
  | 'fullTurnOverridesById'
  | 'fullTurnRetainCountById'
  | 'historicalTurns'
  | 'interruptTurnMutation'
  | 'invalidateThreadQueries'
  | 'isInterruptMode'
  | 'isLoadingOlderTurns'
  | 'message'
  | 'oldestDisplayedTurnId'
  | 'queryClient'
  | 'renameThreadMutation'
  | 'requestDeleteSelectedThread'
  | 'respondApprovalMutation'
  | 'scrollThreadToLatest'
  | 'selectedThread'
  | 'selectedThreadId'
  | 'setActiveComposerPanel'
  | 'setApprovalAnswers'
  | 'setAuthRecoveryRequestedAt'
  | 'setComposerCaret'
  | 'setComposerCommandMenu'
  | 'setDismissedComposerAutocompleteKey'
  | 'setFullTurnItemContentOverridesById'
  | 'setFullTurnItemOverridesById'
  | 'setFullTurnItemRetainCountById'
  | 'setFullTurnOverridesById'
  | 'setFullTurnRetainCountById'
  | 'setHasMoreHistoricalTurnsBefore'
  | 'setHistoricalTurns'
  | 'setIsLoadingOlderTurns'
  | 'setMessage'
  | 'setSendError'
  | 'setThreadTurnWindowSize'
  | 'startTurnMutation'
  | 'threadDetail'
  | 'unarchiveThreadMutation'
  | 'updatePendingTurn'
  | 'workspaceId'
>

export type ThreadPageCommandActionsInput = Pick<
  ThreadPageActionsInput,
  | 'clearCompletedCommandSessions'
  | 'command'
  | 'commandRunMode'
  | 'commandSessions'
  | 'removeCommandSession'
  | 'updateCommandSession'
  | 'selectedCommandSession'
  | 'selectedThreadId'
  | 'setSendError'
  | 'setCommandRunMode'
  | 'selectedProcessId'
  | 'setIsTerminalDockExpanded'
  | 'setSelectedProcessId'
  | 'startCommandMutation'
  | 'threadShellCommandMutation'
  | 'stdinValue'
  | 'terminateCommandMutation'
  | 'workspaceId'
  | 'writeCommandMutation'
>
