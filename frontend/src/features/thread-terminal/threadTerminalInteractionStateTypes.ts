import type { MutableRefObject } from 'react'

import type { SelectOption } from '../../components/ui/SelectControl'
import type {
  TerminalLauncherMode,
  ThreadTerminalCommandSessions,
  ThreadTerminalDockRootPath,
  ThreadTerminalRenderableSession,
  ThreadTerminalSelectSessionHandler,
  ThreadTerminalSelectedCommandSession,
  ThreadTerminalStartCommandLineHandler,
  ThreadTerminalStartCommandPending,
  ThreadTerminalStartShellSessionHandler,
} from './threadTerminalDockTypes'
import type {
  TerminalPerformanceInfo,
  ThreadTerminalLauncherHandle,
  ThreadTerminalViewportHandle,
} from './threadTerminalViewportTypes'

export type ThreadTerminalSearchFeedback = 'idle' | 'not-found'

export type ThreadTerminalSessionSelectionInput = {
  commandSessions: ThreadTerminalCommandSessions
  onSelectSession: ThreadTerminalSelectSessionHandler
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type ThreadTerminalLauncherInput = {
  commandSessions: ThreadTerminalCommandSessions
  onStartCommandLine: ThreadTerminalStartCommandLineHandler
  onStartShellSession: ThreadTerminalStartShellSessionHandler
  rootPath: ThreadTerminalDockRootPath
  startCommandPending: ThreadTerminalStartCommandPending
}

export type ThreadTerminalLauncherStateInput = ThreadTerminalLauncherInput & {
  activeSessionId?: string
  activeSessionsCount: number
  archivedSessionsCount: number
}

export type ThreadTerminalLauncherSearchStateInput = ThreadTerminalLauncherStateInput & {
  clearActiveViewport: () => void
  clearLauncher: () => void
  findNextInActiveViewport: (query: string) => boolean
  findPreviousInActiveViewport: (query: string) => boolean
  focusActiveViewport: () => void
  focusLauncher: () => void
}

export type ThreadTerminalTerminalSearchStateInput = {
  activeSessionId?: string
  findNextInActiveViewport: (query: string) => boolean
  findPreviousInActiveViewport: (query: string) => boolean
  isLauncherOpen: boolean
}

export type ThreadTerminalInteractionInput = ThreadTerminalLauncherInput &
  ThreadTerminalSessionSelectionInput

export type ThreadTerminalRefsState = {
  launcherRef: MutableRefObject<ThreadTerminalLauncherHandle | null>
  viewportRefs: MutableRefObject<Record<string, ThreadTerminalViewportHandle | null>>
  viewportStackRef: MutableRefObject<HTMLDivElement | null>
  workspaceRef: MutableRefObject<HTMLDivElement | null>
}

export type ThreadTerminalLauncherRef = MutableRefObject<ThreadTerminalLauncherHandle | null>
export type ThreadTerminalViewportRefs = MutableRefObject<
  Record<string, ThreadTerminalViewportHandle | null>
>
export type ThreadTerminalViewportStackRef = MutableRefObject<HTMLDivElement | null>
export type ThreadTerminalWorkspaceRef = MutableRefObject<HTMLDivElement | null>

export type ThreadTerminalLauncherState = {
  close: () => void
  defaultShellLauncherName: string
  handleSelectionChange: (hasSelection: boolean) => void
  hasSelection: boolean
  history: string[]
  isOpen: boolean
  mode: TerminalLauncherMode
  newShellSessionTitle: string
  open: (mode: TerminalLauncherMode) => void
  setShell: (value: string) => void
  shell: string
  startCommand: (commandLine: string) => void
  startShellDirect: () => void
  startShellFromLauncher: () => void
  terminalShellOptions: SelectOption[]
}

export type ThreadTerminalSearchState = {
  close: () => void
  feedback: ThreadTerminalSearchFeedback
  isOpen: boolean
  open: () => void
  query: string
  searchNext: () => void
  searchPrevious: () => void
  setQuery: (value: string) => void
  toggle: () => void
}

export type ThreadTerminalLauncherSearchState = {
  launcher: ThreadTerminalLauncherState
  search: ThreadTerminalSearchState
}

export type ThreadTerminalSessionCollectionState = {
  activeSessions: ThreadTerminalCommandSessions
  archivedSessions: ThreadTerminalArchivedSessions
  handleSelectionChange: (sessionId: string, hasSelection: boolean) => void
  hasFinishedSessions: ThreadTerminalHasFinishedSessions
  hasSelectedSessionSelection: ThreadTerminalHasSelectedSessionSelection
  isInteractive: ThreadTerminalIsInteractive
  selectSession: ThreadTerminalSelectSessionHandler
  selectedSessionHasLimitedIntegration: ThreadTerminalSelectedSessionHasLimitedIntegration
  showArchivedSessions: ThreadTerminalShowArchivedSessions
  toggleShowArchivedSessions: ThreadTerminalToggleShowArchivedSessionsHandler
  visibleSessions: ThreadTerminalVisibleSessions
}

export type ThreadTerminalArchivedSessions = ThreadTerminalCommandSessions
export type ThreadTerminalHasFinishedSessions = boolean
export type ThreadTerminalHasSelectedSessionSelection = boolean
export type ThreadTerminalIsInteractive = boolean
export type ThreadTerminalSelectedSessionHasLimitedIntegration = boolean
export type ThreadTerminalSessionSelectionChangeHandler = (
  sessionId: string,
  hasSelection: boolean,
) => void
export type ThreadTerminalShowArchivedSessions = boolean
export type ThreadTerminalToggleShowArchivedSessionsHandler = () => void
export type ThreadTerminalVisibleSessions = ThreadTerminalCommandSessions

export type ThreadTerminalSessionListState = {
  activeSessionId: string | undefined
  selectSession: ThreadTerminalSelectSessionHandler
  sessions: ThreadTerminalSessionCollectionState
}

export type ThreadTerminalInteractionSessionsState = ThreadTerminalSessionCollectionState & {
  activeRenderableSession: ThreadTerminalRenderableSession
  shouldUsePlainTextViewport: ThreadTerminalShouldUsePlainTextViewport
}

export type ThreadTerminalShouldUsePlainTextViewport = boolean

export type ThreadTerminalViewportHandlesStateInput = {
  activeSessionId?: string
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type ThreadTerminalViewportHandleState = {
  clearActiveViewport: () => void
  clearLauncher: () => void
  copyActiveViewportSelection: () => Promise<boolean>
  copyLauncherSelection: () => Promise<boolean>
  findNextInActiveViewport: (query: string) => boolean
  findPreviousInActiveViewport: (query: string) => boolean
  fitActiveViewport: () => void
  fitLauncher: () => void
  focusActiveViewport: () => void
  focusLauncher: () => void
  getActiveViewportDimensionsInfo: () => string
  getActiveViewportPerformanceInfo: () => TerminalPerformanceInfo
  getActiveViewportRendererInfo: () => string
  getLauncherDimensionsInfo: () => string
  getLauncherPerformanceInfo: () => TerminalPerformanceInfo
  getLauncherRendererInfo: () => string
  pasteActiveViewportClipboard: () => Promise<boolean>
  pasteLauncherClipboard: () => Promise<boolean>
}

export type ThreadTerminalViewportHandlesState = {
  refs: ThreadTerminalRefsState
  viewportSession: ThreadTerminalViewportHandleState
}

export type ThreadTerminalViewportSessionState = {
  activeSessionId: string | undefined
  refs: ThreadTerminalRefsState
  selectSession: (processId: string) => void
  sessions: ThreadTerminalSessionCollectionState
  viewportSession: ThreadTerminalViewportHandleState
}

export type ThreadTerminalViewportRuntimeStateInput = {
  getActiveViewportDimensionsInfo: () => string
  getActiveViewportPerformanceInfo: () => TerminalPerformanceInfo
  getActiveViewportRendererInfo: () => string
  getLauncherDimensionsInfo: () => string
  getLauncherPerformanceInfo: () => TerminalPerformanceInfo
  getLauncherRendererInfo: () => string
  isLauncherOpen: boolean
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type ThreadTerminalViewportRuntimeState = {
  activeDimensionsInfo: string
  activePerformanceInfo: TerminalPerformanceInfo
  activeRenderableSession: ThreadTerminalRenderableSession
  activeRendererInfo: string
  shouldUsePlainTextViewport: boolean
}

export type ThreadTerminalViewportActionsState = {
  clear: () => void
  copySelection: () => void
  fit: () => void
  focus: () => void
  pasteClipboard: () => void
}

export type ThreadTerminalViewportActionStateInput = {
  clearActiveViewport: () => void
  clearLauncher: () => void
  copyActiveViewportSelection: () => Promise<boolean>
  copyLauncherSelection: () => Promise<boolean>
  fitActiveViewport: () => void
  fitLauncher: () => void
  focusActiveViewport: () => void
  focusLauncher: () => void
  isLauncherOpen: boolean
  onCloseLauncher: () => void
  onSelectSession: ThreadTerminalSelectSessionHandler
  pasteActiveViewportClipboard: () => Promise<boolean>
  pasteLauncherClipboard: () => Promise<boolean>
}

export type ThreadTerminalViewportActionState = {
  selectSession: ThreadTerminalSelectSessionHandler
  viewport: ThreadTerminalViewportActionsState
}

export type ThreadTerminalInteractionState = {
  activeDimensionsInfo: string
  activePerformanceInfo: TerminalPerformanceInfo
  activeRenderableSession: ThreadTerminalRenderableSession
  activeRendererInfo: string
  launcher: ThreadTerminalLauncherState
  refs: ThreadTerminalRefsState
  search: ThreadTerminalSearchState
  sessions: ThreadTerminalInteractionSessionsState
  viewport: ThreadTerminalViewportActionsState
}
