import { useEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'

import { InlineNotice } from '../../components/ui/InlineNotice'
import { LoadingState } from '../../components/ui/LoadingState'
import { ApprovalStack, LiveFeed, TurnTimeline } from '../../components/workspace/renderers'
import type { LiveTimelineEntry } from '../../components/workspace/timeline-utils'
import { i18n } from '../../i18n/runtime'
import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config'
import type { PendingApproval, Thread, ThreadTurn } from '../../types/api'

type ThreadRuntimeNotice = {
  title: string
  message: string
  summary: string
  noticeKey: string
}

const OLDER_TURNS_AUTOLOAD_THRESHOLD_PX = 72

export function ThreadWorkbenchSurface({
  activePendingTurnPhase,
  activeSurfacePanelSide,
  approvalAnswers,
  approvalErrors,
  children,
  approvals,
  createThreadErrorMessage,
  displayedTurns,
  hasMoreTurnsBefore,
  hasThreads,
  hiddenTurnsCount,
  isCreateThreadPending,
  isLoadingOlderTurns,
  isThreadsLoaded,
  isThreadSelectionLoading,
  isMobileViewport,
  isSurfacePanelResizing,
  isThreadPinnedToLatest,
  isThreadProcessing,
  isWaitingForThreadData,
  liveTimelineEntries,
  onChangeApprovalAnswer,
  onCloseWorkbenchOverlay,
  onCreateThread,
  onLoadOlderTurns,
  onReleaseFullTurn,
  onRetainFullTurn,
  onRequestFullTurn,
  onRespondApproval,
  onRetryServerRequest,
  onRetryThreadLoad,
  onSurfacePanelResizeStart,
  onThreadViewportScroll,
  onToggleSurfacePanelSide,
  respondingToApproval,
  selectedThread,
  surfacePanelView,
  timelineIdentity,
  threadDetailError,
  threadDetailIsLoading,
  threadLoadErrorMessage,
  threadLogStyle,
  threadRuntimeNotice,
  threadViewportRef,
  workspaceName,
}: {
  activePendingTurnPhase?: 'sending' | 'waiting'
  activeSurfacePanelSide: SurfacePanelSide
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  children?: ReactNode
  approvals?: PendingApproval[]
  createThreadErrorMessage?: string
  displayedTurns: ThreadTurn[]
  hasMoreTurnsBefore: boolean
  hasThreads: boolean
  hiddenTurnsCount: number
  isCreateThreadPending: boolean
  isLoadingOlderTurns: boolean
  isThreadsLoaded: boolean
  isThreadSelectionLoading: boolean
  isMobileViewport: boolean
  isSurfacePanelResizing: boolean
  isThreadPinnedToLatest: boolean
  isThreadProcessing: boolean
  isWaitingForThreadData: boolean
  liveTimelineEntries: LiveTimelineEntry[]
  onChangeApprovalAnswer: (requestId: string, questionId: string, value: string) => void
  onCloseWorkbenchOverlay: () => void
  onCreateThread: () => void
  onLoadOlderTurns: () => void
  onReleaseFullTurn: (turnId: string, itemId?: string) => void
  onRetainFullTurn: (turnId: string, itemId?: string) => void
  onRequestFullTurn: (turnId: string, itemId?: string) => void
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
  timelineIdentity: string
  threadDetailError: unknown
  threadDetailIsLoading: boolean
  threadLoadErrorMessage?: string
  threadLogStyle: CSSProperties
  threadRuntimeNotice?: ThreadRuntimeNotice
  threadViewportRef: RefObject<HTMLDivElement | null>
  workspaceName?: string
}) {
  const pendingOlderTurnsAnchorRef = useRef<{
    scrollHeight: number
    scrollTop: number
  } | null>(null)
  const previousOlderTurnsLoadingRef = useRef(isLoadingOlderTurns)

  useEffect(() => {
    const wasLoadingOlderTurns = previousOlderTurnsLoadingRef.current
    previousOlderTurnsLoadingRef.current = isLoadingOlderTurns

    if (!wasLoadingOlderTurns || isLoadingOlderTurns) {
      return
    }

    const anchor = pendingOlderTurnsAnchorRef.current
    const viewport = threadViewportRef.current
    pendingOlderTurnsAnchorRef.current = null

    if (!anchor || !viewport) {
      return
    }

    const scrollHeightDelta = viewport.scrollHeight - anchor.scrollHeight
    if (scrollHeightDelta <= 0) {
      return
    }

    viewport.scrollTo({
      top: anchor.scrollTop + scrollHeightDelta,
      behavior: 'auto',
    })
  }, [isLoadingOlderTurns, threadViewportRef])

  function handleViewportScroll() {
    const viewport = threadViewportRef.current
    if (
      viewport &&
      hasMoreTurnsBefore &&
      !isLoadingOlderTurns &&
      pendingOlderTurnsAnchorRef.current === null &&
      viewport.scrollTop <= OLDER_TURNS_AUTOLOAD_THRESHOLD_PX
    ) {
      pendingOlderTurnsAnchorRef.current = {
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      }
      onLoadOlderTurns()
    }

    onThreadViewportScroll()
  }

  const showCreateThreadEmptyState =
    !selectedThread && !isThreadSelectionLoading && isThreadsLoaded && !hasThreads
  const showThreadsLoadingState =
    isThreadSelectionLoading || (!selectedThread && !isThreadsLoaded)

  return (
    <div className="workbench-stage__canvas">
      <div className="workbench-log" style={threadLogStyle}>
        <div
          aria-busy={isThreadProcessing}
          className="workbench-log__viewport"
          onScroll={handleViewportScroll}
          ref={threadViewportRef}
        >
          {selectedThread ? (
            threadDetailIsLoading && !displayedTurns.length ? (
              <LoadingState
                message={i18n._({
                  id: 'Loading thread surface…',
                  message: 'Loading thread surface…',
                })}
              />
            ) : threadDetailError && !displayedTurns.length ? (
              <InlineNotice
                details={threadLoadErrorMessage}
                dismissible
                noticeKey={`thread-load-${threadDetailError instanceof Error ? threadDetailError.message : 'unknown'}`}
                onRetry={onRetryThreadLoad}
                title={i18n._({
                  id: 'Failed to load thread',
                  message: 'Failed to load thread',
                })}
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
                {hasMoreTurnsBefore ? (
                  <div className="conversation-history-window">
                    <button
                      className="conversation-history-window__button"
                      disabled={isLoadingOlderTurns}
                      onClick={onLoadOlderTurns}
                      type="button"
                    >
                      {isLoadingOlderTurns
                        ? i18n._({
                            id: 'Loading earlier turns…',
                            message: 'Loading earlier turns…',
                          })
                        : hiddenTurnsCount > 0
                          ? i18n._({
                              id: 'Load {count} earlier turns',
                              message: 'Load {count} earlier turns',
                              values: { count: hiddenTurnsCount },
                            })
                          : i18n._({
                              id: 'Load earlier turns',
                              message: 'Load earlier turns',
                            })}
                    </button>
                  </div>
                ) : null}
                <TurnTimeline
                  onReleaseFullTurn={onReleaseFullTurn}
                  onRetainFullTurn={onRetainFullTurn}
                  onRequestFullTurn={onRequestFullTurn}
                  onRetryServerRequest={onRetryServerRequest}
                  scrollViewportRef={threadViewportRef}
                  timelineIdentity={timelineIdentity}
                  turns={displayedTurns}
                />
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
                          ? i18n._({
                              id: 'Sending message…',
                              message: 'Sending message…',
                            })
                          : i18n._({
                              id: 'Generating reply…',
                              message: 'Generating reply…',
                            })}
                      </strong>
                      <span>
                        {activePendingTurnPhase === 'sending'
                          ? i18n._({
                              id: 'Your message is staged and the thread is preparing a response.',
                              message: 'Your message is staged and the thread is preparing a response.',
                            })
                          : isThreadPinnedToLatest
                            ? i18n._({
                                id: 'Auto-follow is keeping the newest output in view.',
                                message: 'Auto-follow is keeping the newest output in view.',
                              })
                            : i18n._({
                                id: 'New output is arriving. Jump to latest to keep following it.',
                                message: 'New output is arriving. Jump to latest to keep following it.',
                              })}
                      </span>
                    </div>
                  </div>
                ) : null}
                <div aria-hidden="true" className="workbench-log__bottom-anchor" />
              </div>
            ) : (
              <div className="empty-state workbench-log__empty">
                {i18n._({
                  id: 'Send the first message to start this thread.',
                  message: 'Send the first message to start this thread.',
                })}
              </div>
            )
          ) : (
            <div className="empty-state workbench-log__empty">
              <div className="form-stack">
                <p>
                  {showThreadsLoadingState
                    ? i18n._({
                        id: 'Loading workspace threads…',
                        message: 'Loading workspace threads…',
                      })
                    : showCreateThreadEmptyState
                      ? i18n._({
                          id: 'Workspace {name} does not have any threads yet.',
                          message: 'Workspace {name} does not have any threads yet.',
                          values: {
                            name:
                              workspaceName ??
                              i18n._({
                                id: 'this workspace',
                                message: 'this workspace',
                              }),
                          },
                        })
                      : i18n._({
                          id: 'Select a thread from the left sidebar to start working in this workspace.',
                          message: 'Select a thread from the left sidebar to start working in this workspace.',
                        })}
                </p>
                {showCreateThreadEmptyState ? (
                  <>
                    {createThreadErrorMessage ? (
                      <InlineNotice
                        dismissible
                        noticeKey={`create-first-thread-${createThreadErrorMessage}`}
                        onRetry={onCreateThread}
                        title={i18n._({
                          id: 'Failed To Create Thread',
                          message: 'Failed To Create Thread',
                        })}
                        tone="error"
                      >
                        {createThreadErrorMessage}
                      </InlineNotice>
                    ) : null}
                    <button
                      className="ide-button ide-button--primary ide-button--lg workbench-log__empty-action"
                      disabled={isCreateThreadPending}
                      onClick={onCreateThread}
                      type="button"
                    >
                      {isCreateThreadPending
                        ? i18n._({
                            id: 'Creating thread…',
                            message: 'Creating thread…',
                          })
                        : i18n._({
                            id: 'Create First Thread',
                            message: 'Create First Thread',
                          })}
                    </button>
                  </>
                ) : null}
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
                aria-label={i18n._({
                  id: 'Resize surface panel',
                  message: 'Resize surface panel',
                })}
                className="workbench-log__panel-resize"
                onPointerDown={onSurfacePanelResizeStart}
                type="button"
              />
            ) : null}
            <div className="workbench-log__panel-header">
              <div>
                <h2>
                  {surfacePanelView === 'feed'
                    ? i18n._({
                        id: 'Live feed',
                        message: 'Live feed',
                      })
                    : i18n._({
                        id: 'Approvals',
                        message: 'Approvals',
                      })}
                </h2>
                <p>
                  {surfacePanelView === 'feed'
                    ? i18n._({
                        id: 'Inspect recent live activity without opening the full side rail.',
                        message: 'Inspect recent live activity without opening the full side rail.',
                      })
                    : i18n._({
                        id: 'Review pending approvals as a smaller in-surface panel.',
                        message: 'Review pending approvals as a smaller in-surface panel.',
                      })}
                </p>
              </div>
              <div className="workbench-log__panel-actions">
                {!isMobileViewport ? (
                  <button
                    className="pane-section__toggle"
                    onClick={onToggleSurfacePanelSide}
                    type="button"
                  >
                    {activeSurfacePanelSide === 'right'
                      ? i18n._({
                          id: 'Dock left',
                          message: 'Dock left',
                        })
                      : i18n._({
                          id: 'Dock right',
                          message: 'Dock right',
                        })}
                  </button>
                ) : null}
                <button
                  className="pane-section__toggle"
                  onClick={onCloseWorkbenchOverlay}
                  type="button"
                >
                  {i18n._({
                    id: 'Close',
                    message: 'Close',
                  })}
                </button>
              </div>
            </div>
            <div className="workbench-log__panel-body">
              {surfacePanelView === 'feed' ? (
                liveTimelineEntries.length ? (
                  <LiveFeed entries={liveTimelineEntries} />
                ) : (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No live feed entries yet.',
                      message: 'No live feed entries yet.',
                    })}
                  </div>
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
                <div className="empty-state">
                  {i18n._({
                    id: 'No pending approvals in this workspace.',
                    message: 'No pending approvals in this workspace.',
                  })}
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>
      {!showCreateThreadEmptyState ? children : null}
    </div>
  )
}
