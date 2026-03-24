import { i18n } from '../../i18n/runtime'
import {
  formatStressDuration,
  formatStressMetric,
} from './threadTerminalStressHelpers'
import type {
  ThreadTerminalStressSummaryState
} from './threadTerminalStressStateTypes'

export function ThreadTerminalStressSummary({
  displayedStressRun,
}: ThreadTerminalStressSummaryState) {
  if (!displayedStressRun) {
    return null
  }

  return (
    <div className="terminal-dock__debug-summary">
      <strong>
        {displayedStressRun.status === 'completed'
          ? i18n._({
              id: 'Stress test summary',
              message: 'Stress test summary',
            })
          : i18n._({
              id: 'Stress test running',
              message: 'Stress test running',
            })}
      </strong>
      <div className="terminal-dock__debug-summary-grid">
        <span>{`session:${displayedStressRun.sessionId ?? 'pending'}`}</span>
        <span>{`renderer:${displayedStressRun.config.renderer}`}</span>
        <span>{`terminal:${displayedStressRun.config.terminalSize}`}</span>
        <span>{`viewport:${displayedStressRun.config.viewportPx}`}</span>
        <span>{`dock:${displayedStressRun.config.workspacePx}`}</span>
        <span>{`placement:${displayedStressRun.config.placement}`}</span>
        <span>{`floating:${displayedStressRun.config.isFloating ? 'yes' : 'no'}`}</span>
        <span>{`maximized:${displayedStressRun.config.isWindowMaximized ? 'yes' : 'no'}`}</span>
        <span>{`scrollback:${formatStressMetric(displayedStressRun.config.scrollback)}`}</span>
        <span>{`output cap:${formatStressMetric(displayedStressRun.config.outputLimit)}`}</span>
        <span>{`duration:${formatStressDuration(displayedStressRun.durationMs)}`}</span>
        <span>{`peak rate:${formatStressMetric(displayedStressRun.metrics.peakRate)}/s`}</span>
        <span>{`peak flush/s:${formatStressMetric(displayedStressRun.metrics.peakFlushRate)}`}</span>
        <span>{`peak chunk:${formatStressMetric(displayedStressRun.metrics.peakChunk)}`}</span>
        <span>{`peak output:${formatStressMetric(displayedStressRun.metrics.peakOutput)}`}</span>
      </div>
    </div>
  )
}
