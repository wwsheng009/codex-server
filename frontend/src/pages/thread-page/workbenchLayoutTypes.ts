import type {
  SurfacePanelSide,
  SurfacePanelView,
  TerminalWindowBounds,
} from '../../lib/layout-config-types'
import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
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

export type UseWorkbenchInspectorResizeInput = {
  inspectorResizeRef: MutableRefObject<WorkbenchInspectorResizeState | null>
  isInspectorResizing: boolean
  setInspectorWidth: (value: number) => void
  setIsInspectorResizing: (value: boolean) => void
}

export type UseWorkbenchLayoutPersistenceInput = {
  inspectorWidth: number
  isInspectorExpanded: boolean
  surfacePanelSides: SurfacePanelSides
  surfacePanelWidths: SurfacePanelWidths
  terminalDockPlacement: import('../../lib/layout-config-types').TerminalDockPlacement
  isTerminalDockVisible: boolean
  terminalWindowBounds: TerminalWindowBounds
  isTerminalWindowMaximized: boolean
}

export type UseWorkbenchLayoutStateInput = {
  isMobileViewport: boolean
}

export type UseWorkbenchSurfacePanelResizeInput = {
  isSurfacePanelResizing: boolean
  setIsSurfacePanelResizing: (value: boolean) => void
  setSurfacePanelWidths: Dispatch<SetStateAction<SurfacePanelWidths>>
  surfacePanelResizeRef: MutableRefObject<WorkbenchSurfacePanelResizeState | null>
}

export type UseWorkbenchTerminalDockResizeInput = {
  isTerminalDockResizing: boolean
  setIsTerminalDockResizing: (value: boolean) => void
  setTerminalDockHeight: (value: number) => void
  terminalDockResizeRef: MutableRefObject<WorkbenchTerminalDockResizeState | null>
}

export type UseWorkbenchTerminalWindowInteractionInput = {
  isEnabled: boolean
  isTerminalWindowDragging: boolean
  isTerminalWindowMaximized: boolean
  isTerminalWindowResizing: boolean
  setIsTerminalWindowDragging: (value: boolean) => void
  setIsTerminalWindowResizing: (value: boolean) => void
  setTerminalWindowBounds: Dispatch<SetStateAction<TerminalWindowBounds>>
  terminalWindowDragRef: MutableRefObject<WorkbenchTerminalWindowDragState | null>
  terminalWindowResizeRef: MutableRefObject<WorkbenchTerminalWindowResizeState | null>
}
