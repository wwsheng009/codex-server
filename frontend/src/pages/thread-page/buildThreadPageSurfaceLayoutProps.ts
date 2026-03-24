import { getErrorMessage } from '../../lib/error-utils'
import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config'
import { buildThreadTerminalDockProps } from './buildThreadTerminalDockProps'
import type {
  BuildThreadPageSurfaceLayoutPropsResult,
  SurfaceProps,
} from './threadPageLayoutPropTypes'
import type { BuildThreadPageSurfaceLayoutPropsInput } from './threadPageLayoutInputTypes'

export function buildThreadPageSurfaceLayoutProps(
  input: BuildThreadPageSurfaceLayoutPropsInput,
): BuildThreadPageSurfaceLayoutPropsResult {
  const handleRetryThreadLoad = () =>
    void input.queryClient.invalidateQueries({
      queryKey: ['thread-detail', input.workspaceId, input.selectedThreadId],
    })

  function handleToggleSurfacePanelSide() {
    const surfacePanelView = input.surfacePanelView

    if (!surfacePanelView) {
      return
    }

    input.setSurfacePanelSides((current: Record<SurfacePanelView, SurfacePanelSide>) => ({
      ...current,
      [surfacePanelView]:
        current[surfacePanelView] === 'right' ? 'left' : 'right',
    }))
  }

  const surfaceProps: SurfaceProps = {
    activePendingTurnPhase: input.activePendingTurnPhase,
    activeSurfacePanelSide: input.activeSurfacePanelSide,
    approvalAnswers: input.approvalAnswers,
    approvalErrors: input.approvalErrors,
    approvals: input.approvals,
    displayedTurns: input.displayedTurns,
    createThreadErrorMessage: input.createThreadErrorMessage,
    hasMoreTurnsBefore: input.hasMoreTurnsBefore,
    hasThreads: input.hasThreads,
    hiddenTurnsCount: input.hiddenTurnsCount,
    isCreateThreadPending: input.isCreateThreadPending,
    isLoadingOlderTurns: input.isLoadingOlderTurns,
    isThreadsLoaded: input.isThreadsLoaded,
    isThreadSelectionLoading: input.isThreadSelectionLoading,
    isMobileViewport: input.isMobileViewport,
    isSurfacePanelResizing: input.isSurfacePanelResizing,
    isThreadPinnedToLatest: input.isThreadPinnedToLatest,
    isThreadProcessing: input.isThreadProcessing,
    isThreadViewportInteracting: input.isThreadViewportInteracting,
    isWaitingForThreadData: input.isWaitingForThreadData,
    liveTimelineEntries: input.liveTimelineEntries,
    onChangeApprovalAnswer: input.onChangeApprovalAnswer,
    onCloseWorkbenchOverlay: input.onCloseWorkbenchOverlay,
    onCaptureOlderTurnsAnchor: input.onCaptureOlderTurnsAnchor,
    onCreateThread: input.onCreateThread,
    onLoadOlderTurns: input.onLoadOlderTurns,
    onReleaseFullTurn: input.onReleaseFullTurn,
    onRetainFullTurn: input.onRetainFullTurn,
    onRequestFullTurn: input.onRequestFullTurn,
    onRespondApproval: input.onRespondApproval,
    onRetryServerRequest: input.onRetryServerRequest,
    onRetryThreadLoad: handleRetryThreadLoad,
    onRestoreOlderTurnsViewport: input.onRestoreOlderTurnsViewport,
    onSurfacePanelResizeStart: input.onSurfacePanelResizeStart,
    onThreadViewportScroll: input.onThreadViewportScroll,
    onToggleSurfacePanelSide: handleToggleSurfacePanelSide,
    respondingToApproval: input.respondingToApproval,
    selectedThread: input.selectedThread,
    surfacePanelView: input.surfacePanelView,
    timelineIdentity: input.selectedThreadId ?? '',
    threadDetailError: input.threadDetailError,
    threadDetailIsLoading: input.threadDetailIsLoading,
    threadLoadErrorMessage: getErrorMessage(input.threadDetailError),
    threadLogStyle: input.threadLogStyle,
    threadRuntimeNotice: input.threadRuntimeNotice,
    threadViewportRef: input.threadViewportRef,
    workspaceName: input.workspaceName,
  }

  const terminalDockProps = buildThreadTerminalDockProps(input)

  return {
    surfaceProps,
    terminalDockProps,
  }
}
