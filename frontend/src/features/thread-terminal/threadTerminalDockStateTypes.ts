import type {
  ThreadTerminalActiveCommandCount,
  ThreadTerminalChangePlacementHandler,
  ThreadTerminalCommandSessions,
  ThreadTerminalDockPlacement,
  ThreadTerminalDockExpanded,
  ThreadTerminalDockFloating,
  ThreadTerminalDockStyle,
  ThreadTerminalDockVisible,
  ThreadTerminalDragStartHandler,
  ThreadTerminalHideHandler,
  ThreadTerminalResizeStartHandler,
  ThreadTerminalResetFloatingBoundsHandler,
  ThreadTerminalSelectSessionHandler,
  ThreadTerminalSelectedCommandSession,
  ThreadTerminalShowHandler,
  ThreadTerminalToggleExpandedHandler,
  ThreadTerminalToggleWindowMaximizedHandler,
  ThreadTerminalWindowMaximized,
  ThreadTerminalWindowResizeStartHandler,
  ThreadTerminalWorkspaceInput,
} from './threadTerminalDockTypes'
import type { ThreadTerminalConsoleSectionState } from './threadTerminalConsoleStateTypes'
import type {
  ThreadTerminalArchivedSessions,
  ThreadTerminalShowArchivedSessions,
  ThreadTerminalToggleShowArchivedSessionsHandler,
  ThreadTerminalVisibleSessions,
  ThreadTerminalWorkspaceRef,
} from './threadTerminalInteractionStateTypes'

export type ThreadTerminalDockPlacementSwitchState = {
  onChangePlacement: ThreadTerminalChangePlacementHandler
  placement: ThreadTerminalDockPlacement
}

export type ThreadTerminalDockBarCopyState = {
  activeCommandCount: ThreadTerminalActiveCommandCount
  commandSessionsCount: number
  dragHandleDisabled: boolean
  isFloating: boolean
  onDragStart: ThreadTerminalDragStartHandler
}

export type BuildThreadTerminalDockBarCopyStateInput = {
  activeCommandCount: ThreadTerminalActiveCommandCount
  commandSessions: ThreadTerminalCommandSessions
  isFloating: ThreadTerminalDockFloating
  isWindowMaximized: ThreadTerminalWindowMaximized
  onDragStart: ThreadTerminalDragStartHandler
}

export type ThreadTerminalDockBarWindowActionsState = {
  isWindowMaximized: ThreadTerminalWindowMaximized
  onResetFloatingBounds: ThreadTerminalResetFloatingBoundsHandler
  onToggleWindowMaximized: ThreadTerminalToggleWindowMaximizedHandler
}

export type BuildThreadTerminalDockBarWindowActionsStateInput = {
  isFloating: ThreadTerminalDockFloating
  isWindowMaximized: ThreadTerminalWindowMaximized
  onResetFloatingBounds: ThreadTerminalResetFloatingBoundsHandler
  onToggleWindowMaximized: ThreadTerminalToggleWindowMaximizedHandler
}

export type ThreadTerminalDockBarPrimaryActionsState = {
  hideActionVisible: boolean
  isExpanded: ThreadTerminalDockExpanded
  onHide: ThreadTerminalHideHandler
  onToggleExpanded: ThreadTerminalToggleExpandedHandler
  placementSwitch: ThreadTerminalDockPlacementSwitchState
}

export type BuildThreadTerminalDockBarPrimaryActionsStateInput = {
  isExpanded: ThreadTerminalDockExpanded
  isVisible: ThreadTerminalDockVisible
  onChangePlacement: ThreadTerminalChangePlacementHandler
  onHide: ThreadTerminalHideHandler
  onToggleExpanded: ThreadTerminalToggleExpandedHandler
  placement: ThreadTerminalDockPlacement
}

export type ThreadTerminalDockBarState = {
  copy: ThreadTerminalDockBarCopyState
  primaryActions: ThreadTerminalDockBarPrimaryActionsState
  windowActions: ThreadTerminalDockBarWindowActionsState | null
}

export type BuildThreadTerminalDockBarStateInput = {
  activeCommandCount: ThreadTerminalActiveCommandCount
  commandSessions: ThreadTerminalCommandSessions
  isExpanded: ThreadTerminalDockExpanded
  isFloating: ThreadTerminalDockFloating
  isVisible: ThreadTerminalDockVisible
  isWindowMaximized: ThreadTerminalWindowMaximized
  onChangePlacement: ThreadTerminalChangePlacementHandler
  onDragStart: ThreadTerminalDragStartHandler
  onHide: ThreadTerminalHideHandler
  onResetFloatingBounds: ThreadTerminalResetFloatingBoundsHandler
  onToggleExpanded: ThreadTerminalToggleExpandedHandler
  onToggleWindowMaximized: ThreadTerminalToggleWindowMaximizedHandler
  placement: ThreadTerminalDockPlacement
}

