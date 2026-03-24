import {
  buildThreadTerminalConsoleSubtitle,
  buildThreadTerminalConsoleTitle,
} from './threadTerminalConsoleCopy'
import { getCommandSessionTone } from './threadTerminalSessionFormatting'
import type {
  BuildThreadTerminalConsoleTitleStateInput,
  BuildThreadTerminalToolbarStateInput,
  ThreadTerminalConsoleHeaderState,
  ThreadTerminalConsoleTitleState
} from './threadTerminalConsoleStateTypes'
import { buildThreadTerminalToolbarState } from './threadTerminalToolbarState'

export function buildThreadTerminalConsoleHeaderState(
  input: BuildThreadTerminalToolbarStateInput,
): ThreadTerminalConsoleHeaderState {
  return {
    consoleTitle: buildThreadTerminalConsoleTitleState({
      defaultShellLauncherName: input.launcher.defaultShellLauncherName,
      isLauncherOpen: input.launcher.isOpen,
      launcherMode: input.launcher.mode,
      newShellSessionTitle: input.launcher.newShellSessionTitle,
      selectedCommandSession: input.selectedCommandSession,
    }),
    toolbar: buildThreadTerminalToolbarState(input),
  }
}

function buildThreadTerminalConsoleTitleState(
  input: BuildThreadTerminalConsoleTitleStateInput,
): ThreadTerminalConsoleTitleState {
  return {
    statusTone: input.isLauncherOpen
      ? 'idle'
      : getCommandSessionTone(input.selectedCommandSession?.status),
    subtitle: buildThreadTerminalConsoleSubtitle(input),
    title: buildThreadTerminalConsoleTitle(input),
  }
}
