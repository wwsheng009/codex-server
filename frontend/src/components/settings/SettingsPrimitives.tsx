import { useMemo, useState } from 'react'
import { i18n } from '../../i18n/runtime'
import type {
  ConfigHelperCardProps,
  SettingRowProps,
  SettingsGroupProps,
  SettingsJsonPreviewProps,
  SettingsPageHeaderProps,
  SettingsRecordProps,
} from './settingsPrimitivesTypes'

export function SettingsPageHeader({
  eyebrow,
  title,
  description,
  meta,
}: SettingsPageHeaderProps) {
  return (
    <header className="settings-page__header">
      <div>
        {eyebrow ? <p className="settings-page__eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="settings-page__description">{description}</p>
      </div>
      {meta ? <div className="settings-page__meta">{meta}</div> : null}
    </header>
  )
}

export function SettingsGroup({
  title,
  description,
  meta,
  children,
  className,
}: SettingsGroupProps) {
  return (
    <section className={className ? `setting-group ${className}` : 'setting-group'}>
      <div className="setting-group__header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {meta ? <div className="section-header__meta">{meta}</div> : null}
      </div>
      <div className="setting-group__rows">{children}</div>
    </section>
  )
}

export function SettingRow({
  title,
  description,
  meta,
  children,
}: SettingRowProps) {
  return (
    <section className="setting-row">
      <div className="setting-row__copy">
        <div className="setting-row__title-row">
          <h3>{title}</h3>
          {meta ? <div className="setting-row__meta">{meta}</div> : null}
        </div>
        <p>{description}</p>
      </div>
      <div className="setting-row__control">{children}</div>
    </section>
  )
}

export function SettingsJsonPreview({
  title,
  description,
  value,
  collapsible = true,
  defaultExpanded = false,
}: SettingsJsonPreviewProps) {
  const formattedValue = useMemo(() => JSON.stringify(value, null, 2), [value])
  const shouldCollapse = collapsible && formattedValue.split('\n').length > 14
  const [expanded, setExpanded] = useState(defaultExpanded)
  const previewValue = shouldCollapse && !expanded
    ? `${formattedValue.split('\n').slice(0, 14).join('\n')}\n…`
    : formattedValue

  async function handleCopy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(formattedValue)
    } catch {
      // Best-effort copy only.
    }
  }

  return (
    <div className="settings-subsection settings-output-card">
      <div className="settings-subsection__header">
        <div className="settings-output-card__title-block">
          <strong>{title}</strong>
          <p>{description}</p>
        </div>
        <div className="settings-output-card__actions">
          <button className="notice__tool" onClick={() => void handleCopy()} type="button">
            {i18n._({ id: 'Copy', message: 'Copy' })}
          </button>
          {shouldCollapse ? (
            <button className="notice__tool" onClick={() => setExpanded((current) => !current)} type="button">
              {expanded
                ? i18n._({ id: 'Collapse', message: 'Collapse' })
                : i18n._({ id: 'Expand', message: 'Expand' })}
            </button>
          ) : null}
        </div>
      </div>
      <pre className="code-block">{previewValue}</pre>
    </div>
  )
}

export function SettingsRecord({
  marker,
  title,
  description,
  meta,
  action,
}: SettingsRecordProps) {
  return (
    <article className="settings-record">
      <div className="settings-record__icon">{marker}</div>
      <div className="settings-record__main">
        <strong>{title}</strong>
        <p>{description}</p>
        {meta ? <div className="settings-record__meta">{meta}</div> : null}
      </div>
      {action ? <div className="settings-record__action">{action}</div> : null}
    </article>
  )
}

export function ConfigHelperCard({
  title,
  description,
  icon,
}: ConfigHelperCardProps) {
  return (
    <div className="config-helper-card">
      <div className="config-helper-card__header">
        {icon ? <div className="config-helper-card__icon">{icon}</div> : null}
        <strong>{title}</strong>
      </div>
      <p>{description}</p>
    </div>
  )
}
