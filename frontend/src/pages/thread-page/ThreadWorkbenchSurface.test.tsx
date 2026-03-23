import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchSurface } from './ThreadWorkbenchSurface'

describe('ThreadWorkbenchSurface', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
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
})
