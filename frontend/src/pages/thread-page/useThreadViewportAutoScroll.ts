import { useEffect, useRef, useState } from 'react'

import { recordConversationScrollDiagnosticEvent } from '../../components/workspace/threadConversationProfiler'
import { frontendDebugLog } from '../../lib/frontend-runtime-mode'
import {
  createThreadViewportCoordinatorState,
  reduceThreadViewportContentChange,
  reduceThreadViewportDetach,
  reduceThreadViewportJumpToLatest,
  reduceThreadViewportOlderTurnsAnchor,
  reduceThreadViewportPinnedState,
  reduceThreadViewportRestoreOlderTurns,
  reduceThreadViewportSelection,
  reduceThreadViewportThreadOpenSettleComplete,
} from './threadViewportCoordinator'
import {
  computeThreadPinnedToLatest,
  resolveOlderTurnsRestoreTarget,
  resolveThreadViewportAutoScrollChange,
  resolveThreadViewportContentFollowThrottleState,
  resolveThreadViewportUserScrollIntent,
  resolveThreadViewportScrollExecution,
  resolveThreadViewportPinnedState,
  resolveThreadViewportScrollDeferState,
  shouldCorrectThreadViewportFollowTail,
  shouldCoalesceThreadViewportScheduledFrame,
  type ThreadViewportProgrammaticScrollPolicy,
} from './threadViewportAutoScrollUtils'
import type { ThreadContentSignature } from './threadContentSignature'
import type {
  ThreadViewportAutoScrollInput,
  ThreadViewportScrollInput,
} from './threadViewportTypes'
import type { ThreadViewportScrollTask } from './threadViewportAutoScrollTypes'
import type {
  ThreadViewportCoordinatorCommand,
  ThreadViewportCoordinatorResult,
  ThreadViewportCoordinatorState,
} from './threadViewportCoordinatorTypes'

const THREAD_VIEWPORT_INTERACTION_LOCK_MS = 220
const THREAD_OPEN_SETTLE_MAX_MS = 600
const THREAD_OPEN_SETTLE_STABLE_FRAME_COUNT = 2
type ThreadViewportUserIntentSource =
  | 'pointer-gesture-scroll'
  | 'touch-down'
  | 'touch-up'
  | 'wheel-down'
  | 'wheel-up'

