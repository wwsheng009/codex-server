import { useEffect, useRef } from 'react'

import { i18n } from '../../i18n/runtime'
import {
  shouldRefreshApprovalsForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from '../threadPageUtils'
import type { ThreadPageRefreshEffectsInput } from './threadPageEffectTypes'

export function useThreadPageRefreshEffects({
  contextCompactionFeedback,
  isDocumentVisible,
  isThreadPinnedToLatest,
  isThreadViewportInteracting,
  queryClient,
  selectedThreadEvents,
  selectedThreadId,
  setContextCompactionFeedback,
  threadListRefreshTimerRef,
  threadDetailRefreshTimerRef,
  workspaceActivityEvents,
  workspaceId,
}: ThreadPageRefreshEffectsInput) {
  const wasDocumentVisibleRef = useRef(isDocumentVisible)
  const lastProcessedThreadEventKeyRef = useRef('')
  const lastProcessedWorkspaceActivityEventKeyRef = useRef('')

  useEffect(() => {
    lastProcessedThreadEventKeyRef.current = ''
  }, [selectedThreadId])

  useEffect(() => {
    lastProcessedWorkspaceActivityEventKeyRef.current = ''
  }, [workspaceId])

  function scheduleThreadListRefresh(delayMs = 120) {
    if (threadListRefreshTimerRef.current) {
      window.clearTimeout(threadListRefreshTimerRef.current)
    }

    threadListRefreshTimerRef.current = window.setTimeout(() => {
      threadListRefreshTimerRef.current = null
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    }, delayMs)
  }

  function scheduleThreadDetailRefresh(delayMs = 120) {
    if (!isThreadPinnedToLatest || isThreadViewportInteracting) {
      return
    }

    if (threadDetailRefreshTimerRef.current) {
      window.clearTimeout(threadDetailRefreshTimerRef.current)
    }

    threadDetailRefreshTimerRef.current = window.setTimeout(() => {
      threadDetailRefreshTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: ['thread-detail', workspaceId, selectedThreadId],
      })
    }, delayMs)
  }

  useEffect(() => {
    const becameVisible = !wasDocumentVisibleRef.current && isDocumentVisible
    wasDocumentVisibleRef.current = isDocumentVisible

    if (!becameVisible || !workspaceId) {
      return
    }

    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
      selectedThreadId
        ? queryClient.invalidateQueries({
            queryKey: ['thread-detail', workspaceId, selectedThreadId],
          })
        : Promise.resolve(),
    ])
  }, [isDocumentVisible, queryClient, selectedThreadId, workspaceId])

  useEffect(() => {
    if (!selectedThreadId || !selectedThreadEvents.length) {
      return
    }

    const latestEvent = selectedThreadEvents[selectedThreadEvents.length - 1]
    const latestEventKey = `${selectedThreadId}:${selectedThreadEvents.length}:${latestEvent.ts}:${latestEvent.method}`
    if (lastProcessedThreadEventKeyRef.current === latestEventKey) {
      return
    }

    lastProcessedThreadEventKeyRef.current = latestEventKey

    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      scheduleThreadListRefresh()
    }

    if (!shouldRefreshThreadDetailForEvent(latestEvent.method)) {
      return
    }

    if (!isThreadPinnedToLatest || isThreadViewportInteracting) {
      return
    }

    if (shouldThrottleThreadDetailRefreshForEvent(latestEvent.method)) {
      scheduleThreadDetailRefresh(360)
      return
    }

    scheduleThreadDetailRefresh(80)
  }, [
    queryClient,
    isThreadPinnedToLatest,
    isThreadViewportInteracting,
    selectedThreadEvents,
    selectedThreadId,
    threadListRefreshTimerRef,
    threadDetailRefreshTimerRef,
    workspaceId,
  ])

  useEffect(() => {
    if (
      !selectedThreadId ||
      !contextCompactionFeedback ||
      contextCompactionFeedback.threadId !== selectedThreadId ||
      contextCompactionFeedback.phase !== 'requested' ||
      !selectedThreadEvents.length
    ) {
      return
    }

    const latestEvent = selectedThreadEvents[selectedThreadEvents.length - 1]
    if (latestEvent.method !== 'thread/compacted') {
      return
    }

    setContextCompactionFeedback({
      threadId: selectedThreadId,
      phase: 'completed',
      title: i18n._({
        id: 'Compacted',
        message: 'Compacted',
      }),
    })
  }, [contextCompactionFeedback, selectedThreadEvents, selectedThreadId, setContextCompactionFeedback])

  useEffect(() => {
    if (!workspaceActivityEvents.length) {
      return
    }

    const latestEvent = workspaceActivityEvents[workspaceActivityEvents.length - 1]
    const latestEventKey = `${workspaceId}:${workspaceActivityEvents.length}:${latestEvent.serverRequestId ?? ''}:${latestEvent.method}`
    if (lastProcessedWorkspaceActivityEventKeyRef.current === latestEventKey) {
      return
    }

    lastProcessedWorkspaceActivityEventKeyRef.current = latestEventKey

    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      scheduleThreadListRefresh()
    }

    if (shouldRefreshApprovalsForEvent(latestEvent.method, latestEvent.serverRequestId)) {
      void queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    }
  }, [queryClient, threadListRefreshTimerRef, workspaceActivityEvents, workspaceId])

  useEffect(
    () => () => {
      if (threadListRefreshTimerRef.current) {
        window.clearTimeout(threadListRefreshTimerRef.current)
      }
      if (threadDetailRefreshTimerRef.current) {
        window.clearTimeout(threadDetailRefreshTimerRef.current)
      }
    },
    [threadDetailRefreshTimerRef, threadListRefreshTimerRef],
  )
}
