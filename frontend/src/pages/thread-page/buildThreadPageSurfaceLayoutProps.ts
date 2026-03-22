import { getErrorMessage } from '../../lib/error-utils'
import type {
  BuildThreadPageLayoutPropsInput,
  SurfaceProps,
  TerminalDockProps,
} from './threadPageLayoutPropTypes'

export function buildThreadPageSurfaceLayoutProps(
  input: BuildThreadPageLayoutPropsInput,
): {
  surfaceProps: SurfaceProps
  terminalDockProps: TerminalDockProps | undefined
} {
  const handleRetryThreadLoad = () =>
    void input.queryClient.invalidateQueries({
      queryKey: ['thread-detail', input.workspaceId, input.selectedThreadId],
    })

  function handleToggleSurfacePanelSide() {
    const surfacePanelView = input.surfacePanelView

    if (!surfacePanelView) {
      return
    }

    input.setSurfacePanelSides((current) => ({
      ...current,
      [surfacePanelView]:
        current[surfacePanelView] === 'right' ? 'left' : 'right',
    }))
  }

  function handleToggleTerminalDockExpanded() {
    input.setIsTerminalDockExpanded((current) => !current)
  }

  const surfaceProps: SurfaceProps = {
    activePendingTurnPhase: input.activePendingTurnPhase,
    activeSurfacePanelSide: input.activeSurfacePanelSide,
    approvalAnswers: input.approvalAnswers,
    approvalErrors: input.approvalErrors,
    approvals: input.approvals,
    displayedTurns: input.displayedTurns,
    isMobileViewport: input.isMobileViewport,
    isSurfacePanelResizing: input.isSurfacePanelResizing,
    isThreadPinnedToLatest: input.isThreadPinnedToLatest,
    isThreadProcessing: input.isThreadProcessing,
    isWaitingForThreadData: input.isWaitingForThreadData,
    liveTimelineEntries: input.liveTimelineEntries,
    onChangeApprovalAnswer: input.onChangeApprovalAnswer,
    onCloseWorkbenchOverlay: input.onCloseWorkbenchOverlay,
    onRespondApproval: input.onRespondApproval,
    onRetryServerRequest: input.onRetryServerRequest,
    onRetryThreadLoad: handleRetryThreadLoad,
    onSurfacePanelResizeStart: input.onSurfacePanelResizeStart,
    onThreadViewportScroll: input.onThreadViewportScroll,
    onToggleSurfacePanelSide: handleToggleSurfacePanelSide,
    respondingToApproval: input.respondingToApproval,
    selectedThread: input.selectedThread,
    surfacePanelView: input.surfacePanelView,
    threadDetailError: input.threadDetailError,
    threadDetailIsLoading: input.threadDetailIsLoading,
    threadLoadErrorMessage: getErrorMessage(input.threadDetailError),
    threadLogStyle: input.threadLogStyle,
    threadRuntimeNotice: input.threadRuntimeNotice,
    threadViewportRef: input.threadViewportRef,
  }

  const terminalDockProps: TerminalDockProps | undefined = input.isMobileViewport
    ? undefined
    : {
        activeCommandCount: input.activeCommandCount,
        className: input.terminalDockClassName,
        commandSessions: input.commandSessions,
        isExpanded: input.isTerminalDockExpanded,
        onChangeStdinValue: input.onChangeStdinValue,
        onClearCompletedSessions: input.onClearCompletedSessions,
        onRemoveSession: input.onRemoveSession,
        onResizeStart: input.onResizeStart,
        onSelectSession: input.onSelectSession,
        onSubmitStdin: input.onSubmitStdin,
        onTerminateSelectedSession: input.onTerminateSelectedSession,
        onToggleExpanded: handleToggleTerminalDockExpanded,
        selectedCommandSession: input.selectedCommandSession,
        stdinValue: input.stdinValue,
        terminateDisabled: input.terminateDisabled,
      }

  return {
    surfaceProps,
    terminalDockProps,
  }
}
