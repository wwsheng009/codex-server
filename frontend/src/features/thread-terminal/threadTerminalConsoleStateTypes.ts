import type { SelectOption } from '../../components/ui/selectControlTypes'
import type {
  TerminalLauncherMode,
  ThreadTerminalCommandSessionsCount,
  ThreadTerminalDockRootPath,
  ThreadTerminalRenderableSession,
  ThreadTerminalSelectedCommandSession,
} from './threadTerminalDockTypes'
import type {
  ThreadTerminalDebugPanelState,
} from './threadTerminalStressStateTypes'
import type {
  ThreadTerminalHasFinishedSessions,
  ThreadTerminalHasSelectedSessionSelection,
  ThreadTerminalIsInteractive,
  ThreadTerminalLauncherRef,
  ThreadTerminalSearchState,
  ThreadTerminalSearchFeedback,
  ThreadTerminalSelectedSessionHasLimitedIntegration,
  ThreadTerminalSessionSelectionChangeHandler,
  ThreadTerminalShouldUsePlainTextViewport,
  ThreadTerminalViewportActionsState,
  ThreadTerminalViewportRefs,
  ThreadTerminalViewportStackRef,
} from './threadTerminalInteractionStateTypes'

export type ThreadTerminalConsoleHintSessionsState = {
  isInteractive: ThreadTerminalIsInteractive
  selectedSessionHasLimitedIntegration: ThreadTerminalSelectedSessionHasLimitedIntegration
}

export type ThreadTerminalConsoleMetaSessionsState = {
  hasFinishedSessions: ThreadTerminalHasFinishedSessions
}

export type ThreadTerminalToolbarSessionsState = {
  hasSelectedSessionSelection: ThreadTerminalHasSelectedSessionSelection
  isInteractive: ThreadTerminalIsInteractive
}

export type ThreadTerminalViewportStackSessionsState = {
  activeRenderableSession: ThreadTerminalRenderableSession
  handleSelectionChange: ThreadTerminalSessionSelectionChangeHandler
  shouldUsePlainTextViewport: ThreadTerminalShouldUsePlainTextViewport
}

export type ThreadTerminalConsoleSectionSessionsState =
  ThreadTerminalConsoleHintSessionsState &
    ThreadTerminalConsoleMetaSessionsState &
    ThreadTerminalToolbarSessionsState &
    ThreadTerminalViewportStackSessionsState

export type ThreadTerminalConsoleTitleState = {
  statusTone: string
  subtitle: string
  title: string
}

export type ThreadTerminalConsoleHintLauncherState = {
  defaultShellLauncherName: string
  isOpen: boolean
  mode: TerminalLauncherMode
}

export type ThreadTerminalConsoleMetaLauncherState = {
  isOpen: boolean
}

export type ThreadTerminalSearchBarLauncherState = {
  isOpen: boolean
}

export type ThreadTerminalToolbarShellSelectState = {
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  launcherShell: string
  onSetLauncherShell: (value: string) => void
  terminalShellOptions: SelectOption[]
}

export type ThreadTerminalToolbarLauncherState = {
  close: () => void
  defaultShellLauncherName: string
  hasSelection: boolean
  isOpen: boolean
  mode: TerminalLauncherMode
  newShellSessionTitle: string
  open: (mode: TerminalLauncherMode) => void
  setShell: (value: string) => void
  shell: string
  startShellDirect: () => void
  terminalShellOptions: SelectOption[]
}

export type ThreadTerminalToolbarLaunchActionsState = {
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  onOpenCommandLauncher: () => void
  onStartShellSession: () => void
  shellActionLabel: string
  shellActionTitle: string
  shellSelect: ThreadTerminalToolbarShellSelectState | null
  startSessionPending?: boolean
}

