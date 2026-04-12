import { useEffect, useRef } from 'react'

import { readTurnPlanItem } from '../../lib/turn-plan'
import type { SurfacePanelView } from '../../lib/layout-config-types'
import type { ThreadTurn } from '../../types/api'
import type { ThreadPageChromeEffectsInput } from './threadPageEffectTypes'

export function latestThreadPlanAutoOpenSignal(turns: ThreadTurn[]) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]
    const turnItems = Array.isArray(turn.items) ? turn.items : []

    for (let itemIndex = turnItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turnItems[itemIndex]
      const turnPlan = readTurnPlanItem(item)
      if (!turnPlan) {
        continue
      }

      const explanationLength = turnPlan.explanation?.length ?? 0
      const totalStepLength = turnPlan.steps.reduce((sum, entry) => sum + entry.step.length, 0)
      if (!explanationLength && !turnPlan.steps.length) {
        continue
      }

      const itemId = typeof item.id === 'string' && item.id ? item.id : `${itemIndex}`
      return `${turn.id}:${itemId}:${turnPlan.status}:${explanationLength}:${turnPlan.steps.length}:${totalStepLength}`
    }
  }

  return null
}

export function shouldAutoOpenThreadPlanPanel({
  lastAutoOpenedPlanSignal,
  previousPlanSignal,
  previousThreadId,
  selectedThreadId,
  surfacePanelView,
  threadPlanSignal,
}: {
  lastAutoOpenedPlanSignal: string | null
  previousPlanSignal: string | null
  previousThreadId: string | null
  selectedThreadId: string | null
  surfacePanelView: SurfacePanelView | null
  threadPlanSignal: string | null
}) {
  if (!selectedThreadId || !threadPlanSignal || surfacePanelView === 'plans') {
    return false
  }

  const threadChanged = previousThreadId !== selectedThreadId
  const planChanged = previousPlanSignal !== threadPlanSignal

  if (!threadChanged && !planChanged) {
    return false
  }

  return lastAutoOpenedPlanSignal !== threadPlanSignal
}

export function useThreadPageChromeEffects({
  autoSyncIntervalMs,
  chromeState,
  displayedTurns,
  isHeaderSyncBusy,
  isMobileViewport,
  isMobileWorkbenchOverlayOpen,
  isThreadProcessing,
  mobileThreadToolsOpen,
  resetMobileThreadChrome,
  selectedThread,
  setIsInspectorExpanded,
  setMobileThreadChrome,
  setMobileThreadToolsOpen,
  surfacePanelView,
  setSurfacePanelView,
  setSyncClock,
  streamState,
  syncTitle,
}: ThreadPageChromeEffectsInput) {
  const lastObservedPlanSignalRef = useRef<string | null>(null)
  const lastAutoOpenedPlanSignalRef = useRef<string | null>(null)
  const lastSelectedThreadIdRef = useRef<string | null>(null)

  useEffect(() => {
    setMobileThreadChrome({
      visible: Boolean(selectedThread),
      title: selectedThread?.name ?? '',
      statusLabel: chromeState.statusLabel,
      statusTone: chromeState.statusTone,
      syncLabel: chromeState.syncLabel,
      syncTitle,
      activityVisible: Boolean(selectedThread),
      activityRunning: isThreadProcessing,
      refreshBusy: isHeaderSyncBusy,
    })

    return () => {
      resetMobileThreadChrome()
    }
  }, [
    chromeState.statusLabel,
    chromeState.statusTone,
    chromeState.syncLabel,
    isHeaderSyncBusy,
    isThreadProcessing,
    resetMobileThreadChrome,
    selectedThread,
    setMobileThreadChrome,
    syncTitle,
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
    const selectedThreadId = selectedThread?.id ?? null
    const threadPlanSignal = latestThreadPlanAutoOpenSignal(displayedTurns)
    const previousThreadId = lastSelectedThreadIdRef.current
    const previousPlanSignal = lastObservedPlanSignalRef.current
    const threadChanged = previousThreadId !== selectedThreadId

    if (threadChanged) {
      lastAutoOpenedPlanSignalRef.current = null
    }

    if (surfacePanelView === 'plans' && threadPlanSignal) {
      lastAutoOpenedPlanSignalRef.current = threadPlanSignal
    } else if (
      shouldAutoOpenThreadPlanPanel({
        lastAutoOpenedPlanSignal: lastAutoOpenedPlanSignalRef.current,
        previousPlanSignal,
        previousThreadId,
        selectedThreadId,
        surfacePanelView,
        threadPlanSignal,
      })
    ) {
      setIsInspectorExpanded(false)
      setSurfacePanelView('plans')
      if (isMobileViewport) {
        setMobileThreadToolsOpen(true)
      }
      lastAutoOpenedPlanSignalRef.current = threadPlanSignal
    }

    lastObservedPlanSignalRef.current = threadPlanSignal
    lastSelectedThreadIdRef.current = selectedThreadId
  }, [
    displayedTurns,
    isMobileViewport,
    selectedThread,
    setIsInspectorExpanded,
    setMobileThreadToolsOpen,
    setSurfacePanelView,
    surfacePanelView,
  ])

  useEffect(() => {
    if (streamState === 'open' || !autoSyncIntervalMs || typeof window === 'undefined') {
      return
    }

    const syncClockIntervalMs = Math.max(4_000, autoSyncIntervalMs)
    setSyncClock(Date.now())
    const intervalId = window.setInterval(() => {
      setSyncClock(Date.now())
    }, syncClockIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [autoSyncIntervalMs, setSyncClock, streamState])
}
