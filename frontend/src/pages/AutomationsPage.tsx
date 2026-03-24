import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { CronGenerator } from '../components/ui/CronGenerator'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { Input } from '../components/ui/Input'
import { TextArea } from '../components/ui/TextArea'
import {
  createAutomation,
  createAutomationTemplate,
  deleteAutomation,
  deleteAutomationTemplate,
  fixAutomation,
  listAutomations,
  listAutomationTemplates,
  pauseAutomation,
  resumeAutomation,
  type TemplateInput,
  updateAutomationTemplate,
} from '../features/automations/api'
import {
  type AutomationRecord,
  type AutomationTemplate,
} from '../features/automations/store'
import { listWorkspaces } from '../features/workspaces/api'
import { listModels } from '../features/catalog/api'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'

type Draft = {
  title: string
  description: string
  prompt: string
  workspaceId: string
  schedule: string
  model: string
  reasoning: string
}

type TemplateDraft = {
  title: string
  description: string
  prompt: string
  category: string
}

type AutomationActionInput = {
  id: string
  action: 'pause' | 'resume' | 'fix'
}

type UpdateAutomationTemplateInput = {
  templateId: string
  input: TemplateInput
}

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  prompt: '',
  workspaceId: '',
  schedule: 'hourly',
  model: 'gpt-5.4',
  reasoning: 'medium',
}

function createEmptyTemplateDraft(): TemplateDraft {
  return {
    title: '',
    description: '',
    prompt: '',
    category: i18n._({ id: 'Custom', message: 'Custom' }),
  }
}

function getAutomationFrequencyOptions() {
  return [
    { value: 'hourly', label: i18n._({ id: 'Hourly', message: 'Hourly' }) },
    { value: 'daily', label: i18n._({ id: 'Daily', message: 'Daily' }) },
    { value: 'weekly', label: i18n._({ id: 'Weekly', message: 'Weekly' }) },
    { value: 'monthly', label: i18n._({ id: 'Monthly', message: 'Monthly' }) },
    {
      value: 'cron',
      label: i18n._({ id: 'Advanced (Cron)', message: 'Advanced (Cron)' }),
    },
  ]
}

function getAutomationWeekdayOptions() {
  return [
    { value: '0', label: i18n._({ id: 'Sunday', message: 'Sunday' }) },
    { value: '1', label: i18n._({ id: 'Monday', message: 'Monday' }) },
    { value: '2', label: i18n._({ id: 'Tuesday', message: 'Tuesday' }) },
    { value: '3', label: i18n._({ id: 'Wednesday', message: 'Wednesday' }) },
    { value: '4', label: i18n._({ id: 'Thursday', message: 'Thursday' }) },
    { value: '5', label: i18n._({ id: 'Friday', message: 'Friday' }) },
    { value: '6', label: i18n._({ id: 'Saturday', message: 'Saturday' }) },
  ]
}

function getAutomationReasoningOptions() {
  return [
    { value: 'low', label: i18n._({ id: 'Low', message: 'Low' }) },
    { value: 'medium', label: i18n._({ id: 'Medium', message: 'Medium' }) },
    { value: 'high', label: i18n._({ id: 'High', message: 'High' }) },
    { value: 'xhigh', label: i18n._({ id: 'Extra High', message: 'Extra High' }) },
  ]
}

function getScheduleType(schedule: string) {
  if (schedule === '0 * * * *' || schedule === 'hourly') {
    return 'hourly'
  }

  if (schedule.startsWith('daily-')) {
    return 'daily'
  }

  if (schedule.startsWith('weekly-')) {
    return 'weekly'
  }

  if (schedule.startsWith('monthly-')) {
    return 'monthly'
  }

  return 'cron'
}

