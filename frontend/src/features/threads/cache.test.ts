import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { Thread, ThreadDetail, ThreadListPage } from '../../types/api'
import {
  removeThreadFromThreadCaches,
  syncThreadIntoThreadCaches,
  threadSnapshotFromDetail,
  updateThreadInThreadCaches,
} from './cache'

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    archived: false,
    createdAt: '2026-04-12T10:00:00.000Z',
    id: 'thread-1',
    name: 'Untitled thread',
    status: 'idle',
    updatedAt: '2026-04-12T10:00:00.000Z',
    workspaceId: 'ws-1',
    ...overrides,
  }
}

describe('thread cache helpers', () => {
  it('syncs a thread snapshot into the primary list and every shell list page', () => {
    const queryClient = new QueryClient()
    const staleThread = makeThread()
    const refreshedThread = makeThread({
      name: 'Auto generated title',
      status: 'running',
      updatedAt: '2026-04-12T10:05:00.000Z',
    })

    queryClient.setQueryData<Thread[]>(['threads', 'ws-1'], [staleThread])
    queryClient.setQueryData<ThreadListPage>(
      ['shell-threads', 'ws-1', { archived: false, limit: 8 }],
      { data: [staleThread], nextCursor: null },
    )
    queryClient.setQueryData<ThreadListPage>(
      ['shell-threads', 'ws-1', { archived: false, limit: 20 }],
      { data: [staleThread], nextCursor: 'cursor-1' },
    )
    queryClient.setQueryData<ThreadDetail>(
      ['thread-detail', 'ws-1', 'thread-1', 50],
      { ...staleThread, turns: [] },
    )

    syncThreadIntoThreadCaches(queryClient, 'ws-1', refreshedThread)

    expect(queryClient.getQueryData<Thread[]>(['threads', 'ws-1'])?.[0]?.name).toBe(
      'Auto generated title',
    )
    expect(
      queryClient.getQueryData<ThreadListPage>([
        'shell-threads',
        'ws-1',
        { archived: false, limit: 8 },
      ])?.data[0]?.name,
    ).toBe('Auto generated title')
    expect(
      queryClient.getQueryData<ThreadListPage>([
        'shell-threads',
        'ws-1',
        { archived: false, limit: 20 },
      ])?.data[0]?.status,
    ).toBe('running')
    expect(
      queryClient.getQueryData<ThreadDetail>(['thread-detail', 'ws-1', 'thread-1', 50])?.name,
    ).toBe('Auto generated title')
  })

  it('removes a thread from the primary list and every shell list page', () => {
    const queryClient = new QueryClient()
    const thread = makeThread()

    queryClient.setQueryData<Thread[]>(['threads', 'ws-1'], [thread])
    queryClient.setQueryData<ThreadListPage>(
      ['shell-threads', 'ws-1', { archived: false, limit: 8 }],
      { data: [thread], nextCursor: null },
    )

    removeThreadFromThreadCaches(queryClient, 'ws-1', thread.id)

    expect(queryClient.getQueryData<Thread[]>(['threads', 'ws-1'])).toEqual([])
    expect(
      queryClient.getQueryData<ThreadListPage>([
        'shell-threads',
        'ws-1',
        { archived: false, limit: 8 },
      ])?.data,
    ).toEqual([])
  })

  it('converts a thread detail into a list snapshot without dropping counters', () => {
    const detail: ThreadDetail = {
      ...makeThread({
        messageCount: 3,
        name: 'Summarize release notes',
        turnCount: 2,
      }),
      turns: [],
    }

    expect(threadSnapshotFromDetail(detail)).toEqual(
      makeThread({
        messageCount: 3,
        name: 'Summarize release notes',
        turnCount: 2,
      }),
    )
  })

  it('updates only the matching shell list row without injecting the thread into unrelated pages', () => {
    const queryClient = new QueryClient()
    const selectedThread = makeThread({
      id: 'thread-selected',
      name: 'Generated title',
      updatedAt: '2026-04-12T10:06:00.000Z',
    })
    const otherThread = makeThread({
      id: 'thread-other',
      name: 'Other thread',
      updatedAt: '2026-04-12T10:02:00.000Z',
    })

    queryClient.setQueryData<ThreadListPage>(
      ['shell-threads', 'ws-1', { archived: false, limit: 8 }],
      { data: [otherThread], nextCursor: null },
    )

    updateThreadInThreadCaches(queryClient, 'ws-1', selectedThread)

    expect(
      queryClient.getQueryData<ThreadListPage>([
        'shell-threads',
        'ws-1',
        { archived: false, limit: 8 },
      ])?.data,
    ).toEqual([otherThread])
  })

  it('keeps thread lists sorted by createdAt descending after cache sync', () => {
    const queryClient = new QueryClient()
    const olderCreatedThread = makeThread({
      id: 'thread-older-created',
      createdAt: '2026-04-12T10:00:00.000Z',
      updatedAt: '2026-04-12T10:09:00.000Z',
      name: 'Older created thread',
    })
    const newerCreatedThread = makeThread({
      id: 'thread-newer-created',
      createdAt: '2026-04-12T10:08:00.000Z',
      updatedAt: '2026-04-12T10:08:00.000Z',
      name: 'Newer created thread',
    })

    queryClient.setQueryData<Thread[]>(['threads', 'ws-1'], [olderCreatedThread])
    queryClient.setQueryData<ThreadListPage>(
      ['shell-threads', 'ws-1', { archived: false, limit: 8, sortKey: 'created_at' }],
      { data: [olderCreatedThread], nextCursor: null },
    )

    syncThreadIntoThreadCaches(queryClient, 'ws-1', newerCreatedThread)

    expect(queryClient.getQueryData<Thread[]>(['threads', 'ws-1'])?.map((thread) => thread.id)).toEqual([
      'thread-newer-created',
      'thread-older-created',
    ])
    expect(
      queryClient
        .getQueryData<ThreadListPage>([
          'shell-threads',
          'ws-1',
          { archived: false, limit: 8, sortKey: 'created_at' },
        ])
        ?.data.map((thread) => thread.id),
    ).toEqual(['thread-newer-created', 'thread-older-created'])
  })
})
