import { useState } from 'react'
import { ResizeHandle } from '../../components/ui/RailControls'
import { i18n } from '../../i18n/runtime'
import { ThreadTerminalConsoleSection } from './ThreadTerminalConsoleSection'
import { ThreadTerminalSessionTabsSection } from './ThreadTerminalSessionTabsSection'
import type {
  ThreadTerminalWorkspaceState
} from './threadTerminalDockStateTypes'

export function ThreadTerminalDockWorkspace({
  consoleSection,
  resizeHandle,
  sessionTabsSection,
  windowResizeHandle,
  workspaceRef,
}: ThreadTerminalWorkspaceState) {
  const [isTabsExpanded, setIsTabsExpanded] = useState(true)
  const visibleSessionCount = sessionTabsSection.sessions.visibleSessions.length
  const tabsToggleLabel = isTabsExpanded
    ? i18n._({
        id: 'Collapse sessions list',
        message: 'Collapse sessions list',
      })
    : i18n._({
        id: 'Expand sessions list',
        message: 'Expand sessions list',
      })
  const tabsToggleTitle = isTabsExpanded
    ? i18n._({
        id: 'Collapse sessions',
        message: 'Collapse sessions',
      })
    : i18n._({
        id: 'Expand sessions',
        message: 'Expand sessions',
      })

  return (
    <>
      {resizeHandle ? (
        <ResizeHandle
          aria-label={i18n._({
            id: 'Resize terminal dock',
            message: 'Resize terminal dock',
          })}
          axis="vertical"
          className="terminal-dock__resize-handle"
          onPointerDown={resizeHandle.onResizeStart}
        />
      ) : null}
      <div className="terminal-dock__workspace" ref={workspaceRef}>
        <div className="terminal-dock__body">
          <div className="terminal-dock__workspace-controls">
            <button
              aria-expanded={isTabsExpanded}
              aria-label={`${tabsToggleLabel} (${visibleSessionCount})`}
              className="terminal-dock__tabs-toggle"
              onClick={() => setIsTabsExpanded(!isTabsExpanded)}
              title={`${tabsToggleTitle} (${visibleSessionCount})`}
              type="button"
            >
              <TabsToggleIcon expanded={isTabsExpanded} />
              <span className="terminal-dock__tabs-count">
                {visibleSessionCount}
              </span>
            </button>
            {isTabsExpanded && (
              <ThreadTerminalSessionTabsSection {...sessionTabsSection} />
            )}
          </div>
          <ThreadTerminalConsoleSection {...consoleSection} />
        </div>
        {windowResizeHandle ? (
          <button
            aria-label={i18n._({
              id: 'Resize terminal window',
              message: 'Resize terminal window',
            })}
            className="terminal-dock__window-resize"
            onPointerDown={windowResizeHandle.onWindowResizeStart}
            title={i18n._({
              id: 'Resize terminal window',
              message: 'Resize terminal window',
            })}
            type="button"
          >
            <CornerResizeToolIcon />
          </button>
        ) : null}
      </div>
    </>
  )
}

function TabsToggleIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={expanded ? 'terminal-dock__tabs-toggle-icon--expanded' : ''}
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
      {expanded ? (
        <path d="m18 15-3-3 3-3" strokeWidth="2" />
      ) : (
        <path d="m6 9 3 3-3 3" strokeWidth="2" />
      )}
    </svg>
  )
}

function CornerResizeToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M8 16h8M12 12h4M16 8h0"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
      <path d="M7 17 17 7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
    </svg>
  )
}
