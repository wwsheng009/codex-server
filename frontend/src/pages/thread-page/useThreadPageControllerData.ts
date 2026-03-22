import { useEffect } from 'react'

import { useThreadPageComposerPanelState } from './useThreadPageComposerPanelState'
import { useThreadPageData } from './useThreadPageData'
import { useThreadPageDisplayState } from './useThreadPageDisplayState'
import { useThreadPageMutations } from './useThreadPageMutations'
import { useThreadPageRailState } from './useThreadPageRailState'
import { useThreadPageStatusState } from './useThreadPageStatusState'
import { useThreadViewportState } from './useThreadViewportState'
import type {
  ControllerState,
  ThreadPageControllerData,
} from './threadPageControllerLayoutTypes'

export function useThreadPageControllerData(
  controllerState: ControllerState,
): ThreadPageControllerData {
  const dataState = useThreadPageData({
    activeComposerMatchMode: controllerState.activeComposerMatch?.mode,
    activeComposerPanel: controllerState.activeComposerPanel,
    hasPendingTurn: Boolean(
      controllerState.pendingTurnsByThread[controllerState.selectedThreadId ?? ''],
    ),
    isDocumentVisible: controllerState.isDocumentVisible,
    normalizedDeferredComposerQuery: controllerState.normalizedDeferredComposerQuery,
    selectedThreadId: controllerState.selectedThreadId,
    threadTurnWindowSize: controllerState.threadTurnWindowSize,
    workspaceId: controllerState.workspaceId,
  })
  const activeSelectedThreadId =
    dataState.resolvedSelectedThreadId ?? controllerState.selectedThreadId

  const railState = useThreadPageRailState({
    isMobileViewport: controllerState.isMobileViewport,
    selectedThread: dataState.selectedThread,
    setIsInspectorExpanded: controllerState.setIsInspectorExpanded,
    setMobileThreadToolsOpen: controllerState.setMobileThreadToolsOpen,
    setSurfacePanelView: controllerState.setSurfacePanelView,
  })

  const mutationState = useThreadPageMutations({
    clearPendingTurn: controllerState.clearPendingTurn,
    queryClient: controllerState.queryClient,
    removeThreadFromSession: controllerState.removeThreadFromSession,
    selectedThreadId: controllerState.selectedThreadId,
    setApprovalAnswers: controllerState.setApprovalAnswers,
    setApprovalErrors: controllerState.setApprovalErrors,
    setCommand: controllerState.setCommand,
    setConfirmingThreadDelete: railState.setConfirmingThreadDelete,
    setContextCompactionFeedback: controllerState.setContextCompactionFeedback,
    setEditingThreadId: railState.setEditingThreadId,
    setEditingThreadName: railState.setEditingThreadName,
    setIsTerminalDockExpanded: controllerState.setIsTerminalDockExpanded,
    setSelectedProcessId: controllerState.setSelectedProcessId,
    setSelectedThread: controllerState.setSelectedThread,
    setSendError: controllerState.setSendError,
    setStdinValue: controllerState.setStdinValue,
    workspaceId: controllerState.workspaceId,
  })

  const panelState = useThreadPageComposerPanelState({
    activeComposerMatchMode: controllerState.activeComposerMatch?.mode,
    composerAutocompleteIndex: controllerState.composerAutocompleteIndex,
    composerCommandDefinitions: controllerState.composerCommandDefinitions,
    composerCommandMenu: controllerState.composerCommandMenu,
    composerPreferences: controllerState.composerPreferences,
    fileSearchFiles: dataState.fileSearchQuery.data?.files,
    fileSearchIsFetching: dataState.fileSearchQuery.isFetching,
    isCommandAutocompleteOpen: controllerState.isCommandAutocompleteOpen,
    isMentionAutocompleteOpen: controllerState.isMentionAutocompleteOpen,
    isSkillAutocompleteOpen: controllerState.isSkillAutocompleteOpen,
    mcpServerStatusEntries: dataState.mcpServerStatusQuery.data?.data,
    models: dataState.modelsQuery.data ?? [],
    normalizedDeferredComposerQuery: controllerState.normalizedDeferredComposerQuery,
    setComposerAutocompleteIndex: controllerState.setComposerAutocompleteIndex,
    skills: dataState.skillsQuery.data ?? [],
    skillsIsFetching: dataState.skillsQuery.isFetching,
    supportsPlanMode: controllerState.supportsPlanMode,
  })

  const displayState = useThreadPageDisplayState({
    activePendingTurn: controllerState.activePendingTurn,
    approvals: dataState.approvalsQuery.data ?? [],
    commandSessions: dataState.commandSessions,
    contextCompactionFeedback: controllerState.contextCompactionFeedback,
    historicalTurns: controllerState.historicalTurns,
    liveThreadDetail: dataState.liveThreadDetail,
    loadedThreadIds: dataState.loadedThreadsQuery.data,
    selectedProcessId: controllerState.selectedProcessId,
    selectedThread: dataState.selectedThread,
    selectedThreadEvents: dataState.selectedThreadEvents,
    selectedThreadId: activeSelectedThreadId,
    selectedThreadTokenUsage: dataState.selectedThreadTokenUsage,
    setContextCompactionFeedback: controllerState.setContextCompactionFeedback,
    surfacePanelView: controllerState.surfacePanelView,
    workspaceEvents: dataState.workspaceEvents,
    workspaceId: controllerState.workspaceId,
  })

  const viewportState = useThreadViewportState({
    displayedTurnsLength: displayState.displayedTurns.length,
    selectedThreadId: activeSelectedThreadId,
    threadContentKey: displayState.threadContentKey,
    threadUnreadUpdateKey: displayState.threadUnreadUpdateKey,
    threadDetailIsLoading: dataState.threadDetailQuery.isLoading,
  })

  useEffect(() => {
    if (controllerState.authRecoveryRequestedAt === null) {
      return
    }

    const latestAccountResultAt = Math.max(
      dataState.accountQuery.dataUpdatedAt ?? 0,
      dataState.accountQuery.errorUpdatedAt ?? 0,
    )

    if (latestAccountResultAt < controllerState.authRecoveryRequestedAt) {
      return
    }

    controllerState.setAuthRecoveryRequestedAt(null)
  }, [
    controllerState.authRecoveryRequestedAt,
    controllerState.setAuthRecoveryRequestedAt,
    dataState.accountQuery.dataUpdatedAt,
    dataState.accountQuery.errorUpdatedAt,
  ])

  useEffect(() => {
    if (!controllerState.historicalTurns.length) {
      return
    }

    const latestTurnCount =
      dataState.liveThreadDetail?.turnCount ??
      dataState.threadDetailQuery.data?.turnCount ??
      0
    const latestWindowTurnCount = dataState.liveThreadDetail?.turns.length ?? 0

    if (
      latestTurnCount > 0 &&
      latestTurnCount < controllerState.historicalTurns.length + latestWindowTurnCount
    ) {
      controllerState.setHistoricalTurns([])
      controllerState.setHasMoreHistoricalTurnsBefore(null)
    }
  }, [
    controllerState.historicalTurns.length,
    controllerState.setHasMoreHistoricalTurnsBefore,
    controllerState.setHistoricalTurns,
    dataState.liveThreadDetail?.turnCount,
    dataState.liveThreadDetail?.turns.length,
    dataState.threadDetailQuery.data?.turnCount,
  ])

  const statusState = useThreadPageStatusState({
    account: dataState.accountQuery.data,
    accountError: dataState.accountQuery.error,
    activeComposerApproval: displayState.activeComposerApproval,
    activeContextCompactionFeedback: displayState.activeContextCompactionFeedback,
    activePendingTurn: controllerState.activePendingTurn,
    approvalsDataUpdatedAt: dataState.approvalsQuery.dataUpdatedAt,
    approvalsIsFetching: dataState.approvalsQuery.isFetching,
    commandSessions: dataState.commandSessions,
    displayedTurnsLength: displayState.displayedTurns.length,
    hasUnreadThreadUpdates: viewportState.hasUnreadThreadUpdates,
    isDocumentVisible: controllerState.isDocumentVisible,
    interruptPending: mutationState.interruptTurnMutation.isPending,
    isInspectorExpanded: controllerState.isInspectorExpanded,
    isMobileViewport: controllerState.isMobileViewport,
    isSelectedThreadLoaded: displayState.isSelectedThreadLoaded,
    isTerminalDockExpanded: controllerState.isTerminalDockExpanded,
    isTerminalDockResizing: controllerState.isTerminalDockResizing,
    isThreadPinnedToLatest: viewportState.isThreadPinnedToLatest,
    latestDisplayedTurn: displayState.latestDisplayedTurn,
    liveThreadStatus: dataState.liveThreadDetail?.status,
    selectedThread: dataState.selectedThread,
    selectedThreadEvents: dataState.selectedThreadEvents,
    selectedThreadId: activeSelectedThreadId,
    sendError: controllerState.sendError,
    suppressAuthenticationError: controllerState.authRecoveryRequestedAt !== null,
    streamState: controllerState.streamState,
    surfacePanelView: controllerState.surfacePanelView,
    syncClock: controllerState.syncClock,
    threadDetailDataUpdatedAt: dataState.threadDetailQuery.dataUpdatedAt,
    threadDetailIsFetching: dataState.threadDetailQuery.isFetching,
    threadsDataUpdatedAt: dataState.threadsQuery.dataUpdatedAt,
    threadsIsFetching: dataState.threadsQuery.isFetching,
    workspaceEvents: dataState.workspaceEvents,
    workspaceId: controllerState.workspaceId,
  })

  return {
    controllerState,
    dataState,
    displayState,
    mutationState,
    panelState,
    railState,
    statusState,
    viewportState,
  }
}
