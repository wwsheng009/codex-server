import { useEffect } from 'react'

import { layoutConfig } from '../../lib/layout-config'
import type { UseWorkbenchInspectorResizeInput } from './workbenchLayoutTypes'

export function useWorkbenchInspectorResize({
  inspectorResizeRef,
  isInspectorResizing,
  setInspectorWidth,
  setIsInspectorResizing,
}: UseWorkbenchInspectorResizeInput) {
  useEffect(() => {
    if (!isInspectorResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = inspectorResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = resizeState.startX - event.clientX
      const nextWidth = Math.min(
        layoutConfig.workbench.rightRail.limits.max,
        Math.max(layoutConfig.workbench.rightRail.limits.min, resizeState.startWidth + delta),
      )
      setInspectorWidth(nextWidth)
    }

    function stopResizing() {
      inspectorResizeRef.current = null
      setIsInspectorResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [inspectorResizeRef, isInspectorResizing, setInspectorWidth, setIsInspectorResizing])
}
