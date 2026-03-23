import { useEffect, useRef, useState } from 'react'

const MIN_THREAD_BOTTOM_CLEARANCE_PX = 96
const DEFAULT_THREAD_BOTTOM_CLEARANCE_PX = 180
const THREAD_BOTTOM_CLEARANCE_GAP_PX = 16
const THREAD_BOTTOM_CLEARANCE_UPDATE_THRESHOLD_PX = 12
const THREAD_BOTTOM_CLEARANCE_SHRINK_DELAY_MS = 420

export function useThreadViewportBottomClearance() {
  const [threadBottomClearancePx, setThreadBottomClearancePx] = useState(
    DEFAULT_THREAD_BOTTOM_CLEARANCE_PX,
  )
  const composerDockRef = useRef<HTMLFormElement | null>(null)
  const composerDockMeasureRef = useRef<HTMLDivElement | null>(null)
  const pendingMeasureFrameRef = useRef<number | null>(null)
  const pendingShrinkTimeoutRef = useRef<number | null>(null)
  const lastMeasuredClearanceRef = useRef(DEFAULT_THREAD_BOTTOM_CLEARANCE_PX)

  useEffect(() => {
    const composerDock = composerDockMeasureRef.current
    if (!composerDock) {
      return
    }

    const updateThreadBottomClearance = () => {
      const nextClearance = Math.max(
        MIN_THREAD_BOTTOM_CLEARANCE_PX,
        Math.ceil(composerDock.getBoundingClientRect().height) + THREAD_BOTTOM_CLEARANCE_GAP_PX,
      )

      lastMeasuredClearanceRef.current = nextClearance

      setThreadBottomClearancePx((current) => {
        const clearanceDelta = nextClearance - current
        if (Math.abs(clearanceDelta) < THREAD_BOTTOM_CLEARANCE_UPDATE_THRESHOLD_PX) {
          return current
        }

        if (clearanceDelta > 0) {
          if (pendingShrinkTimeoutRef.current !== null) {
            window.clearTimeout(pendingShrinkTimeoutRef.current)
            pendingShrinkTimeoutRef.current = null
          }

          return nextClearance
        }

        if (pendingShrinkTimeoutRef.current !== null) {
          return current
        }

        pendingShrinkTimeoutRef.current = window.setTimeout(() => {
          pendingShrinkTimeoutRef.current = null
          setThreadBottomClearancePx((latest) => {
            const settledClearance = lastMeasuredClearanceRef.current
            return Math.abs(latest - settledClearance) < THREAD_BOTTOM_CLEARANCE_UPDATE_THRESHOLD_PX
              ? latest
              : settledClearance
          })
        }, THREAD_BOTTOM_CLEARANCE_SHRINK_DELAY_MS)

        return current
      })
    }

    const scheduleThreadBottomClearanceUpdate = () => {
      if (pendingMeasureFrameRef.current !== null) {
        return
      }

      pendingMeasureFrameRef.current = window.requestAnimationFrame(() => {
        pendingMeasureFrameRef.current = null
        updateThreadBottomClearance()
      })
    }

    scheduleThreadBottomClearanceUpdate()

    if (typeof ResizeObserver === 'undefined') {
      return () => {
        if (pendingMeasureFrameRef.current !== null) {
          window.cancelAnimationFrame(pendingMeasureFrameRef.current)
        }
        if (pendingShrinkTimeoutRef.current !== null) {
          window.clearTimeout(pendingShrinkTimeoutRef.current)
        }
      }
    }

    const observer = new ResizeObserver(() => {
      scheduleThreadBottomClearanceUpdate()
    })

    observer.observe(composerDock)

    return () => {
      observer.disconnect()
      if (pendingMeasureFrameRef.current !== null) {
        window.cancelAnimationFrame(pendingMeasureFrameRef.current)
      }
      if (pendingShrinkTimeoutRef.current !== null) {
        window.clearTimeout(pendingShrinkTimeoutRef.current)
      }
    }
  }, [])

  return {
    composerDockRef,
    composerDockMeasureRef,
    threadBottomClearancePx,
  }
}
