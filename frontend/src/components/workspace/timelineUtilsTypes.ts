import type { ServerEvent } from '../../types/api'

export type LiveTimelineEntry =
  | {
      kind: 'event'
      key: string
      event: ServerEvent
    }
  | {
      kind: 'delta'
      key: string
      groupKey: string
      title: string
      subtitle?: string
      text: string
      startedTs: string
      endedTs: string
      count: number
    }
