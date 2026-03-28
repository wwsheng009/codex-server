import type { ReactNode, RefObject } from 'react'

import type { PendingApproval, ThreadTurn } from '../../types/api'
import type { LiveTimelineEntry } from './timelineUtilsTypes'

export type ConversationEntry =
  | {
      kind: 'item'
      key: string
      item: Record<string, unknown>
      turnId: string
    }
  | {
      kind: 'error'
      key: string
      error: unknown
    }

export type ThreadTurnContentHandler = (
  turnId: string,
  itemId?: string,
) => void

export type RetryServerRequestHandler = (item: Record<string, unknown>) => void

export type TurnTimelineProps = {
  disableVirtualization?: boolean
  freezeVirtualization?: boolean
  onReleaseFullTurn?: ThreadTurnContentHandler
  onRetainFullTurn?: ThreadTurnContentHandler
  onRequestFullTurn?: ThreadTurnContentHandler
  scrollViewportRef?: RefObject<HTMLDivElement | null>
  timelineIdentity?: string
  turns: ThreadTurn[]
  onRetryServerRequest?: RetryServerRequestHandler
}

export type TurnTimelineVirtualizationInput = {
  disableVirtualization?: boolean
  entryCount: number
  hasScrollViewportRef: boolean
  timelineIdentity?: string
}

export type LiveFeedProps = {
  entries: LiveTimelineEntry[]
}

export type ApprovalAnswerChangeHandler = (
  requestId: string,
  questionId: string,
  value: string,
) => void

export type ApprovalResponseInput = {
  requestId: string
  action: string
  answers?: Record<string, string[]>
}

export type ApprovalRespondHandler = (input: ApprovalResponseInput) => void

export type ApprovalStackProps = {
  approvals: PendingApproval[]
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  responding?: boolean
  onChangeAnswer: ApprovalAnswerChangeHandler
  onRespond: ApprovalRespondHandler
}

export type ApprovalDialogProps = {
  approval: PendingApproval
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  approvalQueueCount: number
  responding?: boolean
  onChangeAnswer: ApprovalAnswerChangeHandler
  onRespond: ApprovalRespondHandler
}

export type ApprovalDialogQuestionProps = {
  approvalId: string
  question: Record<string, unknown>
  value: string
  onChangeAnswer: ApprovalAnswerChangeHandler
  onAdvance: () => void
  focusFirst?: boolean
}

export type ApprovalCardProps = {
  approval: PendingApproval
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  onChangeAnswer: ApprovalAnswerChangeHandler
  onRespond: ApprovalRespondHandler
  responding?: boolean
  className?: string
  children?: ReactNode
  headerMeta?: ReactNode
  titleId?: string
}

export type ApprovalQuestionFieldProps = {
  approvalId: string
  question: Record<string, unknown>
  value: string
  onChangeAnswer: ApprovalAnswerChangeHandler
  focusFirst?: boolean
}

export type MessageTone = 'user' | 'assistant' | 'system'

export type CopyableMessageBodyProps = {
  source: string
  tone: MessageTone
  className?: string
  children: ReactNode
}

export type CopyMessageStatus = 'idle' | 'copied' | 'error'

export type CopyMessageStatusIconProps = {
  state: CopyMessageStatus
}

export type ExpandableThreadMessageProps = {
  content: string
  onReleaseFullContent?: () => void
  onRetainFullContent?: () => void
  onRequestFullContent?: () => void
  summaryTruncated?: boolean
  tone: 'user' | 'assistant'
}

export type CompactSystemStatusTone = 'running' | 'success' | 'error'

export type CompactSystemStatusIconProps = {
  tone: CompactSystemStatusTone
}

export type TimelineItemProps = {
  item: Record<string, unknown>
  onReleaseFullTurn?: ThreadTurnContentHandler
  onRetainFullTurn?: ThreadTurnContentHandler
  onRequestFullTurn?: ThreadTurnContentHandler
  onRetryServerRequest?: RetryServerRequestHandler
  showStreamingCursor?: boolean
  turnId: string
}

export type SystemTimelineCardProps = {
  className?: string
  deferDetailsUntilOpen?: boolean
  onReleaseFullContent?: () => void
  onRetainFullContent?: () => void
  onRequestFullContent?: () => void
  summaryTruncated?: boolean
  title: string
  summary: string
  meta?: string
  statusTone?: CompactSystemStatusTone
  children: ReactNode
}

export type ToolCallTimelineCardProps = {
  item: Record<string, unknown>
  onReleaseFullTurn?: ThreadTurnContentHandler
  onRetainFullTurn?: ThreadTurnContentHandler
  onRequestFullTurn?: ThreadTurnContentHandler
  turnId: string
}

export type ServerRequestTimelineCardProps = {
  item: Record<string, unknown>
  onReleaseFullTurn?: ThreadTurnContentHandler
  onRetainFullTurn?: ThreadTurnContentHandler
  onRequestFullTurn?: ThreadTurnContentHandler
  onRetry?: RetryServerRequestHandler
  turnId: string
}

export type ToolCallSectionValueProps = {
  value: unknown
  tone?: 'danger'
  className?: string
}

export type ConversationEntryRowProps = {
  children: ReactNode
  containerRef?: RefObject<HTMLDivElement | null>
}

export type MeasuredConversationEntryProps = {
  children: ReactNode
  entryKey: string
  isMeasurementActive: boolean
  onMeasure: (entryKey: string, nextHeight: number) => void
}

export type ToolCallSection =
  | {
      kind?: 'json'
      label: string
      value: unknown
      tone?: 'danger'
    }
  | {
      kind: 'text'
      label: string
      value: string
      tone?: 'danger'
    }

export type ToolCallCommandField = {
  label: string
  value: string
  terminal?: boolean
}

export type ToolCallContentItem = {
  type: string
  text?: string
  imageUrl?: string
}
