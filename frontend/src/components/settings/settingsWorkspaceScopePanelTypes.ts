import type { ReactNode } from 'react'

export type SettingsSummaryItem = {
  label: string
  value: ReactNode
  tone?: 'active' | 'paused' | 'error' | 'default'
}

export type SettingsWorkspaceScopePanelProps = {
  title?: string
  description?: string
  extraSummaryItems?: SettingsSummaryItem[]
}
