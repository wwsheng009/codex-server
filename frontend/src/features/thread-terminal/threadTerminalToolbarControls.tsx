import type { ButtonHTMLAttributes } from 'react'

export function TerminalToolbarActionButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={
        className
          ? `terminal-dock__toolbar-action ${className}`
          : 'terminal-dock__toolbar-action'
      }
      type={props.type ?? 'button'}
    >
      {children}
    </button>
  )
}

export function TerminalToolbarDivider() {
  return <span aria-hidden="true" className="terminal-dock__toolbar-divider" />
}

export function TerminalToolButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={className ? `terminal-dock__toolbutton ${className}` : 'terminal-dock__toolbutton'}
      type={props.type ?? 'button'}
    >
      {children}
    </button>
  )
}

export function ShellLaunchToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="m8.5 10 2.5 2.5L8.5 15M13.5 15H16"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function CommandLaunchToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M4.5 7.5A2.5 2.5 0 0 1 7 5h10a2.5 2.5 0 0 1 2.5 2.5v9A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="m8.5 10 3 2.5-3 2.5M13 15h2.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function FitToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function FocusToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 4H5v4M15 4h4v4M9 20H5v-4M15 20h4v-4M12 9.5A2.5 2.5 0 1 1 12 14.5A2.5 2.5 0 0 1 12 9.5Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function CopyToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.7"
        width="9"
        x="9.5"
        y="8.5"
      />
      <path
        d="M7 15.5H6A1.5 1.5 0 0 1 4.5 14V6A1.5 1.5 0 0 1 6 4.5h8A1.5 1.5 0 0 1 15.5 6v1"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function PasteToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 5.5h6M10 4h4a1 1 0 0 1 1 1v1H9V5a1 1 0 0 1 1-1Zm-2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

export function SearchToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <circle cx="11" cy="11" r="5.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="m16 16 4 4" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </svg>
  )
}

export function ClearToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M5 7.5h14M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8v1.7M7.2 7.5l.8 10a2 2 0 0 0 2 1.8h4a2 2 0 0 0 2-1.8l.8-10"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function StopToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect
        height="10"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.8"
        width="10"
        x="7"
        y="7"
      />
    </svg>
  )
}

export function BackToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="m14.5 6.5-5 5 5 5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  )
}

export function PinToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M9 4.5h6l-1.2 4.2 2.7 2.5v1.3h-4.2V19.5l-.8.8-.8-.8V12.5H6.5v-1.3l2.7-2.5L9 4.5Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}

export function ArchiveToolIcon() {
  return (
    <svg fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path
        d="M5 7.5h14v10.2A1.8 1.8 0 0 1 17.2 19.5H6.8A1.8 1.8 0 0 1 5 17.7V7.5Zm1-3h12l1.2 3H4.8L6 4.5Zm4.5 6h3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.6"
      />
    </svg>
  )
}
