import { useThreadTerminalLauncherSearchState } from './useThreadTerminalLauncherSearchState'
import type {
  ThreadTerminalInteractionInput,
  ThreadTerminalInteractionState
} from './threadTerminalInteractionStateTypes'
import { useThreadTerminalViewportActionState } from './useThreadTerminalViewportActionState'
import { useThreadTerminalViewportRuntimeState } from './useThreadTerminalViewportRuntimeState'
import { useThreadTerminalViewportSessionState } from './useThreadTerminalViewportSessionState'

export function useThreadTerminalInteractionState({
  commandSessions,
  onSelectSession,
  onStartShellSession,
  onStartCommandLine,
  rootPath,
  selectedCommandSession,
  startCommandPending,
}: ThreadTerminalInteractionInput): ThreadTerminalInteractionState {
  const viewportSession = useThreadTerminalViewportSessionState({
    commandSessions,
    onSelectSession,
    selectedCommandSession,
  })

  const launcherSearch = useThreadTerminalLauncherSearchState({
    activeSessionId: viewportSession.activeSessionId,
    activeSessionsCount: viewportSession.sessions.activeSessions.length,
    archivedSessionsCount: viewportSession.sessions.archivedSessions.length,
    clearActiveViewport: viewportSession.viewportSession.clearActiveViewport,
    clearLauncher: viewportSession.viewportSession.clearLauncher,
    commandSessions,
    findNextInActiveViewport: viewportSession.viewportSession.findNextInActiveViewport,
    findPreviousInActiveViewport: viewportSession.viewportSession.findPreviousInActiveViewport,
    focusActiveViewport: viewportSession.viewportSession.focusActiveViewport,
    focusLauncher: viewportSession.viewportSession.focusLauncher,
    onStartCommandLine,
    onStartShellSession,
    rootPath,
    startCommandPending,
  })

  const runtime = useThreadTerminalViewportRuntimeState({
    getActiveViewportDimensionsInfo: viewportSession.viewportSession.getActiveViewportDimensionsInfo,
    getActiveViewportPerformanceInfo:
      viewportSession.viewportSession.getActiveViewportPerformanceInfo,
    getActiveViewportRendererInfo: viewportSession.viewportSession.getActiveViewportRendererInfo,
    getLauncherDimensionsInfo: viewportSession.viewportSession.getLauncherDimensionsInfo,
    getLauncherPerformanceInfo: viewportSession.viewportSession.getLauncherPerformanceInfo,
    getLauncherRendererInfo: viewportSession.viewportSession.getLauncherRendererInfo,
    isLauncherOpen: launcherSearch.launcher.isOpen,
    selectedCommandSession,
  })

  const viewportActions = useThreadTerminalViewportActionState({
    clearActiveViewport: viewportSession.viewportSession.clearActiveViewport,
    clearLauncher: viewportSession.viewportSession.clearLauncher,
    copyActiveViewportSelection: viewportSession.viewportSession.copyActiveViewportSelection,
    copyLauncherSelection: viewportSession.viewportSession.copyLauncherSelection,
    fitActiveViewport: viewportSession.viewportSession.fitActiveViewport,
    fitLauncher: viewportSession.viewportSession.fitLauncher,
    focusActiveViewport: viewportSession.viewportSession.focusActiveViewport,
    focusLauncher: viewportSession.viewportSession.focusLauncher,
    isLauncherOpen: launcherSearch.launcher.isOpen,
    onCloseLauncher: launcherSearch.launcher.close,
    onSelectSession: viewportSession.selectSession,
    pasteActiveViewportClipboard: viewportSession.viewportSession.pasteActiveViewportClipboard,
    pasteLauncherClipboard: viewportSession.viewportSession.pasteLauncherClipboard,
  })

  return {
    activeDimensionsInfo: runtime.activeDimensionsInfo,
    activePerformanceInfo: runtime.activePerformanceInfo,
    activeRenderableSession: runtime.activeRenderableSession,
    activeRendererInfo: runtime.activeRendererInfo,
    launcher: launcherSearch.launcher,
    refs: viewportSession.refs,
    search: launcherSearch.search,
    sessions: {
      ...viewportSession.sessions,
      activeRenderableSession: runtime.activeRenderableSession,
      selectSession: viewportActions.selectSession,
      shouldUsePlainTextViewport: runtime.shouldUsePlainTextViewport,
    },
    viewport: viewportActions.viewport,
  }
}
