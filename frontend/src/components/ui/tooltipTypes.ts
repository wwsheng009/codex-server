import type { ReactNode } from 'react'

export type TooltipProps = {
  content: ReactNode
  children: ReactNode
  position?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
  triggerLabel?: string
}
