import type {
  ThreadTerminalStressRunInput,
  ThreadTerminalStressState
} from './threadTerminalStressStateTypes'
import { useThreadTerminalStressHistoryState } from './useThreadTerminalStressHistoryState'
import { useThreadTerminalStressRunState } from './useThreadTerminalStressRunState'

export function useThreadTerminalStressState({
  activeDimensionsInfo,
  activePerformanceInfo,
  activeRenderableSession,
  activeRendererInfo,
  isFloating,
  isLauncherOpen,
  isWindowMaximized,
  onOpenLauncher,
  onStartLauncherCommand,
  placement,
  rootPath,
  selectedCommandSession,
  viewportStackRef,
  workspaceRef,
}: ThreadTerminalStressRunInput): ThreadTerminalStressState {
  const runState = useThreadTerminalStressRunState({
    activeDimensionsInfo,
    activePerformanceInfo,
    activeRenderableSession,
    activeRendererInfo,
    isFloating,
    isLauncherOpen,
    isWindowMaximized,
    onOpenLauncher,
    onStartLauncherCommand,
    placement,
    rootPath,
    selectedCommandSession,
    viewportStackRef,
    workspaceRef,
  })

  const historyState = useThreadTerminalStressHistoryState({
    setStressRun: runState.setStressRun,
    stressRun: runState.stressRun,
  })

  return {
    activeDimensionsInfo,
    activePerformanceInfo,
    activeRendererInfo,
    clearStressSummary: historyState.clearStressSummary,
    debugSuggestions: runState.debugSuggestions,
    displayedStressRun: historyState.displayedStressRun,
    exportStressSummary: historyState.exportStressSummary,
    isStressTestActive: runState.isStressTestActive,
    latestCompletedStressRun: historyState.latestCompletedStressRun,
    runStressCommand: runState.runStressCommand,
    selectStressCompareBaseline: historyState.selectStressCompareBaseline,
    selectStressCompareTarget: historyState.selectStressCompareTarget,
    selectedStressCompareBaseline: historyState.selectedStressCompareBaseline,
    selectedStressCompareTarget: historyState.selectedStressCompareTarget,
    stressComparison: historyState.stressComparison,
    stressRecords: historyState.stressRecords,
  }
}
