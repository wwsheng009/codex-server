import type { TemplateInput } from '../features/automations/api'

export type Draft = {
  title: string
  description: string
  prompt: string
  workspaceId: string
  schedule: string
  model: string
  reasoning: string
}

export type TemplateDraft = {
  title: string
  description: string
  prompt: string
  category: string
}

export type AutomationActionInput = {
  id: string
  action: 'pause' | 'resume' | 'fix'
}

export type UpdateAutomationTemplateInput = {
  templateId: string
  input: TemplateInput
}
