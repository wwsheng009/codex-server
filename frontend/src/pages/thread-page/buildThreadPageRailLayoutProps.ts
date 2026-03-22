import { getErrorMessage } from '../../lib/error-utils'
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
    lastTimelineEventTs: input.lastTimelineEventTs,
    liveThreadCwd: input.liveThreadCwd,
    pendingApprovalsCount: input.pendingApprovalsCount,
    rootPath: input.rootPath,
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
        confirmLabel: 'Delete Thread',
        description:
          'This removes the thread from this workspace list and clears its active UI state.',
        error: input.confirmDialogError
          ? getErrorMessage(input.confirmDialogError)
          : null,
        isPending: input.deletePending,
        onClose: input.onCloseDeleteThreadDialog,
        onConfirm: input.onConfirmDeleteThreadDialog,
        subject: input.confirmingThreadDelete.name,
        title: 'Delete Thread?',
      }
    : null

  return {
    confirmDialogProps,
    railProps,
  }
}
