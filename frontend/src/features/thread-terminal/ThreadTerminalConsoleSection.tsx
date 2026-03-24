import { ThreadTerminalConsoleHeader } from './ThreadTerminalConsoleHeader'
import { ThreadTerminalConsoleHint } from './ThreadTerminalConsoleHint'
import { ThreadTerminalConsoleMeta } from './ThreadTerminalConsoleMeta'
import { ThreadTerminalDebugPanel } from './ThreadTerminalDebugPanel'
import { ThreadTerminalSearchBar } from './ThreadTerminalSearchBar'
import { ThreadTerminalViewportStack } from './ThreadTerminalViewportStack'
import { isTerminalDebugEnabled } from './threadTerminalDebugUtils'
import type {
  ThreadTerminalConsoleSectionState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalConsoleSection({
  debugPanel,
  header,
  hint,
  meta,
  searchBar,
  viewportStack,
}: ThreadTerminalConsoleSectionState) {
  return (
    <div className="terminal-dock__console-shell">
      <div className="terminal-dock__console">
        <ThreadTerminalConsoleHeader {...header} />
        {searchBar ? <ThreadTerminalSearchBar {...searchBar} /> : null}
        <ThreadTerminalConsoleMeta {...meta} />
        {isTerminalDebugEnabled ? <ThreadTerminalDebugPanel {...debugPanel} /> : null}
        <ThreadTerminalViewportStack {...viewportStack} />
        <ThreadTerminalConsoleHint {...hint} />
      </div>
    </div>
  )
}
