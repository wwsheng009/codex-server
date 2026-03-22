import { ThreadTerminalBlock } from '../../components/thread/ThreadContent'
import { ResizeHandle } from '../../components/ui/RailControls'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import { i18n } from '../../i18n/runtime'
import type { ThreadTerminalDockProps } from './threadTerminalDockTypes'

export function formatCommandSessionStatus(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'starting':
      return i18n._({
        id: 'Starting',
        message: 'Starting',
      })
    case 'running':
    case 'processing':
      return i18n._({
        id: 'Processing',
        message: 'Processing',
      })
    case 'completed':
      return i18n._({
        id: 'Completed',
        message: 'Completed',
      })
    case 'failed':
    case 'error':
      return i18n._({
        id: 'Error',
        message: 'Error',
      })
    case 'idle':
    case '':
      return i18n._({
        id: 'Idle',
        message: 'Idle',
      })
    default:
      return value ?? ''
  }
}

export function ThreadTerminalDockBar({
  activeCommandCount,
  commandSessions,
  isExpanded,
  onClearCompletedSessions,
  onToggleExpanded,
  selectedCommandSession,
}: Pick<
  ThreadTerminalDockProps,
  | 'activeCommandCount'
  | 'commandSessions'
  | 'isExpanded'
  | 'onClearCompletedSessions'
  | 'onToggleExpanded'
  | 'selectedCommandSession'
>) {
  return (
    <div className="terminal-dock__bar">
      <div className="terminal-dock__bar-copy">
        <h2>{i18n._({ id: 'Terminal', message: 'Terminal' })}</h2>
      </div>
      <div className="terminal-dock__bar-meta">
        {isExpanded ? (
          <>
            <span className="meta-pill">
              {i18n._({
                id: '{count} sessions',
                message: '{count} sessions',
                values: { count: commandSessions.length },
              })}
            </span>
            <span className="meta-pill">
              {i18n._({
                id: '{count} running',
                message: '{count} running',
                values: { count: activeCommandCount },
              })}
            </span>
            <span className="meta-pill">
              {selectedCommandSession?.updatedAt
                ? i18n._({
                    id: 'updated {time}',
                    message: 'updated {time}',
                    values: {
                      time: formatRelativeTimeShort(selectedCommandSession.updatedAt),
                    },
                  })
                : i18n._({
                    id: 'Idle',
                    message: 'Idle',
                  })}
            </span>
            {commandSessions.some((session) => !['running', 'starting'].includes(session.status)) ? (
              <button className="terminal-dock__toggle" onClick={onClearCompletedSessions} type="button">
                {i18n._({
                  id: 'Clear finished',
                  message: 'Clear finished',
                })}
              </button>
            ) : null}
          </>
        ) : commandSessions.length ? (
          <span className="meta-pill">
            {activeCommandCount
              ? i18n._({
                  id: '{count} active',
                  message: '{count} active',
                  values: { count: activeCommandCount },
                })
              : i18n._({
                  id: '{count} stored',
                  message: '{count} stored',
                  values: { count: commandSessions.length },
                })}
          </span>
        ) : null}
        <button
          aria-expanded={isExpanded}
          className="terminal-dock__toggle"
          onClick={onToggleExpanded}
          type="button"
        >
          {isExpanded
            ? i18n._({
                id: 'Hide',
                message: 'Hide',
              })
            : i18n._({
                id: 'Show',
                message: 'Show',
              })}
        </button>
      </div>
    </div>
  )
}

export function ThreadTerminalDockWorkspace({
  commandSessions,
  onChangeStdinValue,
  onRemoveSession,
  onResizeStart,
  onSelectSession,
  onSubmitStdin,
  onTerminateSelectedSession,
  selectedCommandSession,
  stdinValue,
  terminateDisabled,
}: Pick<
  ThreadTerminalDockProps,
  | 'commandSessions'
  | 'onChangeStdinValue'
  | 'onRemoveSession'
  | 'onResizeStart'
  | 'onSelectSession'
  | 'onSubmitStdin'
  | 'onTerminateSelectedSession'
  | 'selectedCommandSession'
  | 'stdinValue'
  | 'terminateDisabled'
>) {
  return (
    <>
      <ResizeHandle
        aria-label={i18n._({
          id: 'Resize terminal dock',
          message: 'Resize terminal dock',
        })}
        axis="vertical"
        className="terminal-dock__resize-handle"
        onPointerDown={onResizeStart}
      />
      {commandSessions.length ? (
        <div className="terminal-dock__workspace">
          <div className="terminal-dock__tabs">
            {commandSessions.map((session) => (
              <div
                className={
                  session.id === selectedCommandSession?.id
                    ? 'terminal-dock__tab terminal-dock__tab--active'
                    : 'terminal-dock__tab'
                }
                key={session.id}
              >
                <button
                  className="terminal-dock__tab-select"
                  onClick={() => onSelectSession(session.id)}
                  type="button"
                >
                  <strong>{session.command}</strong>
                  <span>
                    {formatCommandSessionStatus(session.status)}
                    {session.updatedAt ? ` · ${formatRelativeTimeShort(session.updatedAt)}` : ''}
                  </span>
                </button>
                <button
                  aria-label={i18n._({
                    id: 'Close {command}',
                    message: 'Close {command}',
                    values: { command: session.command },
                  })}
                  className="terminal-dock__tab-close"
                  onClick={() => onRemoveSession(session.id)}
                  type="button"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="terminal-dock__console-shell">
            <div className="terminal-dock__console">
              <div className="terminal-dock__meta">
                <span>{formatCommandSessionStatus(selectedCommandSession?.status)}</span>
                {typeof selectedCommandSession?.exitCode === 'number' ? (
                  <span>
                    {i18n._({
                      id: 'exit {exitCode}',
                      message: 'exit {exitCode}',
                      values: { exitCode: selectedCommandSession.exitCode },
                    })}
                  </span>
                ) : null}
                {selectedCommandSession?.id ? <code>{selectedCommandSession.id}</code> : null}
              </div>
              <ThreadTerminalBlock
                className="terminal-dock__output"
                content={
                  selectedCommandSession?.combinedOutput ||
                  i18n._({
                    id: 'Run a command to see output.',
                    message: 'Run a command to see output.',
                  })
                }
              />
              <form className="terminal-dock__input" onSubmit={onSubmitStdin}>
                <input
                  disabled={!selectedCommandSession?.id}
                  onChange={(event) => onChangeStdinValue(event.target.value)}
                  placeholder={i18n._({
                    id: 'Send stdin to selected process',
                    message: 'Send stdin to selected process',
                  })}
                  value={stdinValue}
                />
                <button
                  className="ide-button ide-button--secondary"
                  disabled={!selectedCommandSession?.id || !stdinValue.trim()}
                  type="submit"
                >
                  {i18n._({
                    id: 'Send',
                    message: 'Send',
                  })}
                </button>
                <button
                  className="ide-button ide-button--secondary"
                  disabled={terminateDisabled}
                  onClick={onTerminateSelectedSession}
                  type="button"
                >
                  {i18n._({
                    id: 'Stop',
                    message: 'Stop',
                  })}
                </button>
              </form>
            </div>
          </div>
        </div>
      ) : (
        <div className="terminal-dock__empty">
          {i18n._({
            id: 'Run a command to mount the dock. Sessions stay attached to the workspace and can be revisited from this bottom panel.',
            message:
              'Run a command to mount the dock. Sessions stay attached to the workspace and can be revisited from this bottom panel.',
          })}
        </div>
      )}
    </>
  )
}
