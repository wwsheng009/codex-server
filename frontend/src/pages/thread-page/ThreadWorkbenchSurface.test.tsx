import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import {
  shouldScheduleOlderTurnsAutoload,
  shouldFreezeThreadTimelineVirtualization,
  ThreadWorkbenchSurface,
  triggerOlderTurnsLoadWithAnchor,
} from './ThreadWorkbenchSurface'

describe('ThreadWorkbenchSurface', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('captures a preserve-position anchor before loading older turns', () => {
    const calls: string[] = []

    triggerOlderTurnsLoadWithAnchor({
      onCaptureOlderTurnsAnchor: (restoreMode) => {
        calls.push(`capture:${restoreMode ?? 'unset'}`)
      },
      onLoadOlderTurns: () => {
        calls.push('load')
      },
    })

    expect(calls).toEqual(['capture:preserve-position', 'load'])
  })

  it('schedules older-turn autoload only near the top when more history is available', () => {
    expect(
      shouldScheduleOlderTurnsAutoload({
        hasMoreTurnsBefore: true,
        isLoadingOlderTurns: false,
        scrollTop: 48,
      }),
    ).toBe(true)

    expect(
      shouldScheduleOlderTurnsAutoload({
        hasMoreTurnsBefore: false,
        isLoadingOlderTurns: false,
        scrollTop: 48,
      }),
    ).toBe(false)

    expect(
      shouldScheduleOlderTurnsAutoload({
        hasMoreTurnsBefore: true,
        isLoadingOlderTurns: true,
        scrollTop: 48,
      }),
    ).toBe(false)

    expect(
      shouldScheduleOlderTurnsAutoload({
        hasMoreTurnsBefore: true,
        isLoadingOlderTurns: false,
        scrollTop: 120,
      }),
    ).toBe(false)
  })

  it('freezes timeline virtualization while a pinned thread is streaming or waiting', () => {
    expect(
      shouldFreezeThreadTimelineVirtualization({
        activePendingTurnPhase: 'waiting',
        isThreadPinnedToLatest: true,
        isThreadProcessing: false,
        isThreadViewportInteracting: false,
      }),
    ).toBe(true)

    expect(
      shouldFreezeThreadTimelineVirtualization({
        activePendingTurnPhase: undefined,
        isThreadPinnedToLatest: true,
        isThreadProcessing: true,
        isThreadViewportInteracting: false,
      }),
    ).toBe(true)
  })

  it('keeps timeline virtualization live only when the viewport is pinned and idle', () => {
    expect(
      shouldFreezeThreadTimelineVirtualization({
        activePendingTurnPhase: undefined,
        isThreadPinnedToLatest: true,
        isThreadProcessing: false,
        isThreadViewportInteracting: false,
      }),
    ).toBe(false)
  })

  it('shows a create-thread call to action for an empty workspace', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[]}
        hasMoreTurnsBefore={false}
        hasThreads={false}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={true}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={false}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        selectedThread={undefined}
        surfacePanelView={null}
        threadDetailError={null}
        threadDetailIsLoading={false}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity=""
        workspaceName="this workspace"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('Workspace this workspace does not have any threads yet.')
    expect(html).toContain('Create First Thread')
    expect(html).not.toContain('composer-probe')
  })

  it('does not show the create-thread empty state before threads finish loading', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[]}
        hasMoreTurnsBefore={false}
        hasThreads={false}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={false}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={false}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        selectedThread={undefined}
        surfacePanelView={null}
        threadDetailError={null}
        threadDetailIsLoading={false}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity=""
        workspaceName="temp"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('Loading workspace threads…')
    expect(html).not.toContain('Create First Thread')
    expect(html).toContain('composer-probe')
  })

  it('uses a compact loading state while a selected thread detail is loading', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[]}
        hasMoreTurnsBefore={false}
        hasThreads={true}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={true}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={false}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Thread 1',
          status: 'idle',
          archived: false,
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        }}
        surfacePanelView={null}
        threadDetailError={null}
        threadDetailIsLoading={true}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity="thread-1"
        workspaceName="workspace"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('Loading thread surface…')
    expect(html).toContain('workbench-log__loading')
    expect(html).not.toContain('loading-state--fill')
    expect(html).toContain('composer-probe')
  })

  it('does not render the pending reply prompt while the thread is waiting', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activePendingTurnPhase="waiting"
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[
          {
            id: 'turn-1',
            status: 'inProgress',
            items: [
              {
                id: 'msg-1',
                type: 'agentMessage',
                text: 'Partial reply',
              },
            ],
          },
        ]}
        hasMoreTurnsBefore={false}
        hasThreads={true}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={true}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={true}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={true}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Thread 1',
          status: 'inProgress',
          archived: false,
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        }}
        surfacePanelView={null}
        threadDetailError={null}
        threadDetailIsLoading={false}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity="thread-1"
        workspaceName="workspace"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('Partial reply')
    expect(html).not.toContain('Generating reply…')
    expect(html).not.toContain('Sending message…')
  })

  it('renders the standalone plans surface panel when plans view is active', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[
          {
            id: 'turn-1',
            status: 'inProgress',
            items: [
              {
                id: 'turn-plan-1',
                type: 'turnPlan',
                explanation: 'Track update_plan state separately from the chat timeline.',
                status: 'inProgress',
                steps: [
                  {
                    step: 'Add plans panel view',
                    status: 'completed',
                  },
                  {
                    step: 'Render grouped plan statuses',
                    status: 'inProgress',
                  },
                ],
              },
            ],
          },
        ]}
        hasMoreTurnsBefore={false}
        hasThreads={true}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={true}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={false}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Thread 1',
          status: 'inProgress',
          archived: false,
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        }}
        surfacePanelView="plans"
        threadDetailError={null}
        threadDetailIsLoading={false}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity="thread-1"
        workspaceName="workspace"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('<h2>Plans</h2>')
    expect(html).not.toContain('Review update_plan step lists and their current execution status in one place.')
    expect(html).toContain('Track update_plan state separately from the chat timeline.')
    expect(html).toContain('Add plans panel view')
    expect(html).toContain('Render grouped plan statuses')
    expect(html).toContain('workbench-log__panel--plans')
    expect(html).toContain('workbench-log__panel-body--plans')
  })

  it('renders runtime recovery guidance above the thread timeline when diagnostics are available', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                id: 'msg-1',
                type: 'agentMessage',
                text: 'done',
              },
            ],
          },
        ]}
        hasMoreTurnsBefore={false}
        hasThreads={true}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={true}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={false}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRestartRuntime={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        runtimeRecoveryNotice={{
          title: 'Runtime Recovery Guidance',
          tone: 'error',
          categoryLabel: 'Runtime process exit',
          recoveryActionLabel: 'Restart runtime, then retry',
          retryable: true,
          retryableLabel: 'Yes',
          requiresRecycle: true,
          recycleLabel: 'Yes',
          description:
            'Last error: runtime exited unexpectedly. Category: Runtime process exit.',
          details: 'Recent stderr:\n- runtime exited unexpectedly',
        }}
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Thread 1',
          status: 'completed',
          archived: false,
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        }}
        surfacePanelView={null}
        threadDetailError={null}
        threadDetailIsLoading={false}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity="thread-1"
        workspaceName="workspace"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('Runtime Recovery Guidance')
    expect(html).toContain('runtime exited unexpectedly')
    expect(html).toContain('Restart Runtime')
  })

  it('prefers restart-and-retry guidance when a recoverable send operation is available', () => {
    const html = renderToStaticMarkup(
      <ThreadWorkbenchSurface
        activeSurfacePanelSide="right"
        approvalAnswers={{}}
        approvalErrors={{}}
        approvals={[]}
        createThreadErrorMessage={undefined}
        displayedTurns={[
          {
            id: 'turn-1',
            status: 'completed',
            items: [
              {
                id: 'msg-1',
                type: 'agentMessage',
                text: 'done',
              },
            ],
          },
        ]}
        hasMoreTurnsBefore={false}
        hasRecoverableRuntimeOperation
        hasThreads={true}
        hiddenTurnsCount={0}
        isCreateThreadPending={false}
        isLoadingOlderTurns={false}
        isThreadsLoaded={true}
        isThreadSelectionLoading={false}
        isMobileViewport={false}
        isSurfacePanelResizing={false}
        isThreadPinnedToLatest={true}
        isThreadProcessing={false}
        isThreadViewportInteracting={false}
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCaptureOlderTurnsAnchor={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onReleaseFullTurn={() => undefined}
        onRestartAndRetry={() => undefined}
        onRestartRuntime={() => undefined}
        onRetainFullTurn={() => undefined}
        onRequestFullTurn={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
        onRestoreOlderTurnsViewport={() => undefined}
        onSurfacePanelResizeStart={() => undefined}
        onThreadViewportScroll={() => undefined}
        onToggleSurfacePanelSide={() => undefined}
        respondingToApproval={false}
        runtimeRecoveryNotice={{
          title: 'Runtime Recovery Guidance',
          tone: 'error',
          categoryLabel: 'Runtime process exit',
          recoveryActionLabel: 'Restart runtime, then retry',
          retryable: true,
          retryableLabel: 'Yes',
          requiresRecycle: true,
          recycleLabel: 'Yes',
          description:
            'Last error: runtime exited unexpectedly. Category: Runtime process exit.',
          details: 'Recent stderr:\n- runtime exited unexpectedly',
        }}
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Thread 1',
          status: 'completed',
          archived: false,
          createdAt: '2026-03-20T00:00:00.000Z',
          updatedAt: '2026-03-20T00:00:00.000Z',
        }}
        surfacePanelView={null}
        threadDetailError={null}
        threadDetailIsLoading={false}
        threadLogStyle={{}}
        threadViewportRef={{ current: null }}
        timelineIdentity="thread-1"
        workspaceName="workspace"
      >
        <div>composer-probe</div>
      </ThreadWorkbenchSurface>,
    )

    expect(html).toContain('Restart and Retry')
    expect(html).not.toContain('Restart Runtime')
  })
})
