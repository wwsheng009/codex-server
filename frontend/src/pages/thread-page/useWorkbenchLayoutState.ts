import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import {
  layoutConfig,
  type SurfacePanelView,
} from '../../lib/layout-config'
import {
  readRightRailExpanded,
  readRightRailWidth,
  readSurfacePanelSides,
  readSurfacePanelWidths,
} from '../../lib/layout-state'
import { buildWorkbenchLayoutDerivedState } from './buildWorkbenchLayoutDerivedState'
import { useWorkbenchInspectorResize } from './useWorkbenchInspectorResize'
import { useWorkbenchLayoutPersistence } from './useWorkbenchLayoutPersistence'
import { useWorkbenchSurfacePanelResize } from './useWorkbenchSurfacePanelResize'
import { useWorkbenchTerminalDockResize } from './useWorkbenchTerminalDockResize'
import type {
  SurfacePanelSides,
  SurfacePanelWidths,
  WorkbenchInspectorResizeState,
  WorkbenchSurfacePanelResizeState,
  WorkbenchTerminalDockResizeState,
} from './workbenchLayoutTypes'

export function useWorkbenchLayoutState({
  isMobileViewport,
}: {
  isMobileViewport: boolean
}) {
  const [surfacePanelView, setSurfacePanelView] = useState<SurfacePanelView | null>(null)
  const [surfacePanelWidths, setSurfacePanelWidths] = useState<SurfacePanelWidths>(readSurfacePanelWidths)
  const [surfacePanelSides, setSurfacePanelSides] = useState<SurfacePanelSides>(readSurfacePanelSides)
  const [isSurfacePanelResizing, setIsSurfacePanelResizing] = useState(false)
  const [isTerminalDockExpanded, setIsTerminalDockExpanded] = useState(false)
  const [isTerminalDockResizing, setIsTerminalDockResizing] = useState(false)
  const [terminalDockHeight, setTerminalDockHeight] = useState<number>(
    layoutConfig.workbench.terminalDock.defaultHeight,
  )
  const [inspectorWidth, setInspectorWidth] = useState<number>(readRightRailWidth)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(readRightRailExpanded)

  const inspectorResizeRef = useRef<WorkbenchInspectorResizeState | null>(null)
  const surfacePanelResizeRef = useRef<WorkbenchSurfacePanelResizeState | null>(null)
  const terminalDockResizeRef = useRef<WorkbenchTerminalDockResizeState | null>(null)

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    setIsTerminalDockExpanded(false)
  }, [isMobileViewport])

  useWorkbenchTerminalDockResize({
    isTerminalDockResizing,
    setIsTerminalDockResizing,
    setTerminalDockHeight,
    terminalDockResizeRef,
  })
  useWorkbenchInspectorResize({
    inspectorResizeRef,
    isInspectorResizing,
    setInspectorWidth,
    setIsInspectorResizing,
  })
  useWorkbenchSurfacePanelResize({
    isSurfacePanelResizing,
    setIsSurfacePanelResizing,
    setSurfacePanelWidths,
    surfacePanelResizeRef,
  })
  useWorkbenchLayoutPersistence({
    inspectorWidth,
    isInspectorExpanded,
    surfacePanelSides,
    surfacePanelWidths,
  })

  const { activeSurfacePanelSide, activeSurfacePanelWidth, workbenchLayoutStyle } =
    buildWorkbenchLayoutDerivedState({
      inspectorWidth,
      isInspectorExpanded,
      isMobileViewport,
      surfacePanelSides,
      surfacePanelView,
      surfacePanelWidths,
      terminalDockHeight,
    })

  function handleTerminalResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    terminalDockResizeRef.current = {
      startY: event.clientY,
      startHeight: terminalDockHeight,
    }
    setIsTerminalDockResizing(true)
  }

  function handleInspectorResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    inspectorResizeRef.current = {
      startX: event.clientX,
      startWidth: inspectorWidth,
    }
    setIsInspectorResizing(true)
  }

  function handleSurfacePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!surfacePanelView) {
      return
    }

    surfacePanelResizeRef.current = {
      side: activeSurfacePanelSide,
      startX: event.clientX,
      startWidth: activeSurfacePanelWidth,
      view: surfacePanelView,
    }
    setIsSurfacePanelResizing(true)
  }

  function handleResetInspectorWidth() {
    setInspectorWidth(layoutConfig.workbench.rightRail.defaultWidth)
  }

  return {
    activeSurfacePanelSide,
    activeSurfacePanelWidth,
    handleInspectorResizeStart,
    handleResetInspectorWidth,
    handleSurfacePanelResizeStart,
    handleTerminalResizeStart,
    inspectorWidth,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    setInspectorWidth,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setSurfacePanelSides,
    setSurfacePanelView,
    surfacePanelSides,
    surfacePanelView,
    terminalDockHeight,
    workbenchLayoutStyle,
  }
}
