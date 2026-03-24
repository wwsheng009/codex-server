import { memo } from 'react'

import { i18n } from '../../i18n/runtime'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import {
  formatCommandSessionStatus,
  getCommandSessionTone,
} from './threadTerminalSessionFormatting'
import type {
  ThreadTerminalSessionTabState
} from './threadTerminalDockStateTypes'

export const ThreadTerminalSessionTab = memo(function ThreadTerminalSessionTab({
  archived,
  command,
  isActive,
  onArchiveSession,
  onPinSession,
  onRemoveSession,
  onSelectSession,
  pinned,
  sessionId,
  status,
  title,
  updatedAt,
}: ThreadTerminalSessionTabState) {
  return (
    <div className={isActive ? 'terminal-dock__tab terminal-dock__tab--active' : 'terminal-dock__tab'}>
      <button
        className="terminal-dock__tab-select"
        onClick={() => onSelectSession(sessionId)}
        type="button"
      >
        <div className="terminal-dock__tab-row">
          <span
            className={`terminal-dock__status-dot terminal-dock__status-dot--${getCommandSessionTone(
              status,
            )}`}
          />
          <strong>{title}</strong>
        </div>
        <span>
          {formatCommandSessionStatus(status)}
          {updatedAt ? ` · ${formatRelativeTimeShort(updatedAt)}` : ''}
        </span>
      </button>
      <button
        aria-label={
          pinned
            ? i18n._({
                id: 'Unpin {command}',
                message: 'Unpin {command}',
                values: { command },
              })
            : i18n._({
                id: 'Pin {command}',
                message: 'Pin {command}',
                values: { command },
              })
        }
        className={pinned ? 'terminal-dock__tab-pin terminal-dock__tab-pin--active' : 'terminal-dock__tab-pin'}
        onClick={() => onPinSession(sessionId)}
        type="button"
      >
        <PinToolIcon />
      </button>
      <button
        aria-label={
          archived
            ? i18n._({
                id: 'Unarchive {command}',
                message: 'Unarchive {command}',
                values: { command },
              })
            : i18n._({
                id: 'Archive {command}',
                message: 'Archive {command}',
                values: { command },
              })
        }
        className={
          archived ? 'terminal-dock__tab-archive terminal-dock__tab-archive--active' : 'terminal-dock__tab-archive'
        }
        onClick={() => onArchiveSession(sessionId)}
        type="button"
      >
        <ArchiveToolIcon />
      </button>
      <button
        aria-label={i18n._({
          id: 'Close {command}',
          message: 'Close {command}',
          values: { command },
        })}
        className="terminal-dock__tab-close"
        onClick={() => onRemoveSession(sessionId)}
        type="button"
      >
        ×
      </button>
    </div>
  )
})

function PinToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 4.5h6l-1.2 4.2 2.7 2.5v1.3h-4.2V19.5l-.8.8-.8-.8V12.5H6.5v-1.3l2.7-2.5L9 4.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

function ArchiveToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M5 7.5h14v10.2A1.8 1.8 0 0 1 17.2 19.5H6.8A1.8 1.8 0 0 1 5 17.7V7.5Zm1-3h12l1.2 3H4.8L6 4.5Zm4.5 6h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}
