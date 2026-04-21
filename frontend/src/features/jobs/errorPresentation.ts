import { i18n } from '../../i18n/runtime'
import { ApiClientError } from '../../lib/api-client'

type BackgroundJobFailureLike = {
  executorKind?: string | null
  error?: string | null
  errorMeta?: JobErrorMetaLike | null
  errorCode?: string | null
  errorMessage?: string | null
  retryable?: boolean | null
  resourceId?: string | null
  resourceType?: string | null
  lastError?: string | null
  lastErrorMeta?: JobErrorMetaLike | null
  lastErrorCode?: string | null
  lastErrorRetryable?: boolean | null
  lastErrorResourceId?: string | null
  lastErrorResourceType?: string | null
}

type JobErrorMetaLike = {
  code?: string | null
  retryable?: boolean | null
  details?: Record<string, unknown> | null
}

export type JobFailurePresentation = {
  message: string
  code: string
  retryable: boolean | null
  resourceId: string
  resourceType: string
  details: string[]
}

export function getJobFailurePresentation(value: unknown): JobFailurePresentation {
  const source = readFailureLike(value)
  const structuredMeta = firstJobErrorMeta(
    readJobErrorMeta(source?.errorMeta),
    readJobErrorMeta(source?.lastErrorMeta),
    errorDetails(value)?.errorMeta,
  )
  const code = firstNonEmpty(
    source?.errorCode,
    source?.lastErrorCode,
    structuredMeta?.code,
    errorDetails(value)?.errorCode,
    extractErrorCodeFromMessage(firstNonEmpty(source?.errorMessage, source?.error, source?.lastError, readErrorMessage(value))),
  )
  const rawMessage = firstNonEmpty(
    source?.errorMessage,
    source?.error,
    source?.lastError,
    readErrorMessage(value),
  )
  const retryable = firstBoolean(
    source?.retryable,
    source?.lastErrorRetryable,
    structuredMeta?.retryable,
    errorDetails(value)?.retryable,
  )
  const resourceId = firstNonEmpty(
    source?.resourceId,
    source?.lastErrorResourceId,
    structuredMeta?.resourceId,
    errorDetails(value)?.resourceId,
  )
  const resourceType = firstNonEmpty(
    source?.resourceType,
    source?.lastErrorResourceType,
    structuredMeta?.resourceType,
    errorDetails(value)?.resourceType,
  )
  const message = buildFriendlyFailureMessage({
    code,
    rawMessage,
    retryable,
    resourceId,
    resourceType,
    executorKind: firstNonEmpty(source?.executorKind),
  })

  return {
    message,
    code,
    retryable,
    resourceId,
    resourceType,
    details: buildFailureDetails({ code, retryable, resourceId, resourceType }),
  }
}

export function isBackgroundJobRunRetryable(value: unknown) {
  const presentation = getJobFailurePresentation(value)
  if (presentation.retryable === false) {
    return false
  }
  if (isAutomationMissingFailure(presentation.code, presentation.message)) {
    return false
  }
  return true
}

export function isAutomationRunPlaceholderAutomationId(automationId: string) {
  return /^auto[_-]?0*1$/i.test(automationId.trim())
}

type FriendlyFailureOptions = {
  code: string
  rawMessage: string
  retryable: boolean | null
  resourceId: string
  resourceType: string
  executorKind: string
}

function buildFriendlyFailureMessage({
  code,
  rawMessage,
  retryable,
  resourceId,
  resourceType,
  executorKind,
}: FriendlyFailureOptions) {
  const normalizedMessage = rawMessage.trim()

  if (isAutomationMissingFailure(code, normalizedMessage)) {
    return resourceId
      ? i18n._({
          id: 'Automation target "{automationId}" could not be found. Choose another Automation target or update Advanced Payload JSON before retrying.',
          message:
            'Automation target "{automationId}" could not be found. Choose another Automation target or update Advanced Payload JSON before retrying.',
          values: { automationId: resourceId },
        })
      : i18n._({
          id: 'The selected Automation target could not be found. Choose another Automation target or update Advanced Payload JSON before retrying.',
          message:
            'The selected Automation target could not be found. Choose another Automation target or update Advanced Payload JSON before retrying.',
        })
  }

  if (code === 'background_job_run_not_active' || normalizedMessage.toLowerCase().includes('background job run is not active')) {
    return i18n._({
      id: 'This run is no longer active, so only queued or running runs can be canceled.',
      message: 'This run is no longer active, so only queued or running runs can be canceled.',
    })
  }

  if (code === 'automation_run_reference_mismatch') {
    return i18n._({
      id: 'This job has conflicting Automation targets. Keep only one Automation target selected, then save again.',
      message: 'This job has conflicting Automation targets. Keep only one Automation target selected, then save again.',
    })
  }

  if (code === 'automation_run_source_type_invalid') {
    return i18n._({
      id: 'This job is misconfigured for automation_run. Re-select the Automation target and save again.',
      message: 'This job is misconfigured for automation_run. Re-select the Automation target and save again.',
    })
  }

  if (
    code === 'automation_id_required' ||
    code === 'automation_run_reference_required' ||
    normalizedMessage.toLowerCase().includes('automationid is required') ||
    normalizedMessage.toLowerCase().includes('automation id is required') ||
    /automation(?:_| )run\b.*\bautomationid\b.*\bsourcerefid\b/i.test(normalizedMessage)
  ) {
    return i18n._({
      id: 'Choose which Automation this job should run before saving or retrying.',
      message: 'Choose which Automation this job should run before saving or retrying.',
    })
  }

  if (retryable === false) {
    if (resourceType && resourceId) {
      return i18n._({
        id: 'This failure is marked as not retryable until {resourceType} "{resourceId}" is fixed.',
        message: 'This failure is marked as not retryable until {resourceType} "{resourceId}" is fixed.',
        values: { resourceId, resourceType },
      })
    }
    return i18n._({
      id: 'This failure is marked as not retryable until the job definition or referenced resource is fixed.',
      message: 'This failure is marked as not retryable until the job definition or referenced resource is fixed.',
    })
  }

  if (executorKind === 'automation_run' && normalizedMessage) {
    return normalizedMessage
  }

  return (
    normalizedMessage ||
    i18n._({
      id: 'The run failed without a detailed error message.',
      message: 'The run failed without a detailed error message.',
    })
  )
}

