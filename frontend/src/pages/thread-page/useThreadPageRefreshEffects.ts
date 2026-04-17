import { useEffect, useRef } from 'react'

import {
  recordConversationLiveDiagnosticEvent,
  updateConversationLiveDiagnosticsStatus,
} from '../../components/workspace/threadConversationProfiler'
import { syncAccountQueriesFromEvent } from '../../features/account/realtime'
import { i18n } from '../../i18n/runtime'
import {
  completedAgentMessageRefreshDelayMs,
  shouldFallbackRefreshThreadDetailDuringOpenStream,
  shouldRefreshHookRunsForEvent,
  shouldRefreshTurnPolicyGovernanceForEvent,
  shouldRefreshMcpServerStatusForEvent,
  shouldRefreshLoadedThreadsForEvent,
  shouldRefreshRuntimeCatalogForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from '../threadPageUtils'
import type {
  ThreadPageQueryRefreshRequest,
  ThreadPageRefreshEffectsInput,
} from './threadPageEffectTypes'

function asObject(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export function useThreadPageRefreshEffects({
  activePendingTurn,
  contextCompactionFeedback,
  isDocumentVisible,
  isThreadViewportInteracting,
  queryClient,
  selectedThreadEvents,
  selectedThreadId,
  setContextCompactionFeedback,
  streamState,
  threadListRefreshTimerRef,
  threadDetailRefreshTimerRef,
  workspaceActivityEvents,
  workspaceId,
}: ThreadPageRefreshEffectsInput) {
  const wasDocumentVisibleRef = useRef(isDocumentVisible)
  const previousStreamStateRef = useRef(streamState)
  const lastProcessedThreadEventKeyRef = useRef('')
  const lastProcessedWorkspaceActivityEventKeyRef = useRef('')
  const lastLiveThreadEventAtRef = useRef<number | null>(null)
  const mcpServerStatusRefreshTimerRef = useRef<number | null>(null)
  const pendingThreadListRefreshRef = useRef(false)
  const runtimeCatalogRefreshTimerRef = useRef<number | null>(null)
  const pendingLoadedThreadRefreshRef = useRef(false)

  useEffect(() => {
    lastProcessedThreadEventKeyRef.current = ''
    lastLiveThreadEventAtRef.current = null
    updateConversationLiveDiagnosticsStatus({
      lastThreadDetailRefreshAt: null,
      selectedThreadId: selectedThreadId ?? null,
    })
  }, [selectedThreadId])

  useEffect(() => {
    lastProcessedWorkspaceActivityEventKeyRef.current = ''
  }, [workspaceId])

  function scheduleThreadQueryRefresh(options: ThreadPageQueryRefreshRequest) {
    const { delayMs = 120, loadedThreads = false, threads = false } = options
    pendingThreadListRefreshRef.current = pendingThreadListRefreshRef.current || threads
    pendingLoadedThreadRefreshRef.current =
      pendingLoadedThreadRefreshRef.current || loadedThreads

    if (threadListRefreshTimerRef.current) {
      window.clearTimeout(threadListRefreshTimerRef.current)
    }

    threadListRefreshTimerRef.current = window.setTimeout(() => {
      threadListRefreshTimerRef.current = null
      const refreshThreads = pendingThreadListRefreshRef.current
      const refreshLoadedThreads = pendingLoadedThreadRefreshRef.current
      pendingThreadListRefreshRef.current = false
      pendingLoadedThreadRefreshRef.current = false

      void Promise.all([
        refreshThreads
          ? queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] })
          : Promise.resolve(),
        refreshLoadedThreads
          ? queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] })
          : Promise.resolve(),
      ])
    }, delayMs)
  }

  function scheduleThreadDetailRefresh(delayMs = 120) {
    if (isThreadViewportInteracting) {
      return
    }

    recordConversationLiveDiagnosticEvent({
      kind: 'thread-detail-refresh-requested',
      metadata: {
        delayMs,
        isDocumentVisible,
        streamState,
        viewportInteracting: isThreadViewportInteracting,
      },
      reason: 'scheduled thread detail refresh',
      source: 'thread-page-refresh',
      threadId: selectedThreadId ?? null,
    })
    updateConversationLiveDiagnosticsStatus({
      lastThreadDetailRefreshAt: Date.now(),
      selectedThreadId: selectedThreadId ?? null,
    })

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

  function scheduleMcpServerStatusRefresh(delayMs = 180) {
    if (mcpServerStatusRefreshTimerRef.current) {
      window.clearTimeout(mcpServerStatusRefreshTimerRef.current)
    }

    mcpServerStatusRefreshTimerRef.current = window.setTimeout(() => {
      mcpServerStatusRefreshTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: ['mcp-server-status', workspaceId],
      })
    }, delayMs)
  }

  function scheduleRuntimeCatalogRefresh(delayMs = 220) {
    if (runtimeCatalogRefreshTimerRef.current) {
      window.clearTimeout(runtimeCatalogRefreshTimerRef.current)
    }

    runtimeCatalogRefreshTimerRef.current = window.setTimeout(() => {
      runtimeCatalogRefreshTimerRef.current = null
      void queryClient.invalidateQueries({
        queryKey: ['runtime-catalog', workspaceId],
      })
    }, delayMs)
  }

  function shouldReconcileThreadDetailWithSnapshot(event: { method?: string; payload?: unknown }) {
    const method = event.method
    if (typeof method !== 'string') {
      return false
    }

    if (streamState !== 'open') {
      return true
    }

    if (
      [
        'thread/compacted',
        'thread/closed',
        'item/commandExecution/outputDelta',
        'item/fileChange/outputDelta',
        'turn/diff/updated',
      ].includes(method)
    ) {
      return true
    }

    if (method !== 'item/started' && method !== 'item/completed') {
      return false
    }

    const payload = asObject(event.payload)
    const item = asObject(payload.item)
    return ['commandExecution', 'fileChange'].includes(stringField(item.type))
  }

  useEffect(() => {
    if (!selectedThreadId || !selectedThreadEvents.length) {
      return
    }

    lastLiveThreadEventAtRef.current = Date.now()
  }, [selectedThreadEvents, selectedThreadId])

  useEffect(() => {
    if (
      !selectedThreadId ||
      !activePendingTurn ||
      !isDocumentVisible ||
      isThreadViewportInteracting
    ) {
      return
    }

    const intervalMs = streamState === 'open' ? 2_000 : 1_000
    const intervalId = window.setInterval(() => {
      if (
        streamState === 'open' &&
        !shouldFallbackRefreshThreadDetailDuringOpenStream(
          lastLiveThreadEventAtRef.current,
          Date.now(),
        )
      ) {
        return
      }

      recordConversationLiveDiagnosticEvent({
        kind: 'thread-detail-refresh-requested',
        metadata: {
          intervalMs,
          isDocumentVisible,
          streamState,
          viewportInteracting: isThreadViewportInteracting,
        },
        reason:
          streamState === 'open'
            ? 'interval fallback thread detail refresh during open stream'
            : 'interval thread detail refresh',
        source: 'thread-page-refresh',
        threadId: selectedThreadId ?? null,
      })
      updateConversationLiveDiagnosticsStatus({
        lastThreadDetailRefreshAt: Date.now(),
        selectedThreadId: selectedThreadId ?? null,
      })
      void queryClient.invalidateQueries({
        queryKey: ['thread-detail', workspaceId, selectedThreadId],
      })
    }, intervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [
    activePendingTurn,
    isDocumentVisible,
    isThreadViewportInteracting,
    queryClient,
    selectedThreadId,
    streamState,
    workspaceId,
  ])

  useEffect(() => {
    const becameVisible = !wasDocumentVisibleRef.current && isDocumentVisible
    wasDocumentVisibleRef.current = isDocumentVisible

    if (!becameVisible || !workspaceId) {
      return
    }

    if (streamState === 'open') {
      return
    }

    if (selectedThreadId) {
      recordConversationLiveDiagnosticEvent({
        kind: 'thread-detail-refresh-requested',
        metadata: {
          isDocumentVisible,
          streamState,
          triggeredByVisibility: true,
        },
        reason: 'document became visible; refreshing thread detail',
        source: 'thread-page-refresh',
        threadId: selectedThreadId,
      })
      updateConversationLiveDiagnosticsStatus({
        lastThreadDetailRefreshAt: Date.now(),
        selectedThreadId,
      })
    }

    void Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['workspace-hook-configuration', workspaceId],
      }),
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['command-sessions', workspaceId] }),
      selectedThreadId
        ? queryClient.invalidateQueries({
            queryKey: ['hook-runs', workspaceId, selectedThreadId],
          })
        : Promise.resolve(),
      selectedThreadId
        ? queryClient.invalidateQueries({
            queryKey: ['turn-policy-decisions', workspaceId, selectedThreadId],
          })
        : Promise.resolve(),
      selectedThreadId
        ? queryClient.invalidateQueries({
            queryKey: ['turn-policy-metrics', workspaceId, selectedThreadId],
          })
        : Promise.resolve(),
      selectedThreadId
        ? queryClient.invalidateQueries({
            queryKey: ['thread-detail', workspaceId, selectedThreadId],
          })
        : Promise.resolve(),
    ])
  }, [isDocumentVisible, queryClient, selectedThreadId, streamState, workspaceId])

  useEffect(() => {
    const previousStreamState = previousStreamStateRef.current
    previousStreamStateRef.current = streamState

    if (!workspaceId || !isDocumentVisible) {
      return
    }

    if (streamState === 'open' && previousStreamState !== 'open') {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['loaded-threads', workspaceId] }),
      ])
      return
    }

    if (
      previousStreamState === 'open' &&
      streamState !== 'open' &&
      selectedThreadId &&
      !isThreadViewportInteracting
    ) {
      recordConversationLiveDiagnosticEvent({
        kind: 'thread-detail-refresh-requested',
        metadata: {
          previousStreamState,
          streamState,
          triggeredByStreamClose: true,
          viewportInteracting: isThreadViewportInteracting,
        },
        reason: 'stream closed after realtime updates; refreshing thread detail to settle terminal state',
        source: 'thread-page-refresh',
        threadId: selectedThreadId,
      })
      updateConversationLiveDiagnosticsStatus({
        lastThreadDetailRefreshAt: Date.now(),
        selectedThreadId,
      })

      void queryClient.invalidateQueries({
        queryKey: ['thread-detail', workspaceId, selectedThreadId],
      })
    }
  }, [
    isDocumentVisible,
    isThreadViewportInteracting,
    queryClient,
    selectedThreadId,
    streamState,
    workspaceId,
  ])

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

    if (selectedThreadId && shouldRefreshHookRunsForEvent(latestEvent.method)) {
      void queryClient.invalidateQueries({
        queryKey: ['hook-runs', workspaceId, selectedThreadId],
      })
    }

    if (selectedThreadId && shouldRefreshTurnPolicyGovernanceForEvent(latestEvent.method)) {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['turn-policy-decisions', workspaceId, selectedThreadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['turn-policy-metrics', workspaceId, selectedThreadId],
        }),
      ])
    }

    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      scheduleThreadQueryRefresh({ threads: true })
    }

    if (shouldRefreshLoadedThreadsForEvent(latestEvent.method)) {
      scheduleThreadQueryRefresh({ loadedThreads: true })
    }

    if (!shouldRefreshThreadDetailForEvent(latestEvent.method)) {
      return
    }

    if (isThreadViewportInteracting) {
      return
    }

    if (!shouldReconcileThreadDetailWithSnapshot(latestEvent)) {
      return
    }

    const completedAgentRefreshDelay = completedAgentMessageRefreshDelayMs(latestEvent)
    if (completedAgentRefreshDelay !== null) {
      scheduleThreadDetailRefresh(completedAgentRefreshDelay)
      return
    }

    if (shouldThrottleThreadDetailRefreshForEvent(latestEvent.method)) {
      scheduleThreadDetailRefresh(360)
      return
    }

    scheduleThreadDetailRefresh(80)
  }, [
    activePendingTurn,
    queryClient,
    isThreadViewportInteracting,
    selectedThreadEvents,
    selectedThreadId,
    streamState,
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
      scheduleThreadQueryRefresh({ threads: true })
    }

    if (shouldRefreshLoadedThreadsForEvent(latestEvent.method)) {
      scheduleThreadQueryRefresh({ loadedThreads: true })
    }

    void syncAccountQueriesFromEvent(queryClient, workspaceId, latestEvent)

    if (
      selectedThreadId &&
      latestEvent.threadId === selectedThreadId &&
      shouldRefreshHookRunsForEvent(latestEvent.method)
    ) {
      void queryClient.invalidateQueries({
        queryKey: ['hook-runs', workspaceId, selectedThreadId],
      })
    }

    if (
      selectedThreadId &&
      latestEvent.threadId === selectedThreadId &&
      shouldRefreshTurnPolicyGovernanceForEvent(latestEvent.method)
    ) {
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['turn-policy-decisions', workspaceId, selectedThreadId],
        }),
        queryClient.invalidateQueries({
          queryKey: ['turn-policy-metrics', workspaceId, selectedThreadId],
        }),
      ])
    }

    if (shouldRefreshMcpServerStatusForEvent(latestEvent.method)) {
      scheduleMcpServerStatusRefresh()
    }

    if (shouldRefreshRuntimeCatalogForEvent(latestEvent.method)) {
      scheduleRuntimeCatalogRefresh()
    }
  }, [queryClient, selectedThreadId, threadListRefreshTimerRef, workspaceActivityEvents, workspaceId])

  useEffect(
    () => () => {
      if (mcpServerStatusRefreshTimerRef.current) {
        window.clearTimeout(mcpServerStatusRefreshTimerRef.current)
      }
      if (runtimeCatalogRefreshTimerRef.current) {
        window.clearTimeout(runtimeCatalogRefreshTimerRef.current)
      }
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
