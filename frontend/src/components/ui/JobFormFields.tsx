import { Fragment, useEffect, useId, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'

import { listModels } from '../../features/catalog/api'
import {
  executorFieldAllowsBlankValue,
  executorFieldAllowsCustomValue,
  executorFieldUsesWorkspaceAutomationCatalog,
  executorFieldUsesWorkspaceModelCatalog,
  findExecutorFormField,
  firstNonEmpty,
  readExecutorFieldBlankLabel,
  readExecutorFieldDefaultString,
  readPayloadObject,
  readPayloadStringValue,
  resolveExecutorFieldPayloadKey,
  updatePayloadValue,
  type JobExecutorFormField,
  type JobExecutorFormFieldOption,
} from '../../features/jobs/executorFormRuntime'
import { isAutomationRunPlaceholderAutomationId } from '../../features/jobs/errorPresentation'
import { i18n } from '../../i18n/runtime'
import type { Automation, BackgroundJobExecutor, Workspace } from '../../types/api'
import { Input } from './Input'
import { InlineNotice } from './InlineNotice'
import { SelectControl } from './SelectControl'
import { TextArea } from './TextArea'

type JobDraft = {
  name: string
  description: string
  workspaceId: string
  executorKind: string
  payload: string
}

type JobFormFieldsProps<TDraft extends JobDraft> = {
  draft: TDraft
  setDraft: Dispatch<SetStateAction<TDraft>>
  workspaces: Workspace[]
  executors: BackgroundJobExecutor[]
  automations: Automation[]
  currentExecutor: BackgroundJobExecutor | null
  sourceType?: string
  sourceRefId?: string
}

type FieldRow = {
  key: string
  fields: JobExecutorFormField[]
}

type FieldOption = {
  value: string
  label: string
  disabled?: boolean
}

function generateFieldsFromPayloadSchema(
  schema: Record<string, unknown> | null | undefined,
): JobExecutorFormField[] {
  if (!schema) {
    return []
  }
  const properties = schema.properties as Record<string, Record<string, unknown>> | undefined
  if (!properties || typeof properties !== 'object') {
    return []
  }

  const fields: JobExecutorFormField[] = []
  for (const [key, prop] of Object.entries(properties)) {
    if (!prop || typeof prop !== 'object') {
      continue
    }

    const type = prop.type as string | undefined
    let kind: JobExecutorFormField['kind'] = 'text'

    if (type === 'string') {
      kind = 'text'
    } else if (type === 'number' || type === 'integer') {
      kind = 'number'
    } else if (type === 'boolean') {
      kind = 'select'
    }

    const enumValues = prop.enum as string[] | undefined
    if (Array.isArray(enumValues) && enumValues.length > 0) {
      kind = 'select'
    }

    if (
      kind === 'text' &&
      type === 'string' &&
      ((prop.format as string) === 'multiline' ||
        key === 'script' ||
        key === 'prompt' ||
        key === 'message' ||
        (prop.description as string)?.toLowerCase().includes('multiline'))
    ) {
      kind = 'textarea'
    }

    const field: JobExecutorFormField = {
      purpose: key,
      kind,
      label: (prop.title as string) || humanizeIdentifier(key),
      hint: (prop.description as string) || '',
      payloadKey: key,
      placeholder:
        typeof prop.default === 'string'
          ? prop.default
          : typeof prop.default === 'number'
            ? String(prop.default)
            : undefined,
    }

    if (kind === 'textarea') {
      field.rows = 6
    }

    if (kind === 'select' && Array.isArray(enumValues)) {
      field.options = enumValues.map((value) => ({
        value: String(value),
        label: String(value),
      }))
    }

    if (key === 'automationId' || key === 'automationRef') {
      field.kind = 'automation_select'
      field.dataSource = { kind: 'workspace_automations', allowBlank: true }
    } else if (key === 'model') {
      field.kind = 'model_select'
      field.dataSource = { kind: 'workspace_models', allowCustomValue: true }
    }

    fields.push(field)
  }

  return fields
}

export function JobFormFields<TDraft extends JobDraft>({
  draft,
  setDraft,
  workspaces,
  executors,
  automations,
  currentExecutor,
  sourceType,
  sourceRefId,
}: JobFormFieldsProps<TDraft>) {
  const formFields = useMemo(() => {
    const explicit = currentExecutor?.form?.fields ?? []
    if (explicit.length > 0) {
      return explicit
    }
    return generateFieldsFromPayloadSchema(currentExecutor?.payloadSchema)
  }, [currentExecutor])
  const hasStructuredPayloadForm = formFields.length > 0
  const capabilities = currentExecutor?.capabilities ?? null
  const automationField =
    formFields.find((field) => executorFieldUsesWorkspaceAutomationCatalog(field)) ??
    findExecutorFormField(formFields, 'automationRef')
  const automationPayloadKey = firstNonEmpty(
    automationField ? resolveExecutorFieldPayloadKey(automationField) : '',
    capabilities?.automationRef?.payloadKey,
    'automationId',
  )
  const payloadObject = useMemo(() => readPayloadObject(draft.payload), [draft.payload])
  const linkedAutomationId = sourceType === 'automation' ? sourceRefId?.trim() ?? '' : ''
  const payloadAutomationId = automationField ? readPayloadStringValue(draft.payload, automationPayloadKey) : ''
  const selectedAutomationId = firstNonEmpty(payloadAutomationId, linkedAutomationId)
  const usesPlaceholderAutomationId =
    Boolean(automationField) && payloadAutomationId ? isAutomationRunPlaceholderAutomationId(payloadAutomationId) : false
  const [showAdvancedFields, setShowAdvancedFields] = useState(false)
  const [showAdvancedPayload, setShowAdvancedPayload] = useState(false)
  const modelInputId = useId()
  const modelSuggestionsId = modelInputId + '-suggestions'

  const workspaceAutomations = useMemo(
    () =>
      automations
        .filter((automation) => automation.workspaceId === draft.workspaceId)
        .slice()
        .sort((left, right) => left.title.localeCompare(right.title)),
    [automations, draft.workspaceId],
  )
  const selectedAutomation = automations.find((automation) => automation.id === selectedAutomationId) ?? null
  const selectedWorkspaceAutomation =
    workspaceAutomations.find((automation) => automation.id === selectedAutomationId) ?? null

  const modelsQuery = useQuery({
    queryKey: ['models', draft.workspaceId],
    queryFn: () => listModels(draft.workspaceId),
    enabled: formFields.some((field) => executorFieldUsesWorkspaceModelCatalog(field)) && !!draft.workspaceId,
  })

  const primaryFieldRows = useMemo(() => buildExecutorFieldRows(formFields.filter((field) => !field.advanced)), [formFields])
  const advancedFieldRows = useMemo(() => buildExecutorFieldRows(formFields.filter((field) => field.advanced)), [formFields])

  useEffect(() => {
    setShowAdvancedFields(false)
    setShowAdvancedPayload(!hasStructuredPayloadForm)
  }, [draft.executorKind, hasStructuredPayloadForm])

  useEffect(() => {
    if (!automationField || payloadAutomationId || linkedAutomationId || !workspaceAutomations.length) {
      return
    }
    const defaultAutomationId = workspaceAutomations[0]?.id
    if (!defaultAutomationId) {
      return
    }
    setDraft((current) => ({
      ...current,
      payload: updatePayloadValue(current.payload, automationPayloadKey, defaultAutomationId),
    }))
  }, [automationField, automationPayloadKey, linkedAutomationId, payloadAutomationId, setDraft, workspaceAutomations])

  useEffect(() => {
    if (!automationField || !payloadAutomationId) {
      return
    }
    if (!automations.some((automation) => automation.id === payloadAutomationId)) {
      return
    }
    if (workspaceAutomations.some((automation) => automation.id === payloadAutomationId)) {
      return
    }
    setDraft((current) => ({
      ...current,
      payload: updatePayloadValue(current.payload, automationPayloadKey, ''),
    }))
  }, [automationField, automationPayloadKey, automations, payloadAutomationId, setDraft, workspaceAutomations])

  function setFieldValue(field: JobExecutorFormField, value: string | number | null) {
    const payloadKey = resolveExecutorFieldPayloadKey(field)
    if (!payloadKey) {
      return
    }
    setDraft((current) => ({
      ...current,
      payload: updatePayloadValue(current.payload, payloadKey, value, {
        preserveStringWhitespace: field.preserveWhitespace === true,
      }),
    }))
  }

  function readFieldRawStringValue(field: JobExecutorFormField) {
    const payloadKey = resolveExecutorFieldPayloadKey(field)
    if (!payloadKey) {
      return ''
    }
    const value = payloadObject[payloadKey]
    return typeof value === 'string' ? value : ''
  }

  function readFieldStringValue(field: JobExecutorFormField) {
    const rawValue = readFieldRawStringValue(field)
    if (field.preserveWhitespace ? rawValue.length > 0 : rawValue.trim().length > 0) {
      return rawValue
    }
    return readExecutorFieldDefaultString(field)
  }

  function readFieldNumberInputValue(field: JobExecutorFormField) {
    const payloadKey = resolveExecutorFieldPayloadKey(field)
    if (!payloadKey) {
      return ''
    }
    const value = payloadObject[payloadKey]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
    if (typeof value === 'string') {
      return value.trim()
    }
    return typeof field.defaultNumber === 'number' && Number.isFinite(field.defaultNumber)
      ? String(field.defaultNumber)
      : ''
  }

  function resolveFieldLabel(field: JobExecutorFormField) {
    switch (field.purpose) {
      case 'automationRef':
        return i18n._({ id: 'Automation', message: 'Automation' })
      case 'prompt':
        return i18n._({ id: 'Prompt', message: 'Prompt' })
      case 'model':
        return i18n._({ id: 'Model', message: 'Model' })
      case 'reasoning':
        return i18n._({ id: 'Reasoning', message: 'Reasoning' })
      case 'threadName':
        return i18n._({ id: 'Thread Name', message: 'Thread Name' })
      case 'timeoutSec':
        return i18n._({ id: 'Timeout (Seconds)', message: 'Timeout (Seconds)' })
      case 'script':
        return i18n._({ id: 'Shell / CMD Script', message: 'Shell / CMD Script' })
      case 'shell':
        return i18n._({ id: 'Shell', message: 'Shell' })
      case 'workdir':
        return i18n._({ id: 'Working Directory', message: 'Working Directory' })
      default:
        return firstNonEmpty(field.label, humanizeIdentifier(resolveExecutorFieldPayloadKey(field) || field.purpose))
    }
  }

  function resolveFieldHint(field: JobExecutorFormField) {
    switch (field.purpose) {
      case 'automationRef':
        return i18n._({
          id: 'Choose which existing Automation this job should run. Jobs create their own IDs automatically; this only links the job to an Automation target.',
          message:
            'Choose which existing Automation this job should run. Jobs create their own IDs automatically; this only links the job to an Automation target.',
        })
      case 'prompt':
        return i18n._({
          id: 'Enter the prompt that should be sent when this job runs.',
          message: 'Enter the prompt that should be sent when this job runs.',
        })
      case 'model':
        return automationField
          ? i18n._({
              id: 'Pick a workspace model above, type a custom model ID here, or leave it blank to reuse the selected Automation model.',
              message:
                'Pick a workspace model above, type a custom model ID here, or leave it blank to reuse the selected Automation model.',
            })
          : i18n._({
              id: 'Pick a workspace model above or type a custom model ID here.',
              message: 'Pick a workspace model above or type a custom model ID here.',
            })
      case 'reasoning':
        return i18n._({
          id: 'Choose the reasoning effort to use for this executor run.',
          message: 'Choose the reasoning effort to use for this executor run.',
        })
      case 'script':
        return i18n._({
          id: 'Enter the script body that should run in the selected workspace runtime.',
          message: 'Enter the script body that should run in the selected workspace runtime.',
        })
      case 'shell':
        return i18n._({
          id: 'Choose which shell runtime should execute the script.',
          message: 'Choose which shell runtime should execute the script.',
        })
      case 'workdir':
        return i18n._({
          id: 'Use a relative path inside the workspace. "." runs from the workspace root.',
          message: 'Use a relative path inside the workspace. "." runs from the workspace root.',
        })
      case 'threadName':
        return i18n._({
          id: 'Leave blank to reuse the job name when this prompt run creates a thread.',
          message: 'Leave blank to reuse the job name when this prompt run creates a thread.',
        })
      case 'timeoutSec':
        return i18n._({
          id: 'Leave blank to use the executor default timeout. The backend enforces the maximum value shown here.',
          message: 'Leave blank to use the executor default timeout. The backend enforces the maximum value shown here.',
        })
      default:
        return field.hint?.trim() || undefined
    }
  }

  function resolveFieldPlaceholder(field: JobExecutorFormField) {
    switch (field.purpose) {
      case 'model':
        return selectedAutomation?.model || readExecutorFieldDefaultString(field) || undefined
      case 'workdir':
        return field.placeholder?.trim() || '.'
      default:
        return field.placeholder?.trim() || undefined
    }
  }

  function resolveOptionLabel(field: JobExecutorFormField, option: JobExecutorFormFieldOption) {
    if (field.purpose === 'shell') {
      return describeShellOption(option.value)
    }
    if (field.purpose === 'reasoning') {
      return describeReasoningOption(option.value)
    }
    return option.label?.trim() || option.value
  }

  function buildSelectOptions(field: JobExecutorFormField): FieldOption[] {
    const optionValues =
      field.options?.map((option) => option.value.trim()).filter(Boolean) ??
      (field.purpose === 'shell' ? DEFAULT_SHELL_OPTION_VALUES : field.purpose === 'reasoning' ? DEFAULT_REASONING_OPTION_VALUES : [])

    const mappedOptions = optionValues.map((value) => {
      const option = field.options?.find((candidate) => candidate.value.trim() === value)
      return {
        value,
        label: option ? resolveOptionLabel(field, option) : field.purpose === 'shell' ? describeShellOption(value) : describeReasoningOption(value),
      }
    })

    if (executorFieldAllowsBlankValue(field) || (!field.required && !readExecutorFieldDefaultString(field))) {
      return [
        {
          value: '',
          label: readExecutorFieldBlankLabel(field) || i18n._({ id: 'Default', message: 'Default' }),
        },
        ...mappedOptions,
      ]
    }
    return mappedOptions
  }

  const modelFieldOptions = useMemo(() => {
    const workspaceModels =
      modelsQuery.data?.map((model) => ({
        value: model.id,
        label: model.name || model.id,
      })) ?? []
    return workspaceModels
  }, [modelsQuery.data])

  function buildModelOptions(field: JobExecutorFormField): FieldOption[] {
    const fieldValue = readFieldStringValue(field)
    const configuredOptions =
      field.options?.map((option) => ({
        value: option.value.trim(),
        label: option.label?.trim() || option.value.trim(),
      })) ?? []
    const baseOptions = dedupeOptions([...configuredOptions, ...modelFieldOptions])
    const customOption =
      executorFieldAllowsCustomValue(field) && fieldValue && !baseOptions.some((option) => option.value === fieldValue)
        ? [{ value: fieldValue, label: fieldValue }]
        : []
    const blankOption =
      executorFieldAllowsBlankValue(field) || (!field.required && !readExecutorFieldDefaultString(field))
        ? [
            {
              value: '',
              label:
                readExecutorFieldBlankLabel(field) ||
                i18n._({ id: 'Follow default model', message: 'Follow default model' }),
            },
          ]
        : []
    return [...blankOption, ...customOption, ...baseOptions]
  }

  function renderExecutorField(field: JobExecutorFormField) {
    if (executorFieldUsesWorkspaceAutomationCatalog(field)) {
      return renderWorkspaceAutomationDataSourceField(field)
    }
    if (executorFieldUsesWorkspaceModelCatalog(field)) {
      return renderWorkspaceModelDataSourceField(field)
    }

    switch (field.kind) {
      case 'textarea':
        return renderTextAreaField(field)
      case 'text':
        return renderTextField(field)
      case 'number':
        return renderNumberField(field)
      case 'select':
      case 'reasoning_select':
        return renderSelectField(field)
      case 'automation_select':
        return renderWorkspaceAutomationDataSourceField(field)
      case 'model_select':
        return renderWorkspaceModelDataSourceField(field)
      default:
        return renderUnsupportedField(field)
    }
  }

  function renderTextAreaField(field: JobExecutorFormField) {
    return (
      <TextArea
        key={fieldKey(field)}
        label={resolveFieldLabel(field)}
        value={readFieldRawStringValue(field)}
        rows={field.rows ?? 6}
        placeholder={resolveFieldPlaceholder(field)}
        onChange={(event) => setFieldValue(field, event.target.value)}
        hint={resolveFieldHint(field)}
      />
    )
  }

  function renderTextField(field: JobExecutorFormField) {
    return (
      <Input
        key={fieldKey(field)}
        label={resolveFieldLabel(field)}
        value={readFieldRawStringValue(field)}
        placeholder={resolveFieldPlaceholder(field)}
        onChange={(event) => setFieldValue(field, event.target.value)}
        hint={resolveFieldHint(field)}
      />
    )
  }

  function renderNumberField(field: JobExecutorFormField) {
    return (
      <Input
        key={fieldKey(field)}
        label={resolveFieldLabel(field)}
        type="number"
        min={field.min ?? 1}
        max={field.max ?? 3600}
        step={field.step ?? 1}
        value={readFieldNumberInputValue(field)}
        onChange={(event) =>
          setFieldValue(field, event.target.value.trim() ? Number(event.target.value) : null)
        }
        hint={resolveFieldHint(field)}
      />
    )
  }

  function renderSelectField(field: JobExecutorFormField) {
    const options = buildSelectOptions(field)
    return (
      <label className="field" key={fieldKey(field)}>
        <span>{resolveFieldLabel(field)}</span>
        <SelectControl
          ariaLabel={resolveFieldLabel(field)}
          fullWidth
          value={readFieldStringValue(field)}
          onChange={(nextValue) => setFieldValue(field, nextValue)}
          options={options}
        />
        {resolveFieldHint(field) ? <small className="field-hint">{resolveFieldHint(field)}</small> : null}
      </label>
    )
  }

  function renderWorkspaceAutomationDataSourceField(field: JobExecutorFormField) {
    const blankLabel =
      workspaceAutomations.length > 0
        ? readExecutorFieldBlankLabel(field) || i18n._({ id: 'Select Automation', message: 'Select Automation' })
        : i18n._({ id: 'No Automation Available', message: 'No Automation Available' })

    return (
      <label className="field" key={fieldKey(field)}>
        <span>{resolveFieldLabel(field)}</span>
        <SelectControl
          ariaLabel={resolveFieldLabel(field)}
          fullWidth
          value={selectedWorkspaceAutomation?.id ?? ''}
          onChange={(nextValue) => setFieldValue(field, nextValue)}
          options={[
            {
              value: '',
              label: blankLabel,
            },
            ...workspaceAutomations.map((automation) => ({
              value: automation.id,
              label: `${automation.title} · ${automation.id}`,
            })),
          ]}
          disabled={!workspaceAutomations.length}
        />
        {resolveFieldHint(field) ? <small className="field-hint">{resolveFieldHint(field)}</small> : null}
      </label>
    )
  }

  function renderWorkspaceModelDataSourceField(field: JobExecutorFormField) {
    const fieldValue = readFieldStringValue(field)
    const options = buildModelOptions(field)
    const showModelPresetSelect = options.some((option) => option.value.trim())
    const allowCustomValue = executorFieldAllowsCustomValue(field)
    return (
      <div className="field field--full" key={fieldKey(field)}>
        <label className="field-label" htmlFor={allowCustomValue ? modelInputId : undefined}>
          {resolveFieldLabel(field)}
        </label>
        <div style={{ display: 'grid', gap: 8 }}>
          {showModelPresetSelect ? (
            <SelectControl
              ariaLabel={resolveFieldLabel(field)}
              fullWidth
              value={fieldValue}
              onChange={(nextValue) => setFieldValue(field, nextValue)}
              options={options}
              disabled={!draft.workspaceId || modelsQuery.isLoading}
            />
          ) : null}
          {allowCustomValue ? (
            <Input
              id={modelInputId}
              list={showModelPresetSelect ? modelSuggestionsId : undefined}
              value={fieldValue}
              placeholder={resolveFieldPlaceholder(field)}
              onChange={(event) => setFieldValue(field, event.target.value)}
              hint={resolveFieldHint(field)}
            />
          ) : null}
          {allowCustomValue && showModelPresetSelect ? (
            <datalist id={modelSuggestionsId}>
              {options
                .filter((option) => option.value.trim())
                .map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
            </datalist>
          ) : null}
          {!allowCustomValue && resolveFieldHint(field) ? <small className="field-hint">{resolveFieldHint(field)}</small> : null}
        </div>
      </div>
    )
  }

  function renderUnsupportedField(field: JobExecutorFormField) {
    return (
      <InlineNotice key={fieldKey(field)} tone="info" title={resolveFieldLabel(field)}>
        {i18n._({
          id: 'This executor field is not yet editable in the structured form. Use Advanced Payload JSON to configure it.',
          message: 'This executor field is not yet editable in the structured form. Use Advanced Payload JSON to configure it.',
        })}
      </InlineNotice>
    )
  }

  function renderFieldRows(rows: FieldRow[]) {
    return rows.map((row) => {
      if (row.fields.length === 1) {
        return <Fragment key={row.key}>{renderExecutorField(row.fields[0])}</Fragment>
      }
      return (
        <div key={row.key} className="form-row" style={{ gridTemplateColumns: `repeat(${row.fields.length}, minmax(0, 1fr))`, alignItems: 'start' }}>
          {row.fields.map((field) => renderExecutorField(field))}
        </div>
      )
    })
  }

  return (
    <>
      <Input
        label={i18n._({ id: 'Job Name', message: 'Job Name' })}
        value={draft.name}
        onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
      />
      <label className="field">
        <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
        <SelectControl
          ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
          fullWidth
          value={draft.workspaceId}
          onChange={(nextValue) => setDraft((current) => ({ ...current, workspaceId: nextValue }))}
          options={workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
          }))}
        />
      </label>
      <TextArea
        label={i18n._({ id: 'Description', message: 'Description' })}
        value={draft.description}
        onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
      />
      <label className="field">
        <span>{i18n._({ id: 'Executor', message: 'Executor' })}</span>
        <SelectControl
          ariaLabel={i18n._({ id: 'Executor', message: 'Executor' })}
          fullWidth
          value={draft.executorKind}
          onChange={(nextKind) => {
            const executor = executors.find((item) => item.kind === nextKind) ?? null
            setDraft((current) => ({
              ...current,
              executorKind: nextKind,
              payload: JSON.stringify(executor?.examplePayload ?? {}, null, 2),
            }))
          }}
          options={executors.map((executor) => ({
            value: executor.kind,
            label: `${executor.title} · ${executor.kind}`,
          }))}
        />
      </label>

      {renderFieldRows(primaryFieldRows)}

      {automationField ? (
        <>
          <InlineNotice
            tone={
              usesPlaceholderAutomationId || (!workspaceAutomations.length && !linkedAutomationId)
                ? 'error'
                : selectedAutomation && selectedAutomation.workspaceId !== draft.workspaceId
                  ? 'error'
                  : 'info'
            }
            title={i18n._({ id: 'Automation Target', message: 'Automation Target' })}
          >
            {usesPlaceholderAutomationId
              ? i18n._({
                  id: 'The sample automation reference "{automationId}" is only a placeholder. Choose the Automation this job should run below, or replace it in Advanced Payload JSON.',
                  message:
                    'The sample automation reference "{automationId}" is only a placeholder. Choose the Automation this job should run below, or replace it in Advanced Payload JSON.',
                  values: { automationId: payloadAutomationId },
                })
              : !workspaceAutomations.length && !linkedAutomationId
                ? i18n._({
                    id: 'No Automations exist in this workspace yet. Create one on the Automations page first, then return here to schedule or rerun it.',
                    message:
                      'No Automations exist in this workspace yet. Create one on the Automations page first, then return here to schedule or rerun it.',
                  })
                : selectedAutomation && selectedAutomation.workspaceId !== draft.workspaceId
                  ? i18n._({
                      id: 'The currently linked Automation belongs to a different workspace. Choose an Automation from the selected workspace before saving.',
                      message:
                        'The currently linked Automation belongs to a different workspace. Choose an Automation from the selected workspace before saving.',
                    })
                  : selectedAutomation
                    ? i18n._({
                        id: 'This job will run Automation "{title}". Edit its prompt on the Automations page. Default model: {model}. Reasoning: {reasoning}.',
                        message:
                          'This job will run Automation "{title}". Edit its prompt on the Automations page. Default model: {model}. Reasoning: {reasoning}.',
                        values: {
                          title: selectedAutomation.title,
                          model: selectedAutomation.model,
                          reasoning: selectedAutomation.reasoning,
                        },
                      })
                    : linkedAutomationId
                      ? i18n._({
                          id: 'This job is already linked to Automation "{automationId}". You only need Advanced Payload JSON if you want to override that Automation target.',
                          message:
                            'This job is already linked to Automation "{automationId}". You only need Advanced Payload JSON if you want to override that Automation target.',
                          values: { automationId: linkedAutomationId },
                        })
                      : i18n._({
                          id: 'Choose which Automation this job should run below. Advanced Payload JSON is optional and only needed for manual overrides.',
                          message:
                            'Choose which Automation this job should run below. Advanced Payload JSON is optional and only needed for manual overrides.',
                        })}
          </InlineNotice>
          {selectedAutomation ? (
            <TextArea
              label={i18n._({ id: 'Selected Automation Prompt', message: 'Selected Automation Prompt' })}
              value={selectedAutomation.prompt}
              rows={6}
              readOnly
              hint={i18n._({
                id: 'Edit this prompt on the Automations page. This job runs the selected Automation configuration as-is.',
                message:
                  'Edit this prompt on the Automations page. This job runs the selected Automation configuration as-is.',
              })}
            />
          ) : null}
        </>
      ) : null}

      {advancedFieldRows.length ? (
        <div className="field field--full">
          <button
            type="button"
            className="ide-button ide-button--secondary"
            onClick={() => setShowAdvancedFields((current) => !current)}
          >
            {showAdvancedFields
              ? i18n._({ id: 'Hide Advanced Executor Fields', message: 'Hide Advanced Executor Fields' })
              : i18n._({ id: 'Show Advanced Executor Fields', message: 'Show Advanced Executor Fields' })}
          </button>
        </div>
      ) : null}
      {showAdvancedFields ? renderFieldRows(advancedFieldRows) : null}

      {hasStructuredPayloadForm ? (
        <div className="field field--full">
          <button
            type="button"
            className="ide-button ide-button--secondary"
            onClick={() => setShowAdvancedPayload((current) => !current)}
          >
            {showAdvancedPayload
              ? i18n._({ id: 'Hide Advanced Payload JSON', message: 'Hide Advanced Payload JSON' })
              : i18n._({ id: 'Edit Advanced Payload JSON', message: 'Edit Advanced Payload JSON' })}
          </button>
        </div>
      ) : null}
      {showAdvancedPayload || !hasStructuredPayloadForm ? (
        <TextArea
          label={
            hasStructuredPayloadForm
              ? i18n._({ id: 'Advanced Payload JSON', message: 'Advanced Payload JSON' })
              : i18n._({ id: 'Payload JSON', message: 'Payload JSON' })
          }
          value={draft.payload}
          rows={hasStructuredPayloadForm ? 10 : 12}
          onChange={(event) => setDraft((current) => ({ ...current, payload: event.target.value }))}
          hint={
            hasStructuredPayloadForm
              ? i18n._({
                  id: 'Edit the raw payload JSON for advanced executor configuration.',
                  message: 'Edit the raw payload JSON for advanced executor configuration.',
                })
              : undefined
          }
        />
      ) : null}
      {currentExecutor ? (
        <InlineNotice tone="info" title={currentExecutor.title}>
          {currentExecutor.description}
        </InlineNotice>
      ) : null}
      {currentExecutor?.payloadSchema ? (
        <TextArea
          label={i18n._({ id: 'Executor Schema', message: 'Executor Schema' })}
          value={JSON.stringify(currentExecutor.payloadSchema, null, 2)}
          rows={10}
          readOnly
        />
      ) : null}
    </>
  )
}

