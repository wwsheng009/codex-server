import type {
  BuildThreadTerminalDockBarCopyStateInput,
  BuildThreadTerminalDockBarPrimaryActionsStateInput,
  BuildThreadTerminalDockBarStateInput,
  BuildThreadTerminalDockBarWindowActionsStateInput,
  BuildThreadTerminalDockPlacementSwitchStateInput,
  ThreadTerminalDockBarCopyState,
  ThreadTerminalDockBarPrimaryActionsState,
  ThreadTerminalDockBarState,
  ThreadTerminalDockBarWindowActionsState,
  ThreadTerminalDockPlacementSwitchState,
} from './threadTerminalDockStateTypes'

export function buildThreadTerminalDockBarState(
  input: BuildThreadTerminalDockBarStateInput,
): ThreadTerminalDockBarState {
  return {
    copy: buildThreadTerminalDockBarCopyState(input),
    primaryActions: buildThreadTerminalDockBarPrimaryActionsState(input),
    windowActions: buildThreadTerminalDockBarWindowActionsState(input),
  }
}

function buildThreadTerminalDockBarCopyState(
  input: BuildThreadTerminalDockBarCopyStateInput,
): ThreadTerminalDockBarCopyState {
  return {
    activeCommandCount: input.activeCommandCount,
    commandSessionsCount: input.commandSessions.length,
    dragHandleDisabled: input.isWindowMaximized,
    isFloating: input.isFloating,
    onDragStart: input.onDragStart,
  }
}

function buildThreadTerminalDockBarPrimaryActionsState(
  input: BuildThreadTerminalDockBarPrimaryActionsStateInput,
): ThreadTerminalDockBarPrimaryActionsState {
  return {
    hideActionVisible: input.isVisible,
    isExpanded: input.isExpanded,
    onHide: input.onHide,
    onToggleExpanded: input.onToggleExpanded,
    placementSwitch: buildThreadTerminalDockPlacementSwitchState(input),
  }
}

function buildThreadTerminalDockPlacementSwitchState(
  input: BuildThreadTerminalDockPlacementSwitchStateInput,
): ThreadTerminalDockPlacementSwitchState {
  return {
    onChangePlacement: input.onChangePlacement,
    placement: input.placement,
  }
}

function buildThreadTerminalDockBarWindowActionsState(
  input: BuildThreadTerminalDockBarWindowActionsStateInput,
): ThreadTerminalDockBarWindowActionsState | null {
  if (!input.isFloating) {
    return null
  }

  return {
    isWindowMaximized: input.isWindowMaximized,
    onResetFloatingBounds: input.onResetFloatingBounds,
    onToggleWindowMaximized: input.onToggleWindowMaximized,
  }
}
