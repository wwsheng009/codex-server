import { useRef } from 'react'

import {
  type TerminalPerformanceInfo,
  type ThreadTerminalLauncherHandle,
  type ThreadTerminalViewportHandle,
} from './threadTerminalViewportTypes'
import type {
  ThreadTerminalViewportHandlesState,
  ThreadTerminalViewportHandlesStateInput
} from './threadTerminalInteractionStateTypes'
import { getActiveViewport } from './threadTerminalViewportUtils'

const EMPTY_TERMINAL_PERFORMANCE_INFO: TerminalPerformanceInfo = {
  bytesPerSecond: 0,
  flushCount: 0,
  flushesPerSecond: 0,
  lastChunkSize: 0,
}

export function useThreadTerminalViewportHandlesState({
  activeSessionId,
  selectedCommandSession,
}: ThreadTerminalViewportHandlesStateInput): ThreadTerminalViewportHandlesState {
  const launcherRef = useRef<ThreadTerminalLauncherHandle | null>(null)
  const viewportRefs = useRef<Record<string, ThreadTerminalViewportHandle | null>>({})
  const workspaceRef = useRef<HTMLDivElement | null>(null)
  const viewportStackRef = useRef<HTMLDivElement | null>(null)

  function getSelectedViewport() {
    return getActiveViewport({
      sessionId: activeSessionId,
      viewportRefs: viewportRefs.current,
    })
  }

  function focusLauncher() {
    launcherRef.current?.focusLauncher()
  }

  function fitLauncher() {
    launcherRef.current?.fitLauncher()
  }

  function clearLauncher() {
    launcherRef.current?.clearLauncher()
  }

  function copyLauncherSelection() {
    return launcherRef.current?.copySelection() ?? Promise.resolve(false)
  }

  function pasteLauncherClipboard() {
    return launcherRef.current?.pasteFromClipboard() ?? Promise.resolve(false)
  }

  function getLauncherRendererInfo() {
    return launcherRef.current?.getRendererInfo() ?? 'pending'
  }

  function getLauncherDimensionsInfo() {
    return launcherRef.current?.getDimensionsInfo() ?? '0x0'
  }

  function getLauncherPerformanceInfo() {
    return launcherRef.current?.getPerformanceInfo() ?? EMPTY_TERMINAL_PERFORMANCE_INFO
  }

  function focusActiveViewport() {
    getSelectedViewport()?.focusViewport()
  }

  function fitActiveViewport() {
    getSelectedViewport()?.fitViewport()
  }

  function clearActiveViewport() {
    getSelectedViewport()?.clearViewport()
  }

  function copyActiveViewportSelection() {
    return getSelectedViewport()?.copySelection() ?? Promise.resolve(false)
  }

  function pasteActiveViewportClipboard() {
    return getSelectedViewport()?.pasteFromClipboard() ?? Promise.resolve(false)
  }

  function findNextInActiveViewport(query: string) {
    return getSelectedViewport()?.findNext(query) ?? false
  }

  function findPreviousInActiveViewport(query: string) {
    return getSelectedViewport()?.findPrevious(query) ?? false
  }

  function getActiveViewportRendererInfo() {
    if (selectedCommandSession?.archived) {
      return 'static'
    }

    return getSelectedViewport()?.getRendererInfo() ?? (activeSessionId ? 'pending' : 'none')
  }

  function getActiveViewportDimensionsInfo() {
    return getSelectedViewport()?.getDimensionsInfo() ?? '0x0'
  }

  function getActiveViewportPerformanceInfo() {
    return getSelectedViewport()?.getPerformanceInfo() ?? EMPTY_TERMINAL_PERFORMANCE_INFO
  }

  return {
    refs: {
      launcherRef,
      viewportRefs,
      viewportStackRef,
      workspaceRef,
    },
    viewportSession: {
      clearActiveViewport,
      clearLauncher,
      copyActiveViewportSelection,
      copyLauncherSelection,
      findNextInActiveViewport,
      findPreviousInActiveViewport,
      fitActiveViewport,
      fitLauncher,
      focusActiveViewport,
      focusLauncher,
      getActiveViewportDimensionsInfo,
      getActiveViewportPerformanceInfo,
      getActiveViewportRendererInfo,
      getLauncherDimensionsInfo,
      getLauncherPerformanceInfo,
      getLauncherRendererInfo,
      pasteActiveViewportClipboard,
      pasteLauncherClipboard,
    },
  }
}
