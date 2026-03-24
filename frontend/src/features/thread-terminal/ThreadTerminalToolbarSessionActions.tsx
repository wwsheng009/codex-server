import { i18n } from '../../i18n/runtime'
import {
  ArchiveToolIcon,
  BackToolIcon,
  PinToolIcon,
  StopToolIcon,
  TerminalToolButton,
} from './threadTerminalToolbarControls'
import type {
  ThreadTerminalToolbarSessionActionsState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalToolbarSessionActions({
  canArchiveSelectedSession,
  canPinSelectedSession,
  commandSessionsCount,
  isLauncherOpen,
  isSelectedSessionArchived,
  isSelectedSessionPinned,
  terminateDisabled,
  onArchiveSelectedSession,
  onBackToSession,
  onStopSession,
  onTogglePinSelectedSession,
}: ThreadTerminalToolbarSessionActionsState) {
  const pinTitle = isSelectedSessionPinned
    ? i18n._({
        id: 'Unpin session',
        message: 'Unpin session',
      })
    : i18n._({
        id: 'Pin session',
        message: 'Pin session',
      })
  const archiveTitle = isSelectedSessionArchived
    ? i18n._({
        id: 'Unarchive session',
        message: 'Unarchive session',
      })
    : i18n._({
        id: 'Archive session',
        message: 'Archive session',
      })
  const stopTitle = i18n._({
    id: 'Stop session',
    message: 'Stop session',
  })
  const backTitle = i18n._({
    id: 'Back to session',
    message: 'Back to session',
  })

  return (
    <>
      {canPinSelectedSession ? (
        <TerminalToolButton aria-label={pinTitle} onClick={onTogglePinSelectedSession} title={pinTitle}>
          <PinToolIcon />
        </TerminalToolButton>
      ) : null}
      {canArchiveSelectedSession ? (
        <TerminalToolButton
          aria-label={archiveTitle}
          onClick={onArchiveSelectedSession}
          title={archiveTitle}
        >
          <ArchiveToolIcon />
        </TerminalToolButton>
      ) : null}
      {!isLauncherOpen ? (
        <TerminalToolButton
          aria-label={stopTitle}
          disabled={terminateDisabled}
          onClick={onStopSession}
          title={stopTitle}
        >
          <StopToolIcon />
        </TerminalToolButton>
      ) : commandSessionsCount ? (
        <TerminalToolButton aria-label={backTitle} onClick={onBackToSession} title={backTitle}>
          <BackToolIcon />
        </TerminalToolButton>
      ) : null}
    </>
  )
}
