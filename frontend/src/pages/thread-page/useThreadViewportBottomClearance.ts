import { useLayoutEffect, useRef, useState } from 'react'

const MIN_THREAD_BOTTOM_CLEARANCE_PX = 96
const DEFAULT_THREAD_BOTTOM_CLEARANCE_PX = 180
const THREAD_BOTTOM_CLEARANCE_GAP_PX = 16
const THREAD_BOTTOM_CLEARANCE_UPDATE_THRESHOLD_PX = 8

export function useThreadViewportBottomClearance() {
  const [threadBottomClearancePx, setThreadBottomClearancePx] = useState(
    DEFAULT_THREAD_BOTTOM_CLEARANCE_PX,
  )
  const composerDockRef = useRef<HTMLFormElement | null>(null)
  const composerDockMeasureRef = useRef<HTMLDivElement | null>(null)
  const pendingMeasureFrameRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    let observer: ResizeObserver | null = null
    let observedComposerDock: HTMLDivElement | null = null

    function resolveComposerDockMeasureElement() {
      return (
        composerDockMeasureRef.current ??
        composerDockRef.current?.querySelector<HTMLDivElement>('.composer-dock__shell') ??
        null
      )
    }

    const scheduleThreadBottomClearanceUpdate = () => {
      if (pendingMeasureFrameRef.current !== null) {
        return
      }

      pendingMeasureFrameRef.current = window.setTimeout(() => {
        pendingMeasureFrameRef.current = null
        updateThreadBottomClearance()
      }, 0)
    }

    const attachObserver = (composerDock: HTMLDivElement) => {
      if (typeof ResizeObserver === 'undefined') {
        return
      }

      if (observedComposerDock === composerDock) {
        return
      }

      observer?.disconnect()
      observer = new ResizeObserver(() => {
        scheduleThreadBottomClearanceUpdate()
      })
      observer.observe(composerDock)
      observedComposerDock = composerDock
    }

    const updateThreadBottomClearance = () => {
      const composerDock = resolveComposerDockMeasureElement()
      if (!composerDock) {
        scheduleThreadBottomClearanceUpdate()
        return
      }

      attachObserver(composerDock)

      const nextClearance = Math.max(
        MIN_THREAD_BOTTOM_CLEARANCE_PX,
        Math.ceil(composerDock.getBoundingClientRect().height) + THREAD_BOTTOM_CLEARANCE_GAP_PX,
      )

      setThreadBottomClearancePx((current) =>
        Math.abs(nextClearance - current) < THREAD_BOTTOM_CLEARANCE_UPDATE_THRESHOLD_PX
          ? current
          : nextClearance,
      )
    }

    updateThreadBottomClearance()

    return () => {
      observer?.disconnect()
      if (pendingMeasureFrameRef.current !== null) {
        window.clearTimeout(pendingMeasureFrameRef.current)
      }
    }
  }, [])

  return {
    composerDockMeasureRef,
    composerDockRef,
    threadBottomClearancePx,
  }
}
