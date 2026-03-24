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
          <ThreadTerminalSessionTabsSection {...sessionTabsSection} />
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
