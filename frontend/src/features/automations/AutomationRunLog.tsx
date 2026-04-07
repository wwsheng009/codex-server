import { useMemo } from 'react'
import { AnsiUp } from 'ansi_up'
import { formatLocalizedDateTime, formatLocalizedStatusLabel } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import type { AutomationRunLogProps } from './automationRunLogTypes'

export function AutomationRunLog({ logs }: AutomationRunLogProps) {
  const ansiUp = useMemo(() => new AnsiUp(), [])

  if (!logs.length) {
    return (
      <div className="notice">
        {i18n._({
          id: 'No logs captured for this run.',
          message: 'No logs captured for this run.',
        })}
      </div>
    )
  }

  return (
    <div className="automation-run-log automation-run-log--wide">
      {logs.map((entry) => (
        <div className="automation-run-log__entry" key={entry.id}>
          <span className="automation-run-log__timestamp">{formatTimestamp(entry.ts)}</span>
          <span className={`automation-run-log__level automation-run-log__level--${entry.level}`}>
            {formatLocalizedStatusLabel(entry.level)}
          </span>
          <span 
            className="automation-run-log__message"
            dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(entry.message) }}
          />
        </div>
      ))}
    </div>
  )
}

function formatTimestamp(value: string) {
  return formatLocalizedDateTime(value)
}
