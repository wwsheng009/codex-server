import type { CSSProperties } from 'react'

import {
  layoutConfig,
  type SurfacePanelSide,
} from '../../lib/layout-config'
import type { BuildWorkbenchLayoutDerivedStateInput } from './threadPageRuntimeTypes'

export function buildWorkbenchLayoutDerivedState({
  inspectorWidth,
  isInspectorExpanded,
  isMobileViewport,
  surfacePanelSides,
  surfacePanelView,
  surfacePanelWidths,
  terminalDockHeight,
}: BuildWorkbenchLayoutDerivedStateInput) {
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
