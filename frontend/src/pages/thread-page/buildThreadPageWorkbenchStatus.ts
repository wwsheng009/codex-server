import {
  compactStatusLabel,
  compactStatusTone,
} from './threadPageComposerShared'
import type { ThreadPageWorkbenchStatusInput } from './threadPageStatusTypes'

export function buildThreadPageWorkbenchStatus({
  commandSessions,
  composerStatusInfo,
  displayedTurnsLength,
  isInspectorExpanded,
  isMobileViewport,
  isTerminalDockExpanded,
  isTerminalDockResizing,
  isThreadPinnedToLatest,
  mobileStatus,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
  surfacePanelView,
  syncLabel,
  workspaceEvents,
}: ThreadPageWorkbenchStatusInput) {
  const activeCommandCount = commandSessions.filter((session) => session.status === 'running').length
  const lastTimelineEventTs =
    selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ??
    workspaceEvents[workspaceEvents.length - 1]?.ts

  const terminalDockClassName = [
    'terminal-dock',
    'terminal-dock--attached',
    !commandSessions.length ? 'terminal-dock--empty' : '',
    !isTerminalDockExpanded ? 'terminal-dock--collapsed' : '',
    isTerminalDockResizing ? 'terminal-dock--resizing' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const isMobileInspectorOpen = isMobileViewport && isInspectorExpanded
  const isMobileSurfacePanelOpen = isMobileViewport && Boolean(surfacePanelView)
  const isMobileWorkbenchOverlayOpen = isMobileInspectorOpen || isMobileSurfacePanelOpen
  const showJumpToLatestButton = Boolean(
    selectedThread && displayedTurnsLength > 0 && !isThreadPinnedToLatest,
  )

  const threadRuntimeNotice =
    composerStatusInfo?.noticeTitle && composerStatusInfo.noticeMessage
      ? {
          title: composerStatusInfo.noticeTitle,
          message: composerStatusInfo.noticeMessage,
          summary: composerStatusInfo.summary,
          noticeKey: `thread-runtime-${selectedThreadId}-${composerStatusInfo.label}`,
        }
      : undefined

  const chromeState = {
    statusLabel: compactStatusLabel(mobileStatus),
    statusTone: compactStatusTone(mobileStatus),
    syncLabel,
  }

  return {
    activeCommandCount,
    chromeState,
    isMobileWorkbenchOverlayOpen,
    lastTimelineEventTs,
    showJumpToLatestButton,
    terminalDockClassName,
    threadRuntimeNotice,
  }
}