export type ThreadTerminalDockRevealState = {
  className: string
  onShow: ThreadTerminalShowHandler
}

export type BuildThreadTerminalDockPlacementSwitchStateInput = {
  onChangePlacement: ThreadTerminalChangePlacementHandler
  placement: ThreadTerminalDockPlacement
}

export type ThreadTerminalDockRevealStateInput = {
  isFloating: ThreadTerminalDockFloating
  onShow: ThreadTerminalShowHandler
}

export type ThreadTerminalDockState = {
  bar: ThreadTerminalDockBarState
  dockStyle: ThreadTerminalDockStyle
  isExpanded: ThreadTerminalDockExpanded
  isFloating: ThreadTerminalDockFloating
  isVisible: ThreadTerminalDockVisible
  reveal: ThreadTerminalDockRevealState
  workspaceInput: ThreadTerminalWorkspaceInput
}

export type ThreadTerminalDockStyleInput = {
  isExpanded: ThreadTerminalDockExpanded
  isFloating: ThreadTerminalDockFloating
  style?: ThreadTerminalDockStyle
}

export type ThreadTerminalWorkspaceResizeHandleState = {
  onResizeStart: ThreadTerminalResizeStartHandler
}

export type ThreadTerminalWorkspaceWindowResizeHandleState = {
  onWindowResizeStart: ThreadTerminalWindowResizeStartHandler
}

export type ThreadTerminalWorkspaceResizeStateInput = {
  onResizeStart: ThreadTerminalResizeStartHandler
  placement: ThreadTerminalDockPlacement
}

export type ThreadTerminalWorkspaceWindowResizeStateInput = {
  isFloating: ThreadTerminalDockFloating
  isWindowMaximized: ThreadTerminalWindowMaximized
  onWindowResizeStart: ThreadTerminalWindowResizeStartHandler
}

export type ThreadTerminalWorkspaceLayoutStateInput = ThreadTerminalWorkspaceResizeStateInput &
  ThreadTerminalWorkspaceWindowResizeStateInput

export type ThreadTerminalWorkspaceState = {
  consoleSection: ThreadTerminalConsoleSectionState
  resizeHandle: ThreadTerminalWorkspaceResizeHandleState | null
  sessionTabsSection: ThreadTerminalSessionTabsSectionState
  windowResizeHandle: ThreadTerminalWorkspaceWindowResizeHandleState | null
  workspaceRef: ThreadTerminalWorkspaceRef
}

export type BuildThreadTerminalDockWorkspaceStateInput = {
  consoleSection: ThreadTerminalConsoleSectionState
  layout: ThreadTerminalWorkspaceLayoutStateInput
  sessionTabsSection: ThreadTerminalSessionTabsSectionState
  workspaceRef: ThreadTerminalWorkspaceRef
}

export type ThreadTerminalSessionTabsStateSessions = {
  archivedSessions: ThreadTerminalArchivedSessions
  selectSession: ThreadTerminalSelectSessionHandler
  showArchivedSessions: ThreadTerminalShowArchivedSessions
  toggleShowArchivedSessions: ThreadTerminalToggleShowArchivedSessionsHandler
  visibleSessions: ThreadTerminalVisibleSessions
}

export type ThreadTerminalSessionTabState = {
  archived: boolean
  command: string
  isActive: boolean
  onArchiveSession: (processId: string) => void
  onPinSession: (processId: string) => void
  onRemoveSession: (processId: string) => void
  onSelectSession: ThreadTerminalSelectSessionHandler
  pinned: boolean
  sessionId: string
  status: string
  title: string
  updatedAt?: string
}

export type ThreadTerminalSessionTabsSectionState = {
  isLauncherOpen: boolean
  onArchiveSession: (processId: string) => void
  onPinSession: (processId: string) => void
  onRemoveSession: (processId: string) => void
  placement: ThreadTerminalDockPlacement
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  sessions: ThreadTerminalSessionTabsStateSessions
}

export type BuildThreadTerminalSessionTabsSectionStateInput = {
  isLauncherOpen: boolean
  onArchiveSession: (processId: string) => void
  onPinSession: (processId: string) => void
  onRemoveSession: (processId: string) => void
  placement: ThreadTerminalDockPlacement
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  sessions: ThreadTerminalSessionTabsStateSessions
}
