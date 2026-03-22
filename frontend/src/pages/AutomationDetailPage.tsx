import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Modal } from '../components/ui/Modal'
import { AutomationRunLog } from '../features/automations/AutomationRunLog'
import {
  deleteAutomation,
  getAutomation,
  getAutomationRun,
  listAutomationRuns,
  pauseAutomation,
  resumeAutomation,
  triggerAutomationRun,
} from '../features/automations/api'
import { isApiClientErrorCode } from '../lib/api-client'
import { getErrorMessage } from '../lib/error-utils'
import type { AutomationRun } from '../types/api'

type RunViewMode = 'details' | 'summary' | 'logs'

export function AutomationDetailPage() {
  const { automationId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<RunViewMode>('details')

  const automationQuery = useQuery({
    queryKey: ['automation', automationId],
    queryFn: () => getAutomation(automationId),
    enabled: automationId.length > 0,
    refetchInterval: 10_000,
  })
  const runsQuery = useQuery({
    queryKey: ['automation-runs', automationId],
    queryFn: () => listAutomationRuns(automationId),
    enabled: automationId.length > 0,
    refetchInterval: 5_000,
  })
  const selectedRunQuery = useQuery({
    queryKey: ['automation-run', selectedRunId],
    queryFn: () => getAutomationRun(selectedRunId ?? ''),
    enabled: selectedRunId !== null,
    refetchInterval: selectedRunId && viewMode === 'logs' ? 3_000 : false,
  })

  const statusMutation = useMutation({
    mutationFn: async (input: { automationId: string; status: string }) => {
      return input.status === 'active'
        ? pauseAutomation(input.automationId)
        : resumeAutomation(input.automationId)
    },
    onSuccess: async (automation) => {
      queryClient.setQueryData(['automation', automation.id], automation)
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
    },
  })
  const triggerMutation = useMutation({
    mutationFn: (id: string) => triggerAutomationRun(id),
    onSuccess: async (run) => {
      setSelectedRunId(run.id)
      setViewMode('logs')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['automation', automationId] }),
        queryClient.invalidateQueries({ queryKey: ['automations'] }),
        queryClient.invalidateQueries({ queryKey: ['automation-runs', automationId] }),
      ])
    },
  })
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAutomation(id),
    onSuccess: async (_, id) => {
      setConfirmingDelete(false)
      queryClient.removeQueries({ queryKey: ['automation', id] })
      queryClient.removeQueries({ queryKey: ['automation-runs', id] })
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
      navigate('/automations')
    },
  })

  const actionError = statusMutation.error ?? triggerMutation.error

  if (!automationId) return <AutomationNotFound />
  if (automationQuery.isLoading) return <LoadingState />
  if (automationQuery.error) {
    if (isApiClientErrorCode(automationQuery.error, 'automation_not_found')) return <AutomationNotFound />
    return <ErrorState error={automationQuery.error} />
  }

  const automation = automationQuery.data
  if (!automation) return <AutomationNotFound />

  const openRunView = (runId: string, mode: RunViewMode) => {
    setSelectedRunId(runId)
    setViewMode(mode)
  }

  function handleOpenDeleteConfirm() {
    if (deleteMutation.isPending) {
      return
    }

    deleteMutation.reset()
    setConfirmingDelete(true)
  }

  function handleCloseDeleteConfirm() {
    if (deleteMutation.isPending) {
      return
    }

    deleteMutation.reset()
    setConfirmingDelete(false)
  }

  function handleConfirmDelete(automationIdToDelete: string) {
    if (deleteMutation.isPending) {
      return
    }

    deleteMutation.mutate(automationIdToDelete)
  }

  return (
    <section className="screen">
      {actionError ? (
        <InlineNotice
          dismissible
          noticeKey={`automation-detail-action-${automation.id}-${getErrorMessage(actionError)}`}
          title="Automation Update Failed"
          tone="error"
        >
          {getErrorMessage(actionError)}
        </InlineNotice>
      ) : null}

      <PageHeader
        actions={
          <div className="header-actions">
            <Button
              isLoading={triggerMutation.isPending}
              onClick={() => triggerMutation.mutate(automation.id)}
            >
              Run Now
            </Button>
            <Button
              intent="secondary"
              isLoading={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ automationId: automation.id, status: automation.status })}
            >
              {automation.status === 'active' ? 'Pause' : 'Resume'}
            </Button>
            <Button onClick={() => navigate(`/workspaces/${automation.workspaceId}`)}>
              Open Workspace
            </Button>
            <Button
              intent="secondary"
              className="ide-button--ghost-danger"
              onClick={handleOpenDeleteConfirm}
            >
              Delete
            </Button>
          </div>
        }
        description={automation.description}
        eyebrow="Automation Detail"
        meta={
          <div className="automation-meta-group">
            <span className={`status-pill status-pill--${automation.status === 'active' ? 'connected' : 'paused'}`}>
              {automation.status}
            </span>
            <span className="meta-pill">Schedule: {automation.scheduleLabel}</span>
            <span className="meta-pill">Model: {automation.model}</span>
            <span className="meta-pill">Workspace: {automation.workspaceName}</span>
            {automation.lastRun && (
              <span className="meta-pill">Last Run: {formatTimestamp(automation.lastRun)}</span>
            )}
          </div>
        }
        title={automation.title}
      />

      <div className="detail-layout detail-layout--single">
        <section className="detail-layout__main settings-section">
          <div className="section-header">
            <div>
              <h2>Recent Runs</h2>
              <p>Execution history, summarized results, and detailed logs.</p>
            </div>
            <div className="section-header__meta">{runsQuery.data?.length ?? 0} total</div>
          </div>

          {runsQuery.isLoading ? <div className="notice">Loading run history…</div> : null}
          {runsQuery.error && (
            <InlineNotice
              dismissible
              noticeKey={`automation-runs-${automation.id}-${getErrorMessage(runsQuery.error)}`}
              title="Run History Loading Failed"
              tone="error"
            >
              {getErrorMessage(runsQuery.error)}
            </InlineNotice>
          )}

          {runsQuery.data?.length ? (
            <div className="automation-run-list-table">
              {runsQuery.data.map((run) => (
                <div className="automation-run-row" key={run.id}>
                  <div className="automation-run-row__main">
                    <div className="run-identity">
                      <span className={`status-pill status-pill--${runStatusTone(run.status)}`}>
                        {run.status}
                      </span>
                      <strong>{formatRunLabel(run)}</strong>
                      <span className="run-meta">{formatTimestamp(run.startedAt)}</span>
                      <span className="run-trigger">{run.trigger}</span>
                    </div>
                    {run.summary && <p className="run-brief-summary">{run.summary.slice(0, 100)}...</p>}
                    {run.error && <p className="run-error-text">{run.error}</p>}
                  </div>
                  <div className="automation-run-row__actions">
                    <Button intent="ghost" onClick={() => openRunView(run.id, 'summary')}>
                      Summary
                    </Button>
                    <Button intent="ghost" onClick={() => openRunView(run.id, 'logs')}>
                      Logs
                    </Button>
                    <Button intent="ghost" onClick={() => openRunView(run.id, 'details')}>
                      Details
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice">No runs yet. Trigger the automation or wait for the scheduler.</div>
          )}

          <div className="section-header" style={{ marginTop: '2rem' }}>
            <div>
              <h2>Prompt Configuration</h2>
              <p>The instructions being executed by the model.</p>
            </div>
          </div>
          <div className="detail-copy">
            <pre className="code-block prompt-display">{automation.prompt}</pre>
          </div>
        </section>
      </div>

      {selectedRunId && (
        <Modal
          description={formatRunDescription(selectedRunQuery.data, viewMode)}
          maxWidth="min(1400px, 75vw)"
          footer={
            <div className="modal-footer-distributed">
               <div className="segmented-control">
                <Button 
                  intent={viewMode === 'summary' ? 'secondary' : 'ghost'} 
                  onClick={() => setViewMode('summary')}
                >
                  Summary
                </Button>
                <Button 
                  intent={viewMode === 'logs' ? 'secondary' : 'ghost'} 
                  onClick={() => setViewMode('logs')}
                >
                  Logs
                </Button>
                <Button 
                  intent={viewMode === 'details' ? 'secondary' : 'ghost'} 
                  onClick={() => setViewMode('details')}
                >
                  Details
                </Button>
              </div>
              <Button intent="secondary" onClick={() => setSelectedRunId(null)}>
                Close
              </Button>
            </div>
          }
          onClose={() => setSelectedRunId(null)}
          title={`${selectedRunQuery.data ? formatRunLabel(selectedRunQuery.data) : 'Run'} - ${viewMode.charAt(0).toUpperCase() + viewMode.slice(1)}`}
        >
          {selectedRunQuery.isLoading ? <div className="notice">Loading…</div> : null}
          {selectedRunQuery.error && (
            <InlineNotice
              dismissible
              noticeKey={`run-error-${selectedRunId}`}
              title="Failed to Load Run Data"
              tone="error"
            >
              {getErrorMessage(selectedRunQuery.error)}
            </InlineNotice>
          )}

          {selectedRunQuery.data && (
            <div className="run-view-content">
              {viewMode === 'summary' && (
                <div className="markdown-container">
                  {selectedRunQuery.data.summary ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedRunQuery.data.summary}
                    </ReactMarkdown>
                  ) : (
                    <div className="notice">No summary available for this run.</div>
                  )}
                  {selectedRunQuery.data.error && (
                    <div className="run-error-block">
                      <strong>Execution Error:</strong>
                      <p>{selectedRunQuery.data.error}</p>
                    </div>
                  )}
                </div>
              )}

              {viewMode === 'logs' && (
                <AutomationRunLog logs={selectedRunQuery.data.logs} />
              )}

              {viewMode === 'details' && (
                <div className="detail-list">
                  <DetailRow label="ID" value={selectedRunQuery.data.id} />
                  <DetailRow label="Status" value={selectedRunQuery.data.status} />
                  <DetailRow label="Trigger" value={selectedRunQuery.data.trigger} />
                  <DetailRow label="Started At" value={formatTimestamp(selectedRunQuery.data.startedAt)} />
                  <DetailRow label="Finished At" value={selectedRunQuery.data.finishedAt ? formatTimestamp(selectedRunQuery.data.finishedAt) : 'In progress'} />
                  {selectedRunQuery.data.turnId && <DetailRow label="Turn ID" value={selectedRunQuery.data.turnId} />}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {confirmingDelete ? (
        <ConfirmDialog
          confirmLabel="Delete Automation"
          description="This permanently removes the automation and its recorded runs. You will be returned to the automation registry."
          error={deleteMutation.error ? getErrorMessage(deleteMutation.error) : null}
          isPending={deleteMutation.isPending}
          onClose={handleCloseDeleteConfirm}
          onConfirm={() => handleConfirmDelete(automation.id)}
          subject={automation.title}
          title="Delete Automation?"
        />
      ) : null}
    </section>
  )
}

function LoadingState() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">Automation</p>
        <h1>Loading Automation</h1>
        <p className="page-header__description">Fetching the latest automation data from the server.</p>
      </section>
    </section>
  )
}

function ErrorState({ error }: { error: any }) {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">Automation</p>
        <h1>Automation Unavailable</h1>
        <InlineNotice title="Automation Loading Failed" tone="error">
          {getErrorMessage(error)}
        </InlineNotice>
        <div className="header-actions">
          <Link className="ide-button" to="/automations">
            Back to Automations
          </Link>
        </div>
      </section>
    </section>
  )
}

function AutomationNotFound() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">Automation</p>
        <h1>Automation Not Found</h1>
        <p className="page-header__description">The requested automation could not be found.</p>
        <div className="header-actions">
          <Link className="ide-button" to="/automations">
            Back to Automations
          </Link>
        </div>
      </section>
    </section>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatRunLabel(run: AutomationRun) {
  return `Run ${run.id.slice(0, 8)}`
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function runStatusTone(status: string) {
  switch (status) {
    case 'completed': return 'connected'
    case 'failed': return 'error'
    default: return 'paused'
  }
}

function formatRunDescription(run: AutomationRun | undefined, mode: RunViewMode) {
  if (!run) return ''
  if (mode === 'summary') return 'AI-generated summary of the execution outcome.'
  if (mode === 'logs') return 'Real-time captured logs from the model execution.'
  return 'Detailed technical metadata for this specific run.'
}
