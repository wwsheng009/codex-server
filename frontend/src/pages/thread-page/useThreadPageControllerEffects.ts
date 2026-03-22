import { useThreadPageEffects } from './useThreadPageEffects'
import type { UseThreadPageControllerEffectsInput } from './threadPageControllerLayoutTypes'

export function useThreadPageControllerEffects({
  controllerState,
  dataState,
  statusState,
}: UseThreadPageControllerEffectsInput) {
  useThreadPageEffects({
    activePendingTurn: controllerState.activePendingTurn,
    autoSyncIntervalMs: statusState.autoSyncIntervalMs,
    clearPendingTurn: controllerState.clearPendingTurn,
    contextCompactionFeedback: controllerState.contextCompactionFeedback,
    chromeState: statusState.chromeState,
    currentThreads: dataState.threadsQuery.data ?? [],
    isHeaderSyncBusy: statusState.isHeaderSyncBusy,
    isDocumentVisible: controllerState.isDocumentVisible,
    isMobileViewport: controllerState.isMobileViewport,
    isMobileWorkbenchOverlayOpen: statusState.isMobileWorkbenchOverlayOpen,
    isThreadProcessing: statusState.isThreadProcessing,
    latestThreadDetailId: dataState.threadDetailQuery.data?.id,
    liveThreadTurns: dataState.liveThreadDetail?.turns,
    mobileThreadToolsOpen: controllerState.mobileThreadToolsOpen,
    queryClient: controllerState.queryClient,
    resetMobileThreadChrome: controllerState.resetMobileThreadChrome,
    selectedThread: dataState.selectedThread,
    selectedThreadEvents: dataState.selectedThreadEvents,
    selectedThreadId: controllerState.selectedThreadId,
    setContextCompactionFeedback: controllerState.setContextCompactionFeedback,
    setIsInspectorExpanded: controllerState.setIsInspectorExpanded,
    setMobileThreadChrome: controllerState.setMobileThreadChrome,
    setMobileThreadToolsOpen: controllerState.setMobileThreadToolsOpen,
    setSelectedThread: controllerState.setSelectedThread,
    setSelectedWorkspace: controllerState.setSelectedWorkspace,
    setSurfacePanelView: controllerState.setSurfacePanelView,
    setSyncClock: controllerState.setSyncClock,
    streamState: controllerState.streamState,
    syncTitle: statusState.syncTitle,
    workspaceActivityEvents: dataState.workspaceActivityEvents,
    workspaceId: controllerState.workspaceId,
  })
}
