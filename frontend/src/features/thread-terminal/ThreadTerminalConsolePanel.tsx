import { useState, type ReactNode } from 'react'

type ThreadTerminalConsolePanelProps = {
  ariaLabel?: string
  children: ReactNode
  className?: string
  defaultExpanded?: boolean
  summary?: ReactNode
  title?: ReactNode
}

export function ThreadTerminalConsolePanel({
  ariaLabel,
  children,
  className = '',
  defaultExpanded = false,
  summary,
  title,
}: ThreadTerminalConsolePanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const panelClassName = [
    'terminal-dock__panel',
    isExpanded ? 'terminal-dock__panel--expanded' : 'terminal-dock__panel--collapsed',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={panelClassName}>
      <button
        aria-label={ariaLabel}
        aria-expanded={isExpanded}
        className="terminal-dock__panel-toggle"
        onClick={() => setIsExpanded((value) => !value)}
        title={ariaLabel}
        type="button"
      >
        <span className="terminal-dock__panel-heading">
          {title ? <span className="terminal-dock__panel-title">{title}</span> : null}
          {summary ? (
            <span
              className={
                title
                  ? 'terminal-dock__panel-summary'
                  : 'terminal-dock__panel-summary terminal-dock__panel-summary--primary'
              }
            >
              {summary}
            </span>
          ) : null}
        </span>
        <span className="terminal-dock__panel-toggle-copy">
          <PanelChevron expanded={isExpanded} />
        </span>
      </button>
      {isExpanded ? <div className="terminal-dock__panel-body">{children}</div> : null}
    </section>
  )
}

function PanelChevron({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={expanded ? 'terminal-dock__panel-chevron terminal-dock__panel-chevron--expanded' : 'terminal-dock__panel-chevron'}
      fill="none"
      height="14"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width="14"
    >
      <path d="m7 10 5 5 5-5" />
    </svg>
  )
}