function buildFailureDetails({
  code,
  retryable,
  resourceId,
  resourceType,
}: Pick<JobFailurePresentation, 'code' | 'retryable' | 'resourceId' | 'resourceType'>) {
  const details: string[] = []
  if (code) {
    details.push(
      i18n._({
        id: 'Error code: {code}',
        message: 'Error code: {code}',
        values: { code },
      }),
    )
  }
  if (resourceId) {
    details.push(
      resourceType
        ? i18n._({
            id: 'Resource: {resourceType} "{resourceId}"',
            message: 'Resource: {resourceType} "{resourceId}"',
            values: { resourceId, resourceType },
          })
        : i18n._({
            id: 'Resource ID: {resourceId}',
            message: 'Resource ID: {resourceId}',
            values: { resourceId },
          }),
    )
  }
  if (retryable != null) {
    details.push(
      i18n._({
        id: 'Retryable: {retryable}',
        message: 'Retryable: {retryable}',
        values: {
          retryable: retryable
            ? i18n._({ id: 'Yes', message: 'Yes' })
            : i18n._({ id: 'No', message: 'No' }),
        },
      }),
    )
  }
  return details
}

function readFailureLike(value: unknown): BackgroundJobFailureLike | null {
  return typeof value === 'object' && value !== null ? (value as BackgroundJobFailureLike) : null
}

function errorDetails(value: unknown) {
  if (!(value instanceof ApiClientError) || !value.details || typeof value.details !== 'object') {
    return null
  }

  const details = value.details
  const errorMeta = readJobErrorMeta(details.errorMeta)
  return {
    errorCode: readOptionalString(details, 'errorCode') || readOptionalString(details, 'code') || errorMeta?.code,
    retryable: firstBoolean(readOptionalBoolean(details, 'retryable'), errorMeta?.retryable),
    resourceId: readOptionalString(details, 'resourceId') || errorMeta?.resourceId || '',
    resourceType: readOptionalString(details, 'resourceType') || errorMeta?.resourceType || '',
    errorMeta,
  }
}

function readErrorMessage(value: unknown) {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.message
  }
  return ''
}

function readOptionalString(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readOptionalObject(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readOptionalBoolean(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'boolean' ? value : null
}

function readJobErrorMeta(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  const details = readOptionalObject(record, 'details')
  const hasAutomationId = Boolean(readOptionalString(details ?? {}, 'automationId'))

  return {
    code: readOptionalString(record, 'code'),
    retryable: readOptionalBoolean(record, 'retryable'),
    resourceId:
      readOptionalString(details ?? {}, 'resourceId') ||
      readOptionalString(details ?? {}, 'automationId') ||
      '',
    resourceType:
      readOptionalString(details ?? {}, 'resourceType') ||
      (hasAutomationId ? 'automation' : ''),
  }
}

function firstJobErrorMeta(...values: Array<ReturnType<typeof readJobErrorMeta> | null | undefined>) {
  return values.find((value) => value != null) ?? null
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

function firstBoolean(...values: Array<boolean | null | undefined>) {
  return values.find((value) => typeof value === 'boolean') ?? null
}

function extractErrorCodeFromMessage(message: string) {
  const normalized = message.trim().toLowerCase()
  if (!normalized) {
    return ''
  }
  if (normalized.includes('automation not found')) {
    return 'automation_not_found'
  }
  if (normalized.includes('automationid is required') || normalized.includes('automation id is required')) {
    return 'automation_id_required'
  }
  if (normalized.includes('background job run is not active')) {
    return 'background_job_run_not_active'
  }
  return ''
}

function isAutomationMissingFailure(code: string, message: string) {
  return code === 'automation_not_found' || message.trim().toLowerCase().includes('automation not found')
}
