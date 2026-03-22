import { useMemo } from 'react'

import { i18n } from '../../i18n/runtime'
import type { ConfigScenarioDiffEntry } from '../../features/settings/config-scenarios'

type SettingsJsonDiffPreviewProps = {
  title: string
  description: string
  entries: ConfigScenarioDiffEntry[]
}

export function SettingsJsonDiffPreview({
  title,
  description,
  entries,
}: SettingsJsonDiffPreviewProps) {
  const formattedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        currentText: stringifyDiffValue(entry.currentValue),
        nextText: stringifyDiffValue(entry.nextValue),
      })),
    [entries],
  )

  return (
    <div className="settings-subsection settings-output-card">
      <div className="settings-subsection__header">
        <div className="settings-output-card__title-block">
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
      </div>
      {!formattedEntries.length ? (
        <div className="empty-state">
          {i18n._({
            id: 'No changes. This scenario already matches the current config for the tracked keys.',
            message:
              'No changes. This scenario already matches the current config for the tracked keys.',
          })}
        </div>
      ) : (
        <div className="settings-json-diff">
          {formattedEntries.map((entry) => (
            <section className="settings-json-diff__entry" key={entry.keyPath}>
              <div className="settings-json-diff__entry-header">
                <strong>{entry.keyPath}</strong>
                <span className="status-pill status-pill--paused">
                  {i18n._({ id: 'Modified', message: 'Modified' })}
                </span>
              </div>
              <div className="settings-json-diff__pane-grid">
                <div className="settings-json-diff__pane">
                  <div className="settings-json-diff__pane-label">
                    {i18n._({ id: 'Current', message: 'Current' })}
                  </div>
                  <pre className="code-block settings-json-diff__code settings-json-diff__code--current">
                    {entry.currentText}
                  </pre>
                </div>
                <div className="settings-json-diff__pane">
                  <div className="settings-json-diff__pane-label">
                    {i18n._({ id: 'Next', message: 'Next' })}
                  </div>
                  <pre className="code-block settings-json-diff__code settings-json-diff__code--next">
                    {entry.nextText}
                  </pre>
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function stringifyDiffValue(value: unknown) {
  if (typeof value === 'undefined') {
    return '(missing)'
  }

  const serialized = JSON.stringify(value, null, 2)
  return serialized ?? String(value)
}
