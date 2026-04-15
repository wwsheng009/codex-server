import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from 'react'

import {
  ThreadCodeBlock,
  ThreadMarkdown,
  ThreadPlainText,
  ThreadTerminalBlock,
  sanitizeThreadMarkdownContent,
} from '../thread/ThreadContent'
import { formatLocalizedStatusLabel, formatLocalizedTime } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import { containsAnsiEscapeCode, safeJson } from '../thread/threadRender'
import { InlineNotice } from '../ui/InlineNotice'
import { Input } from '../ui/Input'
import {
  normalizeTurnPlanStatus,
  readTurnPlanItem,
  type TurnPlanItem,
  type TurnPlanStep,
} from '../../lib/turn-plan'
import type {
  ApprovalCardProps,
  ApprovalDialogProps,
  ApprovalDialogQuestionProps,
  ApprovalQuestionFieldProps,
  ApprovalStackProps,
  CompactSystemStatusIconProps,
  CompactSystemStatusTone,
  ConversationEntry,
  ConversationEntryRowProps,
  CopyableMessageBodyProps,
  CopyMessageStatus,
  CopyMessageStatusIconProps,
  ExpandableThreadMessageProps,
  LiveFeedProps,
  MeasuredConversationEntryProps,
  PlanStatusStackProps,
  ServerRequestTimelineCardProps,
  SystemTimelineCardProps,
  TimelineItemProps,
  ToolCallCommandField,
  ToolCallContentItem,
  ToolCallSection,
  ToolCallSectionValueProps,
  ToolCallTimelineCardProps,
  TurnTimelineProps,
  TurnTimelineVirtualizationInput,
} from './renderersTypes'
import {
  ConversationRenderProfilerBoundary,
  recordConversationLiveDiagnosticEvent,
} from './threadConversationProfiler'
import { useVirtualizedConversationEntries } from './useVirtualizedConversationEntries'
import { frontendDebugLog } from '../../lib/frontend-runtime-mode'
import type { PendingApproval, ThreadTurn } from '../../types/api'
const EXPANDABLE_MESSAGE_THRESHOLD_CHARS = 4_000
const EXPANDABLE_MESSAGE_PREVIEW_CHARS = 1_200
const FULL_TURN_OVERRIDE_TTL_MS = 30_000
const STREAMING_TYPEWRITER_CHARACTERS_PER_SECOND = 90
const STREAMING_TYPEWRITER_FALLBACK_FRAME_MS = 16
const STREAMING_TYPEWRITER_MAX_STEP = 48
const VIRTUALIZED_TIMELINE_ENTRY_THRESHOLD = 80
const conversationEntriesCache = new WeakMap<ThreadTurn[], ConversationEntry[]>()
const turnConversationEntriesCache = new WeakMap<ThreadTurn, ConversationEntry[]>()
const itemRenderSuppressionDebugCache = new WeakMap<Record<string, unknown>, string>()
const itemRenderPlaceholderDebugCache = new WeakMap<Record<string, unknown>, string>()

const selectionChangeSubscribers = new Set<() => void>()

function emitSelectionChange() {
  selectionChangeSubscribers.forEach((listener) => listener())
}

function subscribeToSelectionChange(listener: () => void) {
  if (typeof document === 'undefined') {
    return () => undefined
  }

  const wasEmpty = selectionChangeSubscribers.size === 0
  selectionChangeSubscribers.add(listener)

  if (wasEmpty) {
    document.addEventListener('selectionchange', emitSelectionChange)
  }

  return () => {
    selectionChangeSubscribers.delete(listener)
    if (!selectionChangeSubscribers.size) {
      document.removeEventListener('selectionchange', emitSelectionChange)
    }
  }
}

function selectionBelongsToContainer(container: HTMLElement | null) {
  if (!container || typeof window === 'undefined') {
    return false
  }

  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return false
  }

  return container.contains(selection.getRangeAt(0).commonAncestorContainer)
}

export const TurnTimeline = memo(function TurnTimeline({
  disableVirtualization = false,
  freezeVirtualization = false,
  onReleaseFullTurn,
  onRetainFullTurn,
  onRequestFullTurn,
  scrollViewportRef,
  timelineIdentity,
  turns,
  onRetryServerRequest,
}: TurnTimelineProps) {
  const entries = useMemo(() => buildConversationEntries(turns), [turns])
  const activeStreamingAgentItemKey = useMemo(
    () => findActiveStreamingAgentItemKey(turns),
    [turns],
  )
  const isVirtualizedTimeline = shouldVirtualizeTurnTimeline({
    disableVirtualization,
    entryCount: entries.length,
    hasScrollViewportRef: Boolean(scrollViewportRef),
    timelineIdentity,
  })
  const {
    paddingBottom,
    paddingTop,
    registerEntryHeight,
    visibleEntries,
  } = useVirtualizedConversationEntries({
    enabled: isVirtualizedTimeline,
    entries,
    estimateEntryHeight: estimateConversationEntryHeight,
    freezeLayout: freezeVirtualization,
    getEntryKey: getConversationEntryKey,
    listIdentity: timelineIdentity ?? '',
    scrollViewportRef:
      scrollViewportRef as RefObject<HTMLElement | null>,
  })
  const retryServerRequestRef = useRef(onRetryServerRequest)
  retryServerRequestRef.current = onRetryServerRequest

  const handleRetryServerRequest = useCallback((item: Record<string, unknown>) => {
    retryServerRequestRef.current?.(item)
  }, [])

  const renderEntryBody = useCallback((entry: ConversationEntry) => (
    <ConversationRenderProfilerBoundary id={getConversationEntryProfilerId(entry)}>
      {entry.kind === 'error' ? (
        <SystemTimelineCard
          className="conversation-card--error"
          statusTone="error"
          summary={summarizeCompactError(entry.error)}
          title={i18n._({ id: "Error", message: "Error" })}
        >
          <ThreadCodeBlock className="conversation-card__output" content={safeJson(entry.error)} />
        </SystemTimelineCard>
      ) : (
        <MemoTimelineItem
          item={entry.item}
          onReleaseFullTurn={onReleaseFullTurn}
          onRetainFullTurn={onRetainFullTurn}
          onRequestFullTurn={onRequestFullTurn}
          onRetryServerRequest={handleRetryServerRequest}
          showStreamingCursor={
            entry.kind === 'item' &&
            getStreamingAgentItemKey(entry.turnId, entry.item) === activeStreamingAgentItemKey
          }
          turnId={entry.turnId}
        />
      )}
    </ConversationRenderProfilerBoundary>
  ), [
    handleRetryServerRequest,
    onReleaseFullTurn,
    onRequestFullTurn,
    onRetainFullTurn,
  ])

  useEffect(() => {
    frontendDebugLog('thread-render', 'timeline render window updated', {
      timelineIdentity: timelineIdentity ?? '',
      isVirtualizedTimeline,
      totalEntryCount: entries.length,
      visibleEntryCount: visibleEntries.length,
      paddingTop,
      paddingBottom,
      visibleEntries: visibleEntries.slice(-8).map(summarizeConversationEntryForDebug),
    })
  }, [
    entries,
    isVirtualizedTimeline,
    paddingBottom,
    paddingTop,
    timelineIdentity,
    visibleEntries,
  ])

  return (
    <ConversationRenderProfilerBoundary id="TurnTimeline">
      <div aria-live="polite" className="conversation-stream" role="log">
        {paddingTop > 0 ? (
          <div
            aria-hidden="true"
            className="conversation-stream__spacer"
            style={{ height: paddingTop }}
          />
        ) : null}
        {visibleEntries.map((entry) =>
          isVirtualizedTimeline ? (
            <MeasuredConversationEntry
              entryKey={entry.key}
              isMeasurementActive={!freezeVirtualization}
              key={entry.key}
              onMeasure={registerEntryHeight}
            >
              {renderEntryBody(entry)}
            </MeasuredConversationEntry>
          ) : (
            <ConversationEntryRow key={entry.key}>
              {renderEntryBody(entry)}
            </ConversationEntryRow>
          ),
        )}
        {paddingBottom > 0 ? (
          <div
            aria-hidden="true"
            className="conversation-stream__spacer"
            style={{ height: paddingBottom }}
          />
        ) : null}
      </div>
    </ConversationRenderProfilerBoundary>
  )
}, areTurnTimelinePropsEqual)

export function areTurnTimelinePropsEqual(
  previous: TurnTimelineProps,
  next: TurnTimelineProps,
) {
  return (
    previous.disableVirtualization === next.disableVirtualization &&
    previous.freezeVirtualization === next.freezeVirtualization &&
    previous.onReleaseFullTurn === next.onReleaseFullTurn &&
    previous.onRequestFullTurn === next.onRequestFullTurn &&
    previous.onRetainFullTurn === next.onRetainFullTurn &&
    previous.onRetryServerRequest === next.onRetryServerRequest &&
    previous.scrollViewportRef === next.scrollViewportRef &&
    previous.timelineIdentity === next.timelineIdentity &&
    previous.turns === next.turns
  )
}

export function shouldVirtualizeTurnTimeline({
  disableVirtualization = false,
  entryCount,
  hasScrollViewportRef,
  timelineIdentity,
}: TurnTimelineVirtualizationInput) {
  return (
    !disableVirtualization &&
    hasScrollViewportRef &&
    Boolean(timelineIdentity) &&
    entryCount >= VIRTUALIZED_TIMELINE_ENTRY_THRESHOLD
  )
}

