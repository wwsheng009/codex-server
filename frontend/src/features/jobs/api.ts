import { apiRequest } from '../../lib/api-client'
import type { BackgroundJob, BackgroundJobExecutor, BackgroundJobRun, JobMCPConfigResult } from '../../types/api'

export type CreateBackgroundJobInput = {
  sourceType?: string
  sourceRefId?: string
  name: string
  description: string
  workspaceId: string
  executorKind: string
  schedule?: string
  payload?: Record<string, unknown>
}

export type WriteJobMCPConfigInput = {
  enabled: boolean
  serverName: string
  toolAllowlist: string[]
}

export function listBackgroundJobs() {
  return apiRequest<BackgroundJob[]>('/api/jobs')
}

export function listBackgroundJobExecutors() {
  return apiRequest<BackgroundJobExecutor[]>('/api/jobs/executors')
}

export function readJobMCPConfig(workspaceId: string) {
  return apiRequest<JobMCPConfigResult>(`/api/workspaces/${workspaceId}/jobs-mcp/config`)
}

export function writeJobMCPConfig(workspaceId: string, input: WriteJobMCPConfigInput) {
  return apiRequest<JobMCPConfigResult>(`/api/workspaces/${workspaceId}/jobs-mcp/config`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createBackgroundJob(input: CreateBackgroundJobInput) {
  return apiRequest<BackgroundJob>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateBackgroundJob(jobId: string, input: CreateBackgroundJobInput) {
  return apiRequest<BackgroundJob>(`/api/jobs/${jobId}`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function pauseBackgroundJob(jobId: string) {
  return apiRequest<BackgroundJob>(`/api/jobs/${jobId}/pause`, {
    method: 'POST',
  })
}

export function resumeBackgroundJob(jobId: string) {
  return apiRequest<BackgroundJob>(`/api/jobs/${jobId}/resume`, {
    method: 'POST',
  })
}

export function runBackgroundJob(jobId: string) {
  return apiRequest<BackgroundJobRun>(`/api/jobs/${jobId}/run`, {
    method: 'POST',
  })
}

export function deleteBackgroundJob(jobId: string) {
  return apiRequest<{ status: string }>(`/api/jobs/${jobId}`, {
    method: 'DELETE',
  })
}

export function listBackgroundJobRuns(jobId: string) {
  return apiRequest<BackgroundJobRun[]>(`/api/jobs/${jobId}/runs`)
}

export function retryBackgroundJobRun(runId: string) {
  return apiRequest<BackgroundJobRun>(`/api/job-runs/${runId}/retry`, {
    method: 'POST',
  })
}

export function cancelBackgroundJobRun(runId: string) {
  return apiRequest<BackgroundJobRun>(`/api/job-runs/${runId}/cancel`, {
    method: 'POST',
  })
}
