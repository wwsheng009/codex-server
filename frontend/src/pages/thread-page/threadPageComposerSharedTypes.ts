import type { CatalogItem, RateLimit, ThreadTokenUsage } from '../../types/api'

export type ModelOption = {
  value: string
  label: string
  triggerLabel?: string
}

export type ComposerPermissionPreset = 'default' | 'full-access'
export type ComposerReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'
export type ComposerCollaborationMode = 'default' | 'plan'

export type ContextCompactionFeedback = {
  phase: 'requested' | 'completed' | 'failed'
  title: string
  threadId: string
}

export type ComposerPreferences = {
  permissionPreset: ComposerPermissionPreset
  model: string
  reasoningEffort: ComposerReasoningEffort
  collaborationMode: ComposerCollaborationMode
}

export type ComposerAssistPanel = 'mcp' | 'personalization' | 'status' | 'worktree'
export type ComposerCommandMenu = 'root' | 'review'

export type ComposerCommandId =
  | 'mcp'
  | 'personalization'
  | 'review'
  | 'feedback'
  | 'worktree'
  | 'status'
  | 'plan'

export type ComposerCommandAction =
  | { kind: 'panel'; panel: ComposerAssistPanel }
  | { kind: 'prompt'; prompt: string }
  | { kind: 'submenu'; menu: ComposerCommandMenu }
  | { kind: 'toggle-plan' }

export type ComposerOptionIcon =
  | 'feedback'
  | 'file'
  | 'mcp'
  | 'personalization'
  | 'plan'
  | 'review'
  | 'skill'
  | 'status'
  | 'worktree'

export type ComposerCommandDefinition = {
  id: ComposerCommandId
  title: string
  description: string
  keywords: string[]
  icon: ComposerOptionIcon
  action: ComposerCommandAction
}

export type ComposerReviewShortcutDefinition = {
  id: 'review-base' | 'review-uncommitted'
  title: string
  description: string
  prompt: string
}

export type ComposerAutocompleteItem =
  | {
      kind: 'command'
      id: ComposerCommandId
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      action: ComposerCommandAction
      section: 'commands'
    }
  | {
      kind: 'review'
      id: ComposerReviewShortcutDefinition['id']
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      prompt: string
      section: 'commands'
    }
  | {
      kind: 'skill'
      id: string
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      insertion: string
      section: 'skills'
    }
  | {
      kind: 'file'
      id: string
      title: string
      description: string
      meta?: string
      icon: ComposerOptionIcon
      insertion: string
      section: 'files'
    }

export type ComposerAutocompleteSection = {
  id: ComposerAutocompleteItem['section']
  label: string
  items: ComposerAutocompleteItem[]
}

export type ComposerAutocompleteFileEntry = {
  directory: string
  name: string
  path: string
}

export type ComposerOptionGlyphProps = {
  icon: ComposerOptionIcon
}

export type BuildComposerAutocompleteSectionsInput = {
  commandMenu: ComposerCommandMenu
  commands: ComposerCommandDefinition[]
  files: ComposerAutocompleteFileEntry[]
  mode: 'command' | 'mention' | 'skill'
  query: string
  skills: CatalogItem[]
}

export type NormalizedMcpServerState = {
  name: string
  status: string
  detail: string
}

export type ComposerPersonalizationPanelProps = {
  accountEmail?: string
  customInstructions: string
  responseTone: string
}

export type ComposerWorktreePanelProps = {
  maxWorktrees: number
  reuseBranches: boolean
}

export type ComposerStatusPanelProps = {
  compactDisabledReason: string | null
  compactFeedback: ContextCompactionFeedback | null
  compactPending: boolean
  contextWindow: number
  percent: number | null
  rateLimits?: RateLimit[]
  rateLimitsError: unknown
  rateLimitsLoading: boolean
  resolvedThreadTokenUsage: ThreadTokenUsage | null | undefined
  runtimeStatus: string
  totalTokens: number
}

export type ComposerMcpPanelProps = {
  mcpServerStates: NormalizedMcpServerState[]
  mcpServerStatusLoading: boolean
}

export type ComposerStatusTone = 'active' | 'warning' | 'error' | 'neutral'

export type ComposerStatusDetailRow = {
  label: string
  value: string
}

export type ComposerStatusInfo = {
  label: string
  tone: ComposerStatusTone
  summary: string
  detailRows: ComposerStatusDetailRow[]
  noticeTitle?: string
  noticeMessage?: string
}

export type BuildComposerStatusInfoInput = {
  approvalSummary?: string
  isApprovalDialogOpen: boolean
  isThreadInterruptible: boolean
  isThreadLoaded: boolean | null
  isWaitingForThreadData: boolean
  latestTurnError?: unknown
  latestTurnStatus?: string
  pendingPhase?: 'sending' | 'waiting'
  rawThreadStatus?: string
  requiresOpenAIAuth: boolean
  sendError?: string | null
  streamState: string
}

export type BuildSyncStatusDisplayInput = {
  autoSyncIntervalMs: number | null
  isHeaderSyncBusy: boolean
  lastAutoSyncAtMs: number
  nowMs: number
  streamState: string
}

export type ContextUsageIndicatorProps = {
  compactDisabledReason: string | null
  compactFeedback: ContextCompactionFeedback | null
  compactPending: boolean
  contextWindow: number
  onCompact: () => void
  percent: number | null
  totalTokens: number
  usage: ThreadTokenUsage | null | undefined
}

export type ComposerStatusIndicatorProps = {
  info: ComposerStatusInfo
}
