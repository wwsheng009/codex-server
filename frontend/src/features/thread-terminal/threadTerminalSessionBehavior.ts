import type { ThreadTerminalSelectedCommandSession } from './threadTerminalDockTypes'
import { isWindowsWorkspace, isWslShimShell } from './threadTerminalShellUtils'
import type { ThreadTerminalWindowsCommandSessionInput } from './threadTerminalShellTypes'

export function isWindowsCommandSession(
  { rootPath, session }: ThreadTerminalWindowsCommandSessionInput,
) {
  if (!session) {
    return isWindowsWorkspace(rootPath)
  }

  return isWindowsWorkspace(session.currentCwd) ||
    isWindowsWorkspace(session.initialCwd) ||
    isWindowsWorkspace(session.shellPath) ||
    isWindowsWorkspace(rootPath)
}

export function hasLimitedShellIntegration(
  session: ThreadTerminalSelectedCommandSession,
) {
  if (!session || session.mode !== 'shell') {
    return false
  }

  const normalized = `${session.shellPath ?? ''} ${session.command ?? ''}`.toLowerCase()
  return normalized.includes('cmd.exe') ||
    normalized.includes('command prompt') ||
    isWslShimShell(normalized)
}

export function canCommandSessionInteract(
  session: ThreadTerminalSelectedCommandSession,
) {
  if (!session) {
    return false
  }

  if (!['running', 'starting'].includes(session.status)) {
    return false
  }

  if (session.mode !== 'shell') {
    return true
  }

  if (hasLimitedShellIntegration(session)) {
    return session.status === 'running'
  }

  const shellState = (session.shellState ?? '').toLowerCase()
  return shellState === 'prompt' || shellState === 'running'
}
