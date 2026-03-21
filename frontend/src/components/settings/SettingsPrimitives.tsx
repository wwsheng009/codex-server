import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type SettingsPageHeaderProps = {
  eyebrow?: string
  title: string
  description: string
  meta?: ReactNode
}

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

type SettingsGroupProps = {
  title: string
  description: string
  meta?: ReactNode
  children: ReactNode
  className?: string
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

type SettingRowProps = {
  title: string
  description: string
  meta?: ReactNode
  children: ReactNode
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

type SettingsJsonPreviewProps = {
  title: string
  description: string
  value: unknown
  collapsible?: boolean
  defaultExpanded?: boolean
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
            Copy
          </button>
          {shouldCollapse ? (
            <button className="notice__tool" onClick={() => setExpanded((current) => !current)} type="button">
              {expanded ? 'Collapse' : 'Expand'}
            </button>
          ) : null}
        </div>
      </div>
      <pre className="code-block">{previewValue}</pre>
    </div>
  )
}

type SettingsRecordProps = {
  marker: string
  title: string
  description: string
  meta?: ReactNode
  action?: ReactNode
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
