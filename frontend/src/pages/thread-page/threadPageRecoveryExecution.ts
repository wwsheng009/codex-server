import { formatLocaleDateTime } from '../../i18n/format'
import { i18n } from '../../i18n/runtime'
import type { ThreadPageRecoverableRuntimeActionKind } from './threadPageRuntimeRecovery'

export type ThreadPageRuntimeRecoveryExecutionNotice = {
  actionKind: ThreadPageRecoverableRuntimeActionKind
  attemptCount: number
  attemptedAt: string
  details: string
  noticeKey: string
  summary: string
  title: string
  tone: 'info' | 'error'
}

type CreateThreadPageRuntimeRecoveryExecutionNoticeInput = {
  actionKind: ThreadPageRecoverableRuntimeActionKind
  details?: string
  previous?: ThreadPageRuntimeRecoveryExecutionNotice | null
  status: 'success' | 'error'
  summary: string
}

function formatActionLabel(actionKind: ThreadPageRecoverableRuntimeActionKind) {
  return actionKind === 'retry'
    ? i18n._({
        id: 'Retry',
        message: 'Retry',
      })
    : i18n._({
        id: 'Restart and Retry',
        message: 'Restart and Retry',
      })
}

function formatStatusLabel(status: 'success' | 'error') {
  return status === 'success'
    ? i18n._({
        id: 'Succeeded',
        message: 'Succeeded',
      })
    : i18n._({
        id: 'Failed',
        message: 'Failed',
      })
}

export function createThreadPageRuntimeRecoveryExecutionNotice({
  actionKind,
  details,
  previous,
  status,
  summary,
}: CreateThreadPageRuntimeRecoveryExecutionNoticeInput): ThreadPageRuntimeRecoveryExecutionNotice {
  const attemptedAt = new Date().toISOString()
  const attemptCount = (previous?.attemptCount ?? 0) + 1
  const actionLabel = formatActionLabel(actionKind)
  const statusLabel = formatStatusLabel(status)
  const attemptedAtLabel = formatLocaleDateTime(attemptedAt)

  const detailSections = [
    `Action: ${actionLabel}`,
    `Status: ${statusLabel}`,
    `Attempt Count: ${attemptCount}`,
    `Attempted At: ${attemptedAtLabel}`,
    `Summary: ${summary}`,
    details?.trim() ? `Details: ${details.trim()}` : null,
  ].filter((value): value is string => Boolean(value))

  return {
    actionKind,
    attemptCount,
    attemptedAt,
    details: detailSections.join('\n\n'),
    noticeKey: `runtime-recovery-attempt-${actionKind}-${status}-${attemptCount}-${attemptedAt}`,
    summary: i18n._({
      id: '{summary} Action: {action}. Attempt {attemptCount} at {attemptedAt}.',
      message:
        '{summary} Action: {action}. Attempt {attemptCount} at {attemptedAt}.',
      values: {
        summary,
        action: actionLabel,
        attemptCount,
        attemptedAt: attemptedAtLabel,
      },
    }),
    title:
      status === 'success'
        ? i18n._({
            id: 'Latest Recovery Attempt Succeeded',
            message: 'Latest Recovery Attempt Succeeded',
          })
        : i18n._({
            id: 'Latest Recovery Attempt Failed',
            message: 'Latest Recovery Attempt Failed',
          }),
    tone: status === 'success' ? 'info' : 'error',
  }
}
