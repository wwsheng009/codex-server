import { useMemo } from 'react'

import { buildThreadPageInteractionStatus } from './buildThreadPageInteractionStatus'
import { buildThreadPageSyncStatus } from './buildThreadPageSyncStatus'
import { buildThreadPageWorkbenchStatus } from './buildThreadPageWorkbenchStatus'
import { buildComposerStatusInfo } from './threadPageComposerShared'
import type { ThreadPageStatusStateInput } from './threadPageStatusTypes'

export function useThreadPageStatusState(input: ThreadPageStatusStateInput) {
  const interactionStatus = buildThreadPageInteractionStatus(input)

  const composerStatusInfo = useMemo(
    () =>
      buildComposerStatusInfo({
        streamState: input.streamState,
        rawThreadStatus: input.liveThreadStatus ?? input.selectedThread?.status,
        latestTurnStatus: input.latestDisplayedTurn?.status,
        latestTurnError: input.latestDisplayedTurn?.error,
        sendError: input.sendError,
        requiresOpenAIAuth: interactionStatus.requiresOpenAIAuth,
        isApprovalDialogOpen: interactionStatus.isApprovalDialogOpen,
        approvalSummary: input.activeComposerApproval?.summary,
        isWaitingForThreadData: interactionStatus.isWaitingForThreadData,
        pendingPhase: input.activePendingTurn?.phase,
        isThreadInterruptible: interactionStatus.isThreadInterruptible,
        isThreadLoaded: input.isSelectedThreadLoaded,
      }),
    [
      input.activeComposerApproval?.summary,
      input.activePendingTurn?.phase,
      input.isSelectedThreadLoaded,
      input.latestDisplayedTurn?.error,
      input.latestDisplayedTurn?.status,
      input.liveThreadStatus,
      input.selectedThread?.status,
      input.sendError,
      input.streamState,
      interactionStatus.isApprovalDialogOpen,
      interactionStatus.isThreadInterruptible,
      interactionStatus.isWaitingForThreadData,
      interactionStatus.requiresOpenAIAuth,
    ],
  )
  const syncStatus = buildThreadPageSyncStatus(input)
  const workbenchStatus = buildThreadPageWorkbenchStatus({
    ...input,
    composerStatusInfo,
    mobileStatus: interactionStatus.mobileStatus,
    syncLabel: syncStatus.syncLabel,
  })

  return {
    ...interactionStatus,
    composerStatusInfo,
    ...syncStatus,
    ...workbenchStatus,
  }
}
