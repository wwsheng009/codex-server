import { useEffect } from 'react'

import {
  writeRightRailExpanded,
  writeRightRailWidth,
  writeSurfacePanelSides,
  writeSurfacePanelWidths,
  writeTerminalDockPlacement,
  writeTerminalDockVisible,
  writeTerminalWindowBounds,
  writeTerminalWindowMaximized,
} from '../../lib/layout-state'
import type { SurfacePanelSides, SurfacePanelWidths } from './workbenchLayoutTypes'
import type { TerminalDockPlacement, TerminalWindowBounds } from '../../lib/layout-config'

export function useWorkbenchLayoutPersistence({
  inspectorWidth,
  isInspectorExpanded,
  surfacePanelSides,
  surfacePanelWidths,
  terminalDockPlacement,
  isTerminalDockVisible,
  terminalWindowBounds,
  isTerminalWindowMaximized,
}: {
  inspectorWidth: number
  isInspectorExpanded: boolean
  surfacePanelSides: SurfacePanelSides
  surfacePanelWidths: SurfacePanelWidths
  terminalDockPlacement: TerminalDockPlacement
  isTerminalDockVisible: boolean
  terminalWindowBounds: TerminalWindowBounds
  isTerminalWindowMaximized: boolean
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

  useEffect(() => {
    writeTerminalDockPlacement(terminalDockPlacement)
  }, [terminalDockPlacement])

  useEffect(() => {
    writeTerminalDockVisible(isTerminalDockVisible)
  }, [isTerminalDockVisible])

  useEffect(() => {
    if (!isTerminalWindowMaximized) {
      writeTerminalWindowBounds(terminalWindowBounds)
    }
  }, [isTerminalWindowMaximized, terminalWindowBounds])

  useEffect(() => {
    writeTerminalWindowMaximized(isTerminalWindowMaximized)
  }, [isTerminalWindowMaximized])
}
