import type { ServerEvent, ThreadDetail } from '../types/api'

export type ResolveLiveThreadDetailInput = {
  currentLiveDetail?: ThreadDetail
  events: ServerEvent[]
  threadDetail?: ThreadDetail
}
