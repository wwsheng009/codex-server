import { useMemo, useState } from 'react'

import type { ApprovalDetails, PendingApproval } from '../../types/api'

type McpElicitationFormProps = {
  approval: PendingApproval
  disabled?: boolean
  onRespond: (input: { action: string; content?: unknown }) => void
}

type FieldKind = 'text' | 'number' | 'boolean' | 'select' | 'multiselect'

type FieldDefinition = {
  key: string
  title: string
  description: string
  kind: FieldKind
  required: boolean
  options?: Array<{ label: string; value: string }>
}

export function McpElicitationForm({ approval, disabled, onRespond }: McpElicitationFormProps) {
  const details = (approval.details ?? {}) as ApprovalDetails
  const fields = useMemo(() => buildFieldDefinitions(details.requestedSchema), [details.requestedSchema])
  const [values, setValues] = useState<Record<string, unknown>>(() => defaultValues(fields))
  const [error, setError] = useState('')

  function setValue(key: string, value: unknown) {
    setValues((current) => ({
      ...current,
      [key]: value,
    }))
    setError('')
  }

  function submit() {
    const validationError = validateFields(fields, values)
    if (validationError) {
      setError(validationError)
      return
    }

    onRespond({
      action: 'accept',
      content: buildContent(fields, values),
    })
  }

  return (
    <div className="stack stack--tight">
      {typeof details.message === 'string' ? <p className="muted-text">{details.message}</p> : null}
      {typeof details.serverName === 'string' ? (
        <p className="muted-text">Requested by MCP server: {details.serverName}</p>
      ) : null}

      {fields.map((field) => (
        <label className="field approval-question" key={field.key}>
          <span>{field.title}</span>
          {field.description ? <small>{field.description}</small> : null}
          {renderField(field, values[field.key], setValue, disabled)}
        </label>
      ))}

      {error ? <p className="error-text">{error}</p> : null}

      <div className="approval-card__actions">
        <button className="button button--tiny" disabled={disabled} onClick={submit} type="button">
          Submit
        </button>
        {approval.actions.includes('decline') ? (
          <button
            className="button button--tiny button--secondary"
            disabled={disabled}
            onClick={() => onRespond({ action: 'decline' })}
            type="button"
          >
            Decline
          </button>
        ) : null}
        {approval.actions.includes('cancel') ? (
          <button
            className="button button--tiny button--secondary"
            disabled={disabled}
            onClick={() => onRespond({ action: 'cancel' })}
            type="button"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  )
}

function renderField(
  field: FieldDefinition,
  value: unknown,
  setValue: (key: string, value: unknown) => void,
  disabled?: boolean,
) {
  switch (field.kind) {
    case 'boolean':
      return (
        <label className="approval-checkbox">
          <input
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(event) => setValue(field.key, event.target.checked)}
            type="checkbox"
          />
          <span>{Boolean(value) ? 'Enabled' : 'Disabled'}</span>
        </label>
      )
    case 'select':
      return (
        <select
          disabled={disabled}
          onChange={(event) => setValue(field.key, event.target.value)}
          value={typeof value === 'string' ? value : ''}
        >
          <option value="">Choose an option</option>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    case 'multiselect':
      return (
        <div className="approval-multiselect">
          {field.options?.map((option) => {
            const current = Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
            const checked = current.includes(option.value)

            return (
              <label className="approval-checkbox" key={option.value}>
                <input
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) =>
                    setValue(
                      field.key,
                      event.target.checked
                        ? [...current, option.value]
                        : current.filter((entry) => entry !== option.value),
                    )
                  }
                  type="checkbox"
                />
                <span>{option.label}</span>
              </label>
            )
          })}
        </div>
      )
    case 'number':
      return (
        <input
          disabled={disabled}
          onChange={(event) => setValue(field.key, event.target.value)}
          type="number"
          value={typeof value === 'string' ? value : ''}
        />
      )
    default:
      return (
        <input
          disabled={disabled}
          onChange={(event) => setValue(field.key, event.target.value)}
          type="text"
          value={typeof value === 'string' ? value : ''}
        />
      )
  }
}

function buildFieldDefinitions(schema: unknown): FieldDefinition[] {
  const schemaObject = asObject(schema)
  const properties = asObject(schemaObject.properties)
  const required = new Set(arrayOfStrings(schemaObject.required))

  return Object.entries(properties).map(([key, rawField]) => {
    const field = asObject(rawField)
    const options = fieldOptions(field)

    return {
      key,
      title: stringField(field.title) || key,
      description: stringField(field.description),
      kind: detectFieldKind(field, options.length > 0),
      required: required.has(key),
      options: options.length ? options : undefined,
    }
  })
}

function detectFieldKind(field: Record<string, unknown>, hasOptions: boolean): FieldKind {
  const type = stringField(field.type)

  if (type === 'boolean') {
    return 'boolean'
  }
  if (type === 'array') {
    return 'multiselect'
  }
  if (type === 'number' || type === 'integer') {
    return 'number'
  }
  if (hasOptions) {
    return 'select'
  }

  return 'text'
}

function fieldOptions(field: Record<string, unknown>) {
  if (Array.isArray(field.oneOf)) {
    return field.oneOf
      .map((entry) => {
        const option = asObject(entry)
        return {
          label: stringField(option.title) || stringField(option.const),
          value: stringField(option.const),
        }
      })
      .filter((option) => option.value)
  }

  if (Array.isArray(field.enum)) {
    const enumNames = Array.isArray(field.enumNames)
      ? field.enumNames.filter((entry): entry is string => typeof entry === 'string')
      : []
    return field.enum
      .filter((entry): entry is string => typeof entry === 'string')
      .map((value, index) => ({
        label: enumNames[index] || value,
        value,
      }))
  }

  const items = asObject(field.items)
  if (Array.isArray(items.anyOf)) {
    return items.anyOf
      .map((entry) => {
        const option = asObject(entry)
        return {
          label: stringField(option.title) || stringField(option.const),
          value: stringField(option.const),
        }
      })
      .filter((option) => option.value)
  }

  if (Array.isArray(items.enum)) {
    return items.enum
      .filter((entry): entry is string => typeof entry === 'string')
      .map((value) => ({
        label: value,
        value,
      }))
  }

  return []
}

function defaultValues(fields: FieldDefinition[]) {
  const values: Record<string, unknown> = {}
  for (const field of fields) {
    switch (field.kind) {
      case 'boolean':
        values[field.key] = false
        break
      case 'multiselect':
        values[field.key] = []
        break
      default:
        values[field.key] = ''
        break
    }
  }
  return values
}

function validateFields(fields: FieldDefinition[], values: Record<string, unknown>) {
  for (const field of fields) {
    const value = values[field.key]
    if (!field.required) {
      continue
    }

    if (field.kind === 'multiselect' && (!Array.isArray(value) || value.length === 0)) {
      return `Please select at least one value for ${field.title}.`
    }

    if (field.kind !== 'boolean' && String(value ?? '').trim() === '') {
      return `Please provide a value for ${field.title}.`
    }
  }

  return ''
}

function buildContent(fields: FieldDefinition[], values: Record<string, unknown>) {
  const content: Record<string, unknown> = {}

  for (const field of fields) {
    const value = values[field.key]
    switch (field.kind) {
      case 'boolean':
        content[field.key] = Boolean(value)
        break
      case 'number':
        content[field.key] = value === '' ? null : Number(value)
        break
      case 'multiselect':
        content[field.key] = Array.isArray(value) ? value : []
        break
      default:
        content[field.key] = String(value ?? '')
        break
    }
  }

  return content
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function arrayOfStrings(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}
