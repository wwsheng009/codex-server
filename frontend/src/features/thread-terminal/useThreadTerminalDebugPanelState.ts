import type {
  ThreadTerminalDebugPanelState,
  ThreadTerminalDebugPanelStateInput
} from './threadTerminalStressStateTypes'

export function useThreadTerminalDebugPanelState({
  activeDimensionsInfo,
  activePerformanceInfo,
  activeRendererInfo,
  isInteractive,
  isLauncherOpen,
  launcherMode,
  selectedCommandSession,
  startCommandPending,
  stressState,
}: ThreadTerminalDebugPanelStateInput): ThreadTerminalDebugPanelState {
  return {
    activeDimensionsInfo,
    activePerformanceInfo,
    activeRendererInfo,
    debugSuggestions: stressState.debugSuggestions,
    displayedStressRun: stressState.displayedStressRun,
    isInteractive,
    isLauncherOpen,
    isStressTestActive: stressState.isStressTestActive,
    latestCompletedStressRun: stressState.latestCompletedStressRun,
    launcherMode,
    onClearStressSummary: stressState.clearStressSummary,
    onExportStressSummary: stressState.exportStressSummary,
    onRunStressCommand: stressState.runStressCommand,
    onSelectStressCompareBaseline: stressState.selectStressCompareBaseline,
    onSelectStressCompareTarget: stressState.selectStressCompareTarget,
    selectedCommandSession,
    selectedStressCompareBaseline: stressState.selectedStressCompareBaseline,
    selectedStressCompareTarget: stressState.selectedStressCompareTarget,
    startCommandPending,
    stressComparison: stressState.stressComparison,
    stressRecords: stressState.stressRecords,
  }
}
