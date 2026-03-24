import { ThreadTerminalToolbarLaunchActions } from './ThreadTerminalToolbarLaunchActions'
import { ThreadTerminalToolbarSessionActions } from './ThreadTerminalToolbarSessionActions'
import { ThreadTerminalToolbarViewportActions } from './ThreadTerminalToolbarViewportActions'
import { TerminalToolbarDivider } from './threadTerminalToolbarControls'
import type {
  ThreadTerminalToolbarState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalToolbar({
  launchActions,
  sessionActions,
  viewportActions,
}: ThreadTerminalToolbarState) {
  return (
    <div className="terminal-dock__toolbar">
      <ThreadTerminalToolbarLaunchActions {...launchActions} />
      <TerminalToolbarDivider />
      <ThreadTerminalToolbarViewportActions {...viewportActions} />
      <ThreadTerminalToolbarSessionActions {...sessionActions} />
    </div>
  )
}
