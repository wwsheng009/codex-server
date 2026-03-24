import type {
  BuildThreadTerminalViewportStackStateInput,
  ThreadTerminalViewportStackState
} from './threadTerminalConsoleStateTypes'

export function buildThreadTerminalViewportStackState(
  input: BuildThreadTerminalViewportStackStateInput,
): ThreadTerminalViewportStackState {
  return {
    activeRenderableSession: input.sessions.activeRenderableSession,
    commandSessionsCount: input.commandSessionsCount,
    defaultShellLauncherName: input.launcher.defaultShellLauncherName,
    isLauncherOpen: input.launcher.isOpen,
    launcherHistory: input.launcher.history,
    launcherMode: input.launcher.mode,
    launcherRef: input.refs.launcherRef,
    onCloseLauncher: input.launcher.close,
    onLauncherSelectionChange: input.launcher.handleSelectionChange,
    onResizeTerminal: input.onResizeTerminal,
    onSessionSelectionChange: input.sessions.handleSelectionChange,
    onStartLauncherCommand: input.launcher.startCommand,
    onStartShellFromLauncher: input.launcher.startShellFromLauncher,
    onWriteTerminalData: input.onWriteTerminalData,
    rootPath: input.rootPath,
    shouldUsePlainTextViewport: input.sessions.shouldUsePlainTextViewport,
    startCommandPending: input.startCommandPending,
    viewportRefs: input.refs.viewportRefs,
    viewportStackRef: input.refs.viewportStackRef,
  }
}
