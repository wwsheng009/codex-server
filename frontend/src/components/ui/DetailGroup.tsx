import { useState } from 'react'
import type {
  DetailGroupProps,
  DetailGroupSummaryClick,
} from './detailGroupTypes'

export function DetailGroup({
  children,
  collapsible = false,
  defaultOpen = true,
  onToggle,
  open,
  title,
  tone = 'default',
}: DetailGroupProps) {
  const className = [
    'detail-group',
    tone !== 'default' ? `detail-group--${tone}` : '',
    collapsible ? 'detail-group--collapsible' : '',
  ].filter(Boolean).join(' ')
  const [internalOpen, setInternalOpen] = useState(defaultOpen)
  const isOpen = open ?? internalOpen

  function handleSummaryClick(event: DetailGroupSummaryClick) {
    event.preventDefault()

    if (open === undefined) {
      setInternalOpen((current) => !current)
    }

    onToggle?.()
  }

  if (collapsible) {
    return (
      <details
        className={`${className} detail-group--collapsible`}
        open={isOpen}
      >
        <summary className="detail-group__summary" onClick={handleSummaryClick}>
          <h3 className="detail-group__title">{title}</h3>
          <span aria-hidden="true" className="detail-group__chevron" />
        </summary>
        <div className="detail-list">{children}</div>
      </details>
    )
  }

  return (
    <section className={className}>
      <h3 className="detail-group__title">{title}</h3>
      <div className="detail-list">{children}</div>
    </section>
  )
}
