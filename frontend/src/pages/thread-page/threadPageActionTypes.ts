import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'

import type { TurnResult } from '../../types/api'
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
  commandSessions: Array<{ id: string; status: string }>
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
  message: string
  queryClient: QueryClient
  removeCommandSession: (workspaceId: string, processId: string) => void
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
  scrollThreadToLatest: (behavior?: ScrollBehavior) => void
  selectedCommandSession?: { id: string }
  selectedProcessId?: string
  selectedThread?: { id: string; archived: boolean }
  selectedThreadId?: string
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setApprovalAnswers: Dispatch<SetStateAction<Record<string, Record<string, string>>>>
  setComposerCaret: (value: number) => void
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setIsTerminalDockExpanded: (value: boolean) => void
  setMessage: (value: string) => void
  setCommandRunMode: Dispatch<SetStateAction<CommandRunMode>>
  setSelectedProcessId: (value: string | undefined) => void
  setSendError: (value: string | null) => void
  startCommandMutation: {
    mutate: (input: { command: string }) => void
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
  | 'interruptTurnMutation'
  | 'invalidateThreadQueries'
  | 'isInterruptMode'
  | 'message'
  | 'queryClient'
  | 'renameThreadMutation'
  | 'requestDeleteSelectedThread'
  | 'respondApprovalMutation'
  | 'scrollThreadToLatest'
  | 'selectedThread'
  | 'selectedThreadId'
  | 'setActiveComposerPanel'
  | 'setApprovalAnswers'
  | 'setComposerCaret'
  | 'setComposerCommandMenu'
  | 'setDismissedComposerAutocompleteKey'
  | 'setMessage'
  | 'setSendError'
  | 'startTurnMutation'
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
  | 'selectedCommandSession'
  | 'selectedThreadId'
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
