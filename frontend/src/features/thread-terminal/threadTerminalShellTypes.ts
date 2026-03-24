import type { ThreadTerminalSelectedCommandSession } from './threadTerminalDockTypes'

export type ThreadTerminalShellDisplayNameInput = {
  fallback?: string
  shellPath?: string
}

export type ThreadTerminalShellLauncherNameInput = {
  rootPath?: string
  shell?: string
}

export type ThreadTerminalShellOptionsInput = {
  currentShell?: string
  supportedShells: string[]
}

export type ThreadTerminalWindowsCommandSessionInput = {
  rootPath?: string
  session: ThreadTerminalSelectedCommandSession
}
