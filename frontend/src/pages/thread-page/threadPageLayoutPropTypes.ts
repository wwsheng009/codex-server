import type { CSSProperties, Dispatch, SetStateAction } from 'react'

import type { ThreadTerminalDockProps } from '../../features/thread-terminal'
import type {
  ThreadTerminalActiveCommandCount,
  ThreadTerminalChangePlacementHandler,
  ThreadTerminalClearCompletedSessionsHandler,
  ThreadTerminalCommandSessions,
  ThreadTerminalDockExpanded,
  ThreadTerminalDockPlacement,
  ThreadTerminalDockRootPath,
  ThreadTerminalDockVisible,
  ThreadTerminalDragStartHandler,
  ThreadTerminalHideHandler,
  ThreadTerminalRemoveSessionHandler,
  ThreadTerminalResetFloatingBoundsHandler,
  ThreadTerminalResizeStartHandler,
  ThreadTerminalResizeTerminalHandler,
  ThreadTerminalSelectSessionHandler,
  ThreadTerminalSelectedCommandSession,
  ThreadTerminalShowHandler,
  ThreadTerminalStartCommandLineHandler,
  ThreadTerminalStartCommandPending,
  ThreadTerminalStartShellSessionHandler,
  ThreadTerminalTerminateDisabled,
  ThreadTerminalTerminateSelectedSessionHandler,
  ThreadTerminalToggleArchivedSessionHandler,
  ThreadTerminalTogglePinnedSessionHandler,
  ThreadTerminalToggleWindowMaximizedHandler,
  ThreadTerminalWindowMaximized,
  ThreadTerminalWindowResizeStartHandler,
  ThreadTerminalWriteTerminalDataHandler,
} from '../../features/thread-terminal/threadTerminalDockTypes'
import type { ConfirmDialogProps as ConfirmDialogComponentProps } from '../../components/ui/confirmDialogTypes'
import type { ThreadComposerDockProps } from './threadComposerDockTypes'
import type { ThreadWorkbenchSurfaceProps } from './ThreadWorkbenchSurface'
import type { ThreadWorkbenchRailProps } from './threadWorkbenchRailTypes'
import type {
  BuildThreadPageComposerLayoutPropsInput,
  BuildThreadPageRailLayoutPropsInput,
  BuildThreadPageSurfaceLayoutPropsInput,
} from './threadPageLayoutInputTypes'

export type SurfaceProps = ThreadWorkbenchSurfaceProps
export type ComposerDockProps = ThreadComposerDockProps
export type TerminalDockProps = ThreadTerminalDockProps
export type RailProps = ThreadWorkbenchRailProps
export type ConfirmDialogProps = ConfirmDialogComponentProps

export type ThreadPageTerminalWindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

export type BuildThreadTerminalDockPropsInput = {
  activeCommandCount: ThreadTerminalActiveCommandCount
  commandSessions: ThreadTerminalCommandSessions
  isMobileViewport: boolean
  isTerminalDockExpanded: ThreadTerminalDockExpanded
  isTerminalDockVisible: ThreadTerminalDockVisible
  isTerminalWindowMaximized: ThreadTerminalWindowMaximized
  onChangePlacement: ThreadTerminalChangePlacementHandler
  onClearCompletedSessions: ThreadTerminalClearCompletedSessionsHandler
  onHideTerminalDock: ThreadTerminalHideHandler
  onRemoveSession: ThreadTerminalRemoveSessionHandler
  onResetTerminalWindowBounds: ThreadTerminalResetFloatingBoundsHandler
  onResizeStart: ThreadTerminalResizeStartHandler
  onResizeTerminal: ThreadTerminalResizeTerminalHandler
  onSelectSession: ThreadTerminalSelectSessionHandler
  onShowTerminalDock: ThreadTerminalShowHandler
  onStartTerminalCommandLine: ThreadTerminalStartCommandLineHandler
  onStartTerminalShellSession: ThreadTerminalStartShellSessionHandler
  onStartTerminalWindowDrag: ThreadTerminalDragStartHandler
  onStartTerminalWindowResize: ThreadTerminalWindowResizeStartHandler
  onTerminateSelectedSession: ThreadTerminalTerminateSelectedSessionHandler
  onToggleArchivedSession: ThreadTerminalToggleArchivedSessionHandler
  onTogglePinnedSession: ThreadTerminalTogglePinnedSessionHandler
  onToggleTerminalWindowMaximized: ThreadTerminalToggleWindowMaximizedHandler
  onWriteTerminalData: ThreadTerminalWriteTerminalDataHandler
  placement: ThreadTerminalDockPlacement
  rootPath: ThreadTerminalDockRootPath
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  setIsTerminalDockExpanded: Dispatch<SetStateAction<boolean>>
  startTerminalCommandPending: ThreadTerminalStartCommandPending
  terminalDockClassName: string
  terminalWindowBounds: ThreadPageTerminalWindowBounds
  terminateDisabled: ThreadTerminalTerminateDisabled
}

export type ThreadPageLayoutProps = {
  closeWorkbenchOverlay: () => void
  composerDockProps: ComposerDockProps
  confirmDialogProps?: ConfirmDialogProps | null
  isMobileViewport: boolean
  isMobileWorkbenchOverlayOpen: boolean
  railProps: RailProps
  surfaceProps: SurfaceProps
  terminalDockProps?: TerminalDockProps
  workbenchLayoutStyle: CSSProperties
}

export type BuildThreadPageComposerDockPropsInput = ComposerDockProps

export type BuildThreadPageSurfaceLayoutPropsResult = {
  surfaceProps: SurfaceProps
  terminalDockProps: TerminalDockProps | undefined
}

export type BuildThreadPageRailLayoutPropsResult = {
  confirmDialogProps: ConfirmDialogProps | null
  railProps: RailProps
}

export type BuildThreadPageLayoutPropsResult = {
  composerDockProps: ComposerDockProps
  confirmDialogProps: ConfirmDialogProps | null
  railProps: RailProps
  surfaceProps: SurfaceProps
  terminalDockProps: TerminalDockProps | undefined
}

export type BuildThreadPageLayoutPropsInput =
  BuildThreadPageComposerLayoutPropsInput &
    BuildThreadPageSurfaceLayoutPropsInput &
    BuildThreadPageRailLayoutPropsInput
