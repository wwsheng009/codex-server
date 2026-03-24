import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalConsoleHintState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalConsoleHint({
  defaultShellLauncherName,
  isInteractive,
  isLauncherOpen,
  launcherMode,
  selectedSessionHasLimitedIntegration,
  startCommandPending,
}: ThreadTerminalConsoleHintState) {
  const hintMessage = isLauncherOpen
    ? startCommandPending
      ? i18n._({
          id: 'Starting terminal session…',
          message: 'Starting terminal session…',
        })
      : launcherMode === 'shell'
        ? i18n._({
            id: 'New {shellName} starts a long-lived PTY session. It stays open until the shell exits or you stop it.',
            message:
              'New {shellName} starts a long-lived PTY session. It stays open until the shell exits or you stop it.',
            values: { shellName: defaultShellLauncherName },
          })
        : i18n._({
            id: 'Run command starts a standalone process session. Use Up/Down to reuse command history.',
            message:
              'Run command starts a standalone process session. Use Up/Down to reuse command history.',
          })
    : selectedSessionHasLimitedIntegration
      ? i18n._({
          id: 'This shell is attached with basic prompt and cwd integration only. PowerShell provides richer command state tracking.',
          message:
            'This shell is attached with basic prompt and cwd integration only. PowerShell provides richer command state tracking.',
        })
      : isInteractive
        ? i18n._({
            id: 'Keyboard input is attached to the active terminal session. Use Ctrl/Cmd+F to search. Shell integration status is tracked live.',
            message:
              'Keyboard input is attached to the active terminal session. Use Ctrl/Cmd+F to search. Shell integration status is tracked live.',
          })
        : i18n._({
            id: 'This terminal session is read-only because the process has already exited.',
            message: 'This terminal session is read-only because the process has already exited.',
          })

  return (
    <div className="terminal-dock__input">
      <span className="terminal-dock__hint">{hintMessage}</span>
    </div>
  )
}
