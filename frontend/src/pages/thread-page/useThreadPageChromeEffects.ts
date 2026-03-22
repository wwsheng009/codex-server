import { useEffect } from 'react'

import type { ThreadPageChromeEffectsInput } from './threadPageEffectTypes'

export function useThreadPageChromeEffects({
  autoSyncIntervalMs,
  chromeState,
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
  setSurfacePanelView,
  setSyncClock,
  streamState,
  syncTitle,
}: ThreadPageChromeEffectsInput) {
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
