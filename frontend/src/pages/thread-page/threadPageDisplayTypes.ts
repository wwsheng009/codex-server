import type { Dispatch, SetStateAction } from 'react'

import type { CommandRuntimeSession } from '../../stores/session-store'
import type {
  PendingApproval,
  ServerEvent,
  Thread,
  ThreadDetail,
  ThreadTokenUsage,
} from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ContextCompactionFeedback } from './threadPageComposerShared'

export type ThreadPageDisplayStateInput = {
  activePendingTurn: PendingThreadTurn | null
  approvals: PendingApproval[]
  commandSessions: CommandRuntimeSession[]
  contextCompactionFeedback: ContextCompactionFeedback | null
  liveThreadDetail?: ThreadDetail
  loadedThreadIds?: string[]
  selectedProcessId?: string
  selectedThread?: Thread
  selectedThreadEvents: ServerEvent[]
  selectedThreadId?: string
  selectedThreadTokenUsage: ThreadTokenUsage | null
  setContextCompactionFeedback: Dispatch<SetStateAction<ContextCompactionFeedback | null>>
  workspaceEvents: ServerEvent[]
  workspaceId: string
}

export type ThreadPageTurnDisplayStateInput = Pick<
  ThreadPageDisplayStateInput,
  | 'activePendingTurn'
  | 'liveThreadDetail'
  | 'selectedThread'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
>

export type ThreadPageSelectionDisplayStateInput = Pick<
  ThreadPageDisplayStateInput,
  | 'approvals'
  | 'commandSessions'
  | 'contextCompactionFeedback'
  | 'liveThreadDetail'
  | 'loadedThreadIds'
  | 'selectedProcessId'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'selectedThreadTokenUsage'
  | 'workspaceEvents'
>