export const LiveFeed = memo(function LiveFeed({ entries }: LiveFeedProps) {
  const displayEntries = useMemo(() => [...entries].reverse(), [entries])

  return (
    <div className="live-feed">
      <ol className="live-feed__list">
        {displayEntries.map((entry) => {
          const summary = describeLiveFeedEntry(entry)
          return (
            <li className="live-feed__item" key={entry.key}>
              <details className="live-feed__entry">
                <summary className="live-feed__summary">
                  <span className="live-feed__summary-time">
                    {formatLocalizedTime(summary.timestamp)}
                  </span>
                  <div className="live-feed__summary-copy">
                    <div className="live-feed__summary-title-row">
                      <strong>{summary.title}</strong>
                    </div>
                    {summary.caption ? (
                      <span className="live-feed__summary-text">{summary.caption}</span>
                    ) : null}
                  </div>
                  <span aria-hidden="true" className="live-feed__summary-action" />
                </summary>
                <div className="live-feed__detail-panel">
                  {summary.tokens.length ? (
                    <div className="live-feed__detail-meta">
                      {summary.tokens.map((token) => (
                        <span className="live-feed__detail-token" key={`${entry.key}-${token}`}>
                          {token}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {entry.kind === 'delta' ? (
                    entry.title === 'Command Output' || containsAnsiEscapeCode(entry.text) ? (
                      <ThreadTerminalBlock
                        className="live-feed__output live-feed__output--terminal"
                        content={entry.text || '—'}
                      />
                    ) : (
                      <ThreadCodeBlock className="live-feed__output" content={entry.text || '—'} />
                    )
                  ) : (
                    <ThreadCodeBlock
                      className="live-feed__output"
                      content={safeJson(entry.event.payload)}
                    />
                  )}
                </div>
              </details>
            </li>
          )
        })}
      </ol>
    </div>
  )
}, (previous, next) => previous.entries === next.entries)

function describeLiveFeedEntry(entry: LiveFeedProps['entries'][number]) {
  if (entry.kind === 'delta') {
    const captionParts = [
      entry.subtitle?.trim() || '',
      `${entry.count} ${entry.count === 1 ? 'update' : 'updates'}`,
    ].filter(Boolean)
    const tokens = [
      entry.subtitle?.trim() || '',
      `${entry.count} ${entry.count === 1 ? 'chunk' : 'chunks'}`,
      `Started ${formatLocalizedTime(entry.startedTs)}`,
      `Updated ${formatLocalizedTime(entry.endedTs)}`,
    ].filter(Boolean)

    return {
      title: entry.title,
      caption: captionParts.join(' | '),
      timestamp: entry.endedTs,
      tokens,
    }
  }

  const event = entry.event
  const tokens = [
    event.threadId ? `Thread ${truncateLiveFeedIdentifier(event.threadId)}` : '',
    event.turnId ? `Turn ${truncateLiveFeedIdentifier(event.turnId)}` : '',
    event.serverRequestId
      ? `Request ${truncateLiveFeedIdentifier(event.serverRequestId)}`
      : '',
  ].filter(Boolean)

  return {
    title: event.method,
    caption: tokens.join(' | '),
    timestamp: event.ts,
    tokens,
  }
}

function truncateLiveFeedIdentifier(value: string) {
  const trimmed = value.trim()
  if (trimmed.length <= 12) {
    return trimmed
  }

  return `${trimmed.slice(0, 8)}...`
}

export function ApprovalStack({
  approvals,
  approvalAnswers,
  approvalErrors,
  responding,
  onChangeAnswer,
  onRespond,
}: ApprovalStackProps) {
  return (
    <div className="approval-stack">
      {approvals.map((approval) => (
        <ApprovalCard
          approval={approval}
          approvalAnswers={approvalAnswers}
          approvalErrors={approvalErrors}
          key={approval.id}
          onChangeAnswer={onChangeAnswer}
          onRespond={onRespond}
          responding={responding}
        />
      ))}
    </div>
  )
}

type PlanStatusStackEntry = {
  key: string
  turnId: string
  turnPlan: TurnPlanItem
}

export function PlanStatusStack({ turns }: PlanStatusStackProps) {
  const entries = useMemo(() => collectTurnPlanStackEntries(turns), [turns])

  if (!entries.length) {
    return (
      <div className="empty-state">
        {i18n._({
          id: 'No plan status entries yet.',
          message: 'No plan status entries yet.',
        })}
      </div>
    )
  }

  return (
    <div className="plan-status-stack">
      {entries.map(({ key, turnId, turnPlan }) => {
        const steps = turnPlan.steps ?? []
        const explanation = turnPlan.explanation ?? ''
        const isCollapsedByDefault = isTurnPlanCollapsedByDefault(turnPlan)

        return (
          <details className="plan-status-panel" key={key} open={!isCollapsedByDefault}>
            <summary className="plan-status-panel__header">
              <div className="plan-status-panel__header-copy">
                <strong>
                  {i18n._({
                    id: 'Plan',
                    message: 'Plan',
                  })}
                </strong>
                <span className="plan-status-panel__summary">
                  {turnPlanCompactProgressMeta(steps)}
                </span>
              </div>
              <div className="plan-status-panel__meta">
                <span
                  className={`detail-badge detail-badge--${turnPlanOverallBadgeTone(turnPlan)}`}
                >
                  {turnPlanOverallStatusLabel(turnPlan)}
                </span>
                <span aria-hidden="true" className="plan-status-panel__toggle-icon" />
              </div>
            </summary>
            <div className="plan-status-panel__body">
              {explanation ? (
                <p className="plan-status-panel__explanation">{explanation}</p>
              ) : null}
              {steps.length ? (
                <ol className="plan-status-panel__steps">
                  {steps.map((entry, index) => (
                    <li className="plan-status-panel__step" key={`${turnId}-${entry.step}-${index}`}>
                      <span className="plan-status-panel__step-index">{index + 1}</span>
                      <div className="plan-status-panel__step-copy">
                        <span className="plan-status-panel__step-text">{entry.step}</span>
                      </div>
                      <span
                        className={`detail-badge detail-badge--${turnPlanStepBadgeTone(entry.status)}`}
                      >
                        {turnPlanStepStatusLabel(entry.status)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          </details>
        )
      })}
    </div>
  )
}

export function ApprovalDialog({
  approval,
  approvalAnswers,
  approvalErrors,
  approvalQueueCount,
  responding,
  onChangeAnswer,
  onRespond,
}: ApprovalDialogProps) {
  const details = asObject(approval.details)
  const questions = approvalQuestions(details)
  const summaryMeta = approvalDialogMeta(approval, details)
  const hasMultipleApprovals = approvalQueueCount > 1
  const primaryActions = approval.actions.filter(
    (action) => action === 'accept' || action === 'accept_for_session',
  )
  const secondaryActions = approval.actions.filter(
    (action) => action !== 'accept' && action !== 'accept_for_session',
  )
  const firstIncompleteQuestionIndex = useMemo(
    () => Math.max(questions.findIndex((question) => !isApprovalQuestionAnswered(approval.id, question, approvalAnswers)), 0),
    [approval.id, approvalAnswers, questions],
  )
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(firstIncompleteQuestionIndex)
  const dialogRef = useRef<HTMLElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setCurrentQuestionIndex(firstIncompleteQuestionIndex)
  }, [approval.id, firstIncompleteQuestionIndex])

  useEffect(() => {
    setCurrentQuestionIndex((current) => {
      if (!questions.length) {
        return 0
      }
      return Math.min(current, questions.length - 1)
    })
  }, [questions.length])

  const activeQuestion = questions[currentQuestionIndex]
  const isCurrentQuestionAnswered = activeQuestion
    ? isApprovalQuestionAnswered(approval.id, activeQuestion, approvalAnswers)
    : true
  const answersComplete = areApprovalQuestionsComplete(approval.id, questions, approvalAnswers)
  const showStepper = questions.length > 1

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const rafId = window.requestAnimationFrame(() => {
      focusFirstDialogElement(dialogRef.current)
    })

    return () => {
      window.cancelAnimationFrame(rafId)
      previousFocusRef.current?.focus?.()
    }
  }, [approval.id])

  function submitPrimaryAction(action: string) {
    onRespond({
      requestId: approval.id,
      action,
      answers: buildApprovalAnswersPayload(approval.id, questions, approvalAnswers, action),
    })
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Tab') {
      trapDialogFocus(event, dialogRef.current)
      return
    }

    if (
      event.key === 'Enter' &&
      (event.ctrlKey || event.metaKey) &&
      !responding &&
      primaryActions.length &&
      answersComplete &&
      (!questions.length || currentQuestionIndex === questions.length - 1)
    ) {
      event.preventDefault()
      submitPrimaryAction(primaryActions[0])
    }
  }

  return (
    <section
      aria-describedby={`approval-dialog-${approval.id}-description`}
      aria-labelledby={`approval-dialog-${approval.id}-title`}
      aria-modal="true"
      className="composer-approval-dialog"
      onKeyDown={handleDialogKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <article className="composer-approval-dialog__card approval-panel">
        <div className="approval-panel__header">
          <div className="approval-panel__header-copy">
            <strong id={`approval-dialog-${approval.id}-title`}>{approval.summary}</strong>
            <span>{approval.kind}</span>
          </div>
          {hasMultipleApprovals ? (
            <span className="composer-approval-dialog__count">{approvalQueueCount} {i18n._({ id: "pending", message: "pending" })}</span>
          ) : null}
        </div>
        <div className="composer-approval-dialog__intro" id={`approval-dialog-${approval.id}-description`}>
          <span className="composer-approval-dialog__eyebrow">{i18n._({ id: "Approval Required", message: "Approval Required" })}</span>
          <p>
            {questions.length
              ? i18n._({ id: 'renderers.answerPromptDirectly', message: 'Answer the prompt below directly from the composer without opening the side panel.' })
              : i18n._({ id: 'renderers.reviewRequestContinue', message: 'Review the request and choose how to continue before sending the next message.' })}
          </p>
        </div>
        {summaryMeta.length ? (
          <div className="composer-approval-dialog__meta-strip">
            {summaryMeta.map((entry) => (
              <span className="composer-approval-dialog__meta-pill" key={entry}>
                {entry}
              </span>
            ))}
          </div>
        ) : null}
        {typeof details.message === 'string' ? <p>{details.message}</p> : null}
        {showStepper ? (
          <div className="composer-approval-dialog__progress" role="tablist" aria-label={i18n._({ id: "Approval steps", message: "Approval steps" })}>
            {questions.map((question, index) => {
              const questionId = stringField(question.id)
              const answered = isApprovalQuestionAnswered(approval.id, question, approvalAnswers)
              const active = index === currentQuestionIndex

              return (
                <button
                  aria-selected={active}
                  className={
                    active
                      ? 'composer-approval-dialog__progress-step composer-approval-dialog__progress-step--active'
                      : answered
                        ? 'composer-approval-dialog__progress-step composer-approval-dialog__progress-step--done'
                        : 'composer-approval-dialog__progress-step'
                  }
                  key={`${approval.id}-${questionId}-${index}`}
                  onClick={() => setCurrentQuestionIndex(index)}
                  role="tab"
                  type="button"
                >
                  <span>{index + 1}</span>
                  <strong>{stringField(question.header) || i18n._({ id: 'renderers.questionNumber', message: 'Question {number}', values: { number: index + 1 } })}</strong>
                </button>
              )
            })}
          </div>
        ) : null}
        {activeQuestion ? (
          <ApprovalDialogQuestion
            approvalId={approval.id}
            focusFirst
            onAdvance={() =>
              setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1))
            }
            onChangeAnswer={onChangeAnswer}
            question={activeQuestion}
            value={approvalAnswers[approval.id]?.[stringField(activeQuestion.id)] ?? ''}
          />
        ) : null}
        {approvalErrors[approval.id] ? (
          <InlineNotice
            dismissible
            noticeKey={`approval-dialog-${approval.id}-${approvalErrors[approval.id]}`}
            title={i18n._({ id: "Approval Response Failed", message: "Approval Response Failed" })}
            tone="error"
          >
            {approvalErrors[approval.id]}
          </InlineNotice>
        ) : null}
        <div className="composer-approval-dialog__footer">
          <div className="composer-approval-dialog__shortcuts">
            {activeQuestion && approvalQuestionOptions(activeQuestion).length ? (
              <span className="composer-approval-dialog__shortcut">{i18n._({ id: "Arrows to move", message: "Arrows to move" })}</span>
            ) : null}
            {primaryActions.length ? (
              <span className="composer-approval-dialog__shortcut">{i18n._({ id: "Ctrl/Cmd+Enter to approve", message: "Ctrl/Cmd+Enter to approve" })}</span>
            ) : null}
          </div>
          <div className="header-actions">
            {secondaryActions.map((action) => (
              <button
                className="ide-button ide-button--secondary"
                disabled={responding}
                key={action}
                onClick={() => onRespond({ requestId: approval.id, action })}
                type="button"
              >
                {responding ? i18n._({ id: 'renderers.submitting', message: 'Submitting…' }) : formatApprovalActionLabel(action)}
              </button>
            ))}
          </div>
          <div className="header-actions">
            {questions.length && currentQuestionIndex > 0 ? (
              <button
                className="ide-button ide-button--secondary"
                disabled={responding}
                onClick={() => setCurrentQuestionIndex((current) => Math.max(current - 1, 0))}
                type="button"
              >
                {i18n._({ id: "Back", message: "Back" })}
              </button>
            ) : null}
            {questions.length && currentQuestionIndex < questions.length - 1 ? (
              <button
                className="ide-button"
                disabled={responding || !isCurrentQuestionAnswered}
                onClick={() => setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1))}
                type="button"
              >
                {i18n._({ id: "Next", message: "Next" })}
              </button>
            ) : primaryActions.length ? (
              primaryActions.map((action) => (
                <button
                  className="ide-button"
                  disabled={responding || (approvalActionNeedsAnswers(action) && !answersComplete)}
                  key={action}
                  onClick={() => submitPrimaryAction(action)}
                  type="button"
                >
                  {responding ? i18n._({ id: 'renderers.submitting', message: 'Submitting…' }) : formatApprovalActionLabel(action)}
                </button>
              ))
            ) : null}
          </div>
        </div>
      </article>
    </section>
  )
}

function ApprovalDialogQuestion({
  approvalId,
  question,
  value,
  onChangeAnswer,
  onAdvance,
  focusFirst,
}: ApprovalDialogQuestionProps) {
  const questionId = stringField(question.id)
  const header = stringField(question.header) || questionId
  const prompt = stringField(question.question)
  const options = approvalQuestionOptions(question)
  const isSecret = Boolean(question.isSecret)
  const inputId = `dialog-approval-${approvalId}-${questionId}`
  const firstOptionRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [focusIndex, setFocusIndex] = useState(() => {
    const selectedIndex = options.findIndex((option) => stringField(option.label) === value)
    return selectedIndex >= 0 ? selectedIndex : 0
  })

  useEffect(() => {
    const selectedIndex = options.findIndex((option) => stringField(option.label) === value)
    setFocusIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [options, value])

  useEffect(() => {
    if (!focusFirst) {
      return
    }

    if (options.length) {
      ;(optionRefs.current[focusIndex] ?? firstOptionRef.current)?.focus()
      return
    }

    inputRef.current?.focus()
  }, [focusFirst, focusIndex, inputId, options.length])

  function moveFocus(nextIndex: number) {
    const boundedIndex = Math.max(0, Math.min(nextIndex, options.length - 1))
    setFocusIndex(boundedIndex)
    optionRefs.current[boundedIndex]?.focus()
  }

  function handleOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault()
        moveFocus(index + 1)
        return
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault()
        moveFocus(index - 1)
        return
      case 'Home':
        event.preventDefault()
        moveFocus(0)
        return
      case 'End':
        event.preventDefault()
        moveFocus(options.length - 1)
        return
      default:
        return
    }
  }

  return (
    <div className="composer-approval-dialog__question">
      <div className="composer-approval-dialog__question-copy">
        <strong>{header}</strong>
        {prompt ? <p>{prompt}</p> : null}
      </div>
      {options.length ? (
        <div className="approval-choice-grid approval-choice-grid--dialog" role="listbox" aria-label={header}>
          {options.map((option, index) => {
            const optionLabel = stringField(option.label)
            const optionDescription = stringField(option.description)
            const selected = value === optionLabel

            return (
              <button
                aria-pressed={selected}
                className={selected ? 'approval-choice approval-choice--selected' : 'approval-choice'}
                key={`${questionId}-${optionLabel}`}
                onFocus={() => setFocusIndex(index)}
                onClick={() => {
                  onChangeAnswer(approvalId, questionId, optionLabel)
                  onAdvance()
                }}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                ref={(element) => {
                  optionRefs.current[index] = element
                  if (index === 0) {
                    firstOptionRef.current = element
                  }
                }}
                tabIndex={index === focusIndex ? 0 : -1}
                type="button"
              >
                <strong>{optionLabel}</strong>
                {optionDescription ? <span>{optionDescription}</span> : null}
              </button>
            )
          })}
        </div>
      ) : (
        <Input
          className="approval-question approval-question--dialog"
          id={inputId}
          label={header}
          onChange={(event) => onChangeAnswer(approvalId, questionId, event.target.value)}
          ref={inputRef}
          type={isSecret ? 'password' : 'text'}
          value={value}
        />
      )}
    </div>
  )
}

function ApprovalCard({
  approval,
  approvalAnswers,
  approvalErrors,
  onChangeAnswer,
  onRespond,
  responding,
  className,
  children,
  headerMeta,
  titleId,
}: ApprovalCardProps) {
  const details = asObject(approval.details)
  const questions = approvalQuestions(details)
  const answersComplete = areApprovalQuestionsComplete(approval.id, questions, approvalAnswers)

  return (
    <article className={className ?? 'approval-panel'}>
      <div className="approval-panel__header">
        <div className="approval-panel__header-copy">
          <strong id={titleId}>{approval.summary}</strong>
          <span>{approval.kind}</span>
        </div>
        {headerMeta}
      </div>
      {children}
      {typeof details.message === 'string' ? <p>{details.message}</p> : null}
      {questions.map((question, index) => (
        <ApprovalQuestionField
          approvalId={approval.id}
          key={`${approval.id}-${stringField(question.id) || index}`}
          onChangeAnswer={onChangeAnswer}
          question={question}
          value={approvalAnswers[approval.id]?.[stringField(question.id)] ?? ''}
          focusFirst={index === 0}
        />
      ))}
      {approvalErrors[approval.id] ? (
        <InlineNotice
          dismissible
          noticeKey={`approval-stack-${approval.id}-${approvalErrors[approval.id]}`}
          title={i18n._({ id: "Approval Response Failed", message: "Approval Response Failed" })}
          tone="error"
        >
          {approvalErrors[approval.id]}
        </InlineNotice>
      ) : null}
      <div className="approval-panel__actions">
        {approval.actions.map((action) => (
          <button
            className={action === 'accept' ? 'ide-button' : 'ide-button ide-button--secondary'}
            disabled={responding || (approvalActionNeedsAnswers(action) && !answersComplete)}
            key={action}
            onClick={() =>
              onRespond({
                requestId: approval.id,
                action,
                answers: buildApprovalAnswersPayload(approval.id, questions, approvalAnswers, action),
              })
            }
            type="button"
          >
            {responding ? i18n._({ id: 'renderers.submitting', message: 'Submitting…' }) : formatApprovalActionLabel(action)}
          </button>
        ))}
      </div>
    </article>
  )
}

function ApprovalQuestionField({
  approvalId,
  question,
  value,
  onChangeAnswer,
  focusFirst,
}: ApprovalQuestionFieldProps) {
  const questionId = stringField(question.id)
  const header = stringField(question.header) || questionId
  const prompt = stringField(question.question)
  const options = approvalQuestionOptions(question)
  const isSecret = Boolean(question.isSecret)
  const inputId = `approval-${approvalId}-${questionId}`

  return (
    <div className="field approval-question">
      {options.length ? (
        <>
          <span>{header}</span>
          {prompt ? <small>{prompt}</small> : null}
          <div className="approval-choice-grid" role="listbox" aria-label={header}>
            {options.map((option, index) => {
              const optionLabel = stringField(option.label)
              const optionDescription = stringField(option.description)
              const selected = value === optionLabel

              return (
                <button
                  aria-pressed={selected}
                  autoFocus={focusFirst && index === 0}
                  className={selected ? 'approval-choice approval-choice--selected' : 'approval-choice'}
                  key={`${questionId}-${optionLabel}`}
                  onClick={() => onChangeAnswer(approvalId, questionId, optionLabel)}
                  type="button"
                >
                  <strong>{optionLabel}</strong>
                  {optionDescription ? <span>{optionDescription}</span> : null}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <Input
          autoFocus={focusFirst}
          className="approval-question"
          hint={prompt}
          id={inputId}
          label={header}
          onChange={(event) => onChangeAnswer(approvalId, questionId, event.target.value)}
          type={isSecret ? 'password' : 'text'}
          value={value}
        />
      )}
    </div>
  )
}

function CopyableMessageBody({
  source,
  tone,
  className,
  children,
}: CopyableMessageBodyProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [copyState, setCopyState] = useState<CopyMessageStatus>('idle')
  const canCopy = source.trim() !== ''
  const classNames = [
    'conversation-copyable',
    `conversation-copyable--${tone}`,
    isHovered || hasSelection || copyState !== 'idle' ? 'conversation-copyable--active' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  useEffect(() => {
    if (!canCopy) {
      return
    }

    function syncSelectionState() {
      setHasSelection(selectionBelongsToContainer(containerRef.current))
    }

    syncSelectionState()

    return subscribeToSelectionChange(syncSelectionState)
  }, [canCopy])

  useEffect(() => {
    if (copyState === 'idle' || typeof window === 'undefined') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      setCopyState('idle')
    }, 1_200)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [copyState])

  async function handleCopy() {
    const copied = await writeTextToClipboard(source)
    setCopyState(copied ? 'copied' : 'error')
  }

  const copyLabel =
    copyState === 'copied'
      ? i18n._({ id: 'renderers.copiedSourceMessage', message: 'Copied source message' })
      : copyState === 'error'
        ? i18n._({ id: 'renderers.copyFailed', message: 'Copy failed' })
        : i18n._({ id: 'renderers.copySourceMessage', message: 'Copy source message' })
  const buttonClassName =
    copyState === 'copied'
      ? 'conversation-copy-button conversation-copy-button--copied'
      : copyState === 'error'
        ? 'conversation-copy-button conversation-copy-button--error'
        : 'conversation-copy-button'

  return (
    <div
      className={classNames}
      onPointerEnter={() => setIsHovered(true)}
      onPointerLeave={() => setIsHovered(false)}
      ref={containerRef}
    >
      {children}
      {canCopy ? (
        <button
          aria-label={copyLabel}
          className={buttonClassName}
          onClick={() => void handleCopy()}
          onMouseDown={(event) => event.preventDefault()}
          title={copyLabel}
          type="button"
        >
          <CopyMessageStatusIcon state={copyState} />
        </button>
      ) : null}
    </div>
  )
}

function CopyMessageStatusIcon({ state }: CopyMessageStatusIconProps) {
  if (state === 'copied') {
    return <CopySuccessIcon />
  }

  if (state === 'error') {
    return <CopyErrorIcon />
  }

  return <CopyMessageIcon />
}

function ExpandableThreadMessage({
  content,
  onReleaseFullContent,
  onRetainFullContent,
  onRequestFullContent,
  summaryTruncated,
  tone,
}: ExpandableThreadMessageProps) {
  const shouldCollapse = summaryTruncated || content.length > EXPANDABLE_MESSAGE_THRESHOLD_CHARS
  const [isExpanded, setIsExpanded] = useState(!shouldCollapse)
  const [isRequestingFullContent, setIsRequestingFullContent] = useState(false)
  const previousContentRef = useRef(content)
  const retainedFullContentRef = useRef(false)

  function releaseRetainedFullContent() {
    if (!retainedFullContentRef.current) {
      return
    }

    retainedFullContentRef.current = false
    onReleaseFullContent?.()
  }

  function handleCollapse() {
    setIsExpanded(false)
    setIsRequestingFullContent(false)
    releaseRetainedFullContent()
  }

  useEffect(() => {
    const contentChanged = previousContentRef.current !== content
    previousContentRef.current = content

    if (isRequestingFullContent && !summaryTruncated && contentChanged) {
      setIsExpanded(true)
      setIsRequestingFullContent(false)
      return
    }

    if (!contentChanged) {
      return
    }

    setIsExpanded(!shouldCollapse)
  }, [content, isRequestingFullContent, shouldCollapse, summaryTruncated])

  useEffect(() => {
    if (!summaryTruncated) {
      setIsRequestingFullContent(false)
    }
  }, [summaryTruncated])

  async function handleExpand() {
    if (summaryTruncated && onRequestFullContent) {
      if (!retainedFullContentRef.current) {
        retainedFullContentRef.current = true
        onRetainFullContent?.()
      }
      setIsRequestingFullContent(true)
      onRequestFullContent()
      return
    }

    setIsExpanded(true)
  }

  useEffect(() => {
    if (!isExpanded || !retainedFullContentRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      handleCollapse()
    }, FULL_TURN_OVERRIDE_TTL_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isExpanded])

  useEffect(
    () => () => {
      releaseRetainedFullContent()
    },
    [],
  )

  if (!shouldCollapse) {
    return <ThreadMarkdown content={content} />
  }

  const preview = `${content.slice(0, EXPANDABLE_MESSAGE_PREVIEW_CHARS).trimEnd()}\n…`

  return (
    <div className="conversation-message-preview">
      {isExpanded ? <ThreadMarkdown content={content} /> : <ThreadPlainText content={preview} />}
      <button
        className={
          tone === 'user'
            ? 'conversation-message-preview__toggle conversation-message-preview__toggle--user'
            : 'conversation-message-preview__toggle'
        }
        disabled={isRequestingFullContent}
        onClick={() => void (isExpanded ? handleCollapse() : handleExpand())}
        type="button"
      >
        {isExpanded
          ? i18n._({ id: 'renderers.showLess', message: 'Show less' })
          : isRequestingFullContent
            ? i18n._({ id: 'renderers.loadingFullMessage', message: 'Loading full message…' })
            : i18n._({ id: 'renderers.showFullMessage', message: 'Show full message' })}
      </button>
    </div>
  )
}

function CopyMessageIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <rect height="11" rx="2.2" stroke="currentColor" strokeWidth="1.7" width="10.5" x="9" y="7" />
      <path
        d="M7 15H6.2A2.2 2.2 0 0 1 4 12.8V6.2A2.2 2.2 0 0 1 6.2 4h6.6A2.2 2.2 0 0 1 15 6.2V7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  )
}

function CopySuccessIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <path
        d="m6.5 12.5 3.3 3.3 7.7-8.3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  )
}

function CopyErrorIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="16" viewBox="0 0 24 24" width="16">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 8.4v5.1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
      <circle cx="12" cy="16.9" fill="currentColor" r="1.1" />
    </svg>
  )
}

function CompactSystemStatusIcon({ tone }: CompactSystemStatusIconProps) {
  if (tone === 'success') {
    return (
      <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
        <path
          d="m6.5 12.5 3.3 3.3 7.7-8.3"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
        />
      </svg>
    )
  }

  if (tone === 'error') {
    return (
      <svg aria-hidden="true" fill="none" height="14" viewBox="0 0 24 24" width="14">
        <path d="m8 8 8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        <path d="m16 8-8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
      </svg>
    )
  }

  return (
    <svg aria-hidden="true" className="conversation-card__status-spinner" fill="none" height="14" viewBox="0 0 24 24" width="14">
      <circle cx="12" cy="12" opacity="0.28" r="8" stroke="currentColor" strokeWidth="2" />
      <path d="M12 4a8 8 0 0 1 8 8" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </svg>
  )
}

export function nextStreamingRevealLength(
  currentLength: number,
  targetLength: number,
  elapsedMs: number,
) {
  if (targetLength <= currentLength) {
    return targetLength
  }

  const normalizedElapsedMs =
    Number.isFinite(elapsedMs) && elapsedMs > 0
      ? elapsedMs
      : STREAMING_TYPEWRITER_FALLBACK_FRAME_MS
  const backlog = targetLength - currentLength
  const timeBasedStep = Math.ceil(
    (normalizedElapsedMs / 1_000) * STREAMING_TYPEWRITER_CHARACTERS_PER_SECOND,
  )
  const catchUpStep = Math.ceil(backlog / 18)
  const step = Math.max(
    1,
    Math.min(STREAMING_TYPEWRITER_MAX_STEP, Math.max(timeBasedStep, catchUpStep)),
  )

  return Math.min(targetLength, currentLength + step)
}

function initialStreamingRevealLength(targetLength: number) {
  if (typeof window === 'undefined') {
    return targetLength
  }

  return nextStreamingRevealLength(0, targetLength, STREAMING_TYPEWRITER_FALLBACK_FRAME_MS)
}

function cancelStreamingFrame(
  frameRef: { current: number | null },
  lastTimestampRef: { current: number | null },
) {
  if (frameRef.current !== null) {
    window.cancelAnimationFrame(frameRef.current)
    frameRef.current = null
  }
  lastTimestampRef.current = null
}

function StreamingAgentMessage({ content }: { content: string }) {
  const initialVisibleLength = initialStreamingRevealLength(content.length)
  const [visibleLength, setVisibleLength] = useState(initialVisibleLength)
  const contentRef = useRef(content)
  const targetLengthRef = useRef(content.length)
  const visibleLengthRef = useRef(initialVisibleLength)
  const previousContentRef = useRef(content)
  const frameRef = useRef<number | null>(null)
  const lastTimestampRef = useRef<number | null>(null)

  useEffect(() => {
    visibleLengthRef.current = visibleLength
  }, [visibleLength])

  useEffect(() => {
    return () => {
      cancelStreamingFrame(frameRef, lastTimestampRef)
    }
  }, [])

  useEffect(() => {
    const previousContent = previousContentRef.current
    previousContentRef.current = content
    contentRef.current = content
    targetLengthRef.current = content.length

    const isContentReset =
      content.length < visibleLengthRef.current ||
      (Boolean(previousContent) && !content.startsWith(previousContent))

    if (isContentReset) {
      cancelStreamingFrame(frameRef, lastTimestampRef)
      visibleLengthRef.current = content.length
      setVisibleLength(content.length)
      return
    }

    if (content.length <= visibleLengthRef.current || frameRef.current !== null) {
      return
    }

    const advance = (timestamp: number) => {
      const elapsedMs =
        lastTimestampRef.current === null
          ? STREAMING_TYPEWRITER_FALLBACK_FRAME_MS
          : timestamp - lastTimestampRef.current
      lastTimestampRef.current = timestamp

      const nextLength = nextStreamingRevealLength(
        visibleLengthRef.current,
        targetLengthRef.current,
        elapsedMs,
      )
      visibleLengthRef.current = nextLength
      setVisibleLength(nextLength)

      if (nextLength >= targetLengthRef.current) {
        frameRef.current = null
        lastTimestampRef.current = null
        return
      }

      frameRef.current = window.requestAnimationFrame(advance)
    }

    frameRef.current = window.requestAnimationFrame(advance)
  }, [content])

  const visibleContent =
    visibleLength >= contentRef.current.length
      ? contentRef.current
      : contentRef.current.slice(0, visibleLength)

  return <ThreadPlainText content={visibleContent} />
}

function TimelineItem({
  item,
  onReleaseFullTurn,
  onRetainFullTurn,
  onRequestFullTurn,
  onRetryServerRequest,
  showStreamingCursor = false,
  turnId,
}: TimelineItemProps) {
  const type = stringField(item.type)
  const itemId = stringField(item.id) || undefined
  const summaryTruncated = booleanField(item.summaryTruncated) === true

  switch (type) {
    case 'userMessage': {
      const text = sanitizeThreadMarkdownContent(userMessageText(item))

      if (!text) {
        logSuppressedTimelineItem(item, turnId, 'userMessage without text')
        return null
      }

      return (
        <article className="conversation-row conversation-row--user">
          <div className="conversation-bubble conversation-bubble--user">
            <CopyableMessageBody className="conversation-bubble__content" source={text} tone="user">
              <ExpandableThreadMessage
                content={text}
                onReleaseFullContent={
                  summaryTruncated ? () => onReleaseFullTurn?.(turnId, itemId) : undefined
                }
                onRetainFullContent={
                  summaryTruncated ? () => onRetainFullTurn?.(turnId, itemId) : undefined
                }
                onRequestFullContent={
                  summaryTruncated ? () => onRequestFullTurn?.(turnId, itemId) : undefined
                }
                summaryTruncated={summaryTruncated}
                tone="user"
              />
            </CopyableMessageBody>
          </div>
        </article>
      )
    }
    case 'agentMessage': {
      const text = stringField(item.text)
      const phase = stringField(item.phase)
      const clientRenderMode = stringField(item.clientRenderMode)
      const isStreaming = phase === 'streaming'
      const sanitizedText = isStreaming ? text : sanitizeThreadMarkdownContent(text)
      const shouldAnimateCompletedMessage =
        clientRenderMode === 'animate-once' && sanitizedText !== ''
      const hasStreamingPresentation = isStreaming || shouldAnimateCompletedMessage

      if (!sanitizedText) {
        if (!isStreaming) {
          logSuppressedTimelineItem(item, turnId, 'agentMessage without text')
          return null
        }

        logTimelinePlaceholderItem(item, turnId, 'agentMessage streaming placeholder')

        return (
          <article className="conversation-row conversation-row--assistant">
            <div className="conversation-bubble conversation-bubble--assistant conversation-bubble--streaming">
              <div className="conversation-bubble__content">
                <span className="conversation-card__placeholder">
                  {i18n._({ id: 'Thinking…', message: 'Thinking…' })}
                </span>
                {showStreamingCursor ? (
                  <span aria-hidden="true" className="conversation-bubble__cursor" />
                ) : null}
              </div>
            </div>
          </article>
        )
      }

      return (
        <article className="conversation-row conversation-row--assistant">
          <div
            className={
              hasStreamingPresentation
                ? 'conversation-bubble conversation-bubble--assistant conversation-bubble--streaming'
                : 'conversation-bubble conversation-bubble--assistant'
            }
          >
            <CopyableMessageBody className="conversation-bubble__content" source={sanitizedText} tone="assistant">
              {sanitizedText ? (
                shouldAnimateCompletedMessage ? (
                  <StreamingAgentMessage content={sanitizedText} />
                ) : isStreaming ? (
                  // True streaming content is already chunked by the backend.
                  // Rendering it immediately avoids a second local typewriter lag.
                  <ThreadPlainText content={sanitizedText} />
                ) : (
                  <ExpandableThreadMessage
                    content={sanitizedText}
                    onReleaseFullContent={
                      summaryTruncated ? () => onReleaseFullTurn?.(turnId, itemId) : undefined
                    }
                    onRetainFullContent={
                      summaryTruncated ? () => onRetainFullTurn?.(turnId, itemId) : undefined
                    }
                    onRequestFullContent={
                      summaryTruncated ? () => onRequestFullTurn?.(turnId, itemId) : undefined
                    }
                    summaryTruncated={summaryTruncated}
                    tone="assistant"
                  />
                )
              ) : null}
              {showStreamingCursor ? (
                <span aria-hidden="true" className="conversation-bubble__cursor" />
              ) : null}
            </CopyableMessageBody>
          </div>
        </article>
      )
    }
    case 'commandExecution': {
      const command = stringField(item.command)
      const output = stringField(item.aggregatedOutput)
      const outputContentMode = stringField(item.outputContentMode)
      const outputStartLine = integerField(item.outputStartLine)
      const outputEndLine = integerField(item.outputEndLine)
      const outputTotalLength = integerField(item.outputTotalLength)
      const outputLineCount = integerField(item.outputLineCount)
      const status = stringField(item.status)
      const showLoadLatestOutput =
        summaryTruncated && outputContentMode === 'summary' && itemId
      const showLoadFullOutput =
        summaryTruncated && outputContentMode === 'tail' && itemId
      const remainingOutputLines =
        typeof outputStartLine === 'number' && outputStartLine > 0
          ? outputStartLine
          : 0
      const loadedOutputLines =
        typeof outputStartLine === 'number' &&
        typeof outputEndLine === 'number' &&
        outputEndLine >= outputStartLine
          ? outputEndLine - outputStartLine
          : outputLineCount ?? countOutputLines(output)

      if (!command && !output && !status) {
        logSuppressedTimelineItem(item, turnId, 'commandExecution without command/output/status')
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--command"
          deferDetailsUntilOpen
          meta={outputLineLabel(output, outputLineCount) ?? undefined}
          onReleaseFullContent={
            summaryTruncated ? () => onReleaseFullTurn?.(turnId, itemId) : undefined
          }
          onRetainFullContent={
            summaryTruncated ? () => onRetainFullTurn?.(turnId, itemId) : undefined
          }
          onRequestFullContent={
            summaryTruncated ? () => onRequestFullTurn?.(turnId, itemId) : undefined
          }
          statusTone={statusToneFromValue(status)}
          summaryTruncated={summaryTruncated}
          summary={truncateMiddle(command || i18n._({ id: 'renderers.commandExecution', message: 'Command execution' }), 88)}
          title={i18n._({ id: "Command", message: "Command" })}
        >
          {command ? <code className="conversation-card__command-line">{command}</code> : null}
          {output ? (
            <ThreadTerminalBlock
              className="conversation-card__output conversation-card__output--terminal"
              content={output}
            />
          ) : (
            <div className="conversation-card__placeholder">{i18n._({ id: "Waiting for output.", message: "Waiting for output." })}</div>
          )}
          {showLoadLatestOutput ? (
            <>
              <div className="conversation-card__placeholder">
                {i18n._({ id: "Showing an expanded preview. Load the latest output window if you need more recent context without pulling the entire command result.", message: "Showing an expanded preview. Load the latest output window if you need more recent context without pulling the entire command result." })}
              </div>
              <div className="conversation-tool-call__actions">
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => onRequestFullTurn?.(turnId, itemId)}
                  type="button"
                >
                  {i18n._({ id: "Load latest output", message: "Load latest output" })}
                </button>
              </div>
            </>
          ) : null}
          {showLoadFullOutput ? (
            <>
              <div className="conversation-card__placeholder">
                {remainingOutputLines > 0
                  ? i18n._({ id: 'renderers.showingRecentLinesLoadEarlier', message: 'Showing {loadedLines} recent lines. Load earlier output to reveal {remainingLines} more lines.', values: { loadedLines: formatApproximateCount(loadedOutputLines), remainingLines: formatApproximateCount(remainingOutputLines) } })
                  : outputTotalLength && output.length < outputTotalLength
                    ? i18n._({ id: 'renderers.showingLatestLoadEarlier', message: 'Showing the latest output window. Load earlier output to reveal more command history.' })
                    : i18n._({ id: 'renderers.showingLatestOutputWindow', message: 'Showing the latest output window.' })}
              </div>
              <div className="conversation-tool-call__actions">
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => onRequestFullTurn?.(turnId, itemId)}
                  type="button"
                >
                  {i18n._({ id: "Load earlier output", message: "Load earlier output" })}
                </button>
              </div>
            </>
          ) : null}
        </SystemTimelineCard>
      )
    }
    case 'turnPlan': {
      const turnPlan = readTurnPlanItem(item)
      const steps = turnPlan?.steps ?? []
      const explanation = turnPlan?.explanation ?? ''

      if (!steps.length && !explanation) {
        logSuppressedTimelineItem(item, turnId, 'turnPlan without content')
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--plan"
          meta={turnPlanProgressMeta(steps)}
          statusTone={turnPlanStatusTone(turnPlan)}
          summary={turnPlanCardSummary(explanation, steps)}
          title={i18n._({ id: "Plan", message: "Plan" })}
        >
          {explanation ? <p className="conversation-plan__explanation">{explanation}</p> : null}
          {steps.length ? (
            <ol className="conversation-plan">
              {steps.map((entry, index) => (
                <li
                  className={`conversation-plan__step conversation-plan__step--${turnPlanStepClassName(entry.status)}`}
                  key={`${entry.step}-${index}`}
                >
                  <span className="conversation-plan__index">{index + 1}</span>
                  <span className="conversation-plan__body">
                    <span className="conversation-plan__text">{entry.step}</span>
                  </span>
                  <span
                    className={`detail-badge detail-badge--${turnPlanStepBadgeTone(entry.status)} conversation-plan__status`}
                  >
                    {turnPlanStepStatusLabel(entry.status)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </SystemTimelineCard>
      )
    }
    case 'plan': {
      const steps = planSteps(item)

      if (!steps.length) {
        logSuppressedTimelineItem(item, turnId, 'plan without steps')
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--plan"
          meta={i18n._({ id: 'renderers.stepCount', message: '{count, plural, one {# step} other {# steps}}', values: { count: steps.length } })}
          summary={planCardSummary(steps)}
          title={i18n._({ id: "Plan", message: "Plan" })}
        >
          <ol className="conversation-plan">
            {steps.map((step, index) => (
              <li className="conversation-plan__step conversation-plan__step--pending" key={index}>
                <span className="conversation-plan__index">{index + 1}</span>
                <span className="conversation-plan__body">
                  <span className="conversation-plan__text">{step}</span>
                </span>
              </li>
            ))}
          </ol>
        </SystemTimelineCard>
      )
    }
    case 'fileChange': {
      const changes = fileChanges(item)

      if (!changes.length) {
        logSuppressedTimelineItem(item, turnId, 'fileChange without changes')
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--file"
          meta={fileCountLabel(changes.length)}
          summary={fileChangeCardSummary(changes)}
          title={i18n._({ id: 'Files', message: 'Files' })}
        >
          <ul className="conversation-file-list">
            {changes.map((change, index) => (
              <li className="conversation-file-list__item" key={`${change.path || 'file'}-${index}`}>
                <strong dir="auto">{change.path || i18n._({ id: 'Unknown file', message: 'Unknown file' })}</strong>
                {change.kind ? <span>{change.kind}</span> : null}
              </li>
            ))}
          </ul>
        </SystemTimelineCard>
      )
    }
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
      return (
        <ToolCallTimelineCard
          item={item}
          onReleaseFullTurn={onReleaseFullTurn}
          onRetainFullTurn={onRetainFullTurn}
          onRequestFullTurn={onRequestFullTurn}
          turnId={turnId}
        />
      )
    case 'webSearch':
      return <WebSearchTimelineCard item={item} />
    case 'serverRequest':
      return (
        <ServerRequestTimelineCard
          item={item}
          onReleaseFullTurn={onReleaseFullTurn}
          onRetainFullTurn={onRetainFullTurn}
          onRequestFullTurn={onRequestFullTurn}
          onRetry={onRetryServerRequest}
          turnId={turnId}
        />
      )
    case 'reasoning': {
      const summaryText = reasoningSummaryText(item)
      const contentText = reasoningContentText(item)

      if (!summaryText && !contentText) {
        logTimelinePlaceholderItem(item, turnId, 'reasoning placeholder')
        return (
          <SystemTimelineCard
            className="conversation-card--reasoning"
            summary={i18n._({
              id: 'Awaiting reasoning content',
              message: 'Awaiting reasoning content',
            })}
            title={i18n._({ id: 'Reasoning', message: 'Reasoning' })}
          >
            <div className="conversation-card__placeholder">
              {i18n._({ id: 'Thinking…', message: 'Thinking…' })}
            </div>
          </SystemTimelineCard>
        )
      }

      return (
        <SystemTimelineCard
          className="conversation-card--reasoning"
          summary={reasoningCardSummary(item)}
          title={i18n._({ id: 'Reasoning', message: 'Reasoning' })}
        >
          {summaryText ? (
            <div className="conversation-tool-call__section">
              <div className="conversation-tool-call__section-header">
                <strong>{i18n._({ id: 'Summary', message: 'Summary' })}</strong>
              </div>
              <ThreadPlainText
                className="conversation-tool-call__text"
                content={summaryText}
              />
            </div>
          ) : null}
          {contentText ? (
            <div className="conversation-tool-call__section">
              <div className="conversation-tool-call__section-header">
                <strong>{i18n._({ id: 'Content', message: 'Content' })}</strong>
              </div>
              <ThreadPlainText
                className="conversation-tool-call__text"
                content={contentText}
              />
            </div>
          ) : null}
        </SystemTimelineCard>
      )
    }
    default: {
      const text = sanitizeThreadMarkdownContent(stringField(item.text) || stringField(item.message))

      if (!text) {
        logSuppressedTimelineItem(item, turnId, `${type || 'unknown'} without text`)
        return null
      }

      return (
        <SystemTimelineCard
          summary={truncateSingleLine(text, 104)}
          title={humanizeItemType(type || 'message')}
        >
          <CopyableMessageBody className="conversation-card__content" source={text} tone="system">
            <ThreadMarkdown content={text} />
          </CopyableMessageBody>
        </SystemTimelineCard>
      )
    }
  }
}

const MemoTimelineItem = memo(TimelineItem, (previous, next) => {
  return (
    previous.item === next.item &&
    previous.onReleaseFullTurn === next.onReleaseFullTurn &&
    previous.onRequestFullTurn === next.onRequestFullTurn &&
    previous.onRetainFullTurn === next.onRetainFullTurn &&
    previous.onRetryServerRequest === next.onRetryServerRequest &&
    previous.showStreamingCursor === next.showStreamingCursor &&
    previous.turnId === next.turnId
  )
})

function SystemTimelineCard({
  className,
  deferDetailsUntilOpen,
  onReleaseFullContent,
  onRetainFullContent,
  onRequestFullContent,
  summaryTruncated,
  title,
  summary,
  meta,
  statusTone,
  children,
}: SystemTimelineCardProps) {
  const [isOpen, setIsOpen] = useState(false)
  const detailsRef = useRef<HTMLDetailsElement | null>(null)
  const requestedFullContentRef = useRef(false)
  const shouldRenderDetails = !deferDetailsUntilOpen || isOpen

  useEffect(() => {
    if (
      !isOpen ||
      !summaryTruncated ||
      !onRequestFullContent ||
      requestedFullContentRef.current
    ) {
      return
    }

    requestedFullContentRef.current = true
    onRetainFullContent?.()
    onRequestFullContent()
  }, [isOpen, onRequestFullContent, onRetainFullContent, summaryTruncated])

  useEffect(() => {
    if (!summaryTruncated) {
      requestedFullContentRef.current = false
    }
  }, [summaryTruncated])

  useEffect(() => {
    if (isOpen || !onReleaseFullContent || !requestedFullContentRef.current) {
      return
    }

    requestedFullContentRef.current = false
    onReleaseFullContent()
  }, [isOpen, onReleaseFullContent])

  useEffect(() => {
    if (!isOpen || !requestedFullContentRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      if (detailsRef.current) {
        detailsRef.current.open = false
      }
      requestedFullContentRef.current = false
      onReleaseFullContent?.()
      setIsOpen(false)
    }, FULL_TURN_OVERRIDE_TTL_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isOpen, onReleaseFullContent])

  return (
    <article className="conversation-row conversation-row--system">
      <details
        className={
          className
            ? `conversation-card conversation-card--compact ${className}`
            : 'conversation-card conversation-card--compact'
        }
        ref={detailsRef}
        onToggle={(event) =>
          setIsOpen((event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary className="conversation-card__summary">
          <div className="conversation-card__summary-copy">
            <strong>{title}</strong>
            <span>{summary}</span>
          </div>
          <div className="conversation-card__summary-meta">
            {meta ? <span className="conversation-card__meta-pill">{meta}</span> : null}
            {statusTone ? (
              <span className={`conversation-card__status conversation-card__status--${statusTone}`}>
                <CompactSystemStatusIcon tone={statusTone} />
              </span>
            ) : null}
            <span aria-hidden="true" className="conversation-card__toggle" />
          </div>
        </summary>
        {shouldRenderDetails ? <div className="conversation-card__details">{children}</div> : null}
      </details>
    </article>
  )
}

function WebSearchTimelineCard({
  item,
}: {
  item: Record<string, unknown>
}) {
  const actionType = webSearchActionType(item)
  const actionLabel = webSearchActionLabel(actionType)
  const queries = webSearchQueries(item)
  const url = webSearchURL(item)
  const pattern = webSearchPattern(item)
  const summary =
    webSearchCardSummary(item) ||
    i18n._({ id: 'Web search activity', message: 'Web search activity' })
  const meta = actionLabel || undefined

  return (
    <SystemTimelineCard
      className="conversation-card--tool"
      meta={meta}
      summary={summary}
      title={i18n._({ id: 'Web Search', message: 'Web Search' })}
    >
      <div className="conversation-tool-call__meta-grid">
        <div className="conversation-tool-call__meta-row">
          <span>{i18n._({ id: 'Action', message: 'Action' })}</span>
          <strong>{actionLabel || i18n._({ id: 'Web Search', message: 'Web Search' })}</strong>
        </div>
        {queries.length ? (
          <div className="conversation-tool-call__meta-row">
            <span>{queries.length === 1 ? i18n._({ id: 'Query', message: 'Query' }) : i18n._({ id: 'Queries', message: 'Queries' })}</span>
            <strong>{queries.length === 1 ? queries[0] : queryCountLabel(queries.length)}</strong>
          </div>
        ) : null}
        {url ? (
          <div className="conversation-tool-call__meta-row">
            <span>{i18n._({ id: 'Target', message: 'Target' })}</span>
            <strong>{url}</strong>
          </div>
        ) : null}
        {pattern ? (
          <div className="conversation-tool-call__meta-row">
            <span>{i18n._({ id: 'Pattern', message: 'Pattern' })}</span>
            <strong>{pattern}</strong>
          </div>
        ) : null}
      </div>
      {queries.length ? (
        <div className="conversation-tool-call__section">
          <div className="conversation-tool-call__section-header">
            <strong>
              {queries.length === 1
                ? i18n._({ id: 'Query', message: 'Query' })
                : i18n._({ id: 'Queries', message: 'Queries' })}
            </strong>
          </div>
          <div className="conversation-tool-call__structured">
            {queries.map((query, index) => (
              <div className="conversation-tool-call__subsection" key={`${query}-${index}`}>
                {queries.length > 1 ? (
                  <span className="conversation-tool-call__subsection-label">
                    {i18n._({
                      id: 'Query {index}',
                      message: 'Query {index}',
                      values: { index: index + 1 },
                    })}
                  </span>
                ) : null}
                <ThreadPlainText
                  className="conversation-tool-call__text"
                  content={query}
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {pattern ? (
        <div className="conversation-tool-call__section">
          <div className="conversation-tool-call__section-header">
            <strong>{i18n._({ id: 'Pattern', message: 'Pattern' })}</strong>
          </div>
          <ThreadPlainText
            className="conversation-tool-call__text"
            content={pattern}
          />
        </div>
      ) : null}
      {url ? (
        <div className="conversation-tool-call__section">
          <div className="conversation-tool-call__section-header">
            <strong>{i18n._({ id: 'Page', message: 'Page' })}</strong>
          </div>
          <a
            className="conversation-tool-call__link"
            href={url}
            rel="noreferrer noopener"
            target="_blank"
          >
            {url}
          </a>
        </div>
      ) : null}
    </SystemTimelineCard>
  )
}

function ToolCallTimelineCard({
  item,
  onReleaseFullTurn,
  onRetainFullTurn,
  onRequestFullTurn,
  turnId,
}: ToolCallTimelineCardProps) {
  const type = stringField(item.type)
  const tool = stringField(item.tool) || humanizeItemType(type)
  const status = stringField(item.status)
  const server = stringField(item.server)
  const prompt = stringField(item.prompt)
  const model = stringField(item.model)
  const reasoningEffort = stringField(item.reasoningEffort)
  const senderThreadId = stringField(item.senderThreadId)
  const receiverThreadIds = stringArray(item.receiverThreadIds)
  const durationMs = integerField(item.durationMs)
  const success = booleanField(item.success)
  const title =
    type === 'mcpToolCall'
      ? i18n._({ id: 'renderers.mcpToolCall', message: 'MCP Tool Call' })
      : type === 'collabAgentToolCall'
        ? i18n._({ id: 'renderers.agentToolCall', message: 'Agent Tool Call' })
      : i18n._({ id: 'renderers.toolCall', message: 'Tool Call' })
  const statusTone =
    success === true ? 'success' : success === false ? 'error' : statusToneFromValue(status)
  const meta = compactMetaLabel(
    [server, model, durationMs !== null ? `${durationMs} ms` : '', reasoningEffort].filter(Boolean),
    2,
  )
  const itemId = stringField(item.id) || undefined
  const summaryTruncated = booleanField(item.summaryTruncated) === true

  const detailSections: ToolCallSection[] = [
    {
      label: i18n._({ id: "Arguments", message: "Arguments" }),
      value: item.arguments,
    },
  ]

  if (type === 'mcpToolCall' && hasMeaningfulValue(item.result)) {
    detailSections.push({
      label: i18n._({ id: "Result", message: "Result" }),
      value: item.result,
    })
  }

  if (type === 'dynamicToolCall' && hasMeaningfulValue(item.contentItems)) {
    detailSections.push({
      label: i18n._({ id: "Output", message: "Output" }),
      value: item.contentItems,
    })
  }

  if (type === 'collabAgentToolCall' && prompt) {
    detailSections.push({
      kind: 'text',
      label: i18n._({ id: "Prompt", message: "Prompt" }),
      value: prompt,
    })
  }

  if (type === 'collabAgentToolCall' && hasMeaningfulValue(item.agentsStates)) {
    detailSections.push({
      label: i18n._({ id: "Agent States", message: "Agent States" }),
      value: item.agentsStates,
    })
  }

  if (hasMeaningfulValue(item.error)) {
    detailSections.push({
      label: i18n._({ id: "Error", message: "Error" }),
      value: item.error,
      tone: 'danger',
    })
  }

  return (
    <SystemTimelineCard
      className="conversation-card--tool"
      deferDetailsUntilOpen
      meta={meta || undefined}
      onReleaseFullContent={
        summaryTruncated ? () => onReleaseFullTurn?.(turnId, itemId) : undefined
      }
      onRetainFullContent={
        summaryTruncated ? () => onRetainFullTurn?.(turnId, itemId) : undefined
      }
      onRequestFullContent={
        summaryTruncated ? () => onRequestFullTurn?.(turnId, itemId) : undefined
      }
      statusTone={statusTone}
      summaryTruncated={summaryTruncated}
      summary={truncateSingleLine([tool, toolCallSummary(item)].filter(Boolean).join(' · '), 112)}
      title={title}
    >
      {senderThreadId || receiverThreadIds.length ? (
        <div className="conversation-tool-call__meta-grid">
          {senderThreadId ? (
            <div className="conversation-tool-call__meta-row">
              <span>{i18n._({ id: "Sender", message: "Sender" })}</span>
              <strong>{senderThreadId}</strong>
            </div>
          ) : null}
          {receiverThreadIds.length ? (
            <div className="conversation-tool-call__meta-row">
              <span>{i18n._({ id: "Receivers", message: "Receivers" })}</span>
              <strong>{receiverThreadIds.join(', ')}</strong>
            </div>
          ) : null}
        </div>
      ) : null}
      {detailSections.map((section) => (
        <div className="conversation-tool-call__section" key={section.label}>
          <div className="conversation-tool-call__section-header">
            <strong>{section.label}</strong>
          </div>
          {section.kind === 'text' ? (
            <ThreadMarkdown
              className={
                section.tone === 'danger'
                  ? 'conversation-card__content conversation-tool-call__text conversation-tool-call__text--danger'
                  : 'conversation-card__content conversation-tool-call__text'
              }
              content={section.value}
            />
          ) : (
            <ToolCallSectionValue
              className={
                section.tone === 'danger'
                  ? 'conversation-tool-call__output conversation-tool-call__output--danger'
                  : 'conversation-tool-call__output'
              }
              tone={section.tone}
              value={section.value}
            />
          )}
        </div>
      ))}
    </SystemTimelineCard>
  )
}

function ServerRequestTimelineCard({
  item,
  onReleaseFullTurn,
  onRetainFullTurn,
  onRequestFullTurn,
  onRetry,
  turnId,
}: ServerRequestTimelineCardProps) {
  const requestKind = stringField(item.requestKind)
  const status = stringField(item.status) || 'pending'
  const details = asObject(item.details)
  const requestId = stringField(item.requestId)
  const expireReason = stringField(item.expireReason)
  const summary = summarizeServerRequest(requestKind, details)
  const metaPills = serverRequestMetaPills(requestKind, details)
  const statusTone = status === 'resolved' ? 'success' : status === 'expired' ? 'error' : 'running'
  const itemId = stringField(item.id) || undefined
  const summaryTruncated = booleanField(item.summaryTruncated) === true

  return (
    <SystemTimelineCard
      className="conversation-card--request"
      deferDetailsUntilOpen
      meta={compactMetaLabel(metaPills, 1) || undefined}
      onReleaseFullContent={
        summaryTruncated ? () => onReleaseFullTurn?.(turnId, itemId) : undefined
      }
      onRetainFullContent={
        summaryTruncated ? () => onRetainFullTurn?.(turnId, itemId) : undefined
      }
      onRequestFullContent={
        summaryTruncated ? () => onRequestFullTurn?.(turnId, itemId) : undefined
      }
      statusTone={statusTone}
      summaryTruncated={summaryTruncated}
      summary={summary}
      title={serverRequestTitle(requestKind)}
    >
      {requestId ? (
        <div className="conversation-tool-call__meta-grid">
          <div className="conversation-tool-call__meta-row">
            <span>{i18n._({ id: "Request", message: "Request" })}</span>
            <strong>{requestId}</strong>
          </div>
        </div>
      ) : null}
      {status === 'expired' ? (
        <div className="conversation-tool-call__section">
          <div className="conversation-tool-call__section-header">
            <strong>{i18n._({ id: "Status", message: "Status" })}</strong>
          </div>
          <div className="conversation-card__content conversation-tool-call__text conversation-tool-call__text--danger">
            {serverRequestExpiredMessage(expireReason)}
          </div>
          {onRetry ? (
            <div className="conversation-tool-call__actions">
              <button
                className="ide-button ide-button--secondary"
                onClick={() => onRetry(item)}
                type="button"
              >
                {i18n._({ id: "Retry In Composer", message: "Retry In Composer" })}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      {details.message ? (
        <div className="conversation-tool-call__section">
          <div className="conversation-tool-call__section-header">
            <strong>{i18n._({ id: "Message", message: "Message" })}</strong>
          </div>
          <ThreadMarkdown
            className="conversation-card__content conversation-tool-call__text"
            content={stringField(details.message)}
          />
        </div>
      ) : null}
      <div className="conversation-tool-call__section">
        <div className="conversation-tool-call__section-header">
          <strong>{i18n._({ id: "Payload", message: "Payload" })}</strong>
        </div>
        <ThreadCodeBlock
          className="conversation-card__output conversation-tool-call__output"
          content={safeJson(details)}
        />
      </div>
    </SystemTimelineCard>
  )
}

function ToolCallSectionValue({
  value,
  tone,
  className,
}: ToolCallSectionValueProps) {
  const commandOutput = readToolCallCommandOutput(value)
  if (commandOutput) {
    return (
      <div className="conversation-tool-call__structured">
        {commandOutput.fields.map((field, index) => (
          <div className="conversation-tool-call__subsection" key={`${field.label}-${index}`}>
            <span className="conversation-tool-call__subsection-label">{field.label}</span>
            {field.terminal ? (
              <ThreadTerminalBlock className={className} content={field.value} />
            ) : (
              <ThreadCodeBlock className={className} content={field.value} />
            )}
          </div>
        ))}
        {commandOutput.remaining ? (
          <ThreadCodeBlock className={className} content={safeJson(commandOutput.remaining)} />
        ) : null}
      </div>
    )
  }

  const contentItems = readToolCallContentItems(value)
  if (contentItems) {
    return (
      <div className="conversation-tool-call__content-items">
        {contentItems.map((item, index) => (
          <div className="conversation-tool-call__content-item" key={`${item.type}-${index}`}>
            <span className="conversation-tool-call__content-item-label">
              {humanizeItemType(item.type)}
            </span>
            {item.text ? (
              containsAnsiEscapeCode(item.text) ? (
                <ThreadTerminalBlock className={className} content={item.text} />
              ) : (
                <ThreadMarkdown
                  className={
                    tone === 'danger'
                      ? 'conversation-tool-call__text conversation-tool-call__text--danger'
                      : 'conversation-tool-call__text'
                  }
                  content={item.text}
                />
              )
            ) : item.imageUrl ? (
              <a
                className="conversation-tool-call__link"
                href={item.imageUrl}
                rel="noreferrer noopener"
                target="_blank"
              >
                {item.imageUrl}
              </a>
            ) : null}
          </div>
        ))}
      </div>
    )
  }

  const formattedValue = typeof value === 'string' ? value : safeJson(value)
  if (containsAnsiEscapeCode(formattedValue)) {
    return <ThreadTerminalBlock className={className} content={formattedValue} />
  }

  return <ThreadCodeBlock className={className} content={formattedValue} />
}

function readToolCallCommandOutput(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const object = value as Record<string, unknown>
  const fields: ToolCallCommandField[] = []
  const consumed = new Set<string>()

  function collect(key: string, label: string, terminal = false) {
    const text = stringField(object[key])
    if (!text) {
      return
    }

    fields.push({
      label,
      value: text,
      terminal: terminal || containsAnsiEscapeCode(text),
    })
    consumed.add(key)
  }

  collect('command', i18n._({ id: 'renderers.commandLabel', message: 'Command' }))
  collect('stdout', i18n._({ id: 'renderers.stdout', message: 'Stdout' }), true)
  collect('stderr', i18n._({ id: 'renderers.stderr', message: 'Stderr' }), true)
  collect('combinedOutput', i18n._({ id: 'renderers.output', message: 'Output' }), true)
  collect('aggregatedOutput', i18n._({ id: 'renderers.output', message: 'Output' }), true)
  if (!consumed.has('output')) {
    collect('output', i18n._({ id: 'renderers.output', message: 'Output' }), true)
  }
  if (!consumed.has('error')) {
    collect('error', i18n._({ id: 'renderers.errorLabel', message: 'Error' }), containsAnsiEscapeCode(stringField(object.error)))
  }

  if (!fields.length) {
    return null
  }

  const remaining = Object.fromEntries(
    Object.entries(object).filter(
      ([key, entryValue]) => !consumed.has(key) && hasMeaningfulValue(entryValue),
    ),
  )

  return {
    fields,
    remaining: Object.keys(remaining).length ? remaining : null,
  }
}

function readToolCallContentItems(value: unknown) {
  if (!Array.isArray(value) || !value.length) {
    return null
  }

  const items: ToolCallContentItem[] = []

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      return null
    }

    const item = entry as Record<string, unknown>
    const type = stringField(item.type)
    const text = stringField(item.text)
    const imageUrl = stringField(item.imageUrl)

    if (!type || (!text && !imageUrl)) {
      return null
    }

    items.push({
      type,
      text: text || undefined,
      imageUrl: imageUrl || undefined,
    })
  }

  return items.length === value.length ? items : null
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function integerField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

function booleanField(value: unknown) {
  return typeof value === 'boolean' ? value : null
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function approvalQuestions(details: Record<string, unknown>) {
  return Array.isArray(details.questions)
    ? details.questions.filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      )
    : []
}

function approvalQuestionOptions(question: Record<string, unknown>) {
  return Array.isArray(question.options)
    ? question.options.filter(
        (entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null,
      )
    : []
}

function approvalActionNeedsAnswers(action: string) {
  return action === 'accept' || action === 'accept_for_session'
}

function areApprovalQuestionsComplete(
  approvalId: string,
  questions: Record<string, unknown>[],
  approvalAnswers: Record<string, Record<string, string>>,
) {
  if (!questions.length) {
    return true
  }

  return questions.every((question) => {
    return isApprovalQuestionAnswered(approvalId, question, approvalAnswers)
  })
}

function isApprovalQuestionAnswered(
  approvalId: string,
  question: Record<string, unknown>,
  approvalAnswers: Record<string, Record<string, string>>,
) {
  const questionId = stringField(question.id)
  return Boolean(approvalAnswers[approvalId]?.[questionId]?.trim())
}

function buildApprovalAnswersPayload(
  approvalId: string,
  questions: Record<string, unknown>[],
  approvalAnswers: Record<string, Record<string, string>>,
  action: string,
) {
  if (!approvalActionNeedsAnswers(action) || !questions.length) {
    return undefined
  }

  return Object.fromEntries(
    questions.map((question) => {
      const questionId = stringField(question.id)
      return [questionId, [approvalAnswers[approvalId]?.[questionId] ?? '']]
    }),
  )
}

function formatApprovalActionLabel(action: string) {
  switch (action) {
    case 'accept':
      return i18n._({ id: 'renderers.approve', message: 'Approve' })
    case 'accept_for_session':
      return i18n._({ id: 'renderers.approveSession', message: 'Approve Session' })
    case 'decline':
      return i18n._({ id: 'renderers.decline', message: 'Decline' })
    case 'cancel':
      return i18n._({ id: 'renderers.cancel', message: 'Cancel' })
    default:
      return action
  }
}

function approvalDialogMeta(approval: PendingApproval, details: Record<string, unknown>) {
  switch (approval.kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval': {
      const command = stringField(details.command)
      return command ? [truncateMiddle(command, 72)] : [i18n._({ id: 'renderers.commandApproval', message: 'Command approval' })]
    }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval': {
      const path = stringField(details.path)
      if (path) {
        return [path]
      }

      if (Array.isArray(details.changes)) {
        return [i18n._({ id: 'renderers.fileChangeCount', message: '{count, plural, one {# file change} other {# file changes}}', values: { count: details.changes.length } })]
      }

      return [i18n._({ id: 'renderers.fileChanges', message: 'File changes' })]
    }
    case 'item/tool/requestUserInput':
      return [i18n._({ id: 'renderers.questionCount', message: '{count, plural, one {# question} other {# questions}}', values: { count: approvalDialogQuestionCount(details) } })]
    case 'item/permissions/requestApproval':
      return [i18n._({ id: 'renderers.permissionsEscalation', message: 'Permissions escalation' }), i18n._({ id: 'renderers.scopeTurn', message: 'Scope: turn' })]
    case 'mcpServer/elicitation/request': {
      const serverName = stringField(details.serverName)
      return serverName ? [i18n._({ id: 'renderers.serverName', message: 'Server: {serverName}', values: { serverName } })] : [i18n._({ id: 'renderers.mcpInput', message: 'MCP input' })]
    }
    case 'item/tool/call': {
      const tool = stringField(details.tool)
      return tool ? [i18n._({ id: 'renderers.toolName', message: 'Tool: {tool}', values: { tool } })] : [i18n._({ id: 'renderers.dynamicToolCall', message: 'Dynamic tool call' })]
    }
    default:
      return []
  }
}

function approvalDialogQuestionCount(details: Record<string, unknown>) {
  return approvalQuestions(details).length
}

function truncateMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  const visible = maxLength - 3
  const left = Math.ceil(visible / 2)
  const right = Math.floor(visible / 2)
  return `${value.slice(0, left)}...${value.slice(value.length - right)}`
}

function focusableDialogElements(container: HTMLElement | null) {
  if (!container) {
    return []
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute('aria-hidden'))
}

function focusFirstDialogElement(container: HTMLElement | null) {
  focusableDialogElements(container)[0]?.focus()
}

function trapDialogFocus(event: ReactKeyboardEvent<HTMLElement>, container: HTMLElement | null) {
  const elements = focusableDialogElements(container)
  if (!elements.length) {
    return
  }

  const firstElement = elements[0]
  const lastElement = elements[elements.length - 1]
  const activeElement = document.activeElement

  if (event.shiftKey && activeElement === firstElement) {
    event.preventDefault()
    lastElement.focus()
    return
  }

  if (!event.shiftKey && activeElement === lastElement) {
    event.preventDefault()
    firstElement.focus()
  }
}

function asObject(value: unknown) {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function userMessageText(item: Record<string, unknown>) {
  if (!Array.isArray(item.content)) return ''
  return item.content
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) return ''
      return stringField((entry as Record<string, unknown>).text)
    })
    .filter(Boolean)
    .join('\n')
}

function planSteps(item: Record<string, unknown>) {
  const text = stringField(item.text)
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
    .filter(Boolean)
}

function fileChanges(item: Record<string, unknown>) {
  if (!Array.isArray(item.changes)) {
    return []
  }

  return item.changes
    .map((entry) => {
      if (typeof entry !== 'object' || entry === null) {
        return { kind: '', path: '' }
      }

      const change = entry as Record<string, unknown>
      return {
        kind: patchKind(change.kind),
        path: stringField(change.path),
      }
    })
    .filter((change) => change.path || change.kind)
}

function patchKind(value: unknown) {
  if (typeof value !== 'object' || value === null) {
    return ''
  }

  return humanizeItemType(stringField((value as Record<string, unknown>).type))
}

function humanizeItemType(type: string) {
  return type
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function humanizeToolStatus(value: string) {
  return formatLocalizedStatusLabel(
    value,
    value
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/[-_]/g, ' ')
      .replace(/\binprogress\b/gi, 'in progress')
      .replace(/\b\w/g, (character) => character.toUpperCase()),
  )
}

function serverRequestTitle(kind: string) {
  switch (kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return i18n._({ id: 'Command Approval', message: 'Command Approval' })
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return i18n._({ id: 'File Change Approval', message: 'File Change Approval' })
    case 'item/tool/requestUserInput':
      return i18n._({ id: 'User Input Request', message: 'User Input Request' })
    case 'item/permissions/requestApproval':
      return i18n._({ id: 'Permissions Request', message: 'Permissions Request' })
    case 'mcpServer/elicitation/request':
      return i18n._({ id: 'MCP Input Request', message: 'MCP Input Request' })
    case 'item/tool/call':
      return i18n._({ id: 'Tool Response Request', message: 'Tool Response Request' })
    case 'account/chatgptAuthTokens/refresh':
      return i18n._({ id: 'Auth Refresh Request', message: 'Auth Refresh Request' })
    default:
      return i18n._({ id: 'Server Request', message: 'Server Request' })
  }
}

function summarizeServerRequest(kind: string, details: Record<string, unknown>) {
  switch (kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return (
        stringField(details.command) ||
        i18n._({ id: 'Review the command request', message: 'Review the command request' })
      )
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return stringField(details.path) || summarizeChangeCount(details)
    case 'item/tool/requestUserInput': {
      const questionCount = Array.isArray(details.questions) ? details.questions.length : 0
      return questionCount
        ? i18n._({
            id: '{count} questions waiting for an answer',
            message: '{count} questions waiting for an answer',
            values: { count: questionCount },
          })
        : i18n._({ id: 'Provide input to continue', message: 'Provide input to continue' })
    }
    case 'item/permissions/requestApproval':
      return (
        stringField(details.reason) ||
        i18n._({
          id: 'Additional permissions were requested',
          message: 'Additional permissions were requested',
        })
      )
    case 'mcpServer/elicitation/request':
      return (
        stringField(details.message) ||
        stringField(details.serverName) ||
        i18n._({
          id: 'The MCP server is waiting for input',
          message: 'The MCP server is waiting for input',
        })
      )
    case 'item/tool/call':
      return (
        stringField(details.tool) ||
        i18n._({
          id: 'Provide output for the requested tool call',
          message: 'Provide output for the requested tool call',
        })
      )
    case 'account/chatgptAuthTokens/refresh':
      return (
        stringField(details.reason) ||
        i18n._({
          id: 'Refresh the account authentication tokens',
          message: 'Refresh the account authentication tokens',
        })
      )
    default:
      return (
        stringField(details.message) ||
        stringField(details.reason) ||
        i18n._({ id: 'Expand for request details', message: 'Expand for request details' })
      )
  }
}

function serverRequestExpiredMessage(reason: string) {
  switch (reason) {
    case 'runtime_closed':
      return i18n._({
        id: 'This request expired because the runtime connection was closed.',
        message: 'This request expired because the runtime connection was closed.',
      })
    case 'runtime_removed':
      return i18n._({
        id: 'This request expired because the workspace runtime was removed.',
        message: 'This request expired because the workspace runtime was removed.',
      })
    case 'request_unavailable':
      return i18n._({
        id: 'This request is no longer available. Re-run the action if it is still needed.',
        message: 'This request is no longer available. Re-run the action if it is still needed.',
      })
    default:
      return i18n._({
        id: 'This request is no longer available. Re-run the action if it is still needed.',
        message: 'This request is no longer available. Re-run the action if it is still needed.',
      })
  }
}

function serverRequestMetaPills(kind: string, details: Record<string, unknown>) {
  const pills: string[] = []

  if (kind === 'item/tool/call' && stringField(details.tool)) {
    pills.push(
      i18n._({
        id: 'Tool {tool}',
        message: 'Tool {tool}',
        values: { tool: stringField(details.tool) },
      }),
    )
  }
  if (kind === 'mcpServer/elicitation/request' && stringField(details.serverName)) {
    pills.push(
      i18n._({
        id: 'Server {server}',
        message: 'Server {server}',
        values: { server: stringField(details.serverName) },
      }),
    )
  }
  if (Array.isArray(details.questions) && details.questions.length > 0) {
    pills.push(questionCountLabel(details.questions.length))
  }
  if (Array.isArray(details.changes) && details.changes.length > 0) {
    pills.push(fileCountLabel(details.changes.length))
  }

  return pills
}

function summarizeChangeCount(details: Record<string, unknown>) {
  const changeCount = Array.isArray(details.changes) ? details.changes.length : 0
  return changeCount
    ? i18n._({
        id: '{count} file changes',
        message: '{count} file changes',
        values: { count: changeCount },
      })
    : i18n._({
        id: 'Review the requested file changes',
        message: 'Review the requested file changes',
      })
}

function compactMetaLabel(values: string[], limit = 2) {
  return values
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, limit)
    .join(' · ')
}

function fileCountLabel(count: number) {
  return count === 1
    ? i18n._({ id: '{count} file', message: '{count} file', values: { count } })
    : i18n._({ id: '{count} files', message: '{count} files', values: { count } })
}

function lineCountLabel(count: number) {
  return count === 1
    ? i18n._({ id: '{count} line', message: '{count} line', values: { count } })
    : i18n._({ id: '{count} lines', message: '{count} lines', values: { count } })
}

function questionCountLabel(count: number) {
  return count === 1
    ? i18n._({ id: '{count} question', message: '{count} question', values: { count } })
    : i18n._({ id: '{count} questions', message: '{count} questions', values: { count } })
}

function queryCountLabel(count: number) {
  return count === 1
    ? i18n._({ id: '{count} query', message: '{count} query', values: { count } })
    : i18n._({ id: '{count} queries', message: '{count} queries', values: { count } })
}

function targetThreadCountLabel(count: number) {
  return count === 1
    ? i18n._({
        id: '{count} target thread',
        message: '{count} target thread',
        values: { count },
      })
    : i18n._({
        id: '{count} target threads',
        message: '{count} target threads',
        values: { count },
      })
}

function outputLineLabel(output: string, lineCountOverride?: number | null) {
  const lineCount =
    typeof lineCountOverride === 'number' && lineCountOverride > 0
      ? lineCountOverride
      : countOutputLines(output)
  if (!lineCount) {
    return null
  }

  return lineCountLabel(lineCount)
}

function planCardSummary(steps: string[]) {
  if (!steps.length) {
    return i18n._({ id: 'No steps', message: 'No steps' })
  }

  return steps.length === 1
    ? truncateSingleLine(steps[0], 100)
    : `${truncateSingleLine(steps[0], 84)} +${steps.length - 1}`
}

function turnPlanCardSummary(explanation: string, steps: TurnPlanStep[]) {
  if (explanation) {
    return truncateSingleLine(explanation, 100)
  }

  const activeStep = steps.find((entry) => turnPlanNormalizedStatus(entry.status) !== 'completed')
  if (activeStep) {
    return truncateSingleLine(activeStep.step, 100)
  }

  if (!steps.length) {
    return i18n._({ id: 'No steps', message: 'No steps' })
  }

  return truncateSingleLine(steps[0].step, 100)
}

function collectTurnPlanStackEntries(turns: ThreadTurn[]): PlanStatusStackEntry[] {
  const entries: PlanStatusStackEntry[] = []

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]
    const turnItems = Array.isArray(turn.items) ? turn.items : []

    for (let itemIndex = turnItems.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = turnItems[itemIndex]
      const turnPlan = readTurnPlanItem(item)
      if (!turnPlan) {
        continue
      }
      if (!turnPlan.steps.length && !turnPlan.explanation) {
        continue
      }

      entries.push({
        key: `${turn.id}:${turnPlan.id || stringField(item.id) || itemIndex}`,
        turnId: turn.id,
        turnPlan,
      })
    }
  }

  return entries
}

function turnPlanProgressMeta(steps: TurnPlanStep[]) {
  if (!steps.length) {
    return i18n._({ id: 'renderers.zeroSteps', message: '0 steps' })
  }

  let completed = 0
  let active = 0
  let pending = 0

  for (const entry of steps) {
    switch (turnPlanNormalizedStatus(entry.status)) {
      case 'completed':
        completed += 1
        break
      case 'inprogress':
        active += 1
        break
      default:
        pending += 1
        break
    }
  }

  const parts = [i18n._({ id: 'renderers.stepCount', message: '{count, plural, one {# step} other {# steps}}', values: { count: steps.length } })]
  if (active) {
    parts.push(i18n._({ id: 'renderers.activeCount', message: '{count} active', values: { count: active } }))
  }
  if (completed) {
    parts.push(i18n._({ id: 'renderers.doneCount', message: '{count} done', values: { count: completed } }))
  }
  if (pending) {
    parts.push(i18n._({ id: 'renderers.pendingCount', message: '{count} pending', values: { count: pending } }))
  }
  return parts.join(' · ')
}

function turnPlanCompactProgressMeta(steps: TurnPlanStep[]) {
  if (!steps.length) {
    return i18n._({ id: 'renderers.zeroOfZeroDone', message: '0/0' })
  }

  let completed = 0

  for (const entry of steps) {
    if (turnPlanNormalizedStatus(entry.status) === 'completed') {
      completed += 1
    }
  }

  return i18n._({ id: 'renderers.completedOfTotal', message: '{completed}/{total} done', values: { completed, total: steps.length } })
}

function isTurnPlanCollapsedByDefault(turnPlan: TurnPlanItem | null) {
  return turnPlanNormalizedStatus(turnPlan?.status ?? '') === 'completed'
}

function fileChangeCardSummary(changes: Array<{ kind: string; path: string }>) {
  if (!changes.length) {
    return i18n._({ id: 'No files', message: 'No files' })
  }

  return changes.length === 1
    ? truncateMiddle(changes[0].path || i18n._({ id: 'Unknown file', message: 'Unknown file' }), 96)
    : `${truncateMiddle(changes[0].path || i18n._({ id: 'Unknown file', message: 'Unknown file' }), 80)} +${changes.length - 1}`
}

function summarizeCompactError(error: unknown) {
  const value = typeof error === 'string' ? error : safeJson(error)
  return truncateSingleLine(value, 112) || i18n._({ id: 'Runtime error', message: 'Runtime error' })
}

function truncateSingleLine(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, Math.max(0, maxLength - 1))}…`
}

function formatApproximateCount(value: number) {
  if (value < 1_000) {
    return `${value}`
  }

  if (value < 100_000) {
    return `${Math.round(value / 100) / 10}k`
  }

  return `${Math.round(value / 1_000)}k`
}

function statusToneFromValue(value: string): CompactSystemStatusTone | undefined {
  const normalized = value.toLowerCase().replace(/[\s_-]+/g, '')
  if (!normalized) {
    return undefined
  }

  if (['completed', 'complete', 'resolved', 'success', 'succeeded', 'done', 'finished'].includes(normalized)) {
    return 'success'
  }

  if (
    [
      'failed',
      'error',
      'errored',
      'systemerror',
      'expired',
      'cancelled',
      'canceled',
      'interrupted',
      'denied',
      'rejected',
    ].includes(normalized)
  ) {
    return 'error'
  }

  if (['inprogress', 'running', 'pending', 'started', 'waiting', 'streaming'].includes(normalized)) {
    return 'running'
  }

  return undefined
}

function turnPlanNormalizedStatus(value: string) {
  return normalizeTurnPlanStatus(value)
}

function turnPlanStatusTone(turnPlan: TurnPlanItem | null): CompactSystemStatusTone | undefined {
  const explicitStatus = turnPlan?.status ?? ''
  if (explicitStatus) {
    return statusToneFromValue(explicitStatus)
  }

  if (!turnPlan?.steps.length) {
    return undefined
  }

  if (turnPlan.steps.every((entry) => turnPlanNormalizedStatus(entry.status) === 'completed')) {
    return 'success'
  }

  return 'running'
}

function turnPlanOverallBadgeTone(turnPlan: TurnPlanItem | null) {
  switch (turnPlanNormalizedStatus(turnPlan?.status ?? '')) {
    case 'completed':
      return 'success'
    case 'inprogress':
      return 'info'
    case 'failed':
    case 'error':
    case 'errored':
    case 'systemerror':
      return 'danger'
    case 'interrupted':
    case 'cancelled':
    case 'canceled':
    case 'pending':
      return 'warning'
    default:
      return 'warning'
  }
}

function turnPlanStepClassName(value: string) {
  switch (turnPlanNormalizedStatus(value)) {
    case 'completed':
      return 'completed'
    case 'inprogress':
      return 'in-progress'
    case 'failed':
    case 'error':
    case 'errored':
    case 'systemerror':
      return 'failed'
    case 'interrupted':
      return 'interrupted'
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return 'pending'
  }
}

function turnPlanStepBadgeTone(value: string) {
  switch (turnPlanNormalizedStatus(value)) {
    case 'completed':
      return 'success'
    case 'inprogress':
      return 'info'
    case 'failed':
    case 'error':
    case 'errored':
    case 'systemerror':
      return 'danger'
    case 'interrupted':
    case 'cancelled':
    case 'canceled':
      return 'warning'
    default:
      return 'warning'
  }
}

function turnPlanOverallStatusLabel(turnPlan: TurnPlanItem | null) {
  switch (turnPlanNormalizedStatus(turnPlan?.status ?? '')) {
    case 'completed':
      return humanizeToolStatus('completed')
    case 'inprogress':
      return humanizeToolStatus('inProgress')
    case 'pending':
      return humanizeToolStatus('pending')
    case 'systemerror':
      return humanizeToolStatus('error')
    default:
      return humanizeToolStatus(turnPlan?.status ?? 'pending')
  }
}

function turnPlanStepStatusLabel(value: string) {
  switch (turnPlanNormalizedStatus(value)) {
    case 'completed':
      return humanizeToolStatus('completed')
    case 'inprogress':
      return humanizeToolStatus('inProgress')
    case 'pending':
      return humanizeToolStatus('pending')
    case 'systemerror':
      return humanizeToolStatus('error')
    default:
      return humanizeToolStatus(value || 'pending')
  }
}

function countOutputLines(value: string) {
  const normalized = value.replace(/\r\n/g, '\n')
  const trimmed = normalized.trimEnd()

  if (!trimmed) {
    return 0
  }

  return trimmed.split('\n').length
}

async function writeTextToClipboard(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // Fall back to a DOM-based copy path.
    }
  }

  if (typeof document === 'undefined' || !document.body) {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()

  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(textarea)
  }
}

function toolCallSummary(item: Record<string, unknown>) {
  const type = stringField(item.type)
  const status = stringField(item.status)
  const server = stringField(item.server)
  const receiverThreadIds = stringArray(item.receiverThreadIds)

  if (type === 'mcpToolCall') {
    if (server) {
      return i18n._({
        id: 'Server {server}{statusSuffix}',
        message: 'Server {server}{statusSuffix}',
        values: {
          server,
          statusSuffix: status ? ` · ${humanizeToolStatus(status)}` : '',
        },
      })
    }

    return humanizeToolStatus(status) || i18n._({ id: 'Expand for details', message: 'Expand for details' })
  }

  if (type === 'collabAgentToolCall') {
    return receiverThreadIds.length
      ? targetThreadCountLabel(receiverThreadIds.length)
      : humanizeToolStatus(status) || i18n._({ id: 'Expand for details', message: 'Expand for details' })
  }

  return humanizeToolStatus(status) || i18n._({ id: 'Expand for details', message: 'Expand for details' })
}

function webSearchAction(item: Record<string, unknown>) {
  return asObject(item.action)
}

function trimmedStringArray(value: unknown) {
  return stringArray(value)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function reasoningSummaryLines(item: Record<string, unknown>) {
  return trimmedStringArray(item.summary)
}

function reasoningContentLines(item: Record<string, unknown>) {
  return trimmedStringArray(item.content)
}

function reasoningSummaryText(item: Record<string, unknown>) {
  return reasoningSummaryLines(item).join('\n')
}

function reasoningContentText(item: Record<string, unknown>) {
  return reasoningContentLines(item).join('\n')
}

function reasoningCardSummary(item: Record<string, unknown>) {
  const summaryLines = reasoningSummaryLines(item)
  if (summaryLines.length) {
    return summaryLines.length === 1
      ? truncateSingleLine(summaryLines[0], 104)
      : `${truncateSingleLine(summaryLines[0], 84)} +${summaryLines.length - 1}`
  }

  const contentLines = reasoningContentLines(item)
  if (!contentLines.length) {
    return i18n._({ id: 'Reasoning', message: 'Reasoning' })
  }

  return contentLines.length === 1
    ? truncateSingleLine(contentLines[0], 104)
    : `${truncateSingleLine(contentLines[0], 84)} +${contentLines.length - 1}`
}

function reasoningDisplayText(item: Record<string, unknown>) {
  const parts = [reasoningSummaryText(item), reasoningContentText(item)].filter(Boolean)
  return parts.join('\n')
}

function webSearchActionType(item: Record<string, unknown>) {
  return stringField(webSearchAction(item).type)
}

function webSearchActionLabel(value: string) {
  switch (value) {
    case 'search':
      return i18n._({ id: 'Search', message: 'Search' })
    case 'openPage':
      return i18n._({ id: 'Open Page', message: 'Open Page' })
    case 'findInPage':
      return i18n._({ id: 'Find In Page', message: 'Find In Page' })
    default:
      return value ? humanizeItemType(value) : i18n._({ id: 'Web Search', message: 'Web Search' })
  }
}

function webSearchQueries(item: Record<string, unknown>) {
  const action = webSearchAction(item)
  const values = [stringField(action.query), stringField(item.query), ...stringArray(action.queries)]
  const deduped: string[] = []

  for (const value of values) {
    const normalized = value.trim()
    if (!normalized || deduped.includes(normalized)) {
      continue
    }
    deduped.push(normalized)
  }

  return deduped
}

function webSearchURL(item: Record<string, unknown>) {
  return stringField(webSearchAction(item).url)
}

function webSearchPattern(item: Record<string, unknown>) {
  return stringField(webSearchAction(item).pattern)
}

function webSearchCardSummary(item: Record<string, unknown>) {
  const actionType = webSearchActionType(item)
  const queries = webSearchQueries(item)
  const url = webSearchURL(item)
  const pattern = webSearchPattern(item)

  switch (actionType) {
    case 'search':
      if (!queries.length) {
        return ''
      }
      return queries.length === 1
        ? truncateSingleLine(queries[0], 104)
        : `${truncateSingleLine(queries[0], 84)} +${queries.length - 1}`
    case 'openPage':
      return truncateMiddle(
        url || queries[0] || i18n._({ id: 'Open page', message: 'Open page' }),
        104,
      )
    case 'findInPage':
      if (pattern && url) {
        return i18n._({
          id: '{pattern} in {url}',
          message: '{pattern} in {url}',
          values: {
            pattern: truncateSingleLine(pattern, 42),
            url: truncateMiddle(url, 52),
          },
        })
      }
      if (pattern) {
        return truncateSingleLine(pattern, 104)
      }
      return truncateMiddle(
        url || queries[0] || i18n._({ id: 'Find in page', message: 'Find in page' }),
        104,
      )
    default: {
      const fallback = queries[0] || url || pattern
      return fallback ? truncateSingleLine(fallback, 104) : ''
    }
  }
}

function hasMeaningfulValue(value: unknown) {
  if (value === null || value === undefined) {
    return false
  }

  if (typeof value === 'string') {
    return value.trim() !== ''
  }

  if (Array.isArray(value)) {
    return value.length > 0
  }

  if (typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0
  }

  return true
}

function buildConversationEntries(turns: ThreadTurn[]): ConversationEntry[] {
  const cached = conversationEntriesCache.get(turns)
  if (cached) {
    return cached
  }

  const perTurnEntries = turns.map((turn) => collectTurnConversationEntries(turn))
  const totalEntryCount = perTurnEntries.reduce((count, entries) => count + entries.length, 0)
  const entries = new Array<ConversationEntry>(totalEntryCount)
  let offset = 0
  for (const entriesForTurn of perTurnEntries) {
    for (let index = 0; index < entriesForTurn.length; index += 1) {
      entries[offset] = entriesForTurn[index]
      offset += 1
    }
  }

  conversationEntriesCache.set(turns, entries)
  frontendDebugLog('thread-render', 'conversation entries rebuilt', {
    turnCount: turns.length,
    totalEntryCount,
    turns: turns.map((turn) => {
      const turnItems = Array.isArray(turn.items) ? turn.items : []
      return {
        id: turn.id,
        status: turn.status,
        itemCount: turnItems.length,
        itemTypes: turnItems.map((item) => stringField(item.type) || 'unknown'),
        hasError: Boolean(turn.error),
      }
    }),
    entries: entries.slice(-12).map(summarizeConversationEntryForDebug),
  })
  return entries
}

const ConversationEntryRow = memo(function ConversationEntryRow({
  children,
  containerRef,
}: ConversationEntryRowProps) {
  return (
    <ConversationRenderProfilerBoundary id="ConversationEntryRow">
      <div className="conversation-stream__item" ref={containerRef}>
        {children}
      </div>
    </ConversationRenderProfilerBoundary>
  )
})

const MeasuredConversationEntry = memo(function MeasuredConversationEntry({
  children,
  entryKey,
  isMeasurementActive,
  onMeasure,
}: MeasuredConversationEntryProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isMeasurementActive) {
      return
    }

    const container = containerRef.current
    if (!container) {
      return
    }

    const measure = () => {
      onMeasure(entryKey, container.getBoundingClientRect().height)
    }

    measure()
    if (typeof ResizeObserver === 'undefined') {
      return
    }

    const observer = new ResizeObserver(() => {
      measure()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [entryKey, isMeasurementActive, onMeasure])

  return (
    <ConversationEntryRow containerRef={containerRef}>
      {children}
    </ConversationEntryRow>
  )
})

function getConversationEntryKey(entry: ConversationEntry) {
  return entry.key
}

function getConversationEntryProfilerId(entry: ConversationEntry) {
  if (entry.kind === 'error') {
    return 'TimelineItem:error'
  }

  return `TimelineItem:${stringField(entry.item.type) || 'message'}`
}

function estimateConversationEntryHeight(entry: ConversationEntry) {
  if (entry.kind === 'error') {
    return 120
  }

  const type = stringField(entry.item.type)
  switch (type) {
    case 'userMessage':
      return estimateTextEntryHeight(userMessageText(entry.item), 72)
    case 'agentMessage':
      return estimateTextEntryHeight(stringField(entry.item.text), 88)
    case 'reasoning':
      return estimateTextEntryHeight(reasoningDisplayText(entry.item), 112)
    case 'webSearch':
      return 176
    case 'commandExecution': {
      const output = stringField(entry.item.aggregatedOutput)
      const lineCount = integerField(entry.item.outputLineCount) ?? countOutputLines(output)
      return 140 + Math.min(lineCount, 12) * 18
    }
    case 'turnPlan':
      {
        const turnPlan = readTurnPlanItem(entry.item)
        return estimateTextEntryHeight(
          `${turnPlan?.explanation ?? ''}\n${turnPlan?.steps.map((step) => step.step).join('\n') ?? ''}`,
          128,
        )
      }
    case 'plan':
      return estimateTextEntryHeight(stringField(entry.item.text), 112)
    case 'fileChange':
      return 136
    case 'serverRequest':
      return 156
    default:
      return 132
  }
}

function estimateTextEntryHeight(text: string, baseHeight: number) {
  if (!text) {
    return baseHeight
  }

  const lineCount = countOutputLines(text)
  const wrappedLineCount = Math.ceil(text.length / 90)
  return baseHeight + Math.min(Math.max(lineCount, wrappedLineCount), 12) * 22
}

function getStreamingAgentItemKey(
  turnId: string,
  item: Record<string, unknown>,
) {
  const itemId = stringField(item.id)
  if (!turnId || !itemId || stringField(item.type) !== 'agentMessage') {
    return null
  }

  return `${turnId}:${itemId}`
}

function findActiveStreamingAgentItemKey(turns: ThreadTurn[]) {
  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex]
    const turnId = stringField(turn.id)
    const items = Array.isArray(turn.items) ? turn.items : []
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const item = items[itemIndex]
      if (
        stringField(item.type) !== 'agentMessage' ||
        stringField(item.phase) !== 'streaming'
      ) {
        continue
      }

      const itemId = stringField(item.id)
      if (!turnId || !itemId) {
        continue
      }

      return `${turnId}:${itemId}`
    }
  }

  return null
}

function conversationEntryOmissionReason(item: Record<string, unknown>) {
  const type = stringField(item.type)

  switch (type) {
    case 'userMessage':
      return userMessageText(item) ? null : 'userMessage without text'
    case 'agentMessage':
      return stringField(item.text) || stringField(item.phase) === 'streaming'
        ? null
        : 'agentMessage without text'
    case 'commandExecution': {
      const command = stringField(item.command)
      const output = stringField(item.aggregatedOutput)
      const status = stringField(item.status)
      return command || output || status
        ? null
        : 'commandExecution without command/output/status'
    }
    case 'turnPlan':
      return (() => {
        const turnPlan = readTurnPlanItem(item)
        return turnPlan?.steps.length || turnPlan?.explanation
          ? null
          : 'turnPlan without content'
      })()
    case 'plan':
      return planSteps(item).length ? null : 'plan without steps'
    case 'fileChange':
      return fileChanges(item).length ? null : 'fileChange without changes'
    case 'reasoning':
      return null
    case 'webSearch':
      return webSearchCardSummary(item) ? null : 'webSearch without details'
    case 'mcpToolCall':
    case 'dynamicToolCall':
    case 'collabAgentToolCall':
    case 'serverRequest':
      return null
    default: {
      const text = stringField(item.text) || stringField(item.message)
      return text ? null : `${type || 'unknown'} without text`
    }
  }
}

function collectTurnConversationEntries(turn: ThreadTurn) {
  const cached = turnConversationEntriesCache.get(turn)
  if (cached) {
    return cached
  }

  const entries: ConversationEntry[] = []
  const turnItems = Array.isArray(turn.items) ? turn.items : []
  for (let itemIndex = 0; itemIndex < turnItems.length; itemIndex += 1) {
    const item = turnItems[itemIndex]
    const omissionReason = conversationEntryOmissionReason(item)
    if (omissionReason) {
      logSuppressedTimelineItem(item, turn.id, `conversation entry omitted: ${omissionReason}`)
      continue
    }

    entries.push({
      kind: 'item',
      key: buildConversationEntryItemKey(turn.id, item, itemIndex),
      item,
      turnId: turn.id,
    })
  }

  if (turn.error) {
    entries.push({
      kind: 'error',
      key: `${turn.id}-error`,
      error: turn.error,
    })
  }

  turnConversationEntriesCache.set(turn, entries)
  return entries
}

function buildConversationEntryItemKey(
  turnId: string,
  item: Record<string, unknown>,
  itemIndex: number,
) {
  const itemId = stringField(item.id)
  if (itemId) {
    return `${turnId}:${itemId}`
  }

  return `${turnId}:index:${itemIndex}`
}

function logSuppressedTimelineItem(
  item: Record<string, unknown>,
  turnId: string,
  reason: string,
) {
  const summary = JSON.stringify({
    reason,
    turnId,
    summary: summarizeTimelineItemForDebug(item),
  })
  if (itemRenderSuppressionDebugCache.get(item) === summary) {
    return
  }

  itemRenderSuppressionDebugCache.set(item, summary)
  recordConversationLiveDiagnosticEvent({
    itemId: stringField(item.id) || null,
    itemType: stringField(item.type) || null,
    kind: 'timeline-suppressed',
    metadata: {
      contentLength: Array.isArray(item.content) ? item.content.length : 0,
      summaryLength: Array.isArray(item.summary) ? item.summary.length : 0,
      textLength: (stringField(item.text) || stringField(item.message)).length,
    },
    reason,
    source: 'thread-render',
    turnId,
  })
  frontendDebugLog('thread-render', 'timeline item suppressed', {
    reason,
    turnId,
    item: summarizeTimelineItemForDebug(item),
  })
}

function logTimelinePlaceholderItem(
  item: Record<string, unknown>,
  turnId: string,
  reason: string,
) {
  const summary = JSON.stringify({
    reason,
    turnId,
    summary: summarizeTimelineItemForDebug(item),
  })
  if (itemRenderPlaceholderDebugCache.get(item) === summary) {
    return
  }

  itemRenderPlaceholderDebugCache.set(item, summary)
  recordConversationLiveDiagnosticEvent({
    itemId: stringField(item.id) || null,
    itemType: stringField(item.type) || null,
    kind: 'timeline-placeholder',
    metadata: {
      contentLength: Array.isArray(item.content) ? item.content.length : 0,
      summaryLength: Array.isArray(item.summary) ? item.summary.length : 0,
      textLength: (stringField(item.text) || stringField(item.message)).length,
    },
    reason,
    source: 'thread-render',
    turnId,
  })
  frontendDebugLog('thread-render', 'timeline placeholder rendered', {
    reason,
    turnId,
    item: summarizeTimelineItemForDebug(item),
  })
}

function summarizeConversationEntryForDebug(entry: ConversationEntry) {
  if (entry.kind === 'error') {
    return {
      key: entry.key,
      kind: entry.kind,
      error: 'present',
    }
  }

  return {
    key: entry.key,
    kind: entry.kind,
    turnId: entry.turnId,
    item: summarizeTimelineItemForDebug(entry.item),
  }
}

function summarizeTimelineItemForDebug(item: Record<string, unknown>) {
  const text = stringField(item.text) || stringField(item.message)
  return {
    id: stringField(item.id) || null,
    type: stringField(item.type) || 'unknown',
    phase: stringField(item.phase) || null,
    status: stringField(item.status) || null,
    textLength: text.length,
    textPreview: previewRenderDebugText(text),
    contentLength: Array.isArray(item.content) ? item.content.length : 0,
    summaryLength: Array.isArray(item.summary) ? item.summary.length : 0,
  }
}

function previewRenderDebugText(value: string) {
  const normalized = value.trim()
  if (!normalized) {
    return ''
  }

  if (normalized.length <= 160) {
    return normalized
  }

  return `${normalized.slice(0, 160)} ... [truncated, ${normalized.length - 160} more chars]`
}
