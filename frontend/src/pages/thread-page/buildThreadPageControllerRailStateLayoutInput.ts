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
  | 'lastTimelineEventTs'
  | 'liveThreadCwd'
  | 'pendingApprovalsCount'
  | 'rootPath'
  | 'runtimeConfigChangedAt'
  | 'runtimeConfigLoadStatus'
  | 'runtimeRestartRequired'
  | 'runtimeStartedAt'
  | 'runtimeUpdatedAt'
  | 'selectedThread'
  | 'shellEnvironmentInfo'
  | 'shellEnvironmentSummary'
  | 'shellEnvironmentWarning'
  | 'startCommandModeDisabled'
  | 'startCommandPending'
  | 'streamState'
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
    lastTimelineEventTs: statusState.lastTimelineEventTs,
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
    threadCount: dataState.threadsQuery.data?.length ?? 0,
    timelineItemCount: displayState.timelineItemCount,
    turnCount: displayState.turnCount,
    workspaceName: dataState.workspaceQuery.data?.name,
  }
}
