import { useEffect, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'

import { InlineNotice } from '../../components/ui/InlineNotice'
import { LoadingState } from '../../components/ui/LoadingState'
import { RailIconButton } from '../../components/ui/RailControls'
import { ApprovalStack, LiveFeed, PlanStatusStack, TurnTimeline } from '../../components/workspace/renderers'
import {
  ConversationRenderProfilerBoundary,
  ConversationRenderProfilerPanel,
} from '../../components/workspace/threadConversationProfiler'
import type { LiveTimelineEntry } from '../../components/workspace/timelineUtilsTypes'
import { i18n } from '../../i18n/runtime'
import type { SurfacePanelSide, SurfacePanelView } from '../../lib/layout-config-types'
import type { PendingApproval, Thread, ThreadTurn } from '../../types/api'
import { RuntimeRecoveryActionGroup } from '../../features/workspaces/RuntimeRecoveryActionGroup'
import type { WorkspaceRuntimeRecoverySummary } from '../../features/workspaces/runtimeRecovery'
import { RuntimeRecoveryNoticeContent } from '../../features/workspaces/RuntimeRecoveryNoticeContent'
import type { ThreadPageRespondApprovalInput } from './threadPageActionTypes'
import type { ThreadPageRuntimeRecoveryExecutionNotice } from './threadPageRecoveryExecution'
import { threadTimelineLiveWindowUnfrozen } from './threadRenderingFeatureFlags'
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
  hasRecoverableRuntimeOperation?: boolean
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
  onRetryRuntimeOperation?: () => void
  onRestartAndRetry?: () => void
  onRestartRuntime?: () => void
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
  runtimeRecoveryNotice?: WorkspaceRuntimeRecoverySummary | null
  restartAndRetryPending?: boolean
  restartRuntimePending?: boolean
  runtimeRecoveryExecutionNotice?: ThreadPageRuntimeRecoveryExecutionNotice | null
  threadRuntimeNotice?: ThreadRuntimeNotice
  threadViewportRef: RefObject<HTMLDivElement | null>
  workspaceName?: string
}

const OLDER_TURNS_AUTOLOAD_THRESHOLD_PX = 72
const OLDER_TURNS_AUTOLOAD_IDLE_DELAY_MS = 0

function SurfacePanelDockLeftIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="17" x="3.5" y="4.5" />
      <path d="M8.5 5v14" stroke="currentColor" strokeWidth="1.7" />
      <path d="m14.5 8.5-3.5 3.5 3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function SurfacePanelDockRightIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <rect height="15" rx="2.5" stroke="currentColor" strokeWidth="1.7" width="17" x="3.5" y="4.5" />
      <path d="M15.5 5v14" stroke="currentColor" strokeWidth="1.7" />
      <path d="m9.5 8.5 3.5 3.5-3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </svg>
  )
}

function SurfacePanelCloseIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  )
}

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

  if (!threadTimelineLiveWindowUnfrozen) {
    return (
      isThreadProcessing ||
      activePendingTurnPhase === 'sending' ||
      activePendingTurnPhase === 'waiting'
    )
  }

  return false
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
  hasRecoverableRuntimeOperation,
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
  onRetryRuntimeOperation,
  onRestartAndRetry,
  onRestartRuntime,
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
  runtimeRecoveryNotice,
  restartAndRetryPending,
  restartRuntimePending,
  runtimeRecoveryExecutionNotice,
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
  const surfacePanelTitle =
    surfacePanelView === 'feed'
      ? i18n._({
          id: 'Live feed',
          message: 'Live feed',
        })
      : surfacePanelView === 'plans'
        ? i18n._({
            id: 'Plans',
            message: 'Plans',
          })
        : i18n._({
            id: 'Approvals',
            message: 'Approvals',
          })
  const surfacePanelDescription =
    surfacePanelView === 'feed'
      ? null
      : surfacePanelView === 'plans'
        ? null
        : i18n._({
            id: 'Review pending approvals as a smaller in-surface panel.',
            message: 'Review pending approvals as a smaller in-surface panel.',
          })
  const isPlansSurfacePanel = surfacePanelView === 'plans'
  const surfacePanelClassName = isMobileViewport
    ? isPlansSurfacePanel
      ? 'workbench-log__panel workbench-log__panel--mobile workbench-log__panel--plans'
      : 'workbench-log__panel workbench-log__panel--mobile'
    : isSurfacePanelResizing
      ? isPlansSurfacePanel
        ? `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide} workbench-log__panel--resizing workbench-log__panel--plans`
        : `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide} workbench-log__panel--resizing`
      : isPlansSurfacePanel
        ? `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide} workbench-log__panel--plans`
        : `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide}`
  const surfacePanelBodyClassName = isPlansSurfacePanel
    ? 'workbench-log__panel-body workbench-log__panel-body--plans'
    : 'workbench-log__panel-body'
  const surfacePanelHeaderClassName = isPlansSurfacePanel
    ? 'workbench-log__panel-header workbench-log__panel-header--plans'
    : 'workbench-log__panel-header'
  const surfacePanelActionsClassName = isPlansSurfacePanel
    ? 'workbench-log__panel-actions workbench-log__panel-actions--plans'
    : 'workbench-log__panel-actions'

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
                  {runtimeRecoveryNotice ? (
                    <InlineNotice
                      action={RuntimeRecoveryActionGroup({
                        configSettingsPath: '/settings/config',
                        environmentSettingsPath: '/settings/environment',
                        onRetry: hasRecoverableRuntimeOperation
                          ? onRetryRuntimeOperation
                          : undefined,
                        onRestartAndRetry: hasRecoverableRuntimeOperation
                          ? onRestartAndRetry
                          : undefined,
                        onRestartRuntime,
                        restartAndRetryPending,
                        restartRuntimePending,
                        summary: runtimeRecoveryNotice,
                      })}
                      details={runtimeRecoveryNotice.details}
                      dismissible
                      noticeKey={`thread-runtime-recovery-${timelineIdentity}-${runtimeRecoveryNotice.categoryLabel}-${runtimeRecoveryNotice.recoveryActionLabel}`}
                      title={runtimeRecoveryNotice.title}
                      tone={runtimeRecoveryNotice.tone}
                    >
                      <RuntimeRecoveryNoticeContent summary={runtimeRecoveryNotice} />
                    </InlineNotice>
                  ) : null}
                  {runtimeRecoveryExecutionNotice ? (
                    <InlineNotice
                      details={runtimeRecoveryExecutionNotice.details}
                      dismissible
                      noticeKey={runtimeRecoveryExecutionNotice.noticeKey}
                      title={runtimeRecoveryExecutionNotice.title}
                      tone={runtimeRecoveryExecutionNotice.tone}
                    >
                      {runtimeRecoveryExecutionNotice.summary}
                    </InlineNotice>
                  ) : null}
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
                    disableCompletedMessageAnimation
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
          <section className={surfacePanelClassName}>
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
            <div className={surfacePanelHeaderClassName}>
              <div>
                <h2>{surfacePanelTitle}</h2>
                {surfacePanelDescription ? <p>{surfacePanelDescription}</p> : null}
              </div>
              <div className={surfacePanelActionsClassName}>
                {!isMobileViewport ? (
                  <RailIconButton
                    aria-label={
                      activeSurfacePanelSide === 'right'
                        ? i18n._({
                            id: 'Dock left',
                            message: 'Dock left',
                          })
                        : i18n._({
                            id: 'Dock right',
                            message: 'Dock right',
                          })
                    }
                    className="workbench-log__panel-action-button"
                    onClick={onToggleSurfacePanelSide}
                    title={
                      activeSurfacePanelSide === 'right'
                        ? i18n._({
                            id: 'Dock left',
                            message: 'Dock left',
                          })
                        : i18n._({
                            id: 'Dock right',
                            message: 'Dock right',
                          })
                    }
                  >
                    {activeSurfacePanelSide === 'right' ? (
                      <SurfacePanelDockLeftIcon />
                    ) : (
                      <SurfacePanelDockRightIcon />
                    )}
                  </RailIconButton>
                ) : null}
                <RailIconButton
                  aria-label={i18n._({
                    id: 'Close',
                    message: 'Close',
                  })}
                  className="workbench-log__panel-action-button"
                  onClick={onCloseWorkbenchOverlay}
                  title={i18n._({
                    id: 'Close',
                    message: 'Close',
                  })}
                >
                  <SurfacePanelCloseIcon />
                </RailIconButton>
              </div>
            </div>
            <div className={surfacePanelBodyClassName}>
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
              ) : surfacePanelView === 'plans' ? (
                <PlanStatusStack turns={displayedTurns} />
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
