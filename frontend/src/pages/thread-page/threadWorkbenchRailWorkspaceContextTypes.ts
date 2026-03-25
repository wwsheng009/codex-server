import type { CSSProperties, ReactNode } from 'react'

export type DetailRowProps = {
  emphasis?: boolean
  label: ReactNode
  value: ReactNode
}

export type SummaryStatTone = 'default' | 'success' | 'warning'

export type SummaryStatProps = {
  label: ReactNode
  value: ReactNode
  meta?: ReactNode
  footer?: ReactNode
  tone?: SummaryStatTone
}

export type StatusBadgeProps = {
  value?: string | null
}

export type PendingApprovalsBadgeProps = {
  count: number
  compact?: boolean
}

export type ProgressTone = 'accent' | 'warning' | 'danger' | 'neutral'

export type ProgressMeterLayout = 'inline' | 'block'

export type ProgressMeterProps = {
  ariaLabel: string
  layout?: ProgressMeterLayout
  metaLabel?: string
  percent: number | null
  showSummary?: boolean
  tone?: ProgressTone
  width?: 'default' | 'full'
}

export type CoverageMeterProps = {
  ariaLabel: string
  current: number
  layout?: ProgressMeterLayout
  total: number
}

export type InfoLabelProps = {
  help?: string
  label: string
}

export type DetailProgressStyle = CSSProperties
