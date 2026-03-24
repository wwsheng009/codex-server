import { i18n } from '../../i18n/runtime'
import type { ThreadTerminalSelectedCommandSession } from './threadTerminalDockTypes'
import { formatShellDisplayName } from './threadTerminalShellUtils'

export function formatCommandSessionStatus(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'starting':
      return i18n._({
        id: 'Starting',
        message: 'Starting',
      })
    case 'running':
    case 'processing':
      return i18n._({
        id: 'Processing',
        message: 'Processing',
      })
    case 'completed':
      return i18n._({
        id: 'Completed',
        message: 'Completed',
      })
    case 'failed':
    case 'error':
      return i18n._({
        id: 'Error',
        message: 'Error',
      })
    case 'idle':
    case '':
      return i18n._({
        id: 'Idle',
        message: 'Idle',
      })
    default:
      return value ?? ''
  }
}

export function formatCommandSessionMode(value?: string) {
  switch ((value ?? '').toLowerCase()) {
    case 'shell':
      return i18n._({
        id: 'Shell session',
        message: 'Shell session',
      })
    case 'command':
      return i18n._({
        id: 'Command session',
        message: 'Command session',
      })
    default:
      return i18n._({
        id: 'Terminal session',
        message: 'Terminal session',
      })
  }
}

export function formatCommandSessionTitle(
  session: ThreadTerminalSelectedCommandSession,
) {
  if (!session) {
    return i18n._({
      id: 'Terminal',
      message: 'Terminal',
    })
  }

  if (session.mode === 'shell') {
    return formatShellDisplayName({
      fallback: session.command,
      shellPath: session.shellPath,
    })
  }

  return session.command || i18n._({
    id: 'Terminal',
    message: 'Terminal',
  })
}

export function formatShellSessionActivity(value?: string) {
  switch ((value ?? '').toLowerCase()) {
    case 'prompt':
      return i18n._({
        id: 'Prompt ready',
        message: 'Prompt ready',
      })
    case 'running':
      return i18n._({
        id: 'Running command',
        message: 'Running command',
      })
    case 'starting':
      return i18n._({
        id: 'Starting shell',
        message: 'Starting shell',
      })
    default:
      return ''
  }
}

export function getCommandSessionTone(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'starting':
    case 'running':
    case 'processing':
      return 'running'
    case 'completed':
      return 'success'
    case 'failed':
    case 'error':
      return 'error'
    default:
      return 'idle'
  }
}
