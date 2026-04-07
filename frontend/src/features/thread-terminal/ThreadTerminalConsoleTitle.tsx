import type {
  ThreadTerminalConsoleTitleState
} from './threadTerminalConsoleStateTypes'

export function ThreadTerminalConsoleTitle({
  statusTone,
  subtitle,
  title,
}: ThreadTerminalConsoleTitleState) {
  return (
    <div className="terminal-dock__console-title">
      <div className="terminal-dock__console-title-row">
        <span className={`terminal-dock__status-dot terminal-dock__status-dot--${statusTone}`} />
        <strong>{title}</strong>
        {subtitle ? (
          <span className="terminal-dock__console-subtitle" title={subtitle}>
            {subtitle}
          </span>
        ) : null}
      </div>
    </div>
  )
}
