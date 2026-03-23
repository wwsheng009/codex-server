import {
  compactStatusLabel,
  compactStatusTone,
} from './threadPageComposerShared'
import type { ThreadPageWorkbenchStatusInput } from './threadPageStatusTypes'

export function buildThreadPageWorkbenchStatus({
  activeCommandCount,
  commandSessionCount,
  composerStatusInfo,
  displayedTurnsLength,
  isInspectorExpanded,
  isMobileViewport,
  isTerminalDockVisible,
  isTerminalDockExpanded,
  isTerminalDockResizing,
  isTerminalWindowDragging,
  isTerminalWindowMaximized,
  isTerminalWindowResizing,
  terminalDockPlacement,
  isThreadPinnedToLatest,
  mobileStatus,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
  surfacePanelView,
  syncLabel,
  workspaceEvents,
}: ThreadPageWorkbenchStatusInput) {
  const lastTimelineEventTs =
    selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ??
    workspaceEvents[workspaceEvents.length - 1]?.ts

  const terminalDockClassName = [
    'terminal-dock',
    'terminal-dock--attached',
    `terminal-dock--${terminalDockPlacement}`,
    !isTerminalDockVisible ? 'terminal-dock--hidden' : '',
    !commandSessionCount ? 'terminal-dock--empty' : '',
    !isTerminalDockExpanded ? 'terminal-dock--collapsed' : '',
    isTerminalDockResizing ? 'terminal-dock--resizing' : '',
    isTerminalWindowDragging ? 'terminal-dock--dragging' : '',
    isTerminalWindowMaximized ? 'terminal-dock--maximized' : '',
    isTerminalWindowResizing ? 'terminal-dock--window-resizing' : '',
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
