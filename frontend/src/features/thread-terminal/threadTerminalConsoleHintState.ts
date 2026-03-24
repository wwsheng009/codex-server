import type {
  BuildThreadTerminalConsoleHintStateInput,
  ThreadTerminalConsoleHintState
} from './threadTerminalConsoleStateTypes'

export function buildThreadTerminalConsoleHintState(
  input: BuildThreadTerminalConsoleHintStateInput,
): ThreadTerminalConsoleHintState {
  return {
    defaultShellLauncherName: input.launcher.defaultShellLauncherName,
    isInteractive: input.sessions.isInteractive,
    isLauncherOpen: input.launcher.isOpen,
    launcherMode: input.launcher.mode,
    selectedSessionHasLimitedIntegration: input.sessions.selectedSessionHasLimitedIntegration,
    startCommandPending: input.startCommandPending,
  }
}
