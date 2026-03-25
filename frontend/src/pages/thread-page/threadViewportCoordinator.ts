import type {
  ReduceThreadViewportContentChangeInput,
  ThreadViewportCoordinatorResult,
  ThreadViewportCoordinatorState,
  ThreadViewportOlderTurnsAnchor,
  ViewportPinnedState,
} from './threadViewportCoordinatorTypes'

export function createThreadViewportCoordinatorState(
  selectedThreadId?: string,
): ThreadViewportCoordinatorState {
  return {
    followMode: 'follow',
    hasUnreadThreadUpdates: false,
    isPinnedToLatest: true,
    olderTurnsAnchor: null,
    pendingThreadOpenThreadId: selectedThreadId ?? null,
  }
}

export function reduceThreadViewportSelection(
  selectedThreadId?: string,
): ThreadViewportCoordinatorResult {
  const state = createThreadViewportCoordinatorState(selectedThreadId)

  if (!selectedThreadId) {
    return { state }
  }

  return {
    command: {
      behavior: 'auto',
      kind: 'scroll-to-bottom',
      policy: 'follow-latest',
      source: 'thread-selected',
    },
    state,
  }
}

export function reduceThreadViewportContentChange(
  state: ThreadViewportCoordinatorState,
  input: ReduceThreadViewportContentChangeInput,
): ThreadViewportCoordinatorResult {
  if (input.shouldAutoScroll) {
    return {
      command: {
        behavior: 'auto',
        kind: 'scroll-to-bottom',
        policy: 'follow-latest',
        source: 'content-change-follow',
      },
      state: {
        ...state,
        followMode: 'follow',
        hasUnreadThreadUpdates: false,
        isPinnedToLatest: true,
      },
    }
  }

  if (input.shouldMarkUnread) {
    return {
      state: {
        ...state,
        hasUnreadThreadUpdates: true,
      },
    }
  }

  return { state }
}

export function reduceThreadViewportPinnedState(
  state: ThreadViewportCoordinatorState,
  pinnedState: ViewportPinnedState,
): ThreadViewportCoordinatorState {
  if (pinnedState.isPinnedToLatest && pinnedState.shouldFollowThread) {
    return {
      ...state,
      followMode: 'follow',
      hasUnreadThreadUpdates:
        pinnedState.shouldResetUnread ? false : state.hasUnreadThreadUpdates,
      isPinnedToLatest: true,
    }
  }

  return {
    ...state,
    followMode: 'detached',
    isPinnedToLatest: false,
  }
}

export function reduceThreadViewportDetach(
  state: ThreadViewportCoordinatorState,
): ThreadViewportCoordinatorState {
  return {
    ...state,
    followMode: 'detached',
    isPinnedToLatest: false,
  }
}

export function reduceThreadViewportJumpToLatest(
  state: ThreadViewportCoordinatorState,
  behavior: ScrollBehavior,
): ThreadViewportCoordinatorResult {
  return {
    command: {
      behavior,
      kind: 'scroll-to-bottom',
      policy: 'follow-latest',
      source: 'jump-to-latest',
    },
    state: {
      ...state,
      followMode: 'follow',
      hasUnreadThreadUpdates: false,
      isPinnedToLatest: true,
    },
  }
}

export function reduceThreadViewportOlderTurnsAnchor(
  state: ThreadViewportCoordinatorState,
  anchor: ThreadViewportOlderTurnsAnchor,
): ThreadViewportCoordinatorState {
  return {
    ...state,
    olderTurnsAnchor: anchor,
  }
}

export function reduceThreadViewportRestoreOlderTurns(
  state: ThreadViewportCoordinatorState,
): ThreadViewportCoordinatorResult {
  if (!state.olderTurnsAnchor) {
    return { state }
  }

  if (state.olderTurnsAnchor.restoreMode !== 'preserve-position') {
    return {
      state: {
        ...state,
        olderTurnsAnchor: null,
      },
    }
  }

  return {
    command: {
      anchor: state.olderTurnsAnchor,
      behavior: 'auto',
      kind: 'restore-anchor',
      policy: 'preserve-position',
      source: 'older-turn-restore',
    },
    state: {
      ...state,
      olderTurnsAnchor: null,
    },
  }
}

export function reduceThreadViewportThreadOpenSettleComplete(
  state: ThreadViewportCoordinatorState,
): ThreadViewportCoordinatorState {
  if (state.pendingThreadOpenThreadId === null) {
    return state
  }

  return {
    ...state,
    pendingThreadOpenThreadId: null,
  }
}
