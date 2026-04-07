import { ThreadTerminalDebugActions } from './ThreadTerminalDebugActions'
import { ThreadTerminalDebugChips } from './ThreadTerminalDebugChips'
import { ThreadTerminalDebugSuggestions } from './ThreadTerminalDebugSuggestions'
import { ThreadTerminalStressComparison } from './ThreadTerminalStressComparison'
import { ThreadTerminalStressSummary } from './ThreadTerminalStressSummary'
import type {
  ThreadTerminalDebugPanelState
} from './threadTerminalStressStateTypes'

export function hasThreadTerminalDebugPanelContent({
  debugSuggestions,
  displayedStressRun,
  isLauncherOpen,
  stressRecords,
}: Pick<
  ThreadTerminalDebugPanelState,
  'debugSuggestions' | 'displayedStressRun' | 'isLauncherOpen' | 'stressRecords'
>) {
  return Boolean(
    debugSuggestions.length || !isLauncherOpen || displayedStressRun || stressRecords.length,
  )
}

export function ThreadTerminalDebugPanel({
  activeDimensionsInfo,
  activePerformanceInfo,
  activeRendererInfo,
  debugSuggestions,
  displayedStressRun,
  isInteractive,
  isLauncherOpen,
  isStressTestActive,
  latestCompletedStressRun,
  launcherMode,
  selectedCommandSession,
  selectedStressCompareBaseline,
  selectedStressCompareTarget,
  startCommandPending,
  stressComparison,
  stressRecords,
  onClearStressSummary,
  onExportStressSummary,
  onRunStressCommand,
  onSelectStressCompareBaseline,
  onSelectStressCompareTarget,
}: ThreadTerminalDebugPanelState) {
  if (
    !hasThreadTerminalDebugPanelContent({
      debugSuggestions,
      displayedStressRun,
      isLauncherOpen,
      stressRecords,
    })
  ) {
    return null
  }

  return (
    <div className="terminal-dock__debug-panel">
      <ThreadTerminalDebugChips
        activeDimensionsInfo={activeDimensionsInfo}
        activePerformanceInfo={activePerformanceInfo}
        activeRendererInfo={activeRendererInfo}
        isInteractive={isInteractive}
        isLauncherOpen={isLauncherOpen}
        launcherMode={launcherMode}
        selectedCommandSession={selectedCommandSession}
      />

      <ThreadTerminalDebugActions
        displayedStressRun={displayedStressRun}
        isLauncherOpen={isLauncherOpen}
        isStressTestActive={isStressTestActive}
        latestCompletedStressRun={latestCompletedStressRun}
        onClearStressSummary={onClearStressSummary}
        onExportStressSummary={onExportStressSummary}
        onRunStressCommand={onRunStressCommand}
        startCommandPending={startCommandPending}
        stressRecords={stressRecords}
      />

      <ThreadTerminalDebugSuggestions debugSuggestions={debugSuggestions} />

      <ThreadTerminalStressSummary displayedStressRun={displayedStressRun} />
      <ThreadTerminalStressComparison
        onSelectStressCompareBaseline={onSelectStressCompareBaseline}
        onSelectStressCompareTarget={onSelectStressCompareTarget}
        selectedStressCompareBaseline={selectedStressCompareBaseline}
        selectedStressCompareTarget={selectedStressCompareTarget}
        stressComparison={stressComparison}
        stressRecords={stressRecords}
      />
    </div>
  )
}
