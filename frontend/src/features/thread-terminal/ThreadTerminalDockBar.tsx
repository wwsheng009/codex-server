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
        <h2>{i18n._({ id: 'Terminal', message: 'Terminal' })}</h2>
        {copy.commandSessionsCount ? (
          <span>
            {i18n._({
              id: '{sessions} sessions · {active} active',
              message: '{sessions} sessions · {active} active',
              values: {
                active: copy.activeCommandCount,
                sessions: copy.commandSessionsCount,
              },
            })}
          </span>
        ) : null}
      </div>
      <div className="terminal-dock__bar-meta">
        {windowActions ? (
          <div className="terminal-dock__bar-group">
            <button
              className="terminal-dock__window-action"
              onClick={windowActions.onToggleWindowMaximized}
              type="button"
            >
              {windowActions.isWindowMaximized
                ? i18n._({
                    id: 'Restore',
                    message: 'Restore',
                  })
                : i18n._({
                    id: 'Maximize',
                    message: 'Maximize',
                  })}
            </button>
            <button
              className="terminal-dock__window-action"
              onClick={windowActions.onResetFloatingBounds}
              type="button"
            >
              {i18n._({
                id: 'Center',
                message: 'Center',
              })}
            </button>
          </div>
        ) : null}
        <div className="terminal-dock__bar-group terminal-dock__bar-group--primary">
          <ThreadTerminalPlacementSwitch {...primaryActions.placementSwitch} />
          <button
            aria-expanded={primaryActions.isExpanded}
            className="terminal-dock__collapse"
            onClick={primaryActions.onToggleExpanded}
            type="button"
          >
            {primaryActions.isExpanded
              ? i18n._({
                  id: 'Collapse',
                  message: 'Collapse',
                })
              : i18n._({
                  id: 'Expand',
                  message: 'Expand',
                })}
          </button>
          {primaryActions.hideActionVisible ? (
            <button
              className="terminal-dock__toggle"
              onClick={primaryActions.onHide}
              type="button"
            >
              {i18n._({
                id: 'Hide',
                message: 'Hide',
              })}
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
        aria-pressed={placement === 'bottom'}
        className={
          placement === 'bottom'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('bottom')}
        type="button"
      >
        {i18n._({
          id: 'Bottom',
          message: 'Bottom',
        })}
      </button>
      <button
        aria-pressed={placement === 'right'}
        className={
          placement === 'right'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('right')}
        type="button"
      >
        {i18n._({
          id: 'Right',
          message: 'Right',
        })}
      </button>
      <button
        aria-pressed={placement === 'floating'}
        className={
          placement === 'floating'
            ? 'terminal-dock__placement-button terminal-dock__placement-button--active'
            : 'terminal-dock__placement-button'
        }
        onClick={() => onChangePlacement('floating')}
        type="button"
      >
        {i18n._({
          id: 'Float',
          message: 'Float',
        })}
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
