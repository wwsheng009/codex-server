import { useEffect, useRef, useState } from 'react'

import { recordConversationScrollDiagnosticEvent } from '../../components/workspace/threadConversationProfiler'
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
  resolveThreadViewportPinnedState,
  resolveThreadViewportScrollDeferState,
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
  const pendingViewportSyncFrameRef = useRef<number | null>(null)
  const pendingThreadOpenSettleFrameRef = useRef<number | null>(null)
  const pendingFollowScrollTaskRef = useRef<ThreadViewportScrollTask | null>(null)
  const pendingFollowScrollTimeoutRef = useRef<number | null>(null)
  const pendingOlderTurnsAnchorSyncRef = useRef(false)
  const programmaticScrollUntilRef = useRef(0)
  const programmaticScrollPolicyRef = useRef<ThreadViewportProgrammaticScrollPolicy | null>(null)
  const lastViewportScrollTopRef = useRef(0)
  const lastViewportClientHeightRef = useRef<number | null>(null)
  const touchStartYRef = useRef<number | null>(null)
  const userScrollLockUntilRef = useRef(0)
  const viewportInteractionTimeoutRef = useRef<number | null>(null)

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

    const targetTop = resolveTargetTop(viewport)
    if (targetTop === null) {
      return
    }

    recordConversationScrollDiagnosticEvent({
      behavior,
      clientHeight: viewport.clientHeight,
      kind: 'programmatic-scroll',
      metadata,
      scrollHeight: viewport.scrollHeight,
      scrollTop: viewport.scrollTop,
      source,
      targetTop,
    })
    viewport.scrollTo({
      top: targetTop,
      behavior,
    })
    programmaticScrollUntilRef.current = Date.now() + THREAD_VIEWPORT_INTERACTION_LOCK_MS
    programmaticScrollPolicyRef.current = taskPolicy

    if (behavior === 'auto') {
      lastViewportScrollTopRef.current = targetTop
    }
  }

  function cancelPendingAutoScrollFrame() {
    if (pendingAutoScrollFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingAutoScrollFrameRef.current)
    pendingAutoScrollFrameRef.current = null
  }

  function scheduleThreadViewportScrollTask(
    task: ThreadViewportScrollTask,
    onAfterScroll?: () => void,
  ) {
    cancelPendingAutoScrollFrame()
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null
      executeThreadViewportScrollTask(task)
      onAfterScroll?.()
    })
  }

  function flushPendingFollowScrollTask() {
    const pendingTask = pendingFollowScrollTaskRef.current
    if (!pendingTask) {
      cancelPendingFollowScrollTimeout()
      return
    }

    const deferState = resolveThreadViewportScrollDeferState({
      isThreadViewportInteracting: isThreadViewportInteractingRef.current,
      nowMs: Date.now(),
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

    pendingFollowScrollTaskRef.current = null
    cancelPendingFollowScrollTimeout()
    scheduleThreadViewportScrollTask(pendingTask)
  }

  function requestThreadViewportScroll(
    task: ThreadViewportScrollTask,
    onAfterScroll?: () => void,
  ) {
    const deferState = resolveThreadViewportScrollDeferState({
      isThreadViewportInteracting: isThreadViewportInteractingRef.current,
      nowMs: Date.now(),
      policy: task.policy,
      userScrollLockUntilMs: userScrollLockUntilRef.current,
    })

    if (deferState.shouldDefer) {
      pendingFollowScrollTaskRef.current = task
      cancelPendingFollowScrollTimeout()
      pendingFollowScrollTimeoutRef.current = window.setTimeout(
        flushPendingFollowScrollTask,
        deferState.delayMs,
      )
      return
    }

    clearPendingFollowScrollTask()
    scheduleThreadViewportScrollTask(task, onAfterScroll)
  }

  function cancelPendingViewportSyncFrame() {
    if (pendingViewportSyncFrameRef.current === null) {
      return
    }

    window.cancelAnimationFrame(pendingViewportSyncFrameRef.current)
    pendingViewportSyncFrameRef.current = null
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

  function markUserScrollIntent(releaseFollow = false) {
    const viewport = threadViewportRef.current
    userScrollLockUntilRef.current = Date.now() + 600
    clearPendingFollowScrollTask('follow-latest')
    cancelPendingAutoScrollFrame()
    cancelPendingViewportSyncFrame()
    cancelPendingThreadOpenSettleFrame()

    if (hasActiveViewportProgrammaticScroll()) {
      stopViewportAutoScrollAnimation()
    }

    recordConversationScrollDiagnosticEvent({
      clientHeight: viewport?.clientHeight,
      detail: releaseFollow ? 'detach-follow' : 'keep-follow-state',
      kind: 'user-intent',
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
    lastViewportScrollTopRef.current = 0
    lastViewportClientHeightRef.current = null
    touchStartYRef.current = null
    userScrollLockUntilRef.current = 0
    programmaticScrollUntilRef.current = 0
    programmaticScrollPolicyRef.current = null
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

    return () => cancelPendingAutoScrollFrame()
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
      return
    }

    const viewport = threadViewportRef.current
    if (!viewport) {
      return
    }

    function handleWheel(event: WheelEvent) {
      markViewportInteraction()
      if (event.deltaY < -2) {
        markUserScrollIntent(true)
        return
      }

      if (event.deltaY > 2 && getCoordinatorState().followMode !== 'follow') {
        markUserScrollIntent(false)
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
        markUserScrollIntent(true)
      } else if (delta < -3 && getCoordinatorState().followMode !== 'follow') {
        markUserScrollIntent(false)
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: true })
    viewport.addEventListener('touchstart', handleTouchStart, { passive: true })
    viewport.addEventListener('touchmove', handleTouchMove, { passive: true })

    return () => {
      viewport.removeEventListener('wheel', handleWheel)
      viewport.removeEventListener('touchstart', handleTouchStart)
      viewport.removeEventListener('touchmove', handleTouchMove)
    }
  }, [selectedThreadId])

  function syncThreadViewportState() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      lastViewportScrollTopRef.current = 0
      setCoordinatorState(createThreadViewportCoordinatorState())
      return true
    }

    if (Date.now() >= programmaticScrollUntilRef.current) {
      markViewportInteraction()
    }

    const currentScrollTop = viewport.scrollTop
    const previousScrollTop = lastViewportScrollTopRef.current
    lastViewportScrollTopRef.current = currentScrollTop
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
      cancelPendingThreadOpenSettleFrame()
      pendingOlderTurnsAnchorSyncRef.current = false
      programmaticScrollUntilRef.current = 0
      programmaticScrollPolicyRef.current = null
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
