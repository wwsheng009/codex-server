import { i18n } from '../../i18n/runtime'
import type {
  ThreadTerminalDebugActionsState
} from './threadTerminalStressStateTypes'

export function ThreadTerminalDebugActions({
  displayedStressRun,
  isLauncherOpen,
  isStressTestActive,
  latestCompletedStressRun,
  onClearStressSummary,
  onExportStressSummary,
  onRunStressCommand,
  startCommandPending,
  stressRecords,
}: ThreadTerminalDebugActionsState) {
  return (
    <div className="terminal-dock__debug-actions">
      {!isLauncherOpen ? (
        <button
          className="terminal-dock__debug-action"
          disabled={startCommandPending || isStressTestActive}
          onClick={onRunStressCommand}
          type="button"
        >
          {isStressTestActive
            ? i18n._({
                id: 'Stress test running…',
                message: 'Stress test running…',
              })
            : i18n._({
                id: 'Run stress test',
                message: 'Run stress test',
              })}
        </button>
      ) : null}
      {latestCompletedStressRun ? (
        <button
          className="terminal-dock__debug-action terminal-dock__debug-action--secondary"
          onClick={onExportStressSummary}
          type="button"
        >
          {i18n._({
            id: 'Export latest JSON',
            message: 'Export latest JSON',
          })}
        </button>
      ) : null}
      {displayedStressRun || stressRecords.length ? (
        <button
          className="terminal-dock__debug-action terminal-dock__debug-action--secondary"
          onClick={onClearStressSummary}
          type="button"
        >
          {i18n._({
            id: 'Clear summary',
            message: 'Clear summary',
          })}
        </button>
      ) : null}
    </div>
  )
}
