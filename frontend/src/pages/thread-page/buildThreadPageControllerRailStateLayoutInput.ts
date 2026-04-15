import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import { getErrorMessage } from '../../lib/error-utils'
import { buildWorkspaceRuntimeRecoverySummary } from '../../features/workspaces/runtimeRecovery'

export function buildThreadPageControllerRailStateLayoutInput({
  controllerState,
  dataState,
  displayState,
  mutationState,
  railState,
  statusState,
}: BuildThreadPageControllerLayoutPropsInput) {
  const activeSelectedThreadId =
    dataState.resolvedSelectedThreadId ?? controllerState.selectedThreadId
  const totalTurnCount =
    dataState.liveThreadDetail?.turnCount ??
    dataState.threadDetailQuery.data?.turnCount ??
    dataState.selectedThread?.turnCount ??
    displayState.turnCount
  const totalMessageCount =
    dataState.liveThreadDetail?.messageCount ??
    dataState.threadDetailQuery.data?.messageCount ??
    dataState.selectedThread?.messageCount ??
    displayState.loadedMessageCount
  const currentBreakdown = displayState.resolvedThreadTokenUsage?.last
  const cumulativeBreakdown = displayState.resolvedThreadTokenUsage?.total

  return {
    botSendBinding: dataState.threadBotBindingQuery.data ?? null,
    botSendBindingPending:
      mutationState.bindThreadBotChannelMutation.isPending ||
      mutationState.deleteThreadBotBindingMutation.isPending,
    botSendBots: dataState.botSendBotsQuery.data ?? [],
    botSendDeliveryTargets: dataState.botSendDeliveryTargetsQuery.data ?? [],
    botSendErrorMessage: controllerState.botSendError,
    botSendLoading:
      dataState.botSendBotsQuery.isLoading ||
      dataState.botSendDeliveryTargetsQuery.isLoading ||
      dataState.threadBotBindingQuery.isLoading,
    botSendPending: mutationState.sendBotDeliveryTargetOutboundMessageMutation.isPending,
    botSendSelectedBotId: controllerState.botSendSelectedBotId,
    botSendSelectedDeliveryTargetId: controllerState.botSendSelectedDeliveryTargetId,
    botSendText: controllerState.botSendText,
    command: controllerState.command,
    commandRunMode: controllerState.commandRunMode,
    commandCount: dataState.commandSessions.length,
    currentThreadStatus: dataState.liveThreadDetail?.status ?? dataState.selectedThread?.status,
    currentInputTokens: currentBreakdown?.inputTokens ?? 0,
    currentOutputTokens: currentBreakdown?.outputTokens ?? 0,
    currentReasoningTokens: currentBreakdown?.reasoningOutputTokens ?? 0,
    confirmDialogError: mutationState.deleteThreadMutation.error,
    confirmingThreadDelete: railState.confirmingThreadDelete,
    deletePending: mutationState.deleteThreadMutation.isPending,
    deletingThreadId: mutationState.deleteThreadMutation.variables,
    editingThreadId: railState.editingThreadId,
    editingThreadName: railState.editingThreadName,
    isExpanded: controllerState.isInspectorExpanded,
    isResizing: controllerState.isInspectorResizing,
    isThreadToolsExpanded: railState.isThreadToolsExpanded,
    isWorkbenchToolsExpanded: railState.isWorkbenchToolsExpanded,
    latestTurnStatus:
      displayState.latestDisplayedTurn?.status ??
      dataState.liveThreadDetail?.status ??
      dataState.selectedThread?.status,
    lastTimelineEventTs: statusState.lastTimelineEventTs,
    loadedAssistantMessageCount: displayState.loadedAssistantMessageCount,
    contextUsagePercent: displayState.contextUsage.percent,
    contextWindow: displayState.contextUsage.contextWindow,
    cumulativeTokens: cumulativeBreakdown?.totalTokens ?? 0,
    loadedMessageCount: displayState.loadedMessageCount,
    loadedTurnCount: displayState.turnCount,
    loadedUserMessageCount: displayState.loadedUserMessageCount,
    liveThreadCwd: dataState.liveThreadDetail?.cwd,
    pendingApprovalsCount: dataState.approvalsQuery.data?.length ?? 0,
    rootPath: dataState.workspaceQuery.data?.rootPath,
    runtimeRecoverySummary: buildWorkspaceRuntimeRecoverySummary(
      dataState.workspaceRuntimeStateQuery.data,
    ),
    runtimeRecoveryExecutionNotice: controllerState.runtimeRecoveryExecutionNotice,
    runtimeConfigChangedAt:
      dataState.workspaceRuntimeStateQuery.data?.runtimeConfigChangedAt ?? undefined,
    runtimeConfigLoadStatus:
      dataState.workspaceRuntimeStateQuery.data?.configLoadStatus ?? 'not-tracked',
    runtimeRestartRequired:
      dataState.workspaceRuntimeStateQuery.data?.restartRequired ?? false,
    hookConfiguration: dataState.hookConfigurationQuery.data ?? null,
    hookConfigurationError: dataState.hookConfigurationQuery.error
      ? getErrorMessage(dataState.hookConfigurationQuery.error)
      : null,
    hookConfigurationLoading: dataState.hookConfigurationQuery.isLoading,
    runtimeStartedAt: dataState.workspaceRuntimeStateQuery.data?.startedAt ?? undefined,
    runtimeUpdatedAt:
      dataState.workspaceRuntimeStateQuery.data?.updatedAt ??
      dataState.workspaceQuery.data?.updatedAt ??
      '',
    restartRuntimePending: mutationState.restartRuntimeMutation.isPending,
    selectedThread: dataState.selectedThread,
    shellEnvironmentInfo: dataState.shellEnvironmentDiagnosis.info,
    shellEnvironmentSummary: dataState.shellEnvironmentDiagnosis.summary,
    shellEnvironmentWarning: dataState.shellEnvironmentDiagnosis.warning,
    startCommandModeDisabled:
      controllerState.commandRunMode === 'thread-shell' && !activeSelectedThreadId,
    startCommandPending:
      mutationState.startCommandMutation.isPending ||
      mutationState.threadShellCommandMutation.isPending ||
      (controllerState.isRestartAndRetryPending &&
        Boolean(controllerState.recoverableCommandOperation)),
    streamState: controllerState.streamState,
    hookRuns: dataState.hookRunsQuery.data ?? [],
    hookRunsError: dataState.hookRunsQuery.error
      ? getErrorMessage(dataState.hookRunsQuery.error)
      : null,
    hookRunsLoading: dataState.hookRunsQuery.isLoading,
    turnPolicyDecisions: dataState.turnPolicyDecisionsQuery.data ?? [],
    turnPolicyDecisionsError: dataState.turnPolicyDecisionsQuery.error
      ? getErrorMessage(dataState.turnPolicyDecisionsQuery.error)
      : null,
    turnPolicyDecisionsLoading: dataState.turnPolicyDecisionsQuery.isLoading,
    turnPolicyMetrics: dataState.turnPolicyMetricsQuery.data ?? null,
    turnPolicyMetricsError: dataState.turnPolicyMetricsQuery.error
      ? getErrorMessage(dataState.turnPolicyMetricsQuery.error)
      : null,
    turnPolicyMetricsLoading: dataState.turnPolicyMetricsQuery.isLoading,
    totalMessageCount,
    totalTokens: displayState.contextUsage.totalTokens,
    totalTurnCount,
    threadCount: dataState.threadsQuery.data?.length ?? 0,
    timelineItemCount: displayState.timelineItemCount,
    turnCount: displayState.turnCount,
    workspaceName: dataState.workspaceQuery.data?.name,
  }
}
