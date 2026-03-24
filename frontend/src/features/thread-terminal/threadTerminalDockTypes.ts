import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'

import type { TerminalDockPlacement } from '../../lib/layout-config'
import type { CommandRuntimeSession } from '../../stores/session-store'

export type TerminalLauncherMode = 'shell' | 'command'
export type ThreadTerminalCommandSession = CommandRuntimeSession
export type ThreadTerminalCommandSessions = ThreadTerminalCommandSession[]
export type ThreadTerminalCommandSessionsCount = number

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
  onStartShellSession: (shell?: string) => void
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

export type ThreadTerminalSelectSessionHandler = (processId: string) => void
export type ThreadTerminalStartShellSessionHandler = (shell?: string) => void
export type ThreadTerminalStartCommandLineHandler = (command: string) => void
export type ThreadTerminalActiveCommandCount = number
export type ThreadTerminalChangePlacementHandler = (value: TerminalDockPlacement) => void
export type ThreadTerminalClearCompletedSessionsHandler = () => void
export type ThreadTerminalDockExpanded = boolean
export type ThreadTerminalDockFloating = boolean
export type ThreadTerminalResizeStartHandler = (
  event: ReactPointerEvent<HTMLButtonElement>,
) => void
export type ThreadTerminalDockStyle = CSSProperties | undefined
export type ThreadTerminalDockVisible = boolean
export type ThreadTerminalDragStartHandler = (
  event: ReactPointerEvent<HTMLButtonElement>,
) => void
export type ThreadTerminalHideHandler = () => void
export type ThreadTerminalRemoveSessionHandler = (processId: string) => void
export type ThreadTerminalResetFloatingBoundsHandler = () => void
export type ThreadTerminalSelectedCommandSession = ThreadTerminalCommandSession | undefined
export type ThreadTerminalDockPlacement = TerminalDockPlacement
export type ThreadTerminalDockRootPath = string | undefined
export type ThreadTerminalResizeTerminalHandler = (cols: number, rows: number) => void
export type ThreadTerminalShowHandler = () => void
export type ThreadTerminalStartCommandPending = boolean
export type ThreadTerminalTerminateDisabled = boolean
export type ThreadTerminalTerminateSelectedSessionHandler = () => void
export type ThreadTerminalToggleArchivedSessionHandler = (processId: string) => void
export type ThreadTerminalToggleExpandedHandler = () => void
export type ThreadTerminalTogglePinnedSessionHandler = (processId: string) => void
export type ThreadTerminalToggleWindowMaximizedHandler = () => void
export type ThreadTerminalWindowMaximized = boolean
export type ThreadTerminalWindowResizeStartHandler = (
  event: ReactPointerEvent<HTMLButtonElement>,
) => void
export type ThreadTerminalWriteTerminalDataHandler = (input: string) => void

export type ThreadTerminalWorkspaceInput = {
  commandSessions: ThreadTerminalCommandSessions
  isFloating: ThreadTerminalDockFloating
  isWindowMaximized: ThreadTerminalWindowMaximized
  onClearCompletedSessions: ThreadTerminalClearCompletedSessionsHandler
  onRemoveSession: ThreadTerminalRemoveSessionHandler
  onResizeStart: ThreadTerminalResizeStartHandler
  onResizeTerminal: ThreadTerminalResizeTerminalHandler
  onSelectSession: ThreadTerminalSelectSessionHandler
  onStartShellSession: ThreadTerminalStartShellSessionHandler
  onStartCommandLine: ThreadTerminalStartCommandLineHandler
  onTerminateSelectedSession: ThreadTerminalTerminateSelectedSessionHandler
  onToggleArchivedSession: ThreadTerminalToggleArchivedSessionHandler
  onTogglePinnedSession: ThreadTerminalTogglePinnedSessionHandler
  onWindowResizeStart: ThreadTerminalWindowResizeStartHandler
  onWriteTerminalData: ThreadTerminalWriteTerminalDataHandler
  placement: ThreadTerminalDockPlacement
  rootPath: ThreadTerminalDockRootPath
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  startCommandPending: ThreadTerminalStartCommandPending
  terminateDisabled: ThreadTerminalTerminateDisabled
}

export type ThreadTerminalRenderableSession = ThreadTerminalSelectedCommandSession | undefined
