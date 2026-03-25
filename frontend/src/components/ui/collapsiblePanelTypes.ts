import type { ReactNode } from 'react'

export type CollapsiblePanelProps = {
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  defaultExpanded?: boolean
  expanded?: boolean
  className?: string
  onToggle?: (isExpanded: boolean) => void
}
