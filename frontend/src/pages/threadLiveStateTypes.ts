import type { ServerEvent, ThreadDetail } from '../types/api'

export type ResolveLiveThreadDetailInput = {
  currentLiveDetail?: ThreadDetail
  events: ServerEvent[]
  threadDetail?: ThreadDetail
}

export type LiveThreadProjectionState = {
  detail?: ThreadDetail
  lastEventKey: string
  selectedThreadId?: string
}

export type ResolveLiveThreadProjectionStateInput = {
  currentState?: LiveThreadProjectionState
  events: ServerEvent[]
  selectedThreadId?: string
  threadDetail?: ThreadDetail
}
