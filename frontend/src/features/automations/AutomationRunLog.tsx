import { useMemo } from 'react'
import { AnsiUp } from 'ansi_up'
import type { AutomationRunLogProps } from './automationRunLogTypes'

export function AutomationRunLog({ logs }: AutomationRunLogProps) {
  const ansiUp = useMemo(() => new AnsiUp(), [])

  if (!logs.length) {
    return <div className="notice">No logs captured for this run.</div>
  }

  return (
    <div className="automation-run-log automation-run-log--wide">
      {logs.map((entry) => (
        <div className="automation-run-log__entry" key={entry.id}>
          <span className="automation-run-log__timestamp">{formatTimestamp(entry.ts)}</span>
          <span className={`automation-run-log__level automation-run-log__level--${entry.level}`}>
            {entry.level}
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
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}
