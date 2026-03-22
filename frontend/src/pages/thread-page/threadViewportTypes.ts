export type ThreadViewportStateInput = {
  displayedTurnsLength: number
  selectedThreadId?: string
  threadContentKey: string
  threadUnreadUpdateKey: string
  threadDetailIsLoading: boolean
}

export type ThreadViewportAutoScrollInput = ThreadViewportStateInput & {
  threadBottomClearancePx: number
}