const DEFAULT_SHELL_OPTION_VALUES = ['auto', 'pwsh', 'powershell', 'cmd', 'bash', 'sh', 'zsh', 'git-bash', 'wsl']
const DEFAULT_REASONING_OPTION_VALUES = ['low', 'medium', 'high', 'xhigh']

function buildExecutorFieldRows(fields: JobExecutorFormField[]): FieldRow[] {
  const rows: FieldRow[] = []
  let currentGroup = ''
  let currentFields: JobExecutorFormField[] = []

  for (const field of fields) {
    const group = field.group?.trim() ?? ''
    if (!group) {
      if (currentFields.length) {
        rows.push({ key: currentFields.map(fieldKey).join(':'), fields: currentFields })
        currentFields = []
        currentGroup = ''
      }
      rows.push({ key: fieldKey(field), fields: [field] })
      continue
    }

    if (!currentFields.length) {
      currentFields = [field]
      currentGroup = group
      continue
    }

    if (currentGroup === group && currentFields.length < 2) {
      currentFields = [...currentFields, field]
      continue
    }

    rows.push({ key: currentFields.map(fieldKey).join(':'), fields: currentFields })
    currentFields = [field]
    currentGroup = group
  }

  if (currentFields.length) {
    rows.push({ key: currentFields.map(fieldKey).join(':'), fields: currentFields })
  }

  return rows
}

