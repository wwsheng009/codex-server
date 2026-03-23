export type ThreadContentSignature = {
  latestRenderableItemKey: string
  latestTurnId: string
  latestTurnStatus: string
  pendingPhase: string
  pendingTurnId: string
  selectedThreadId: string
  timelineItemCount: number
  turnCount: number
}

export function buildThreadContentSignature(
  signature: ThreadContentSignature,
): ThreadContentSignature {
  return signature
}

export function didThreadContentChange(
  previousSignature: ThreadContentSignature | null,
  nextSignature: ThreadContentSignature,
) {
  if (previousSignature === nextSignature) {
    return false
  }

  if (!previousSignature) {
    return true
  }

  return (
    previousSignature.selectedThreadId !== nextSignature.selectedThreadId ||
    previousSignature.turnCount !== nextSignature.turnCount ||
    previousSignature.timelineItemCount !== nextSignature.timelineItemCount ||
    previousSignature.latestTurnId !== nextSignature.latestTurnId ||
    previousSignature.latestTurnStatus !== nextSignature.latestTurnStatus ||
    previousSignature.latestRenderableItemKey !== nextSignature.latestRenderableItemKey ||
    previousSignature.pendingPhase !== nextSignature.pendingPhase ||
    previousSignature.pendingTurnId !== nextSignature.pendingTurnId
  )
}
