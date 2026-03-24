import { i18n } from '../../i18n/runtime'
import {
  formatStressComparisonMetricValue,
  formatStressDelta,
  formatStressRunLabel,
  getStressDeltaTone,
} from './threadTerminalStressHelpers'
import type {
  ThreadTerminalStressComparisonState
} from './threadTerminalStressStateTypes'

export function ThreadTerminalStressComparison({
  selectedStressCompareBaseline,
  selectedStressCompareTarget,
  stressComparison,
  stressRecords,
  onSelectStressCompareBaseline,
  onSelectStressCompareTarget,
}: ThreadTerminalStressComparisonState) {
  if (stressRecords.length <= 1 || !selectedStressCompareTarget || !selectedStressCompareBaseline) {
    return null
  }

  return (
    <>
      <div className="terminal-dock__debug-compare-controls">
        <label className="terminal-dock__debug-select">
          <span>
            {i18n._({
              id: 'Compare run',
              message: 'Compare run',
            })}
          </span>
          <select
            onChange={(event) => onSelectStressCompareTarget(event.target.value)}
            value={selectedStressCompareTarget.id}
          >
            {stressRecords.map((record) => (
              <option key={record.id} value={record.id}>
                {formatStressRunLabel(record)}
              </option>
            ))}
          </select>
        </label>
        <label className="terminal-dock__debug-select">
          <span>
            {i18n._({
              id: 'Against',
              message: 'Against',
            })}
          </span>
          <select
            onChange={(event) => onSelectStressCompareBaseline(event.target.value)}
            value={selectedStressCompareBaseline.id}
          >
            {stressRecords
              .filter((record) => record.id !== selectedStressCompareTarget.id)
              .map((record) => (
                <option key={record.id} value={record.id}>
                  {formatStressRunLabel(record)}
                </option>
              ))}
          </select>
        </label>
      </div>
      {stressComparison ? (
        <div className="terminal-dock__debug-summary">
          <strong>
            {i18n._({
              id: 'Stress test comparison',
              message: 'Stress test comparison',
            })}
          </strong>
          <div className="terminal-dock__debug-summary-grid">
            <span>{`current:${formatStressRunLabel(selectedStressCompareTarget)}`}</span>
            <span>{`baseline:${formatStressRunLabel(selectedStressCompareBaseline)}`}</span>
            {stressComparison.metrics.map((metric) => (
              <span
                className={`terminal-dock__debug-summary-chip terminal-dock__debug-summary-chip--${getStressDeltaTone(
                  metric,
                )}`}
                key={metric.key}
              >
                {`${metric.label}:${formatStressComparisonMetricValue(
                  metric.key,
                  metric.current,
                )} vs ${formatStressComparisonMetricValue(
                  metric.key,
                  metric.baseline,
                )} (${formatStressDelta(metric)})`}
              </span>
            ))}
            {stressComparison.changedConfig.map((change) => (
              <span
                className="terminal-dock__debug-summary-chip terminal-dock__debug-summary-chip--accent"
                key={change.key}
              >
                {`${change.label}:${change.baseline} -> ${change.current}`}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}
