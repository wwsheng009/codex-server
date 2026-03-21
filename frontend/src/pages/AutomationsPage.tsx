import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { InlineNotice } from '../components/ui/InlineNotice'
import { SelectControl } from '../components/ui/SelectControl'
import {
  AUTOMATION_TEMPLATES,
  createAutomationRecord,
  listAutomations,
  type AutomationRecord,
  type AutomationTemplate,
} from '../features/automations/store'
import { listWorkspaces } from '../features/workspaces/api'

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
  const [automations, setAutomations] = useState<AutomationRecord[]>([])
  const [activeTemplate, setActiveTemplate] = useState<AutomationTemplate | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [modalOpen, setModalOpen] = useState(false)
  const [error, setError] = useState('')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  useEffect(() => {
    setAutomations(listAutomations())
  }, [])

  const groupedTemplates = useMemo(() => {
    return AUTOMATION_TEMPLATES.reduce<Record<string, AutomationTemplate[]>>((groups, template) => {
      const current = groups[template.category] ?? []
      groups[template.category] = [...current, template]
      return groups
    }, {})
  }, [])

  function openCreateModal(template?: AutomationTemplate) {
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

  function closeModal() {
    setModalOpen(false)
    setActiveTemplate(null)
    setDraft(EMPTY_DRAFT)
    setError('')
  }

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const workspace = workspacesQuery.data?.find((item) => item.id === draft.workspaceId)
    if (!workspace) {
      setError('Select a workspace before creating an automation.')
      return
    }

    if (!draft.title.trim() || !draft.prompt.trim()) {
      setError('Title and prompt are required.')
      return
    }

    const automation = createAutomationRecord({
      title: draft.title.trim(),
      description: draft.description.trim() || 'Automation created from the web IDE prototype.',
      prompt: draft.prompt.trim(),
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      schedule: draft.schedule,
      model: draft.model,
      reasoning: draft.reasoning,
    })

    setAutomations(listAutomations())
    closeModal()
    navigate(`/automations/${automation.id}`)
  }

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">Automations</div>
          <div className="mode-strip__title-row">
            <strong>Automation Studio</strong>
          </div>
          <div className="mode-strip__description">
            Create scheduled automations from reusable templates, then manage them as first-class workbench objects.
          </div>
        </div>
        <div className="mode-strip__actions">
          <span className="meta-pill">{automations.length} Active</span>
          <button className="ide-button" onClick={() => openCreateModal()} type="button">
            New Automation
          </button>
        </div>
      </header>

      <div className="stack-screen">
        {automations.length > 0 && (
          <section className="content-section">
            <div className="section-header">
              <div>
                <h2>Active Automations</h2>
                <p>Manage your running schedules and monitor performance.</p>
              </div>
            </div>
            <div className="automation-compact-list">
              {automations.map((automation) => (
                <Link className="automation-compact-row" key={automation.id} to={`/automations/${automation.id}`}>
                  <div className="automation-compact-row__main">
                    <strong>{automation.title}</strong>
                    <span>{automation.workspaceName}</span>
                  </div>
                  <div className="automation-compact-row__meta">
                    <span className="status-pill status-pill--active">{automation.scheduleLabel}</span>
                    <span className="meta-label">Next: {automation.nextRun}</span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>Templates</h2>
              <p>Quick-start with pre-configured patterns for common tasks.</p>
            </div>
          </div>
          <div className="automation-grid">
            {Object.entries(groupedTemplates).map(([category, templates]) => (
              <div className="automation-category-group" key={category}>
                <div className="automation-category-label">{category}</div>
                <div className="automation-category-items">
                  {templates.map((template) => (
                    <button className="automation-card" key={template.id} onClick={() => openCreateModal(template)} type="button">
                      <div className="automation-card__body">
                        <strong>{template.title}</strong>
                        <p>{template.description}</p>
                      </div>
                      <div className="automation-card__footer">
                        <span>Use Template</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {modalOpen ? (
        <>
          <button className="modal-backdrop" onClick={closeModal} type="button" />
          <div className="modal-shell">
            <div className="modal-card">
              <div className="modal-card__header">
                <div>
                  <h2>{activeTemplate?.title ?? 'New Automation'}</h2>
                  <p>Use a codx-style editor modal to configure prompt, schedule, model, and workspace.</p>
                </div>
                <button className="ide-button ide-button--secondary" onClick={closeModal} type="button">
                  Cancel
                </button>
              </div>
              <form className="form-stack" onSubmit={handleCreate}>
                <label className="field">
                  <span>Title</span>
                  <input onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} />
                </label>
                <label className="field">
                  <span>Description</span>
                  <input onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} value={draft.description} />
                </label>
                <label className="field">
                  <span>Prompt</span>
                  <textarea
                    className="ide-textarea ide-textarea--large"
                    onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                    rows={10}
                    value={draft.prompt}
                  />
                </label>
                <div className="modal-card__context">
                  <label className="field">
                    <span>Workspace</span>
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
                {error ? (
                  <InlineNotice
                    dismissible
                    noticeKey={`automation-create-${error}`}
                    title="Automation Setup Incomplete"
                    tone="error"
                  >
                    {error}
                  </InlineNotice>
                ) : null}
                <div className="header-actions">
                  <button className="ide-button" type="submit">
                    Create Automation
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      ) : null}
    </section>
  )
}
