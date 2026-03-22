import { useEffect, useRef, useState } from 'react'

const MIN_THREAD_BOTTOM_CLEARANCE_PX = 96
const DEFAULT_THREAD_BOTTOM_CLEARANCE_PX = 180
const THREAD_BOTTOM_CLEARANCE_GAP_PX = 16

export function useThreadViewportBottomClearance() {
  const [threadBottomClearancePx, setThreadBottomClearancePx] = useState(
    DEFAULT_THREAD_BOTTOM_CLEARANCE_PX,
  )
  const composerDockRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    const composerDock = composerDockRef.current
    if (!composerDock) {
      return
    }

    const updateThreadBottomClearance = () => {
      const nextClearance = Math.max(
        MIN_THREAD_BOTTOM_CLEARANCE_PX,
        Math.ceil(composerDock.getBoundingClientRect().height) + THREAD_BOTTOM_CLEARANCE_GAP_PX,
      )

      setThreadBottomClearancePx((current) =>
        current === nextClearance ? current : nextClearance,
      )
    }

    updateThreadBottomClearance()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      updateThreadBottomClearance()
    })

    observer.observe(composerDock)

    return () => observer.disconnect()
  }, [])

  return {
    composerDockRef,
    threadBottomClearancePx,
  }
}
