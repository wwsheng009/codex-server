import type {
  BuildThreadPageLayoutPropsInput,
  TerminalDockProps,
} from './threadPageLayoutPropTypes'

export function buildThreadTerminalDockProps(
  input: BuildThreadPageLayoutPropsInput,
): TerminalDockProps | undefined {
  if (input.isMobileViewport) {
    return undefined
  }

  function handleToggleTerminalDockExpanded() {
    input.setIsTerminalDockExpanded((current) => !current)
  }

  function handleShowTerminalDock() {
    input.onShowTerminalDock()

    if (!input.commandSessions.length) {
      input.setIsTerminalDockExpanded(true)
    }
  }

  return {
    activeCommandCount: input.activeCommandCount,
    className: input.terminalDockClassName,
    commandSessions: input.commandSessions,
    isExpanded: input.isTerminalDockExpanded,
    isFloating: input.placement === 'floating',
    isVisible: input.isTerminalDockVisible,
    isWindowMaximized: input.isTerminalWindowMaximized,
    onChangePlacement: input.onChangePlacement,
    onClearCompletedSessions: input.onClearCompletedSessions,
    onDragStart: input.onStartTerminalWindowDrag,
    onHide: input.onHideTerminalDock,
    onRemoveSession: input.onRemoveSession,
    onResetFloatingBounds: input.onResetTerminalWindowBounds,
    onResizeStart: input.onResizeStart,
    onResizeTerminal: input.onResizeTerminal,
    onWindowResizeStart: input.onStartTerminalWindowResize,
    onSelectSession: input.onSelectSession,
    onStartShellSession: input.onStartTerminalShellSession,
    onShow: handleShowTerminalDock,
    onStartCommandLine: input.onStartTerminalCommandLine,
    onToggleArchivedSession: input.onToggleArchivedSession,
    onTerminateSelectedSession: input.onTerminateSelectedSession,
    onTogglePinnedSession: input.onTogglePinnedSession,
    onToggleExpanded: handleToggleTerminalDockExpanded,
    onToggleWindowMaximized: input.onToggleTerminalWindowMaximized,
    onWriteTerminalData: input.onWriteTerminalData,
    placement: input.placement,
    rootPath: input.rootPath,
    selectedCommandSession: input.selectedCommandSession,
    style:
      input.placement === 'floating'
        ? {
            height: `${input.terminalWindowBounds.height}px`,
            left: `${input.terminalWindowBounds.x}px`,
            top: `${input.terminalWindowBounds.y}px`,
            width: `${input.terminalWindowBounds.width}px`,
          }
        : undefined,
    startCommandPending: input.startTerminalCommandPending,
    terminateDisabled: input.terminateDisabled,
  }
}
