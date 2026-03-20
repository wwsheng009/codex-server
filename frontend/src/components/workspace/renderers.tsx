import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import type { PendingApproval, ServerEvent, ThreadTurn } from '../../types/api'

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

export function formatRelativeTimeShort(value?: string) {
  if (!value) {
    return 'now'
  }

  const then = new Date(value).getTime()
  if (Number.isNaN(then)) {
    return 'now'
  }

  const deltaMs = Date.now() - then
  const deltaHours = Math.floor(deltaMs / 3_600_000)
  const deltaDays = Math.floor(deltaMs / 86_400_000)
  const deltaMinutes = Math.floor(deltaMs / 60_000)

  if (deltaDays > 0) return `${deltaDays}d`
  if (deltaHours > 0) return `${deltaHours}h`
  if (deltaMinutes > 0) return `${deltaMinutes}m`
  return 'now'
}

export function buildLiveTimelineEntries(events: ServerEvent[]) {
  const entries: LiveTimelineEntry[] = []

  for (const event of events) {
    const aggregate = toDeltaAggregate(event)
    if (!aggregate) {
      entries.push({
        kind: 'event',
        key: `${event.ts}-${event.method}-${entries.length}`,
        event,
      })
      continue
    }

    const previous = entries[entries.length - 1]
    if (previous?.kind === 'delta' && previous.groupKey === aggregate.groupKey) {
      previous.text += aggregate.text
      previous.endedTs = event.ts
      previous.count += 1
      continue
    }

    entries.push({
      kind: 'delta',
      key: `${event.ts}-${aggregate.groupKey}-${entries.length}`,
      groupKey: aggregate.groupKey,
      title: aggregate.title,
      subtitle: aggregate.subtitle,
      text: aggregate.text,
      startedTs: event.ts,
      endedTs: event.ts,
      count: 1,
    })
  }

  return entries
}

export function TurnTimeline({ turns }: { turns: ThreadTurn[] }) {
  const entries = buildConversationEntries(turns)

  return (
    <div aria-live="polite" className="conversation-stream" role="log">
      {entries.map((entry) =>
        entry.kind === 'error' ? (
          <SystemTimelineCard className="conversation-card--error" key={entry.key} title="Error">
            <pre className="conversation-card__output">{safeJson(entry.error)}</pre>
          </SystemTimelineCard>
        ) : (
          <TimelineItem item={entry.item} key={entry.key} />
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
            <pre>{entry.text || '—'}</pre>
          </article>
        ) : (
          <article className="live-feed__card" key={entry.key}>
            <div className="live-feed__header">
              <strong>{entry.event.method}</strong>
              <span>{new Date(entry.event.ts).toLocaleTimeString()}</span>
            </div>
            <pre>{JSON.stringify(entry.event.payload, null, 2)}</pre>
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
        {approvalErrors[approval.id] ? <p className="error-text">{approvalErrors[approval.id]}</p> : null}
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
      {approvalErrors[approval.id] ? <p className="error-text">{approvalErrors[approval.id]}</p> : null}
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

function TimelineItem({ item }: { item: Record<string, unknown> }) {
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
            <div className="conversation-bubble__content">{text}</div>
          </div>
        </article>
      )
    }
    case 'agentMessage': {
      const text = stringField(item.text)

      if (!text) {
        return null
      }

      return (
        <article className="conversation-row conversation-row--assistant">
          <div className="conversation-bubble conversation-bubble--assistant">
            <div className="conversation-bubble__content">{text}</div>
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
          {command ? <code className="conversation-card__command-line">{command}</code> : null}
          {output ? (
            <pre className="conversation-card__output">{output}</pre>
          ) : (
            <div className="conversation-card__placeholder">Waiting for output.</div>
          )}
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
    case 'reasoning':
      return null
    default: {
      const text = stringField(item.text) || stringField(item.message)

      if (!text) {
        return null
      }

      return (
        <SystemTimelineCard title={humanizeItemType(type || 'message')}>
          <div className="conversation-card__content">{text}</div>
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

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
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

function decodeBase64(value: string) {
  try {
    const binary = window.atob(value)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return value
  }
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

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? '—'
  } catch {
    return String(value)
  }
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

function toDeltaAggregate(event: ServerEvent) {
  const payload = asObject(event.payload)

  switch (event.method) {
    case 'item/agentMessage/delta':
      return {
        groupKey: `agent:${stringField(payload.itemId) || 'unknown'}`,
        title: 'Agent Message Stream',
        subtitle: stringField(payload.itemId) || undefined,
        text: stringField(payload.delta),
      }
    case 'item/reasoning/summaryTextDelta':
    case 'item/reasoning/textDelta':
      return {
        groupKey: `reasoning:${stringField(payload.itemId) || event.method}`,
        title: 'Reasoning Stream',
        subtitle: stringField(payload.itemId) || undefined,
        text: stringField(payload.delta),
      }
    case 'command/exec/outputDelta':
      return {
        groupKey: `command:${stringField(payload.processId)}:${stringField(payload.stream)}`,
        title: 'Command Output',
        subtitle: stringField(payload.processId) || undefined,
        text: decodeBase64(stringField(payload.deltaBase64)),
      }
    default:
      return null
  }
}
