import type { QueryClient } from '@tanstack/react-query'
import type { Dispatch, SetStateAction } from 'react'

import type { RespondServerRequestWithDetailsInput } from '../../features/approvals/api'
import type { StartCommandInput, WriteCommandInput } from '../../features/commands/api'
import type { RunThreadShellCommandInput, RenameThreadInput } from '../../features/threads/api'
import type { StartTurnInput } from '../../features/turns/api'
import type {
  Bot,
  BotOutboundDelivery,
  Thread,
  ThreadDetail,
  ThreadTurn,
  TurnResult,
  WorkspaceRuntimeState,
} from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type {
  ComposerAssistPanel,
  ComposerCommandMenu,
  ComposerPreferences,
} from './threadPageComposerShared'

export type CommandRunMode = 'command-exec' | 'thread-shell'

export type ThreadPageCommandSessionSummary = {
  archived?: boolean
  id: string
  pinned?: boolean
  status: string
}

export type ThreadPageSelectedCommandSession = {
  id: string
  mode?: string
  pinned?: boolean
  shellState?: string
  status?: string
}

export type ThreadPageSelectedThreadSummary = {
  archived: boolean
  id: string
}

export type ThreadPageRenameThreadMutationInput = {
  name: RenameThreadInput['name']
  threadId: string
}

export type ThreadPageRespondApprovalInput = RespondServerRequestWithDetailsInput & {
  requestId: string
}

export type ThreadPageStartTurnMutationInput = StartTurnInput & {
  threadId: string
}

export type ThreadPageStartCommandMutationInput = StartCommandInput

export type ThreadPageThreadShellCommandMutationInput = RunThreadShellCommandInput & {
  threadId: string
}

export type ThreadPageWriteCommandMutationInput = {
  input: WriteCommandInput['input']
  processId: string
}

export type ThreadPageRecoverableCommandOperation =
  | {
      kind: 'start-command'
      input: ThreadPageStartCommandMutationInput
    }
  | {
      kind: 'thread-shell-command'
      input: ThreadPageThreadShellCommandMutationInput
    }

export type ThreadPageThreadActionsInput = {
  archiveThreadMutation: {
    mutate: (threadId: string) => void
  }
  closeDeleteThreadDialog: () => void
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
  fullTurnItemContentOverridesById: Record<string, Record<string, unknown>>
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>
  fullTurnItemRetainCountById: Record<string, number>
  fullTurnOverridesById: Record<string, ThreadTurn>
  fullTurnRetainCountById: Record<string, number>
  historicalTurns: ThreadTurn[]
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
  renameThreadMutation: {
    mutate: (input: ThreadPageRenameThreadMutationInput) => void
  }
  requestDeleteSelectedThread: () => void
  recoverableSendInput: string | null
  respondApprovalMutation: {
    mutate: (input: ThreadPageRespondApprovalInput) => void
  }
  scrollThreadToLatest: (behavior?: ScrollBehavior) => void
  selectedThread?: ThreadPageSelectedThreadSummary
  selectedThreadId?: string
  restartRuntimeMutation: {
    isPending: boolean
    mutate: () => void
    mutateAsync: () => Promise<unknown>
  }
  setActiveComposerPanel: Dispatch<SetStateAction<ComposerAssistPanel | null>>
  setApprovalAnswers: Dispatch<SetStateAction<Record<string, Record<string, string>>>>
  setAuthRecoveryRequestedAt: (value: number | null) => void
  setComposerCaret: (value: number) => void
  setComposerCommandMenu: Dispatch<SetStateAction<ComposerCommandMenu>>
  setDismissedComposerAutocompleteKey: (value: string | null) => void
  setFullTurnItemContentOverridesById: Dispatch<
    SetStateAction<Record<string, Record<string, unknown>>>
  >
  setFullTurnItemOverridesById: Dispatch<
    SetStateAction<Record<string, Record<string, unknown>>>
  >
  setFullTurnItemRetainCountById: Dispatch<SetStateAction<Record<string, number>>>
  setFullTurnOverridesById: Dispatch<SetStateAction<Record<string, ThreadTurn>>>
  setFullTurnRetainCountById: Dispatch<SetStateAction<Record<string, number>>>
  setHasMoreHistoricalTurnsBefore: Dispatch<SetStateAction<boolean | null>>
  setHistoricalTurns: Dispatch<SetStateAction<ThreadTurn[]>>
  setIsLoadingOlderTurns: Dispatch<SetStateAction<boolean>>
  setIsRestartAndRetryPending: (value: boolean) => void
  setMessage: (value: string) => void
  setRecoverableSendInput: (value: string | null) => void
  setSendError: (value: string | null) => void
  setThreadTurnWindowSize: Dispatch<SetStateAction<number>>
  startTurnMutation: {
    mutateAsync: (input: ThreadPageStartTurnMutationInput) => Promise<TurnResult>
  }
  threadDetail?: ThreadDetail
  unarchiveThreadMutation: {
    mutate: (threadId: string) => void
  }
  workspaceRuntimeState?: WorkspaceRuntimeState | null
  updatePendingTurn: (
    threadId: string,
    updater: (current: PendingThreadTurn | null) => PendingThreadTurn | null,
  ) => void
  workspaceId: string
}

