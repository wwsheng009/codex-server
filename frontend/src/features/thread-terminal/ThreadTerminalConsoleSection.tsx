import { i18n } from '../../i18n/runtime'
import { ThreadTerminalConsoleHeader } from './ThreadTerminalConsoleHeader'
import { ThreadTerminalConsoleHint } from './ThreadTerminalConsoleHint'
import { ThreadTerminalConsoleMeta } from './ThreadTerminalConsoleMeta'
import { ThreadTerminalConsolePanel } from './ThreadTerminalConsolePanel'
import { ThreadTerminalDebugActions } from './ThreadTerminalDebugActions'
import { ThreadTerminalDebugChips } from './ThreadTerminalDebugChips'
import {
  hasThreadTerminalDebugPanelContent,
} from './ThreadTerminalDebugPanel'
import { ThreadTerminalDebugSuggestions } from './ThreadTerminalDebugSuggestions'
import { ThreadTerminalSearchBar } from './ThreadTerminalSearchBar'
import { ThreadTerminalStressComparison } from './ThreadTerminalStressComparison'
import { ThreadTerminalStressSummary } from './ThreadTerminalStressSummary'
import { ThreadTerminalViewportStack } from './ThreadTerminalViewportStack'
import { isTerminalDebugEnabled } from './threadTerminalDebugUtils'
import type {
  ThreadTerminalConsoleSectionState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalConsoleSection({
  debugPanel,
  header,
  hint,
  meta,
  searchBar,
  viewportStack,
}: ThreadTerminalConsoleSectionState) {
  const metaSummary =
    (!meta.isLauncherOpen && meta.selectedCommandSession?.currentCwd) ||
    (!meta.isLauncherOpen && meta.selectedCommandSession?.initialCwd) ||
    meta.rootPath ||
    i18n._({
      id: 'Terminal session metadata',
      message: 'Shell, session, and workspace details',
    })
  const compactMetaSummary = summarizeTerminalPanelSummary(metaSummary)
  const hasDebugPanel = isTerminalDebugEnabled && hasThreadTerminalDebugPanelContent(debugPanel)
  const panelSummaryParts = [
    compactMetaSummary,
    hasDebugPanel
      ? i18n._({
          id: 'Diagnostics summary count',
          message: 'Suggestions {count}',
          values: { count: debugPanel.debugSuggestions.length },
        })
      : null,
    hasDebugPanel && debugPanel.stressRecords.length
      ? i18n._({
          id: 'Diagnostics summary runs count',
          message: 'Runs {count}',
          values: { count: debugPanel.stressRecords.length },
        })
      : null,
  ].filter((value): value is string => Boolean(value))
  const hasDebugDetailBlocks = Boolean(
    debugPanel.displayedStressRun ||
      (debugPanel.stressRecords.length > 1 &&
        debugPanel.selectedStressCompareBaseline &&
        debugPanel.selectedStressCompareTarget),
  )

  return (
    <div className="terminal-dock__console-shell">
      <div className="terminal-dock__console">
        <div className="terminal-dock__console-controls">
          <ThreadTerminalConsoleHeader {...header} />
          {searchBar ? (
            <div className="terminal-dock__console-search-row">
              <ThreadTerminalSearchBar {...searchBar} />
            </div>
          ) : null}
          <div className="terminal-dock__console-panels">
            <ThreadTerminalConsolePanel
              ariaLabel={i18n._({
                id: 'Toggle terminal details',
                message: 'Toggle terminal details',
              })}
              className="terminal-dock__panel--combined"
              summary={
                panelSummaryParts.length ? (
                  <span className="terminal-dock__panel-summary-strip">
                    {panelSummaryParts.map((value) => (
                      <span className="terminal-dock__panel-summary-token" key={value} title={value}>
                        {value}
                      </span>
                    ))}
                  </span>
                ) : undefined
              }
            >
              <div className="terminal-dock__panel-sections terminal-dock__panel-sections--inspector">
                <section className="terminal-dock__panel-section terminal-dock__panel-section--inspector">
                  <div className="terminal-dock__inspector-strip">
                    <div className="terminal-dock__inspector-group terminal-dock__inspector-group--meta">
                      <ThreadTerminalConsoleMeta {...meta} />
                    </div>
                    {hasDebugPanel ? (
                      <>
                        <div className="terminal-dock__inspector-group terminal-dock__inspector-group--debug">
                          <ThreadTerminalDebugChips
                            activeDimensionsInfo={debugPanel.activeDimensionsInfo}
                            activePerformanceInfo={debugPanel.activePerformanceInfo}
                            activeRendererInfo={debugPanel.activeRendererInfo}
                            isInteractive={debugPanel.isInteractive}
                            isLauncherOpen={debugPanel.isLauncherOpen}
                            launcherMode={debugPanel.launcherMode}
                            selectedCommandSession={debugPanel.selectedCommandSession}
                          />
                        </div>
                        <div className="terminal-dock__inspector-group terminal-dock__inspector-group--suggestions">
                          <ThreadTerminalDebugSuggestions
                            debugSuggestions={debugPanel.debugSuggestions}
                          />
                        </div>
                        <div className="terminal-dock__inspector-group terminal-dock__inspector-group--actions">
                          <ThreadTerminalDebugActions
                            displayedStressRun={debugPanel.displayedStressRun}
                            isLauncherOpen={debugPanel.isLauncherOpen}
                            isStressTestActive={debugPanel.isStressTestActive}
                            latestCompletedStressRun={debugPanel.latestCompletedStressRun}
                            onClearStressSummary={debugPanel.onClearStressSummary}
                            onExportStressSummary={debugPanel.onExportStressSummary}
                            onRunStressCommand={debugPanel.onRunStressCommand}
                            startCommandPending={debugPanel.startCommandPending}
                            stressRecords={debugPanel.stressRecords}
                          />
                        </div>
                      </>
                    ) : null}
                  </div>
                </section>
                {hasDebugPanel && hasDebugDetailBlocks ? (
                  <section className="terminal-dock__panel-section terminal-dock__panel-section--details">
                    <div className="terminal-dock__inspector-details">
                      <ThreadTerminalStressSummary displayedStressRun={debugPanel.displayedStressRun} />
                      <ThreadTerminalStressComparison
                        onSelectStressCompareBaseline={debugPanel.onSelectStressCompareBaseline}
                        onSelectStressCompareTarget={debugPanel.onSelectStressCompareTarget}
                        selectedStressCompareBaseline={debugPanel.selectedStressCompareBaseline}
                        selectedStressCompareTarget={debugPanel.selectedStressCompareTarget}
                        stressComparison={debugPanel.stressComparison}
                        stressRecords={debugPanel.stressRecords}
                      />
                    </div>
                  </section>
                ) : null}
              </div>
            </ThreadTerminalConsolePanel>
          </div>
        </div>
        <ThreadTerminalViewportStack {...viewportStack} />
        <ThreadTerminalConsoleHint {...hint} />
      </div>
    </div>
  )
}

function summarizeTerminalPanelSummary(value: string) {
  if (!/[\\/]/.test(value)) {
    return value
  }

  const normalizedValue = value.replace(/[\\/]+$/, '')
  const segments = normalizedValue.split(/[\\/]/).filter(Boolean)
  return segments.length ? segments[segments.length - 1] : value
}
