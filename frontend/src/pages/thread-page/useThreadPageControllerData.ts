import { useEffect } from 'react'

import { useThreadPageComposerPanelState } from './useThreadPageComposerPanelState'
import { useThreadPageData } from './useThreadPageData'
import { useThreadPageDisplayState } from './useThreadPageDisplayState'
import { useThreadPageMutations } from './useThreadPageMutations'
import { useThreadPageRailState } from './useThreadPageRailState'
import { useThreadPageStatusState } from './useThreadPageStatusState'
import { useThreadViewportState } from './useThreadViewportState'
import { shouldSuppressAuthenticationErrorAfterRecovery } from './threadPageAuthRecovery'
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
    selectedBotId: controllerState.botSendSelectedBotId || undefined,
    selectedProcessId: controllerState.selectedProcessId,
    selectedThreadId: controllerState.selectedThreadId,
    streamState: controllerState.streamState,
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
    setBotSendText: controllerState.setBotSendText,
    setCommand: controllerState.setCommand,
    setConfirmingThreadDelete: railState.setConfirmingThreadDelete,
    setContextCompactionFeedback: controllerState.setContextCompactionFeedback,
    setEditingThreadId: railState.setEditingThreadId,
    setEditingThreadName: railState.setEditingThreadName,
    setIsTerminalDockExpanded: controllerState.setIsTerminalDockExpanded,
    setIsTerminalDockVisible: controllerState.setIsTerminalDockVisible,
    setSelectedProcessId: controllerState.setSelectedProcessId,
    setSelectedThread: controllerState.setSelectedThread,
    setSendError: controllerState.setSendError,
    setStdinValue: controllerState.setStdinValue,
    streamState: controllerState.streamState,
    threadWorkspaceId: controllerState.workspaceId,
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
    contextCompactionFeedback: controllerState.contextCompactionFeedback,
    fullTurnItemContentOverridesById: controllerState.fullTurnItemContentOverridesById,
    fullTurnItemOverridesById: controllerState.fullTurnItemOverridesById,
    fullTurnOverridesById: controllerState.fullTurnOverridesById,
    historicalTurns: controllerState.historicalTurns,
    liveThreadDetail: dataState.liveThreadDetail,
    loadedThreadIds: dataState.loadedThreadsQuery.data,
    selectedCommandSession: dataState.selectedCommandSession,
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
    threadContentSignature: displayState.threadContentSignature,
    threadUnreadUpdateKey: displayState.threadUnreadUpdateKey,
    threadDetailIsLoading: dataState.threadDetailQuery.isLoading,
  })

  const latestAccountResultAt = Math.max(
    dataState.accountQuery.dataUpdatedAt ?? 0,
    dataState.accountQuery.errorUpdatedAt ?? 0,
  )
  const suppressAuthenticationError = shouldSuppressAuthenticationErrorAfterRecovery({
    authRecoveryRequestedAt: controllerState.authRecoveryRequestedAt,
    latestAccountResultAt,
    accountStatus: dataState.accountQuery.data?.status,
  })

  useEffect(() => {
    const queryCache = controllerState.queryClient.getQueryCache()

    for (const query of queryCache.getAll()) {
      const queryKey = query.queryKey
      if (!Array.isArray(queryKey) || queryKey.length < 2) {
        continue
      }

      const [scope, queryWorkspaceId, queryThreadId] = queryKey
      if (
        queryWorkspaceId !== controllerState.workspaceId ||
        (scope !== 'thread-detail' && scope !== 'thread-detail-page')
      ) {
        continue
      }

      if (queryThreadId === activeSelectedThreadId) {
        continue
      }

      controllerState.queryClient.removeQueries({ queryKey })
    }
  }, [activeSelectedThreadId, controllerState.queryClient, controllerState.workspaceId])

  useEffect(() => {
    if (!activeSelectedThreadId) {
      if (controllerState.botSendSelectedBotId) {
        controllerState.setBotSendSelectedBotId('')
      }
      if (controllerState.botSendSelectedDeliveryTargetId) {
        controllerState.setBotSendSelectedDeliveryTargetId('')
      }
      return
    }

    const bots = dataState.botSendBotsQuery.data ?? []
    if (!bots.length) {
      if (controllerState.botSendSelectedBotId) {
        controllerState.setBotSendSelectedBotId('')
      }
      if (controllerState.botSendSelectedDeliveryTargetId) {
        controllerState.setBotSendSelectedDeliveryTargetId('')
      }
      return
    }

    const boundBotId = dataState.threadBotBindingQuery.data?.botId?.trim() ?? ''
    if (boundBotId) {
      const hasBoundBot = bots.some((bot) => bot.id === boundBotId)
      if (hasBoundBot && boundBotId !== controllerState.botSendSelectedBotId) {
        controllerState.setBotSendSelectedBotId(boundBotId)
        return
      }
    }

    const hasSelectedBot = bots.some((bot) => bot.id === controllerState.botSendSelectedBotId)
    if (hasSelectedBot) {
      return
    }

    const selectedThreadWorkspaceId = dataState.selectedThread?.workspaceId?.trim() ?? controllerState.workspaceId
    const nextBot =
      bots.find(
        (bot) =>
          bot.status === 'active' &&
          bot.workspaceId?.trim() === selectedThreadWorkspaceId,
      ) ??
      bots.find((bot) => bot.status === 'active') ??
      bots[0]
    if (nextBot && nextBot.id !== controllerState.botSendSelectedBotId) {
      controllerState.setBotSendSelectedBotId(nextBot.id)
    }
  }, [
    activeSelectedThreadId,
    controllerState.botSendSelectedBotId,
    controllerState.botSendSelectedDeliveryTargetId,
    controllerState.setBotSendSelectedBotId,
    controllerState.setBotSendSelectedDeliveryTargetId,
    controllerState.workspaceId,
    dataState.botSendBotsQuery.data,
    dataState.selectedThread?.workspaceId,
    dataState.threadBotBindingQuery.data,
  ])

  useEffect(() => {
    if (!activeSelectedThreadId || !controllerState.botSendSelectedBotId) {
      if (controllerState.botSendSelectedDeliveryTargetId) {
        controllerState.setBotSendSelectedDeliveryTargetId('')
      }
      return
    }

    const deliveryTargets = dataState.botSendDeliveryTargetsQuery.data ?? []
    if (!deliveryTargets.length) {
      if (controllerState.botSendSelectedDeliveryTargetId) {
        controllerState.setBotSendSelectedDeliveryTargetId('')
      }
      return
    }

    const boundTargetId = dataState.threadBotBindingQuery.data?.deliveryTargetId?.trim() ?? ''
    if (boundTargetId) {
      const boundTarget = deliveryTargets.find((target) => target.id === boundTargetId)
      if (boundTarget && boundTarget.id !== controllerState.botSendSelectedDeliveryTargetId) {
        controllerState.setBotSendSelectedDeliveryTargetId(boundTarget.id)
        return
      }
    }

    const hasSelectedDeliveryTarget = deliveryTargets.some(
      (target) => target.id === controllerState.botSendSelectedDeliveryTargetId,
    )
    if (hasSelectedDeliveryTarget) {
      return
    }

    const nextDeliveryTarget =
      deliveryTargets.find(
        (target) =>
          target.status === 'active' &&
          (target.deliveryReadiness?.trim().toLowerCase() ?? 'ready') === 'ready',
      ) ??
      deliveryTargets.find((target) => target.status === 'active') ??
      deliveryTargets[0]
    if (nextDeliveryTarget && nextDeliveryTarget.id !== controllerState.botSendSelectedDeliveryTargetId) {
      controllerState.setBotSendSelectedDeliveryTargetId(nextDeliveryTarget.id)
    }
  }, [
    activeSelectedThreadId,
    controllerState.botSendSelectedBotId,
    controllerState.botSendSelectedDeliveryTargetId,
    controllerState.setBotSendSelectedDeliveryTargetId,
    dataState.botSendDeliveryTargetsQuery.data,
    dataState.threadBotBindingQuery.data,
  ])

  useEffect(() => {
    if (controllerState.authRecoveryRequestedAt === null) {
      return
    }

    if (suppressAuthenticationError) {
      return
    }

    controllerState.setAuthRecoveryRequestedAt(null)
  }, [
    controllerState.authRecoveryRequestedAt,
    controllerState.setAuthRecoveryRequestedAt,
    suppressAuthenticationError,
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
    activeCommandCount: dataState.activeCommandCount,
    commandSessionCount: dataState.commandSessionCount,
    displayedTurnsLength: displayState.displayedTurns.length,
    hasRecoverableRuntimeOperation:
      Boolean(controllerState.recoverableSendInput?.trim()) ||
      Boolean(controllerState.recoverableCommandOperation),
    hasUnreadThreadUpdates: viewportState.hasUnreadThreadUpdates,
    isDocumentVisible: controllerState.isDocumentVisible,
    interruptPending: mutationState.interruptTurnMutation.isPending,
    isInspectorExpanded: controllerState.isInspectorExpanded,
    isMobileViewport: controllerState.isMobileViewport,
    isTerminalDockVisible: controllerState.isTerminalDockVisible,
    isSelectedThreadLoaded: displayState.isSelectedThreadLoaded,
    isTerminalDockExpanded: controllerState.isTerminalDockExpanded,
    isTerminalDockResizing: controllerState.isTerminalDockResizing,
    isTerminalWindowDragging: controllerState.isTerminalWindowDragging,
    isTerminalWindowMaximized: controllerState.isTerminalWindowMaximized,
    isTerminalWindowResizing: controllerState.isTerminalWindowResizing,
    terminalDockPlacement: controllerState.terminalDockPlacement,
    isThreadPinnedToLatest: viewportState.isThreadPinnedToLatest,
    latestDisplayedTurn: displayState.latestDisplayedTurn,
    liveThreadStatus: dataState.liveThreadDetail?.status,
    restartAndRetryPending: controllerState.isRestartAndRetryPending,
    selectedThread: dataState.selectedThread,
    selectedThreadEvents: dataState.selectedThreadEvents,
    selectedThreadId: activeSelectedThreadId,
    sendError: controllerState.sendError,
    suppressAuthenticationError,
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
