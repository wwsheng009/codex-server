import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerRailLayoutInput } from './threadPageControllerLayoutInputTypes'

type RailStateLayoutInput = Pick<
  ControllerRailLayoutInput,
  | 'command'
  | 'commandRunMode'
  | 'commandCount'
  | 'confirmDialogError'
  | 'confirmingThreadDelete'
  | 'deletePending'
  | 'deletingThreadId'
  | 'editingThreadId'
  | 'editingThreadName'
  | 'isExpanded'
  | 'isResizing'
  | 'isThreadToolsExpanded'
  | 'isWorkbenchToolsExpanded'
  | 'latestTurnStatus'
  | 'lastTimelineEventTs'
  | 'loadedAssistantMessageCount'
  | 'loadedMessageCount'
  | 'loadedTurnCount'
  | 'liveThreadCwd'
  | 'pendingApprovalsCount'
  | 'rootPath'
  | 'runtimeConfigChangedAt'
  | 'runtimeConfigLoadStatus'
  | 'runtimeRestartRequired'
  | 'runtimeStartedAt'
  | 'runtimeUpdatedAt'
  | 'contextUsagePercent'
  | 'contextWindow'
  | 'loadedUserMessageCount'
  | 'selectedThread'
  | 'shellEnvironmentInfo'
  | 'shellEnvironmentSummary'
  | 'shellEnvironmentWarning'
  | 'startCommandModeDisabled'
  | 'startCommandPending'
  | 'streamState'
  | 'totalMessageCount'
  | 'totalTokens'
  | 'totalTurnCount'
  | 'threadCount'
  | 'timelineItemCount'
  | 'turnCount'
  | 'workspaceName'
>

export function buildThreadPageControllerRailStateLayoutInput({
  controllerState,
  dataState,
  displayState,
  mutationState,
  railState,
  statusState,
}: BuildThreadPageControllerLayoutPropsInput): RailStateLayoutInput {
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

  return {
    command: controllerState.command,
    commandRunMode: controllerState.commandRunMode,
    commandCount: dataState.commandSessions.length,
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
    latestTurnStatus: displayState.latestDisplayedTurn?.status ?? dataState.selectedThread?.status,
    lastTimelineEventTs: statusState.lastTimelineEventTs,
    loadedAssistantMessageCount: displayState.loadedAssistantMessageCount,
    contextUsagePercent: displayState.contextUsage.percent,
    contextWindow: displayState.contextUsage.contextWindow,
    loadedMessageCount: displayState.loadedMessageCount,
    loadedTurnCount: displayState.turnCount,
    loadedUserMessageCount: displayState.loadedUserMessageCount,
    liveThreadCwd: dataState.liveThreadDetail?.cwd,
    pendingApprovalsCount: dataState.approvalsQuery.data?.length ?? 0,
    rootPath: dataState.workspaceQuery.data?.rootPath,
    runtimeConfigChangedAt:
      dataState.workspaceRuntimeStateQuery.data?.runtimeConfigChangedAt ?? undefined,
    runtimeConfigLoadStatus:
      dataState.workspaceRuntimeStateQuery.data?.configLoadStatus ?? 'not-tracked',
    runtimeRestartRequired:
      dataState.workspaceRuntimeStateQuery.data?.restartRequired ?? false,
    runtimeStartedAt: dataState.workspaceRuntimeStateQuery.data?.startedAt ?? undefined,
    runtimeUpdatedAt:
      dataState.workspaceRuntimeStateQuery.data?.updatedAt ??
      dataState.workspaceQuery.data?.updatedAt ??
      '',
    selectedThread: dataState.selectedThread,
    shellEnvironmentInfo: dataState.shellEnvironmentDiagnosis.info,
    shellEnvironmentSummary: dataState.shellEnvironmentDiagnosis.summary,
    shellEnvironmentWarning: dataState.shellEnvironmentDiagnosis.warning,
    startCommandModeDisabled:
      controllerState.commandRunMode === 'thread-shell' && !activeSelectedThreadId,
    startCommandPending:
      mutationState.startCommandMutation.isPending ||
      mutationState.threadShellCommandMutation.isPending,
    streamState: controllerState.streamState,
    totalMessageCount,
    totalTokens: displayState.contextUsage.totalTokens,
    totalTurnCount,
    threadCount: dataState.threadsQuery.data?.length ?? 0,
    timelineItemCount: displayState.timelineItemCount,
    turnCount: displayState.turnCount,
    workspaceName: dataState.workspaceQuery.data?.name,
  }
}
