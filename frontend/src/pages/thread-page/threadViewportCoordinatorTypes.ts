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

export type ViewportPinnedState = {
  isPinnedToLatest: boolean
  shouldFollowThread: boolean
  shouldResetUnread: boolean
}

export type ReduceThreadViewportContentChangeInput = {
  shouldAutoScroll: boolean
  shouldMarkUnread: boolean
}
