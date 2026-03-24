import { apiRequest } from '../../lib/api-client'
import type {
  Thread,
  ThreadDetail,
  ThreadListPage,
  ThreadTurn,
  ThreadTurnItemOutput,
} from '../../types/api'

export type ListThreadsPageInput = {
  archived?: boolean
  cursor?: string
  limit?: number
  sortKey?: 'created_at' | 'updated_at'
}

export type GetThreadInput = {
  beforeTurnId?: string
  contentMode?: 'full' | 'summary'
  turnLimit?: number
}

export type GetThreadTurnInput = {
  contentMode?: 'full' | 'summary'
}

export type GetThreadTurnItemInput = {
  contentMode?: 'full' | 'summary'
}

export type GetThreadTurnItemOutputInput = {
  beforeLine?: number
  outputMode?: 'full' | 'summary' | 'tail'
  tailLines?: number
}

export type CreateThreadInput = {
  model?: string
  name?: string
  permissionPreset?: string
}

export type RenameThreadInput = {
  name: string
}

export type RunThreadShellCommandInput = {
  command: string
}

export function listThreads(workspaceId: string) {
  return apiRequest<Thread[]>(`/api/workspaces/${workspaceId}/threads`)
}

export function listThreadsPage(
  workspaceId: string,
  input: ListThreadsPageInput = {},
) {
  const query = new URLSearchParams()
  if (typeof input.archived === 'boolean') {
    query.set('archived', String(input.archived))
  }
  if (input.cursor) {
    query.set('cursor', input.cursor)
  }
  if (input.limit && input.limit > 0) {
    query.set('limit', String(input.limit))
  }
  if (input.sortKey) {
    query.set('sortKey', input.sortKey)
  }

  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<ThreadListPage>(`/api/workspaces/${workspaceId}/threads${suffix}`)
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

export function getThread(
  workspaceId: string,
  threadId: string,
  input?: GetThreadInput,
) {
  const query = new URLSearchParams()
  if (input?.beforeTurnId) {
    query.set('beforeTurnId', input.beforeTurnId)
  }
  if (input?.contentMode) {
    query.set('contentMode', input.contentMode)
  }
  if (input?.turnLimit && input.turnLimit > 0) {
    query.set('turnLimit', String(input.turnLimit))
  }

  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<ThreadDetail>(`/api/workspaces/${workspaceId}/threads/${threadId}${suffix}`)
}

export function getThreadTurn(
  workspaceId: string,
  threadId: string,
  turnId: string,
  input?: GetThreadTurnInput,
) {
  const query = new URLSearchParams()
  if (input?.contentMode) {
    query.set('contentMode', input.contentMode)
  }

  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<ThreadTurn>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/turns/${turnId}${suffix}`,
  )
}

export function getThreadTurnItem(
  workspaceId: string,
  threadId: string,
  turnId: string,
  itemId: string,
  input?: GetThreadTurnItemInput,
) {
  const query = new URLSearchParams()
  if (input?.contentMode) {
    query.set('contentMode', input.contentMode)
  }

  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<Record<string, unknown>>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/turns/${turnId}/items/${itemId}${suffix}`,
  )
}

export function getThreadTurnItemOutput(
  workspaceId: string,
  threadId: string,
  turnId: string,
  itemId: string,
  input?: GetThreadTurnItemOutputInput,
) {
  const query = new URLSearchParams()
  if (input?.outputMode) {
    query.set('outputMode', input.outputMode)
  }
  if (input?.beforeLine && input.beforeLine > 0) {
    query.set('beforeLine', String(input.beforeLine))
  }
  if (input?.tailLines && input.tailLines > 0) {
    query.set('tailLines', String(input.tailLines))
  }

  const suffix = query.size ? `?${query.toString()}` : ''
  return apiRequest<ThreadTurnItemOutput>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/turns/${turnId}/items/${itemId}/output${suffix}`,
  )
}

export function createThread(
  workspaceId: string,
  input: CreateThreadInput = {},
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

export function renameThread(workspaceId: string, threadId: string, input: RenameThreadInput) {
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

export function runThreadShellCommand(
  workspaceId: string,
  threadId: string,
  input: RunThreadShellCommandInput,
) {
  return apiRequest<{ status: string }>(
    `/api/workspaces/${workspaceId}/threads/${threadId}/shell-command`,
    {
      method: 'POST',
      body: JSON.stringify(input),
    },
  )
}
