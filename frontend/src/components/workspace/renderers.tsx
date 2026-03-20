import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { ThreadCodeBlock, ThreadMarkdown, ThreadTerminalBlock } from '../thread/ThreadContent'
import { containsAnsiEscapeCode, safeJson } from '../thread/threadRender'
import { InlineNotice } from '../ui/InlineNotice'
import type { LiveTimelineEntry } from './timeline-utils'
import type { PendingApproval, ThreadTurn } from '../../types/api'

type ConversationEntry =
  | {
      kind: 'item'
      key: string
      item: Record<string, unknown>
    }
  | {
      kind: 'error'
      key: string
      error: unknown
    }

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

export function TurnTimeline({
  turns,
  onRetryServerRequest,
}: {
  turns: ThreadTurn[]
  onRetryServerRequest?: (item: Record<string, unknown>) => void
}) {
  const entries = buildConversationEntries(turns)

  return (
    <div aria-live="polite" className="conversation-stream" role="log">
      {entries.map((entry) =>
        entry.kind === 'error' ? (
          <SystemTimelineCard className="conversation-card--error" key={entry.key} title="Error">
            <ThreadCodeBlock className="conversation-card__output" content={safeJson(entry.error)} />
          </SystemTimelineCard>
        ) : (
          <TimelineItem item={entry.item} key={entry.key} onRetryServerRequest={onRetryServerRequest} />
        ),
      )}
    </div>
  )
}

export function LiveFeed({ entries }: { entries: LiveTimelineEntry[] }) {
  return (
    <div className="live-feed">
      {entries.map((entry) =>
        entry.kind === 'delta' ? (
          <article className="live-feed__card" key={entry.key}>
            <div className="live-feed__header">
              <strong>{entry.title}</strong>
              <span>{entry.count} chunk(s)</span>
            </div>
            {entry.subtitle ? <small>{entry.subtitle}</small> : null}
            {entry.title === 'Command Output' || containsAnsiEscapeCode(entry.text) ? (
              <ThreadTerminalBlock className="live-feed__output live-feed__output--terminal" content={entry.text || '—'} />
            ) : (
              <ThreadCodeBlock className="live-feed__output" content={entry.text || '—'} />
            )}
          </article>
        ) : (
          <article className="live-feed__card" key={entry.key}>
            <div className="live-feed__header">
              <strong>{entry.event.method}</strong>
              <span>{new Date(entry.event.ts).toLocaleTimeString()}</span>
            </div>
            <ThreadCodeBlock className="live-feed__output" content={safeJson(entry.event.payload)} />
          </article>
        ),
      )}
    </div>
  )
}

