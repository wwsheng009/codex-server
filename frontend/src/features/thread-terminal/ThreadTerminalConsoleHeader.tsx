import { ThreadTerminalConsoleTitle } from './ThreadTerminalConsoleTitle'
import { ThreadTerminalToolbar } from './ThreadTerminalToolbar'
import type {
  ThreadTerminalConsoleHeaderState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalConsoleHeader({
  consoleTitle,
  toolbar,
}: ThreadTerminalConsoleHeaderState) {
  return (
    <div className="terminal-dock__console-header">
      <ThreadTerminalConsoleTitle {...consoleTitle} />
      <ThreadTerminalToolbar {...toolbar} />
    </div>
  )
}
