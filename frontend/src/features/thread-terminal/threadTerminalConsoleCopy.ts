import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import { i18n } from '../../i18n/runtime'
import {
  formatCommandSessionMode,
  formatCommandSessionStatus,
  formatCommandSessionTitle,
  formatShellSessionActivity,
} from './threadTerminalSessionFormatting'
import { formatShellDisplayName } from './threadTerminalShellUtils'
import type {
  BuildThreadTerminalConsoleSubtitleCopyInput,
  BuildThreadTerminalConsoleTitleCopyInput
} from './threadTerminalConsoleStateTypes'

export function buildThreadTerminalConsoleTitle(
  input: BuildThreadTerminalConsoleTitleCopyInput,
) {
  if (input.isLauncherOpen) {
    if (input.launcherMode === 'shell') {
      return input.newShellSessionTitle
    }

    return i18n._({
      id: 'Run one-shot command',
      message: 'Run one-shot command',
    })
  }

  return formatCommandSessionTitle(input.selectedCommandSession)
}

export function buildThreadTerminalConsoleSubtitle(
  input: BuildThreadTerminalConsoleSubtitleCopyInput,
) {
  if (input.isLauncherOpen) {
    if (input.launcherMode === 'shell') {
      return i18n._({
        id: 'Persistent PTY {shellName}. Enter starts it, Ctrl/Cmd+K switches to one-shot commands, Esc goes back.',
        message:
          'Persistent PTY {shellName}. Enter starts it, Ctrl/Cmd+K switches to one-shot commands, Esc goes back.',
        values: { shellName: input.defaultShellLauncherName },
      })
    }

    return i18n._({
      id: 'One-shot command session. Enter runs, Up/Down reuses history, Esc goes back.',
      message: 'One-shot command session. Enter runs, Up/Down reuses history, Esc goes back.',
    })
  }

  const parts = [
    formatCommandSessionMode(input.selectedCommandSession?.mode),
    formatCommandSessionStatus(input.selectedCommandSession?.status),
  ]

  if (input.selectedCommandSession?.mode === 'shell') {
    parts.push(
      formatShellDisplayName({
        fallback: input.selectedCommandSession?.command,
        shellPath: input.selectedCommandSession?.shellPath,
      }),
    )
  }

  const shellActivity =
    input.selectedCommandSession?.mode === 'shell'
      ? formatShellSessionActivity(input.selectedCommandSession.shellState)
      : ''
  if (shellActivity) {
    parts.push(shellActivity)
  }

  if (
    input.selectedCommandSession?.mode === 'shell' &&
    typeof input.selectedCommandSession?.lastExitCode === 'number'
  ) {
    parts.push(
      i18n._({
        id: 'last exit {exitCode}',
        message: 'last exit {exitCode}',
        values: { exitCode: input.selectedCommandSession.lastExitCode },
      }),
    )
  }

  if (input.selectedCommandSession?.updatedAt) {
    parts.push(formatRelativeTimeShort(input.selectedCommandSession.updatedAt))
  }

  if (typeof input.selectedCommandSession?.exitCode === 'number') {
    parts.push(
      i18n._({
        id: 'exit {exitCode}',
        message: 'exit {exitCode}',
        values: { exitCode: input.selectedCommandSession.exitCode },
      }),
    )
  }

  return parts.join(' · ')
}
