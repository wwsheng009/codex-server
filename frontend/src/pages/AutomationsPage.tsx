import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
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
  updateAutomationTemplate,
} from '../features/automations/api'
import {
  type AutomationRecord,
  type AutomationTemplate,
} from '../features/automations/store'
import { listWorkspaces } from '../features/workspaces/api'
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

const EMPTY_DRAFT: Draft = {
  title: '',
  description: '',
  prompt: '',
  workspaceId: '',
  schedule: 'hourly',
  model: 'gpt-5.4',
  reasoning: 'medium',
}

export function AutomationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTemplate, setActiveTemplate] = useState<AutomationTemplate | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [templateDraft, setTemplateDraft] = useState({ title: '', description: '', prompt: '', category: 'Custom' })
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState<AutomationRecord | null>(null)
  const [isTemplatesVisible, setIsTemplatesVisible] = useState(true)
  const [error, setError] = useState('')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })
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
    mutationFn: async (input: { id: string; action: 'pause' | 'resume' | 'fix' }) => {
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
      setTemplateDraft({ title: '', description: '', prompt: '', category: 'Custom' })
      setError('')
      await queryClient.invalidateQueries({ queryKey: ['automation-templates'] })
    },
  })
  const updateTemplateMutation = useMutation({
    mutationFn: ({ templateId, input }: { templateId: string; input: { category: string; title: string; description: string; prompt: string } }) =>
      updateAutomationTemplate(templateId, input),
    onSuccess: async () => {
      setTemplateModalOpen(false)
      setEditingTemplateId(null)
      setTemplateDraft({ title: '', description: '', prompt: '', category: 'Custom' })
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
      setError('Title and prompt are required for templates.')
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
      setError('Select a workspace before creating an automation.')
      return
    }

    if (!draft.title.trim() || !draft.prompt.trim()) {
      setError('Title and prompt are required.')
      return
    }

    setError('')
    createAutomationMutation.mutate({
      title: draft.title.trim(),
      description: draft.description.trim() || 'Automation created from the web IDE prototype.',
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
        Cancel
      </Button>
      <Button isLoading={createAutomationMutation.isPending} onClick={submitCreate}>
        Create Automation
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
          createTemplateMutation.reset()
          updateTemplateMutation.reset()
        }}
      >
        Cancel
      </Button>
      <Button
        isLoading={createTemplateMutation.isPending || updateTemplateMutation.isPending}
        onClick={handleCreateTemplate}
      >
        {editingTemplateId ? 'Update Template' : 'Save Template'}
      </Button>
    </>
  )

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">Automations</div>
          <div className="mode-strip__title-row">
            <strong>Automation Studio</strong>
          </div>
          <div className="mode-strip__description">
            Create scheduled automations from reusable templates and manage workbench objects.
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>Active</span>
              <strong>{activeAutomationsCount}</strong>
            </div>
            <div className="mode-metric">
              <span>Templates</span>
              <strong>{templateCount}</strong>
            </div>
          </div>
          <Button onClick={() => openCreateModal()}>
            New Automation
          </Button>
        </div>
      </header>

      <div className="stack-screen">
        {automationsQuery.isLoading ? <div className="notice">Loading automations…</div> : null}
        {automationsQuery.error ? (
          <InlineNotice
            dismissible
            noticeKey={`automation-list-${getErrorMessage(automationsQuery.error)}`}
            title="Automation Loading Failed"
            tone="error"
          >
            {getErrorMessage(automationsQuery.error)}
          </InlineNotice>
        ) : null}
        {templatesQuery.error ? (
          <InlineNotice
            dismissible
            noticeKey={`automation-templates-${getErrorMessage(templatesQuery.error)}`}
            title="Template Loading Failed"
            tone="error"
          >
            {getErrorMessage(templatesQuery.error)}
          </InlineNotice>
        ) : null}

        {automations.length > 0 ? (
          <section className="content-section">
            <div className="section-header">
              <div>
                <h2>Active Automations</h2>
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
                      Fix
                    </Button>
                    {automation.status === 'active' ? (
                      <Button
                        intent="ghost"
                        isLoading={actionTarget?.id === automation.id && actionTarget.action === 'pause'}
                        onClick={() => handlePause(automation.id)}
                      >
                        Pause
                      </Button>
                    ) : (
                      <Button
                        intent="ghost"
                        isLoading={actionTarget?.id === automation.id && actionTarget.action === 'resume'}
                        onClick={() => handleResume(automation.id)}
                      >
                        Resume
                      </Button>
                    )}
                    <Button
                      className="ide-button--ghost-danger"
                      intent="ghost"
                      onClick={() => handleDelete(automation)}
                    >
                      Delete
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
              <h2>Capability Templates</h2>
            </div>
            <div className="section-header__actions">
              <Button intent="ghost" onClick={() => setTemplateModalOpen(true)}>
                New Template
              </Button>
              <Button intent="ghost" onClick={() => setIsTemplatesVisible((current) => !current)}>
                {isTemplatesVisible ? 'Hide Templates' : 'Show Templates'}
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
                            Use Template
                          </Button>
                          {!template.isBuiltIn ? (
                            <>
                              <Button intent="ghost" onClick={() => openEditTemplateModal(template)}>
                                Edit
                              </Button>
                              <Button
                                className="ide-button--ghost-danger"
                                intent="ghost"
                                isLoading={deleteTemplateMutation.isPending && deleteTemplateMutation.variables === template.id}
                                onClick={() => handleDeleteTemplate(template.id)}
                              >
                                Delete
                              </Button>
                            </>
                          ) : (
                            <span className="meta-pill">Built-in</span>
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
          title={activeTemplate?.title ?? 'New Automation'}
        >
          <form className="form-stack" onSubmit={handleCreate}>
            <div className="form-row">
              <label className="field">
                <span>Capability Template</span>
                <SelectControl
                  ariaLabel="Select a template"
                  fullWidth
                  onChange={handleTemplateSelect}
                  options={[
                    { value: '', label: 'None (Start from scratch)' },
                    ...templates.map((template) => ({ value: template.id, label: `[${template.category}] ${template.title}` })),
                  ]}
                  value={activeTemplate?.id ?? ''}
                />
              </label>
              <label className="field">
                <span>Target Workspace</span>
                <SelectControl
                  ariaLabel="Workspace"
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
              <label className="field">
                <span>Title</span>
                <input onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Daily Sync" value={draft.title} />
              </label>
              <label className="field">
                <span>Description</span>
                <input onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} placeholder="Briefly describe the automation's purpose..." value={draft.description} />
              </label>
            </div>

            <label className="field">
              <span>Prompt</span>
              <textarea
                className="ide-textarea"
                onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                placeholder="What should the assistant do?"
                rows={5}
                value={draft.prompt}
              />
            </label>

            <div className="form-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <label className="field">
                <span>Schedule</span>
                <SelectControl
                  ariaLabel="Schedule"
                  fullWidth
                  onChange={(nextValue) =>
                    setDraft((current) => ({ ...current, schedule: nextValue }))
                  }
                  options={[
                    { value: 'hourly', label: 'Every hour' },
                    { value: 'daily-0800', label: 'Daily at 08:00' },
                    { value: 'daily-1800', label: 'Daily at 18:00' },
                  ]}
                  value={draft.schedule}
                />
              </label>
              <label className="field">
                <span>Model</span>
                <SelectControl
                  ariaLabel="Model"
                  fullWidth
                  onChange={(nextValue) =>
                    setDraft((current) => ({ ...current, model: nextValue }))
                  }
                  options={[
                    { value: 'gpt-5.4', label: 'gpt-5.4' },
                    { value: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
                  ]}
                  value={draft.model}
                />
              </label>
              <label className="field">
                <span>Reasoning</span>
                <SelectControl
                  ariaLabel="Reasoning"
                  fullWidth
                  onChange={(nextValue) =>
                    setDraft((current) => ({ ...current, reasoning: nextValue }))
                  }
                  options={[
                    { value: 'medium', label: 'Medium' },
                    { value: 'high', label: 'High' },
                    { value: 'xhigh', label: 'Extra High' },
                  ]}
                  value={draft.reasoning}
                />
              </label>
            </div>
            {createError ? (
              <InlineNotice
                dismissible
                noticeKey={`automation-create-${createError}`}
                title="Automation Setup Incomplete"
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
          description={editingTemplateId ? 'Update this reusable automation pattern.' : 'Create a reusable automation pattern that can be used across different workspaces.'}
          footer={templateModalFooter}
          onClose={() => {
            setTemplateModalOpen(false)
            setEditingTemplateId(null)
            setError('')
          }}
          title={editingTemplateId ? 'Edit Capability Template' : 'New Capability Template'}
        >
          <div className="form-stack">
            <div className="form-row">
              <label className="field">
                <span>Template Title</span>
                <input
                  onChange={(event) => setTemplateDraft((current) => ({ ...current, title: event.target.value }))}
                  placeholder="e.g. Security Audit"
                  value={templateDraft.title}
                />
              </label>
              <label className="field">
                <span>Category</span>
                <input
                  onChange={(event) => setTemplateDraft((current) => ({ ...current, category: event.target.value }))}
                  placeholder="e.g. Security"
                  value={templateDraft.category}
                />
              </label>
            </div>
            <label className="field">
              <span>Description</span>
              <input
                onChange={(event) => setTemplateDraft((current) => ({ ...current, description: event.target.value }))}
                placeholder="What does this pattern do?"
                value={templateDraft.description}
              />
            </label>
            <label className="field">
              <span>Template Prompt</span>
              <textarea
                className="ide-textarea"
                onChange={(event) => setTemplateDraft((current) => ({ ...current, prompt: event.target.value }))}
                placeholder="Define the logic/instructions for this template..."
                rows={6}
                value={templateDraft.prompt}
              />
            </label>
            {templateError ? (
              <InlineNotice
                dismissible
                noticeKey={`automation-template-${templateError}`}
                title="Template Update Failed"
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
          confirmLabel="Delete Automation"
          description="This will permanently remove the automation record. This action cannot be undone."
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
          title="Delete Automation?"
        />
      ) : null}
    </section>
  )
}
