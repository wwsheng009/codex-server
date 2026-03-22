import { useEffect } from 'react'
import type { MutableRefObject } from 'react'

import { layoutConfig } from '../../lib/layout-config'
import type { WorkbenchTerminalDockResizeState } from './workbenchLayoutTypes'

export function useWorkbenchTerminalDockResize({
  isTerminalDockResizing,
  setIsTerminalDockResizing,
  setTerminalDockHeight,
  terminalDockResizeRef,
}: {
  isTerminalDockResizing: boolean
  setIsTerminalDockResizing: (value: boolean) => void
  setTerminalDockHeight: (value: number) => void
  terminalDockResizeRef: MutableRefObject<WorkbenchTerminalDockResizeState | null>
}) {
  useEffect(() => {
    if (!isTerminalDockResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = terminalDockResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = resizeState.startY - event.clientY
      const nextHeight = Math.min(
        layoutConfig.workbench.terminalDock.limits.max,
        Math.max(layoutConfig.workbench.terminalDock.limits.min, resizeState.startHeight + delta),
      )
      setTerminalDockHeight(nextHeight)
    }

    function stopResizing() {
      terminalDockResizeRef.current = null
      setIsTerminalDockResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isTerminalDockResizing, setIsTerminalDockResizing, setTerminalDockHeight, terminalDockResizeRef])
}
