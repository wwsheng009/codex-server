import type { BuildThreadPageControllerLayoutPropsInput } from './threadPageControllerLayoutTypes'
import type { ControllerComposerLayoutInput } from './threadPageControllerLayoutInputTypes'

type ComposerStateLayoutInput = Pick<
  ControllerComposerLayoutInput,
  | 'accountEmail'
  | 'activeComposerApproval'
  | 'activeComposerPanel'
  | 'activePendingTurn'
  | 'approvalsCount'
  | 'autoPruneDays'
  | 'compactDisabledReason'
  | 'compactFeedback'
  | 'compactPending'
  | 'composerActivityDetail'
  | 'composerActivityTitle'
  | 'composerAutocompleteIndex'
  | 'composerAutocompleteSectionGroups'
  | 'composerDockRef'
  | 'composerDockMeasureRef'
  | 'composerInputRef'
  | 'composerPreferences'
  | 'composerStatusInfo'
  | 'composerStatusMessage'
  | 'composerStatusRetryLabel'
  | 'contextWindow'
  | 'customInstructions'
  | 'desktopModelOptions'
  | 'fileSearchIsFetching'
  | 'hasUnreadThreadUpdates'
  | 'interruptPending'
  | 'isApprovalDialogOpen'
  | 'isCommandAutocompleteOpen'
  | 'isComposerLocked'
  | 'isInterruptMode'
  | 'isMentionAutocompleteOpen'
  | 'isSendBusy'
  | 'isSkillAutocompleteOpen'
  | 'maxWorktrees'
  | 'mcpServerStates'
  | 'mcpServerStatusLoading'
  | 'message'
  | 'mobileCollaborationModeOptions'
  | 'mobileModelOptions'
  | 'mobilePermissionOptions'
  | 'mobileReasoningOptions'
  | 'modelsLoading'
  | 'percent'
  | 'rateLimits'
  | 'rateLimitsError'
  | 'rateLimitsLoading'
  | 'resolvedThreadTokenUsage'
  | 'responseTone'
  | 'reuseBranches'
  | 'runtimeStatus'
  | 'sendButtonLabel'
  | 'shouldShowComposerSpinner'
  | 'showJumpToLatestButton'
  | 'showMentionSearchHint'
  | 'showSkillSearchLoading'
  | 'totalTokens'
>

export function buildThreadPageControllerComposerStateLayoutInput({
  controllerState,
  dataState,
  displayState,
  mutationState,
  panelState,
  statusState,
  viewportState,
}: BuildThreadPageControllerLayoutPropsInput): ComposerStateLayoutInput {
  return {
    accountEmail: dataState.accountQuery.data?.email,
    activeComposerApproval: displayState.activeComposerApproval,
    activeComposerPanel: controllerState.activeComposerPanel,
    activePendingTurn: statusState.activePendingTurn,
    approvalsCount: dataState.approvalsQuery.data?.length ?? 0,
    autoPruneDays: controllerState.autoPruneDays,
    compactDisabledReason: statusState.compactDisabledReason,
    compactFeedback: displayState.activeContextCompactionFeedback,
    compactPending: mutationState.compactThreadMutation.isPending,
    composerActivityDetail: statusState.composerActivityDetail,
    composerActivityTitle: statusState.composerActivityTitle,
    composerAutocompleteIndex: controllerState.composerAutocompleteIndex,
    composerAutocompleteSectionGroups: panelState.composerAutocompleteSectionGroups,
    composerDockRef: viewportState.composerDockRef,
    composerDockMeasureRef: viewportState.composerDockMeasureRef,
    composerInputRef: controllerState.composerInputRef,
    composerPreferences: controllerState.composerPreferences,
    composerStatusInfo: statusState.composerStatusInfo,
    composerStatusMessage: statusState.composerStatusMessage,
    composerStatusRetryLabel: statusState.composerStatusRetryLabel,
    contextWindow: displayState.contextUsage.contextWindow,
    customInstructions: controllerState.customInstructions,
    desktopModelOptions: panelState.desktopModelOptions,
    fileSearchIsFetching: dataState.fileSearchQuery.isFetching,
    hasUnreadThreadUpdates: viewportState.hasUnreadThreadUpdates,
    interruptPending: mutationState.interruptTurnMutation.isPending,
    isApprovalDialogOpen: statusState.isApprovalDialogOpen,
    isCommandAutocompleteOpen: controllerState.isCommandAutocompleteOpen,
    isComposerLocked: statusState.isComposerLocked,
    isInterruptMode: statusState.isInterruptMode,
    isMentionAutocompleteOpen: controllerState.isMentionAutocompleteOpen,
    isSendBusy: statusState.isSendBusy,
    isSkillAutocompleteOpen: controllerState.isSkillAutocompleteOpen,
    maxWorktrees: controllerState.maxWorktrees,
    mcpServerStates: panelState.mcpServerStates,
    mcpServerStatusLoading: dataState.mcpServerStatusQuery.isLoading,
    message: controllerState.message,
    mobileCollaborationModeOptions: panelState.mobileCollaborationModeOptions,
    mobileModelOptions: panelState.mobileModelOptions,
    mobilePermissionOptions: panelState.mobilePermissionOptions,
    mobileReasoningOptions: panelState.mobileReasoningOptions,
    modelsLoading: dataState.modelsQuery.isLoading,
    percent: displayState.contextUsage.percent,
    rateLimits: dataState.rateLimitsQuery.data,
    rateLimitsError: dataState.rateLimitsQuery.error,
    rateLimitsLoading: dataState.rateLimitsQuery.isLoading,
    resolvedThreadTokenUsage: displayState.resolvedThreadTokenUsage,
    responseTone: controllerState.responseTone,
    reuseBranches: controllerState.reuseBranches,
    runtimeStatus: dataState.workspaceQuery.data?.runtimeStatus ?? 'unknown',
    sendButtonLabel: statusState.sendButtonLabel,
    shouldShowComposerSpinner: statusState.shouldShowComposerSpinner,
    showJumpToLatestButton: statusState.showJumpToLatestButton,
    showMentionSearchHint: panelState.showMentionSearchHint,
    showSkillSearchLoading: panelState.showSkillSearchLoading,
    totalTokens: displayState.contextUsage.totalTokens,
  }
}
