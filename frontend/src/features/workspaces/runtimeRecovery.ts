import { i18n } from '../../i18n/runtime'
import type { WorkspaceRuntimeState } from '../../types/api'

export type WorkspaceRuntimeRecoverySummary = {
  title: string
  tone: 'info' | 'error'
  categoryLabel: string
  recoveryActionLabel: string
  retryable: boolean
  retryableLabel: string
  requiresRecycle: boolean
  recycleLabel: string
  description: string
  details?: string
}

function formatBooleanLabel(value: boolean) {
  return value
    ? i18n._({ id: 'Yes', message: 'Yes' })
    : i18n._({ id: 'No', message: 'No' })
}

export function formatRuntimeErrorCategoryLabel(category?: string | null) {
  switch ((category ?? '').trim()) {
    case 'configuration':
      return i18n._({
        id: 'Launch configuration',
        message: 'Launch configuration',
      })
    case 'transport':
      return i18n._({
        id: 'Bridge / transport',
        message: 'Bridge / transport',
      })
    case 'process_exit':
      return i18n._({
        id: 'Runtime process exit',
        message: 'Runtime process exit',
      })
    case 'timeout':
      return i18n._({
        id: 'Timeout',
        message: 'Timeout',
      })
    case 'runtime':
      return i18n._({
        id: 'Runtime failure',
        message: 'Runtime failure',
      })
    case 'canceled':
      return i18n._({
        id: 'Canceled',
        message: 'Canceled',
      })
    case '':
      return i18n._({
        id: 'Not classified',
        message: 'Not classified',
      })
    default:
      return category ?? ''
  }
}

export function formatRuntimeRecoveryActionLabel(action?: string | null) {
  switch ((action ?? '').trim()) {
    case 'fix-launch-config':
      return i18n._({
        id: 'Fix launch config',
        message: 'Fix launch config',
      })
    case 'retry-after-restart':
      return i18n._({
        id: 'Restart runtime, then retry',
        message: 'Restart runtime, then retry',
      })
    case 'retry':
      return i18n._({
        id: 'Retry request',
        message: 'Retry request',
      })
    case 'none':
      return i18n._({
        id: 'No action needed',
        message: 'No action needed',
      })
    case '':
      return i18n._({
        id: 'No recovery action recorded',
        message: 'No recovery action recorded',
      })
    default:
      return action ?? ''
  }
}

export function buildWorkspaceRuntimeRecoverySummary(
  state: WorkspaceRuntimeState | null | undefined,
): WorkspaceRuntimeRecoverySummary | null {
  if (!state) {
    return null
  }

  const stderrLines = (state.recentStderr ?? []).filter((line) => line.trim())
  const hasSignals =
    Boolean(state.lastError?.trim()) ||
    Boolean(state.lastErrorCategory?.trim()) ||
    Boolean(state.lastErrorRecoveryAction?.trim()) ||
    stderrLines.length > 0

  if (!hasSignals) {
    return null
  }

  const categoryLabel = formatRuntimeErrorCategoryLabel(state.lastErrorCategory)
  const recoveryActionLabel = formatRuntimeRecoveryActionLabel(
    state.lastErrorRecoveryAction,
  )
  const retryableLabel = formatBooleanLabel(Boolean(state.lastErrorRetryable))
  const recycleLabel = formatBooleanLabel(
    Boolean(state.lastErrorRequiresRuntimeRecycle),
  )
  const title = state.lastError?.trim()
    ? i18n._({
        id: 'Runtime Recovery Guidance',
        message: 'Runtime Recovery Guidance',
      })
    : i18n._({
        id: 'Recent Runtime Diagnostics',
        message: 'Recent Runtime Diagnostics',
      })

  const descriptionParts = [
    state.lastError?.trim()
      ? i18n._({
          id: 'Last error: {error}',
          message: 'Last error: {error}',
          values: { error: state.lastError.trim() },
        })
      : i18n._({
          id: 'Recent stderr output is available for inspection.',
          message: 'Recent stderr output is available for inspection.',
        }),
    i18n._({
      id: 'Category: {category}.',
      message: 'Category: {category}.',
      values: { category: categoryLabel },
    }),
    i18n._({
      id: 'Recommended action: {action}.',
      message: 'Recommended action: {action}.',
      values: { action: recoveryActionLabel },
    }),
    state.lastErrorRequiresRuntimeRecycle
      ? i18n._({
          id: 'Restart the workspace runtime before you retry the next operation.',
          message:
            'Restart the workspace runtime before you retry the next operation.',
        })
      : state.lastErrorRetryable
        ? i18n._({
            id: 'The operation looks retryable without a forced runtime recycle.',
            message:
              'The operation looks retryable without a forced runtime recycle.',
          })
        : i18n._({
            id: 'Do not blindly retry until the underlying configuration or runtime issue is fixed.',
            message:
              'Do not blindly retry until the underlying configuration or runtime issue is fixed.',
          }),
  ]

  const detailsSections = [
    state.lastError?.trim()
      ? `Last Error: ${state.lastError.trim()}`
      : null,
    `Status: ${state.status}`,
    `Category: ${categoryLabel}`,
    `Recovery Action: ${recoveryActionLabel}`,
    `Retryable: ${retryableLabel}`,
    `Requires Runtime Recycle: ${recycleLabel}`,
    stderrLines.length
      ? ['Recent stderr:', ...stderrLines.map((line) => `- ${line}`)].join('\n')
      : null,
  ].filter((value): value is string => Boolean(value))

  return {
    title,
    tone:
      state.status === 'error' ||
      state.lastErrorRequiresRuntimeRecycle ||
      Boolean(state.lastError?.trim())
        ? 'error'
        : 'info',
    categoryLabel,
    recoveryActionLabel,
    retryable: Boolean(state.lastErrorRetryable),
    retryableLabel,
    requiresRecycle: Boolean(state.lastErrorRequiresRuntimeRecycle),
    recycleLabel,
    description: descriptionParts.join(' '),
    details: detailsSections.join('\n\n'),
  }
}
