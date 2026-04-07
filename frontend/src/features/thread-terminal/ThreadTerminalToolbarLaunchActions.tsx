import { i18n } from '../../i18n/runtime'
import { ThreadTerminalToolbarShellSelect } from './ThreadTerminalToolbarShellSelect'
import type {
  ThreadTerminalToolbarLaunchActionsState
} from './threadTerminalConsoleStateTypes'
import {
  CommandLaunchToolIcon,
  ShellLaunchToolIcon,
  TerminalToolbarActionButton,
} from './threadTerminalToolbarControls'

export function ThreadTerminalToolbarLaunchActions({
  isLauncherOpen,
  launcherMode,
  onOpenCommandLauncher,
  onStartShellSession,
  shellActionLabel,
  shellActionTitle,
  shellSelect,
  startSessionPending,
}: ThreadTerminalToolbarLaunchActionsState) {
  const commandActionTitle = i18n._({
    id: 'Run one-shot command',
    message: 'Run one-shot command',
  })

  return (
    <>
      {shellSelect ? <ThreadTerminalToolbarShellSelect {...shellSelect} /> : null}
      <TerminalToolbarActionButton
        aria-label={shellActionTitle}
        className="terminal-dock__toolbar-action--icon"
        data-active={isLauncherOpen && launcherMode === 'shell' ? 'true' : undefined}
        disabled={Boolean(startSessionPending)}
        onClick={onStartShellSession}
        title={shellActionTitle}
      >
        <ShellLaunchToolIcon />
        <span className="terminal-dock__sr-only">{shellActionLabel}</span>
      </TerminalToolbarActionButton>
      <TerminalToolbarActionButton
        aria-label={commandActionTitle}
        className="terminal-dock__toolbar-action--icon"
        data-active={isLauncherOpen && launcherMode === 'command' ? 'true' : undefined}
        disabled={Boolean(startSessionPending)}
        onClick={onOpenCommandLauncher}
        title={commandActionTitle}
      >
        <CommandLaunchToolIcon />
        <span className="terminal-dock__sr-only">
          {i18n._({
            id: 'Command',
            message: 'Command',
          })}
        </span>
      </TerminalToolbarActionButton>
    </>
  )
}
