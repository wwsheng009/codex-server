import { buildLiveTimelineEntries } from '../../components/workspace/timeline-utils'
import { computeContextUsage } from '../../lib/thread-token-usage'
import type { ThreadPageSelectionDisplayStateInput } from './threadPageDisplayTypes'

export function buildThreadPageSelectionDisplayState({
  approvals,
  commandSessions,
  contextCompactionFeedback,
  liveThreadDetail,
  loadedThreadIds,
  selectedProcessId,
  selectedThreadEvents,
  selectedThreadId,
  selectedThreadTokenUsage,
  workspaceEvents,
}: ThreadPageSelectionDisplayStateInput) {
  const liveTimelineEntries = buildLiveTimelineEntries(
    [...workspaceEvents, ...selectedThreadEvents].sort(
      (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime(),
    ),
  )

  const selectedCommandSession =
    commandSessions.find((session) => session.id === selectedProcessId) ?? commandSessions[0]

  const resolvedThreadTokenUsage = liveThreadDetail?.tokenUsage ?? selectedThreadTokenUsage
  const contextUsage = computeContextUsage(resolvedThreadTokenUsage)

  const activeContextCompactionFeedback =
    contextCompactionFeedback?.threadId === selectedThreadId ? contextCompactionFeedback : null

  const activeComposerApproval = !approvals.length
    ? null
    : (selectedThreadId
        ? approvals.find((approval) => approval.threadId === selectedThreadId)
        : undefined) ?? approvals[0]

  const isSelectedThreadLoaded =
    !selectedThreadId || !loadedThreadIds ? null : loadedThreadIds.includes(selectedThreadId)

  return {
    activeComposerApproval,
    activeContextCompactionFeedback,
    contextUsage,
    isSelectedThreadLoaded,
    liveTimelineEntries,
    resolvedThreadTokenUsage,
    selectedCommandSession,
  }
}