function fieldKey(field: JobExecutorFormField) {
  return firstNonEmpty(resolveExecutorFieldPayloadKey(field), field.purpose, field.kind)
}

function dedupeOptions(options: FieldOption[]) {
  const seen = new Set<string>()
  const deduped: FieldOption[] = []
  for (const option of options) {
    const value = option.value.trim()
    if (!value || seen.has(value)) {
      continue
    }
    seen.add(value)
    deduped.push(option)
  }
  return deduped
}

function humanizeIdentifier(value: string) {
  if (!value.trim()) {
    return ''
  }
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase())
}

function describeShellOption(value: string) {
  switch (value) {
    case 'auto':
      return i18n._({ id: 'Auto (Recommended)', message: 'Auto (Recommended)' })
    case 'pwsh':
      return i18n._({ id: 'PowerShell Core', message: 'PowerShell Core' })
    case 'powershell':
      return i18n._({ id: 'Windows PowerShell', message: 'Windows PowerShell' })
    case 'cmd':
      return i18n._({ id: 'Windows CMD', message: 'Windows CMD' })
    case 'bash':
      return i18n._({ id: 'Bash', message: 'Bash' })
    case 'sh':
      return i18n._({ id: 'POSIX sh', message: 'POSIX sh' })
    case 'zsh':
      return i18n._({ id: 'Zsh', message: 'Zsh' })
    case 'git-bash':
      return i18n._({ id: 'Git Bash', message: 'Git Bash' })
    case 'wsl':
      return i18n._({ id: 'WSL', message: 'WSL' })
    default:
      return value
  }
}

function describeReasoningOption(value: string) {
  switch (value) {
    case 'low':
      return i18n._({ id: 'Low', message: 'Low' })
    case 'medium':
      return i18n._({ id: 'Medium', message: 'Medium' })
    case 'high':
      return i18n._({ id: 'High', message: 'High' })
    case 'xhigh':
      return i18n._({ id: 'Extra High', message: 'Extra High' })
    default:
      return value
  }
}
