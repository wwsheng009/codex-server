import type { Dispatch, SetStateAction } from 'react'

import type {
  TerminalLauncherMode,
  ThreadTerminalDockPlacement,
  ThreadTerminalDockRootPath,
  ThreadTerminalRenderableSession,
  ThreadTerminalSelectedCommandSession,
} from './threadTerminalDockTypes'
import type {
  ThreadTerminalViewportStackRef,
  ThreadTerminalWorkspaceRef,
} from './threadTerminalInteractionStateTypes'
import type {
  CompletedTerminalStressRun,
  TerminalStressComparison,
  TerminalStressRun,
} from './threadTerminalStressDomain'
import type { TerminalPerformanceInfo } from './threadTerminalViewportTypes'

export type ThreadTerminalOpenLauncherHandler = (mode: TerminalLauncherMode) => void
export type ThreadTerminalStartLauncherCommandHandler = (commandLine: string) => void

export type ThreadTerminalDebugSuggestionsInput = {
  dimensionsInfo: string
  outputLength: number
  rate: number
  renderer: string
}

export type ThreadTerminalRendererDebugToneInput = {
  outputLength: number
  rate: number
  renderer: string
}

export type ThreadTerminalStressRunInput = {
  activeDimensionsInfo: string
  activePerformanceInfo: TerminalPerformanceInfo
  activeRenderableSession: ThreadTerminalRenderableSession
  activeRendererInfo: string
  isFloating: boolean
  isLauncherOpen: boolean
  isWindowMaximized: boolean
  onOpenLauncher: ThreadTerminalOpenLauncherHandler
  onStartLauncherCommand: ThreadTerminalStartLauncherCommandHandler
  placement: ThreadTerminalDockPlacement
  rootPath: ThreadTerminalDockRootPath
  selectedCommandSession: ThreadTerminalSelectedCommandSession
  viewportStackRef: ThreadTerminalViewportStackRef
  workspaceRef: ThreadTerminalWorkspaceRef
}

export type ThreadTerminalStressExportInput = {
  baseline?: CompletedTerminalStressRun | null
  comparison?: TerminalStressComparison | null
  latest: CompletedTerminalStressRun
}

export type ThreadTerminalStressHistoryStateInput = {
  setStressRun: Dispatch<SetStateAction<TerminalStressRun | null>>
  stressRun: TerminalStressRun | null
}

export type ThreadTerminalStressRuntimeState = {
  debugSuggestions: string[]
  isStressTestActive: boolean
  runStressCommand: () => void
}

export type ThreadTerminalStressRunState =
  ThreadTerminalStressHistoryStateInput & ThreadTerminalStressRuntimeState

export type ThreadTerminalStressHistoryState = {
  clearStressSummary: () => void
  displayedStressRun: TerminalStressRun | CompletedTerminalStressRun | null
  exportStressSummary: () => void
  latestCompletedStressRun: CompletedTerminalStressRun | null
  selectStressCompareBaseline: (value: string) => void
  selectStressCompareTarget: (value: string) => void
  selectedStressCompareBaseline: CompletedTerminalStressRun | null
  selectedStressCompareTarget: CompletedTerminalStressRun | null
  stressComparison: TerminalStressComparison | null
  stressRecords: CompletedTerminalStressRun[]
}

export type ThreadTerminalStressState = ThreadTerminalStressHistoryState &
  ThreadTerminalStressRuntimeState & {
    activeDimensionsInfo: string
    activePerformanceInfo: TerminalPerformanceInfo
    activeRendererInfo: string
  }

export type ThreadTerminalDebugChipsState = {
  activeDimensionsInfo: string
  activePerformanceInfo: TerminalPerformanceInfo
  activeRendererInfo: string
  isInteractive: boolean
  isLauncherOpen: boolean
  launcherMode: TerminalLauncherMode
  selectedCommandSession: ThreadTerminalSelectedCommandSession
}

export type ThreadTerminalDebugSuggestionsState = {
  debugSuggestions: string[]
}

export type ThreadTerminalDebugPanelStressState =
  ThreadTerminalStressHistoryState & ThreadTerminalStressRuntimeState

export type ThreadTerminalDebugPanelStateInput = ThreadTerminalDebugChipsState & {
  startCommandPending: boolean
  stressState: ThreadTerminalDebugPanelStressState
}

export type ThreadTerminalDebugPanelState = ThreadTerminalDebugActionsState &
  ThreadTerminalDebugChipsState &
  ThreadTerminalDebugSuggestionsState &
  ThreadTerminalStressComparisonState &
  ThreadTerminalStressSummaryState

export type ThreadTerminalDebugActionsState = {
  displayedStressRun: TerminalStressRun | CompletedTerminalStressRun | null
  isLauncherOpen: boolean
  isStressTestActive: boolean
  latestCompletedStressRun: CompletedTerminalStressRun | null
  onClearStressSummary: () => void
  onExportStressSummary: () => void
  onRunStressCommand: () => void
  startCommandPending: boolean
  stressRecords: CompletedTerminalStressRun[]
}

export type ThreadTerminalStressSummaryState = {
  displayedStressRun: TerminalStressRun | CompletedTerminalStressRun | null
}

export type ThreadTerminalStressComparisonState = {
  selectedStressCompareBaseline: CompletedTerminalStressRun | null
  selectedStressCompareTarget: CompletedTerminalStressRun | null
  stressComparison: TerminalStressComparison | null
  stressRecords: CompletedTerminalStressRun[]
  onSelectStressCompareBaseline: (value: string) => void
  onSelectStressCompareTarget: (value: string) => void
}
