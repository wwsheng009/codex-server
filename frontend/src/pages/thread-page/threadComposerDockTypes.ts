import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, RefObject } from 'react'

import type { SelectOption } from '../../components/ui/selectControlTypes'
import type { PendingApproval, RateLimit, Thread, ThreadTokenUsage } from '../../types/api'
import type { PendingThreadTurn } from '../threadPageTurnHelpers'
import type { ThreadPageRespondApprovalInput } from './threadPageActionTypes'
import type {
  ComposerAssistPanel,
  ComposerAutocompleteItem,
  ComposerAutocompleteSection,
  ComposerPreferences,
  ComposerStatusInfo,
  ContextCompactionFeedback,
  NormalizedMcpServerState,
} from './threadPageComposerShared'

export type ComposerAutocompleteSectionGroup = ComposerAutocompleteSection & {
  indexedItems: Array<{
    item: ComposerAutocompleteItem
    index: number
  }>
}

export type WorkingTimerProps = {
  startTime: number
  isInterruptible: boolean
}

export type ThreadComposerDockProps = {
  accountEmail?: string
  activeComposerApproval?: PendingApproval | null
  activeComposerPanel: ComposerAssistPanel | null
  activePendingTurn?: PendingThreadTurn | null
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  approvalsCount: number
  autoPruneDays: number
  compactDisabledReason: string | null
  compactFeedback: ContextCompactionFeedback | null
  compactPending: boolean
  composerActivityDetail: string | null
  composerActivityTitle: string | null
  composerAutocompleteIndex: number
  composerAutocompleteSectionGroups: ComposerAutocompleteSectionGroup[]
  composerDockRef: RefObject<HTMLFormElement | null>
  composerDockMeasureRef: RefObject<HTMLDivElement | null>
  composerInputRef: RefObject<HTMLTextAreaElement | null>
  composerPreferences: ComposerPreferences
  composerStatusInfo: ComposerStatusInfo | null
  composerStatusMessage: string | null
  composerStatusRetryLabel?: string
  contextWindow: number
  customInstructions: string
  desktopModelOptions: SelectOption[]
  fileSearchIsFetching: boolean
  hasUnreadThreadUpdates: boolean
  isApprovalDialogOpen: boolean
  isCommandAutocompleteOpen: boolean
  isComposerLocked: boolean
  isInterruptMode: boolean
  interruptPending: boolean
  isMentionAutocompleteOpen: boolean
  isMobileViewport: boolean
  isSendBusy: boolean
  isSkillAutocompleteOpen: boolean
  isThreadProcessing: boolean
  isWaitingForThreadData: boolean
  maxWorktrees: number
  mcpServerStates: NormalizedMcpServerState[]
  mcpServerStatusLoading: boolean
  message: string
  mobileCollaborationModeOptions: SelectOption[]
  mobileModelOptions: SelectOption[]
  mobilePermissionOptions: SelectOption[]
  mobileReasoningOptions: SelectOption[]
  modelsLoading: boolean
  onChangeApprovalAnswer: (requestId: string, questionId: string, value: string) => void
  onChangeCollaborationMode: (value: string) => void
  onChangeComposerAutocompleteIndex: (index: number) => void
  onChangeComposerMessage: (value: string, caret: number) => void
  onChangeModel: (value: string) => void
  onChangePermissionPreset: (value: string) => void
  onChangeReasoningEffort: (value: string) => void
  onCloseComposerPanel: () => void
  onCompactSelectedThread: () => void
  onComposerKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void
  onComposerSelect: (caret: number) => void
  onJumpToLatest: () => void
  onPrimaryComposerAction: () => void
  onRespondApproval: (input: ThreadPageRespondApprovalInput) => void
  onRetryComposerStatus?: () => void
  onSelectComposerAutocompleteItem: (item: ComposerAutocompleteItem) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  percent: number | null
  rateLimits?: RateLimit[]
  rateLimitsError: unknown
  rateLimitsLoading: boolean
  resolvedThreadTokenUsage: ThreadTokenUsage | null | undefined
  respondingToApproval: boolean
  responseTone: string
  reuseBranches: boolean
  runtimeStatus: string
  selectedThread?: Thread
  selectedThreadId?: string
  sendButtonLabel: string
  shouldShowComposerSpinner: boolean
  showJumpToLatestButton: boolean
  showMentionSearchHint: boolean
  showSkillSearchLoading: boolean
  totalTokens: number
  workspaceId: string
}
