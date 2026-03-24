import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Modal } from '../components/ui/Modal'
import { StatusPill } from '../components/ui/StatusPill'
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
import { formatLocaleDateTime, formatLocaleNumber } from '../i18n/format'
import { i18n } from '../i18n/runtime'
import { isApiClientErrorCode } from '../lib/api-client'
import { getErrorMessage } from '../lib/error-utils'
import type { AutomationRun } from '../types/api'

type RunViewMode = 'details' | 'summary' | 'logs'

type AutomationStatusMutationInput = {
  automationId: string
  status: string
}

type AutomationErrorStateProps = {
  error: unknown
}

type AutomationDetailRowProps = {
  label: string
  value: ReactNode
}

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
    mutationFn: async (input: AutomationStatusMutationInput) => {
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
          title={i18n._({
            id: 'Automation Update Failed',
            message: 'Automation Update Failed',
          })}
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
              {i18n._({ id: 'Run Now', message: 'Run Now' })}
            </Button>
            <Button
              intent="secondary"
              isLoading={statusMutation.isPending}
              onClick={() => statusMutation.mutate({ automationId: automation.id, status: automation.status })}
            >
              {automation.status === 'active'
                ? i18n._({ id: 'Pause', message: 'Pause' })
                : i18n._({ id: 'Resume', message: 'Resume' })}
            </Button>
            <Button onClick={() => navigate(`/workspaces/${automation.workspaceId}`)}>
              {i18n._({ id: 'Open Workspace', message: 'Open Workspace' })}
            </Button>
            <Button
              intent="secondary"
              className="ide-button--ghost-danger"
              onClick={handleOpenDeleteConfirm}
            >
              {i18n._({ id: 'Delete', message: 'Delete' })}
            </Button>
          </div>
        }
        description={automation.description}
        eyebrow={i18n._({ id: 'Automation Detail', message: 'Automation Detail' })}
        meta={
          <div className="automation-meta-group">
            <StatusPill status={automation.status} />
            <span className="meta-pill">
              {i18n._({
                id: 'Schedule: {schedule}',
                message: 'Schedule: {schedule}',
                values: { schedule: formatAutomationScheduleLabel(automation.schedule) },
              })}
            </span>
            <span className="meta-pill">
              {i18n._({
                id: 'Model: {model}',
                message: 'Model: {model}',
                values: { model: automation.model },
              })}
            </span>
            <span className="meta-pill">
              {i18n._({
                id: 'Workspace: {workspace}',
                message: 'Workspace: {workspace}',
                values: { workspace: automation.workspaceName },
              })}
            </span>
            {automation.lastRun && (
              <span className="meta-pill">
                {i18n._({
                  id: 'Last Run: {time}',
                  message: 'Last Run: {time}',
                  values: { time: formatTimestamp(automation.lastRun) },
                })}
              </span>
            )}
          </div>
        }
        title={automation.title}
      />

      <div className="detail-layout detail-layout--single">
        <section className="detail-layout__main settings-section">
          <div className="section-header">
            <div>
              <h2>{i18n._({ id: 'Recent Runs', message: 'Recent Runs' })}</h2>
              <p>
                {i18n._({
                  id: 'Execution history, summarized results, and detailed logs.',
                  message: 'Execution history, summarized results, and detailed logs.',
                })}
              </p>
            </div>
            <div className="section-header__meta">
              {i18n._({
                id: '{count} total',
                message: '{count} total',
                values: { count: formatLocaleNumber(runsQuery.data?.length ?? 0) },
              })}
            </div>
          </div>

          {runsQuery.isLoading ? (
            <div className="notice">
              {i18n._({ id: 'Loading run history…', message: 'Loading run history…' })}
            </div>
          ) : null}
          {runsQuery.error && (
            <InlineNotice
              dismissible
              noticeKey={`automation-runs-${automation.id}-${getErrorMessage(runsQuery.error)}`}
              title={i18n._({
                id: 'Run History Loading Failed',
                message: 'Run History Loading Failed',
              })}
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
                      <StatusPill status={run.status} />
                      <strong>{formatRunLabel(run)}</strong>
                      <span className="run-meta">{formatTimestamp(run.startedAt)}</span>
                      <span className="run-trigger">{formatRunTriggerLabel(run.trigger)}</span>
                    </div>
                    {run.summary && <p className="run-brief-summary">{run.summary.slice(0, 100)}...</p>}
                    {run.error && <p className="run-error-text">{run.error}</p>}
                  </div>
                  <div className="automation-run-row__actions">
                    <Button intent="ghost" onClick={() => openRunView(run.id, 'summary')}>
                      {formatRunViewModeLabel('summary')}
                    </Button>
                    <Button intent="ghost" onClick={() => openRunView(run.id, 'logs')}>
                      {formatRunViewModeLabel('logs')}
                    </Button>
                    <Button intent="ghost" onClick={() => openRunView(run.id, 'details')}>
                      {formatRunViewModeLabel('details')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="notice">
              {i18n._({
                id: 'No runs yet. Trigger the automation or wait for the scheduler.',
                message: 'No runs yet. Trigger the automation or wait for the scheduler.',
              })}
            </div>
          )}

          <div className="section-header" style={{ marginTop: '2rem' }}>
            <div>
              <h2>{i18n._({ id: 'Prompt Configuration', message: 'Prompt Configuration' })}</h2>
              <p>
                {i18n._({
                  id: 'The instructions being executed by the model.',
                  message: 'The instructions being executed by the model.',
                })}
              </p>
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
                  {formatRunViewModeLabel('summary')}
                </Button>
                <Button 
                  intent={viewMode === 'logs' ? 'secondary' : 'ghost'} 
                  onClick={() => setViewMode('logs')}
                >
                  {formatRunViewModeLabel('logs')}
                </Button>
                <Button 
                  intent={viewMode === 'details' ? 'secondary' : 'ghost'} 
                  onClick={() => setViewMode('details')}
                >
                  {formatRunViewModeLabel('details')}
                </Button>
              </div>
              <Button intent="secondary" onClick={() => setSelectedRunId(null)}>
                {i18n._({ id: 'Close', message: 'Close' })}
              </Button>
            </div>
          }
          onClose={() => setSelectedRunId(null)}
          title={i18n._({
            id: '{run} - {mode}',
            message: '{run} - {mode}',
            values: {
              run:
                selectedRunQuery.data
                  ? formatRunLabel(selectedRunQuery.data)
                  : i18n._({ id: 'Run', message: 'Run' }),
              mode: formatRunViewModeLabel(viewMode),
            },
          })}
        >
          {selectedRunQuery.isLoading ? (
            <div className="notice">{i18n._({ id: 'Loading…', message: 'Loading…' })}</div>
          ) : null}
          {selectedRunQuery.error && (
            <InlineNotice
              dismissible
              noticeKey={`run-error-${selectedRunId}`}
              title={i18n._({
                id: 'Failed to Load Run Data',
                message: 'Failed to Load Run Data',
              })}
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
                    <div className="notice">
                      {i18n._({
                        id: 'No summary available for this run.',
                        message: 'No summary available for this run.',
                      })}
                    </div>
                  )}
                  {selectedRunQuery.data.error && (
                    <div className="run-error-block">
                      <strong>{i18n._({ id: 'Execution Error:', message: 'Execution Error:' })}</strong>
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
                  <DetailRow label={i18n._({ id: 'ID', message: 'ID' })} value={selectedRunQuery.data.id} />
                  <DetailRow
                    label={i18n._({ id: 'Status', message: 'Status' })}
                    value={<StatusPill status={selectedRunQuery.data.status} />}
                  />
                  <DetailRow
                    label={i18n._({ id: 'Trigger', message: 'Trigger' })}
                    value={formatRunTriggerLabel(selectedRunQuery.data.trigger)}
                  />
                  <DetailRow
                    label={i18n._({ id: 'Started At', message: 'Started At' })}
                    value={formatTimestamp(selectedRunQuery.data.startedAt)}
                  />
                  <DetailRow
                    label={i18n._({ id: 'Finished At', message: 'Finished At' })}
                    value={
                      selectedRunQuery.data.finishedAt
                        ? formatTimestamp(selectedRunQuery.data.finishedAt)
                        : i18n._({ id: 'In progress', message: 'In progress' })
                    }
                  />
                  {selectedRunQuery.data.turnId ? (
                    <DetailRow
                      label={i18n._({ id: 'Turn ID', message: 'Turn ID' })}
                      value={selectedRunQuery.data.turnId}
                    />
                  ) : null}
                </div>
              )}
            </div>
          )}
        </Modal>
      )}

      {confirmingDelete ? (
        <ConfirmDialog
          confirmLabel={i18n._({
            id: 'Delete Automation',
            message: 'Delete Automation',
          })}
          description={i18n._({
            id: 'This permanently removes the automation and its recorded runs. You will be returned to the automation registry.',
            message:
              'This permanently removes the automation and its recorded runs. You will be returned to the automation registry.',
          })}
          error={deleteMutation.error ? getErrorMessage(deleteMutation.error) : null}
          isPending={deleteMutation.isPending}
          onClose={handleCloseDeleteConfirm}
          onConfirm={() => handleConfirmDelete(automation.id)}
          subject={automation.title}
          title={i18n._({
            id: 'Delete Automation?',
            message: 'Delete Automation?',
          })}
        />
      ) : null}
    </section>
  )
}

