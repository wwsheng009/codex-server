import { getErrorMessage } from '../../lib/error-utils'
import { i18n } from '../../i18n/runtime'
import type {
  BuildThreadPageLayoutPropsInput,
  ConfirmDialogProps,
  RailProps,
} from './threadPageLayoutPropTypes'

export function buildThreadPageRailLayoutProps(
  input: BuildThreadPageLayoutPropsInput,
): {
  confirmDialogProps: ConfirmDialogProps | null
  railProps: RailProps
} {
  const terminalDockProps = undefined

  const railProps: RailProps = {
    command: input.command,
    commandRunMode: input.commandRunMode,
    commandCount: input.commandCount,
    deletePending: input.deletePending,
    deletingThreadId: input.deletingThreadId,
    editingThreadId: input.editingThreadId,
    editingThreadName: input.editingThreadName,
    isExpanded: input.isExpanded,
    isMobileViewport: input.isMobileViewport,
    isResizing: input.isResizing,
    isThreadToolsExpanded: input.isThreadToolsExpanded,
    isWorkbenchToolsExpanded: input.isWorkbenchToolsExpanded,
    latestTurnStatus: input.latestTurnStatus,
    lastTimelineEventTs: input.lastTimelineEventTs,
    loadedAssistantMessageCount: input.loadedAssistantMessageCount,
    contextUsagePercent: input.contextUsagePercent,
    contextWindow: input.contextWindow,
    loadedMessageCount: input.loadedMessageCount,
    loadedTurnCount: input.loadedTurnCount,
    liveThreadCwd: input.liveThreadCwd,
    loadedUserMessageCount: input.loadedUserMessageCount,
    pendingApprovalsCount: input.pendingApprovalsCount,
    rootPath: input.rootPath,
    runtimeConfigChangedAt: input.runtimeConfigChangedAt,
    runtimeConfigLoadStatus: input.runtimeConfigLoadStatus,
    runtimeRestartRequired: input.runtimeRestartRequired,
    runtimeStartedAt: input.runtimeStartedAt,
    runtimeUpdatedAt: input.runtimeUpdatedAt,
    selectedThread: input.selectedThread,
    shellEnvironmentInfo: input.shellEnvironmentInfo,
    shellEnvironmentSummary: input.shellEnvironmentSummary,
    shellEnvironmentWarning: input.shellEnvironmentWarning,
    startCommandModeDisabled: input.startCommandModeDisabled,
    startCommandPending: input.startCommandPending,
    streamState: input.streamState,
    surfacePanelView: input.surfacePanelView,
    threadCount: input.threadCount,
    timelineItemCount: input.timelineItemCount,
    totalTokens: input.totalTokens,
    totalMessageCount: input.totalMessageCount,
    totalTurnCount: input.totalTurnCount,
    terminalDockProps,
    turnCount: input.turnCount,
    workspaceName: input.workspaceName,
    onArchiveToggle: input.onArchiveToggle,
    onBeginRenameThread: input.onBeginRenameThread,
    onCancelRenameThread: input.onCancelRenameThread,
    onChangeCommand: input.onChangeCommand,
    onChangeCommandRunMode: input.onChangeCommandRunMode,
    onChangeEditingThreadName: input.onChangeEditingThreadName,
    onCloseWorkbenchOverlay: input.onCloseWorkbenchOverlay,
    onDeleteThread: input.onDeleteThread,
    onHideSurfacePanel: input.onHideSurfacePanel,
    onInspectorResizeStart: input.onInspectorResizeStart,
    onOpenInspector: input.onOpenInspector,
    onOpenSurfacePanel: input.onOpenSurfacePanel,
    onResetInspectorWidth: input.onResetInspectorWidth,
    onStartCommand: input.onStartCommand,
    onSubmitRenameThread: input.onSubmitRenameThread,
    onToggleThreadToolsExpanded: input.onToggleThreadToolsExpanded,
    onToggleWorkbenchToolsExpanded: input.onToggleWorkbenchToolsExpanded,
  }

  const confirmDialogProps: ConfirmDialogProps | null = input.confirmingThreadDelete
    ? {
        confirmLabel: i18n._({
          id: 'Delete Thread',
          message: 'Delete Thread',
        }),
        description: i18n._({
          id: 'This removes the thread from this workspace list and clears its active UI state.',
          message: 'This removes the thread from this workspace list and clears its active UI state.',
        }),
        error: input.confirmDialogError
          ? getErrorMessage(input.confirmDialogError)
          : null,
        isPending: input.deletePending,
        onClose: input.onCloseDeleteThreadDialog,
        onConfirm: input.onConfirmDeleteThreadDialog,
        subject: input.confirmingThreadDelete.name,
        title: i18n._({
          id: 'Delete Thread?',
          message: 'Delete Thread?',
        }),
      }
    : null

  return {
    confirmDialogProps,
    railProps,
  }
}
