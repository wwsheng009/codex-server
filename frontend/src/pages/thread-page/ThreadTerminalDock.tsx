import { createPortal } from 'react-dom'

import { i18n } from '../../i18n/runtime'
import { ThreadTerminalDockBar, ThreadTerminalDockWorkspace } from './ThreadTerminalDockSections'
import type { ThreadTerminalDockProps } from './threadTerminalDockTypes'

export function ThreadTerminalDock({
  activeCommandCount,
  className,
  commandSessions,
  isExpanded,
  isFloating,
  isVisible,
  isWindowMaximized,
  onChangePlacement,
  onClearCompletedSessions,
  onDragStart,
  onHide,
  onRemoveSession,
  onResetFloatingBounds,
  onResizeStart,
  onResizeTerminal,
  onSelectSession,
  onStartShellSession,
  onShow,
  onStartCommandLine,
  onToggleArchivedSession,
  onTerminateSelectedSession,
  onTogglePinnedSession,
  onToggleExpanded,
  onToggleWindowMaximized,
  onWindowResizeStart,
  onWriteTerminalData,
  placement,
  rootPath,
  selectedCommandSession,
  style,
  startCommandPending,
  terminateDisabled,
}: ThreadTerminalDockProps) {
  const dockStyle =
    isFloating && !isExpanded && style
      ? {
          ...style,
          height: undefined,
        }
      : style

  const reveal = (
    <button
      className={
        isFloating
          ? 'terminal-dock__reveal terminal-dock__reveal--floating'
          : 'terminal-dock__reveal'
      }
      onClick={onShow}
      type="button"
    >
      {i18n._({
        id: 'Show terminal',
        message: 'Show terminal',
      })}
    </button>
  )

  if (!isVisible) {
    if (!isFloating || typeof document === 'undefined') {
      return reveal
    }

    return createPortal(reveal, document.body)
  }

  const dock = (
    <section className={className} style={dockStyle}>
      <ThreadTerminalDockBar
        activeCommandCount={activeCommandCount}
        commandSessions={commandSessions}
        isExpanded={isExpanded}
        isFloating={isFloating}
        isVisible={isVisible}
        isWindowMaximized={isWindowMaximized}
        onChangePlacement={onChangePlacement}
        onDragStart={onDragStart}
        onHide={onHide}
        onResetFloatingBounds={onResetFloatingBounds}
        onToggleExpanded={onToggleExpanded}
        onToggleWindowMaximized={onToggleWindowMaximized}
        placement={placement}
      />

      {isExpanded ? (
        <ThreadTerminalDockWorkspace
          commandSessions={commandSessions}
          isFloating={isFloating}
          isVisible={isVisible}
          isWindowMaximized={isWindowMaximized}
          onClearCompletedSessions={onClearCompletedSessions}
          onRemoveSession={onRemoveSession}
          onResizeStart={onResizeStart}
          onResizeTerminal={onResizeTerminal}
          onSelectSession={onSelectSession}
          onStartShellSession={onStartShellSession}
          onStartCommandLine={onStartCommandLine}
          onToggleArchivedSession={onToggleArchivedSession}
          onTerminateSelectedSession={onTerminateSelectedSession}
          onTogglePinnedSession={onTogglePinnedSession}
          onWindowResizeStart={onWindowResizeStart}
          onWriteTerminalData={onWriteTerminalData}
          placement={placement}
          rootPath={rootPath}
          selectedCommandSession={selectedCommandSession}
          startCommandPending={startCommandPending}
          terminateDisabled={terminateDisabled}
        />
      ) : null}
    </section>
  )

  if (!isFloating || typeof document === 'undefined') {
    return dock
  }

  return createPortal(
    <div className="terminal-floating-layer">
      <div aria-hidden="true" className="terminal-floating-layer__backdrop" />
      {dock}
    </div>,
    document.body,
  )
}
