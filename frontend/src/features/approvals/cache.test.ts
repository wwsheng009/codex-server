import { describe, expect, it } from 'vitest'

import { nextApprovalsForEvent, removeApprovalFromList, removeThreadApprovalsFromList } from './cache'
import type { ApprovalBuilderOverrides } from './approvalTypes'
import type { PendingApproval, ServerEvent } from '../../types/api'

describe('approval cache helpers', () => {
  it('adds pending approvals from live server request events', () => {
    const event: ServerEvent = {
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      method: 'item/commandExecution/requestApproval',
      payload: {
        command: 'npm run build',
      },
      serverRequestId: 'req-1',
      ts: '2026-03-23T10:00:00.000Z',
    }

    expect(nextApprovalsForEvent([], event)).toEqual([
      {
        id: 'req-1',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        kind: 'item/commandExecution/requestApproval',
        summary: 'npm run build',
        status: 'pending',
        actions: ['accept', 'decline', 'cancel'],
        details: {
          command: 'npm run build',
        },
        requestedAt: '2026-03-23T10:00:00.000Z',
      },
    ])
  })

  it('removes approvals when requests resolve or expire', () => {
    const current: PendingApproval[] = [
      buildApproval({ id: 'req-1', threadId: 'thread-1' }),
      buildApproval({ id: 'req-2', threadId: 'thread-2' }),
    ]

    expect(
      nextApprovalsForEvent(current, {
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        method: 'server/request/resolved',
        payload: {},
        serverRequestId: 'req-1',
        ts: '2026-03-23T10:01:00.000Z',
      }),
    ).toEqual([buildApproval({ id: 'req-2', threadId: 'thread-2' })])

    expect(
      nextApprovalsForEvent(current, {
        workspaceId: 'ws-1',
        threadId: 'thread-2',
        method: 'server/request/expired',
        payload: {},
        serverRequestId: 'req-2',
        ts: '2026-03-23T10:02:00.000Z',
      }),
    ).toEqual([buildApproval({ id: 'req-1', threadId: 'thread-1' })])
  })

  it('replaces the cache from approvals snapshot events', () => {
    const next = nextApprovalsForEvent(undefined, {
      workspaceId: 'ws-1',
      method: 'approvals/snapshot',
      payload: {
        approvals: [
          buildApproval({
            id: 'req-older',
            requestedAt: '2026-03-23T10:00:00.000Z',
            summary: 'older',
          }),
          buildApproval({
            id: 'req-newer',
            requestedAt: '2026-03-23T10:05:00.000Z',
            summary: 'newer',
          }),
        ],
      },
      ts: '2026-03-23T10:05:00.000Z',
    })

    expect(next?.map((approval) => approval.id)).toEqual(['req-newer', 'req-older'])
  })

  it('supports local removals after mutations', () => {
    const current: PendingApproval[] = [
      buildApproval({ id: 'req-1', threadId: 'thread-1' }),
      buildApproval({ id: 'req-2', threadId: 'thread-2' }),
    ]

    expect(removeApprovalFromList(current, 'req-1')).toEqual([
      buildApproval({ id: 'req-2', threadId: 'thread-2' }),
    ])
    expect(removeThreadApprovalsFromList(current, 'thread-2')).toEqual([
      buildApproval({ id: 'req-1', threadId: 'thread-1' }),
    ])
  })
})

function buildApproval(overrides: ApprovalBuilderOverrides): PendingApproval {
  return {
    id: overrides.id,
    workspaceId: overrides.workspaceId ?? 'ws-1',
    threadId: overrides.threadId ?? 'thread-1',
    kind: overrides.kind ?? 'item/commandExecution/requestApproval',
    summary: overrides.summary ?? 'npm run build',
    status: overrides.status ?? 'pending',
    actions: overrides.actions ?? ['accept', 'decline', 'cancel'],
    details: overrides.details ?? { command: 'npm run build' },
    requestedAt: overrides.requestedAt ?? '2026-03-23T10:00:00.000Z',
  }
}
