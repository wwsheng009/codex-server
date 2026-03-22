import { ThreadTerminalDockBar, ThreadTerminalDockWorkspace } from './ThreadTerminalDockSections'
import type { ThreadTerminalDockProps } from './threadTerminalDockTypes'

export function ThreadTerminalDock({
  activeCommandCount,
  className,
  commandSessions,
  isExpanded,
  onChangeStdinValue,
  onClearCompletedSessions,
  onRemoveSession,
  onResizeStart,
  onSelectSession,
  onSubmitStdin,
  onTerminateSelectedSession,
  onToggleExpanded,
  selectedCommandSession,
  stdinValue,
  terminateDisabled,
}: ThreadTerminalDockProps) {
  return (
    <section className={className}>
      <ThreadTerminalDockBar
        activeCommandCount={activeCommandCount}
        commandSessions={commandSessions}
        isExpanded={isExpanded}
        onClearCompletedSessions={onClearCompletedSessions}
        onToggleExpanded={onToggleExpanded}
        selectedCommandSession={selectedCommandSession}
      />

      {isExpanded ? (
        <ThreadTerminalDockWorkspace
          commandSessions={commandSessions}
          onChangeStdinValue={onChangeStdinValue}
          onRemoveSession={onRemoveSession}
          onResizeStart={onResizeStart}
          onSelectSession={onSelectSession}
          onSubmitStdin={onSubmitStdin}
          onTerminateSelectedSession={onTerminateSelectedSession}
          selectedCommandSession={selectedCommandSession}
          stdinValue={stdinValue}
          terminateDisabled={terminateDisabled}
        />
      ) : null}
    </section>
  )
}
