import type {
  BuildThreadTerminalDockWorkspaceStateInput,
  ThreadTerminalWorkspaceResizeHandleState,
  ThreadTerminalWorkspaceResizeStateInput,
  ThreadTerminalWorkspaceState,
  ThreadTerminalWorkspaceWindowResizeHandleState,
  ThreadTerminalWorkspaceWindowResizeStateInput
} from './threadTerminalDockStateTypes'

export function buildThreadTerminalDockWorkspaceState(
  input: BuildThreadTerminalDockWorkspaceStateInput,
): ThreadTerminalWorkspaceState {
  return {
    consoleSection: input.consoleSection,
    resizeHandle: buildThreadTerminalWorkspaceResizeHandleState(input.layout),
    sessionTabsSection: input.sessionTabsSection,
    windowResizeHandle: buildThreadTerminalWorkspaceWindowResizeHandleState(input.layout),
    workspaceRef: input.workspaceRef,
  }
}

function buildThreadTerminalWorkspaceResizeHandleState(
  input: ThreadTerminalWorkspaceResizeStateInput,
): ThreadTerminalWorkspaceResizeHandleState | null {
  if (input.placement !== 'bottom') {
    return null
  }

  return {
    onResizeStart: input.onResizeStart,
  }
}

function buildThreadTerminalWorkspaceWindowResizeHandleState(
  input: ThreadTerminalWorkspaceWindowResizeStateInput,
): ThreadTerminalWorkspaceWindowResizeHandleState | null {
  if (!input.isFloating || input.isWindowMaximized) {
    return null
  }

  return {
    onWindowResizeStart: input.onWindowResizeStart,
  }
}
