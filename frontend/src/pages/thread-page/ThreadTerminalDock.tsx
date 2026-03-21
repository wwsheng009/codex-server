import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'

import { ThreadTerminalBlock } from '../../components/thread/ThreadContent'
import { ResizeHandle } from '../../components/ui/RailControls'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import type { CommandRuntimeSession } from '../../stores/session-store'

export function ThreadTerminalDock({
  activeCommandCount,
  className,
  commandSessions,
  isExpanded,
  onChangeStdinValue,
  onClearCompletedSessions,
  onRemoveSession,
  onResizeStart,
  onSelectSession,
  onSubmitStdin,
  onTerminateSelectedSession,
  onToggleExpanded,
  selectedCommandSession,
  stdinValue,
  terminateDisabled,
}: {
  activeCommandCount: number
  className: string
  commandSessions: CommandRuntimeSession[]
  isExpanded: boolean
  onChangeStdinValue: (value: string) => void
  onClearCompletedSessions: () => void
  onRemoveSession: (processId: string) => void
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onSelectSession: (processId: string) => void
  onSubmitStdin: (event: FormEvent<HTMLFormElement>) => void
  onTerminateSelectedSession: () => void
  onToggleExpanded: () => void
  selectedCommandSession?: CommandRuntimeSession
  stdinValue: string
  terminateDisabled: boolean
}) {
  return (
    <section className={className}>
      <div className="terminal-dock__bar">
        <div className="terminal-dock__bar-copy">
          <h2>Terminal</h2>
        </div>
        <div className="terminal-dock__bar-meta">
          {isExpanded ? (
            <>
              <span className="meta-pill">{commandSessions.length} sessions</span>
              <span className="meta-pill">{activeCommandCount} running</span>
              <span className="meta-pill">
                {selectedCommandSession?.updatedAt
                  ? `updated ${formatRelativeTimeShort(selectedCommandSession.updatedAt)}`
                  : 'idle'}
              </span>
              {commandSessions.some((session) => !['running', 'starting'].includes(session.status)) ? (
                <button
                  className="terminal-dock__toggle"
                  onClick={onClearCompletedSessions}
                  type="button"
                >
                  Clear Finished
                </button>
              ) : null}
            </>
          ) : commandSessions.length ? (
            <span className="meta-pill">
              {activeCommandCount ? `${activeCommandCount} active` : `${commandSessions.length} stored`}
            </span>
          ) : null}
          <button
            aria-expanded={isExpanded}
            className="terminal-dock__toggle"
            onClick={onToggleExpanded}
            type="button"
          >
            {isExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>

      {isExpanded ? (
        <>
          <ResizeHandle
            aria-label="Resize terminal dock"
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
                        {session.status}
                        {session.updatedAt ? ` · ${formatRelativeTimeShort(session.updatedAt)}` : ''}
                      </span>
                    </button>
                    <button
                      aria-label={`Close ${session.command}`}
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
                    <span>{selectedCommandSession?.status ?? 'idle'}</span>
                    {typeof selectedCommandSession?.exitCode === 'number' ? (
                      <span>exit {selectedCommandSession.exitCode}</span>
                    ) : null}
                    {selectedCommandSession?.id ? <code>{selectedCommandSession.id}</code> : null}
                  </div>
                  <ThreadTerminalBlock
                    className="terminal-dock__output"
                    content={selectedCommandSession?.combinedOutput || 'Run a command to see output.'}
                  />
                  <form className="terminal-dock__input" onSubmit={onSubmitStdin}>
                    <input
                      disabled={!selectedCommandSession?.id}
                      onChange={(event) => onChangeStdinValue(event.target.value)}
                      placeholder="Send stdin to selected process"
                      value={stdinValue}
                    />
                    <button
                      className="ide-button ide-button--secondary"
                      disabled={!selectedCommandSession?.id || !stdinValue.trim()}
                      type="submit"
                    >
                      Send
                    </button>
                    <button
                      className="ide-button ide-button--secondary"
                      disabled={terminateDisabled}
                      onClick={onTerminateSelectedSession}
                      type="button"
                    >
                      Stop
                    </button>
                  </form>
                </div>
              </div>
            </div>
          ) : (
            <div className="terminal-dock__empty">
              Run a command to mount the dock. Sessions stay attached to the workspace and can be
              revisited from this bottom panel.
            </div>
          )}
        </>
      ) : null}
    </section>
  )
}
