import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { SurfacePanelView } from '../../lib/layout-config-types'
import type {
  Bot,
  BotDeliveryTarget,
  HookRun,
  Thread,
  ThreadBotBinding,
  TurnPolicyDecision,
  TurnPolicyMetricsSummary,
  WorkspaceHookConfigurationResult,
} from '../../types/api'
import type { ShellEnvironmentDiagnosisSummary } from '../../features/settings/shell-environment-diagnostics'
import type { WorkspaceRuntimeRecoverySummary } from '../../features/workspaces/runtimeRecovery'
import type { CommandRunMode } from './threadPageActionTypes'

export type ThreadWorkbenchRailProps = {
  botSendBots: Bot[]
  botSendDeliveryTargets: BotDeliveryTarget[]
  botSendErrorMessage?: string | null
  botSendBinding?: ThreadBotBinding | null
  botSendBindingPending: boolean
  botSendLoading: boolean
  botSendPending: boolean
  botSendSelectedBotId: string
  botSendSelectedDeliveryTargetId: string
  botSendText: string
  command: string
  commandRunMode: CommandRunMode
  commandCount: number
  deletePending: boolean
  deletingThreadId?: string
  editingThreadId?: string
  editingThreadName: string
  isExpanded: boolean
  isMobileViewport: boolean
  isResizing: boolean
  isThreadToolsExpanded: boolean
  isWorkbenchToolsExpanded: boolean
  latestTurnStatus?: string
  lastTimelineEventTs?: string
  loadedAssistantMessageCount: number
  liveThreadCwd?: string
  loadedUserMessageCount: number
  pendingApprovalsCount: number
  rootPath?: string
  runtimeRecoverySummary?: WorkspaceRuntimeRecoverySummary | null
  runtimeStartedAt?: string
  runtimeUpdatedAt?: string
  runtimeConfigChangedAt?: string
  runtimeConfigLoadStatus: string
  runtimeRestartRequired: boolean
  restartRuntimePending?: boolean
  hookConfiguration?: WorkspaceHookConfigurationResult | null
  hookConfigurationError?: string | null
  hookConfigurationLoading: boolean
  selectedThread?: Thread
  shellEnvironmentInfo?: string
  shellEnvironmentWarning?: string
  shellEnvironmentSummary?: ShellEnvironmentDiagnosisSummary
  startCommandModeDisabled: boolean
  startCommandPending: boolean
  streamState: string
  surfacePanelView: SurfacePanelView | null
  hookRuns: HookRun[]
  hookRunsError?: string | null
  hookRunsLoading: boolean
  turnPolicyDecisions: TurnPolicyDecision[]
  turnPolicyDecisionsError?: string | null
  turnPolicyDecisionsLoading: boolean
  turnPolicyMetrics?: TurnPolicyMetricsSummary | null
  turnPolicyMetricsError?: string | null
  turnPolicyMetricsLoading: boolean
  contextUsagePercent: number | null
  contextWindow: number
  loadedMessageCount: number
  loadedTurnCount: number
  totalTokens: number
  totalMessageCount: number
  totalTurnCount: number
  threadCount: number
  timelineItemCount: number
  turnCount: number
  workspaceName?: string
  onArchiveToggle: () => void
  onBeginRenameThread: () => void
  onBindThreadBotChannel: () => void
  onCancelRenameThread: () => void
  onChangeBotSendSelectedBotId: (value: string) => void
  onChangeBotSendSelectedDeliveryTargetId: (value: string) => void
  onChangeBotSendText: (value: string) => void
  onChangeCommand: (value: string) => void
  onChangeCommandRunMode: (value: CommandRunMode) => void
  onChangeEditingThreadName: (value: string) => void
  onCloseWorkbenchOverlay: () => void
  onDeleteThread: () => void
  onDeleteThreadBotBinding: () => void
  onHideSurfacePanel: () => void
  onInspectorResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onOpenInspector: () => void
  onOpenSurfacePanel: (view: SurfacePanelView) => void
  onRestartRuntime?: () => void
  onResetInspectorWidth: () => void
  onSendBotMessage: (event: FormEvent<HTMLFormElement>) => void
  onSubmitRenameThread: (event: FormEvent<HTMLFormElement>) => void
  onStartCommand: (event: FormEvent<HTMLFormElement>) => void
  onToggleThreadToolsExpanded: () => void
  onToggleWorkbenchToolsExpanded: () => void
}

export type ThreadWorkbenchRailCollapsedProps = {
  onOpenInspector: () => void
  onOpenSurfacePanel: (view: SurfacePanelView) => void
}

