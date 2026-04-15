import { createPortal } from 'react-dom'

import { ThreadTerminalDockBar } from './ThreadTerminalDockBar'
import { ThreadTerminalDockWorkspaceContainer } from './ThreadTerminalDockWorkspaceContainer'
import { buildThreadTerminalDockState } from './threadTerminalDockState'
import type { ThreadTerminalDockProps } from './threadTerminalDockTypes'

export function ThreadTerminalDock(props: ThreadTerminalDockProps) {
  const { className } = props
  const dock = buildThreadTerminalDockState(props)

  if (!dock.isVisible) {
    return null
  }

  const dockView = (
    <section className={className} style={dock.dockStyle}>
      <ThreadTerminalDockBar {...dock.bar} />

      {dock.isExpanded ? (
        <ThreadTerminalDockWorkspaceContainer {...dock.workspaceInput} />
      ) : null}
    </section>
  )

  if (!dock.isFloating || typeof document === 'undefined') {
    return dockView
  }

  return createPortal(
    <div className="terminal-floating-layer">
      <div aria-hidden="true" className="terminal-floating-layer__backdrop" />
      {dockView}
    </div>,
    document.body,
  )
}