export type ThreadTerminalToolbarViewportActionsState = {
  canCopy: boolean
  canPaste: boolean
  onClearViewport: () => void
  onCopySelection: () => void
  onFitViewport: () => void
  onFocusViewport: () => void
  onPasteClipboard: () => void
  onSearchTerminal: () => void
  searchDisabled: boolean
}

export type ThreadTerminalToolbarSessionActionsState = {
  canArchiveSelectedSession: boolean
  canPinSelectedSession: boolean
  commandSessionsCount: number
  isLauncherOpen: boolean
  isSelectedSessionArchived: boolean
  isSelectedSessionPinned: boolean
  onArchiveSelectedSession: () => void
  onBackToSession: () => void
  onStopSession: () => void
  onTogglePinSelectedSession: () => void
  terminateDisabled: boolean
}

export type ThreadTerminalToolbarState = {
  launchActions: ThreadTerminalToolbarLaunchActionsState
  sessionActions: ThreadTerminalToolbarSessionActionsState
  viewportActions: ThreadTerminalToolbarViewportActionsState
}

export type ThreadTerminalConsoleHeaderState = {
  consoleTitle: ThreadTerminalConsoleTitleState
  toolbar: ThreadTerminalToolbarState
}

export type BuildThreadTerminalConsoleTitleStateInput = {
  defaultShellLauncherName: string
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  newShellSessionTitle: string
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type BuildThreadTerminalConsoleTitleCopyInput = {
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  newShellSessionTitle: string
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type BuildThreadTerminalConsoleSubtitleCopyInput = {
  defaultShellLauncherName: string
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type ThreadTerminalSearchBarState = {
  feedback: ThreadTerminalSearchFeedback
  onChangeQuery: (value: string) => void
  onClose: () => void
  onSearchNext: () => void
  onSearchPrevious: () => void
  query: string
}

export type BuildThreadTerminalSearchBarStateInput = {
  launcher: ThreadTerminalSearchBarLauncherState
  search: ThreadTerminalSearchState
}

export type ThreadTerminalConsoleMetaState = {
  hasFinishedSessions: boolean
  isLauncherOpen: boolean
  onClearCompletedSessions: () => void
  rootPath: ThreadTerminalDockRootPath
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type BuildThreadTerminalConsoleMetaStateInput = {
  launcher: ThreadTerminalConsoleMetaLauncherState
  onClearCompletedSessions: () => void
  rootPath: ThreadTerminalDockRootPath
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  sessions: ThreadTerminalConsoleMetaSessionsState
}

export type ThreadTerminalConsoleHintState = {
  defaultShellLauncherName: string
  isInteractive: boolean
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  selectedSessionHasLimitedIntegration: boolean
  startCommandPending: boolean
}

export type BuildThreadTerminalConsoleHintStateInput = {
  launcher: ThreadTerminalConsoleHintLauncherState
  sessions: ThreadTerminalConsoleHintSessionsState
  startCommandPending: boolean
}

export type ThreadTerminalViewportStackLauncherState = {
  close: () => void
  defaultShellLauncherName: string
  handleSelectionChange: (hasSelection: boolean) => void
  history: string[]
  isOpen: boolean
  mode: TerminalLauncherMode
  startCommand: (commandLine: string) => void
  startShellFromLauncher: () => void
}

export type ThreadTerminalViewportStackRefsInput = {
  launcherRef: ThreadTerminalLauncherRef
  viewportRefs: ThreadTerminalViewportRefs
  viewportStackRef: ThreadTerminalViewportStackRef
}

export type ThreadTerminalViewportStackState = {
  activeRenderableSession: ThreadTerminalRenderableSession
  commandSessionsCount: ThreadTerminalCommandSessionsCount
  defaultShellLauncherName: string
  isLauncherOpen: boolean
  launcherHistory: string[]
  launcherMode: TerminalLauncherMode
  launcherRef: ThreadTerminalLauncherRef
  onCloseLauncher: () => void
  onLauncherSelectionChange: (hasSelection: boolean) => void
  onResizeTerminal: (cols: number, rows: number) => void
  onSessionSelectionChange: (sessionId: string, hasSelection: boolean) => void
  onStartLauncherCommand: (command: string) => void
  onStartShellFromLauncher: () => void
  onWriteTerminalData: (input: string) => void
  rootPath: ThreadTerminalDockRootPath
  shouldUsePlainTextViewport: boolean
  startCommandPending: boolean
  viewportRefs: ThreadTerminalViewportRefs
  viewportStackRef: ThreadTerminalViewportStackRef
}

export type BuildThreadTerminalViewportStackStateInput = {
  commandSessionsCount: number
  launcher: ThreadTerminalViewportStackLauncherState
  onResizeTerminal: (cols: number, rows: number) => void
  onWriteTerminalData: (input: string) => void
  refs: ThreadTerminalViewportStackRefsInput
  rootPath: ThreadTerminalDockRootPath
  sessions: ThreadTerminalViewportStackSessionsState
  startCommandPending: boolean
}

export type ThreadTerminalConsoleSectionLauncherState =
  ThreadTerminalConsoleHintLauncherState &
    ThreadTerminalConsoleMetaLauncherState &
    ThreadTerminalSearchBarLauncherState &
    ThreadTerminalToolbarLauncherState &
    ThreadTerminalViewportStackLauncherState

export type BuildThreadTerminalToolbarStateInput = {
  commandSessionsCount: number
  launcher: ThreadTerminalToolbarLauncherState
  onStopSession: () => void
  onToggleArchivedSession: (processId: string) => void
  onTogglePinnedSession: (processId: string) => void
  search: ThreadTerminalSearchState
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  sessions: ThreadTerminalToolbarSessionsState
  startCommandPending: boolean
  terminateDisabled: boolean
  viewport: ThreadTerminalViewportActionsState
}

export type BuildThreadTerminalToolbarLaunchActionsStateInput = {
  launcher: ThreadTerminalToolbarLauncherState
  startCommandPending: boolean
}

export type BuildThreadTerminalToolbarViewportActionsStateInput = {
  launcher: ThreadTerminalToolbarLauncherState
  search: ThreadTerminalSearchState
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  sessions: ThreadTerminalToolbarSessionsState
  viewport: ThreadTerminalViewportActionsState
}

export type BuildThreadTerminalToolbarSessionActionsStateInput = {
  commandSessionsCount: number
  launcher: ThreadTerminalToolbarLauncherState
  onStopSession: () => void
  onToggleArchivedSession: (processId: string) => void
  onTogglePinnedSession: (processId: string) => void
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  terminateDisabled: boolean
}

export type BuildThreadTerminalConsoleSectionStateInput = {
  commandSessionsCount: number
  debugPanel: ThreadTerminalDebugPanelState
  launcher: ThreadTerminalConsoleSectionLauncherState
  onClearCompletedSessions: () => void
  onResizeTerminal: (cols: number, rows: number) => void
  onStopSession: () => void
  onToggleArchivedSession: (processId: string) => void
  onTogglePinnedSession: (processId: string) => void
  onWriteTerminalData: (input: string) => void
  refs: ThreadTerminalViewportStackRefsInput
  rootPath: ThreadTerminalDockRootPath
  search: ThreadTerminalSearchState
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  sessions: ThreadTerminalConsoleSectionSessionsState
  startCommandPending: boolean
  terminateDisabled: boolean
  viewport: ThreadTerminalViewportActionsState
}

export type ThreadTerminalConsoleSectionState = {
  debugPanel: ThreadTerminalDebugPanelState
  header: ThreadTerminalConsoleHeaderState
  hint: ThreadTerminalConsoleHintState
  meta: ThreadTerminalConsoleMetaState
  searchBar: ThreadTerminalSearchBarState | null
  viewportStack: ThreadTerminalViewportStackState
}
