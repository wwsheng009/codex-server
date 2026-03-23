import type { ThreadViewportProgrammaticScrollPolicy } from './threadViewportAutoScrollUtils'

export type ThreadViewportFollowMode = 'detached' | 'follow'

export type ThreadViewportOlderTurnsAnchor = {
  restoreMode: 'preserve-position' | 'reveal-older'
  scrollHeight: number
  scrollTop: number
}

export type ThreadViewportCoordinatorState = {
  followMode: ThreadViewportFollowMode
  hasUnreadThreadUpdates: boolean
  isPinnedToLatest: boolean
  olderTurnsAnchor: ThreadViewportOlderTurnsAnchor | null
  pendingThreadOpenThreadId: string | null
}

export type ThreadViewportCoordinatorCommand =
  | {
      behavior: ScrollBehavior
      kind: 'restore-anchor'
      policy: ThreadViewportProgrammaticScrollPolicy
      source: 'older-turn-restore'
      anchor: ThreadViewportOlderTurnsAnchor
    }
  | {
      behavior: ScrollBehavior
      kind: 'scroll-to-bottom'
      policy: ThreadViewportProgrammaticScrollPolicy
      source:
        | 'bottom-clearance-change'
        | 'content-change-follow'
        | 'jump-to-latest'
        | 'thread-open-settle'
        | 'thread-selected'
        | 'viewport-resize-follow'
    }

export type ThreadViewportCoordinatorResult = {
  command?: ThreadViewportCoordinatorCommand
  state: ThreadViewportCoordinatorState
}

type ViewportPinnedState = {
  isPinnedToLatest: boolean
  shouldFollowThread: boolean
  shouldResetUnread: boolean
}

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
  input: {
    shouldAutoScroll: boolean
    shouldMarkUnread: boolean
  },
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