export type ThreadPageCommandActionsInput = {
  clearCompletedCommandSessions: (workspaceId: string) => void
  command: string
  commandRunMode: CommandRunMode
  commandSessions: ThreadPageCommandSessionSummary[]
  queryClient: QueryClient
  recoverableCommandOperation: ThreadPageRecoverableCommandOperation | null
  removeCommandSession: (workspaceId: string, processId: string) => void
  restartRuntimeMutation: {
    isPending: boolean
    mutate: () => void
    mutateAsync: () => Promise<unknown>
  }
  selectedCommandSession?: ThreadPageSelectedCommandSession
  selectedProcessId?: string
  selectedThreadId?: string
  setIsRestartAndRetryPending: (value: boolean) => void
  setCommandRunMode: Dispatch<SetStateAction<CommandRunMode>>
  setRecoverableCommandOperation: (
    value: ThreadPageRecoverableCommandOperation | null,
  ) => void
  setIsTerminalDockExpanded: (value: boolean) => void
  setSelectedProcessId: (value: string | undefined) => void
  setSendError: (value: string | null) => void
  startCommandMutation: {
    mutateAsync: (input: ThreadPageStartCommandMutationInput) => Promise<unknown>
    mutate: (input: ThreadPageStartCommandMutationInput) => void
  }
  stdinValue: string
  terminateCommandMutation: {
    mutate: (processId: string) => void
  }
  threadShellCommandMutation: {
    isPending: boolean
    mutate: (input: ThreadPageThreadShellCommandMutationInput) => void
    mutateAsync: (
      input: ThreadPageThreadShellCommandMutationInput,
    ) => Promise<{ status: string }>
  }
  updateCommandSession: (
    workspaceId: string,
    processId: string,
    patch: Partial<{ archived?: boolean; pinned?: boolean; updatedAt?: string }>,
  ) => void
  workspaceRuntimeState?: WorkspaceRuntimeState | null
  workspaceId: string
  writeCommandMutation: {
    mutate: (input: ThreadPageWriteCommandMutationInput) => void
  }
}

export type ThreadPageBotActionsInput = {
  botSendBots: Bot[]
  botSendSelectedBotId: string
  botSendSelectedDeliveryTargetId: string
  botSendText: string
  bindThreadBotChannelMutation: {
    isPending: boolean
    mutate: (
      input: {
        botWorkspaceId: string
        botId: string
        deliveryTargetId: string
        threadId: string
      },
      options?: {
        onError?: (error: unknown) => void
      },
    ) => void
  }
  deleteThreadBotBindingMutation: {
    isPending: boolean
    mutate: (
      input: {
        threadId: string
      },
      options?: {
        onError?: (error: unknown) => void
      },
    ) => void
  }
  selectedThread?: Thread
  sendBotDeliveryTargetOutboundMessageMutation: {
    isPending: boolean
    mutate: (
      input: {
        botWorkspaceId: string
        botId: string
        deliveryTargetId: string
        text: string
        threadId: string
        threadWorkspaceId: string
      },
      options?: {
        onError?: (error: unknown) => void
        onSuccess?: (data: BotOutboundDelivery) => void
      },
    ) => void
  }
  setBotSendError: (value: string | null) => void
}

export type ThreadPageActionsInput =
  ThreadPageThreadActionsInput &
    ThreadPageCommandActionsInput &
    ThreadPageBotActionsInput
