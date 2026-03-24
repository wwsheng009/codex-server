import { buildThreadTerminalDockBarState } from './threadTerminalDockBarState'
import type {
  ThreadTerminalDockProps,
  ThreadTerminalDockStyle,
  ThreadTerminalWorkspaceInput,
} from './threadTerminalDockTypes'
import type {
  ThreadTerminalDockRevealStateInput,
  ThreadTerminalDockRevealState,
  ThreadTerminalDockState,
  ThreadTerminalDockStyleInput,
} from './threadTerminalDockStateTypes'

export function buildThreadTerminalDockState(
  input: ThreadTerminalDockProps,
): ThreadTerminalDockState {
  return {
    bar: buildThreadTerminalDockBarState(input),
    dockStyle: buildThreadTerminalDockStyle(input),
    isExpanded: input.isExpanded,
    isFloating: input.isFloating,
    isVisible: input.isVisible,
    reveal: buildThreadTerminalDockRevealState(input),
    workspaceInput: buildThreadTerminalDockWorkspaceInput(input),
  }
}

function buildThreadTerminalDockStyle(
  input: ThreadTerminalDockStyleInput,
): ThreadTerminalDockStyle {
  if (input.isFloating && !input.isExpanded && input.style) {
    return {
      ...input.style,
      height: undefined,
    }
  }

  return input.style
}

function buildThreadTerminalDockRevealState(
  input: ThreadTerminalDockRevealStateInput,
): ThreadTerminalDockRevealState {
  return {
    className: input.isFloating
      ? 'terminal-dock__reveal terminal-dock__reveal--floating'
      : 'terminal-dock__reveal',
    onShow: input.onShow,
  }
}

function buildThreadTerminalDockWorkspaceInput(
  input: ThreadTerminalDockProps,
): ThreadTerminalWorkspaceInput {
  return {
    commandSessions: input.commandSessions,
    isFloating: input.isFloating,
    isWindowMaximized: input.isWindowMaximized,
    onClearCompletedSessions: input.onClearCompletedSessions,
    onRemoveSession: input.onRemoveSession,
    onResizeStart: input.onResizeStart,
    onResizeTerminal: input.onResizeTerminal,
    onSelectSession: input.onSelectSession,
    onStartShellSession: input.onStartShellSession,
    onStartCommandLine: input.onStartCommandLine,
    onTerminateSelectedSession: input.onTerminateSelectedSession,
    onToggleArchivedSession: input.onToggleArchivedSession,
    onTogglePinnedSession: input.onTogglePinnedSession,
    onWindowResizeStart: input.onWindowResizeStart,
    onWriteTerminalData: input.onWriteTerminalData,
    placement: input.placement,
    rootPath: input.rootPath,
    selectedCommandSession: input.selectedCommandSession,
    startCommandPending: input.startCommandPending,
    terminateDisabled: input.terminateDisabled,
  }
}
