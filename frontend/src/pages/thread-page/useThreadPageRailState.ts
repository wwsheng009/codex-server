import { useState } from 'react'

import type { SurfacePanelView } from '../../lib/layout-config'
import type { Thread } from '../../types/api'

export function useThreadPageRailState({
  isMobileViewport,
  selectedThread,
  setIsInspectorExpanded,
  setMobileThreadToolsOpen,
  setSurfacePanelView,
}: {
  isMobileViewport: boolean
  selectedThread?: Thread
  setIsInspectorExpanded: (value: boolean) => void
  setMobileThreadToolsOpen: (value: boolean) => void
  setSurfacePanelView: (value: SurfacePanelView | null) => void
}) {
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