export function ApprovalStack({
  approvals,
  approvalAnswers,
  approvalErrors,
  responding,
  onChangeAnswer,
  onRespond,
}: {
  approvals: PendingApproval[]
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  responding?: boolean
  onChangeAnswer: (requestId: string, questionId: string, value: string) => void
  onRespond: (input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) => void
}) {
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

export function ApprovalDialog({
  approval,
  approvalAnswers,
  approvalErrors,
  approvalQueueCount,
  responding,
  onChangeAnswer,
  onRespond,
}: {
  approval: PendingApproval
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  approvalQueueCount: number
  responding?: boolean
  onChangeAnswer: (requestId: string, questionId: string, value: string) => void
  onRespond: (input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) => void
}) {
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
            <span className="composer-approval-dialog__count">{approvalQueueCount} pending</span>
          ) : null}
        </div>
        <div className="composer-approval-dialog__intro" id={`approval-dialog-${approval.id}-description`}>
          <span className="composer-approval-dialog__eyebrow">Approval Required</span>
          <p>
            {questions.length
              ? 'Answer the prompt below directly from the composer without opening the side panel.'
              : 'Review the request and choose how to continue before sending the next message.'}
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
          <div className="composer-approval-dialog__progress" role="tablist" aria-label="Approval steps">
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
                  <strong>{stringField(question.header) || `Question ${index + 1}`}</strong>
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
            title="Approval Response Failed"
            tone="error"
          >
            {approvalErrors[approval.id]}
          </InlineNotice>
        ) : null}
        <div className="composer-approval-dialog__footer">
          <div className="composer-approval-dialog__shortcuts">
            {activeQuestion && approvalQuestionOptions(activeQuestion).length ? (
              <span className="composer-approval-dialog__shortcut">Arrows to move</span>
            ) : null}
            {primaryActions.length ? (
              <span className="composer-approval-dialog__shortcut">Ctrl/Cmd+Enter to approve</span>
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
                {responding ? 'Submitting…' : formatApprovalActionLabel(action)}
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
                Back
              </button>
            ) : null}
            {questions.length && currentQuestionIndex < questions.length - 1 ? (
              <button
                className="ide-button"
                disabled={responding || !isCurrentQuestionAnswered}
                onClick={() => setCurrentQuestionIndex((current) => Math.min(current + 1, questions.length - 1))}
                type="button"
              >
                Next
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
                  {responding ? 'Submitting…' : formatApprovalActionLabel(action)}
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
}: {
  approvalId: string
  question: Record<string, unknown>
  value: string
  onChangeAnswer: (requestId: string, questionId: string, value: string) => void
  onAdvance: () => void
  focusFirst?: boolean
}) {
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
        <div className="field approval-question approval-question--dialog">
          <label htmlFor={inputId}>{header}</label>
          <input
            id={inputId}
            onChange={(event) => onChangeAnswer(approvalId, questionId, event.target.value)}
            ref={inputRef}
            type={isSecret ? 'password' : 'text'}
            value={value}
          />
        </div>
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
}: {
  approval: PendingApproval
  approvalAnswers: Record<string, Record<string, string>>
  approvalErrors: Record<string, string>
  onChangeAnswer: (requestId: string, questionId: string, value: string) => void
  onRespond: (input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) => void
  responding?: boolean
  className?: string
  children?: ReactNode
  headerMeta?: ReactNode
  titleId?: string
}) {
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
          title="Approval Response Failed"
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
            {responding ? 'Submitting…' : formatApprovalActionLabel(action)}
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
}: {
  approvalId: string
  question: Record<string, unknown>
  value: string
  onChangeAnswer: (requestId: string, questionId: string, value: string) => void
  focusFirst?: boolean
}) {
  const questionId = stringField(question.id)
  const header = stringField(question.header) || questionId
  const prompt = stringField(question.question)
  const options = approvalQuestionOptions(question)
  const isSecret = Boolean(question.isSecret)
  const inputId = `approval-${approvalId}-${questionId}`

  return (
    <div className="field approval-question">
      {options.length ? <span>{header}</span> : <label htmlFor={inputId}>{header}</label>}
      {prompt ? <small>{prompt}</small> : null}
      {options.length ? (
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
      ) : (
        <input
          autoFocus={focusFirst}
          id={inputId}
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
}: {
  source: string
  tone: 'user' | 'assistant' | 'system'
  className?: string
  children: ReactNode
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
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
      ? 'Copied source message'
      : copyState === 'error'
        ? 'Copy failed'
        : 'Copy source message'
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

function CopyMessageStatusIcon({ state }: { state: 'idle' | 'copied' | 'error' }) {
  if (state === 'copied') {
    return <CopySuccessIcon />
  }

  if (state === 'error') {
    return <CopyErrorIcon />
  }

  return <CopyMessageIcon />
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

function TimelineItem({
  item,
  onRetryServerRequest,
}: {
  item: Record<string, unknown>
  onRetryServerRequest?: (item: Record<string, unknown>) => void
}) {
  const type = stringField(item.type)

  switch (type) {
    case 'userMessage': {
      const text = userMessageText(item)

      if (!text) {
        return null
      }

      return (
        <article className="conversation-row conversation-row--user">
          <div className="conversation-bubble conversation-bubble--user">
            <CopyableMessageBody className="conversation-bubble__content" source={text} tone="user">
              <ThreadMarkdown content={text} />
            </CopyableMessageBody>
          </div>
        </article>
      )
    }
    case 'agentMessage': {
      const text = stringField(item.text)
      const phase = stringField(item.phase)
      const isStreaming = phase === 'streaming'

      if (!text && !isStreaming) {
        return null
      }

      return (
        <article className="conversation-row conversation-row--assistant">
          <div
            className={
              isStreaming
                ? 'conversation-bubble conversation-bubble--assistant conversation-bubble--streaming'
                : 'conversation-bubble conversation-bubble--assistant'
            }
          >
            <CopyableMessageBody className="conversation-bubble__content" source={text} tone="assistant">
              {text ? <ThreadMarkdown content={text} /> : null}
              {isStreaming ? <span aria-hidden="true" className="conversation-bubble__cursor" /> : null}
            </CopyableMessageBody>
          </div>
        </article>
      )
    }
    case 'commandExecution': {
      const command = stringField(item.command)
      const output = stringField(item.aggregatedOutput)
      const status = stringField(item.status)

      if (!command && !output && !status) {
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--command"
          meta={status || undefined}
          title="Command"
        >
          <details className="conversation-tool-call conversation-tool-call--command">
            <summary className="conversation-tool-call__summary">
              <div className="conversation-tool-call__summary-copy">
                <strong>{truncateMiddle(command || 'Command execution', 80)}</strong>
                <span>{commandExecutionSummary(command, output, status)}</span>
              </div>
              <div className="conversation-tool-call__summary-meta">
                {status ? (
                  <span className="conversation-tool-call__pill">
                    {humanizeToolStatus(status)}
                  </span>
                ) : null}
                {output ? (
                  <span className="conversation-tool-call__pill">
                    {countOutputLines(output)} line{countOutputLines(output) === 1 ? '' : 's'}
                  </span>
                ) : null}
                <span className="conversation-tool-call__toggle-label">Details</span>
                <span className="conversation-tool-call__toggle" />
              </div>
            </summary>
            <div className="conversation-tool-call__details">
              {command ? <code className="conversation-card__command-line">{command}</code> : null}
              {output ? (
                <ThreadTerminalBlock
                  className="conversation-card__output conversation-card__output--terminal"
                  content={output}
                />
              ) : (
                <div className="conversation-card__placeholder">Waiting for output.</div>
              )}
            </div>
          </details>
        </SystemTimelineCard>
      )
    }
    case 'plan': {
      const steps = planSteps(item)

      if (!steps.length) {
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--plan"
          meta={`${steps.length} step${steps.length === 1 ? '' : 's'}`}
          title="Plan"
        >
          <ol className="conversation-plan">
            {steps.map((step, index) => (
              <li className="conversation-plan__step" key={index}>
                <span className="conversation-plan__index">{index + 1}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </SystemTimelineCard>
      )
    }
    case 'fileChange': {
      const changes = fileChanges(item)

      if (!changes.length) {
        return null
      }

      return (
        <SystemTimelineCard
          className="conversation-card--file"
          meta={`${changes.length} file${changes.length === 1 ? '' : 's'}`}
          title="Changed Files"
        >
          <ul className="conversation-file-list">
            {changes.map((change, index) => (
              <li className="conversation-file-list__item" key={`${change.path || 'file'}-${index}`}>
                <strong>{change.path || 'Unknown file'}</strong>
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
      return <ToolCallTimelineCard item={item} />
    case 'serverRequest':
      return <ServerRequestTimelineCard item={item} onRetry={onRetryServerRequest} />
    case 'reasoning':
      return null
    default: {
      const text = stringField(item.text) || stringField(item.message)

      if (!text) {
        return null
      }

      return (
        <SystemTimelineCard title={humanizeItemType(type || 'message')}>
          <CopyableMessageBody className="conversation-card__content" source={text} tone="system">
            <ThreadMarkdown content={text} />
          </CopyableMessageBody>
        </SystemTimelineCard>
      )
    }
  }
}

function SystemTimelineCard({
  className,
  title,
  meta,
  children,
}: {
  className?: string
  title: string
  meta?: string
  children: ReactNode
}) {
  return (
    <article className="conversation-row conversation-row--system">
      <div className={className ? `conversation-card ${className}` : 'conversation-card'}>
        <div className="conversation-card__header">
          <strong>{title}</strong>
          {meta ? <span>{meta}</span> : null}
        </div>
        <div className="conversation-card__body">{children}</div>
      </div>
    </article>
  )
}

function ToolCallTimelineCard({ item }: { item: Record<string, unknown> }) {
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
      ? 'MCP Tool Call'
      : type === 'collabAgentToolCall'
        ? 'Agent Tool Call'
        : 'Tool Call'

  const detailSections: ToolCallSection[] = [
    {
      label: 'Arguments',
      value: item.arguments,
    },
  ]

  if (type === 'mcpToolCall' && hasMeaningfulValue(item.result)) {
    detailSections.push({
      label: 'Result',
      value: item.result,
    })
  }

  if (type === 'dynamicToolCall' && hasMeaningfulValue(item.contentItems)) {
    detailSections.push({
      label: 'Output',
      value: item.contentItems,
    })
  }

  if (type === 'collabAgentToolCall' && prompt) {
    detailSections.push({
      kind: 'text',
      label: 'Prompt',
      value: prompt,
    })
  }

  if (type === 'collabAgentToolCall' && hasMeaningfulValue(item.agentsStates)) {
    detailSections.push({
      label: 'Agent States',
      value: item.agentsStates,
    })
  }

  if (hasMeaningfulValue(item.error)) {
    detailSections.push({
      label: 'Error',
      value: item.error,
      tone: 'danger',
    })
  }

  return (
    <SystemTimelineCard
      className="conversation-card--tool"
      meta={status ? humanizeToolStatus(status) : undefined}
      title={title}
    >
      <details className="conversation-tool-call">
        <summary className="conversation-tool-call__summary">
          <div className="conversation-tool-call__summary-copy">
            <strong>{tool}</strong>
            <span>{toolCallSummary(item)}</span>
          </div>
          <div className="conversation-tool-call__summary-meta">
            {server ? <span className="conversation-tool-call__pill">{server}</span> : null}
            {model ? <span className="conversation-tool-call__pill">{model}</span> : null}
            {durationMs !== null ? (
              <span className="conversation-tool-call__pill">{durationMs} ms</span>
            ) : null}
            {reasoningEffort ? (
              <span className="conversation-tool-call__pill">{reasoningEffort}</span>
            ) : null}
            {success !== null ? (
              <span
                className={
                  success
                    ? 'conversation-tool-call__pill conversation-tool-call__pill--success'
                    : 'conversation-tool-call__pill conversation-tool-call__pill--danger'
                }
              >
                {success ? 'success' : 'failed'}
              </span>
            ) : null}
            <span className="conversation-tool-call__toggle-label">Details</span>
            <span className="conversation-tool-call__toggle" />
          </div>
        </summary>
        <div className="conversation-tool-call__details">
          {senderThreadId || receiverThreadIds.length ? (
            <div className="conversation-tool-call__meta-grid">
              {senderThreadId ? (
                <div className="conversation-tool-call__meta-row">
                  <span>Sender</span>
                  <strong>{senderThreadId}</strong>
                </div>
              ) : null}
              {receiverThreadIds.length ? (
                <div className="conversation-tool-call__meta-row">
                  <span>Receivers</span>
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
        </div>
      </details>
    </SystemTimelineCard>
  )
}

function ServerRequestTimelineCard({
  item,
  onRetry,
}: {
  item: Record<string, unknown>
  onRetry?: (item: Record<string, unknown>) => void
}) {
  const requestKind = stringField(item.requestKind)
  const status = stringField(item.status) || 'pending'
  const details = asObject(item.details)
  const requestId = stringField(item.requestId)
  const expireReason = stringField(item.expireReason)
  const summary = summarizeServerRequest(requestKind, details)
  const metaPills = serverRequestMetaPills(requestKind, details)
  const statusLabel =
    status === 'resolved' ? 'Resolved' : status === 'expired' ? 'Expired' : 'Pending'

  return (
    <SystemTimelineCard
      className="conversation-card--request"
      meta={statusLabel}
      title={serverRequestTitle(requestKind)}
    >
      <details className="conversation-tool-call conversation-tool-call--request">
        <summary className="conversation-tool-call__summary">
          <div className="conversation-tool-call__summary-copy">
            <strong>{serverRequestLabel(requestKind)}</strong>
            <span>{summary}</span>
          </div>
          <div className="conversation-tool-call__summary-meta">
            {metaPills.map((pill) => (
              <span className="conversation-tool-call__pill" key={pill}>
                {pill}
              </span>
            ))}
            <span
              className={
                status === 'resolved'
                  ? 'conversation-tool-call__pill conversation-tool-call__pill--success'
                  : status === 'expired'
                    ? 'conversation-tool-call__pill conversation-tool-call__pill--danger'
                    : 'conversation-tool-call__pill conversation-tool-call__pill--warning'
              }
            >
              {statusLabel.toLowerCase()}
            </span>
            <span className="conversation-tool-call__toggle-label">Details</span>
            <span className="conversation-tool-call__toggle" />
          </div>
        </summary>
        <div className="conversation-tool-call__details">
          {requestId ? (
            <div className="conversation-tool-call__meta-grid">
              <div className="conversation-tool-call__meta-row">
                <span>Request</span>
                <strong>{requestId}</strong>
              </div>
            </div>
          ) : null}
          {status === 'expired' ? (
            <div className="conversation-tool-call__section">
              <div className="conversation-tool-call__section-header">
                <strong>Status</strong>
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
                    Retry In Composer
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          {details.message ? (
            <div className="conversation-tool-call__section">
              <div className="conversation-tool-call__section-header">
                <strong>Message</strong>
              </div>
              <ThreadMarkdown
                className="conversation-card__content conversation-tool-call__text"
                content={stringField(details.message)}
              />
            </div>
          ) : null}
          <div className="conversation-tool-call__section">
            <div className="conversation-tool-call__section-header">
              <strong>Payload</strong>
            </div>
            <ThreadCodeBlock
              className="conversation-card__output conversation-tool-call__output"
              content={safeJson(details)}
            />
          </div>
        </div>
      </details>
    </SystemTimelineCard>
  )
}

type ToolCallSection =
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

type ToolCallCommandField = {
  label: string
  value: string
  terminal?: boolean
}

type ToolCallContentItem = {
  type: string
  text?: string
  imageUrl?: string
}

function ToolCallSectionValue({
  value,
  tone,
  className,
}: {
  value: unknown
  tone?: 'danger'
  className?: string
}) {
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

  collect('command', 'Command')
  collect('stdout', 'Stdout', true)
  collect('stderr', 'Stderr', true)
  collect('combinedOutput', 'Output', true)
  collect('aggregatedOutput', 'Output', true)
  if (!consumed.has('output')) {
    collect('output', 'Output', true)
  }
  if (!consumed.has('error')) {
    collect('error', 'Error', containsAnsiEscapeCode(stringField(object.error)))
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
      return 'Approve'
    case 'accept_for_session':
      return 'Approve Session'
    case 'decline':
      return 'Decline'
    case 'cancel':
      return 'Cancel'
    default:
      return action
  }
}

function approvalDialogMeta(approval: PendingApproval, details: Record<string, unknown>) {
  switch (approval.kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval': {
      const command = stringField(details.command)
      return command ? [truncateMiddle(command, 72)] : ['Command approval']
    }
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval': {
      const path = stringField(details.path)
      if (path) {
        return [path]
      }

      if (Array.isArray(details.changes)) {
        return [`${details.changes.length} file change${details.changes.length === 1 ? '' : 's'}`]
      }

      return ['File changes']
    }
    case 'item/tool/requestUserInput':
      return [`${approvalDialogQuestionCount(details)} question${approvalDialogQuestionCount(details) === 1 ? '' : 's'}`]
    case 'item/permissions/requestApproval':
      return ['Permissions escalation', 'Scope: turn']
    case 'mcpServer/elicitation/request': {
      const serverName = stringField(details.serverName)
      return serverName ? [`Server: ${serverName}`] : ['MCP input']
    }
    case 'item/tool/call': {
      const tool = stringField(details.tool)
      return tool ? [`Tool: ${tool}`] : ['Dynamic tool call']
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
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\binprogress\b/gi, 'in progress')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function serverRequestTitle(kind: string) {
  switch (kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return 'Command Approval'
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return 'File Change Approval'
    case 'item/tool/requestUserInput':
      return 'User Input Request'
    case 'item/permissions/requestApproval':
      return 'Permissions Request'
    case 'mcpServer/elicitation/request':
      return 'MCP Input Request'
    case 'item/tool/call':
      return 'Tool Response Request'
    case 'account/chatgptAuthTokens/refresh':
      return 'Auth Refresh Request'
    default:
      return 'Server Request'
  }
}

function serverRequestLabel(kind: string) {
  switch (kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return 'Command requires approval'
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return 'File changes require approval'
    case 'item/tool/requestUserInput':
      return 'Tool requires user input'
    case 'item/permissions/requestApproval':
      return 'Permission escalation requested'
    case 'mcpServer/elicitation/request':
      return 'MCP server needs input'
    case 'item/tool/call':
      return 'Tool call needs response'
    case 'account/chatgptAuthTokens/refresh':
      return 'Authentication refresh required'
    default:
      return humanizeItemType(kind || 'serverRequest')
  }
}

function summarizeServerRequest(kind: string, details: Record<string, unknown>) {
  switch (kind) {
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return stringField(details.command) || 'Review the command request'
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return stringField(details.path) || summarizeChangeCount(details)
    case 'item/tool/requestUserInput': {
      const questionCount = Array.isArray(details.questions) ? details.questions.length : 0
      return questionCount ? `${questionCount} question${questionCount === 1 ? '' : 's'} waiting for an answer` : 'Provide input to continue'
    }
    case 'item/permissions/requestApproval':
      return stringField(details.reason) || 'Additional permissions were requested'
    case 'mcpServer/elicitation/request':
      return stringField(details.message) || stringField(details.serverName) || 'The MCP server is waiting for input'
    case 'item/tool/call':
      return stringField(details.tool) || 'Provide output for the requested tool call'
    case 'account/chatgptAuthTokens/refresh':
      return stringField(details.reason) || 'Refresh the account authentication tokens'
    default:
      return stringField(details.message) || stringField(details.reason) || 'Expand for request details'
  }
}

function serverRequestExpiredMessage(reason: string) {
  switch (reason) {
    case 'runtime_closed':
      return 'This request expired because the runtime connection was closed.'
    case 'runtime_removed':
      return 'This request expired because the workspace runtime was removed.'
    case 'request_unavailable':
      return 'This request is no longer available. Re-run the action if it is still needed.'
    default:
      return 'This request is no longer available. Re-run the action if it is still needed.'
  }
}

function serverRequestMetaPills(kind: string, details: Record<string, unknown>) {
  const pills: string[] = []

  if (kind === 'item/tool/call' && stringField(details.tool)) {
    pills.push(`Tool ${stringField(details.tool)}`)
  }
  if (kind === 'mcpServer/elicitation/request' && stringField(details.serverName)) {
    pills.push(`Server ${stringField(details.serverName)}`)
  }
  if (Array.isArray(details.questions) && details.questions.length > 0) {
    pills.push(`${details.questions.length} question${details.questions.length === 1 ? '' : 's'}`)
  }
  if (Array.isArray(details.changes) && details.changes.length > 0) {
    pills.push(`${details.changes.length} file${details.changes.length === 1 ? '' : 's'}`)
  }

  return pills
}

function summarizeChangeCount(details: Record<string, unknown>) {
  const changeCount = Array.isArray(details.changes) ? details.changes.length : 0
  return changeCount ? `${changeCount} file change${changeCount === 1 ? '' : 's'}` : 'Review the requested file changes'
}

function commandExecutionSummary(command: string, output: string, status: string) {
  const parts: string[] = []

  if (status) {
    parts.push(humanizeToolStatus(status))
  }

  if (output) {
    parts.push(`${countOutputLines(output)} line${countOutputLines(output) === 1 ? '' : 's'} of output`)
  } else {
    parts.push('No output yet')
  }

  if (command) {
    parts.unshift(truncateMiddle(command, 72))
  }

  return parts.join(' · ')
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
      return `Server ${server}${status ? ` · ${humanizeToolStatus(status)}` : ''}`
    }

    return humanizeToolStatus(status) || 'Expand for details'
  }

  if (type === 'collabAgentToolCall') {
    return receiverThreadIds.length
      ? `${receiverThreadIds.length} target thread${receiverThreadIds.length === 1 ? '' : 's'}`
      : humanizeToolStatus(status) || 'Expand for details'
  }

  return humanizeToolStatus(status) || 'Expand for details'
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
  const entries: ConversationEntry[] = []

  turns.forEach((turn) => {
    turn.items.forEach((item, itemIndex) => {
      entries.push({
        kind: 'item',
        key: `${turn.id}-${itemIndex}`,
        item,
      })
    })

    if (turn.error) {
      entries.push({
        kind: 'error',
        key: `${turn.id}-error`,
        error: turn.error,
      })
    }
  })

  return entries
}
