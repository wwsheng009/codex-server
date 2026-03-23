import { buildLiveTimelineEntries } from '../../components/workspace/timeline-utils'
import { computeContextUsage } from '../../lib/thread-token-usage'
import type { ThreadPageSelectionDisplayStateInput } from './threadPageDisplayTypes'

const EMPTY_LIVE_TIMELINE_ENTRIES: ReturnType<typeof buildLiveTimelineEntries> = []

export function buildThreadPageSelectionDisplayState({
  approvals,
  contextCompactionFeedback,
  liveThreadDetail,
  loadedThreadIds,
  selectedCommandSession,
  selectedThreadEvents,
  selectedThreadId,
  selectedThreadTokenUsage,
  surfacePanelView,
  workspaceEvents,
}: ThreadPageSelectionDisplayStateInput) {
  const liveTimelineEntries =
    surfacePanelView === 'feed'
      ? buildLiveTimelineEntries(mergeEventsByTimestamp(workspaceEvents, selectedThreadEvents))
      : EMPTY_LIVE_TIMELINE_ENTRIES

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

function mergeEventsByTimestamp(
  workspaceEvents: ThreadPageSelectionDisplayStateInput['workspaceEvents'],
  selectedThreadEvents: ThreadPageSelectionDisplayStateInput['selectedThreadEvents'],
) {
  if (!workspaceEvents.length) {
    return selectedThreadEvents
  }

  if (!selectedThreadEvents.length) {
    return workspaceEvents
  }

  const merged = new Array(workspaceEvents.length + selectedThreadEvents.length)
  let workspaceIndex = 0
  let threadIndex = 0
  let mergedIndex = 0

  while (workspaceIndex < workspaceEvents.length && threadIndex < selectedThreadEvents.length) {
    const workspaceEvent = workspaceEvents[workspaceIndex]
    const threadEvent = selectedThreadEvents[threadIndex]

    if (Date.parse(workspaceEvent.ts) <= Date.parse(threadEvent.ts)) {
      merged[mergedIndex] = workspaceEvent
      workspaceIndex += 1
    } else {
      merged[mergedIndex] = threadEvent
      threadIndex += 1
    }

    mergedIndex += 1
  }

  while (workspaceIndex < workspaceEvents.length) {
    merged[mergedIndex] = workspaceEvents[workspaceIndex]
    workspaceIndex += 1
    mergedIndex += 1
  }

  while (threadIndex < selectedThreadEvents.length) {
    merged[mergedIndex] = selectedThreadEvents[threadIndex]
    threadIndex += 1
    mergedIndex += 1
  }

  return merged
}
