import type { CSSProperties } from 'react'

import {
  layoutConfig,
  type SurfacePanelSide,
  type SurfacePanelView,
} from '../../lib/layout-config'
import type { SurfacePanelSides, SurfacePanelWidths } from './workbenchLayoutTypes'

export function buildWorkbenchLayoutDerivedState({
  inspectorWidth,
  isInspectorExpanded,
  isMobileViewport,
  surfacePanelSides,
  surfacePanelView,
  surfacePanelWidths,
  terminalDockHeight,
}: {
  inspectorWidth: number
  isInspectorExpanded: boolean
  isMobileViewport: boolean
  surfacePanelSides: SurfacePanelSides
  surfacePanelView: SurfacePanelView | null
  surfacePanelWidths: SurfacePanelWidths
  terminalDockHeight: number
}) {
  const activeSurfacePanelWidth = surfacePanelView
    ? surfacePanelWidths[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultWidths.feed
  const activeSurfacePanelSide: SurfacePanelSide = surfacePanelView
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

  return {
    activeSurfacePanelSide,
    activeSurfacePanelWidth,
    workbenchLayoutStyle,
  }
}
