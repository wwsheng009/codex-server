import type { ReactNode } from 'react'

type InlineNoticeProps = {
  tone?: 'info' | 'error'
  title?: string
  children: ReactNode
  action?: ReactNode
  className?: string
}

export function InlineNotice({
  tone = 'info',
  title,
  children,
  action,
  className,
}: InlineNoticeProps) {
  const classes = [
    'notice',
    tone === 'error' ? 'notice--error' : '',
    title ? 'notice--detailed' : '',
    action ? 'notice--actionable' : '',
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
      {action ? <div className="notice__action">{action}</div> : null}
    </div>
  )
}
