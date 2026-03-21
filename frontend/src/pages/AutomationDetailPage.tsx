import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Modal } from '../components/ui/Modal'
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

export function AutomationDetailPage() {
  const { automationId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

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
    refetchInterval: selectedRunId ? 3_000 : false,
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
      queryClient.removeQueries({ queryKey: ['automation', id] })
      queryClient.removeQueries({ queryKey: ['automation-runs', id] })
      await queryClient.invalidateQueries({ queryKey: ['automations'] })
      navigate('/automations')
    },
  })

  const latestRun = useMemo(() => runsQuery.data?.[0] ?? null, [runsQuery.data])
  const actionError = statusMutation.error ?? triggerMutation.error ?? deleteMutation.error

  if (!automationId) {
    return <AutomationNotFound />
  }

  if (automationQuery.isLoading) {
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

  if (automationQuery.error) {
    if (isApiClientErrorCode(automationQuery.error, 'automation_not_found')) {
      return <AutomationNotFound />
    }

    return (
      <section className="screen screen--centered">
        <section className="empty-card">
          <p className="page-header__eyebrow">Automation</p>
          <h1>Automation Unavailable</h1>
          <InlineNotice
            dismissible
            noticeKey={`automation-detail-${automationId}-${getErrorMessage(automationQuery.error)}`}
            title="Automation Loading Failed"
            tone="error"
          >
            {getErrorMessage(automationQuery.error)}
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

  const automation = automationQuery.data
  if (!automation) {
    return <AutomationNotFound />
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
              isLoading={deleteMutation.isPending}
              onClick={() => deleteMutation.mutate(automation.id)}
            >
              Delete
            </Button>
          </div>
        }
        description="Automation configuration, execution state, and run history."
        eyebrow="Automation Detail"
        meta={
          <>
            <span className="meta-pill">{automation.scheduleLabel}</span>
            <span className="meta-pill">{automation.model}</span>
            <span className="meta-pill">{automation.status}</span>
          </>
        }
        title={automation.title}
      />

      <div className="detail-layout">
        <section className="detail-layout__main settings-section">
          <div className="section-header">
            <div>
              <h2>Summary</h2>
              <p>Prompt, configuration, and recent execution output.</p>
            </div>
          </div>
          <div className="stack-screen">
            <div className="detail-copy">
              <span>Description</span>
              <p>{automation.description}</p>
            </div>
            <div className="detail-copy">
              <span>Prompt</span>
              <pre className="code-block">{automation.prompt}</pre>
            </div>
            <section className="content-section">
              <div className="section-header">
                <div>
                  <h2>Recent Runs</h2>
                  <p>Persisted execution history, status, and logs.</p>
                </div>
                <div className="section-header__meta">{runsQuery.data?.length ?? 0}</div>
              </div>
              {runsQuery.isLoading ? <div className="notice">Loading run history…</div> : null}
              {runsQuery.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`automation-runs-${automation.id}-${getErrorMessage(runsQuery.error)}`}
                  title="Run History Loading Failed"
                  tone="error"
                >
                  {getErrorMessage(runsQuery.error)}
                </InlineNotice>
              ) : null}
              {runsQuery.data?.length ? (
                <div className="automation-run-list">
                  {runsQuery.data.map((run) => (
                    <button
                      className="automation-run-card"
                      key={run.id}
                      onClick={() => setSelectedRunId(run.id)}
                      type="button"
                    >
                      <div className="automation-run-card__header">
                        <strong>{formatRunLabel(run)}</strong>
                        <span className={`status-pill status-pill--${runStatusTone(run.status)}`}>
                          {run.status}
                        </span>
                      </div>
                      <div className="automation-run-card__meta">
                        <span>{formatTimestamp(run.startedAt)}</span>
                        <span>{run.trigger}</span>
                      </div>
                      <p>{run.summary || run.error || 'Run completed without a summary.'}</p>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="notice">No runs yet. Trigger the automation or wait for the scheduler.</div>
              )}
            </section>
          </div>
        </section>

        <section className="detail-layout__aside settings-section">
          <div className="section-header">
            <div>
              <h2>Details</h2>
              <p>Current status and latest run outcome.</p>
            </div>
          </div>
          <div className="detail-list">
            <DetailRow label="Status" value={automation.status} />
            <DetailRow label="Next Run" value={automation.nextRun} />
            <DetailRow label="Last Run" value={automation.lastRun ? formatTimestamp(automation.lastRun) : 'Never'} />
            <DetailRow label="Workspace" value={automation.workspaceName} />
            <DetailRow label="Repeats" value={automation.scheduleLabel} />
            <DetailRow label="Model" value={automation.model} />
            <DetailRow label="Reasoning" value={automation.reasoning} />
            <DetailRow label="Latest Result" value={latestRun ? latestRun.status : 'No runs yet'} />
          </div>
          {latestRun ? (
            <div className="detail-copy">
              <span>Latest Summary</span>
              <p>{latestRun.summary || latestRun.error || 'No summary available.'}</p>
            </div>
          ) : null}
        </section>
      </div>

      {selectedRunId ? (
        <Modal
          description="Persisted run logs and captured result for this automation execution."
          footer={
            <Button intent="secondary" onClick={() => setSelectedRunId(null)}>
              Close
            </Button>
          }
          onClose={() => setSelectedRunId(null)}
          title={selectedRunQuery.data ? formatRunLabel(selectedRunQuery.data) : 'Run Logs'}
        >
          {selectedRunQuery.isLoading ? <div className="notice">Loading run logs…</div> : null}
          {selectedRunQuery.error ? (
            <InlineNotice
              dismissible
              noticeKey={`automation-run-detail-${selectedRunId}-${getErrorMessage(selectedRunQuery.error)}`}
              title="Run Log Loading Failed"
              tone="error"
            >
              {getErrorMessage(selectedRunQuery.error)}
            </InlineNotice>
          ) : null}
          {selectedRunQuery.data ? (
            <div className="form-stack">
              <div className="detail-list">
                <DetailRow label="Status" value={selectedRunQuery.data.status} />
                <DetailRow label="Started" value={formatTimestamp(selectedRunQuery.data.startedAt)} />
                <DetailRow label="Finished" value={selectedRunQuery.data.finishedAt ? formatTimestamp(selectedRunQuery.data.finishedAt) : 'In progress'} />
                <DetailRow label="Trigger" value={selectedRunQuery.data.trigger} />
              </div>
              {selectedRunQuery.data.summary ? (
                <div className="detail-copy">
                  <span>Summary</span>
                  <p>{selectedRunQuery.data.summary}</p>
                </div>
              ) : null}
              {selectedRunQuery.data.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`automation-run-error-${selectedRunQuery.data.id}-${selectedRunQuery.data.error}`}
                  title="Run Error"
                  tone="error"
                >
                  {selectedRunQuery.data.error}
                </InlineNotice>
              ) : null}
              <div className="detail-copy">
                <span>Run Log</span>
                <div className="automation-run-log">
                  {selectedRunQuery.data.logs.length ? (
                    selectedRunQuery.data.logs.map((entry) => (
                      <div className="automation-run-log__entry" key={entry.id}>
                        <span className="automation-run-log__timestamp">{formatTimestamp(entry.ts)}</span>
                        <span className={`automation-run-log__level automation-run-log__level--${entry.level}`}>
                          {entry.level}
                        </span>
                        <span>{entry.message}</span>
                      </div>
                    ))
                  ) : (
                    <div className="notice">No logs captured for this run.</div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </section>
  )
}

function AutomationNotFound() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">Automation</p>
        <h1>Automation Not Found</h1>
        <p className="page-header__description">The requested automation could not be found on the server.</p>
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
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function runStatusTone(status: string) {
  switch (status) {
    case 'completed':
      return 'connected'
    case 'failed':
      return 'error'
    default:
      return 'paused'
  }
}
