import type { QueryClient, QueryKey } from '@tanstack/react-query'

import type {
  Thread,
  ThreadDetail,
  ThreadListPage,
  ThreadListSortKey,
} from '../../types/api'

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

  return changed ? normalizeThreads(next, 'created_at') : current
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

  return normalizeThreads(nextItems, 'created_at')
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
  sortKey: ThreadListSortKey = 'created_at',
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
        data: normalizeThreads(nextData, sortKey),
      }
    : current
}

export function upsertThreadPage(
  current: ThreadListPage | undefined,
  thread: Thread,
  sortKey: ThreadListSortKey = 'created_at',
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
      sortKey,
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
  updateShellThreadPageCaches(queryClient, workspaceId, (current, sortKey) =>
    upsertThreadPage(current, thread, sortKey),
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
  updateShellThreadPageCaches(queryClient, workspaceId, (current, sortKey) =>
    updateThreadPage(current, thread, sortKey),
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

function updateShellThreadPageCaches(
  queryClient: QueryClient,
  workspaceId: string,
  updatePage: (
    current: ThreadListPage | undefined,
    sortKey: ThreadListSortKey,
  ) => ThreadListPage | undefined,
) {
  const queries = queryClient.getQueriesData<ThreadListPage>({
    queryKey: ['shell-threads', workspaceId],
  })

  for (const [queryKey, current] of queries) {
    const sortKey = resolveThreadListSortKeyFromQueryKey(queryKey)
    queryClient.setQueryData<ThreadListPage>(
      queryKey,
      updatePage(current, sortKey),
    )
  }
}

function resolveThreadListSortKeyFromQueryKey(queryKey: QueryKey): ThreadListSortKey {
  const options = queryKey[2]

  if (
    options &&
    typeof options === 'object' &&
    'sortKey' in options &&
    options.sortKey === 'updated_at'
  ) {
    return 'updated_at'
  }

  return 'created_at'
}

function normalizeThreads(threads: Thread[], sortKey: ThreadListSortKey) {
  const timestampKey = sortKey === 'updated_at' ? 'updatedAt' : 'createdAt'

  return dedupeThreadsById(threads).sort((left, right) => {
    const rightTs = Date.parse(right[timestampKey])
    const leftTs = Date.parse(left[timestampKey])
    const rightCreatedTs = Date.parse(right.createdAt)
    const leftCreatedTs = Date.parse(left.createdAt)

    if (Number.isFinite(rightTs) && Number.isFinite(leftTs) && rightTs !== leftTs) {
      return rightTs - leftTs
    }

    if (
      Number.isFinite(rightCreatedTs) &&
      Number.isFinite(leftCreatedTs) &&
      rightCreatedTs !== leftCreatedTs
    ) {
      return rightCreatedTs - leftCreatedTs
    }

    return right.id.localeCompare(left.id)
  })
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
