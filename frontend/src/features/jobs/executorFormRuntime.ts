import { i18n } from '../../i18n/runtime'
import type { BackgroundJobExecutor } from '../../types/api'

export type JobExecutorForm = NonNullable<BackgroundJobExecutor['form']>
export type JobExecutorFormField = NonNullable<JobExecutorForm['fields']>[number]
export type JobExecutorFormFieldOption = NonNullable<JobExecutorFormField['options']>[number]
export type JobExecutorFormFieldDataSource = NonNullable<JobExecutorFormField['dataSource']>
export type JobExecutorFormFieldValidation = NonNullable<JobExecutorFormField['validation']>

export function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() ?? ''
}

export function resolveExecutorFieldPayloadKey(field: JobExecutorFormField) {
  if (field.payloadKey?.trim()) {
    return field.payloadKey.trim()
  }
  switch (field.purpose) {
    case 'automationRef':
      return 'automationId'
    case 'prompt':
      return 'prompt'
    case 'model':
      return 'model'
    case 'reasoning':
      return 'reasoning'
    case 'threadName':
      return 'threadName'
    case 'timeoutSec':
      return 'timeoutSec'
    case 'script':
      return 'script'
    case 'shell':
      return 'shell'
    case 'workdir':
      return 'workdir'
    default:
      return ''
  }
}

export function findExecutorFormField(fields: JobExecutorFormField[], purpose: string) {
  return fields.find((field) => field.purpose === purpose) ?? null
}

export function readExecutorFieldDataSourceKind(field: JobExecutorFormField) {
  return field.dataSource?.kind?.trim() ?? ''
}

export function executorFieldUsesDataSourceKind(field: JobExecutorFormField, kind: string) {
  return readExecutorFieldDataSourceKind(field) === kind.trim()
}

export function executorFieldUsesWorkspaceModelCatalog(field: JobExecutorFormField) {
  return executorFieldUsesDataSourceKind(field, 'workspace_models')
}

export function executorFieldUsesWorkspaceAutomationCatalog(field: JobExecutorFormField) {
  return executorFieldUsesDataSourceKind(field, 'workspace_automations')
}

export function executorFieldAllowsBlankValue(field: JobExecutorFormField) {
  return field.dataSource?.allowBlank === true
}

export function executorFieldAllowsCustomValue(field: JobExecutorFormField) {
  return field.dataSource?.allowCustomValue === true
}

export function readExecutorFieldBlankLabel(field: JobExecutorFormField) {
  return field.dataSource?.blankLabel?.trim() ?? ''
}

export function readPayloadObject(payload: string) {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...parsed }
    }
  } catch {
    // Ignore invalid payload text here so the editor content can be preserved until final form validation.
  }
  return {}
}

export function canReadPayloadObject(payload: string) {
  try {
    const parsed = JSON.parse(payload)
    return !!parsed && typeof parsed === 'object' && !Array.isArray(parsed)
  } catch {
    return false
  }
}

export function readPayloadStringValue(payload: string, key: string) {
  if (!key.trim()) {
    return ''
  }
  const parsed = readPayloadObject(payload)
  return typeof parsed[key] === 'string' ? parsed[key].trim() : ''
}

