import { useMemo, useState } from 'react'

import { i18n } from '../../i18n/runtime'
import type {
  SettingsJsonDiffDisplayMode,
  SettingsJsonDiffLine,
  SettingsJsonDiffSplitRow,
} from './settings-json-diff'
import { createSettingsJsonDiffModel } from './settings-json-diff'
import type {
  SettingsJsonDiffPreviewProps,
  SplitDiffCellProps,
  SplitDiffRowsProps,
  UnifiedDiffRowsProps,
} from './settingsJsonDiffPreviewTypes'

export function SettingsJsonDiffPreview({
  title,
  description,
  entries,
}: SettingsJsonDiffPreviewProps) {
  const [displayMode, setDisplayMode] =
    useState<SettingsJsonDiffDisplayMode>('unified')
  const missingLabel = i18n._({ id: '(missing)', message: '(missing)' })
  const formattedEntries = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        diff: createSettingsJsonDiffModel(entry.currentValue, entry.nextValue, {
          missingLabel,
        }),
      })),
    [entries, missingLabel],
  )

  return (
    <div className="settings-subsection settings-output-card">
      <div className="settings-subsection__header">
        <div className="settings-output-card__title-block">
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        {formattedEntries.length ? (
          <div
            aria-label={i18n._({
              id: 'Scenario diff display mode',
              message: 'Scenario diff display mode',
            })}
            className="settings-json-diff__toolbar"
            role="toolbar"
          >
            <button
              aria-pressed={displayMode === 'unified'}
              className={`settings-json-diff__view-button${
                displayMode === 'unified'
                  ? ' settings-json-diff__view-button--active'
                  : ''
              }`}
              onClick={() => setDisplayMode('unified')}
              type="button"
            >
              {i18n._({ id: 'Unified', message: 'Unified' })}
            </button>
            <button
              aria-pressed={displayMode === 'split'}
              className={`settings-json-diff__view-button${
                displayMode === 'split'
                  ? ' settings-json-diff__view-button--active'
                  : ''
              }`}
              onClick={() => setDisplayMode('split')}
              type="button"
            >
              {i18n._({ id: 'Split', message: 'Split' })}
            </button>
          </div>
        ) : null}
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
                <div className="settings-json-diff__entry-meta">
                  <strong>{entry.keyPath}</strong>
                  <small className="settings-json-diff__entry-summary">
                    {i18n._({
                      id: '{added} added, {removed} removed',
                      message: '{added} added, {removed} removed',
                      values: {
                        added: entry.diff.stats.addedCount,
                        removed: entry.diff.stats.removedCount,
                      },
                    })}
                  </small>
                </div>
                <span
                  className={`status-pill settings-json-diff__change-pill settings-json-diff__change-pill--${entry.diff.changeType}`}
                >
                  {getChangeTypeLabel(entry.diff.changeType)}
                </span>
              </div>
              {displayMode === 'unified' ? (
                <UnifiedDiffRows rows={entry.diff.unifiedRows} />
              ) : (
                <SplitDiffRows rows={entry.diff.splitRows} />
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function getChangeTypeLabel(changeType: 'added' | 'removed' | 'modified') {
  switch (changeType) {
    case 'added':
      return i18n._({ id: 'Added', message: 'Added' })
    case 'removed':
      return i18n._({ id: 'Removed', message: 'Removed' })
    default:
      return i18n._({ id: 'Modified', message: 'Modified' })
  }
}

function UnifiedDiffRows({ rows }: UnifiedDiffRowsProps) {
  return (
    <div className="settings-json-diff__viewport">
      <table className="settings-json-diff__table settings-json-diff__table--unified">
        <thead>
          <tr>
            <th aria-hidden="true" className="settings-json-diff__header-cell settings-json-diff__header-cell--marker" />
            <th className="settings-json-diff__header-cell settings-json-diff__header-cell--line-number">
              {i18n._({ id: 'Current', message: 'Current' })}
            </th>
            <th className="settings-json-diff__header-cell settings-json-diff__header-cell--line-number">
              {i18n._({ id: 'Next', message: 'Next' })}
            </th>
            <th className="settings-json-diff__header-cell settings-json-diff__header-cell--content">
              {i18n._({ id: 'Diff', message: 'Diff' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className={`settings-json-diff__row settings-json-diff__row--${row.kind}`} key={buildRowKey(row, index)}>
              <td className={`settings-json-diff__cell settings-json-diff__cell--${row.kind} settings-json-diff__marker`}>
                {row.prefix}
              </td>
              <td className={`settings-json-diff__cell settings-json-diff__cell--${row.kind} settings-json-diff__line-number`}>
                {formatLineNumber(row.leftLineNumber)}
              </td>
              <td className={`settings-json-diff__cell settings-json-diff__cell--${row.kind} settings-json-diff__line-number`}>
                {formatLineNumber(row.rightLineNumber)}
              </td>
              <td className={`settings-json-diff__cell settings-json-diff__cell--${row.kind} settings-json-diff__content`}>
                {renderDiffText(row.text)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SplitDiffRows({ rows }: SplitDiffRowsProps) {
  return (
    <div className="settings-json-diff__viewport">
      <table className="settings-json-diff__table settings-json-diff__table--split">
        <thead>
          <tr>
            <th className="settings-json-diff__header-cell settings-json-diff__header-cell--side" colSpan={3}>
              {i18n._({ id: 'Current', message: 'Current' })}
            </th>
            <th
              className="settings-json-diff__header-cell settings-json-diff__header-cell--side settings-json-diff__header-cell--divider"
              colSpan={3}
            >
              {i18n._({ id: 'Next', message: 'Next' })}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr className="settings-json-diff__row" key={buildSplitRowKey(row, index)}>
              <SplitDiffCell line={row.left} side="left" />
              <SplitDiffCell divider line={row.right} side="right" />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function SplitDiffCell({
  line,
  side,
  divider = false,
}: SplitDiffCellProps) {
  const kind = line?.kind ?? 'empty'
  const dividerClass = divider ? ' settings-json-diff__cell--divider' : ''
  const lineNumber =
    side === 'left' ? line?.leftLineNumber : line?.rightLineNumber

  return (
    <>
      <td className={`settings-json-diff__cell settings-json-diff__cell--${kind} settings-json-diff__marker${dividerClass}`}>
        {line ? line.prefix : ''}
      </td>
      <td className={`settings-json-diff__cell settings-json-diff__cell--${kind} settings-json-diff__line-number`}>
        {formatLineNumber(lineNumber)}
      </td>
      <td className={`settings-json-diff__cell settings-json-diff__cell--${kind} settings-json-diff__content`}>
        {renderDiffText(line?.text ?? '')}
      </td>
    </>
  )
}

function formatLineNumber(value?: number) {
  return typeof value === 'number' ? value : ''
}

function renderDiffText(value: string) {
  return value.length ? value : ' '
}

function buildRowKey(row: SettingsJsonDiffLine, index: number) {
  return `${row.kind}:${row.leftLineNumber ?? 0}:${row.rightLineNumber ?? 0}:${index}`
}

function buildSplitRowKey(row: SettingsJsonDiffSplitRow, index: number) {
  return [
    row.left?.kind ?? 'empty',
    row.left?.leftLineNumber ?? 0,
    row.right?.kind ?? 'empty',
    row.right?.rightLineNumber ?? 0,
    index,
  ].join(':')
}