function LoadingState() {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">{i18n._({ id: 'Automation', message: 'Automation' })}</p>
        <h1>{i18n._({ id: 'Loading Automation', message: 'Loading Automation' })}</h1>
        <p className="page-header__description">
          {i18n._({
            id: 'Fetching the latest automation data from the server.',
            message: 'Fetching the latest automation data from the server.',
          })}
        </p>
      </section>
    </section>
  )
}

function ErrorState({ error }: AutomationErrorStateProps) {
  return (
    <section className="screen screen--centered">
      <section className="empty-card">
        <p className="page-header__eyebrow">{i18n._({ id: 'Automation', message: 'Automation' })}</p>
        <h1>{i18n._({ id: 'Automation Unavailable', message: 'Automation Unavailable' })}</h1>
        <InlineNotice
          title={i18n._({
            id: 'Automation Loading Failed',
            message: 'Automation Loading Failed',
          })}
          tone="error"
        >
          {getErrorMessage(error)}
        </InlineNotice>
        <div className="header-actions">
          <Link className="ide-button" to="/automations">
            {i18n._({ id: 'Back to Automations', message: 'Back to Automations' })}
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
        <p className="page-header__eyebrow">{i18n._({ id: 'Automation', message: 'Automation' })}</p>
        <h1>{i18n._({ id: 'Automation Not Found', message: 'Automation Not Found' })}</h1>
        <p className="page-header__description">
          {i18n._({
            id: 'The requested automation could not be found.',
            message: 'The requested automation could not be found.',
          })}
        </p>
        <div className="header-actions">
          <Link className="ide-button" to="/automations">
            {i18n._({ id: 'Back to Automations', message: 'Back to Automations' })}
          </Link>
        </div>
      </section>
    </section>
  )
}

