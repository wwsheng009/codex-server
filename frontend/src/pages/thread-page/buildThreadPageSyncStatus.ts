import { buildSyncStatusDisplay } from './threadPageComposerShared'
import type { ThreadPageSyncStatusInput } from './threadPageStatusTypes'

export function buildThreadPageSyncStatus({
  activePendingTurn,
  approvalsDataUpdatedAt,
  approvalsIsFetching,
  selectedThreadId,
  streamState,
  syncClock,
  threadDetailDataUpdatedAt,
  threadDetailIsFetching,
  threadsDataUpdatedAt,
  threadsIsFetching,
  workspaceId,
}: ThreadPageSyncStatusInput) {
  const threadDetailPollIntervalMs = selectedThreadId
    ? activePendingTurn
      ? 1_000
      : streamState !== 'open'
        ? 5_000
        : null
    : null
  const approvalsPollIntervalMs = workspaceId && streamState !== 'open' ? 4_000 : null
  const autoSyncIntervalMs = [threadDetailPollIntervalMs, approvalsPollIntervalMs].reduce<
    number | null
  >((current, value) => {
    if (typeof value !== 'number') {
      return current
    }

    return current === null ? value : Math.min(current, value)
  }, null)

  const lastAutoSyncAtMs = Math.max(
    threadsDataUpdatedAt || 0,
    selectedThreadId ? threadDetailDataUpdatedAt || 0 : 0,
    approvalsDataUpdatedAt || 0,
  )
  const isHeaderSyncBusy =
    threadsIsFetching ||
    (Boolean(selectedThreadId) && threadDetailIsFetching) ||
    approvalsIsFetching

  const syncDisplay = buildSyncStatusDisplay({
    autoSyncIntervalMs,
    isHeaderSyncBusy,
    lastAutoSyncAtMs,
    nowMs: syncClock,
    streamState,
  })

  return {
    autoSyncIntervalMs,
    isHeaderSyncBusy,
    syncLabel: syncDisplay.syncLabel,
    syncTitle: syncDisplay.syncTitle,
  }
}
