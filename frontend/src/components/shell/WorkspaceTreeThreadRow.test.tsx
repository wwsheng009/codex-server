// @vitest-environment jsdom

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import { useSessionStore } from '../../stores/session-store'
import type { Thread } from '../../types/api'
import { WorkspaceTreeThreadRow } from './WorkspaceTreeThreadRow'

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    archived: false,
    createdAt: '2026-04-12T10:00:00.000Z',
    id: 'thread-1',
    name: 'Thread 1',
    status: 'idle',
    updatedAt: '2026-04-12T10:00:00.000Z',
    workspaceId: 'ws-1',
    ...overrides,
  }
}

describe('WorkspaceTreeThreadRow', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeEach(() => {
    useSessionStore.setState((state) => ({
      ...state,
      threadActivityByThread: {},
    }))
  })

  afterEach(() => {
    cleanup()
  })

  it('keeps the activity indicator visible while the thread is streaming a response', () => {
    useSessionStore.setState((state) => ({
      ...state,
      threadActivityByThread: {
        ...state.threadActivityByThread,
        'thread-1': {
          latestEventMethod: 'thread/status/changed',
          latestEventTs: '2026-04-12T10:01:00.000Z',
          latestStatus: 'streaming',
          threadId: 'thread-1',
          workspaceId: 'ws-1',
        },
      },
    }))

    const { container } = render(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={true}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread()}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--streaming')).toBeTruthy()
  })

  it('shows the activity indicator when the thread status is responding', () => {
    const { container } = render(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'responding' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--streaming')).toBeTruthy()
    expect(screen.getByText('Streaming')).toBeTruthy()
  })

  it('renders different icons for approval, sending, processing, waiting, error, and archived thread states', () => {
    const { container, rerender } = render(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'reviewing' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--approval')).toBeTruthy()

    rerender(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'sending' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--sending')).toBeTruthy()

    rerender(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'processing' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--processing')).toBeTruthy()

    rerender(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'waiting' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--waiting')).toBeTruthy()

    rerender(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'failed' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--error')).toBeTruthy()

    rerender(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ archived: true, status: 'idle' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--archived')).toBeTruthy()
  })

  it('renders the status label below the relative time', () => {
    render(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'sending' })}
      />,
    )

    const meta = document.querySelector('.workspace-tree__thread-time-meta')
    expect(meta).toBeTruthy()
    expect(meta?.querySelector('.workspace-tree__thread-time')).toBeTruthy()
    expect(meta?.querySelector('.workspace-tree__thread-status-text')?.textContent).toBe('Sending')
  })

  it('keeps icon and text synchronized when activity fallback promotes idle thread to processing', () => {
    useSessionStore.setState((state) => ({
      ...state,
      threadActivityByThread: {
        ...state.threadActivityByThread,
        'thread-1': {
          latestEventMethod: 'item/agentMessage/delta',
          latestEventTs: '2026-04-12T10:01:00.000Z',
          latestStatus: '',
          threadId: 'thread-1',
          workspaceId: 'ws-1',
        },
      },
    }))

    const { container } = render(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'idle' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--processing')).toBeTruthy()
    expect(screen.getByText('Processing')).toBeTruthy()
  })

  it('prefers completed activity status over a stale running thread list status', () => {
    useSessionStore.setState((state) => ({
      ...state,
      threadActivityByThread: {
        ...state.threadActivityByThread,
        'thread-1': {
          latestEventMethod: 'turn/completed',
          latestEventTs: '2026-04-12T10:01:00.000Z',
          latestStatus: 'completed',
          threadId: 'thread-1',
          workspaceId: 'ws-1',
        },
      },
    }))

    const { container } = render(
      <WorkspaceTreeThreadRow
        activeThreadId="thread-2"
        deleteInProgress={false}
        isMenuOpen={false}
        isRenameOrDeletePending={false}
        isSelectedWorkspaceRoute={false}
        onDeleteThread={() => {}}
        onOpenThread={() => {}}
        onRenameThread={() => {}}
        onToggleMenu={() => {}}
        thread={makeThread({ status: 'running' })}
      />,
    )

    expect(container.querySelector('.workspace-tree__thread-status-icon--success')).toBeTruthy()
    expect(screen.getByText('Completed')).toBeTruthy()
  })
})
