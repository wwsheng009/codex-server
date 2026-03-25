import { useState } from 'react'
import { i18n } from '../../i18n/runtime'
import type { CollapsiblePanelProps } from './collapsiblePanelTypes'

/**
 * A generic collapsible panel component that can show/hide its children.
 * Uses existing CSS classes from workbench.css and common.css for consistency.
 * Supports both controlled (via expanded/onToggle) and uncontrolled modes.
 */
export function CollapsiblePanel({
  title,
  description,
  children,
  defaultExpanded = false,
  expanded,
  className = '',
  onToggle,
}: CollapsiblePanelProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isExpanded = expanded !== undefined ? expanded : internalExpanded

  const handleToggle = () => {
    const newState = !isExpanded
    if (expanded === undefined) {
      setInternalExpanded(newState)
    }
    onToggle?.(newState)
  }

  return (
    <div className={`pane-section ${className}`}>
      <div className="section-header section-header--inline">
        <div>
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {description && (
            <p>
              {typeof description === 'string' ? description : description}
            </p>
          )}
        </div>
        <button
          className={
            isExpanded
              ? 'pane-section__toggle workbench-pane__panel-toggle workbench-pane__panel-toggle--active'
              : 'pane-section__toggle workbench-pane__panel-toggle'
          }
          onClick={handleToggle}
          type="button"
        >
          {isExpanded
            ? i18n._({
                id: 'Hide',
                message: 'Hide',
              })
            : i18n._({
                id: 'Show',
                message: 'Show',
              })}
        </button>
      </div>
      {isExpanded && <div className="pane-section__content">{children}</div>}
    </div>
  )
}
