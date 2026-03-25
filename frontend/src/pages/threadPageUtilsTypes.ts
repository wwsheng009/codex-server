export type ThreadDisplayMetrics = {
  latestRenderableItemKey: string
  loadedAssistantMessageCount: number
  loadedMessageCount: number
  loadedUserMessageCount: number
  settledMessageAutoScrollKey: string
  threadUnreadUpdateKey: string
  timelineItemCount: number
}

export type ThreadItemDisplayMetrics = {
  loadedAssistantMessageCount: number
  loadedMessageCount: number
  loadedUserMessageCount: number
  renderableKeySuffix: string
  settledMessageKeySuffix: string
  threadUnreadKeySuffix: string
}
