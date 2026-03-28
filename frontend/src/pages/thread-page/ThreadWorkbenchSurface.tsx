import { useEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'

import { InlineNotice } from '../../components/ui/InlineNotice'
import { LoadingState } from '../../components/ui/LoadingState'
import { ApprovalStack, LiveFeed, TurnTimeline } from '../../components/workspace/renderers'
import {
  ConversationRenderProfilerBoundary,
  ConversationRenderProfilerPanel,
} from '../../components/workspace/threadConversationProfiler'
import type { LiveTimelineEntry } from '../../components/workspace/timelineUtilsTypes'
import { i18n } from '../../i18n/runtime'
import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config-types'
import type { PendingApproval, Thread, ThreadTurn } from '../../types/api'
import type { ThreadPageRespondApprovalInput } from './threadPageActionTypes'
import type { ThreadViewportScrollInput } from './threadViewportTypes'

export type ThreadRuntimeNotice = {
  title: string
  message: string
  summary: string
  noticeKey: string
}

export type ThreadWorkbenchSurfaceProps = {
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
  isThreadViewportInteracting: boolean
  isWaitingForThreadData: boolean
  liveTimelineEntries: LiveTimelineEntry[]
  onChangeApprovalAnswer: (requestId: string, questionId: string, value: string) => void
  onCloseWorkbenchOverlay: () => void
  onCaptureOlderTurnsAnchor: (restoreMode?: 'preserve-position' | 'reveal-older') => void
  onCreateThread: () => void
  onLoadOlderTurns: () => void
  onReleaseFullTurn: (turnId: string, itemId?: string) => void
  onRetainFullTurn: (turnId: string, itemId?: string) => void
  onRequestFullTurn: (turnId: string, itemId?: string) => void
  onRespondApproval: (input: ThreadPageRespondApprovalInput) => void
  onRetryServerRequest: (item: Record<string, unknown>) => void
  onRetryThreadLoad: () => void
  onRestoreOlderTurnsViewport: () => void
  onSurfacePanelResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onThreadViewportScroll: (input?: ThreadViewportScrollInput) => void
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
}

const OLDER_TURNS_AUTOLOAD_THRESHOLD_PX = 72
const OLDER_TURNS_AUTOLOAD_IDLE_DELAY_MS = 0

export function shouldScheduleOlderTurnsAutoload({
  hasMoreTurnsBefore,
  isLoadingOlderTurns,
  scrollTop,
  thresholdPx = OLDER_TURNS_AUTOLOAD_THRESHOLD_PX,
}: {
  hasMoreTurnsBefore: boolean
  isLoadingOlderTurns: boolean
  scrollTop: number | null
  thresholdPx?: number
}) {
  return (
    hasMoreTurnsBefore &&
    !isLoadingOlderTurns &&
    typeof scrollTop === 'number' &&
    scrollTop <= thresholdPx
  )
}

export function triggerOlderTurnsLoadWithAnchor({
  onCaptureOlderTurnsAnchor,
  onLoadOlderTurns,
}: Pick<ThreadWorkbenchSurfaceProps, 'onCaptureOlderTurnsAnchor' | 'onLoadOlderTurns'>) {
  onCaptureOlderTurnsAnchor('preserve-position')
  onLoadOlderTurns()
}

export function shouldFreezeThreadTimelineVirtualization({
  activePendingTurnPhase,
  isThreadPinnedToLatest,
  isThreadProcessing,
  isThreadViewportInteracting,
}: Pick<
  ThreadWorkbenchSurfaceProps,
  | 'activePendingTurnPhase'
  | 'isThreadPinnedToLatest'
  | 'isThreadProcessing'
  | 'isThreadViewportInteracting'
>) {
  if (!isThreadPinnedToLatest || isThreadViewportInteracting) {
    return true
  }

  return (
    isThreadProcessing ||
    activePendingTurnPhase === 'sending' ||
    activePendingTurnPhase === 'waiting'
  )
}

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
  isThreadViewportInteracting,
  isWaitingForThreadData: _isWaitingForThreadData,
  liveTimelineEntries,
  onChangeApprovalAnswer,
  onCloseWorkbenchOverlay,
  onCaptureOlderTurnsAnchor,
  onCreateThread,
  onLoadOlderTurns,
  onReleaseFullTurn,
  onRetainFullTurn,
  onRequestFullTurn,
  onRespondApproval,
  onRetryServerRequest,
  onRetryThreadLoad,
  onRestoreOlderTurnsViewport,
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
}: ThreadWorkbenchSurfaceProps) {
  const previousOlderTurnsLoadingRef = useRef(isLoadingOlderTurns)
  const pendingOlderTurnsAutoloadRef = useRef(false)

  useEffect(() => {
    const wasLoadingOlderTurns = previousOlderTurnsLoadingRef.current
    previousOlderTurnsLoadingRef.current = isLoadingOlderTurns

    if (!wasLoadingOlderTurns || isLoadingOlderTurns) {
      return
    }

    onRestoreOlderTurnsViewport()
  }, [isLoadingOlderTurns, onRestoreOlderTurnsViewport])

  useEffect(() => {
    if (
      !pendingOlderTurnsAutoloadRef.current ||
      isLoadingOlderTurns ||
      isThreadViewportInteracting
    ) {
      return
    }

    const viewport = threadViewportRef.current
    if (
      !shouldScheduleOlderTurnsAutoload({
        hasMoreTurnsBefore,
        isLoadingOlderTurns,
        scrollTop: viewport?.scrollTop ?? null,
      })
    ) {
      pendingOlderTurnsAutoloadRef.current = false
      return
    }

    const timeoutId = window.setTimeout(() => {
      const latestViewport = threadViewportRef.current
      if (
        !pendingOlderTurnsAutoloadRef.current ||
        !latestViewport ||
        !shouldScheduleOlderTurnsAutoload({
          hasMoreTurnsBefore,
          isLoadingOlderTurns,
          scrollTop: latestViewport.scrollTop,
        })
      ) {
        pendingOlderTurnsAutoloadRef.current = false
        return
      }

      pendingOlderTurnsAutoloadRef.current = false
      triggerOlderTurnsLoadWithAnchor({
        onCaptureOlderTurnsAnchor,
        onLoadOlderTurns,
      })
    }, OLDER_TURNS_AUTOLOAD_IDLE_DELAY_MS)

    return () => window.clearTimeout(timeoutId)
  }, [
    hasMoreTurnsBefore,
    isLoadingOlderTurns,
    onCaptureOlderTurnsAnchor,
    isThreadViewportInteracting,
    onLoadOlderTurns,
    threadViewportRef,
  ])

  function handleViewportScroll() {
    const viewport = threadViewportRef.current
    pendingOlderTurnsAutoloadRef.current = shouldScheduleOlderTurnsAutoload({
      hasMoreTurnsBefore,
      isLoadingOlderTurns,
      scrollTop: viewport?.scrollTop ?? null,
    })

    onThreadViewportScroll({
      isLoadingOlderTurns,
    })
  }

  const showCreateThreadEmptyState =
    !selectedThread && !isThreadSelectionLoading && isThreadsLoaded && !hasThreads
  const showThreadsLoadingState =
    isThreadSelectionLoading || (!selectedThread && !isThreadsLoaded)
  const freezeThreadTimelineVirtualization = shouldFreezeThreadTimelineVirtualization({
    activePendingTurnPhase,
    isThreadPinnedToLatest,
    isThreadProcessing,
    isThreadViewportInteracting,
  })

  return (
    <div className="workbench-stage__canvas">
      <div className="workbench-log" style={threadLogStyle}>
        <ConversationRenderProfilerBoundary id="ThreadWorkbenchSurface">
          <div
            aria-busy={isThreadProcessing}
            className={
              isThreadPinnedToLatest
                ? 'workbench-log__viewport workbench-log__viewport--follow'
                : 'workbench-log__viewport workbench-log__viewport--detached'
            }
            onScroll={handleViewportScroll}
            ref={threadViewportRef}
          >
            {selectedThread ? (
              threadDetailIsLoading && !displayedTurns.length ? (
                <div className="workbench-log__loading">
                  <LoadingState
                    fill={false}
                    message={i18n._({
                      id: 'Loading thread surface…',
                      message: 'Loading thread surface…',
                    })}
                  />
                </div>
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
                        onClick={() => {
                          triggerOlderTurnsLoadWithAnchor({
                            onCaptureOlderTurnsAnchor,
                            onLoadOlderTurns,
                          })
                        }}
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
                    freezeVirtualization={freezeThreadTimelineVirtualization}
                    onReleaseFullTurn={onReleaseFullTurn}
                    onRetainFullTurn={onRetainFullTurn}
                    onRequestFullTurn={onRequestFullTurn}
                    onRetryServerRequest={onRetryServerRequest}
                    scrollViewportRef={threadViewportRef}
                    timelineIdentity={timelineIdentity}
                    turns={displayedTurns}
                  />
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
        </ConversationRenderProfilerBoundary>
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
        {selectedThread ? <ConversationRenderProfilerPanel /> : null}
      </div>
      {!showCreateThreadEmptyState ? children : null}
    </div>
  )
}