export function useThreadViewportAutoScroll({
  displayedTurnsLength,
  selectedThreadId,
  threadBottomClearancePx,
  threadContentSignature,
  threadUnreadUpdateKey,
  threadDetailIsLoading,
}: ThreadViewportAutoScrollInput) {
  const [hasUnreadThreadUpdates, setHasUnreadThreadUpdates] = useState(false)
  const [isThreadPinnedToLatest, setIsThreadPinnedToLatest] = useState(true)
  const [isThreadViewportInteracting, setIsThreadViewportInteracting] = useState(false)

  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const coordinatorStateRef = useRef<ThreadViewportCoordinatorState>(
    createThreadViewportCoordinatorState(selectedThreadId),
  )
  const isThreadViewportInteractingRef = useRef(false)
  const threadContentSignatureRef = useRef<ThreadContentSignature | null>(null)
  const threadUnreadUpdateKeyRef = useRef('')
  const pendingAutoScrollFrameRef = useRef<number | null>(null)
  const pendingAutoScrollTaskRef = useRef<ThreadViewportScrollTask | null>(null)
  const pendingAutoScrollAfterRef = useRef<(() => void) | null>(null)
  const pendingViewportSyncFrameRef = useRef<number | null>(null)
  const pendingContentResizeFrameRef = useRef<number | null>(null)
  const pendingThreadOpenSettleFrameRef = useRef<number | null>(null)
  const pendingFollowTailCorrectionFrameRef = useRef<number | null>(null)
  const pendingStreamingFollowFrameRef = useRef<number | null>(null)
  const pendingFollowScrollTaskRef = useRef<ThreadViewportScrollTask | null>(null)
  const pendingFollowScrollTimeoutRef = useRef<number | null>(null)
  const pendingOlderTurnsAnchorSyncRef = useRef(false)
  const programmaticScrollUntilRef = useRef(0)
  const programmaticScrollPolicyRef = useRef<ThreadViewportProgrammaticScrollPolicy | null>(null)
  const lastAutoFollowScrollAtRef = useRef(0)
  const lastObservedThreadScrollHeightRef = useRef<number | null>(null)
  const lastViewportScrollTopRef = useRef(0)
  const lastViewportClientHeightRef = useRef<number | null>(null)
  const pointerGestureActiveRef = useRef(false)
  const touchStartYRef = useRef<number | null>(null)
  const userScrollLockUntilRef = useRef(0)
  const viewportInteractionTimeoutRef = useRef<number | null>(null)

  function logThreadViewport(message: string, details?: unknown) {
    frontendDebugLog('thread-viewport', message, {
      selectedThreadId: selectedThreadId ?? null,
      ...(typeof details === 'object' && details !== null ? details : { details }),
    })
  }

  function getCoordinatorState() {
    return coordinatorStateRef.current
  }

  function setCoordinatorState(nextState: ThreadViewportCoordinatorState) {
    coordinatorStateRef.current = nextState
    setHasUnreadThreadUpdates(nextState.hasUnreadThreadUpdates)
    setIsThreadPinnedToLatest(nextState.isPinnedToLatest)
  }

  function buildThreadViewportScrollTaskFromCommand(
    command: ThreadViewportCoordinatorCommand,
  ): ThreadViewportScrollTask {
    if (command.kind === 'restore-anchor') {
      return {
        behavior: command.behavior,
        policy: command.policy,
        resolveTargetTop: (viewport) =>
          resolveOlderTurnsRestoreTarget({
            anchorScrollHeight: command.anchor.scrollHeight,
            anchorScrollTop: command.anchor.scrollTop,
            currentScrollHeight: viewport.scrollHeight,
          }),
        source: command.source,
      }
    }

    return {
      behavior: command.behavior,
      policy: command.policy,
      resolveTargetTop: (viewport) => viewport.scrollHeight,
      source: command.source,
    }
  }

  function applyCoordinatorResult(
    result: ThreadViewportCoordinatorResult,
    onAfterScroll?: () => void,
  ) {
    setCoordinatorState(result.state)
    if (!result.command) {
      return
    }

    requestThreadViewportScroll(
      buildThreadViewportScrollTaskFromCommand(result.command),
      onAfterScroll,
    )
  }

  function hasActiveViewportProgrammaticScroll() {
    return (
      pendingAutoScrollFrameRef.current !== null ||
      pendingThreadOpenSettleFrameRef.current !== null ||
      pendingFollowScrollTaskRef.current?.policy === 'follow-latest' ||
      (
        Date.now() < programmaticScrollUntilRef.current &&
        programmaticScrollPolicyRef.current === 'follow-latest'
      )
    )
  }

  function cancelPendingFollowScrollTimeout() {
    if (pendingFollowScrollTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(pendingFollowScrollTimeoutRef.current)
    pendingFollowScrollTimeoutRef.current = null
  }

  function clearPendingAutoScrollTask() {
    pendingAutoScrollTaskRef.current = null
    pendingAutoScrollAfterRef.current = null
  }

  function mergePendingAutoScrollCallback(nextCallback?: () => void) {
    if (!nextCallback) {
      return
    }

    const currentCallback = pendingAutoScrollAfterRef.current
    pendingAutoScrollAfterRef.current = currentCallback
      ? () => {
          currentCallback()
          nextCallback()
        }
      : nextCallback
  }

  function clearPendingFollowScrollTask(
    policy?: ThreadViewportProgrammaticScrollPolicy,
  ) {
    if (
      policy &&
      pendingFollowScrollTaskRef.current &&
      pendingFollowScrollTaskRef.current.policy !== policy
    ) {
      return
    }

    pendingFollowScrollTaskRef.current = null
    cancelPendingFollowScrollTimeout()
  }

  function executeThreadViewportScrollTask({
    behavior,
    metadata,
    policy: taskPolicy,
    resolveTargetTop,
    source,
  }: ThreadViewportScrollTask) {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    const requestedTargetTop = resolveTargetTop(viewport)
    if (requestedTargetTop === null) {
      logThreadViewport('scroll task skipped because target resolved to null', {
        policy: taskPolicy,
        source,
      })
      return
    }

    const { nextTargetTop, shouldScroll } = resolveThreadViewportScrollExecution({
      clientHeight: viewport.clientHeight,
      currentScrollTop: viewport.scrollTop,
      requestedTargetTop,
      scrollHeight: viewport.scrollHeight,
    })
    if (!shouldScroll) {
      logThreadViewport('scroll task skipped because viewport is already at target', {
        clientHeight: viewport.clientHeight,
        currentScrollTop: viewport.scrollTop,
        policy: taskPolicy,
        requestedTargetTop,
        resolvedTargetTop: nextTargetTop,
        scrollHeight: viewport.scrollHeight,
        source,
      })
      return
    }

    logThreadViewport('executing programmatic viewport scroll', {
      behavior,
      clientHeight: viewport.clientHeight,
      currentScrollTop: viewport.scrollTop,
      policy: taskPolicy,
      requestedTargetTop,
      resolvedTargetTop: nextTargetTop,
      scrollHeight: viewport.scrollHeight,
      source,
    })

    recordConversationScrollDiagnosticEvent({
      behavior,
      clientHeight: viewport.clientHeight,
      kind: 'programmatic-scroll',
      metadata,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
      source,
      targetTop: nextTargetTop,
    })
    viewport.scrollTo({
      top: nextTargetTop,
      behavior,
    })
    if (taskPolicy === 'follow-latest' && behavior === 'auto') {
      lastAutoFollowScrollAtRef.current = Date.now()
    }
    programmaticScrollUntilRef.current = Date.now() + THREAD_VIEWPORT_INTERACTION_LOCK_MS
    programmaticScrollPolicyRef.current = taskPolicy

    if (behavior === 'auto') {
      lastViewportScrollTopRef.current = nextTargetTop
    }

    if (taskPolicy === 'follow-latest' && behavior === 'auto') {
      scheduleThreadViewportFollowTailCorrection()
    }
  }

  function cancelPendingAutoScrollFrame() {
    if (pendingAutoScrollFrameRef.current === null) {
      clearPendingAutoScrollTask()
      return
    }

    window.cancelAnimationFrame(pendingAutoScrollFrameRef.current)
    pendingAutoScrollFrameRef.current = null
    clearPendingAutoScrollTask()
  }

  function scheduleThreadViewportScrollTask(
    task: ThreadViewportScrollTask,
    onAfterScroll?: () => void,
  ) {
    const shouldCoalesceScheduledFrame = shouldCoalesceThreadViewportScheduledFrame({
      nextTaskBehavior: task.behavior,
      nextTaskPolicy: task.policy,
      pendingTaskBehavior: pendingAutoScrollTaskRef.current?.behavior ?? null,
      pendingTaskPolicy: pendingAutoScrollTaskRef.current?.policy ?? null,
    })

    if (
      pendingAutoScrollFrameRef.current !== null &&
      !shouldCoalesceScheduledFrame
    ) {
      window.cancelAnimationFrame(pendingAutoScrollFrameRef.current)
      pendingAutoScrollFrameRef.current = null
      clearPendingAutoScrollTask()
    }

    pendingAutoScrollTaskRef.current = task
    mergePendingAutoScrollCallback(onAfterScroll)

    if (pendingAutoScrollFrameRef.current !== null) {
      return
    }

    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null
      const pendingTask = pendingAutoScrollTaskRef.current
      const pendingAfterScroll = pendingAutoScrollAfterRef.current
      clearPendingAutoScrollTask()
      if (pendingTask) {
        executeThreadViewportScrollTask(pendingTask)
      }
      pendingAfterScroll?.()
    })
  }

  function flushPendingFollowScrollTask() {
    const pendingTask = pendingFollowScrollTaskRef.current
    if (!pendingTask) {
      cancelPendingFollowScrollTimeout()
      return
    }

    const nowMs = Date.now()
    const deferState = resolveThreadViewportScrollDeferState({
      isThreadViewportInteracting: isThreadViewportInteractingRef.current,
      nowMs,
      policy: pendingTask.policy,
      userScrollLockUntilMs: userScrollLockUntilRef.current,
    })
    if (deferState.shouldDefer) {
      cancelPendingFollowScrollTimeout()
      pendingFollowScrollTimeoutRef.current = window.setTimeout(
        flushPendingFollowScrollTask,
        deferState.delayMs,
      )
      return
    }

    const throttleState = resolveThreadViewportContentFollowThrottleState({
      lastAutoFollowScrollAtMs: lastAutoFollowScrollAtRef.current,
      nowMs,
      policy: pendingTask.policy,
      source: pendingTask.source,
    })
    if (throttleState.shouldDefer) {
      cancelPendingFollowScrollTimeout()
      pendingFollowScrollTimeoutRef.current = window.setTimeout(
        flushPendingFollowScrollTask,
        throttleState.delayMs,
      )
      return
    }

    pendingFollowScrollTaskRef.current = null
    cancelPendingFollowScrollTimeout()
    scheduleThreadViewportScrollTask(pendingTask)
  }

  function requestThreadViewportScroll(
    task: ThreadViewportScrollTask,
    onAfterScroll?: () => void,
  ) {
    const nowMs = Date.now()
    const deferState = resolveThreadViewportScrollDeferState({
      isThreadViewportInteracting: isThreadViewportInteractingRef.current,
      nowMs,
      policy: task.policy,
      userScrollLockUntilMs: userScrollLockUntilRef.current,
    })

    if (deferState.shouldDefer) {
      logThreadViewport('deferring viewport scroll request', {
        delayMs: deferState.delayMs,
        interacting: isThreadViewportInteractingRef.current,
        policy: task.policy,
        source: task.source,
        userScrollLockRemainingMs: Math.max(
          0,
          userScrollLockUntilRef.current - nowMs,
        ),
      })
      pendingFollowScrollTaskRef.current = task
      cancelPendingFollowScrollTimeout()
      pendingFollowScrollTimeoutRef.current = window.setTimeout(
        flushPendingFollowScrollTask,
        deferState.delayMs,
      )
      return
    }

    const throttleState = resolveThreadViewportContentFollowThrottleState({
      lastAutoFollowScrollAtMs: lastAutoFollowScrollAtRef.current,
      nowMs,
      policy: task.policy,
      source: task.source,
    })
    if (throttleState.shouldDefer) {
      logThreadViewport('throttling viewport scroll request', {
        delayMs: throttleState.delayMs,
        policy: task.policy,
        source: task.source,
      })
      pendingFollowScrollTaskRef.current = task
      cancelPendingFollowScrollTimeout()
      pendingFollowScrollTimeoutRef.current = window.setTimeout(
        flushPendingFollowScrollTask,
        throttleState.delayMs,
      )
      return
    }

    clearPendingFollowScrollTask()
    logThreadViewport('scheduling viewport scroll request', {
      behavior: task.behavior,
      policy: task.policy,
      source: task.source,
    })
    scheduleThreadViewportScrollTask(task, onAfterScroll)
  }

  function cancelPendingViewportSyncFrame() {
    if (pendingViewportSyncFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingViewportSyncFrameRef.current)
    pendingViewportSyncFrameRef.current = null
  }

  function cancelPendingContentResizeFrame() {
    if (pendingContentResizeFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingContentResizeFrameRef.current)
    pendingContentResizeFrameRef.current = null
  }

  function cancelPendingFollowTailCorrectionFrame() {
    if (pendingFollowTailCorrectionFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingFollowTailCorrectionFrameRef.current)
    pendingFollowTailCorrectionFrameRef.current = null
  }

  function cancelPendingStreamingFollowFrame() {
    if (pendingStreamingFollowFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingStreamingFollowFrameRef.current)
    pendingStreamingFollowFrameRef.current = null
  }

  function cancelPendingThreadOpenSettleFrame() {
    if (pendingThreadOpenSettleFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingThreadOpenSettleFrameRef.current)
    pendingThreadOpenSettleFrameRef.current = null
  }

  function stopViewportAutoScrollAnimation() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    recordConversationScrollDiagnosticEvent({
      behavior: 'auto',
      clientHeight: viewport.clientHeight,
      kind: 'programmatic-scroll',
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
      source: 'stop-auto-scroll',
      targetTop: viewport.scrollTop,
    })
    viewport.scrollTo({
      top: viewport.scrollTop,
      behavior: 'auto',
    })
  }

  function scheduleThreadViewportFollowTailCorrection() {
    if (pendingFollowTailCorrectionFrameRef.current !== null) {
      return
    }

    pendingFollowTailCorrectionFrameRef.current = window.requestAnimationFrame(() => {
      pendingFollowTailCorrectionFrameRef.current = null
      const viewport = threadViewportRef.current
      if (
        !viewport ||
        !selectedThreadId ||
        !shouldCorrectThreadViewportFollowTail({
          clientHeight: viewport.clientHeight,
          currentScrollTop: viewport.scrollTop,
          isThreadViewportInteracting: isThreadViewportInteractingRef.current,
          scrollHeight: viewport.scrollHeight,
          shouldFollowThread: getCoordinatorState().followMode === 'follow',
          userScrollLockActive: Date.now() < userScrollLockUntilRef.current,
        })
      ) {
        return
      }

      logThreadViewport('requesting follow-tail correction', {
        clientHeight: viewport.clientHeight,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      })

      requestThreadViewportScroll({
        behavior: 'auto',
        policy: 'follow-latest',
        resolveTargetTop: (currentViewport) => currentViewport.scrollHeight,
        source: 'follow-tail-correction',
      })
    })
  }

  function markUserScrollIntent(
    releaseFollow = false,
    source: ThreadViewportUserIntentSource = 'pointer-gesture-scroll',
  ) {
    const viewport = threadViewportRef.current
    userScrollLockUntilRef.current = Date.now() + 600
    clearPendingFollowScrollTask('follow-latest')
    cancelPendingAutoScrollFrame()
    cancelPendingViewportSyncFrame()
    cancelPendingThreadOpenSettleFrame()
    cancelPendingFollowTailCorrectionFrame()

    if (hasActiveViewportProgrammaticScroll()) {
      stopViewportAutoScrollAnimation()
    }

    logThreadViewport(`applying user scroll intent (${source})`, {
      clientHeight: viewport?.clientHeight ?? null,
      releaseFollow,
      scrollHeight: viewport?.scrollHeight ?? null,
      scrollTop: viewport?.scrollTop ?? null,
      source,
    })

    recordConversationScrollDiagnosticEvent({
      clientHeight: viewport?.clientHeight,
      detail: releaseFollow ? 'detach-follow' : 'keep-follow-state',
      kind: 'user-intent',
      metadata: {
        inputSource: source,
      },
      scrollHeight: viewport?.scrollHeight,
      scrollTop: viewport?.scrollTop,
      source: 'mark-user-scroll-intent',
    })

    if (releaseFollow) {
      setCoordinatorState(reduceThreadViewportDetach(getCoordinatorState()))
    }
  }

  function markViewportInteraction() {
    if (!isThreadViewportInteractingRef.current) {
      isThreadViewportInteractingRef.current = true
      setIsThreadViewportInteracting(true)
    }

    if (viewportInteractionTimeoutRef.current !== null) {
      window.clearTimeout(viewportInteractionTimeoutRef.current)
    }

    viewportInteractionTimeoutRef.current = window.setTimeout(() => {
      viewportInteractionTimeoutRef.current = null
      isThreadViewportInteractingRef.current = false
      setIsThreadViewportInteracting(false)
    }, THREAD_VIEWPORT_INTERACTION_LOCK_MS)
  }

  function captureOlderTurnsAnchor(
    restoreMode: 'preserve-position' | 'reveal-older' = 'preserve-position',
  ) {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }
    setCoordinatorState(
      reduceThreadViewportOlderTurnsAnchor(getCoordinatorState(), {
        restoreMode,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      }),
    )

    recordConversationScrollDiagnosticEvent({
      clientHeight: viewport.clientHeight,
      kind: 'older-turn-anchor',
      metadata: {
        thresholdPx: 72,
      },
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
      source: 'capture-older-turn-anchor',
    })
  }

  function syncOlderTurnsAnchorWithViewport() {
    const viewport = threadViewportRef.current
    const anchor = getCoordinatorState().olderTurnsAnchor
    if (!viewport || !anchor) {
      return
    }

    setCoordinatorState(
      reduceThreadViewportOlderTurnsAnchor(getCoordinatorState(), {
        restoreMode: anchor.restoreMode,
        scrollHeight: viewport.scrollHeight,
        scrollTop: viewport.scrollTop,
      }),
    )
  }

  function restoreOlderTurnsViewport() {
    applyCoordinatorResult(
      reduceThreadViewportRestoreOlderTurns(getCoordinatorState()),
    )
  }

  function finalizeThreadOpenScroll(nextSelectedThreadId: string) {
    cancelPendingThreadOpenSettleFrame()
    const settleStartMs = performance.now()
    let lastScrollHeight = -1
    let stableFrameCount = 0

    const settleToBottom = () => {
      pendingThreadOpenSettleFrameRef.current = null
      if (getCoordinatorState().pendingThreadOpenThreadId !== nextSelectedThreadId) {
        return
      }

      const viewport = threadViewportRef.current
      if (!viewport) {
        setCoordinatorState(
          reduceThreadViewportThreadOpenSettleComplete(getCoordinatorState()),
        )
        return
      }

      const currentScrollHeight = viewport.scrollHeight
      executeThreadViewportScrollTask({
        behavior: 'auto',
        policy: 'follow-latest',
        resolveTargetTop: (currentViewport) => currentViewport.scrollHeight,
        source: 'thread-open-settle',
      })

      const pinnedToLatest = computeThreadPinnedToLatest(
        viewport.scrollTop,
        viewport.scrollHeight,
        viewport.clientHeight,
        true,
      )

      if (pinnedToLatest && currentScrollHeight === lastScrollHeight) {
        stableFrameCount += 1
      } else {
        stableFrameCount = 0
      }

      lastScrollHeight = currentScrollHeight

      const exceededSettleBudget = performance.now() - settleStartMs >= THREAD_OPEN_SETTLE_MAX_MS
      if (
        stableFrameCount >= THREAD_OPEN_SETTLE_STABLE_FRAME_COUNT ||
        exceededSettleBudget
      ) {
        setCoordinatorState(
          reduceThreadViewportThreadOpenSettleComplete(getCoordinatorState()),
        )
        return
      }

      pendingThreadOpenSettleFrameRef.current = window.requestAnimationFrame(settleToBottom)
    }

    pendingThreadOpenSettleFrameRef.current = window.requestAnimationFrame(settleToBottom)
  }

  useEffect(() => {
    clearPendingFollowScrollTask()
    cancelPendingAutoScrollFrame()
    cancelPendingViewportSyncFrame()
    cancelPendingContentResizeFrame()
    cancelPendingFollowTailCorrectionFrame()
    cancelPendingStreamingFollowFrame()
    lastViewportScrollTopRef.current = 0
    lastObservedThreadScrollHeightRef.current = null
    lastViewportClientHeightRef.current = null
    pointerGestureActiveRef.current = false
    touchStartYRef.current = null
    userScrollLockUntilRef.current = 0
    programmaticScrollUntilRef.current = 0
    programmaticScrollPolicyRef.current = null
    lastAutoFollowScrollAtRef.current = 0
    if (viewportInteractionTimeoutRef.current !== null) {
      window.clearTimeout(viewportInteractionTimeoutRef.current)
      viewportInteractionTimeoutRef.current = null
    }
    cancelPendingThreadOpenSettleFrame()
    threadContentSignatureRef.current = null
    threadUnreadUpdateKeyRef.current = ''
    pendingOlderTurnsAnchorSyncRef.current = false
    isThreadViewportInteractingRef.current = false
    setIsThreadViewportInteracting(false)

    applyCoordinatorResult(reduceThreadViewportSelection(selectedThreadId))

    return () => {
      cancelPendingAutoScrollFrame()
      cancelPendingFollowTailCorrectionFrame()
      cancelPendingStreamingFollowFrame()
    }
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId) {
      threadContentSignatureRef.current = null
      threadUnreadUpdateKeyRef.current = ''
      setCoordinatorState(createThreadViewportCoordinatorState())
      return
    }

    const coordinatorState = getCoordinatorState()
    const viewport = threadViewportRef.current
    const pinnedToLatest = viewport
      ? computeThreadPinnedToLatest(
          viewport.scrollTop,
          viewport.scrollHeight,
          viewport.clientHeight,
          coordinatorState.followMode === 'follow',
        )
      : true

    const userScrollLockActive = Date.now() < userScrollLockUntilRef.current
    const change = resolveThreadViewportAutoScrollChange({
      displayedTurnsLength,
      pendingThreadOpenThreadId: coordinatorState.pendingThreadOpenThreadId,
      pinnedToLatest,
      previousThreadContentSignature: threadContentSignatureRef.current,
      previousThreadUnreadKey: threadUnreadUpdateKeyRef.current,
      selectedThreadId,
      shouldFollowThread: coordinatorState.followMode === 'follow',
      threadContentSignature,
      threadDetailIsLoading,
      threadUnreadUpdateKey,
      userScrollLockActive,
    })

    if (!change.contentChanged && !change.unreadKeyChanged) {
      threadContentSignatureRef.current = threadContentSignature
      threadUnreadUpdateKeyRef.current = threadUnreadUpdateKey
      return
    }

    threadContentSignatureRef.current = threadContentSignature
    threadUnreadUpdateKeyRef.current = threadUnreadUpdateKey

    applyCoordinatorResult(
      reduceThreadViewportContentChange(coordinatorState, {
        shouldAutoScroll: change.shouldAutoScroll,
        shouldMarkUnread: change.shouldMarkUnread,
      }),
    )
  }, [
    displayedTurnsLength,
    selectedThreadId,
    threadContentSignature,
    threadUnreadUpdateKey,
    threadDetailIsLoading,
  ])

  useEffect(() => {
    if (!selectedThreadId || isThreadViewportInteracting) {
      return
    }

    flushPendingFollowScrollTask()
  }, [isThreadViewportInteracting, selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId || !threadContentSignature.pendingPhase) {
      cancelPendingStreamingFollowFrame()
      return
    }

    let isCancelled = false

    const maintainStreamingFollow = () => {
      pendingStreamingFollowFrameRef.current = null
      if (isCancelled) {
        return
      }

      const viewport = threadViewportRef.current
      if (
        viewport &&
        shouldCorrectThreadViewportFollowTail({
          clientHeight: viewport.clientHeight,
          currentScrollTop: viewport.scrollTop,
          isThreadViewportInteracting: isThreadViewportInteractingRef.current,
          scrollHeight: viewport.scrollHeight,
          shouldFollowThread: getCoordinatorState().followMode === 'follow',
          userScrollLockActive: Date.now() < userScrollLockUntilRef.current,
        })
      ) {
        logThreadViewport('requesting streaming follow maintenance', {
          clientHeight: viewport.clientHeight,
          pendingPhase: threadContentSignature.pendingPhase,
          scrollHeight: viewport.scrollHeight,
          scrollTop: viewport.scrollTop,
        })
        requestThreadViewportScroll({
          behavior: 'auto',
          policy: 'follow-latest',
          resolveTargetTop: (currentViewport) => currentViewport.scrollHeight,
          source: 'stream-follow-maintenance',
        })
      }

      if (isCancelled) {
        return
      }

      pendingStreamingFollowFrameRef.current = window.requestAnimationFrame(
        maintainStreamingFollow,
      )
    }

    pendingStreamingFollowFrameRef.current = window.requestAnimationFrame(
      maintainStreamingFollow,
    )

    return () => {
      isCancelled = true
      cancelPendingStreamingFollowFrame()
    }
  }, [
    selectedThreadId,
    threadContentSignature.pendingPhase,
    threadContentSignature.pendingTurnId,
  ])

  useEffect(() => {
    if (
      !selectedThreadId ||
      getCoordinatorState().pendingThreadOpenThreadId !== selectedThreadId ||
      threadDetailIsLoading ||
      displayedTurnsLength === 0 ||
      Date.now() < userScrollLockUntilRef.current ||
      isThreadViewportInteracting
    ) {
      return
    }

    finalizeThreadOpenScroll(selectedThreadId)

    return () => cancelPendingThreadOpenSettleFrame()
  }, [
    displayedTurnsLength,
    isThreadViewportInteracting,
    selectedThreadId,
    threadDetailIsLoading,
    threadContentSignature,
  ])

  useEffect(() => {
    if (!selectedThreadId || getCoordinatorState().followMode !== 'follow') {
      return
    }

    requestThreadViewportScroll({
      behavior: 'auto',
      policy: 'follow-latest',
      resolveTargetTop: (currentViewport) => currentViewport.scrollHeight,
      source: 'bottom-clearance-change',
    })
  }, [selectedThreadId, threadBottomClearancePx])

  useEffect(() => {
    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    const syncViewportHeight = () => {
      const nextClientHeight = viewport.clientHeight
      const previousClientHeight = lastViewportClientHeightRef.current
      lastViewportClientHeightRef.current = nextClientHeight

      if (
        previousClientHeight === null ||
        previousClientHeight === nextClientHeight ||
        !selectedThreadId ||
        getCoordinatorState().followMode !== 'follow'
      ) {
        return
      }

      requestThreadViewportScroll({
        behavior: 'auto',
        policy: 'follow-latest',
        resolveTargetTop: (currentViewport) => currentViewport.scrollHeight,
        source: 'viewport-resize-follow',
      })
    }

    syncViewportHeight()

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      syncViewportHeight()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId) {
      lastObservedThreadScrollHeightRef.current = null
      cancelPendingContentResizeFrame()
      cancelPendingFollowTailCorrectionFrame()
      cancelPendingStreamingFollowFrame()
      return
    }

    const viewport = threadViewportRef.current
    const threadRoot = viewport?.querySelector('.workbench-log__thread')
    if (!viewport || !threadRoot) {
      lastObservedThreadScrollHeightRef.current = null
      cancelPendingContentResizeFrame()
      return
    }

    lastObservedThreadScrollHeightRef.current = viewport.scrollHeight

    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const scheduleContentLayoutFollow = () => {
      if (pendingContentResizeFrameRef.current !== null) {
        return
      }

      pendingContentResizeFrameRef.current = window.requestAnimationFrame(() => {
        pendingContentResizeFrameRef.current = null
        const currentViewport = threadViewportRef.current
        if (
          !currentViewport ||
          !selectedThreadId ||
          getCoordinatorState().followMode !== 'follow'
        ) {
          return
        }

        const nextScrollHeight = currentViewport.scrollHeight
        const previousScrollHeight = lastObservedThreadScrollHeightRef.current
        lastObservedThreadScrollHeightRef.current = nextScrollHeight

        if (
          previousScrollHeight === null ||
          previousScrollHeight === nextScrollHeight
        ) {
          return
        }

        requestThreadViewportScroll({
          behavior: 'auto',
          policy: 'follow-latest',
          resolveTargetTop: (currentViewportForTarget) => currentViewportForTarget.scrollHeight,
          source: 'content-layout-follow',
        })
      })
    }

    const observer = new ResizeObserver(() => {
      scheduleContentLayoutFollow()
    })
    observer.observe(threadRoot)

    return () => {
      observer.disconnect()
      cancelPendingContentResizeFrame()
    }
  }, [displayedTurnsLength, selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId) {
      return
    }

    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    function handleWheel(event: WheelEvent) {
      markViewportInteraction()
      if (event.deltaY < -2) {
        markUserScrollIntent(true, 'wheel-up')
        return
      }

      if (event.deltaY > 2 && getCoordinatorState().followMode !== 'follow') {
        markUserScrollIntent(false, 'wheel-down')
      }
    }

    function handleTouchStart(event: TouchEvent) {
      markViewportInteraction()
      touchStartYRef.current = event.touches[0]?.clientY ?? null
    }

    function handleTouchMove(event: TouchEvent) {
      markViewportInteraction()
      const currentY = event.touches[0]?.clientY
      const startY = touchStartYRef.current
      if (typeof currentY !== 'number' || typeof startY !== 'number') {
        return
      }

      const delta = currentY - startY
      if (delta > 3) {
        markUserScrollIntent(true, 'touch-up')
      } else if (delta < -3 && getCoordinatorState().followMode !== 'follow') {
        markUserScrollIntent(false, 'touch-down')
      }
    }

    function handlePointerDown() {
      markViewportInteraction()
      pointerGestureActiveRef.current = true
    }

    function clearPointerGesture() {
      pointerGestureActiveRef.current = false
    }

    viewport.addEventListener('wheel', handleWheel, { passive: true })
    viewport.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewport.addEventListener('touchmove', handleTouchMove, { passive: true })
    viewport.addEventListener('pointerdown', handlePointerDown, { passive: true })
    window.addEventListener('pointerup', clearPointerGesture, { passive: true })
    window.addEventListener('pointercancel', clearPointerGesture, { passive: true })

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
      viewport.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', clearPointerGesture)
      window.removeEventListener('pointercancel', clearPointerGesture)
      pointerGestureActiveRef.current = false
    }
  }, [selectedThreadId])

  function syncThreadViewportState() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      lastViewportScrollTopRef.current = 0
      setCoordinatorState(createThreadViewportCoordinatorState())
      return true
    }

    const nowMs = Date.now()
    const currentScrollTop = viewport.scrollTop
    const previousScrollTop = lastViewportScrollTopRef.current
    lastViewportScrollTopRef.current = currentScrollTop
    const userScrollIntent = resolveThreadViewportUserScrollIntent({
      currentScrollTop,
      followMode: getCoordinatorState().followMode,
      isPointerGestureActive: pointerGestureActiveRef.current,
      previousScrollTop,
    })
    if (userScrollIntent.shouldMarkUserIntent) {
      logThreadViewport('detected manual viewport scroll intent', {
        currentScrollTop,
        previousScrollTop,
        releaseFollow: userScrollIntent.releaseFollow,
      })
      markUserScrollIntent(
        userScrollIntent.releaseFollow,
        'pointer-gesture-scroll',
      )
    }

    if (nowMs >= programmaticScrollUntilRef.current) {
      markViewportInteraction()
    }

    const coordinatorState = getCoordinatorState()
    const pinnedState = resolveThreadViewportPinnedState({
      clientHeight: viewport.clientHeight,
      currentScrollTop,
      currentlyPinned: coordinatorState.followMode === 'follow',
      manuallyDetachedFromLatest: coordinatorState.followMode === 'detached',
      previousScrollTop,
      scrollHeight: viewport.scrollHeight,
    })

    recordConversationScrollDiagnosticEvent({
      clientHeight: viewport.clientHeight,
      kind: 'viewport-scroll',
      metadata: {
        isPinnedToLatest: pinnedState.isPinnedToLatest,
        manuallyDetachedFromLatest: coordinatorState.followMode === 'detached',
        shouldFollowThread: pinnedState.shouldFollowThread,
      },
      scrollHeight: viewport.scrollHeight,
      scrollTop: currentScrollTop,
      source: 'sync-thread-viewport',
    })

    setCoordinatorState(
      reduceThreadViewportPinnedState(coordinatorState, pinnedState),
    )
    return pinnedState.isPinnedToLatest
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'smooth') {
    cancelPendingThreadOpenSettleFrame()
    applyCoordinatorResult(
      reduceThreadViewportJumpToLatest(getCoordinatorState(), behavior),
    )
  }

  function handleThreadViewportScroll({
    isLoadingOlderTurns = false,
  }: ThreadViewportScrollInput = {}) {
    if (isLoadingOlderTurns && getCoordinatorState().olderTurnsAnchor) {
      pendingOlderTurnsAnchorSyncRef.current = true
    }

    if (pendingViewportSyncFrameRef.current !== null) {
      return
    }

    pendingViewportSyncFrameRef.current = window.requestAnimationFrame(() => {
      const shouldSyncOlderTurnsAnchor = pendingOlderTurnsAnchorSyncRef.current
      pendingOlderTurnsAnchorSyncRef.current = false
      pendingViewportSyncFrameRef.current = null
      if (shouldSyncOlderTurnsAnchor) {
        syncOlderTurnsAnchorWithViewport()
      }
      syncThreadViewportState()
    })
  }

  function handleJumpToLatest() {
    scrollThreadToLatest('smooth')
  }

  useEffect(
    () => () => {
      cancelPendingAutoScrollFrame()
      clearPendingFollowScrollTask()
      cancelPendingViewportSyncFrame()
      cancelPendingContentResizeFrame()
      cancelPendingThreadOpenSettleFrame()
      cancelPendingFollowTailCorrectionFrame()
      cancelPendingStreamingFollowFrame()
      pendingOlderTurnsAnchorSyncRef.current = false
      programmaticScrollUntilRef.current = 0
      programmaticScrollPolicyRef.current = null
      lastAutoFollowScrollAtRef.current = 0
      lastObservedThreadScrollHeightRef.current = null
      pointerGestureActiveRef.current = false
      coordinatorStateRef.current = createThreadViewportCoordinatorState()
      if (viewportInteractionTimeoutRef.current !== null) {
        window.clearTimeout(viewportInteractionTimeoutRef.current)
      }
    },
    [],
  )

  return {
    captureOlderTurnsAnchor,
    handleJumpToLatest,
    handleThreadViewportScroll,
    hasUnreadThreadUpdates,
    isThreadPinnedToLatest,
    isThreadViewportInteracting,
    restoreOlderTurnsViewport,
    scrollThreadToLatest,
    threadViewportRef,
  }
}
