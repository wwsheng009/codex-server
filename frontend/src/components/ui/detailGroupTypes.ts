import type { MouseEvent, ReactNode } from 'react'

export type DetailGroupTone =
  | 'default'
  | 'primary'
  | 'secondary'
  | 'warning'
  | 'danger'

export type DetailGroupProps = {
  children: ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
  onToggle?: () => void
  open?: boolean
  title: string
  tone?: DetailGroupTone
}

export type DetailGroupSummaryClick = MouseEvent<HTMLElement>
