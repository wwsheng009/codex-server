import type {
  ThreadTerminalViewportActionState,
  ThreadTerminalViewportActionStateInput
} from './threadTerminalInteractionStateTypes'

export function useThreadTerminalViewportActionState({
  clearActiveViewport,
  clearLauncher,
  copyActiveViewportSelection,
  copyLauncherSelection,
  fitActiveViewport,
  fitLauncher,
  focusActiveViewport,
  focusLauncher,
  isLauncherOpen,
  onCloseLauncher,
  onSelectSession,
  pasteActiveViewportClipboard,
  pasteLauncherClipboard,
}: ThreadTerminalViewportActionStateInput): ThreadTerminalViewportActionState {
  function handleSelectSession(processId: string) {
    onSelectSession(processId)
    onCloseLauncher()
  }

  function handleFitViewport() {
    if (isLauncherOpen) {
      fitLauncher()
      return
    }

    fitActiveViewport()
  }

  function handleFocusViewport() {
    if (isLauncherOpen) {
      focusLauncher()
      return
    }

    focusActiveViewport()
  }

  function handleClearViewport() {
    if (isLauncherOpen) {
      clearLauncher()
      return
    }

    clearActiveViewport()
  }

  function handleCopySelection() {
    if (isLauncherOpen) {
      void copyLauncherSelection()
      return
    }

    void copyActiveViewportSelection()
  }

  function handlePasteClipboard() {
    if (isLauncherOpen) {
      void pasteLauncherClipboard()
      return
    }

    void pasteActiveViewportClipboard()
  }

  return {
    selectSession: handleSelectSession,
    viewport: {
      clear: handleClearViewport,
      copySelection: handleCopySelection,
      fit: handleFitViewport,
      focus: handleFocusViewport,
      pasteClipboard: handlePasteClipboard,
    },
  }
}
