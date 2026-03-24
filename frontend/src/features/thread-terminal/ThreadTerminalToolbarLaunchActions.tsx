import { i18n } from '../../i18n/runtime'
import { ThreadTerminalToolbarShellSelect } from './ThreadTerminalToolbarShellSelect'
import type {
  ThreadTerminalToolbarLaunchActionsState
} from './threadTerminalConsoleStateTypes'
import { TerminalToolbarActionButton } from './threadTerminalToolbarControls'

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
        data-active={isLauncherOpen && launcherMode === 'shell' ? 'true' : undefined}
        disabled={Boolean(startSessionPending)}
        onClick={onStartShellSession}
        title={shellActionTitle}
      >
        {shellActionLabel}
      </TerminalToolbarActionButton>
      <TerminalToolbarActionButton
        aria-label={commandActionTitle}
        data-active={isLauncherOpen && launcherMode === 'command' ? 'true' : undefined}
        disabled={Boolean(startSessionPending)}
        onClick={onOpenCommandLauncher}
        title={commandActionTitle}
      >
        {i18n._({
          id: 'Command',
          message: 'Command',
        })}
      </TerminalToolbarActionButton>
    </>
  )
}
