import {
  readBooleanPreference,
  readJsonPreference,
  readNumberPreference,
  writeBooleanPreference,
  writeJsonPreference,
  writeNumberPreference,
} from './layout-preferences'
import {
  layoutConfig,
} from './layout-config'
import type {
  SurfacePanelSide,
  SurfacePanelView,
  TerminalDockPlacement,
  TerminalWindowBounds,
} from './layout-config-types'

export function readLeftSidebarCollapsed() {
  return readBooleanPreference('leftSidebarCollapsed', false)
}

export function writeLeftSidebarCollapsed(value: boolean) {
  writeBooleanPreference('leftSidebarCollapsed', value)
}

export function readLeftSidebarWidth() {
  return readNumberPreference(
    'leftSidebarWidth',
    layoutConfig.shell.leftSidebar.defaultWidth,
    layoutConfig.shell.leftSidebar.limits,
  )
}

export function writeLeftSidebarWidth(value: number) {
  writeNumberPreference('leftSidebarWidth', value)
}

export function readWorkspaceThreadGroupsCollapsed() {
  return readJsonPreference<Record<string, boolean>>('workspaceThreadGroupsCollapsed', {})
}

export function writeWorkspaceThreadGroupsCollapsed(value: Record<string, boolean>) {
  writeJsonPreference('workspaceThreadGroupsCollapsed', value)
}

export function readRightRailExpanded() {
  return readBooleanPreference('rightRailExpanded', false)
}

export function writeRightRailExpanded(value: boolean) {
  writeBooleanPreference('rightRailExpanded', value)
}

export function readRightRailWidth() {
  return readNumberPreference(
    'rightRailWidth',
    layoutConfig.workbench.rightRail.defaultWidth,
    layoutConfig.workbench.rightRail.limits,
  )
}

export function writeRightRailWidth(value: number) {
  writeNumberPreference('rightRailWidth', value)
}

export function readSurfacePanelWidths() {
  const stored = readJsonPreference<Partial<Record<SurfacePanelView, number>>>(
    'surfacePanelWidths',
    {},
  )

  return {
    ...layoutConfig.workbench.surfacePanel.defaultWidths,
    ...(stored && typeof stored === 'object' ? stored : {}),
  }
}

export function writeSurfacePanelWidths(value: Record<SurfacePanelView, number>) {
  writeJsonPreference('surfacePanelWidths', value)
}

export function readSurfacePanelSides() {
  const stored = readJsonPreference<Partial<Record<SurfacePanelView, SurfacePanelSide>>>(
    'surfacePanelSides',
    {},
  )

  return {
    ...layoutConfig.workbench.surfacePanel.defaultSides,
    ...(stored && typeof stored === 'object' ? stored : {}),
  }
}

export function writeSurfacePanelSides(value: Record<SurfacePanelView, SurfacePanelSide>) {
  writeJsonPreference('surfacePanelSides', value)
}

export function readTerminalDockPlacement(): TerminalDockPlacement {
  const placement = readJsonPreference<TerminalDockPlacement>(
    'terminalDockPlacement',
    layoutConfig.workbench.terminalDock.defaultPlacement,
  )

  if (placement === 'right' || placement === 'floating') {
    return placement
  }

  return 'bottom'
}

export function writeTerminalDockPlacement(value: TerminalDockPlacement) {
  writeJsonPreference('terminalDockPlacement', value)
}

export function readTerminalDockVisible() {
  return readBooleanPreference('terminalDockVisible', true)
}

export function writeTerminalDockVisible(value: boolean) {
  writeBooleanPreference('terminalDockVisible', value)
}

export function readTerminalWindowBounds(): TerminalWindowBounds | null {
  const value = readJsonPreference<TerminalWindowBounds | null>('terminalWindowBounds', null)

  if (
    !value ||
    !Number.isFinite(value.x) ||
    !Number.isFinite(value.y) ||
    !Number.isFinite(value.width) ||
    !Number.isFinite(value.height)
  ) {
    return null
  }

  return value
}

export function writeTerminalWindowBounds(value: TerminalWindowBounds) {
  writeJsonPreference('terminalWindowBounds', value)
}

export function readTerminalWindowMaximized() {
  return readBooleanPreference('terminalWindowMaximized', false)
}

export function writeTerminalWindowMaximized(value: boolean) {
  writeBooleanPreference('terminalWindowMaximized', value)
}
