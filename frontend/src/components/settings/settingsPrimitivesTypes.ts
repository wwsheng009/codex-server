import type { ReactNode } from 'react'

export type SettingsPageHeaderProps = {
  eyebrow?: string
  title: string
  description: string
  meta?: ReactNode
}

export type SettingsGroupProps = {
  title: string
  description: string
  meta?: ReactNode
  children: ReactNode
  className?: string
}

export type SettingRowProps = {
  title: string
  description: string
  meta?: ReactNode
  children: ReactNode
}

export type SettingsJsonPreviewProps = {
  title: string
  description: string
  value: unknown
  collapsible?: boolean
  defaultExpanded?: boolean
}

export type SettingsRecordProps = {
  marker: string
  title: string
  description: string
  meta?: ReactNode
  action?: ReactNode
}

export type ConfigHelperCardProps = {
  title: string
  description: string
  icon?: ReactNode
}
