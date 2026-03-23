import type {
  SurfacePanelSide,
  SurfacePanelView,
  TerminalWindowBounds,
} from '../../lib/layout-config'
import { readSurfacePanelWidths } from '../../lib/layout-state'

export type SurfacePanelWidths = ReturnType<typeof readSurfacePanelWidths>
export type SurfacePanelSides = Record<SurfacePanelView, SurfacePanelSide>

export type WorkbenchInspectorResizeState = {
  startX: number
  startWidth: number
}

export type WorkbenchSurfacePanelResizeState = {
  side: SurfacePanelSide
  startX: number
  startWidth: number
  view: SurfacePanelView
}

export type WorkbenchTerminalDockResizeState = {
  startY: number
  startHeight: number
}

export type WorkbenchTerminalWindowDragState = {
  startX: number
  startY: number
  startBounds: TerminalWindowBounds
}

export type WorkbenchTerminalWindowResizeState = {
  startX: number
  startY: number
  startBounds: TerminalWindowBounds
}
