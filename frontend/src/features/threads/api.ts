import { apiRequest } from '../../lib/api-client'
import type { Thread, ThreadDetail } from '../../types/api'

export function listThreads(workspaceId: string) {
  return apiRequest<Thread[]>(`/api/workspaces/${workspaceId}/threads`)
}

export function listLoadedThreadIds(workspaceId: string) {
  return apiRequest<string[] | { data?: unknown }>(`/api/workspaces/${workspaceId}/threads/loaded`).then(
    (result) => {
      if (Array.isArray(result)) {
        return result
      }

      if (result && typeof result === 'object' && Array.isArray(result.data)) {
        return result.data.filter((item): item is string => typeof item === 'string')
      }

      return []
    },
  )
}

export function getThread(workspaceId: string, threadId: string) {
  return apiRequest<ThreadDetail>(`/api/workspaces/${workspaceId}/threads/${threadId}`)
}

export function createThread(
  workspaceId: string,
  input: { name?: string; model?: string; permissionPreset?: string } = {},
) {
  return apiRequest<Thread>(`/api/workspaces/${workspaceId}/threads`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function resumeThread(workspaceId: string, threadId: string) {
  return apiRequest<Thread>(`/api/workspaces/${workspaceId}/threads/${threadId}/resume`, {
    method: 'POST',
  })
}

export function renameThread(workspaceId: string, threadId: string, input: { name: string }) {
  return apiRequest<Thread>(`/api/workspaces/${workspaceId}/threads/${threadId}/name`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function archiveThread(workspaceId: string, threadId: string) {
  return apiRequest<Thread>(`/api/workspaces/${workspaceId}/threads/${threadId}/archive`, {
    method: 'POST',
  })
}

export function unarchiveThread(workspaceId: string, threadId: string) {
  return apiRequest<Thread>(`/api/workspaces/${workspaceId}/threads/${threadId}/unarchive`, {
    method: 'POST',
  })
}

export function deleteThread(workspaceId: string, threadId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/threads/${threadId}`, {
    method: 'DELETE',
  })
}

export function compactThread(workspaceId: string, threadId: string) {
  return apiRequest<{ status: string }>(`/api/workspaces/${workspaceId}/threads/${threadId}/compact`, {
    method: 'POST',
  })
}
