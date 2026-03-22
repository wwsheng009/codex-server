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
  queryClient,
  selectedThreadEvents,
  selectedThreadId,
  setContextCompactionFeedback,
  threadDetailRefreshTimerRef,
  workspaceActivityEvents,
  workspaceId,
}: ThreadPageRefreshEffectsInput) {
  const wasDocumentVisibleRef = useRef(isDocumentVisible)

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
    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    }

    if (!shouldRefreshThreadDetailForEvent(latestEvent.method)) {
      return
    }

    const runRefresh = () => {
      threadDetailRefreshTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: ['thread-detail', workspaceId, selectedThreadId],
      })
    }

    if (threadDetailRefreshTimerRef.current) {
      window.clearTimeout(threadDetailRefreshTimerRef.current)
      threadDetailRefreshTimerRef.current = null
    }

    if (shouldThrottleThreadDetailRefreshForEvent(latestEvent.method)) {
      return
    }

    runRefresh()
  }, [
    queryClient,
    selectedThreadEvents,
    selectedThreadId,
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

    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
    }

    if (shouldRefreshApprovalsForEvent(latestEvent.method, latestEvent.serverRequestId)) {
      void queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    }
  }, [queryClient, workspaceActivityEvents, workspaceId])

  useEffect(
    () => () => {
      if (threadDetailRefreshTimerRef.current) {
        window.clearTimeout(threadDetailRefreshTimerRef.current)
      }
    },
    [threadDetailRefreshTimerRef],
  )
}
