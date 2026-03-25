import type { ReactNode } from 'react'

export type TabItem = {
  id: string
  label: string
  content: ReactNode
  badge?: ReactNode
  icon?: ReactNode
}

export type TabsProps = {
  items: TabItem[]
  ariaLabel: string
  defaultValue?: string
  className?: string
  storageKey?: string
}

export type TabsActivateDetail = {
  storageKey: string
  tabId: string
}
