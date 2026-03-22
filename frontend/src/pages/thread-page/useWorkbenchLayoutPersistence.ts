import { useEffect } from 'react'

import {
  writeRightRailExpanded,
  writeRightRailWidth,
  writeSurfacePanelSides,
  writeSurfacePanelWidths,
} from '../../lib/layout-state'
import type { SurfacePanelSides, SurfacePanelWidths } from './workbenchLayoutTypes'

export function useWorkbenchLayoutPersistence({
  inspectorWidth,
  isInspectorExpanded,
  surfacePanelSides,
  surfacePanelWidths,
}: {
  inspectorWidth: number
  isInspectorExpanded: boolean
  surfacePanelSides: SurfacePanelSides
  surfacePanelWidths: SurfacePanelWidths
}) {
  useEffect(() => {
    writeRightRailExpanded(isInspectorExpanded)
  }, [isInspectorExpanded])

  useEffect(() => {
    writeRightRailWidth(inspectorWidth)
  }, [inspectorWidth])

  useEffect(() => {
    writeSurfacePanelWidths(surfacePanelWidths)
  }, [surfacePanelWidths])

  useEffect(() => {
    writeSurfacePanelSides(surfacePanelSides)
  }, [surfacePanelSides])
}
