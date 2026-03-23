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
  contextCompactionFeedback: ContextCompactionFeedback | null
  fullTurnItemContentOverridesById: Record<string, Record<string, unknown>>
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>
  fullTurnOverridesById: Record<string, ThreadTurn>
  historicalTurns: ThreadTurn[]
  liveThreadDetail?: ThreadDetail
  loadedThreadIds?: string[]
  selectedCommandSession?: CommandRuntimeSession
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
  | 'fullTurnItemContentOverridesById'
  | 'fullTurnItemOverridesById'
  | 'fullTurnOverridesById'
  | 'historicalTurns'
  | 'liveThreadDetail'
  | 'selectedThreadId'
>

export type ThreadPageSelectionDisplayStateInput = Pick<
  ThreadPageDisplayStateInput,
  | 'approvals'
  | 'contextCompactionFeedback'
  | 'historicalTurns'
  | 'liveThreadDetail'
  | 'loadedThreadIds'
  | 'selectedCommandSession'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'selectedThreadTokenUsage'
  | 'surfacePanelView'
  | 'workspaceEvents'
>
