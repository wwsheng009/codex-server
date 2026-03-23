import type { QueryClient } from '@tanstack/react-query'

import type { Thread } from '../../types/api'
import type { ContextCompactionFeedback } from './threadPageComposerShared'

export type ThreadPageMutationsInput = {
  clearPendingTurn: (threadId: string) => void
  queryClient: QueryClient
  removeThreadFromSession: (workspaceId: string, threadId: string) => void
  selectedThreadId?: string
  setApprovalAnswers: (
    value:
      | Record<string, Record<string, string>>
      | ((
          current: Record<string, Record<string, string>>,
        ) => Record<string, Record<string, string>>),
  ) => void
  setApprovalErrors: (
    value:
      | Record<string, string>
      | ((current: Record<string, string>) => Record<string, string>),
  ) => void
  setCommand: (value: string) => void
  setConfirmingThreadDelete: (value: Thread | null) => void
  setContextCompactionFeedback: (
    value:
      | ContextCompactionFeedback
      | null
      | ((current: ContextCompactionFeedback | null) => ContextCompactionFeedback | null),
  ) => void
  setEditingThreadId: (
    value: string | undefined | ((current: string | undefined) => string | undefined),
  ) => void
  setEditingThreadName: (value: string) => void
  setIsTerminalDockExpanded: (value: boolean) => void
  setIsTerminalDockVisible: (value: boolean) => void
  setSelectedProcessId: (value: string | undefined) => void
  setSelectedThread: (workspaceId: string, threadId?: string) => void
  setSendError: (value: string | null) => void
  setStdinValue: (value: string) => void
  streamState: string
  workspaceId: string
}

export type ThreadPageThreadMutationsInput = Pick<
  ThreadPageMutationsInput,
  | 'clearPendingTurn'
  | 'queryClient'
  | 'removeThreadFromSession'
  | 'selectedThreadId'
  | 'setApprovalAnswers'
  | 'setApprovalErrors'
  | 'setCommand'
  | 'setConfirmingThreadDelete'
  | 'setContextCompactionFeedback'
  | 'setEditingThreadId'
  | 'setEditingThreadName'
  | 'setSelectedThread'
  | 'setSendError'
  | 'workspaceId'
>

export type ThreadPageCommandMutationsInput = Pick<
  ThreadPageMutationsInput,
  | 'queryClient'
  | 'setCommand'
  | 'setIsTerminalDockExpanded'
  | 'setIsTerminalDockVisible'
  | 'setSelectedProcessId'
  | 'setSendError'
  | 'setStdinValue'
  | 'streamState'
  | 'workspaceId'
>
