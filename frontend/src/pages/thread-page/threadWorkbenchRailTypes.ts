import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'

import type { ThreadTerminalDockProps } from '../../features/thread-terminal'
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
  terminalDockProps?: ThreadTerminalDockProps
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