export function readPayloadStringByKey(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function readPayloadNumberByKey(payload: Record<string, unknown>, key: string) {
  const value = payload[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function updatePayloadValue(
  payload: string,
  key: string,
  value: string | number | null,
  options?: { preserveStringWhitespace?: boolean },
) {
  const nextPayload = readPayloadObject(payload)
  if (typeof value === 'string') {
    const normalizedValue = options?.preserveStringWhitespace ? value : value.trim()
    if ((options?.preserveStringWhitespace ? normalizedValue.length > 0 : normalizedValue.trim().length > 0)) {
      nextPayload[key] = normalizedValue
    } else {
      delete nextPayload[key]
    }
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    nextPayload[key] = value
  } else {
    delete nextPayload[key]
  }
  return JSON.stringify(nextPayload, null, 2)
}

export function readExecutorFieldDefaultString(field: JobExecutorFormField) {
  return typeof field.defaultString === 'string' && field.defaultString.trim() ? field.defaultString.trim() : ''
}

export function applyExecutorFormDefaults(payload: Record<string, unknown>, fields: JobExecutorFormField[]) {
  const nextPayload = { ...payload }
  for (const field of fields) {
    const payloadKey = resolveExecutorFieldPayloadKey(field)
    if (!payloadKey || nextPayload[payloadKey] != null) {
      continue
    }
    if (typeof field.defaultString === 'string' && field.defaultString.trim()) {
      nextPayload[payloadKey] = field.defaultString.trim()
      continue
    }
    if (typeof field.defaultNumber === 'number' && Number.isFinite(field.defaultNumber)) {
      nextPayload[payloadKey] = field.defaultNumber
    }
  }
  return nextPayload
}

export function normalizeExecutorFormPayload(payload: Record<string, unknown>, fields: JobExecutorFormField[]) {
  const nextPayload = applyExecutorFormDefaults(payload, fields)

  for (const field of fields) {
    const payloadKey = resolveExecutorFieldPayloadKey(field)
    if (!payloadKey) {
      continue
    }

    switch (field.kind) {
      case 'textarea': {
        const value = nextPayload[payloadKey]
        if (typeof value !== 'string') {
          continue
        }
        const normalized = field.preserveWhitespace ? value : value.trim()
        if (normalized.length > 0) {
          nextPayload[payloadKey] = normalized
        } else {
          delete nextPayload[payloadKey]
        }
        break
      }
      case 'text':
      case 'model_select':
      case 'automation_select': {
        const value = readPayloadStringByKey(nextPayload, payloadKey)
        if (value) {
          nextPayload[payloadKey] = value
        } else {
          delete nextPayload[payloadKey]
        }
        break
      }
      case 'reasoning_select':
      case 'select': {
        const value = normalizeExecutorSelectFieldValue(nextPayload[payloadKey], field)
        if (value) {
          nextPayload[payloadKey] = value
        } else {
          delete nextPayload[payloadKey]
        }
        break
      }
      case 'number': {
        const numericValue = normalizeExecutorNumberFieldValue(nextPayload[payloadKey])
        if (numericValue == null) {
          delete nextPayload[payloadKey]
        } else {
          nextPayload[payloadKey] = numericValue
        }
        break
      }
      default:
        break
    }
  }

  return nextPayload
}

export function hasExecutorFormFieldValue(payload: Record<string, unknown>, field: JobExecutorFormField) {
  const payloadKey = resolveExecutorFieldPayloadKey(field)
  if (!payloadKey) {
    return true
  }

  switch (field.kind) {
    case 'number':
      return readPayloadNumberByKey(payload, payloadKey) != null
    default:
      return Boolean(readPayloadStringByKey(payload, payloadKey))
  }
}

export function normalizeExecutorSelectFieldValue(value: unknown, field: JobExecutorFormField) {
  const trimmedValue = typeof value === 'string' ? value.trim() : ''
  if (!trimmedValue) {
    return readExecutorFieldDefaultString(field)
  }

  const optionValues = field.options?.map((option) => option.value.trim()).filter(Boolean) ?? []
  if (!optionValues.length || optionValues.includes(trimmedValue)) {
    return trimmedValue
  }

  return readExecutorFieldDefaultString(field)
}

export function normalizeExecutorNumberFieldValue(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function validateExecutorFormPayload(
  payload: Record<string, unknown>,
  fields: JobExecutorFormField[],
  options?: {
    fallbackSourceRefId?: string | null
  },
) {
  for (const field of fields) {
    const payloadKey = resolveExecutorFieldPayloadKey(field)
    const validation = field.validation
    const stringValue = payloadKey ? readPayloadStringByKey(payload, payloadKey) : ''
    const numberValue = payloadKey ? readPayloadNumberByKey(payload, payloadKey) : null
    const hasSourceRefFallback = Boolean(validation?.allowSourceRefFallback && options?.fallbackSourceRefId?.trim())

    if (field.required && !hasExecutorFormFieldValue(payload, field) && !hasSourceRefFallback) {
      if (field.purpose === 'automationRef') {
        return i18n._({
          id: 'Choose which Automation this job should run before saving.',
          message: 'Choose which Automation this job should run before saving.',
        })
      }
      return i18n._({
        id: 'Complete the required executor fields before saving this job.',
        message: 'Complete the required executor fields before saving this job.',
      })
    }

    if (!payloadKey) {
      continue
    }

    if (stringValue) {
      if (typeof validation?.minLength === 'number' && stringValue.length < validation.minLength) {
        return i18n._({
          id: 'Fix invalid executor field values before saving this job.',
          message: 'Fix invalid executor field values before saving this job.',
        })
      }
      if (typeof validation?.maxLength === 'number' && stringValue.length > validation.maxLength) {
        return i18n._({
          id: 'Fix invalid executor field values before saving this job.',
          message: 'Fix invalid executor field values before saving this job.',
        })
      }
      if (validation?.pattern?.trim() && !matchesExecutorFieldPattern(stringValue, validation.pattern, validation.patternFlags)) {
        return i18n._({
          id: 'Fix invalid executor field values before saving this job.',
          message: 'Fix invalid executor field values before saving this job.',
        })
      }
      if (
        validation?.disallowedPattern?.trim() &&
        matchesExecutorFieldPattern(stringValue, validation.disallowedPattern, validation.disallowedPatternFlags)
      ) {
        if (field.purpose === 'automationRef') {
          return i18n._({
            id: 'Replace the sample automation reference with a real Automation before saving this job.',
            message: 'Replace the sample automation reference with a real Automation before saving this job.',
          })
        }
        return i18n._({
          id: 'Replace placeholder executor field values before saving this job.',
          message: 'Replace placeholder executor field values before saving this job.',
        })
      }
      if (validation?.relativeWorkspacePath && !isRelativeWorkspacePath(stringValue)) {
        return i18n._({
          id: 'Use a relative workspace path in executor fields before saving this job.',
          message: 'Use a relative workspace path in executor fields before saving this job.',
        })
      }
    }

    if (numberValue != null) {
      if (validation?.integerOnly && !Number.isInteger(numberValue)) {
        return i18n._({
          id: 'Executor number fields must use integers before saving this job.',
          message: 'Executor number fields must use integers before saving this job.',
        })
      }
      if (typeof field.min === 'number' && numberValue < field.min) {
        return i18n._({
          id: 'Executor number fields must stay within the allowed range before saving this job.',
          message: 'Executor number fields must stay within the allowed range before saving this job.',
        })
      }
      if (typeof field.max === 'number' && numberValue > field.max) {
        return i18n._({
          id: 'Executor number fields must stay within the allowed range before saving this job.',
          message: 'Executor number fields must stay within the allowed range before saving this job.',
        })
      }
    }
  }

  return ''
}

function matchesExecutorFieldPattern(value: string, pattern: string, flags?: string | null) {
  const normalizedValue = value.trim()
  if (!normalizedValue || !pattern.trim()) {
    return false
  }
  try {
    return new RegExp(pattern, normalizeExecutorFieldPatternFlags(flags)).test(normalizedValue)
  } catch {
    return false
  }
}

function normalizeExecutorFieldPatternFlags(flags?: string | null) {
  if (!flags?.trim()) {
    return undefined
  }
  const supportedFlags = new Set(['d', 'g', 'i', 'm', 's', 'u', 'y'])
  const normalizedFlags = Array.from(
    new Set(
      flags
        .trim()
        .split('')
        .filter((flag) => supportedFlags.has(flag)),
    ),
  ).join('')
  return normalizedFlags || undefined
}

function isRelativeWorkspacePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return true
  }

  const normalized = trimmed.replace(/\\/g, '/')
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('//') ||
    /^[a-zA-Z]:\//.test(normalized)
  ) {
    return false
  }

  let depth = 0
  for (const segment of normalized.split('/')) {
    const current = segment.trim()
    if (!current || current === '.') {
      continue
    }
    if (current === '..') {
      depth -= 1
      if (depth < 0) {
        return false
      }
      continue
    }
    depth += 1
  }

  return true
}
