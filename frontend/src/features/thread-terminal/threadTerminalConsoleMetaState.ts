import type {
  BuildThreadTerminalConsoleMetaStateInput,
  ThreadTerminalConsoleMetaState
} from './threadTerminalConsoleStateTypes'

export function buildThreadTerminalConsoleMetaState(
  input: BuildThreadTerminalConsoleMetaStateInput,
): ThreadTerminalConsoleMetaState {
  return {
    hasFinishedSessions: input.sessions.hasFinishedSessions,
    isLauncherOpen: input.launcher.isOpen,
    onClearCompletedSessions: input.onClearCompletedSessions,
    rootPath: input.rootPath,
    selectedCommandSession: input.selectedCommandSession,
  }
}
