export type ThreadViewportStateInput = {
  displayedTurnsLength: number
  selectedThreadId?: string
  settledMessageAutoScrollKey: string
  threadContentKey: string
  threadDetailIsLoading: boolean
}

export type ThreadViewportAutoScrollInput = ThreadViewportStateInput & {
  threadBottomClearancePx: number
}
