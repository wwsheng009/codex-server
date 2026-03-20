import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { InlineNotice } from '../components/ui/InlineNotice'
import {
  AUTOMATION_TEMPLATES,
  createAutomationRecord,
  listAutomations,
  type AutomationRecord,
  type AutomationTemplate,
} from '../features/automations/store'
import { listWorkspaces } from '../features/workspaces/api'

type ViewMode = 'templates' | 'current'

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
  const [viewMode, setViewMode] = useState<ViewMode>('templates')
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
    const current = listAutomations()
    setAutomations(current)
    if (current.length) {
      setViewMode('current')
    }
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
    setViewMode('current')
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
          <span className="meta-pill">{AUTOMATION_TEMPLATES.length} templates</span>
          <span className="meta-pill">{automations.length} current</span>
          <div className="segmented-control">
            <button
              className={viewMode === 'templates' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
              onClick={() => setViewMode('templates')}
              type="button"
            >
              Templates
            </button>
            <button
              className={viewMode === 'current' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
              onClick={() => setViewMode('current')}
              type="button"
            >
              Current
            </button>
          </div>
          <button className="ide-button" onClick={() => openCreateModal()} type="button">
            New Automation
          </button>
        </div>
      </header>

      {viewMode === 'templates' ? (
        <div className="stack-screen">
          {Object.entries(groupedTemplates).map(([category, templates]) => (
            <section className="content-section" key={category}>
              <div className="section-header">
                <div>
                  <h2>{category}</h2>
                  <p>Choose a template and adapt it in the modal editor.</p>
                </div>
              </div>
              <div className="template-list">
                {templates.map((template) => (
                  <button className="template-tile" key={template.id} onClick={() => openCreateModal(template)} type="button">
                    <div className="template-tile__icon">{category.slice(0, 2).toUpperCase()}</div>
                    <div className="template-tile__body">
                      <strong>{template.title}</strong>
                      <p>{template.description}</p>
                    </div>
                    <div className="template-tile__meta">Use template</div>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>Current</h2>
              <p>Locally stored automations for this first full-rewrite slice.</p>
            </div>
          </div>
          {!automations.length ? <div className="empty-state">No current automations yet.</div> : null}
          <div className="automation-list">
            {automations.map((automation) => (
              <Link className="automation-list__row" key={automation.id} to={`/automations/${automation.id}`}>
                <div>
                  <strong>{automation.title}</strong>
                  <p>{automation.workspaceName}</p>
                </div>
                <span>{automation.scheduleLabel}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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
                    <select onChange={(event) => setDraft((current) => ({ ...current, workspaceId: event.target.value }))} value={draft.workspaceId}>
                      {workspacesQuery.data?.map((workspace) => (
                        <option key={workspace.id} value={workspace.id}>
                          {workspace.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Schedule</span>
                    <select onChange={(event) => setDraft((current) => ({ ...current, schedule: event.target.value }))} value={draft.schedule}>
                      <option value="hourly">Every hour</option>
                      <option value="daily-0800">Daily at 08:00</option>
                      <option value="daily-1800">Daily at 18:00</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Model</span>
                    <select onChange={(event) => setDraft((current) => ({ ...current, model: event.target.value }))} value={draft.model}>
                      <option value="gpt-5.4">gpt-5.4</option>
                      <option value="gpt-5.3-codex">gpt-5.3-codex</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Reasoning</span>
                    <select onChange={(event) => setDraft((current) => ({ ...current, reasoning: event.target.value }))} value={draft.reasoning}>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="xhigh">Extra High</option>
                    </select>
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
