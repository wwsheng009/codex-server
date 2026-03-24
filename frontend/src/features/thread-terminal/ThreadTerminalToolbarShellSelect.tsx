import { SelectControl } from '../../components/ui/SelectControl'
import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalToolbarShellSelectState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalToolbarShellSelect({
  isLauncherOpen,
  launcherMode,
  launcherShell,
  terminalShellOptions,
  onSetLauncherShell,
}: ThreadTerminalToolbarShellSelectState) {
  if (!isLauncherOpen || launcherMode !== 'shell') {
    return null
  }

  return (
    <div className="terminal-dock__toolbar-shell-select">
      <SelectControl
        ariaLabel={i18n._({
          id: 'Terminal launcher shell',
          message: 'Terminal launcher shell',
        })}
        className="terminal-dock__toolbar-select"
        onChange={onSetLauncherShell}
        options={terminalShellOptions}
        value={launcherShell}
      />
    </div>
  )
}
