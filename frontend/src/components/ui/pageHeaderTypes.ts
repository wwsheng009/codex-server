import type { ReactNode } from 'react'

export type PageHeaderProps = {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
  meta?: ReactNode
}
