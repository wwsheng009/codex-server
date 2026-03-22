import { useEffect } from 'react'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'

import { layoutConfig } from '../../lib/layout-config'
import type {
  SurfacePanelWidths,
  WorkbenchSurfacePanelResizeState,
} from './workbenchLayoutTypes'

export function useWorkbenchSurfacePanelResize({
  isSurfacePanelResizing,
  setIsSurfacePanelResizing,
  setSurfacePanelWidths,
  surfacePanelResizeRef,
}: {
  isSurfacePanelResizing: boolean
  setIsSurfacePanelResizing: (value: boolean) => void
  setSurfacePanelWidths: Dispatch<SetStateAction<SurfacePanelWidths>>
  surfacePanelResizeRef: MutableRefObject<WorkbenchSurfacePanelResizeState | null>
}) {
  useEffect(() => {
    if (!isSurfacePanelResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = surfacePanelResizeRef.current
      if (!resizeState) {
        return
      }

      const delta =
        resizeState.side === 'right'
          ? resizeState.startX - event.clientX
          : event.clientX - resizeState.startX
      const nextWidth = Math.min(
        layoutConfig.workbench.surfacePanel.widthLimits.max,
        Math.max(layoutConfig.workbench.surfacePanel.widthLimits.min, resizeState.startWidth + delta),
      )
      setSurfacePanelWidths((current) => ({
        ...current,
        [resizeState.view]: nextWidth,
      }))
    }

    function stopResizing() {
      surfacePanelResizeRef.current = null
      setIsSurfacePanelResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isSurfacePanelResizing, setIsSurfacePanelResizing, setSurfacePanelWidths, surfacePanelResizeRef])
}
