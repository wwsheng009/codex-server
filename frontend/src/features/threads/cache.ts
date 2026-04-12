import type { QueryClient } from '@tanstack/react-query'

import type { Thread, ThreadDetail, ThreadListPage } from '../../types/api'

export function updateThreadArray(
  current: Thread[] | undefined,
  thread: Thread,
) {
  if (!current?.length) {
    return current
  }

  let changed = false
  const next = current.map((item) => {
    if (item.id !== thread.id) {
      return item
    }
    if (threadsEqual(item, thread)) {
      return item
    }
    changed = true
    return thread
  })

  return changed ? normalizeThreads(next) : current
}

export function upsertThreadArray(
  current: Thread[] | undefined,
  thread: Thread,
) {
  const items = current ?? []
  const existing = items.find((item) => item.id === thread.id)
  if (existing && threadsEqual(existing, thread)) {
    return current
  }

  const nextItems = existing
    ? items.map((item) => (item.id === thread.id ? thread : item))
    : [thread, ...items]

  return normalizeThreads(nextItems)
}

export function removeThreadFromArray(
  current: Thread[] | undefined,
  threadId: string,
) {
  if (!current?.length) {
    return current
  }

  return current.filter((thread) => thread.id !== threadId)
}

export function updateThreadPage(
  current: ThreadListPage | undefined,
  thread: Thread,
) {
  if (!current?.data?.length) {
    return current
  }

  let changed = false
  const nextData = current.data.map((item) => {
    if (item.id !== thread.id) {
      return item
    }
    if (threadsEqual(item, thread)) {
      return item
    }
    changed = true
    return thread
  })

  return changed
    ? {
        ...current,
        data: normalizeThreads(nextData),
      }
    : current
}

export function upsertThreadPage(
  current: ThreadListPage | undefined,
  thread: Thread,
) {
  if (!current) {
    return current
  }

  const existing = current.data.find((item) => item.id === thread.id)
  if (existing && threadsEqual(existing, thread)) {
    return current
  }

  return {
    ...current,
    data: normalizeThreads(
      existing
        ? current.data.map((item) => (item.id === thread.id ? thread : item))
        : [thread, ...current.data],
    ),
  }
}

export function removeThreadFromPage(
  current: ThreadListPage | undefined,
  threadId: string,
) {
  if (!current?.data?.length) {
    return current
  }

  return {
    ...current,
    data: current.data.filter((thread) => thread.id !== threadId),
  }
}

export function syncThreadIntoThreadCaches(
  queryClient: QueryClient,
  workspaceId: string,
  thread: Thread,
) {
  queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
    upsertThreadArray(current, thread),
  )
  queryClient.setQueriesData<ThreadListPage>(
    { queryKey: ['shell-threads', workspaceId] },
    (current) => upsertThreadPage(current, thread),
  )
  queryClient.setQueriesData<ThreadDetail>(
    { queryKey: ['thread-detail', workspaceId, thread.id] },
    (current) =>
      current
        ? threadDetailEqualsThread(current, thread)
          ? current
          : {
              ...current,
              ...thread,
            }
        : current,
  )
}

export function updateThreadInThreadCaches(
  queryClient: QueryClient,
  workspaceId: string,
  thread: Thread,
) {
  queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
    updateThreadArray(current, thread),
  )
  queryClient.setQueriesData<ThreadListPage>(
    { queryKey: ['shell-threads', workspaceId] },
    (current) => updateThreadPage(current, thread),
  )
  queryClient.setQueriesData<ThreadDetail>(
    { queryKey: ['thread-detail', workspaceId, thread.id] },
    (current) =>
      current
        ? threadDetailEqualsThread(current, thread)
          ? current
          : {
              ...current,
              ...thread,
            }
        : current,
  )
}

export function removeThreadFromThreadCaches(
  queryClient: QueryClient,
  workspaceId: string,
  threadId: string,
) {
  queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
    removeThreadFromArray(current, threadId),
  )
  queryClient.setQueriesData<ThreadListPage>(
    { queryKey: ['shell-threads', workspaceId] },
    (current) => removeThreadFromPage(current, threadId),
  )
}

export function threadSnapshotFromDetail(
  detail: ThreadDetail,
): Thread {
  return {
    archived: detail.archived,
    createdAt: detail.createdAt,
    id: detail.id,
    messageCount: detail.messageCount,
    name: detail.name,
    sessionStartSource: detail.sessionStartSource,
    status: detail.status,
    turnCount: detail.turnCount,
    updatedAt: detail.updatedAt,
    workspaceId: detail.workspaceId,
  }
}

function normalizeThreads(threads: Thread[]) {
  return dedupeThreadsById(threads).sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )
}

function dedupeThreadsById(threads: Thread[]) {
  const threadById = new Map<string, Thread>()

  for (const thread of threads) {
    const current = threadById.get(thread.id)
    if (!current) {
      threadById.set(thread.id, thread)
      continue
    }

    const currentTs = Date.parse(current.updatedAt)
    const nextTs = Date.parse(thread.updatedAt)
    if (Number.isFinite(nextTs) && (!Number.isFinite(currentTs) || nextTs >= currentTs)) {
      threadById.set(thread.id, thread)
    }
  }

  return [...threadById.values()]
}

function threadsEqual(left: Thread, right: Thread) {
  return (
    left.id === right.id &&
    left.workspaceId === right.workspaceId &&
    left.name === right.name &&
    left.status === right.status &&
    left.archived === right.archived &&
    left.sessionStartSource === right.sessionStartSource &&
    left.turnCount === right.turnCount &&
    left.messageCount === right.messageCount &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  )
}

function threadDetailEqualsThread(detail: ThreadDetail, thread: Thread) {
  return threadsEqual(threadSnapshotFromDetail(detail), thread)
}
