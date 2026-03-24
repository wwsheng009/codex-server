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

  return (
    <div className="terminal-dock__meta">
      {!isLauncherOpen && selectedCommandSession?.id ? <code>{selectedCommandSession.id}</code> : null}
      {!isLauncherOpen && selectedCommandSession?.shellPath ? (
        <code>{selectedCommandSession.shellPath}</code>
      ) : null}
      {currentWorkspacePath ? <code>{currentWorkspacePath}</code> : null}
      {hasFinishedSessions ? (
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
      ) : null}
    </div>
  )
}
