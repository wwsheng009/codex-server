import { useEffect, useRef } from 'react'

import {
  shouldRefreshApprovalsForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from '../threadPageUtils'
import type { ContextCompactionFeedback } from './threadPageComposerShared'

export function useThreadPageEffects({
  activePendingTurn,
  autoSyncIntervalMs,
  contextCompactionFeedback,
  currentThreads,
  isHeaderSyncBusy,
  isMobileViewport,
  isMobileWorkbenchOverlayOpen,
  isThreadProcessing,
  latestThreadDetailId,
  liveThreadTurns,
  mobileThreadToolsOpen,
  resetMobileThreadChrome,
  selectedThread,
  selectedThreadEvents,
  selectedThreadId,
  setContextCompactionFeedback,
  setIsInspectorExpanded,
  setMobileThreadChrome,
  setMobileThreadToolsOpen,
  setSelectedThread,
  setSelectedWorkspace,
  setSurfacePanelView,
  setSyncClock,
  streamState,
  syncCountdownLabel,
  workspaceActivityEvents,
  workspaceId,
  chromeState,
  queryClient,
  clearPendingTurn,
}: {
  activePendingTurn:
    | {
        turnId?: string
        submittedAt: string
        phase: 'sending' | 'waiting'
      }
    | null
  autoSyncIntervalMs: number | null
  clearPendingTurn: (threadId: string) => void
  contextCompactionFeedback: ContextCompactionFeedback | null
  currentThreads: Array<{ id: string }>
  isHeaderSyncBusy: boolean
  isMobileViewport: boolean
  isMobileWorkbenchOverlayOpen: boolean
  isThreadProcessing: boolean
  latestThreadDetailId?: string
  liveThreadTurns?: Array<{ id: string }>
  mobileThreadToolsOpen: boolean
  queryClient: {
    invalidateQueries: (input: { queryKey: unknown[] }) => Promise<unknown>
  }
  resetMobileThreadChrome: () => void
  selectedThread?: { id: string; name: string }
  selectedThreadEvents: Array<{ method: string; ts: string }>
  selectedThreadId?: string
  setContextCompactionFeedback: (
    value:
      | ContextCompactionFeedback
      | ((current: ContextCompactionFeedback | null) => ContextCompactionFeedback | null),
  ) => void
  setIsInspectorExpanded: (value: boolean) => void
  setMobileThreadChrome: (input: {
    visible: boolean
    title: string
    statusLabel: string
    statusTone: string
    syncLabel: string
    syncTitle: string
    activityVisible: boolean
    activityRunning: boolean
    refreshBusy: boolean
  }) => void
  setMobileThreadToolsOpen: (value: boolean) => void
  setSelectedThread: (workspaceId: string, threadId?: string) => void
  setSelectedWorkspace: (workspaceId: string) => void
  setSurfacePanelView: (value: 'approvals' | 'feed' | null) => void
  setSyncClock: (value: number) => void
  streamState: string
  syncCountdownLabel: string
  workspaceActivityEvents: Array<{ method: string; serverRequestId?: string | null }>
  workspaceId: string
  chromeState: {
    statusLabel: string
    statusTone: string
    syncLabel: string
  }
}) {
  const threadDetailRefreshTimerRef = useRef<number | null>(null)

  useEffect(() => {
    setSelectedWorkspace(workspaceId)
  }, [setSelectedWorkspace, workspaceId])

  useEffect(() => {
    if (!currentThreads.length) {
      return
    }

    if (!selectedThreadId) {
      setSelectedThread(workspaceId, currentThreads[0].id)
      return
    }

    const hasSelectedThread = currentThreads.some((thread) => thread.id === selectedThreadId)
    if (!hasSelectedThread && latestThreadDetailId !== selectedThreadId) {
      setSelectedThread(workspaceId, currentThreads[0].id)
    }
  }, [currentThreads, latestThreadDetailId, selectedThreadId, setSelectedThread, workspaceId])

  useEffect(() => {
    if (!selectedThreadId || !activePendingTurn?.turnId) {
      return
    }

    const turns = liveThreadTurns ?? []
    if (!turns.some((turn) => turn.id === activePendingTurn.turnId)) {
      return
    }

    const submittedAtMs = new Date(activePendingTurn.submittedAt).getTime()
    const elapsedMs = Number.isNaN(submittedAtMs) ? 700 : Date.now() - submittedAtMs
    const remainingMs = Math.max(0, 700 - elapsedMs)

    if (remainingMs === 0) {
      clearPendingTurn(selectedThreadId)
      return
    }

    const timeoutId = window.setTimeout(() => {
      clearPendingTurn(selectedThreadId)
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [activePendingTurn, clearPendingTurn, liveThreadTurns, selectedThreadId])

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
  }, [queryClient, selectedThreadEvents, selectedThreadId, workspaceId])

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
      title: 'Compacted',
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
    [],
  )

  useEffect(() => {
    setMobileThreadChrome({
      visible: Boolean(selectedThread),
      title: selectedThread?.name ?? '',
      statusLabel: chromeState.statusLabel,
      statusTone: chromeState.statusTone,
      syncLabel: chromeState.syncLabel,
      syncTitle: syncCountdownLabel,
      activityVisible: Boolean(selectedThread),
      activityRunning: isThreadProcessing,
      refreshBusy: isHeaderSyncBusy,
    })

    return () => {
      resetMobileThreadChrome()
    }
  }, [
    isHeaderSyncBusy,
    isThreadProcessing,
    resetMobileThreadChrome,
    selectedThread,
    setMobileThreadChrome,
    syncCountdownLabel,
    chromeState.statusLabel,
    chromeState.statusTone,
    chromeState.syncLabel,
  ])

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileThreadToolsOpen(false)
    }
  }, [isMobileViewport, setMobileThreadToolsOpen])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    if (mobileThreadToolsOpen && !isMobileWorkbenchOverlayOpen) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(true)
      return
    }

    if (!mobileThreadToolsOpen && isMobileWorkbenchOverlayOpen) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(false)
    }
  }, [
    isMobileViewport,
    isMobileWorkbenchOverlayOpen,
    mobileThreadToolsOpen,
    setIsInspectorExpanded,
    setSurfacePanelView,
  ])

  useEffect(() => {
    if (streamState === 'open' || !autoSyncIntervalMs || typeof window === 'undefined') {
      return
    }

    setSyncClock(Date.now())
    const intervalId = window.setInterval(() => {
      setSyncClock(Date.now())
    }, 1_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoSyncIntervalMs, setSyncClock, streamState])
}
