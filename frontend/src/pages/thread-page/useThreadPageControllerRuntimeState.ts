import type { RefObject } from 'react'

import { useWorkspaceStream } from '../../hooks/useWorkspaceStream'
import { usePendingThreadTurns } from './usePendingThreadTurns'
import { useThreadComposerState } from './useThreadComposerState'
import { useThreadPagePlanModeSupport } from './useThreadPagePlanModeSupport'
import { useWorkbenchLayoutState } from './useWorkbenchLayoutState'

export function useThreadPageControllerRuntimeState({
  composerInputRef,
  isMobileViewport,
  selectedThreadId,
  workspaceId,
}: {
  composerInputRef: RefObject<HTMLTextAreaElement | null>
  isMobileViewport: boolean
  selectedThreadId?: string
  workspaceId: string
}) {
  const {
    activeSurfacePanelSide,
    handleInspectorResizeStart,
    handleHideTerminalDock,
    handleResetInspectorWidth,
    handleResetTerminalWindowBounds,
    handleShowTerminalDock,
    handleSurfacePanelResizeStart,
    handleChangeTerminalDockPlacement,
    handleTerminalResizeStart,
    handleTerminalWindowDragStart,
    handleTerminalWindowResizeStart,
    handleToggleTerminalWindowMaximized,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockVisible,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    isTerminalWindowDragging,
    isTerminalWindowMaximized,
    isTerminalWindowResizing,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setIsTerminalDockVisible,
    setSurfacePanelSides,
    setSurfacePanelView,
    setTerminalWindowBounds,
    surfacePanelView,
    terminalDockPlacement,
    terminalWindowBounds,
    workbenchLayoutStyle,
  } = useWorkbenchLayoutState({
    isMobileViewport,
  })
  const streamState = useWorkspaceStream(workspaceId)
  const {
    activePendingTurn,
    clearPendingTurn,
    pendingTurnsByThread,
    updatePendingTurn,
  } = usePendingThreadTurns({
    selectedThreadId,
    workspaceId,
  })
  const { supportsPlanMode } = useThreadPagePlanModeSupport(workspaceId)
  const composerState = useThreadComposerState({
    composerInputRef,
    selectedThreadId,
    supportsPlanMode,
    workspaceId,
  })

  return {
    ...composerState,
    activePendingTurn,
    activeSurfacePanelSide,
    clearPendingTurn,
    handleChangeTerminalDockPlacement,
    handleInspectorResizeStart,
    handleHideTerminalDock,
    handleResetInspectorWidth,
    handleResetTerminalWindowBounds,
    handleShowTerminalDock,
    handleSurfacePanelResizeStart,
    handleTerminalResizeStart,
    handleTerminalWindowDragStart,
    handleTerminalWindowResizeStart,
    handleToggleTerminalWindowMaximized,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockVisible,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    isTerminalWindowDragging,
    isTerminalWindowMaximized,
    isTerminalWindowResizing,
    pendingTurnsByThread,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setIsTerminalDockVisible,
    setSurfacePanelSides,
    setSurfacePanelView,
    setTerminalWindowBounds,
    streamState,
    supportsPlanMode,
    surfacePanelView,
    terminalDockPlacement,
    terminalWindowBounds,
    updatePendingTurn,
    workbenchLayoutStyle,
  }
}
