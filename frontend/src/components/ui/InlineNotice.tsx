import { useEffect, useState } from 'react'
import { i18n } from '../../i18n/runtime'

import type { InlineNoticeProps } from './inlineNoticeTypes'

export function InlineNotice({
  tone = 'info',
  title,
  children,
  action,
  className,
  dismissible = false,
  noticeKey,
  details,
  onRetry,
  retryLabel = i18n._({ id: 'Retry', message: 'Retry' }),
}: InlineNoticeProps) {
  const [dismissed, setDismissed] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    setDismissed(false)
    setCopied(false)
  }, [noticeKey])

  if (dismissed) {
    return null
  }

  const classes = [
    'notice',
    tone === 'error' ? 'notice--error' : '',
    title ? 'notice--detailed' : '',
    action || onRetry || details ? 'notice--actionable' : '',
    dismissible ? 'notice--dismissible' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  async function handleCopyDetails() {
    if (!details || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return
    }

    try {
      await navigator.clipboard.writeText(details)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className={classes}>
      <div className="notice__content">
        {title ? <strong className="notice__title">{title}</strong> : null}
        <div className="notice__description">{children}</div>
      </div>
      <div className="notice__aside">
        {onRetry || details ? (
          <div className="notice__tools">
            {onRetry ? (
              <button className="notice__tool" onClick={onRetry} type="button">
                {retryLabel}
              </button>
            ) : null}
            {details ? (
              <button className="notice__tool" onClick={() => void handleCopyDetails()} type="button">
                {copied ? i18n._({ id: 'Copied', message: 'Copied' }) : i18n._({ id: 'Copy details', message: 'Copy details' })}
              </button>
            ) : null}
          </div>
        ) : null}
        {action ? <div className="notice__action">{action}</div> : null}
        {dismissible ? (
          <button
            aria-label={i18n._({ id: 'Dismiss notice', message: 'Dismiss notice' })}
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
