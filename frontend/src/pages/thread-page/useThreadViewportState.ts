import { useMemo } from 'react'
import type { CSSProperties } from 'react'

import { useThreadViewportAutoScroll } from './useThreadViewportAutoScroll'
import { useThreadViewportBottomClearance } from './useThreadViewportBottomClearance'
import type { ThreadViewportStateInput } from './threadViewportTypes'

export function useThreadViewportState(input: ThreadViewportStateInput) {
  const { composerDockMeasureRef, composerDockRef, threadBottomClearancePx } =
    useThreadViewportBottomClearance()
  const autoScrollState = useThreadViewportAutoScroll({
    ...input,
    threadBottomClearancePx,
  })

  const threadLogStyle = useMemo(
    () =>
      ({
        '--thread-bottom-clearance': `${threadBottomClearancePx}px`,
      }) as CSSProperties,
    [threadBottomClearancePx],
  )

  return {
    composerDockMeasureRef,
    composerDockRef,
    ...autoScrollState,
    threadLogStyle,
  }
}
