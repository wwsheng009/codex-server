import { useMemo } from 'react'
import { AnsiUp } from 'ansi_up'

import { formatLocalizedDateTime, formatLocalizedStatusLabel } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import type { BotConnectionLogEntry } from '../../types/api'
import {
  describeBotConnectionLogEntry,
  normalizeBotConnectionLogLevel,
} from './logStreamUtils'

type BotConnectionLogStreamProps = {
  logs: BotConnectionLogEntry[]
}

export function BotConnectionLogStream({ logs }: BotConnectionLogStreamProps) {
  const ansiUp = useMemo(() => new AnsiUp(), [])

  if (!logs.length) {
    return (
      <div className="notice">
        {i18n._({ id: 'No logs captured for this connection.', message: 'No logs captured for this connection.' })}
      </div>
    )
  }

  return (
    <div className="automation-run-log automation-run-log--wide">
      {logs.map((entry) => {
        const descriptor = describeBotConnectionLogEntry(entry)
        const normalizedLevel = normalizeBotConnectionLogLevel(entry.level)
        const entryClasses = [
          'automation-run-log__entry',
          descriptor.highlightStyle === 'suppressed' ? 'automation-run-log__entry--suppressed' : '',
          descriptor.highlightStyle === 'delivery-sending' ? 'automation-run-log__entry--delivery-sending' : '',
          descriptor.highlightStyle === 'delivery-success' ? 'automation-run-log__entry--delivery-success' : '',
          descriptor.highlightStyle === 'delivery-warning' ? 'automation-run-log__entry--delivery-warning' : '',
          descriptor.highlightStyle === 'delivery-danger' ? 'automation-run-log__entry--delivery-danger' : '',
        ]
          .filter(Boolean)
          .join(' ')

        return (
          <div className={entryClasses} key={entry.id}>
            <div className="automation-run-log__meta">
              <span className="automation-run-log__timestamp">{formatTimestamp(entry.ts)}</span>
              {descriptor.eventLabel ? (
                <span className={`automation-run-log__event automation-run-log__event--${descriptor.eventTone}`}>
                  {descriptor.eventLabel}
                </span>
              ) : null}
              <span className={`automation-run-log__level automation-run-log__level--${normalizedLevel}`}>
                {formatLocalizedStatusLabel(entry.level)}
              </span>
            </div>
            <span
              className="automation-run-log__message"
              dangerouslySetInnerHTML={{ __html: ansiUp.ansi_to_html(entry.message) }}
            />
          </div>
        )
      })}
    </div>
  )
}

function formatTimestamp(value: string) {
  return formatLocalizedDateTime(value)
}