export function AutomationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTemplate, setActiveTemplate] = useState<AutomationTemplate | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>(() => createEmptyTemplateDraft())
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [cronPickerOpen, setCronPickerOpen] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<AutomationRecord | null>(null)
  const [isTemplatesVisible, setIsTemplatesVisible] = useState(true)
  const [error, setError] = useState('')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  const modelsQuery = useQuery({
    queryKey: ['models', draft.workspaceId],
    queryFn: () => listModels(draft.workspaceId),
    enabled: !!draft.workspaceId,
  })

  // Handle model reset when workspace changes
  useMemo(() => {
    if (modelsQuery.data?.length && !draft.model) {
      setDraft((current) => ({ ...current, model: modelsQuery.data[0].id }))
    } else if (modelsQuery.data?.length && !modelsQuery.data.some(m => m.id === draft.model)) {
      // If the currently selected model is not in the new models list, reset it
      setDraft((current) => ({ ...current, model: modelsQuery.data[0].id }))
    }
  }, [modelsQuery.data, draft.workspaceId])
  const automationsQuery = useQuery({
    queryKey: ['automations'],
    queryFn: listAutomations,
    refetchInterval: 10_000,
  })
  const templatesQuery = useQuery({
    queryKey: ['automation-templates'],
    queryFn: listAutomationTemplates,
  })

  const createAutomationMutation = useMutation({
    mutationFn: createAutomation,
    onSuccess: async (automation) => {
      queryClient.setQueryData(['automation', automation.id], automation)
      closeModal()
      navigate(`/automations/${automation.id}`)
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })
  const automationActionMutation = useMutation({
    mutationFn: async (input: AutomationActionInput) => {
      switch (input.action) {
        case 'pause':
          return pauseAutomation(input.id)
        case 'resume':
          return resumeAutomation(input.id)
        default:
          return fixAutomation(input.id)
      }
    },
    onSuccess: async (automation) => {
      queryClient.setQueryData(['automation', automation.id], automation)
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })
  const deleteAutomationMutation = useMutation({
    mutationFn: (automationId: string) => deleteAutomation(automationId),
    onSuccess: async (_, automationId) => {
      setConfirmingDelete(null)
      deleteAutomationMutation.reset()
      queryClient.removeQueries({ queryKey: ['automation', automationId] })
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })
  const createTemplateMutation = useMutation({
    mutationFn: createAutomationTemplate,
    onSuccess: async () => {
      setTemplateModalOpen(false)
      setEditingTemplateId(null)
      setTemplateDraft(createEmptyTemplateDraft())
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['automation-templates'] })
    },
  })
  const updateTemplateMutation = useMutation({
    mutationFn: ({ templateId, input }: UpdateAutomationTemplateInput) =>
      updateAutomationTemplate(templateId, input),
    onSuccess: async () => {
      setTemplateModalOpen(false)
      setEditingTemplateId(null)
      setTemplateDraft(createEmptyTemplateDraft())
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['automation-templates'] })
    },
  })
  const deleteTemplateMutation = useMutation({
    mutationFn: (templateId: string) => deleteAutomationTemplate(templateId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['automation-templates'] })
    },
  })

  const automations = automationsQuery.data ?? []
  const templates = templatesQuery.data ?? []
  const groupedTemplates = useMemo(() => {
    return templates.reduce<Record<string, AutomationTemplate[]>>((groups, template) => {
      const current = groups[template.category] ?? []
      groups[template.category] = [...current, template]
      return groups
    }, {})
  }, [templates])

  const activeAutomationsCount = automations.filter((automation) => automation.status === 'active').length
  const templateCount = templates.length
  const createError = error || (createAutomationMutation.error ? getErrorMessage(createAutomationMutation.error) : '')
  const templateError =
    error ||
    (createTemplateMutation.error
      ? getErrorMessage(createTemplateMutation.error)
      : updateTemplateMutation.error
        ? getErrorMessage(updateTemplateMutation.error)
        : deleteTemplateMutation.error
          ? getErrorMessage(deleteTemplateMutation.error)
          : '')
  const actionTarget = automationActionMutation.isPending ? automationActionMutation.variables : null
  const frequencyOptions = getAutomationFrequencyOptions()
  const weekdayOptions = getAutomationWeekdayOptions()
  const reasoningOptions = getAutomationReasoningOptions()

  function openCreateModal(template?: AutomationTemplate) {
    createAutomationMutation.reset()
    setActiveTemplate(template ?? null)
    setDraft({
      title: template?.title ?? '',
      description: template?.description ?? '',
      prompt: template?.prompt ?? '',
      workspaceId: workspacesQuery.data?.[0]?.id ?? '',
      schedule: 'hourly',
      model: 'gpt-5.4',
      reasoning: 'medium',
    })
    setModalOpen(true)
    setError('')
  }

  function handleTemplateSelect(templateId: string) {
    const selected = templates.find((template) => template.id === templateId)
    if (!selected) {
      setActiveTemplate(null)
      return
    }

    setActiveTemplate(selected)
    setDraft((current) => ({
      ...current,
      title: selected.title,
      description: selected.description,
      prompt: selected.prompt,
    }))
  }

  function handleCreateTemplate() {
    if (!templateDraft.title.trim() || !templateDraft.prompt.trim()) {
      setError(
        i18n._({
          id: 'Title and prompt are required for templates.',
          message: 'Title and prompt are required for templates.',
        }),
      )
      return
    }

    if (editingTemplateId) {
      updateTemplateMutation.mutate({
        templateId: editingTemplateId,
        input: templateDraft,
      })
    } else {
      createTemplateMutation.mutate(templateDraft)
    }
  }

  function openEditTemplateModal(template: AutomationTemplate) {
    if (template.isBuiltIn) {
      return
    }

    setTemplateDraft({
      title: template.title,
      description: template.description,
      prompt: template.prompt,
      category: template.category,
    })
    setEditingTemplateId(template.id)
    setTemplateModalOpen(true)
    setError('')
  }

  function handleDeleteTemplate(id: string) {
    deleteTemplateMutation.mutate(id)
  }

  function closeModal() {
    setModalOpen(false)
    setActiveTemplate(null)
    setDraft(EMPTY_DRAFT)
    setError('')
    createAutomationMutation.reset()
  }

  function submitCreate() {
    createAutomationMutation.reset()
    const workspace = workspacesQuery.data?.find((item) => item.id === draft.workspaceId)
    if (!workspace) {
      setError(
        i18n._({
          id: 'Select a workspace before creating an automation.',
          message: 'Select a workspace before creating an automation.',
        }),
      )
      return
    }

    if (!draft.title.trim() || !draft.prompt.trim()) {
      setError(
        i18n._({
          id: 'Title and prompt are required.',
          message: 'Title and prompt are required.',
        }),
      )
      return
    }

    setError('')
    createAutomationMutation.mutate({
      title: draft.title.trim(),
      description:
        draft.description.trim() ||
        i18n._({
          id: 'Automation created from the web IDE prototype.',
          message: 'Automation created from the web IDE prototype.',
        }),
      prompt: draft.prompt.trim(),
      workspaceId: workspace.id,
      schedule: draft.schedule,
      model: draft.model,
      reasoning: draft.reasoning,
    })
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    submitCreate()
  }

  function handlePause(id: string) {
    automationActionMutation.mutate({ id, action: 'pause' })
  }

  function handleResume(id: string) {
    automationActionMutation.mutate({ id, action: 'resume' })
  }

  function handleFix(id: string) {
    automationActionMutation.mutate({ id, action: 'fix' })
  }

  function handleDelete(record: AutomationRecord) {
    deleteAutomationMutation.reset()
    setConfirmingDelete(record)
  }

  function confirmDelete() {
    if (!confirmingDelete || deleteAutomationMutation.isPending) {
      return
    }

    deleteAutomationMutation.mutate(confirmingDelete.id)
  }

  const modalFooter = (
    <>
      <Button intent="secondary" onClick={closeModal}>
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button isLoading={createAutomationMutation.isPending} onClick={submitCreate}>
        {i18n._({ id: 'Create Automation', message: 'Create Automation' })}
      </Button>
    </>
  )

  const templateModalFooter = (
    <>
      <Button
        intent="secondary"
        onClick={() => {
          setTemplateModalOpen(false)
          setEditingTemplateId(null)
          setError('')
          setTemplateDraft(createEmptyTemplateDraft())
          createTemplateMutation.reset()
          updateTemplateMutation.reset()
        }}
      >
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        isLoading={createTemplateMutation.isPending || updateTemplateMutation.isPending}
        onClick={handleCreateTemplate}
      >
        {editingTemplateId
          ? i18n._({ id: 'Update Template', message: 'Update Template' })
          : i18n._({ id: 'Save Template', message: 'Save Template' })}
      </Button>
    </>
  )

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">
            {i18n._({ id: 'Automations', message: 'Automations' })}
          </div>
          <div className="mode-strip__title-row">
            <strong>{i18n._({ id: 'Automation Studio', message: 'Automation Studio' })}</strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: 'Create scheduled automations from reusable templates and manage workbench objects.',
              message:
                'Create scheduled automations from reusable templates and manage workbench objects.',
            })}
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>{i18n._({ id: 'Active', message: 'Active' })}</span>
              <strong>{activeAutomationsCount}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: 'Templates', message: 'Templates' })}</span>
              <strong>{templateCount}</strong>
            </div>
          </div>
          <Button onClick={() => openCreateModal()}>
            {i18n._({ id: 'New Automation', message: 'New Automation' })}
          </Button>
        </div>
      </header>

      <div className="stack-screen">
        {automationsQuery.isLoading ? (
          <div className="notice">
            {i18n._({ id: 'Loading automations…', message: 'Loading automations…' })}
          </div>
        ) : null}
        {automationsQuery.error ? (
          <InlineNotice
            dismissible
            noticeKey={`automation-list-${getErrorMessage(automationsQuery.error)}`}
            title={i18n._({
              id: 'Automation Loading Failed',
              message: 'Automation Loading Failed',
            })}
            tone="error"
          >
            {getErrorMessage(automationsQuery.error)}
          </InlineNotice>
        ) : null}
        {templatesQuery.error ? (
          <InlineNotice
            dismissible
            noticeKey={`automation-templates-${getErrorMessage(templatesQuery.error)}`}
            title={i18n._({
              id: 'Template Loading Failed',
              message: 'Template Loading Failed',
            })}
            tone="error"
          >
            {getErrorMessage(templatesQuery.error)}
          </InlineNotice>
        ) : null}

        {automations.length > 0 ? (
          <section className="content-section">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Active Automations', message: 'Active Automations' })}</h2>
              </div>
              <div className="section-header__meta">{automations.length}</div>
            </div>
            <div className="automation-compact-list">
              {automations.map((automation) => (
                <div className="automation-compact-row" key={automation.id}>
                  <Link className="automation-compact-row__main" to={`/automations/${automation.id}`}>
                    <strong>{automation.title}</strong>
                    <span>{automation.workspaceName}</span>
                  </Link>
                  <div className="automation-compact-row__actions">
                    <StatusPill status={automation.status} />
                    <div className="divider-v" />
                    <Button
                      intent="ghost"
                      isLoading={actionTarget?.id === automation.id && actionTarget.action === 'fix'}
                      onClick={() => handleFix(automation.id)}
                    >
                      {i18n._({ id: 'Fix', message: 'Fix' })}
                    </Button>
                    {automation.status === 'active' ? (
                      <Button
                        intent="ghost"
                        isLoading={actionTarget?.id === automation.id && actionTarget.action === 'pause'}
                        onClick={() => handlePause(automation.id)}
                      >
                        {i18n._({ id: 'Pause', message: 'Pause' })}
                      </Button>
                    ) : (
                      <Button
                        intent="ghost"
                        isLoading={actionTarget?.id === automation.id && actionTarget.action === 'resume'}
                        onClick={() => handleResume(automation.id)}
                      >
                        {i18n._({ id: 'Resume', message: 'Resume' })}
                      </Button>
                    )}
                    <Button
                      className="ide-button--ghost-danger"
                      intent="ghost"
                      onClick={() => handleDelete(automation)}
                    >
                      {i18n._({ id: 'Delete', message: 'Delete' })}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>{i18n._({ id: 'Capability Templates', message: 'Capability Templates' })}</h2>
            </div>
            <div className="section-header__actions">
              <Button intent="ghost" onClick={() => setTemplateModalOpen(true)}>
                {i18n._({ id: 'New Template', message: 'New Template' })}
              </Button>
              <Button intent="ghost" onClick={() => setIsTemplatesVisible((current) => !current)}>
                {isTemplatesVisible
                  ? i18n._({ id: 'Hide Templates', message: 'Hide Templates' })
                  : i18n._({ id: 'Show Templates', message: 'Show Templates' })}
              </Button>
            </div>
          </div>

          {isTemplatesVisible ? (
            <div className="automation-template-list">
              {Object.entries(groupedTemplates).map(([category, templatesInCategory]) => (
                <div className="automation-category-group" key={category}>
                  <div className="automation-category-label">{category}</div>
                  <div className="automation-template-items">
                    {templatesInCategory.map((template) => (
                      <div className="automation-compact-row" key={template.id}>
                        <div className="automation-compact-row__main">
                          <strong>{template.title}</strong>
                          <span>{template.description}</span>
                        </div>
                        <div className="automation-compact-row__actions">
                          <Button intent="ghost" onClick={() => openCreateModal(template)}>
                            {i18n._({ id: 'Use Template', message: 'Use Template' })}
                          </Button>
                          {!template.isBuiltIn ? (
                            <>
                              <Button intent="ghost" onClick={() => openEditTemplateModal(template)}>
                                {i18n._({ id: 'Edit', message: 'Edit' })}
                              </Button>
                              <Button
                                className="ide-button--ghost-danger"
                                intent="ghost"
                                isLoading={deleteTemplateMutation.isPending && deleteTemplateMutation.variables === template.id}
                                onClick={() => handleDeleteTemplate(template.id)}
                              >
                                {i18n._({ id: 'Delete', message: 'Delete' })}
                              </Button>
                            </>
                          ) : (
                            <span className="meta-pill">
                              {i18n._({ id: 'Built-in', message: 'Built-in' })}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {modalOpen ? (
        <Modal
          footer={modalFooter}
          onClose={closeModal}
          title={
            activeTemplate?.title ??
            i18n._({ id: 'New Automation', message: 'New Automation' })
          }
        >
          <form className="form-stack" onSubmit={handleCreate}>
            <div className="form-row">
              <label className="field">
                <span>{i18n._({ id: 'Capability Template', message: 'Capability Template' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Select a template', message: 'Select a template' })}
                  fullWidth
                  onChange={handleTemplateSelect}
                  options={[
                    {
                      value: '',
                      label: i18n._({
                        id: 'None (Start from scratch)',
                        message: 'None (Start from scratch)',
                      }),
                    },
                    ...templates.map((template) => ({ value: template.id, label: `[${template.category}] ${template.title}` })),
                  ]}
                  value={activeTemplate?.id ?? ''}
                />
              </label>
              <label className="field">
                <span>{i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
                  fullWidth
                  onChange={(nextValue) =>
                    setDraft((current) => ({ ...current, workspaceId: nextValue }))
                  }
                  options={(workspacesQuery.data ?? []).map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  }))}
                  value={draft.workspaceId}
                />
              </label>
            </div>

            <div className="form-row">
              <Input
                label={i18n._({ id: 'Title', message: 'Title' })}
                onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={i18n._({ id: 'Daily Sync', message: 'Daily Sync' })}
                value={draft.title}
              />
              <Input
                label={i18n._({ id: 'Description', message: 'Description' })}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder={i18n._({
                  id: "Briefly describe the automation's purpose...",
                  message: "Briefly describe the automation's purpose...",
                })}
                value={draft.description}
              />
            </div>

            <TextArea
              label={i18n._({ id: 'Prompt', message: 'Prompt' })}
              onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
              placeholder={i18n._({
                id: 'What should the assistant do?',
                message: 'What should the assistant do?',
              })}
              rows={5}
              value={draft.prompt}
            />

            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
              <div className="field">
                <span>{i18n._({ id: 'Frequency', message: 'Frequency' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Frequency', message: 'Frequency' })}
                  fullWidth
                  onChange={(nextValue) => {
                    let baseSchedule = '0 * * * *'
                    if (nextValue === 'daily') baseSchedule = 'daily-0900'
                    if (nextValue === 'weekly') baseSchedule = 'weekly-1-0900'
                    if (nextValue === 'monthly') baseSchedule = 'monthly-01-0900'
                    if (nextValue === 'cron') baseSchedule = '0 9 * * 1-5'
                    setDraft((current) => ({ ...current, schedule: baseSchedule }))
                  }}
                  options={frequencyOptions}
                  value={getScheduleType(draft.schedule)}
                />
              </div>

              {/* Dynamic sub-controls based on Frequency */}
              {draft.schedule.startsWith('daily-') && (
                <Input
                  label={i18n._({ id: 'Run Time', message: 'Run Time' })}
                  type="time"
                  onChange={(e) => {
                    const [hh, mm] = e.target.value.split(':')
                    setDraft((current) => ({ ...current, schedule: `daily-${hh}${mm}` }))
                  }}
                  value={`${draft.schedule.slice(6, 8)}:${draft.schedule.slice(8, 10)}`}
                />
              )}

              {draft.schedule.startsWith('weekly-') && (
                <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div className="field">
                    <span>{i18n._({ id: 'Day', message: 'Day' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Day of Week', message: 'Day of Week' })}
                      fullWidth
                      onChange={(day) => {
                        const time = draft.schedule.slice(9)
                        setDraft((current) => ({ ...current, schedule: `weekly-${day}-${time}` }))
                      }}
                      options={weekdayOptions}
                      value={draft.schedule.slice(7, 8)}
                    />
                  </div>
                  <Input
                    label={i18n._({ id: 'Time', message: 'Time' })}
                    type="time"
                    onChange={(e) => {
                      const [hh, mm] = e.target.value.split(':')
                      const day = draft.schedule.slice(7, 8)
                      setDraft((current) => ({ ...current, schedule: `weekly-${day}-${hh}${mm}` }))
                    }}
                    value={`${draft.schedule.slice(9, 11)}:${draft.schedule.slice(11, 13)}`}
                  />
                </div>
              )}

              {draft.schedule.startsWith('monthly-') && (
                <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <Input
                    label={i18n._({ id: 'Day of Month', message: 'Day of Month' })}
                    type="number"
                    min="1"
                    max="31"
                    onChange={(e) => {
                      const day = e.target.value.padStart(2, '0')
                      const time = draft.schedule.slice(11)
                      setDraft((current) => ({ ...current, schedule: `monthly-${day}-${time}` }))
                    }}
                    value={draft.schedule.slice(8, 10)}
                  />
                  <Input
                    label={i18n._({ id: 'Time', message: 'Time' })}
                    type="time"
                    onChange={(e) => {
                      const [hh, mm] = e.target.value.split(':')
                      const day = draft.schedule.slice(8, 10)
                      setDraft((current) => ({ ...current, schedule: `monthly-${day}-${hh}${mm}` }))
                    }}
                    value={`${draft.schedule.slice(11, 13)}:${draft.schedule.slice(13, 15)}`}
                  />
                </div>
              )}

              {!(draft.schedule === '0 * * * *' || draft.schedule === 'hourly' || draft.schedule.startsWith('daily-') || draft.schedule.startsWith('weekly-') || draft.schedule.startsWith('monthly-')) && (
                <div className="field">
                  <span>{i18n._({ id: 'Advanced Scheduling', message: 'Advanced Scheduling' })}</span>
                  <div className="cron-trigger-area">
                    <code>{draft.schedule}</code>
                    <Button intent="secondary" size="sm" onClick={() => setCronPickerOpen(true)}>
                      {i18n._({ id: 'Edit', message: 'Edit' })}
                    </Button>
                  </div>
                </div>
              )}

              {draft.schedule === '0 * * * *' || draft.schedule === 'hourly' ? (
                <div className="field">
                  <span>{i18n._({ id: 'Interval', message: 'Interval' })}</span>
                  <div style={{ padding: '12px 0', fontSize: '0.86rem', color: 'var(--text-muted)' }}>
                    {i18n._({
                      id: 'Runs once per hour, on the hour.',
                      message: 'Runs once per hour, on the hour.',
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
              <label className="field">
                <span>{i18n._({ id: 'Model', message: 'Model' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Model', message: 'Model' })}
                  fullWidth
                  onChange={(nextValue) =>
                    setDraft((current) => ({ ...current, model: nextValue }))
                  }
                  options={
                    modelsQuery.data?.map((m) => ({
                      value: m.id,
                      label: m.name || m.id,
                    })) ?? []
                  }
                  value={draft.model}
                  disabled={modelsQuery.isLoading || !draft.workspaceId}
                />
              </label>
              <label className="field">
                <span>{i18n._({ id: 'Reasoning', message: 'Reasoning' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Reasoning', message: 'Reasoning' })}
                  fullWidth
                  onChange={(nextValue) =>
                    setDraft((current) => ({ ...current, reasoning: nextValue }))
                  }
                  options={reasoningOptions}
                  value={draft.reasoning}
                />
              </label>
            </div>
            {createError ? (
              <InlineNotice
                dismissible
                noticeKey={`automation-create-${createError}`}
                title={i18n._({
                  id: 'Automation Setup Incomplete',
                  message: 'Automation Setup Incomplete',
                })}
                tone="error"
              >
                {createError}
              </InlineNotice>
            ) : null}
          </form>
        </Modal>
      ) : null}

      {templateModalOpen ? (
        <Modal
          description={
            editingTemplateId
              ? i18n._({
                  id: 'Update this reusable automation pattern.',
                  message: 'Update this reusable automation pattern.',
                })
              : i18n._({
                  id: 'Create a reusable automation pattern that can be used across different workspaces.',
                  message:
                    'Create a reusable automation pattern that can be used across different workspaces.',
                })
          }
          footer={templateModalFooter}
          onClose={() => {
            setTemplateModalOpen(false)
            setEditingTemplateId(null)
            setError('')
            setTemplateDraft(createEmptyTemplateDraft())
          }}
          title={
            editingTemplateId
              ? i18n._({
                  id: 'Edit Capability Template',
                  message: 'Edit Capability Template',
                })
              : i18n._({
                  id: 'New Capability Template',
                  message: 'New Capability Template',
                })
          }
        >
          <div className="form-stack">
            <div className="form-row">
              <Input
                label={i18n._({ id: 'Template Title', message: 'Template Title' })}
                onChange={(event) => setTemplateDraft((current) => ({ ...current, title: event.target.value }))}
                placeholder={i18n._({
                  id: 'e.g. Security Audit',
                  message: 'e.g. Security Audit',
                })}
                value={templateDraft.title}
              />
              <Input
                label={i18n._({ id: 'Category', message: 'Category' })}
                onChange={(event) => setTemplateDraft((current) => ({ ...current, category: event.target.value }))}
                placeholder={i18n._({ id: 'e.g. Security', message: 'e.g. Security' })}
                value={templateDraft.category}
              />
            </div>
            <Input
              label={i18n._({ id: 'Description', message: 'Description' })}
              onChange={(event) => setTemplateDraft((current) => ({ ...current, description: event.target.value }))}
              placeholder={i18n._({
                id: 'What does this pattern do?',
                message: 'What does this pattern do?',
              })}
              value={templateDraft.description}
            />
            <TextArea
              label={i18n._({ id: 'Template Prompt', message: 'Template Prompt' })}
              onChange={(event) => setTemplateDraft((current) => ({ ...current, prompt: event.target.value }))}
              placeholder={i18n._({
                id: 'Define the logic/instructions for this template...',
                message: 'Define the logic/instructions for this template...',
              })}
              rows={6}
              value={templateDraft.prompt}
            />
            {templateError ? (
              <InlineNotice
                dismissible
                noticeKey={`automation-template-${templateError}`}
                title={i18n._({
                  id: 'Template Update Failed',
                  message: 'Template Update Failed',
                })}
                tone="error"
              >
                {templateError}
              </InlineNotice>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {confirmingDelete ? (
        <ConfirmDialog
          confirmLabel={i18n._({
            id: 'Delete Automation',
            message: 'Delete Automation',
          })}
          description={i18n._({
            id: 'This will permanently remove the automation record. This action cannot be undone.',
            message:
              'This will permanently remove the automation record. This action cannot be undone.',
          })}
          error={deleteAutomationMutation.error ? getErrorMessage(deleteAutomationMutation.error) : null}
          isPending={deleteAutomationMutation.isPending}
          onClose={() => {
            if (!deleteAutomationMutation.isPending) {
              setConfirmingDelete(null)
              deleteAutomationMutation.reset()
            }
          }}
          onConfirm={confirmDelete}
          subject={confirmingDelete.title}
          title={i18n._({
            id: 'Delete Automation?',
            message: 'Delete Automation?',
          })}
        />
      ) : null}

      {cronPickerOpen ? (
        <Modal
          onClose={() => setCronPickerOpen(false)}
          title={i18n._({
            id: 'Configure Advanced Schedule',
            message: 'Configure Advanced Schedule',
          })}
          description={i18n._({
            id: 'Use the visual generator below to define your execution frequency.',
            message: 'Use the visual generator below to define your execution frequency.',
          })}
          footer={
            <Button type="button" onClick={() => setCronPickerOpen(false)}>
              {i18n._({ id: 'Apply Schedule', message: 'Apply Schedule' })}
            </Button>
          }
        >
          <CronGenerator
            value={draft.schedule}
            onChange={(cron) => setDraft((current) => ({ ...current, schedule: cron }))}
          />
        </Modal>
      ) : null}
    </section>
  )
}
