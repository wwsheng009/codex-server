import type { Dispatch, SetStateAction } from 'react'

import type { CommandRuntimeSession } from '../../stores/session-store-types'
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
import type { SurfacePanelView } from '../../lib/layout-config-types'

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

export type ThreadPageTurnDisplayStateInput = {
  activePendingTurn: PendingThreadTurn | null
  fullTurnItemContentOverridesById: Record<string, Record<string, unknown>>
  fullTurnItemOverridesById: Record<string, Record<string, unknown>>
  fullTurnOverridesById: Record<string, ThreadTurn>
  historicalTurns: ThreadTurn[]
  liveThreadDetail?: ThreadDetail
  selectedThreadId?: string
}

export type ThreadPageSelectionDisplayStateInput = {
  approvals: PendingApproval[]
  contextCompactionFeedback: ContextCompactionFeedback | null
  historicalTurns: ThreadTurn[]
  liveThreadDetail?: ThreadDetail
  loadedThreadIds?: string[]
  selectedCommandSession?: CommandRuntimeSession
  selectedThreadEvents: ServerEvent[]
  selectedThreadId?: string
  selectedThreadTokenUsage: ThreadTokenUsage | null
  surfacePanelView: SurfacePanelView | null
  workspaceEvents: ServerEvent[]
}
