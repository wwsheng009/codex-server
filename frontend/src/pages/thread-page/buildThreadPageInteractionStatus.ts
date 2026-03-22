import { isAuthenticationError } from '../../lib/error-utils'
import { i18n } from '../../i18n/runtime'
import { statusIsInterruptible } from './threadPageComposerShared'
import type { ThreadPageInteractionStatusInput } from './threadPageStatusTypes'

export function buildThreadPageInteractionStatus({
  account,
  accountError,
  activeComposerApproval,
  activeContextCompactionFeedback,
  activePendingTurn,
  hasUnreadThreadUpdates,
  interruptPending,
  isThreadPinnedToLatest,
  latestDisplayedTurn,
  selectedThread,
  selectedThreadId,
  sendError,
  streamState,
}: ThreadPageInteractionStatusInput) {
  const isWaitingForThreadData = Boolean(activePendingTurn)
  const isSendingSelectedThread = activePendingTurn?.phase === 'sending'
  const isApprovalDialogOpen = Boolean(activeComposerApproval)
  const requiresOpenAIAuth =
    account?.status === 'requires_openai_auth' || isAuthenticationError(accountError)

  const isThreadInterruptible = Boolean(
    selectedThreadId &&
      (isWaitingForThreadData ||
        statusIsInterruptible(selectedThread?.status) ||
        statusIsInterruptible(latestDisplayedTurn?.status)),
  )

  const isSendBusy = isWaitingForThreadData
  const isThreadProcessing =
    isWaitingForThreadData || interruptPending || isThreadInterruptible
  const compactDisabledReason = !selectedThreadId
    ? i18n._({
        id: 'Select a thread to compact its context.',
        message: 'Select a thread to compact its context.',
      })
    : activeContextCompactionFeedback?.phase === 'requested'
      ? i18n._({
          id: 'Compaction is already running. This panel will update when the runtime confirms it.',
          message: 'Compaction is already running. This panel will update when the runtime confirms it.',
        })
      : isThreadProcessing
        ? i18n._({
            id: 'Wait until the current reply finishes before compacting this thread.',
            message: 'Wait until the current reply finishes before compacting this thread.',
          })
        : null

  const isInterruptMode = Boolean(
    selectedThreadId &&
      !isApprovalDialogOpen &&
      !isSendingSelectedThread &&
      (interruptPending || isThreadInterruptible),
  )

  const isComposerLocked =
    isApprovalDialogOpen ||
    isWaitingForThreadData ||
    interruptPending ||
    isThreadInterruptible

  const sendButtonLabel = interruptPending
    ? i18n._({
        id: 'Stopping…',
        message: 'Stopping…',
      })
    : isSendingSelectedThread
      ? i18n._({
          id: 'Sending…',
          message: 'Sending…',
        })
      : isInterruptMode
        ? i18n._({
            id: 'Stop',
            message: 'Stop',
          })
        : i18n._({
            id: 'Send',
            message: 'Send',
          })

  const shouldShowComposerSpinner =
    isSendingSelectedThread || interruptPending || isInterruptMode

  const composerActivityTitle = interruptPending
    ? i18n._({
        id: 'Stopping current reply…',
        message: 'Stopping current reply…',
      })
    : isSendingSelectedThread
      ? i18n._({
          id: 'Sending message to Codex…',
          message: 'Sending message to Codex…',
        })
      : isThreadInterruptible
        ? i18n._({
            id: 'Codex is replying…',
            message: 'Codex is replying…',
          })
        : null

  const composerActivityDetail = interruptPending
    ? i18n._({
        id: 'The runtime is stopping the active turn. The thread will settle in place when it completes.',
        message: 'The runtime is stopping the active turn. The thread will settle in place when it completes.',
      })
    : isSendingSelectedThread
      ? i18n._({
          id: 'Your message is staged. The primary action will switch to Stop as soon as the turn is live.',
          message: 'Your message is staged. The primary action will switch to Stop as soon as the turn is live.',
        })
      : isThreadInterruptible
        ? isThreadPinnedToLatest
          ? i18n._({
              id: 'Auto-follow is keeping the latest output in view.',
              message: 'Auto-follow is keeping the latest output in view.',
            })
          : hasUnreadThreadUpdates
            ? i18n._({
                id: 'New output is available below. Jump to latest to follow it.',
                message: 'New output is available below. Jump to latest to follow it.',
              })
            : i18n._({
                id: 'Scroll back to the latest message to resume auto-follow.',
                message: 'Scroll back to the latest message to resume auto-follow.',
              })
        : null

  const mobileStatus = isWaitingForThreadData ? 'running' : selectedThread?.status ?? streamState
  const composerStatusMessage = sendError
  const composerStatusRetryLabel = accountError
    ? i18n._({
        id: 'Refresh status',
        message: 'Refresh status',
      })
    : i18n._({
        id: 'Dismiss error',
        message: 'Dismiss error',
      })

  return {
    compactDisabledReason,
    composerActivityDetail,
    composerActivityTitle,
    composerStatusMessage,
    composerStatusRetryLabel,
    isApprovalDialogOpen,
    isComposerLocked,
    isInterruptMode,
    isSendBusy,
    isSendingSelectedThread,
    isThreadInterruptible,
    isThreadProcessing,
    isWaitingForThreadData,
    mobileStatus,
    requiresOpenAIAuth,
    sendButtonLabel,
    shouldShowComposerSpinner,
  }
}
