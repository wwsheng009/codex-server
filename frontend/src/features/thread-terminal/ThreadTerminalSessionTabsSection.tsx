import { i18n } from '../../i18n/runtime'
import { formatCommandSessionTitle } from './threadTerminalSessionFormatting'
import type {
  ThreadTerminalSessionTabsSectionState
} from './threadTerminalDockStateTypes'
import { ThreadTerminalSessionTab } from './ThreadTerminalSessionTab'

export function ThreadTerminalSessionTabsSection({
  isLauncherOpen,
  onArchiveSession,
  onPinSession,
  onRemoveSession,
  placement,
  selectedCommandSession,
  sessions,
}: ThreadTerminalSessionTabsSectionState) {
  return (
    <>
      {sessions.visibleSessions.length ? (
        <div
          className={
            placement === 'right'
              ? 'terminal-dock__tabs terminal-dock__tabs--stacked'
              : 'terminal-dock__tabs'
          }
        >
          {sessions.visibleSessions.map((session) => (
            <ThreadTerminalSessionTab
              archived={Boolean(session.archived)}
              command={session.command}
              isActive={session.id === selectedCommandSession?.id && !isLauncherOpen}
              key={session.id}
              onArchiveSession={onArchiveSession}
              onPinSession={onPinSession}
              onRemoveSession={onRemoveSession}
              onSelectSession={sessions.selectSession}
              pinned={Boolean(session.pinned)}
              sessionId={session.id}
              status={session.status}
              title={formatCommandSessionTitle(session)}
              updatedAt={session.updatedAt}
            />
          ))}
        </div>
      ) : null}
      {sessions.archivedSessions.length ? (
        <div className="terminal-dock__archive-toggle-row">
          <button
            className="terminal-dock__meta-action"
            onClick={sessions.toggleShowArchivedSessions}
            type="button"
          >
            {sessions.showArchivedSessions
              ? i18n._({
                  id: 'Hide archived ({count})',
                  message: 'Hide archived ({count})',
                  values: { count: sessions.archivedSessions.length },
                })
              : i18n._({
                  id: 'Show archived ({count})',
                  message: 'Show archived ({count})',
                  values: { count: sessions.archivedSessions.length },
                })}
          </button>
        </div>
      ) : null}
    </>
  )
}
