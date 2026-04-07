import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalDockBarState,
  ThreadTerminalDockPlacementSwitchState
} from './threadTerminalDockStateTypes'

export function ThreadTerminalDockBar({
  copy,
  primaryActions,
  windowActions,
}: ThreadTerminalDockBarState) {
  const maximizeTitle = windowActions
    ? windowActions.isWindowMaximized
      ? i18n._({ id: 'Restore', message: 'Restore' })
      : i18n._({ id: 'Maximize', message: 'Maximize' })
    : undefined
  const centerTitle = i18n._({ id: 'Center', message: 'Center' })
  const collapseTitle = primaryActions.isExpanded
    ? i18n._({ id: 'Collapse', message: 'Collapse' })
    : i18n._({ id: 'Expand', message: 'Expand' })
  const hideTitle = i18n._({ id: 'Hide', message: 'Hide' })
  const sessionsTitle = i18n._({
    id: '{sessions} sessions · {active} active',
    message: '{sessions} sessions · {active} active',
    values: { active: copy.activeCommandCount, sessions: copy.commandSessionsCount },
  })

  return (
    <div className="terminal-dock__bar">
      <div className="terminal-dock__bar-copy">
        {copy.isFloating ? (
          <button
            aria-label={i18n._({
              id: 'Move terminal window',
              message: 'Move terminal window',
            })}
            className="terminal-dock__drag-handle"
            disabled={copy.dragHandleDisabled}
            onPointerDown={copy.onDragStart}
            title={i18n._({
              id: 'Move terminal window',
              message: 'Move terminal window',
            })}
            type="button"
          >
            <GripToolIcon />
          </button>
        ) : null}
        <div className="terminal-dock__bar-title-row">
          <h2>{i18n._({ id: 'Terminal', message: 'Terminal' })}</h2>
          {copy.commandSessionsCount ? (
            <span className="terminal-dock__bar-status" title={sessionsTitle}>
              <span className="terminal-dock__bar-status-badge">
                <SessionsIcon />
                <span>{copy.commandSessionsCount}</span>
              </span>
              {copy.activeCommandCount ? (
                <span className="terminal-dock__bar-status-badge terminal-dock__bar-status-badge--active">
                  <span className="terminal-dock__bar-status-dot" />
                  <span>{copy.activeCommandCount}</span>
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
      </div>
      <div className="terminal-dock__bar-meta">
        {windowActions ? (
          <div className="terminal-dock__bar-group">
            <button
              aria-label={maximizeTitle}
              className="terminal-dock__window-action"
              onClick={windowActions.onToggleWindowMaximized}
              type="button"
              title={maximizeTitle}
            >
              {windowActions.isWindowMaximized ? <RestoreIcon /> : <MaximizeIcon />}
            </button>
            <button
              aria-label={centerTitle}
              className="terminal-dock__window-action"
              onClick={windowActions.onResetFloatingBounds}
              type="button"
              title={centerTitle}
            >
              <CenterIcon />
            </button>
          </div>
        ) : null}
        <div className="terminal-dock__bar-group terminal-dock__bar-group--primary">
          <ThreadTerminalPlacementSwitch {...primaryActions.placementSwitch} />
          <button
            aria-label={collapseTitle}
            aria-expanded={primaryActions.isExpanded}
            className="terminal-dock__collapse"
            onClick={primaryActions.onToggleExpanded}
            type="button"
            title={collapseTitle}
          >
            {primaryActions.isExpanded ? <CollapseIcon /> : <ExpandIcon />}
          </button>
          {primaryActions.hideActionVisible ? (
            <button
              aria-label={hideTitle}
              className="terminal-dock__toggle"
              onClick={primaryActions.onHide}
              type="button"
              title={hideTitle}
            >
              <HideIcon />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ThreadTerminalPlacementSwitch({
  onChangePlacement,
  placement,
}: ThreadTerminalDockPlacementSwitchState) {
  const bottomTitle = i18n._({ id: 'Bottom', message: 'Bottom' })
  const rightTitle = i18n._({ id: 'Right', message: 'Right' })
  const floatTitle = i18n._({ id: 'Float', message: 'Float' })

  return (
    <div
      aria-label={i18n._({
        id: 'Terminal position',
        message: 'Terminal position',
      })}
      className="terminal-dock__placement"
      role="group"
    >
      <button
        aria-label={bottomTitle}
        aria-pressed={placement === 'bottom'}
        className={
          placement === 'bottom'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('bottom')}
        type="button"
        title={bottomTitle}
      >
        <DockBottomIcon />
      </button>
      <button
        aria-label={rightTitle}
        aria-pressed={placement === 'right'}
        className={
          placement === 'right'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('right')}
        type="button"
        title={rightTitle}
      >
        <DockRightIcon />
      </button>
      <button
        aria-label={floatTitle}
        aria-pressed={placement === 'floating'}
        className={
          placement === 'floating'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('floating')}
        type="button"
        title={floatTitle}
      >
        <DockFloatIcon />
      </button>
    </div>
  )
}

function GripToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M8.5 7.5h7M8.5 12h7M8.5 16.5h7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function SessionsIcon() {
  return (
    <svg fill="none" height="12" viewBox="0 0 24 24" width="12">
      <rect
        height="10"
        rx="1.8"
        stroke="currentColor"
        strokeWidth="1.7"
        width="11"
        x="7.5"
        y="8.5"
      />
      <path
        d="M5.5 15H5A1.5 1.5 0 0 1 3.5 13.5v-7A1.5 1.5 0 0 1 5 5h8A1.5 1.5 0 0 1 14.5 6.5V7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="9" width="12" height="12" rx="2" ry="2" />
      <path d="M9 3h10a2 2 0 0 1 2 2v10" />
    </svg>
  )
}

function CenterIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  )
}

function CollapseIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 15l-6-6-6 6" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

function HideIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

function DockBottomIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <path d="M4 15h16" />
    </svg>
  )
}

function DockRightIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
      <path d="M15 4v16" />
    </svg>
  )
}

function DockFloatIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="6" width="12" height="12" rx="2" ry="2" />
    </svg>
  )
}
