import { useEffect, useState, type ReactNode } from 'react'

type InlineNoticeProps = {
  tone?: 'info' | 'error'
  title?: string
  children: ReactNode
  action?: ReactNode
  className?: string
  dismissible?: boolean
  noticeKey?: string
}

export function InlineNotice({
  tone = 'info',
  title,
  children,
  action,
  className,
  dismissible = false,
  noticeKey,
}: InlineNoticeProps) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    setDismissed(false)
  }, [noticeKey])

  if (dismissed) {
    return null
  }

  const classes = [
    'notice',
    tone === 'error' ? 'notice--error' : '',
    title ? 'notice--detailed' : '',
    action ? 'notice--actionable' : '',
    dismissible ? 'notice--dismissible' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      <div className="notice__content">
        {title ? <strong className="notice__title">{title}</strong> : null}
        <div className="notice__description">{children}</div>
      </div>
      <div className="notice__aside">
        {action ? <div className="notice__action">{action}</div> : null}
        {dismissible ? (
          <button
            aria-label="Dismiss notice"
            className="notice__close"
            onClick={() => setDismissed(true)}
            type="button"
          >
            ×
          </button>
        ) : null}
      </div>
    </div>
  )
}
