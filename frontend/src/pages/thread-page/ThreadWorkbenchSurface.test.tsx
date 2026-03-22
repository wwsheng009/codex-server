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
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
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
        isWaitingForThreadData={false}
        liveTimelineEntries={[]}
        onChangeApprovalAnswer={() => undefined}
        onCloseWorkbenchOverlay={() => undefined}
        onCreateThread={() => undefined}
        onLoadOlderTurns={() => undefined}
        onRespondApproval={() => undefined}
        onRetryServerRequest={() => undefined}
        onRetryThreadLoad={() => undefined}
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
})
