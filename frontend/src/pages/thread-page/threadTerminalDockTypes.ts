import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import type { TerminalDockPlacement } from '../../lib/layout-config'
import type { CommandRuntimeSession } from '../../stores/session-store'

export type ThreadTerminalDockProps = {
  activeCommandCount: number
  className: string
  commandSessions: CommandRuntimeSession[]
  isExpanded: boolean
  isFloating: boolean
  isVisible: boolean
  isWindowMaximized: boolean
  onChangePlacement: (value: TerminalDockPlacement) => void
  onClearCompletedSessions: () => void
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onHide: () => void
  onRemoveSession: (processId: string) => void
  onResetFloatingBounds: () => void
  onResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onResizeTerminal: (cols: number, rows: number) => void
  onWindowResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onSelectSession: (processId: string) => void
  onStartShellSession: () => void
  onShow: () => void
  onStartCommandLine: (command: string) => void
  onToggleArchivedSession: (processId: string) => void
  onTerminateSelectedSession: () => void
  onTogglePinnedSession: (processId: string) => void
  onToggleExpanded: () => void
  onToggleWindowMaximized: () => void
  onWriteTerminalData: (input: string) => void
  placement: TerminalDockPlacement
  rootPath?: string
  selectedCommandSession?: CommandRuntimeSession
  style?: CSSProperties
  startCommandPending: boolean
  terminateDisabled: boolean
}