export type ThreadWorkbenchRailMobileQuickActionsProps = {
  onOpenSurfacePanel: (view: SurfacePanelView) => void
  surfacePanelView: SurfacePanelView | null
}

export type ThreadWorkbenchRailInfoLabelProps = {
  help?: string
  label: string
}

export type ThreadWorkbenchRailThreadToolsSectionProps = {
  deletePending: boolean
  deletingThreadId?: string
  editingThreadId?: string
  editingThreadName: string
  isThreadToolsExpanded: boolean
  onArchiveToggle: () => void
  onBeginRenameThread: () => void
  onCancelRenameThread: () => void
  onChangeEditingThreadName: (value: string) => void
  onDeleteThread: () => void
  onSubmitRenameThread: (event: FormEvent<HTMLFormElement>) => void
  onToggleThreadToolsExpanded: () => void
  selectedThread?: Thread
}

export type ThreadWorkbenchRailTurnPolicyDecisionsSectionProps = {
  selectedThread?: Thread
  turnPolicyDecisions: TurnPolicyDecision[]
  turnPolicyDecisionsError?: string | null
  turnPolicyDecisionsLoading: boolean
}

export type ThreadWorkbenchRailHookRunsSectionProps = {
  selectedThread?: Thread
  hookRuns: HookRun[]
  hookRunsError?: string | null
  hookRunsLoading: boolean
}

export type ThreadWorkbenchRailHookConfigurationSectionProps = {
  hookConfiguration?: WorkspaceHookConfigurationResult | null
  hookConfigurationError?: string | null
  hookConfigurationLoading: boolean
  governanceTab?: 'overview' | 'runtime' | 'workspace' | 'activity'
}

export type ThreadWorkbenchRailTurnPolicyMetricsSectionProps = {
  selectedThread?: Thread
  turnPolicyMetrics?: TurnPolicyMetricsSummary | null
  turnPolicyMetricsError?: string | null
  turnPolicyMetricsLoading: boolean
}

export type ThreadWorkbenchRailWorkbenchToolsSectionProps = {
  botSendBots: Bot[]
  botSendDeliveryTargets: BotDeliveryTarget[]
  botSendErrorMessage?: string | null
  botSendBinding?: ThreadBotBinding | null
  botSendBindingPending: boolean
  botSendLoading: boolean
  botSendPending: boolean
  botSendSelectedBotId: string
  botSendSelectedDeliveryTargetId: string
  botSendText: string
  command: string
  commandRunMode: CommandRunMode
  isWorkbenchToolsExpanded: boolean
  onBindThreadBotChannel: () => void
  onChangeBotSendSelectedBotId: (value: string) => void
  onChangeBotSendSelectedDeliveryTargetId: (value: string) => void
  onChangeBotSendText: (value: string) => void
  onChangeCommand: (value: string) => void
  onChangeCommandRunMode: (value: CommandRunMode) => void
  onDeleteThreadBotBinding: () => void
  onSendBotMessage: (event: FormEvent<HTMLFormElement>) => void
  onStartCommand: (event: FormEvent<HTMLFormElement>) => void
  onToggleWorkbenchToolsExpanded: () => void
  selectedThread?: Thread
  startCommandModeDisabled: boolean
  startCommandPending: boolean
}

export type ThreadWorkbenchRailWorkspaceContextSectionProps = {
  commandCount: number
  contextUsagePercent: number | null
  contextWindow: number
  isMobileViewport: boolean
  lastTimelineEventTs?: string
  latestTurnStatus?: string
  loadedAssistantMessageCount: number
  loadedMessageCount: number
  loadedTurnCount: number
  loadedUserMessageCount: number
  liveThreadCwd?: string
  onHideSurfacePanel: () => void
  onOpenSurfacePanel: (view: SurfacePanelView) => void
  onRestartRuntime?: () => void
  pendingApprovalsCount: number
  rootPath?: string
  runtimeRecoverySummary?: WorkspaceRuntimeRecoverySummary | null
  runtimeConfigChangedAt?: string
  runtimeConfigLoadStatus: string
  runtimeRestartRequired: boolean
  restartRuntimePending?: boolean
  runtimeStartedAt?: string
  runtimeUpdatedAt?: string
  selectedThread?: Thread
  shellEnvironmentInfo?: string
  shellEnvironmentSummary?: ShellEnvironmentDiagnosisSummary
  shellEnvironmentWarning?: string
  streamState: string
  surfacePanelView: SurfacePanelView | null
  threadCount: number
  timelineItemCount: number
  totalMessageCount: number
  totalTokens: number
  totalTurnCount: number
  turnCount: number
  workspaceName?: string
}
