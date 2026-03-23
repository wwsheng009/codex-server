import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { i18n } from '../../i18n/runtime'

export type ThreadTerminalToolbarProps = {
  canArchiveSelectedSession: boolean
  canCopy: boolean
  canPaste: boolean
  canPinSelectedSession: boolean
  commandSessionsCount: number
  isLauncherOpen: boolean
  launcherMode: 'shell' | 'command'
  isSelectedSessionArchived: boolean
  isSelectedSessionPinned: boolean
  shellLauncherControl?: ReactNode
  shellActionLabel: string
  shellActionTitle: string
  onArchiveSelectedSession: () => void
  onBackToSession: () => void
  onClearViewport: () => void
  onCopySelection: () => void
  onFitViewport: () => void
  onFocusViewport: () => void
  onOpenCommandLauncher: () => void
  onPasteClipboard: () => void
  onSearchTerminal: () => void
  onStartShellSession: () => void
  onStopSession: () => void
  onTogglePinSelectedSession: () => void
  searchDisabled: boolean
  startSessionPending?: boolean
  terminateDisabled: boolean
}

export function ThreadTerminalToolbar({
  canArchiveSelectedSession,
  canCopy,
  canPaste,
  canPinSelectedSession,
  commandSessionsCount,
  isLauncherOpen,
  launcherMode,
  isSelectedSessionArchived,
  isSelectedSessionPinned,
  shellLauncherControl,
  shellActionLabel,
  shellActionTitle,
  onArchiveSelectedSession,
  onBackToSession,
  onClearViewport,
  onCopySelection,
  onFitViewport,
  onFocusViewport,
  onOpenCommandLauncher,
  onPasteClipboard,
  onSearchTerminal,
  onStartShellSession,
  onStopSession,
  onTogglePinSelectedSession,
  searchDisabled,
  startSessionPending,
  terminateDisabled,
}: ThreadTerminalToolbarProps) {
  return (
    <div className="terminal-dock__toolbar">
      {shellLauncherControl}
      <TerminalToolbarActionButton
        aria-label={shellActionTitle}
        data-active={isLauncherOpen && launcherMode === 'shell' ? 'true' : undefined}
        disabled={Boolean(startSessionPending)}
        onClick={onStartShellSession}
        title={shellActionTitle}
      >
        {shellActionLabel}
      </TerminalToolbarActionButton>
      <TerminalToolbarActionButton
        aria-label={i18n._({
          id: 'Run one-shot command',
          message: 'Run one-shot command',
        })}
        data-active={isLauncherOpen && launcherMode === 'command' ? 'true' : undefined}
        disabled={Boolean(startSessionPending)}
        onClick={onOpenCommandLauncher}
        title={i18n._({
          id: 'Run one-shot command',
          message: 'Run one-shot command',
        })}
      >
        {i18n._({
          id: 'Command',
          message: 'Command',
        })}
      </TerminalToolbarActionButton>
      <TerminalToolbarDivider />
      <TerminalToolButton
        aria-label={i18n._({
          id: 'Fit terminal',
          message: 'Fit terminal',
        })}
        onClick={onFitViewport}
        title={i18n._({
          id: 'Fit terminal',
          message: 'Fit terminal',
        })}
      >
        <FitToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={i18n._({
          id: 'Focus terminal',
          message: 'Focus terminal',
        })}
        onClick={onFocusViewport}
        title={i18n._({
          id: 'Focus terminal',
          message: 'Focus terminal',
        })}
      >
        <FocusToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={i18n._({
          id: 'Copy selection',
          message: 'Copy selection',
        })}
        disabled={!canCopy}
        onClick={onCopySelection}
        title={i18n._({
          id: 'Copy selection',
          message: 'Copy selection',
        })}
      >
        <CopyToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={i18n._({
          id: 'Paste clipboard',
          message: 'Paste clipboard',
        })}
        disabled={!canPaste}
        onClick={onPasteClipboard}
        title={i18n._({
          id: 'Paste clipboard',
          message: 'Paste clipboard',
        })}
      >
        <PasteToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={i18n._({
          id: 'Search terminal',
          message: 'Search terminal',
        })}
        disabled={searchDisabled}
        onClick={onSearchTerminal}
        title={i18n._({
          id: 'Search terminal',
          message: 'Search terminal',
        })}
      >
        <SearchToolIcon />
      </TerminalToolButton>
      <TerminalToolButton
        aria-label={i18n._({
          id: 'Clear viewport',
          message: 'Clear viewport',
        })}
        onClick={onClearViewport}
        title={i18n._({
          id: 'Clear viewport',
          message: 'Clear viewport',
        })}
      >
        <ClearToolIcon />
      </TerminalToolButton>
      {canPinSelectedSession ? (
        <TerminalToolButton
          aria-label={
            isSelectedSessionPinned
              ? i18n._({
                  id: 'Unpin session',
                  message: 'Unpin session',
                })
              : i18n._({
                  id: 'Pin session',
                  message: 'Pin session',
                })
          }
          onClick={onTogglePinSelectedSession}
          title={
            isSelectedSessionPinned
              ? i18n._({
                  id: 'Unpin session',
                  message: 'Unpin session',
                })
              : i18n._({
                  id: 'Pin session',
                  message: 'Pin session',
                })
          }
        >
          <PinToolIcon />
        </TerminalToolButton>
      ) : null}
      {canArchiveSelectedSession ? (
        <TerminalToolButton
          aria-label={
            isSelectedSessionArchived
              ? i18n._({
                  id: 'Unarchive session',
                  message: 'Unarchive session',
                })
              : i18n._({
                  id: 'Archive session',
                  message: 'Archive session',
                })
          }
          onClick={onArchiveSelectedSession}
          title={
            isSelectedSessionArchived
              ? i18n._({
                  id: 'Unarchive session',
                  message: 'Unarchive session',
                })
              : i18n._({
                  id: 'Archive session',
                  message: 'Archive session',
                })
          }
        >
          <ArchiveToolIcon />
        </TerminalToolButton>
      ) : null}
      {!isLauncherOpen ? (
        <TerminalToolButton
          aria-label={i18n._({
            id: 'Stop session',
            message: 'Stop session',
          })}
          disabled={terminateDisabled}
          onClick={onStopSession}
          title={i18n._({
            id: 'Stop session',
            message: 'Stop session',
          })}
        >
          <StopToolIcon />
        </TerminalToolButton>
      ) : commandSessionsCount ? (
        <TerminalToolButton
          aria-label={i18n._({
            id: 'Back to session',
            message: 'Back to session',
          })}
          onClick={onBackToSession}
          title={i18n._({
            id: 'Back to session',
            message: 'Back to session',
          })}
        >
          <BackToolIcon />
        </TerminalToolButton>
      ) : null}
    </div>
  )
}

function TerminalToolbarActionButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className="terminal-dock__toolbar-action"
      type={props.type ?? 'button'}
    >
      {children}
    </button>
  )
}

function TerminalToolbarDivider() {
  return <span aria-hidden="true" className="terminal-dock__toolbar-divider" />
}

function TerminalToolButton({
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props} className="terminal-dock__toolbutton" type={props.type ?? 'button'}>
      {children}
    </button>
  )
}

function FitToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function FocusToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 4H5v4M15 4h4v4M9 20H5v-4M15 20h4v-4M12 9.5A2.5 2.5 0 1 1 12 14.5A2.5 2.5 0 0 1 12 9.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function CopyToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="9"
        x="9.5"
        y="8.5"
      />
      <path
        d="M7 15.5H6A1.5 1.5 0 0 1 4.5 14V6A1.5 1.5 0 0 1 6 4.5h8A1.5 1.5 0 0 1 15.5 6v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function PasteToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 5.5h6M10 4h4a1 1 0 0 1 1 1v1H9V5a1 1 0 0 1 1-1Zm-2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function SearchToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  )
}

function ClearToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M5 7.5h14M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M7.2 7.5l.8 10a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8l.8-10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

function StopToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width="10"
        x="7"
        y="7"
      />
    </svg>
  )
}

function BackToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="m14.5 6.5-5 5 5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

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