function DetailRow({ label, value }: AutomationDetailRowProps) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatRunLabel(run: AutomationRun) {
  return i18n._({
    id: 'Run {id}',
    message: 'Run {id}',
    values: { id: run.id.slice(0, 8) },
  })
}

function formatTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return formatLocaleDateTime(value)
}

function formatRunViewModeLabel(mode: RunViewMode) {
  switch (mode) {
    case 'summary':
      return i18n._({ id: 'Summary', message: 'Summary' })
    case 'logs':
      return i18n._({ id: 'Logs', message: 'Logs' })
    default:
      return i18n._({ id: 'Details', message: 'Details' })
  }
}

function formatRunDescription(run: AutomationRun | undefined, mode: RunViewMode) {
  if (!run) return ''
  if (mode === 'summary') {
    return i18n._({
      id: 'AI-generated summary of the execution outcome.',
      message: 'AI-generated summary of the execution outcome.',
    })
  }
  if (mode === 'logs') {
    return i18n._({
      id: 'Real-time captured logs from the model execution.',
      message: 'Real-time captured logs from the model execution.',
    })
  }
  return i18n._({
    id: 'Detailed technical metadata for this specific run.',
    message: 'Detailed technical metadata for this specific run.',
  })
}

function formatRunTriggerLabel(trigger: string) {
  const normalized = trigger.trim().toLowerCase()
  switch (normalized) {
    case 'manual':
      return i18n._({ id: 'Manual', message: 'Manual' })
    case 'schedule':
      return i18n._({ id: 'Scheduled', message: 'Scheduled' })
    default:
      return trigger
  }
}

function formatAutomationScheduleLabel(schedule: string) {
  const normalized = schedule.trim()

  if (!normalized) {
    return i18n._({ id: 'Scheduled', message: 'Scheduled' })
  }

  if (normalized === '0 * * * *') {
    return i18n._({ id: 'Every hour', message: 'Every hour' })
  }

  const fields = normalized.split(/\s+/)
  if (fields.length === 5) {
    const [minute, hour, dayOfMonth, month, dayOfWeek] = fields

    if (hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
      return i18n._({
        id: 'Daily at {time}',
        message: 'Daily at {time}',
        values: { time: formatScheduleTime(hour, minute) },
      })
    }

    if (hour !== '*' && dayOfMonth === '*' && month === '*' && dayOfWeek !== '*') {
      return i18n._({
        id: 'Weekly on {day} at {time}',
        message: 'Weekly on {day} at {time}',
        values: {
          day: formatScheduleWeekday(dayOfWeek),
          time: formatScheduleTime(hour, minute),
        },
      })
    }

    if (hour !== '*' && dayOfMonth !== '*' && month === '*' && dayOfWeek === '*') {
      return i18n._({
        id: 'Monthly on day {day} at {time}',
        message: 'Monthly on day {day} at {time}',
        values: {
          day: dayOfMonth,
          time: formatScheduleTime(hour, minute),
        },
      })
    }
  }

  return i18n._({
    id: 'Cron: {schedule}',
    message: 'Cron: {schedule}',
    values: { schedule: normalized },
  })
}

function formatScheduleTime(hour: string, minute: string) {
  return `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`
}

function formatScheduleWeekday(day: string) {
  switch (day) {
    case '0':
      return i18n._({ id: 'Sunday', message: 'Sunday' })
    case '1':
      return i18n._({ id: 'Monday', message: 'Monday' })
    case '2':
      return i18n._({ id: 'Tuesday', message: 'Tuesday' })
    case '3':
      return i18n._({ id: 'Wednesday', message: 'Wednesday' })
    case '4':
      return i18n._({ id: 'Thursday', message: 'Thursday' })
    case '5':
      return i18n._({ id: 'Friday', message: 'Friday' })
    case '6':
      return i18n._({ id: 'Saturday', message: 'Saturday' })
    default:
      return day
  }
}
