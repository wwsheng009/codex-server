import { apiRequest } from '../../lib/api-client'
import type { Automation, AutomationRun, AutomationTemplate } from '../../types/api'

export type CreateAutomationInput = {
  title: string
  description: string
  prompt: string
  workspaceId: string
  schedule: string
  model: string
  reasoning: string
}

export type TemplateInput = {
  category: string
  title: string
  description: string
  prompt: string
}

export function listAutomations() {
  return apiRequest<Automation[]>('/api/automations')
}

export function getAutomation(automationId: string) {
  return apiRequest<Automation>(`/api/automations/${automationId}`)
}

export function createAutomation(input: CreateAutomationInput) {
  return apiRequest<Automation>('/api/automations', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function pauseAutomation(automationId: string) {
  return apiRequest<Automation>(`/api/automations/${automationId}/pause`, {
    method: 'POST',
  })
}

export function resumeAutomation(automationId: string) {
  return apiRequest<Automation>(`/api/automations/${automationId}/resume`, {
    method: 'POST',
  })
}

export function fixAutomation(automationId: string) {
  return apiRequest<Automation>(`/api/automations/${automationId}/fix`, {
    method: 'POST',
  })
}

export function triggerAutomationRun(automationId: string) {
  return apiRequest<AutomationRun>(`/api/automations/${automationId}/run`, {
    method: 'POST',
  })
}

export function listAutomationRuns(automationId: string) {
  return apiRequest<AutomationRun[]>(`/api/automations/${automationId}/runs`)
}

export function getAutomationRun(runId: string) {
  return apiRequest<AutomationRun>(`/api/automation-runs/${runId}`)
}

export function listAutomationTemplates() {
  return apiRequest<AutomationTemplate[]>('/api/automation-templates')
}

export function getAutomationTemplate(templateId: string) {
  return apiRequest<AutomationTemplate>(`/api/automation-templates/${templateId}`)
}

export function createAutomationTemplate(input: TemplateInput) {
  return apiRequest<AutomationTemplate>('/api/automation-templates', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateAutomationTemplate(templateId: string, input: TemplateInput) {
  return apiRequest<AutomationTemplate>(`/api/automation-templates/${templateId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteAutomationTemplate(templateId: string) {
  return apiRequest<{ status: string }>(`/api/automation-templates/${templateId}`, {
    method: 'DELETE',
  })
}

export function deleteAutomation(automationId: string) {
  return apiRequest<{ status: string }>(`/api/automations/${automationId}`, {
    method: 'DELETE',
  })
}
