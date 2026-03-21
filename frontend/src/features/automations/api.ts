import { apiRequest } from '../../lib/api-client'
import type { Automation } from '../../types/api'

export type CreateAutomationInput = {
  title: string
  description: string
  prompt: string
  workspaceId: string
  schedule: string
  model: string
  reasoning: string
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

export function deleteAutomation(automationId: string) {
  return apiRequest<{ status: string }>(`/api/automations/${automationId}`, {
    method: 'DELETE',
  })
}
