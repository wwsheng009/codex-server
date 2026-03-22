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
}: ThreadPageSyncStatusInput) {
  const threadDetailPollIntervalMs = selectedThreadId
    ? activePendingTurn
      ? 1_000
      : null
    : null
  const autoSyncIntervalMs = threadDetailPollIntervalMs

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
