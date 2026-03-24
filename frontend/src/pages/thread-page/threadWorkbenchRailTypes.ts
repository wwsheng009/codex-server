import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { SurfacePanelView } from '../../lib/layout-config'
import type { Thread } from '../../types/api'
import type { ShellEnvironmentDiagnosisSummary } from '../../features/settings/shell-environment-diagnostics'
import type { CommandRunMode } from './threadPageActionTypes'

export type ThreadWorkbenchRailProps = {
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
  runtimeStartedAt?: string
  runtimeUpdatedAt?: string
  runtimeConfigChangedAt?: string
  runtimeConfigLoadStatus: string
  runtimeRestartRequired: boolean
  selectedThread?: Thread
  shellEnvironmentInfo?: string
  shellEnvironmentWarning?: string
  shellEnvironmentSummary?: ShellEnvironmentDiagnosisSummary
  startCommandModeDisabled: boolean
  startCommandPending: boolean
  streamState: string
  surfacePanelView: SurfacePanelView | null
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
  onCancelRenameThread: () => void
  onChangeCommand: (value: string) => void
  onChangeCommandRunMode: (value: CommandRunMode) => void
  onChangeEditingThreadName: (value: string) => void
  onCloseWorkbenchOverlay: () => void
  onDeleteThread: () => void
  onHideSurfacePanel: () => void
  onInspectorResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onOpenInspector: () => void
  onOpenSurfacePanel: (view: SurfacePanelView) => void
  onResetInspectorWidth: () => void
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

export type ThreadWorkbenchRailWorkbenchToolsSectionProps = {
  command: string
  commandRunMode: CommandRunMode
  isWorkbenchToolsExpanded: boolean
  onChangeCommand: (value: string) => void
  onChangeCommandRunMode: (value: CommandRunMode) => void
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
  pendingApprovalsCount: number
  rootPath?: string
  runtimeConfigChangedAt?: string
  runtimeConfigLoadStatus: string
  runtimeRestartRequired: boolean
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
