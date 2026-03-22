import type { RefObject } from 'react'

import { useWorkspaceStream } from '../../hooks/useWorkspaceStream'
import type { ServerEvent } from '../../types/api'
import { usePendingThreadTurns } from './usePendingThreadTurns'
import { useThreadComposerState } from './useThreadComposerState'
import { useThreadPagePlanModeSupport } from './useThreadPagePlanModeSupport'
import { useWorkbenchLayoutState } from './useWorkbenchLayoutState'

export function useThreadPageControllerRuntimeState({
  allThreadEvents,
  composerInputRef,
  isMobileViewport,
  selectedThreadId,
  workspaceId,
}: {
  allThreadEvents: Record<string, ServerEvent[] | undefined>
  composerInputRef: RefObject<HTMLTextAreaElement | null>
  isMobileViewport: boolean
  selectedThreadId?: string
  workspaceId: string
}) {
  const {
    activeSurfacePanelSide,
    handleInspectorResizeStart,
    handleResetInspectorWidth,
    handleSurfacePanelResizeStart,
    handleTerminalResizeStart,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setSurfacePanelSides,
    setSurfacePanelView,
    surfacePanelView,
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
    allThreadEvents,
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
    handleInspectorResizeStart,
    handleResetInspectorWidth,
    handleSurfacePanelResizeStart,
    handleTerminalResizeStart,
    isInspectorExpanded,
    isInspectorResizing,
    isSurfacePanelResizing,
    isTerminalDockExpanded,
    isTerminalDockResizing,
    pendingTurnsByThread,
    setIsInspectorExpanded,
    setIsTerminalDockExpanded,
    setSurfacePanelSides,
    setSurfacePanelView,
    streamState,
    supportsPlanMode,
    surfacePanelView,
    updatePendingTurn,
    workbenchLayoutStyle,
  }
}
