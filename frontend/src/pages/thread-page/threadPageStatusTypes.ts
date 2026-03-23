import type { Account, PendingApproval, ServerEvent, Thread, ThreadTurn } from '../../types/api'
import type { TerminalDockPlacement } from '../../lib/layout-config'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ComposerStatusInfo, ContextCompactionFeedback } from './threadPageComposerShared'

export type ThreadPageStatusStateInput = {
  account?: Account
  accountError: unknown
  activeComposerApproval: PendingApproval | null
  activeContextCompactionFeedback: ContextCompactionFeedback | null
  activePendingTurn: PendingThreadTurn | null
  approvalsDataUpdatedAt: number
  approvalsIsFetching: boolean
  commandSessions: Array<{ status: string }>
  displayedTurnsLength: number
  hasUnreadThreadUpdates: boolean
  isDocumentVisible: boolean
  interruptPending: boolean
  isInspectorExpanded: boolean
  isMobileViewport: boolean
  isTerminalDockVisible: boolean
  isSelectedThreadLoaded: boolean | null
  isTerminalDockExpanded: boolean
  isTerminalDockResizing: boolean
  isTerminalWindowDragging: boolean
  isTerminalWindowMaximized: boolean
  isTerminalWindowResizing: boolean
  terminalDockPlacement: TerminalDockPlacement
  isThreadPinnedToLatest: boolean
  latestDisplayedTurn?: ThreadTurn
  liveThreadStatus?: string
  selectedThread?: Thread
  selectedThreadEvents: Array<Pick<ServerEvent, 'ts'>>
  selectedThreadId?: string
  sendError: string | null
  suppressAuthenticationError: boolean
  streamState: string
  surfacePanelView: 'approvals' | 'feed' | null
  syncClock: number
  threadDetailDataUpdatedAt: number
  threadDetailIsFetching: boolean
  threadsDataUpdatedAt: number
  threadsIsFetching: boolean
  workspaceEvents: Array<Pick<ServerEvent, 'ts'>>
  workspaceId: string
}

export type ThreadPageInteractionStatusInput = Pick<
  ThreadPageStatusStateInput,
  | 'account'
  | 'accountError'
  | 'activeComposerApproval'
  | 'activeContextCompactionFeedback'
  | 'activePendingTurn'
  | 'hasUnreadThreadUpdates'
  | 'interruptPending'
  | 'isThreadPinnedToLatest'
  | 'latestDisplayedTurn'
  | 'selectedThread'
  | 'selectedThreadId'
  | 'sendError'
  | 'suppressAuthenticationError'
  | 'streamState'
>

export type ThreadPageSyncStatusInput = Pick<
  ThreadPageStatusStateInput,
  | 'activePendingTurn'
  | 'approvalsDataUpdatedAt'
  | 'approvalsIsFetching'
  | 'selectedThreadId'
  | 'streamState'
  | 'syncClock'
  | 'threadDetailDataUpdatedAt'
  | 'threadDetailIsFetching'
  | 'threadsDataUpdatedAt'
  | 'threadsIsFetching'
  | 'workspaceId'
>

export type ThreadPageWorkbenchStatusInput = Pick<
  ThreadPageStatusStateInput,
  | 'commandSessions'
  | 'displayedTurnsLength'
  | 'isInspectorExpanded'
  | 'isMobileViewport'
  | 'isTerminalDockVisible'
  | 'isTerminalDockExpanded'
  | 'isTerminalDockResizing'
  | 'isTerminalWindowDragging'
  | 'isTerminalWindowMaximized'
  | 'isTerminalWindowResizing'
  | 'terminalDockPlacement'
  | 'isThreadPinnedToLatest'
  | 'selectedThread'
  | 'selectedThreadEvents'
  | 'selectedThreadId'
  | 'streamState'
  | 'surfacePanelView'
  | 'workspaceEvents'
> & {
  composerStatusInfo: ComposerStatusInfo | null
  mobileStatus: string
  syncLabel: string
}
