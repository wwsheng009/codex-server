import type { ReactNode } from 'react'

export type InlineNoticeProps = {
  tone?: 'info' | 'error'
  title?: string
  children: ReactNode
  action?: ReactNode
  className?: string
  dismissible?: boolean
  noticeKey?: string
  details?: string
  onRetry?: () => void
  retryLabel?: string
}
