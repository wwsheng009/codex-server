import type { SelectOption } from './selectControlTypes'

export type CronGeneratorProps = {
  value: string
  onChange: (cron: string) => void
}

export type CronFieldProps = {
  label: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
}
