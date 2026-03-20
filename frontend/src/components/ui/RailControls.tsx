import type { ButtonHTMLAttributes, ReactNode } from 'react'

type RailIconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  primary?: boolean
}

type ResizeHandleProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  axis: 'horizontal' | 'vertical'
  edge?: 'start' | 'end'
}

export function RailIcon({ children }: { children: ReactNode }) {
  return <span className="rail-icon">{children}</span>
}

export function RailIconButton({
  children,
  className = '',
  primary = false,
  type = 'button',
  ...props
}: RailIconButtonProps) {
  const classes = [primary ? 'rail-icon-button rail-icon-button--primary' : 'rail-icon-button', className]
    .filter(Boolean)
    .join(' ')

  return (
    <button {...props} className={classes} type={type}>
      {children}
    </button>
  )
}

export function ResizeHandle({
  axis,
  edge = 'start',
  className = '',
  type = 'button',
  ...props
}: ResizeHandleProps) {
  const classes = [
    axis === 'horizontal'
      ? edge === 'end'
        ? 'resize-handle resize-handle--horizontal resize-handle--horizontal-end'
        : 'resize-handle resize-handle--horizontal resize-handle--horizontal-start'
      : 'resize-handle resize-handle--vertical',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return <button {...props} className={classes} type={type} />
}

export function ChevronLeftIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="m14.5 6.5-5 5 5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

export function ChevronRightIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="m9.5 6.5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

export function AppGridIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.7" width="7" x="3.5" y="3.5" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.7" width="7" x="13.5" y="3.5" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.7" width="7" x="3.5" y="13.5" />
      <rect height="7" rx="2" stroke="currentColor" strokeWidth="1.7" width="7" x="13.5" y="13.5" />
    </svg>
  )
}

export function AutomationIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M4.5 4v5h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <circle cx="12" cy="12" fill="currentColor" r="1.5" />
    </svg>
  )
}

export function SparkIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path d="m12 3.5 1.9 4.9 4.9 1.9-4.9 1.9-1.9 4.9-1.9-4.9-4.9-1.9 4.9-1.9L12 3.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M18.5 16.5 19.3 18l1.5.8-1.5.8-.8 1.5-.8-1.5-1.5-.8 1.5-.8.8-1.5Z" fill="currentColor" />
    </svg>
  )
}

export function TerminalIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <rect height="15" rx="3" stroke="currentColor" strokeWidth="1.7" width="19" x="2.5" y="4.5" />
      <path d="m7 10 2.5 2.5L7 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M12.5 15.5h4.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path d="M12 8.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M19 12a7 7 0 0 0-.1-1.1l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.9-1.1l-.4-2.6h-4l-.4 2.6a7.4 7.4 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.1l-2 1.6 2 3.4 2.4-1c.6.5 1.2.8 1.9 1.1l.4 2.6h4l.4-2.6c.7-.3 1.3-.6 1.9-1.1l2.4 1 2-3.4-2-1.6c.1-.3.1-.7.1-1.1Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.4"
      />
    </svg>
  )
}

export function PanelOpenIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect height="15" rx="3" stroke="currentColor" strokeWidth="1.7" width="18" x="3" y="4.5" />
      <path d="M15 8.5 19 12l-4 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M10 8h-2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M10 12h-2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M10 16h-2.5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function ContextIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect height="14" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="16" x="4" y="5" />
      <path d="M8 9.5h8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
      <path d="M8 13h5" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function FeedIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M5 16c2.5-4 5.5 4 8-1s5.5 3 6-1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M5 8c2.5-4 5.5 4 8-1s5.5 3 6-1" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

export function ApprovalIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M12 4.5 4.5 8.5v5c0 3.4 2.2 5.7 7.5 6.9 5.3-1.2 7.5-3.5 7.5-6.9v-5L12 4.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m9.5 12 1.6 1.6 3.4-3.6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

export function ToolsIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M14.5 6.5a3.5 3.5 0 0 0-4.8 4.8l-4.2 4.2a1.7 1.7 0 1 0 2.4 2.4l4.2-4.2a3.5 3.5 0 0 0 4.8-4.8l-2 2-2.4-.4-.4-2.4 2-2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

export function SendIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path d="M4 11.5 19.5 4l-4 16-3.8-6.2L4 11.5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M11.7 13.8 19.5 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

export function StopIcon() {
  return (
    <svg fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect height="11" rx="2.2" stroke="currentColor" strokeWidth="1.7" width="11" x="6.5" y="6.5" />
    </svg>
  )
}
