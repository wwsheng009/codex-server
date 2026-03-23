import type { ThreadContentSignature } from './threadContentSignature'

export type ThreadViewportStateInput = {
  displayedTurnsLength: number
  selectedThreadId?: string
  threadContentSignature: ThreadContentSignature
  threadUnreadUpdateKey: string
  threadDetailIsLoading: boolean
}

export type ThreadViewportAutoScrollInput = ThreadViewportStateInput & {
  threadBottomClearancePx: number
}

export type ThreadViewportScrollInput = {
  isLoadingOlderTurns?: boolean
}
