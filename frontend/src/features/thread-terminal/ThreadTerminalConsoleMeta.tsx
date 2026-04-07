import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalConsoleMetaState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalConsoleMeta({
  hasFinishedSessions,
  isLauncherOpen,
  rootPath,
  selectedCommandSession,
  onClearCompletedSessions,
}: ThreadTerminalConsoleMetaState) {
  const currentWorkspacePath =
    !isLauncherOpen && (selectedCommandSession?.currentCwd || selectedCommandSession?.initialCwd)
      ? selectedCommandSession.currentCwd || selectedCommandSession.initialCwd
      : rootPath
  const metaValues = [
    !isLauncherOpen && selectedCommandSession?.id ? selectedCommandSession.id : null,
    !isLauncherOpen && selectedCommandSession?.shellPath ? selectedCommandSession.shellPath : null,
    currentWorkspacePath ?? null,
  ].filter((value): value is string => Boolean(value))

  return (
    <div className="terminal-dock__meta">
      {metaValues.length ? (
        <div className="terminal-dock__meta-values">
          {metaValues.map((value) => (
            <span className="terminal-dock__meta-token" key={value} title={value}>
              {value}
            </span>
          ))}
        </div>
      ) : null}
      {hasFinishedSessions ? (
        <div className="terminal-dock__meta-actions">
          <button
            className="terminal-dock__meta-action"
            onClick={onClearCompletedSessions}
            type="button"
          >
            {i18n._({
              id: 'Clear finished',
              message: 'Clear finished',
            })}
          </button>
        </div>
      ) : null}
    </div>
  )
}
