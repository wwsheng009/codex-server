import type {
  BuildThreadTerminalToolbarLaunchActionsStateInput,
  BuildThreadTerminalToolbarSessionActionsStateInput,
  BuildThreadTerminalToolbarStateInput,
  BuildThreadTerminalToolbarViewportActionsStateInput,
  ThreadTerminalToolbarLaunchActionsState,
  ThreadTerminalToolbarLauncherState,
  ThreadTerminalToolbarSessionActionsState,
  ThreadTerminalToolbarShellSelectState,
  ThreadTerminalToolbarState,
  ThreadTerminalToolbarViewportActionsState
} from './threadTerminalConsoleStateTypes'

export function buildThreadTerminalToolbarState(
  input: BuildThreadTerminalToolbarStateInput,
): ThreadTerminalToolbarState {
  return {
    launchActions: buildThreadTerminalToolbarLaunchActionsState(input),
    sessionActions: buildThreadTerminalToolbarSessionActionsState(input),
    viewportActions: buildThreadTerminalToolbarViewportActionsState(input),
  }
}

function buildThreadTerminalToolbarLaunchActionsState(
  input: BuildThreadTerminalToolbarLaunchActionsStateInput,
): ThreadTerminalToolbarLaunchActionsState {
  return {
    isLauncherOpen: input.launcher.isOpen,
    launcherMode: input.launcher.mode,
    onOpenCommandLauncher: () => input.launcher.open('command'),
    onStartShellSession: input.launcher.startShellDirect,
    shellActionLabel: input.launcher.defaultShellLauncherName,
    shellActionTitle: input.launcher.newShellSessionTitle,
    shellSelect: buildThreadTerminalToolbarShellSelectState(input.launcher),
    startSessionPending: input.startCommandPending,
  }
}

function buildThreadTerminalToolbarShellSelectState(
  launcher: ThreadTerminalToolbarLauncherState,
): ThreadTerminalToolbarShellSelectState | null {
  return {
    isLauncherOpen: launcher.isOpen,
    launcherMode: launcher.mode,
    launcherShell: launcher.shell,
    onSetLauncherShell: launcher.setShell,
    terminalShellOptions: launcher.terminalShellOptions,
  }
}

function buildThreadTerminalToolbarViewportActionsState(
  input: BuildThreadTerminalToolbarViewportActionsStateInput,
): ThreadTerminalToolbarViewportActionsState {
  return {
    canCopy: input.launcher.isOpen
      ? input.launcher.hasSelection
      : input.sessions.hasSelectedSessionSelection,
    canPaste: input.launcher.isOpen
      ? input.launcher.mode === 'command'
      : input.sessions.isInteractive,
    onClearViewport: input.viewport.clear,
    onCopySelection: input.viewport.copySelection,
    onFitViewport: input.viewport.fit,
    onFocusViewport: input.viewport.focus,
    onPasteClipboard: input.viewport.pasteClipboard,
    onSearchTerminal: input.search.toggle,
    searchDisabled: input.launcher.isOpen || !input.selectedCommandSession?.id,
  }
}

function buildThreadTerminalToolbarSessionActionsState(
  input: BuildThreadTerminalToolbarSessionActionsStateInput,
): ThreadTerminalToolbarSessionActionsState {
  return {
    canArchiveSelectedSession: !input.launcher.isOpen && Boolean(input.selectedCommandSession?.id),
    canPinSelectedSession: !input.launcher.isOpen && Boolean(input.selectedCommandSession?.id),
    commandSessionsCount: input.commandSessionsCount,
    isLauncherOpen: input.launcher.isOpen,
    isSelectedSessionArchived: Boolean(input.selectedCommandSession?.archived),
    isSelectedSessionPinned: Boolean(input.selectedCommandSession?.pinned),
    onArchiveSelectedSession: () => {
      if (input.selectedCommandSession?.id) {
        input.onToggleArchivedSession(input.selectedCommandSession.id)
      }
    },
    onBackToSession: input.launcher.close,
    onStopSession: input.onStopSession,
    onTogglePinSelectedSession: () => {
      if (input.selectedCommandSession?.id) {
        input.onTogglePinnedSession(input.selectedCommandSession.id)
      }
    },
    terminateDisabled: input.terminateDisabled,
  }
}
