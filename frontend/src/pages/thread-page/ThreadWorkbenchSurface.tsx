import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'

import { InlineNotice } from '../../components/ui/InlineNotice'
import { ApprovalStack, LiveFeed, TurnTimeline } from '../../components/workspace/renderers'
import type { LiveTimelineEntry } from '../../components/workspace/timeline-utils'
import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config'
import type { PendingApproval, Thread, ThreadTurn } from '../../types/api'

type ThreadRuntimeNotice = {
  title: string
  message: string
  summary: string
  noticeKey: string
}

export function ThreadWorkbenchSurface({
  activePendingTurnPhase,
  activeSurfacePanelSide,
  approvalAnswers,
  approvalErrors,
  children,
  approvals,
  displayedTurns,
  isMobileViewport,
  isSurfacePanelResizing,
  isThreadPinnedToLatest,
  isThreadProcessing,
  isWaitingForThreadData,
  liveTimelineEntries,
  onChangeApprovalAnswer,
  onCloseWorkbenchOverlay,
  onRespondApproval,
  onRetryServerRequest,
  onRetryThreadLoad,
  onSurfacePanelResizeStart,
  onThreadViewportScroll,
  onToggleSurfacePanelSide,
  respondingToApproval,
  selectedThread,
  surfacePanelView,
  threadDetailError,
  threadDetailIsLoading,
  threadLoadErrorMessage,
  threadLogStyle,
  threadRuntimeNotice,
  threadViewportRef,
}: {
  activePendingTurnPhase?: 'sending' | 'waiting'
  activeSurfacePanelSide: SurfacePanelSide
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  children?: ReactNode
  approvals?: PendingApproval[]
  displayedTurns: ThreadTurn[]
  isMobileViewport: boolean
  isSurfacePanelResizing: boolean
  isThreadPinnedToLatest: boolean
  isThreadProcessing: boolean
  isWaitingForThreadData: boolean
  liveTimelineEntries: LiveTimelineEntry[]
  onChangeApprovalAnswer: (requestId: string, questionId: string, value: string) => void
  onCloseWorkbenchOverlay: () => void
  onRespondApproval: (input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) => void
  onRetryServerRequest: (item: Record<string, unknown>) => void
  onRetryThreadLoad: () => void
  onSurfacePanelResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onThreadViewportScroll: () => void
  onToggleSurfacePanelSide: () => void
  respondingToApproval: boolean
  selectedThread?: Thread
  surfacePanelView: SurfacePanelView | null
  threadDetailError: unknown
  threadDetailIsLoading: boolean
  threadLoadErrorMessage?: string
  threadLogStyle: CSSProperties
  threadRuntimeNotice?: ThreadRuntimeNotice
  threadViewportRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="workbench-stage__canvas">
      <div className="workbench-log" style={threadLogStyle}>
        <div
          aria-busy={isThreadProcessing}
          className="workbench-log__viewport"
          onScroll={onThreadViewportScroll}
          ref={threadViewportRef}
        >
          {selectedThread ? (
            threadDetailIsLoading && !displayedTurns.length ? (
              <div className="notice">Loading thread surface…</div>
            ) : threadDetailError && !displayedTurns.length ? (
              <InlineNotice
                details={threadLoadErrorMessage}
                dismissible
                noticeKey={`thread-load-${threadDetailError instanceof Error ? threadDetailError.message : 'unknown'}`}
                onRetry={onRetryThreadLoad}
                title="Failed To Load Thread"
                tone="error"
              >
                {threadLoadErrorMessage}
              </InlineNotice>
            ) : displayedTurns.length ? (
              <div className="workbench-log__thread">
                {threadRuntimeNotice ? (
                  <InlineNotice
                    details={threadRuntimeNotice.summary}
                    dismissible
                    noticeKey={threadRuntimeNotice.noticeKey}
                    onRetry={onRetryThreadLoad}
                    title={threadRuntimeNotice.title}
                    tone="error"
                  >
                    {threadRuntimeNotice.message}
                  </InlineNotice>
                ) : null}
                <TurnTimeline onRetryServerRequest={onRetryServerRequest} turns={displayedTurns} />
                {isWaitingForThreadData ? (
                  <div
                    aria-live="polite"
                    className={
                      activePendingTurnPhase === 'sending'
                        ? 'thread-pending-state thread-pending-state--sending'
                        : 'thread-pending-state thread-pending-state--waiting'
                    }
                    role="status"
                  >
                    <span aria-hidden="true" className="thread-pending-state__spinner" />
                    <div className="thread-pending-state__copy">
                      <strong>
                        {activePendingTurnPhase === 'sending'
                          ? 'Sending message…'
                          : 'Generating reply…'}
                      </strong>
                      <span>
                        {activePendingTurnPhase === 'sending'
                          ? 'Your message is staged and the thread is preparing a response.'
                          : isThreadPinnedToLatest
                            ? 'Auto-follow is keeping the newest output in view.'
                            : 'New output is arriving. Jump to latest to keep following it.'}
                      </span>
                    </div>
                  </div>
                ) : null}
                <div aria-hidden="true" className="workbench-log__bottom-anchor" />
              </div>
            ) : (
              <div className="empty-state workbench-log__empty">
                Send the first message to start this thread.
              </div>
            )
          ) : (
            <div className="empty-state workbench-log__empty">
              <div className="form-stack">
                <p>Select a thread from the left sidebar to start working in this workspace.</p>
              </div>
            </div>
          )}
        </div>
        {surfacePanelView ? (
          <section
            className={
              isMobileViewport
                ? 'workbench-log__panel workbench-log__panel--mobile'
                : isSurfacePanelResizing
                  ? `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide} workbench-log__panel--resizing`
                  : `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide}`
            }
          >
            {!isMobileViewport ? (
              <button
                aria-label="Resize surface panel"
                className="workbench-log__panel-resize"
                onPointerDown={onSurfacePanelResizeStart}
                type="button"
              />
            ) : null}
            <div className="workbench-log__panel-header">
              <div>
                <h2>{surfacePanelView === 'feed' ? 'Live Feed' : 'Approvals'}</h2>
                <p>
                  {surfacePanelView === 'feed'
                    ? 'Inspect recent live activity without opening the full side rail.'
                    : 'Review pending approvals as a smaller in-surface panel.'}
                </p>
              </div>
              <div className="workbench-log__panel-actions">
                {!isMobileViewport ? (
                  <button
                    className="pane-section__toggle"
                    onClick={onToggleSurfacePanelSide}
                    type="button"
                  >
                    {activeSurfacePanelSide === 'right' ? 'Dock Left' : 'Dock Right'}
                  </button>
                ) : null}
                <button
                  className="pane-section__toggle"
                  onClick={onCloseWorkbenchOverlay}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="workbench-log__panel-body">
              {surfacePanelView === 'feed' ? (
                liveTimelineEntries.length ? (
                  <LiveFeed entries={liveTimelineEntries} />
                ) : (
                  <div className="empty-state">No live feed entries yet.</div>
                )
              ) : approvals?.length ? (
                <ApprovalStack
                  approvalAnswers={approvalAnswers}
                  approvalErrors={approvalErrors}
                  approvals={approvals}
                  responding={respondingToApproval}
                  onChangeAnswer={onChangeApprovalAnswer}
                  onRespond={onRespondApproval}
                />
              ) : (
                <div className="empty-state">No pending approvals in this workspace.</div>
              )}
            </div>
          </section>
        ) : null}
      </div>
      {children}
    </div>
  )
}
