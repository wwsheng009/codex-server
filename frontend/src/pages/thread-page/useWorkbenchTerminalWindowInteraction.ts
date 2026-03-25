import { useEffect } from 'react'

import { layoutConfig } from '../../lib/layout-config'
import type { TerminalWindowBounds } from '../../lib/layout-config-types'
import type { UseWorkbenchTerminalWindowInteractionInput } from './workbenchLayoutTypes'

function getViewportSize() {
  if (typeof window === 'undefined') {
    const {
      defaultWidth,
      defaultHeight,
      viewportMargin,
    } = layoutConfig.workbench.terminalDock.floating

    return {
      height: defaultHeight + viewportMargin * 2,
      width: defaultWidth + viewportMargin * 2,
    }
  }

  return {
    height: window.innerHeight,
    width: window.innerWidth,
  }
}

export function createMaximizedTerminalWindowBounds(): TerminalWindowBounds {
  const viewport = getViewportSize()

  return {
    height: viewport.height,
    width: viewport.width,
    x: 0,
    y: 0,
  }
}

export function clampTerminalWindowBounds(bounds: TerminalWindowBounds): TerminalWindowBounds {
  const { limits, viewportMargin } = layoutConfig.workbench.terminalDock.floating
  const viewport = getViewportSize()
  const availableWidth = Math.max(320, viewport.width - viewportMargin * 2)
  const availableHeight = Math.max(220, viewport.height - viewportMargin * 2)
  const maxWidth = Math.min(limits.maxWidth, availableWidth)
  const maxHeight = Math.min(limits.maxHeight, availableHeight)
  const minWidth = Math.min(limits.minWidth, maxWidth)
  const minHeight = Math.min(limits.minHeight, maxHeight)
  const width = Math.min(maxWidth, Math.max(minWidth, bounds.width))
  const height = Math.min(maxHeight, Math.max(minHeight, bounds.height))
  const maxX = Math.max(viewportMargin, viewport.width - width - viewportMargin)
  const maxY = Math.max(viewportMargin, viewport.height - height - viewportMargin)

  return {
    height: Math.round(height),
    width: Math.round(width),
    x: Math.round(Math.min(maxX, Math.max(viewportMargin, bounds.x))),
    y: Math.round(Math.min(maxY, Math.max(viewportMargin, bounds.y))),
  }
}

function areTerminalWindowBoundsEqual(a: TerminalWindowBounds, b: TerminalWindowBounds) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

export function createDefaultTerminalWindowBounds() {
  const { defaultHeight, defaultWidth } = layoutConfig.workbench.terminalDock.floating
  const viewport = getViewportSize()

  return clampTerminalWindowBounds({
    height: defaultHeight,
    width: defaultWidth,
    x: Math.round((viewport.width - defaultWidth) / 2),
    y: Math.round((viewport.height - defaultHeight) / 2),
  })
}

export function useWorkbenchTerminalWindowInteraction({
  isEnabled,
  isTerminalWindowDragging,
  isTerminalWindowMaximized,
  isTerminalWindowResizing,
  setIsTerminalWindowDragging,
  setIsTerminalWindowResizing,
  setTerminalWindowBounds,
  terminalWindowDragRef,
  terminalWindowResizeRef,
}: UseWorkbenchTerminalWindowInteractionInput) {
  useEffect(() => {
    if (
      !isEnabled ||
      isTerminalWindowMaximized ||
      (!isTerminalWindowDragging && !isTerminalWindowResizing)
    ) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const dragState = terminalWindowDragRef.current
      if (dragState) {
        const deltaX = event.clientX - dragState.startX
        const deltaY = event.clientY - dragState.startY
        setTerminalWindowBounds(
          clampTerminalWindowBounds({
            ...dragState.startBounds,
            x: dragState.startBounds.x + deltaX,
            y: dragState.startBounds.y + deltaY,
          }),
        )
        return
      }

      const resizeState = terminalWindowResizeRef.current
      if (!resizeState) {
        return
      }

      const deltaX = event.clientX - resizeState.startX
      const deltaY = event.clientY - resizeState.startY
      setTerminalWindowBounds(
        clampTerminalWindowBounds({
          ...resizeState.startBounds,
          height: resizeState.startBounds.height + deltaY,
          width: resizeState.startBounds.width + deltaX,
        }),
      )
    }

    function stopInteraction() {
      terminalWindowDragRef.current = null
      terminalWindowResizeRef.current = null
      setIsTerminalWindowDragging(false)
      setIsTerminalWindowResizing(false)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }

    document.body.style.setProperty(
      'cursor',
      isTerminalWindowDragging ? 'grabbing' : 'nwse-resize',
    )
    document.body.style.setProperty('user-select', 'none')

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopInteraction)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopInteraction)
      document.body.style.removeProperty('cursor')
      document.body.style.removeProperty('user-select')
    }
  }, [
    isEnabled,
    isTerminalWindowDragging,
    isTerminalWindowMaximized,
    isTerminalWindowResizing,
    setIsTerminalWindowDragging,
    setIsTerminalWindowResizing,
    setTerminalWindowBounds,
    terminalWindowDragRef,
    terminalWindowResizeRef,
  ])

  useEffect(() => {
    if (!isEnabled) {
      return
    }

    function handleResize() {
      setTerminalWindowBounds((current) => {
        const nextBounds = isTerminalWindowMaximized
          ? createMaximizedTerminalWindowBounds()
          : clampTerminalWindowBounds(current)

        return areTerminalWindowBoundsEqual(current, nextBounds) ? current : nextBounds
      })
    }

    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [isEnabled, isTerminalWindowMaximized, setTerminalWindowBounds])
}
