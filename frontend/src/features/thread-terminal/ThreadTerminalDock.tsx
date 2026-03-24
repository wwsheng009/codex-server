import { createPortal } from 'react-dom'

import { ThreadTerminalDockBar } from './ThreadTerminalDockBar'
import { ThreadTerminalDockReveal } from './ThreadTerminalDockReveal'
import { ThreadTerminalDockWorkspaceContainer } from './ThreadTerminalDockWorkspaceContainer'
import { buildThreadTerminalDockState } from './threadTerminalDockState'
import type { ThreadTerminalDockProps } from './threadTerminalDockTypes'

export function ThreadTerminalDock(props: ThreadTerminalDockProps) {
  const { className } = props
  const dock = buildThreadTerminalDockState(props)
  const reveal = <ThreadTerminalDockReveal {...dock.reveal} />

  if (!dock.isVisible) {
    if (!dock.isFloating || typeof document === 'undefined') {
      return reveal
    }

    return createPortal(reveal, document.body)
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
