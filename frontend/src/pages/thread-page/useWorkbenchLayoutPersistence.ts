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
import type { UseWorkbenchLayoutPersistenceInput } from './workbenchLayoutTypes'

export function useWorkbenchLayoutPersistence({
  inspectorWidth,
  isInspectorExpanded,
  surfacePanelSides,
  surfacePanelWidths,
  terminalDockPlacement,
  isTerminalDockVisible,
  terminalWindowBounds,
  isTerminalWindowMaximized,
}: UseWorkbenchLayoutPersistenceInput) {
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
