import type { ReactNode } from 'react'

export type RunViewMode = 'details' | 'summary' | 'logs'

export type AutomationStatusMutationInput = {
  automationId: string
  status: string
}

export type AutomationErrorStateProps = {
  error: unknown
}

export type AutomationDetailRowProps = {
  label: string
  value: ReactNode
}
