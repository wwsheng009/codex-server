import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import {
  layoutConfig,
  type SurfacePanelSide,
  type SurfacePanelView,
} from '../../lib/layout-config'
import {
  readRightRailExpanded,
  readRightRailWidth,
  readSurfacePanelSides,
  readSurfacePanelWidths,
  writeRightRailExpanded,
  writeRightRailWidth,
  writeSurfacePanelSides,
  writeSurfacePanelWidths,
} from '../../lib/layout-state'

type SurfacePanelWidths = ReturnType<typeof readSurfacePanelWidths>
type SurfacePanelSides = ReturnType<typeof readSurfacePanelSides>

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

  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const surfacePanelResizeRef = useRef<{
    side: SurfacePanelSide
    startX: number
    startWidth: number
    view: SurfacePanelView
  } | null>(null)
  const terminalDockResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    setIsTerminalDockExpanded(false)
  }, [isMobileViewport])

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
  }, [isTerminalDockResizing])

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
  }, [isInspectorResizing])

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
  }, [isSurfacePanelResizing])

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

  const activeSurfacePanelWidth = surfacePanelView
    ? surfacePanelWidths[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultWidths.feed
  const activeSurfacePanelSide = surfacePanelView
    ? surfacePanelSides[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultSides.feed
  const workbenchRailWidth = isMobileViewport
    ? '0px'
    : isInspectorExpanded
      ? `${inspectorWidth}px`
      : 'var(--rail-collapsed-width)'
  const workbenchLayoutStyle = {
    ['--surface-panel-width' as string]: `${activeSurfacePanelWidth}px`,
    ['--terminal-dock-height' as string]: `${terminalDockHeight}px`,
    ['--workbench-rail-width' as string]: workbenchRailWidth,
  } as CSSProperties

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
