import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

import {
  layoutConfig,
  type TerminalDockPlacement,
  type SurfacePanelView,
  type TerminalWindowBounds,
} from '../../lib/layout-config'
import {
  readRightRailExpanded,
  readRightRailWidth,
  readSurfacePanelSides,
  readSurfacePanelWidths,
  readTerminalDockPlacement,
  readTerminalDockVisible,
  readTerminalWindowBounds,
  readTerminalWindowMaximized,
} from '../../lib/layout-state'
import { buildWorkbenchLayoutDerivedState } from './buildWorkbenchLayoutDerivedState'
import { useWorkbenchInspectorResize } from './useWorkbenchInspectorResize'
import { useWorkbenchLayoutPersistence } from './useWorkbenchLayoutPersistence'
import { useWorkbenchSurfacePanelResize } from './useWorkbenchSurfacePanelResize'
import { useWorkbenchTerminalDockResize } from './useWorkbenchTerminalDockResize'
import {
  clampTerminalWindowBounds,
  createMaximizedTerminalWindowBounds,
  createDefaultTerminalWindowBounds,
  useWorkbenchTerminalWindowInteraction,
} from './useWorkbenchTerminalWindowInteraction'
import type {
  SurfacePanelSides,
  SurfacePanelWidths,
  WorkbenchInspectorResizeState,
  WorkbenchSurfacePanelResizeState,
  WorkbenchTerminalDockResizeState,
  WorkbenchTerminalWindowDragState,
  WorkbenchTerminalWindowResizeState,
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
  const [isTerminalDockVisible, setIsTerminalDockVisible] = useState(readTerminalDockVisible)
  const [isTerminalDockExpanded, setIsTerminalDockExpanded] = useState(false)
  const [isTerminalDockResizing, setIsTerminalDockResizing] = useState(false)
  const [terminalDockPlacement, setTerminalDockPlacement] =
    useState<TerminalDockPlacement>(readTerminalDockPlacement)
  const [terminalDockHeight, setTerminalDockHeight] = useState<number>(
    layoutConfig.workbench.terminalDock.defaultHeight,
  )
  const [isTerminalWindowMaximized, setIsTerminalWindowMaximized] = useState(() =>
    readTerminalWindowMaximized(),
  )
  const [terminalWindowBounds, setTerminalWindowBounds] = useState<TerminalWindowBounds>(() => {
    const initialBounds = clampTerminalWindowBounds(
      readTerminalWindowBounds() ?? createDefaultTerminalWindowBounds(),
    )

    return readTerminalWindowMaximized()
      ? createMaximizedTerminalWindowBounds()
      : initialBounds
  })
  const [isTerminalWindowDragging, setIsTerminalWindowDragging] = useState(false)
  const [isTerminalWindowResizing, setIsTerminalWindowResizing] = useState(false)
  const [inspectorWidth, setInspectorWidth] = useState<number>(readRightRailWidth)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(readRightRailExpanded)

  const inspectorResizeRef = useRef<WorkbenchInspectorResizeState | null>(null)
  const surfacePanelResizeRef = useRef<WorkbenchSurfacePanelResizeState | null>(null)
  const terminalDockResizeRef = useRef<WorkbenchTerminalDockResizeState | null>(null)
  const terminalWindowDragRef = useRef<WorkbenchTerminalWindowDragState | null>(null)
  const terminalWindowResizeRef = useRef<WorkbenchTerminalWindowResizeState | null>(null)
  const terminalWindowRestoreBoundsRef = useRef<TerminalWindowBounds>(
    clampTerminalWindowBounds(readTerminalWindowBounds() ?? createDefaultTerminalWindowBounds()),
  )

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
  useWorkbenchTerminalWindowInteraction({
    isEnabled: !isMobileViewport && terminalDockPlacement === 'floating',
    isTerminalWindowDragging,
    isTerminalWindowMaximized,
    isTerminalWindowResizing,
    setIsTerminalWindowDragging,
    setIsTerminalWindowResizing,
    setTerminalWindowBounds,
    terminalWindowDragRef,
    terminalWindowResizeRef,
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
    terminalDockPlacement,
    isTerminalDockVisible,
    terminalWindowBounds,
    isTerminalWindowMaximized,
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

  function handleChangeTerminalDockPlacement(value: TerminalDockPlacement) {
    setTerminalDockPlacement(value)

    if (value === 'right' && !isMobileViewport) {
      setIsInspectorExpanded(true)
      return
    }

    if (value === 'floating') {
      setIsTerminalDockVisible(true)
      setIsTerminalDockExpanded(true)
    }
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

  function handleTerminalWindowDragStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (isTerminalWindowMaximized) {
      return
    }

    event.preventDefault()
    terminalWindowDragRef.current = {
      startBounds: terminalWindowBounds,
      startX: event.clientX,
      startY: event.clientY,
    }
    setIsTerminalWindowDragging(true)
  }

  function handleTerminalWindowResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (isTerminalWindowMaximized) {
      return
    }

    event.preventDefault()
    terminalWindowResizeRef.current = {
      startBounds: terminalWindowBounds,
      startX: event.clientX,
      startY: event.clientY,
    }
    setIsTerminalWindowResizing(true)
  }

  function handleResetTerminalWindowBounds() {
    const nextBounds = createDefaultTerminalWindowBounds()
    terminalWindowRestoreBoundsRef.current = nextBounds

    if (!isTerminalWindowMaximized) {
      setTerminalWindowBounds(nextBounds)
    }
  }

  function handleToggleTerminalWindowMaximized() {
    if (isTerminalWindowMaximized) {
      setIsTerminalWindowMaximized(false)
      setTerminalWindowBounds(clampTerminalWindowBounds(terminalWindowRestoreBoundsRef.current))
      return
    }

    terminalWindowRestoreBoundsRef.current = terminalWindowBounds
    setIsTerminalWindowMaximized(true)
    setIsTerminalDockExpanded(true)
    setTerminalWindowBounds(createMaximizedTerminalWindowBounds())
  }

  function handleHideTerminalDock() {
    setIsTerminalDockVisible(false)
  }

  function handleShowTerminalDock() {
    setIsTerminalDockVisible(true)
  }

  useEffect(() => {
    if (terminalDockPlacement === 'floating' || isMobileViewport) {
      return
    }

    terminalWindowDragRef.current = null
    terminalWindowResizeRef.current = null
    setIsTerminalWindowDragging(false)
    setIsTerminalWindowResizing(false)
  }, [isMobileViewport, terminalDockPlacement])

  useEffect(() => {
    if (isTerminalWindowMaximized) {
      const nextBounds = createMaximizedTerminalWindowBounds()
      if (
        terminalWindowBounds.x !== nextBounds.x ||
        terminalWindowBounds.y !== nextBounds.y ||
        terminalWindowBounds.width !== nextBounds.width ||
        terminalWindowBounds.height !== nextBounds.height
      ) {
        setTerminalWindowBounds(nextBounds)
      }
      return
    }

    terminalWindowRestoreBoundsRef.current = terminalWindowBounds
  }, [isTerminalWindowMaximized, terminalDockPlacement, terminalWindowBounds])

  return {
    activeSurfacePanelSide,
    activeSurfacePanelWidth,
    handleInspectorResizeStart,
    handleHideTerminalDock,
    handleResetTerminalWindowBounds,
    handleResetInspectorWidth,
    handleShowTerminalDock,
    handleTerminalWindowDragStart,
    handleTerminalWindowResizeStart,
    handleToggleTerminalWindowMaximized,
    handleSurfacePanelResizeStart,
    handleTerminalResizeStart,
    inspectorWidth,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockVisible,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    isTerminalWindowDragging,
    isTerminalWindowMaximized,
    isTerminalWindowResizing,
    handleChangeTerminalDockPlacement,
    setInspectorWidth,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setIsTerminalDockVisible,
    setSurfacePanelSides,
    setSurfacePanelView,
    setTerminalWindowBounds,
    surfacePanelSides,
    surfacePanelView,
    terminalDockPlacement,
    terminalDockHeight,
    terminalWindowBounds,
    workbenchLayoutStyle,
  }
}
