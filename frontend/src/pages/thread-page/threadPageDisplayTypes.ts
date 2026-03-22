import type { Dispatch, SetStateAction } from 'react'

import type { CommandRuntimeSession } from '../../stores/session-store'
import type {
  PendingApproval,
  ServerEvent,
  Thread,
  ThreadDetail,
  ThreadTurn,
  ThreadTokenUsage,
} from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ContextCompactionFeedback } from './threadPageComposerShared'
import type { SurfacePanelView } from '../../lib/layout-config'

export type ThreadPageDisplayStateInput = {
  activePendingTurn: PendingThreadTurn | null
  approvals: PendingApproval[]
  commandSessions: CommandRuntimeSession[]
  contextCompactionFeedback: ContextCompactionFeedback | null
  historicalTurns: ThreadTurn[]
  liveThreadDetail?: ThreadDetail
  loadedThreadIds?: string[]
  selectedProcessId?: string
  selectedThread?: Thread
  selectedThreadEvents: ServerEvent[]
  selectedThreadId?: string
  selectedThreadTokenUsage: ThreadTokenUsage | null
  setContextCompactionFeedback: Dispatch<SetStateAction<ContextCompactionFeedback | null>>
  surfacePanelView: SurfacePanelView | null
  workspaceEvents: ServerEvent[]
  workspaceId: string
}

export type ThreadPageTurnDisplayStateInput = Pick<
  ThreadPageDisplayStateInput,
  | 'activePendingTurn'
  | 'historicalTurns'
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
  | 'historicalTurns'
  | 'liveThreadDetail'
  | 'loadedThreadIds'
  | 'selectedProcessId'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'selectedThreadTokenUsage'
  | 'surfacePanelView'
  | 'workspaceEvents'
>
