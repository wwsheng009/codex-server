import { useState } from 'react'

import type { SurfacePanelView } from '../../lib/layout-config'
import type { Thread } from '../../types/api'
import type { UseThreadPageRailStateInput } from './threadPageRuntimeTypes'

export function useThreadPageRailState({
  isMobileViewport,
  selectedThread,
  setIsInspectorExpanded,
  setMobileThreadToolsOpen,
  setSurfacePanelView,
}: UseThreadPageRailStateInput) {
  const [editingThreadId, setEditingThreadId] = useState<string>()
  const [editingThreadName, setEditingThreadName] = useState('')
  const [isThreadToolsExpanded, setIsThreadToolsExpanded] = useState(false)
  const [isWorkbenchToolsExpanded, setIsWorkbenchToolsExpanded] = useState(false)
  const [confirmingThreadDelete, setConfirmingThreadDelete] = useState<Thread | null>(null)

  function handleDeleteSelectedThread() {
    if (!selectedThread) {
      return
    }

    setConfirmingThreadDelete(selectedThread)
  }

  function handleBeginRenameSelectedThread() {
    if (!selectedThread) {
      return
    }

    setEditingThreadId(selectedThread.id)
    setEditingThreadName(selectedThread.name)
  }

  function handleCancelRenameSelectedThread() {
    setEditingThreadId(undefined)
  }

  function handleCloseDeleteThreadDialog() {
    setConfirmingThreadDelete(null)
  }

  function handleOpenInspector() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(true)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  function handleOpenSurfacePanel(view: SurfacePanelView) {
    setIsInspectorExpanded(false)
    setSurfacePanelView(view)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  function handleCloseWorkbenchOverlay() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(false)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(false)
    }
  }

  function handleHideSurfacePanel() {
    setSurfacePanelView(null)
  }

  function handleToggleThreadToolsExpanded() {
    setIsThreadToolsExpanded((current) => !current)
  }

  function handleToggleWorkbenchToolsExpanded() {
    setIsWorkbenchToolsExpanded((current) => !current)
  }

  function handleOpenWorkbenchTools() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(true)
    setIsWorkbenchToolsExpanded(true)

    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  return {
    confirmingThreadDelete,
    editingThreadId,
    editingThreadName,
    handleBeginRenameSelectedThread,
    handleCancelRenameSelectedThread,
    handleCloseDeleteThreadDialog,
    handleCloseWorkbenchOverlay,
    handleDeleteSelectedThread,
    handleHideSurfacePanel,
    handleOpenInspector,
    handleOpenWorkbenchTools,
    handleOpenSurfacePanel,
    handleToggleThreadToolsExpanded,
    handleToggleWorkbenchToolsExpanded,
    isThreadToolsExpanded,
    isWorkbenchToolsExpanded,
    setConfirmingThreadDelete,
    setEditingThreadId,
    setEditingThreadName,
  }
}
