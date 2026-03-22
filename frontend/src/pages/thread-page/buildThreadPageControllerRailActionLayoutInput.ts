import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerRailLayoutInput } from './threadPageControllerLayoutInputTypes'

type RailActionLayoutInput = Pick<
  ControllerRailLayoutInput,
  | 'onArchiveToggle'
  | 'onBeginRenameThread'
  | 'onCancelRenameThread'
  | 'onChangeCommand'
  | 'onChangeCommandRunMode'
  | 'onChangeEditingThreadName'
  | 'onCloseDeleteThreadDialog'
  | 'onConfirmDeleteThreadDialog'
  | 'onDeleteThread'
  | 'onHideSurfacePanel'
  | 'onInspectorResizeStart'
  | 'onOpenInspector'
  | 'onOpenSurfacePanel'
  | 'onResetInspectorWidth'
  | 'onStartCommand'
  | 'onSubmitRenameThread'
  | 'onToggleThreadToolsExpanded'
  | 'onToggleWorkbenchToolsExpanded'
>

export function buildThreadPageControllerRailActionLayoutInput({
  controllerState,
  pageActions,
  railState,
}: BuildThreadPageControllerLayoutPropsInput): RailActionLayoutInput {
  return {
    onArchiveToggle: pageActions.handleToggleArchiveSelectedThread,
    onBeginRenameThread: railState.handleBeginRenameSelectedThread,
    onCancelRenameThread: railState.handleCancelRenameSelectedThread,
    onChangeCommand: controllerState.setCommand,
    onChangeCommandRunMode: pageActions.handleChangeCommandRunMode,
    onChangeEditingThreadName: railState.setEditingThreadName,
    onCloseDeleteThreadDialog: pageActions.handleCloseDeleteThreadDialog,
    onConfirmDeleteThreadDialog: pageActions.handleConfirmDeleteThreadDialog,
    onDeleteThread: pageActions.handleDeleteSelectedThread,
    onHideSurfacePanel: railState.handleHideSurfacePanel,
    onInspectorResizeStart: controllerState.handleInspectorResizeStart,
    onOpenInspector: railState.handleOpenInspector,
    onOpenSurfacePanel: railState.handleOpenSurfacePanel,
    onResetInspectorWidth: controllerState.handleResetInspectorWidth,
    onStartCommand: pageActions.handleStartCommand,
    onSubmitRenameThread: pageActions.handleSubmitRenameSelectedThread,
    onToggleThreadToolsExpanded: railState.handleToggleThreadToolsExpanded,
    onToggleWorkbenchToolsExpanded: railState.handleToggleWorkbenchToolsExpanded,
  }
}
