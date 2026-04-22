import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { FormErrorNotice } from '../components/ui/FormErrorNotice'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { JobFormFields } from '../components/ui/JobFormFields'
import { Modal } from '../components/ui/Modal'
import { ScheduleEditor } from '../components/ui/ScheduleEditor'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { Switch } from '../components/ui/Switch'
import { listAutomations } from '../features/automations/api'
import {
  cancelBackgroundJobRun,
  createBackgroundJob,
  deleteBackgroundJob,
  listBackgroundJobExecutors,
  listBackgroundJobRuns,
  listBackgroundJobs,
  pauseBackgroundJob,
  readJobMCPConfig,
  retryBackgroundJobRun,
  resumeBackgroundJob,
  runBackgroundJob,
  updateBackgroundJob,
  writeJobMCPConfig,
} from '../features/jobs/api'
import {
  normalizeExecutorFormPayload,
  validateExecutorFormPayload,
} from '../features/jobs/executorFormRuntime'
import {
  getJobFailurePresentation,
  isBackgroundJobRunRetryable,
} from '../features/jobs/errorPresentation'
import { listWorkspaces } from '../features/workspaces/api'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import type { BackgroundJob, BackgroundJobExecutor, BackgroundJobRun } from '../types/api'

type Draft = {
  name: string
  description: string
  workspaceId: string
  executorKind: string
  schedule: string
  payload: string
}

const DEFAULT_BACKGROUND_JOB_PAYLOAD = JSON.stringify(
  {
    message: i18n._({ id: 'background job smoke test', message: 'background job smoke test' }),
  },
  null,
  2,
)

const EMPTY_DRAFT: Draft = {
  name: '',
  description: '',
  workspaceId: '',
  executorKind: '',
  schedule: 'manual',
  payload: DEFAULT_BACKGROUND_JOB_PAYLOAD,
}

const JOB_STATS_STYLE_BLOCK = `
  .jobs-page__stats-grid {
    display: grid;
    gap: 16px;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  }

  .jobs-page__stats-card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 108px;
    padding: 18px 20px;
    overflow: hidden;
  }

  .jobs-page__stats-label {
    display: block;
    min-height: 2.35em;
    color: var(--text-faint);
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    line-height: 1.5;
    text-transform: uppercase;
  }

  .jobs-page__stats-value {
    margin-top: auto;
    display: block;
    color: var(--text-strong);
    font-size: 2rem;
    font-weight: 700;
    letter-spacing: -0.03em;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
  }

  .jobs-page__stats-card--danger {
    background:
      linear-gradient(180deg, color-mix(in srgb, var(--danger, #dc2626) 6%, transparent), transparent 52%),
      color-mix(in srgb, var(--surface-pane) 92%, transparent);
    border-color: color-mix(in srgb, var(--danger, #dc2626) 16%, var(--border-subtle));
  }

  .jobs-page__stats-card--danger::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: color-mix(in srgb, var(--danger, #dc2626) 36%, transparent);
  }

  .jobs-page__stats-card--danger .jobs-page__stats-value {
    color: color-mix(in srgb, var(--text-strong) 78%, var(--danger, #dc2626));
  }

  .jobs-page__stats-card--danger-active {
    border-color: color-mix(in srgb, var(--danger, #dc2626) 24%, var(--border-subtle));
    box-shadow: inset 0 1px 0 color-mix(in srgb, var(--danger, #dc2626) 10%, transparent);
  }

  @media (max-width: 640px) {
    .jobs-page__stats-grid {
      gap: 12px;
    }

    .jobs-page__stats-card {
      min-height: 92px;
      padding: 14px 16px;
      gap: 8px;
    }

    .jobs-page__stats-label {
      min-height: auto;
      font-size: 0.74rem;
      line-height: 1.4;
    }

    .jobs-page__stats-value {
      font-size: 1.75rem;
    }
  }
`

function getJobStatusPillStatus(job?: Pick<BackgroundJob, 'status' | 'lastRunStatus'> | null) {
  if (!job) {
    return ''
  }

  if (job.status === 'paused') {
    return 'paused'
  }

  if (job.lastRunStatus === 'failed') {
    return 'failed'
  }

  return 'active'
}

export function JobsPage() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [modalOpen, setModalOpen] = useState(false)
  const [jobDetailOpen, setJobDetailOpen] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState('')
  const [editingJob, setEditingJob] = useState<BackgroundJob | null>(null)
  const [selectedRunId, setSelectedRunId] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<BackgroundJob | null>(null)
  const [formError, setFormError] = useState('')
  const [cronPickerOpen, setCronPickerOpen] = useState(false)
  const [mcpWorkspaceId, setMcpWorkspaceId] = useState('')
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const [mcpServerName, setMcpServerName] = useState('codex-jobs')
  const [mcpToolSelectionMode, setMcpToolSelectionMode] = useState<'all' | 'custom'>('all')
  const [mcpSelectedToolNames, setMcpSelectedToolNames] = useState<string[]>([])
  const [toolExposureModalOpen, setToolExposureModalOpen] = useState(false)
  const [toolTablePage, setToolTablePage] = useState(1)
  const [mcpPanelExpanded, setMcpPanelExpanded] = useState(false)

  const TOOL_TABLE_PAGE_SIZE = 5

  const jobsQuery = useQuery({
    queryKey: ['background-jobs'],
    queryFn: listBackgroundJobs,
    refetchInterval: 10_000,
  })
  const executorsQuery = useQuery({
    queryKey: ['background-job-executors'],
    queryFn: listBackgroundJobExecutors,
  })
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })
  const automationsQuery = useQuery({
    queryKey: ['automations'],
    queryFn: listAutomations,
    refetchInterval: 10_000,
  })
  const runsQuery = useQuery({
    queryKey: ['background-job-runs', selectedJobId],
    queryFn: () => listBackgroundJobRuns(selectedJobId),
    enabled: !!selectedJobId,
    refetchInterval: 10_000,
  })
  const mcpConfigQuery = useQuery({
    queryKey: ['jobs-mcp-config', mcpWorkspaceId],
    queryFn: () => readJobMCPConfig(mcpWorkspaceId),
    enabled: !!mcpWorkspaceId,
  })

  useEffect(() => {
    if (!draft.workspaceId && workspacesQuery.data?.[0]?.id) {
      setDraft((current) => ({ ...current, workspaceId: workspacesQuery.data[0].id }))
    }
  }, [draft.workspaceId, workspacesQuery.data])

  useEffect(() => {
    if (mcpWorkspaceId) {
      return
    }
    const requestedWorkspaceId = searchParams.get('workspaceId')?.trim() ?? ''
    const workspaceId =
      workspacesQuery.data?.find((workspace) => workspace.id === requestedWorkspaceId)?.id ??
      workspacesQuery.data?.[0]?.id ??
      ''
    if (workspaceId) {
      setMcpWorkspaceId(workspaceId)
    }
  }, [mcpWorkspaceId, searchParams, workspacesQuery.data])

  useEffect(() => {
    if (!draft.executorKind && executorsQuery.data?.[0]?.kind) {
      const executor = selectDefaultBackgroundJobExecutor(executorsQuery.data)
      setDraft((current) => ({
        ...current,
        executorKind: executor.kind,
        payload: JSON.stringify(executor.examplePayload ?? {}, null, 2),
      }))
    }
  }, [draft.executorKind, executorsQuery.data])

  useEffect(() => {
    const config = mcpConfigQuery.data?.config
    if (!config) {
      return
    }
    setMcpEnabled(config.enabled)
    setMcpServerName(config.serverName || 'codex-jobs')
    const nextTools = normalizeManagedToolNames(config.toolAllowlist ?? [])
    setMcpToolSelectionMode(nextTools.length > 0 ? 'custom' : 'all')
    setMcpSelectedToolNames(nextTools)
  }, [mcpConfigQuery.data])

  useEffect(() => {
    const jobs = jobsQuery.data ?? []
    if (!jobs.length) {
      setSelectedJobId('')
      setJobDetailOpen(false)
      return
    }
    const requestedJobId = searchParams.get('jobId')?.trim() ?? ''
    const requestedSourceType = searchParams.get('sourceType')?.trim() ?? ''
    const requestedSourceRefId = searchParams.get('sourceRefId')?.trim() ?? ''
    const requestedJob =
      jobs.find((job) => job.id === requestedJobId) ??
      jobs.find(
        (job) =>
          requestedSourceType &&
          requestedSourceRefId &&
          job.sourceType === requestedSourceType &&
          job.sourceRefId === requestedSourceRefId,
      ) ??
      null

    if (requestedJob && requestedJob.id !== selectedJobId) {
      setSelectedJobId(requestedJob.id)
      return
    }
    if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(requestedJob?.id ?? jobs[0].id)
    }
  }, [jobsQuery.data, searchParams, selectedJobId])

  useEffect(() => {
    if (!selectedJobId) {
      return
    }
    if (searchParams.get('jobId') === selectedJobId) {
      return
    }
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('jobId', selectedJobId)
    setSearchParams(nextParams, { replace: true })
  }, [searchParams, selectedJobId, setSearchParams])

  useEffect(() => {
    if (!mcpWorkspaceId) {
      return
    }
    if (searchParams.get('workspaceId') === mcpWorkspaceId) {
      return
    }
    const nextParams = new URLSearchParams(searchParams)
    nextParams.set('workspaceId', mcpWorkspaceId)
    setSearchParams(nextParams, { replace: true })
  }, [mcpWorkspaceId, searchParams, setSearchParams])

  useEffect(() => {
    const runs = runsQuery.data ?? []
    if (!runs.length) {
      setSelectedRunId('')
      return
    }
    if (!selectedRunId || !runs.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runs[0].id)
    }
  }, [runsQuery.data, selectedRunId])

  const createMutation = useMutation({
    mutationFn: createBackgroundJob,
    onSuccess: async () => {
      closeModal()
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      await queryClient.invalidateQueries({ queryKey: ['background-job-runs'] })
    },
  })
  const updateMutation = useMutation({
    mutationFn: ({ jobId, input }: { jobId: string; input: Parameters<typeof updateBackgroundJob>[1] }) =>
      updateBackgroundJob(jobId, input),
    onSuccess: async (job) => {
      setEditingJob(null)
      setModalOpen(false)
      setSelectedJobId(job.id)
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
    },
  })
  const pauseMutation = useMutation({
    mutationFn: pauseBackgroundJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
    },
  })
  const resumeMutation = useMutation({
    mutationFn: resumeBackgroundJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
    },
  })
  const runMutation = useMutation({
    mutationFn: runBackgroundJob,
    onSuccess: async (_, jobId) => {
      setSelectedJobId(jobId)
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      await queryClient.invalidateQueries({ queryKey: ['background-job-runs', jobId] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deleteBackgroundJob,
    onSuccess: async (_, jobId) => {
      if (selectedJobId === jobId) {
        setSelectedJobId('')
        setJobDetailOpen(false)
      }
      setConfirmDelete(null)
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      await queryClient.invalidateQueries({ queryKey: ['background-job-runs'] })
    },
  })
  const retryRunMutation = useMutation({
    mutationFn: retryBackgroundJobRun,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      await queryClient.invalidateQueries({ queryKey: ['background-job-runs', selectedJobId] })
    },
  })
  const cancelRunMutation = useMutation({
    mutationFn: cancelBackgroundJobRun,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['background-jobs'] })
      await queryClient.invalidateQueries({ queryKey: ['background-job-runs', selectedJobId] })
    },
  })
  const saveMcpConfigMutation = useMutation({
    mutationFn: () =>
      writeJobMCPConfig(mcpWorkspaceId, {
        enabled: mcpEnabled,
        serverName: mcpServerName.trim(),
        toolAllowlist: mcpToolSelectionMode === 'all' ? [] : normalizeManagedToolNames(mcpSelectedToolNames),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['jobs-mcp-config', mcpWorkspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['mcp-server-status', mcpWorkspaceId] }),
      ])
    },
  })

  const jobs = jobsQuery.data ?? []
  const selectedJob = jobs.find((job) => job.id === selectedJobId) ?? null
  const selectedRuns = runsQuery.data ?? []
  const selectedRun = selectedRuns.find((run) => run.id === selectedRunId) ?? null
  const activeCount = jobs.filter((job) => job.status === 'active').length
  const pausedCount = jobs.filter((job) => job.status === 'paused').length
  const failedCount = jobs.filter((job) => job.lastRunStatus === 'failed').length
  const currentExecutor = executorsQuery.data?.find((item) => item.kind === draft.executorKind) ?? null
  const mcpRuntimeIntegration = mcpConfigQuery.data?.runtimeIntegration ?? null
  const availableManagedToolNames = normalizeManagedToolNames(mcpConfigQuery.data?.availableTools ?? [])
  const mcpVisibleSelectedToolNames =
    mcpToolSelectionMode === 'all' ? availableManagedToolNames : normalizeManagedToolNames(mcpSelectedToolNames)
  const allManagedToolsSelected =
    availableManagedToolNames.length > 0 && mcpVisibleSelectedToolNames.length === availableManagedToolNames.length
  const selectedJobStatus = getJobStatusPillStatus(selectedJob)
  const selectedJobFailure = selectedJob && hasJobFailure(selectedJob) ? getJobFailurePresentation(selectedJob) : null
  const selectedRunFailure = selectedRun && hasJobFailure(selectedRun) ? getJobFailurePresentation(selectedRun) : null
  const canRetrySelectedRun = selectedRun ? isRunRetryAllowed(selectedRun) : false
  const canCancelSelectedRun = selectedRun ? isRunCancelable(selectedRun) : false
  const retryBlockedMessage =
    selectedRun && !canRetrySelectedRun
      ? selectedRunFailure?.retryable === false || isBackgroundJobRunRetryable(selectedRun) === false
        ? selectedRunFailure?.message
        : i18n._({
            id: 'Retry is available after this run finishes.',
            message: 'Retry is available after this run finishes.',
          })
      : ''
  const jobStats = [
    {
      key: 'active',
      label: i18n._({ id: 'Active Jobs', message: 'Active Jobs' }),
      value: activeCount,
    },
    {
      key: 'paused',
      label: i18n._({ id: 'Paused Jobs', message: 'Paused Jobs' }),
      value: pausedCount,
    },
    {
      key: 'failed',
      label: i18n._({ id: 'Last Run Failed', message: 'Last Run Failed' }),
      value: failedCount,
      tone: 'danger' as const,
    },
  ]

  function closeJobDetails() {
    setJobDetailOpen(false)
  }

  function closeModal() {
    setModalOpen(false)
    setEditingJob(null)
    setFormError('')
    const nextExecutor =
      currentExecutor ??
      (executorsQuery.data?.length ? selectDefaultBackgroundJobExecutor(executorsQuery.data) : null)
    setDraft((current) => ({
      ...EMPTY_DRAFT,
      workspaceId: current.workspaceId || workspacesQuery.data?.[0]?.id || '',
      executorKind: nextExecutor?.kind || '',
      payload: JSON.stringify(nextExecutor?.examplePayload ?? {}, null, 2),
    }))
  }

  function openEditModal(job: BackgroundJob) {
    setEditingJob(job)
    setDraft({
      name: job.name,
      description: job.description,
      workspaceId: job.workspaceId,
      executorKind: job.executorKind,
      schedule: job.schedule?.trim() ? job.schedule : 'manual',
      payload: JSON.stringify(job.payload ?? {}, null, 2),
    })
    setFormError('')
    setModalOpen(true)
  }

  function openJobDetails(jobId: string) {
    if (jobId !== selectedJobId) {
      setSelectedRunId('')
    }
    setSelectedJobId(jobId)
    setJobDetailOpen(true)
  }

  function submitCreateForm() {
    setFormError('')
    let payload: Record<string, unknown> = {}

    try {
      const parsed = JSON.parse(draft.payload)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        payload = parsed as Record<string, unknown>
      } else {
        setFormError(i18n._({ id: 'Payload must be a JSON object.', message: 'Payload must be a JSON object.' }))
        return
      }
    } catch (error) {
      setFormError(getErrorMessage(error))
      return
    }

    const input = {
      sourceType: editingJob?.sourceType,
      sourceRefId: editingJob?.sourceRefId,
      name: draft.name.trim(),
      description: draft.description.trim(),
      workspaceId: draft.workspaceId,
      executorKind: draft.executorKind,
      schedule: draft.schedule.trim().toLowerCase() === 'manual' ? '' : draft.schedule.trim(),
      payload,
    }

    const executorFormFields = currentExecutor?.form?.fields ?? []
    payload = normalizeExecutorFormPayload(payload, executorFormFields)
    input.payload = payload
    const executorFormError = validateExecutorFormPayload(payload, executorFormFields, {
      fallbackSourceRefId: editingJob?.sourceRefId,
    })
    if (executorFormError) {
      setFormError(executorFormError)
      return
    }

    if (editingJob) {
      updateMutation.mutate({ jobId: editingJob.id, input })
      return
    }

    createMutation.mutate(input)
  }

  function submitManagedMcpConfig() {
    if (!mcpWorkspaceId) {
      return
    }
    saveMcpConfigMutation.mutate()
  }

  function resetManagedMcpConfigDraft() {
    const config = mcpConfigQuery.data?.config
    if (!config) {
      return
    }
    setMcpEnabled(config.enabled)
    setMcpServerName(config.serverName || 'codex-jobs')
    const nextTools = normalizeManagedToolNames(config.toolAllowlist ?? [])
    setMcpToolSelectionMode(nextTools.length > 0 ? 'custom' : 'all')
    setMcpSelectedToolNames(nextTools)
  }

  return (
    <section className="screen jobs-page">
      <style>{JOB_STATS_STYLE_BLOCK}</style>

      <section className="mode-strip">
        <div className="mode-strip__meta">
          <span className="mode-strip__eyebrow">
            {i18n._({ id: 'Background Jobs', message: 'Background Jobs' })}
          </span>
          <h1>{i18n._({ id: 'Job Control', message: 'Job Control' })}</h1>
          <p>
            {i18n._({
              id: 'Manage queued work, scheduled runs, and reusable executor interfaces from one place.',
              message: 'Manage queued work, scheduled runs, and reusable executor interfaces from one place.',
            })}
          </p>
        </div>
        <div className="mode-strip__actions">
          <Button onClick={() => setModalOpen(true)}>
            {i18n._({ id: 'Create Job', message: 'Create Job' })}
          </Button>
        </div>
      </section>

      <section className="stats-grid jobs-page__stats-grid">
        {jobStats.map((item) => (
          <article
            className={[
              'stats-card',
              'jobs-page__stats-card',
              item.tone === 'danger' ? 'jobs-page__stats-card--danger' : '',
              item.tone === 'danger' && item.value > 0 ? 'jobs-page__stats-card--danger-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            key={item.key}
          >
            <span className="jobs-page__stats-label">{item.label}</span>
            <strong className="jobs-page__stats-value">{item.value}</strong>
          </article>
        ))}
      </section>

      <section className="settings-section jobs-page__mcp-section jobs-page__mcp-section--muted">
        <header className="section-header">
          <div>
            <h2>{i18n._({ id: 'Managed MCP Tool', message: 'Managed MCP Tool' })}</h2>
            <p>
              {i18n._({
                id: 'Keep this configuration available when Codex should manage jobs through the workspace MCP endpoint.',
                message: 'Keep this configuration available when Codex should manage jobs through the workspace MCP endpoint.',
              })}
            </p>
          </div>
          <div className="section-header__actions">
            {mcpRuntimeIntegration ? <StatusPill status={mcpRuntimeIntegration.status} /> : null}
            <Button intent="ghost" onClick={() => setMcpPanelExpanded((current) => !current)}>
              {mcpPanelExpanded
                ? i18n._({ id: 'Hide Configuration', message: 'Hide Configuration' })
                : i18n._({ id: 'Show Configuration', message: 'Show Configuration' })}
            </Button>
          </div>
        </header>

        <div className="jobs-page__mcp-summary">
          <article className="jobs-page__mcp-summary-card">
            <span>{i18n._({ id: 'Status', message: 'Status' })}</span>
            <strong>
              {mcpEnabled
                ? i18n._({ id: 'Managed MCP enabled', message: 'Managed MCP enabled' })
                : i18n._({ id: 'Managed MCP disabled', message: 'Managed MCP disabled' })}
            </strong>
          </article>
          <article className="jobs-page__mcp-summary-card">
            <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
            <strong>{workspacesQuery.data?.find((workspace) => workspace.id === mcpWorkspaceId)?.name || '—'}</strong>
          </article>
          <article className="jobs-page__mcp-summary-card">
            <span>{i18n._({ id: 'Server Name', message: 'Server Name' })}</span>
            <strong>
              {mcpServerName.trim() || i18n._({ id: 'Not configured', message: 'Not configured' })}
            </strong>
          </article>
        </div>

        {mcpPanelExpanded ? (
          <>
            <div className="jobs-page__management-grid">
              <div className="settings-card jobs-page__group-card jobs-page__config-node">
                <header className="section-header">
                  <div>
                    <h3>{i18n._({ id: 'Workspace Configuration', message: 'Workspace Configuration' })}</h3>
                    <p>
                      {i18n._({
                        id: 'Keep workspace selection, naming, enablement, and save actions in one compact block.',
                        message: 'Keep workspace selection, naming, enablement, and save actions in one compact block.',
                      })}
                    </p>
                  </div>
                </header>
                <div className="jobs-page__compact-form">
                  <label className="field">
                    <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
                      fullWidth
                      value={mcpWorkspaceId}
                      onChange={setMcpWorkspaceId}
                      options={(workspacesQuery.data ?? []).map((workspace) => ({
                        value: workspace.id,
                        label: workspace.name,
                      }))}
                    />
                  </label>
                  <Input
                    label={i18n._({ id: 'Managed MCP Server Name', message: 'Managed MCP Server Name' })}
                    value={mcpServerName}
                    onChange={(event) => setMcpServerName(event.target.value)}
                  />
                  <div className="jobs-page__compact-form jobs-page__compact-form--single">
                    <Switch
                      label={i18n._({ id: 'Enable managed MCP tool', message: 'Enable managed MCP tool' })}
                      hint={i18n._({
                        id: 'This saves one workspace-level MCP server for all Codex sessions in the selected workspace.',
                        message:
                          'This saves one workspace-level MCP server for all Codex sessions in the selected workspace.',
                      })}
                      checked={mcpEnabled}
                      onChange={(event) => setMcpEnabled(event.target.checked)}
                    />
                  </div>
                </div>
                <div className="jobs-page__node-actions">
                  <Button intent="secondary" onClick={resetManagedMcpConfigDraft}>
                    {i18n._({ id: 'Reset Form', message: 'Reset Form' })}
                  </Button>
                  <Button onClick={submitManagedMcpConfig} disabled={!mcpWorkspaceId || saveMcpConfigMutation.isPending}>
                    {saveMcpConfigMutation.isPending
                      ? i18n._({ id: 'Saving…', message: 'Saving…' })
                      : i18n._({ id: 'Save MCP Tool Config', message: 'Save MCP Tool Config' })}
                  </Button>
                </div>
              </div>

              <div className="settings-card jobs-page__group-card jobs-page__config-node jobs-page__config-node--exposure">
                <div className="feishu-tool-selector-card">
                  <div className="section-header">
                    <div>
                      <h3>{i18n._({ id: 'Tool Exposure', message: 'Tool Exposure' })}</h3>
                      <p>
                        {i18n._({
                          id: 'Manage Jobs MCP visibility as a separate configuration node from workspace endpoint settings.',
                          message: 'Manage Jobs MCP visibility as a separate configuration node from workspace endpoint settings.',
                        })}
                      </p>
                    </div>
                    <div className="section-header__actions">
                      <span className="meta-pill">
                        {mcpToolSelectionMode === 'all'
                          ? i18n._({ id: 'All tools exposed', message: 'All tools exposed' })
                          : i18n._({
                              id: '{count} of {total} tools selected',
                              message: '{count} of {total} tools selected',
                              values: {
                                count: mcpVisibleSelectedToolNames.length,
                                total: availableManagedToolNames.length,
                              },
                            })}
                      </span>
                      <span className="meta-pill">
                        {i18n._({
                          id: '{count} tools available',
                          message: '{count} tools available',
                          values: { count: availableManagedToolNames.length },
                        })}
                      </span>
                      <Button
                        intent="secondary"
                        onClick={() => {
                          setToolTablePage(1)
                          setToolExposureModalOpen(true)
                        }}
                      >
                        {i18n._({ id: 'Configure', message: 'Configure' })}
                      </Button>
                    </div>
                  </div>

                  <div className="jobs-page__exposure-overview">
                    <div className="jobs-page__exposure-copy">
                      <strong>
                        {mcpToolSelectionMode === 'all'
                          ? i18n._({
                              id: 'All managed Jobs MCP tools are currently exposed to Codex in this workspace.',
                              message: 'All managed Jobs MCP tools are currently exposed to Codex in this workspace.',
                            })
                          : i18n._({
                              id: '{count} of {total} tools selected',
                              message: '{count} of {total} tools selected',
                              values: {
                                count: mcpVisibleSelectedToolNames.length,
                                total: availableManagedToolNames.length,
                              },
                            })}
                      </strong>
                      <span>
                        {i18n._({
                          id: 'Open the selector to change which managed Jobs MCP operations remain visible to Codex.',
                          message: 'Open the selector to change which managed Jobs MCP operations remain visible to Codex.',
                        })}
                      </span>
                    </div>
                    {mcpVisibleSelectedToolNames.length > 0 ? (
                      <div className="feishu-tool-selector-chip-list">
                        {mcpVisibleSelectedToolNames.map((toolName) => (
                          <span className="meta-pill" key={toolName}>
                            {toolName}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            {mcpRuntimeIntegration?.serverUrl ? (
              <InlineNotice tone="info" title={i18n._({ id: 'Managed MCP Endpoint', message: 'Managed MCP Endpoint' })}>
                <code>{mcpRuntimeIntegration.serverUrl}</code>
              </InlineNotice>
            ) : null}
            {mcpRuntimeIntegration?.detail ? (
              <InlineNotice tone="info" title={i18n._({ id: 'Runtime Integration', message: 'Runtime Integration' })}>
                {mcpRuntimeIntegration.detail}
              </InlineNotice>
            ) : null}
            <FormErrorNotice
              error={mcpConfigQuery.error ? getErrorMessage(mcpConfigQuery.error) : ''}
              title={i18n._({ id: 'Failed To Load MCP Tool Config', message: 'Failed To Load MCP Tool Config' })}
            />
            <FormErrorNotice
              error={saveMcpConfigMutation.error ? getErrorMessage(saveMcpConfigMutation.error) : ''}
              title={i18n._({ id: 'Failed To Save MCP Tool Config', message: 'Failed To Save MCP Tool Config' })}
            />
          </>
        ) : null}
      </section>

      {jobsQuery.error ? (
        <InlineNotice tone="error" title={i18n._({ id: 'Failed To Load Jobs', message: 'Failed To Load Jobs' })}>
          {getErrorMessage(jobsQuery.error)}
        </InlineNotice>
      ) : null}

      <section className="settings-card jobs-page__command-bar">
        <div className="jobs-page__command-bar-copy">
          <span className="mode-strip__eyebrow">{i18n._({ id: 'Primary Actions', message: 'Primary Actions' })}</span>
          <h2>
            {selectedJob
              ? i18n._({ id: 'Manage Selected Job', message: 'Manage Selected Job' })
              : i18n._({ id: 'Select a job to manage', message: 'Select a job to manage' })}
          </h2>
          <p>
            {selectedJob
              ? selectedJob.description || i18n._({ id: 'No description provided.', message: 'No description provided.' })
              : i18n._({
                  id: 'Choose a job from the list to run it, edit its definition, or change its schedule state.',
                  message: 'Choose a job from the list to run it, edit its definition, or change its schedule state.',
                })}
          </p>
        </div>
        <div className="jobs-page__command-bar-actions">
          <Button onClick={() => setModalOpen(true)}>{i18n._({ id: 'Create Job', message: 'Create Job' })}</Button>
          {selectedJob ? (
            <>
              <Button intent="ghost" onClick={() => openJobDetails(selectedJob.id)}>
                {i18n._({ id: 'Open Details', message: 'Open Details' })}
              </Button>
              <Button
                intent="secondary"
                onClick={() => runMutation.mutate(selectedJob.id)}
                disabled={runMutation.isPending}
              >
                {i18n._({ id: 'Run Now', message: 'Run Now' })}
              </Button>
              <Button intent="ghost" onClick={() => openEditModal(selectedJob)}>
                {i18n._({ id: 'Edit', message: 'Edit' })}
              </Button>
              {selectedJob.status === 'paused' ? (
                <Button intent="secondary" onClick={() => resumeMutation.mutate(selectedJob.id)}>
                  {i18n._({ id: 'Resume', message: 'Resume' })}
                </Button>
              ) : (
                <Button intent="secondary" onClick={() => pauseMutation.mutate(selectedJob.id)}>
                  {i18n._({ id: 'Pause', message: 'Pause' })}
                </Button>
              )}
              <Button intent="ghost" onClick={() => setConfirmDelete(selectedJob)}>
                {i18n._({ id: 'Delete', message: 'Delete' })}
              </Button>
            </>
          ) : null}
        </div>
      </section>

      <div className="detail-layout detail-layout--single">
        <section className="detail-layout__main settings-section">
          <header className="section-header">
            <div>
              <h2>{i18n._({ id: 'Jobs', message: 'Jobs' })}</h2>
            </div>
            <div className="section-header__meta">{jobs.length}</div>
          </header>

          {jobs.length ? (
            <div className="automation-compact-list">
              {jobs.map((job) => (
                <article
                  key={job.id}
                  className={`automation-compact-row ${selectedJobId === job.id ? 'automation-compact-row--selected' : ''}`}
                >
                  <button
                    className="automation-compact-row__main"
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <div className="automation-compact-row__title">
                      <h3>{job.name}</h3>
                      <StatusPill status={getJobStatusPillStatus(job)} />
                    </div>
                    <p>{job.description || i18n._({ id: 'No description provided.', message: 'No description provided.' })}</p>
                    <dl className="automation-compact-row__meta">
                      <div>
                        <dt>{i18n._({ id: 'Executor', message: 'Executor' })}</dt>
                        <dd>{job.executorKind}</dd>
                      </div>
                      <div>
                        <dt>{i18n._({ id: 'Workspace', message: 'Workspace' })}</dt>
                        <dd>{job.workspaceName}</dd>
                      </div>
                      <div>
                        <dt>{i18n._({ id: 'Schedule', message: 'Schedule' })}</dt>
                        <dd>{job.scheduleLabel || i18n._({ id: 'Manual only', message: 'Manual only' })}</dd>
                      </div>
                      <div>
                        <dt>{i18n._({ id: 'Source', message: 'Source' })}</dt>
                        <dd>{job.sourceType && job.sourceRefId ? `${job.sourceType} · ${job.sourceRefId}` : '—'}</dd>
                      </div>
                      <div>
                        <dt>{i18n._({ id: 'Next Run', message: 'Next Run' })}</dt>
                        <dd>{formatDateTime(job.nextRunAt) || i18n._({ id: 'Not scheduled', message: 'Not scheduled' })}</dd>
                      </div>
                    </dl>
                  </button>
                  <div className="automation-compact-row__actions jobs-page__row-actions">
                    <div className="jobs-page__action-cluster">
                      <Button
                        type="button"
                        intent="secondary"
                        onClick={() => runMutation.mutate(job.id)}
                        disabled={runMutation.isPending}
                      >
                        {i18n._({ id: 'Run Now', message: 'Run Now' })}
                      </Button>
                      <Button
                        type="button"
                        intent="ghost"
                        aria-haspopup="dialog"
                        aria-expanded={jobDetailOpen && selectedJobId === job.id}
                        onClick={() => openJobDetails(job.id)}
                      >
                        {i18n._({ id: 'Open Details', message: 'Open Details' })}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : jobsQuery.isLoading ? (
            <div className="notice">
              {i18n._({ id: 'Loading jobs…', message: 'Loading jobs…' })}
            </div>
          ) : (
            <InlineNotice tone="info" title={i18n._({ id: 'No Jobs Yet', message: 'No Jobs Yet' })}>
              {i18n._({
                id: 'Create a background job to queue work, schedule executor runs, or expose a reusable interface for Codex and bot workflows.',
                message:
                  'Create a background job to queue work, schedule executor runs, or expose a reusable interface for Codex and bot workflows.',
              })}
            </InlineNotice>
          )}
        </section>
      </div>

      {jobDetailOpen && selectedJob ? (
        <Modal
          title={i18n._({ id: 'Job Details', message: 'Job Details' })}
          description={selectedJob.name}
          onClose={closeJobDetails}
          maxWidth="min(1080px, calc(100vw - 40px))"
          className="jobs-page__detail-modal"
          footer={
            <Button intent="ghost" onClick={closeJobDetails}>
              {i18n._({ id: 'Close', message: 'Close' })}
            </Button>
          }
        >
          <div className="jobs-page__detail-drawer">
            <section className="jobs-page__detail-hero">
              <div className="jobs-page__detail-hero-main">
                <span className="mode-strip__eyebrow">{i18n._({ id: 'Selected Job', message: 'Selected Job' })}</span>
                <div className="jobs-page__detail-title-row">
                  <h3>{selectedJob.name}</h3>
                  <StatusPill status={selectedJobStatus} />
                </div>
                <p>
                  {selectedJob.description ||
                    i18n._({ id: 'No description provided.', message: 'No description provided.' })}
                </p>
                <div className="jobs-page__detail-meta">
                  <span className="meta-pill">{selectedJob.workspaceName}</span>
                  <span className="meta-pill">{selectedJob.executorKind}</span>
                  <span className="meta-pill">
                    {selectedJob.scheduleLabel || i18n._({ id: 'Manual only', message: 'Manual only' })}
                  </span>
                  <span className="meta-pill">
                    {selectedJob.sourceType && selectedJob.sourceRefId
                      ? `${selectedJob.sourceType} · ${selectedJob.sourceRefId}`
                      : i18n._({ id: 'Standalone job', message: 'Standalone job' })}
                  </span>
                </div>
              </div>
              <div className="jobs-page__action-cluster">
                <Button
                  intent="secondary"
                  onClick={() => runMutation.mutate(selectedJob.id)}
                  disabled={runMutation.isPending}
                >
                  {i18n._({ id: 'Run Now', message: 'Run Now' })}
                </Button>
                <Button intent="ghost" onClick={() => openEditModal(selectedJob)}>
                  {i18n._({ id: 'Edit', message: 'Edit' })}
                </Button>
                {selectedJob.status === 'paused' ? (
                  <Button intent="secondary" onClick={() => resumeMutation.mutate(selectedJob.id)}>
                    {i18n._({ id: 'Resume', message: 'Resume' })}
                  </Button>
                ) : (
                  <Button intent="secondary" onClick={() => pauseMutation.mutate(selectedJob.id)}>
                    {i18n._({ id: 'Pause', message: 'Pause' })}
                  </Button>
                )}
                <Button intent="ghost" onClick={() => setConfirmDelete(selectedJob)}>
                  {i18n._({ id: 'Delete', message: 'Delete' })}
                </Button>
              </div>
            </section>

            <div className="jobs-page__detail-grid">
              <div className="jobs-page__detail-column">
                <section className="settings-card jobs-page__detail-card jobs-page__job-overview">
                  <header className="section-header">
                    <div>
                      <h3>{i18n._({ id: 'Job Overview', message: 'Job Overview' })}</h3>
                      <p>
                        {i18n._({
                          id: 'Review the current job configuration, schedule, and latest execution state.',
                          message: 'Review the current job configuration, schedule, and latest execution state.',
                        })}
                      </p>
                    </div>
                    <StatusPill status={selectedJobStatus} />
                  </header>
                  <dl className="definition-grid">
                    <div>
                      <dt>{i18n._({ id: 'Workspace', message: 'Workspace' })}</dt>
                      <dd>{selectedJob.workspaceName}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Executor', message: 'Executor' })}</dt>
                      <dd>{selectedJob.executorKind}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Schedule', message: 'Schedule' })}</dt>
                      <dd>{selectedJob.scheduleLabel || i18n._({ id: 'Manual only', message: 'Manual only' })}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Next Run', message: 'Next Run' })}</dt>
                      <dd>{formatDateTime(selectedJob.nextRunAt) || i18n._({ id: 'Not scheduled', message: 'Not scheduled' })}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Last Run', message: 'Last Run' })}</dt>
                      <dd>{formatDateTime(selectedJob.lastRunAt) || i18n._({ id: 'Never', message: 'Never' })}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Last Status', message: 'Last Status' })}</dt>
                      <dd>
                        {selectedJob.lastRunStatus ? (
                          <StatusPill status={selectedJob.lastRunStatus} />
                        ) : (
                          i18n._({ id: 'Idle', message: 'Idle' })
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Created', message: 'Created' })}</dt>
                      <dd>{formatDateTime(selectedJob.createdAt) || '—'}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Updated', message: 'Updated' })}</dt>
                      <dd>{formatDateTime(selectedJob.updatedAt) || '—'}</dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Managed Source', message: 'Managed Source' })}</dt>
                      <dd>
                        {selectedJob.sourceType && selectedJob.sourceRefId
                          ? `${selectedJob.sourceType} · ${selectedJob.sourceRefId}`
                          : i18n._({ id: 'Standalone job', message: 'Standalone job' })}
                      </dd>
                    </div>
                    <div>
                      <dt>{i18n._({ id: 'Last Error', message: 'Last Error' })}</dt>
                      <dd>{selectedJobFailure?.message || '—'}</dd>
                    </div>
                  </dl>
                  {selectedJobFailure ? (
                    <InlineNotice
                      tone="error"
                      title={i18n._({ id: 'Latest Failure', message: 'Latest Failure' })}
                      details={selectedJobFailure.details.join('\n')}
                    >
                      {selectedJobFailure.message}
                    </InlineNotice>
                  ) : null}
                  {runMutation.error ? (
                    <InlineNotice
                      tone="error"
                      title={i18n._({ id: 'Failed To Start Job Run', message: 'Failed To Start Job Run' })}
                      details={getJobFailurePresentation(runMutation.error).details.join('\n')}
                    >
                      {getJobFailurePresentation(runMutation.error).message}
                    </InlineNotice>
                  ) : null}
                </section>

                <section className="settings-card jobs-page__detail-card">
                  <header className="section-header">
                    <div>
                      <h3>{i18n._({ id: 'Recent Runs', message: 'Recent Runs' })}</h3>
                      <p>
                        {i18n._({
                          id: 'Review the latest activity for this job and pick one run to inspect in detail.',
                          message: 'Review the latest activity for this job and pick one run to inspect in detail.',
                        })}
                      </p>
                    </div>
                    <div className="section-header__meta">{selectedRuns.length}</div>
                  </header>

                  {runsQuery.error ? (
                    <InlineNotice tone="error" title={i18n._({ id: 'Failed To Load Run Data', message: 'Failed To Load Run Data' })}>
                      {getErrorMessage(runsQuery.error)}
                    </InlineNotice>
                  ) : null}

                  <div className="timeline-list jobs-page__timeline-list">
                    {selectedRuns.length ? (
                      selectedRuns.map((run) => (
                        <button
                          key={run.id}
                          type="button"
                          className={`timeline-card ${selectedRunId === run.id ? 'timeline-card--selected' : ''}`}
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          <div className="timeline-card__header">
                            <strong>{run.trigger}</strong>
                            <StatusPill status={run.status} />
                          </div>
                          <p>{run.summary || (hasJobFailure(run) ? getJobFailurePresentation(run).message : '—')}</p>
                          <small>
                            {formatDateTime(run.startedAt)}{' '}
                            {run.finishedAt ? `→ ${formatDateTime(run.finishedAt)}` : ''}
                          </small>
                        </button>
                      ))
                    ) : runsQuery.isLoading ? (
                      <div className="notice">
                        {i18n._({ id: 'Loading run history…', message: 'Loading run history…' })}
                      </div>
                    ) : (
                      <div className="notice">
                        {i18n._({ id: 'No runs yet.', message: 'No runs yet.' })}
                      </div>
                    )}
                  </div>
                </section>
              </div>

              <div className="jobs-page__detail-column">
                <section className="settings-card jobs-page__detail-card jobs-page__detail-card--run-detail">
                  <header className="section-header">
                    <div>
                      <h3>{i18n._({ id: 'Run Detail', message: 'Run Detail' })}</h3>
                      <p>
                        {selectedRun
                          ? i18n._({
                              id: 'Inspect the selected run summary, output, and execution log.',
                              message: 'Inspect the selected run summary, output, and execution log.',
                            })
                          : i18n._({
                              id: 'Choose one run from Recent Runs to inspect its summary, output, and execution log.',
                              message: 'Choose one run from Recent Runs to inspect its summary, output, and execution log.',
                            })}
                      </p>
                    </div>
                    {selectedRun ? <StatusPill status={selectedRun.status} /> : null}
                  </header>

                  {selectedRun ? (
                    <>
                      <dl className="definition-grid">
                        <div>
                          <dt>{i18n._({ id: 'Status', message: 'Status' })}</dt>
                          <dd>
                            <StatusPill status={selectedRun.status} />
                          </dd>
                        </div>
                        <div>
                          <dt>{i18n._({ id: 'Trigger', message: 'Trigger' })}</dt>
                          <dd>{selectedRun.trigger}</dd>
                        </div>
                        <div>
                          <dt>{i18n._({ id: 'Started At', message: 'Started At' })}</dt>
                          <dd>{formatDateTime(selectedRun.startedAt) || '—'}</dd>
                        </div>
                        <div>
                          <dt>{i18n._({ id: 'Finished At', message: 'Finished At' })}</dt>
                          <dd>{formatDateTime(selectedRun.finishedAt) || i18n._({ id: 'Still running', message: 'Still running' })}</dd>
                        </div>
                        <div>
                          <dt>{i18n._({ id: 'Summary', message: 'Summary' })}</dt>
                          <dd>{selectedRun.summary || '—'}</dd>
                        </div>
                        <div>
                          <dt>{i18n._({ id: 'Error', message: 'Error' })}</dt>
                          <dd>{selectedRunFailure?.message || '—'}</dd>
                        </div>
                      </dl>

                      {selectedRunFailure ? (
                        <InlineNotice
                          tone="error"
                          title={i18n._({ id: 'Failure Details', message: 'Failure Details' })}
                          details={selectedRunFailure.details.join('\n')}
                        >
                          {selectedRunFailure.message}
                        </InlineNotice>
                      ) : null}
                      {!canRetrySelectedRun && retryBlockedMessage ? (
                        <InlineNotice tone="info" title={i18n._({ id: 'Retry Unavailable', message: 'Retry Unavailable' })}>
                          {retryBlockedMessage}
                        </InlineNotice>
                      ) : null}
                      {retryRunMutation.error ? (
                        <InlineNotice
                          tone="error"
                          title={i18n._({ id: 'Failed To Retry Run', message: 'Failed To Retry Run' })}
                          details={getJobFailurePresentation(retryRunMutation.error).details.join('\n')}
                        >
                          {getJobFailurePresentation(retryRunMutation.error).message}
                        </InlineNotice>
                      ) : null}
                      {cancelRunMutation.error ? (
                        <InlineNotice
                          tone="error"
                          title={i18n._({ id: 'Failed To Cancel Run', message: 'Failed To Cancel Run' })}
                          details={getJobFailurePresentation(cancelRunMutation.error).details.join('\n')}
                        >
                          {getJobFailurePresentation(cancelRunMutation.error).message}
                        </InlineNotice>
                      ) : null}

                      <div className="jobs-page__action-cluster jobs-page__action-cluster--muted jobs-page__detail-run-actions">
                        <Button
                          intent="secondary"
                          onClick={() => retryRunMutation.mutate(selectedRun.id)}
                          disabled={retryRunMutation.isPending || !canRetrySelectedRun}
                        >
                          {i18n._({ id: 'Retry Run', message: 'Retry Run' })}
                        </Button>
                        <Button
                          intent="ghost"
                          onClick={() => cancelRunMutation.mutate(selectedRun.id)}
                          disabled={cancelRunMutation.isPending || !canCancelSelectedRun}
                        >
                          {i18n._({ id: 'Cancel Run', message: 'Cancel Run' })}
                        </Button>
                      </div>

                      <JobRunOutputBlock run={selectedRun} />

                      {selectedRun.logs.length ? (
                        <div className="jobs-page__detail-block">
                          <div className="jobs-page__detail-block-header">
                            <h4>{i18n._({ id: 'Logs', message: 'Logs' })}</h4>
                            <span className="section-header__meta">{selectedRun.logs.length}</span>
                          </div>
                          <div className="jobs-page__log-list">
                            {selectedRun.logs.map((entry) => (
                              <article className="jobs-page__log-entry" key={entry.id}>
                                <div className="jobs-page__log-entry-head">
                                  <div className="jobs-page__log-entry-meta">
                                    <span className="meta-pill">{entry.level}</span>
                                    {entry.eventType ? <span className="meta-pill">{entry.eventType}</span> : null}
                                  </div>
                                  <time>{formatDateTime(entry.ts) || entry.ts}</time>
                                </div>
                                <p>{entry.message}</p>
                              </article>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div className="jobs-page__detail-empty">
                      {i18n._({
                        id: 'Choose one run from Recent Runs to inspect its summary, output, and execution log.',
                        message: 'Choose one run from Recent Runs to inspect its summary, output, and execution log.',
                      })}
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </Modal>
      ) : null}

      {modalOpen ? (
        <Modal
          title={
            editingJob
              ? i18n._({ id: 'Edit Background Job', message: 'Edit Background Job' })
              : i18n._({ id: 'Create Background Job', message: 'Create Background Job' })
          }
          onClose={closeModal}
          footer={
            <>
              <Button intent="ghost" onClick={closeModal}>
                {i18n._({ id: 'Cancel', message: 'Cancel' })}
              </Button>
              <Button onClick={submitCreateForm} disabled={createMutation.isPending || updateMutation.isPending}>
                {editingJob
                  ? i18n._({ id: 'Save Changes', message: 'Save Changes' })
                  : i18n._({ id: 'Create Job', message: 'Create Job' })}
              </Button>
            </>
          }
        >
          <div className="form-grid">
            <JobFormFields
              draft={draft}
              setDraft={setDraft}
              workspaces={workspacesQuery.data ?? []}
              executors={executorsQuery.data ?? []}
              automations={automationsQuery.data ?? []}
              currentExecutor={currentExecutor}
              sourceType={editingJob?.sourceType}
              sourceRefId={editingJob?.sourceRefId}
            />
            <ScheduleEditor
              schedule={draft.schedule}
              manualLabel="manual"
              onChange={(schedule) => setDraft((current) => ({ ...current, schedule }))}
              cronPickerOpen={cronPickerOpen}
              onCronPickerOpenChange={setCronPickerOpen}
            />
            <FormErrorNotice
              error={formError}
              title={i18n._({ id: 'Invalid Form Data', message: 'Invalid Form Data' })}
            />
            <FormErrorNotice
              error={createMutation.error ? getJobFailurePresentation(createMutation.error).message : ''}
              title={i18n._({ id: 'Failed To Create Job', message: 'Failed To Create Job' })}
            />
            <FormErrorNotice
              error={updateMutation.error ? getJobFailurePresentation(updateMutation.error).message : ''}
              title={i18n._({ id: 'Failed To Update Job', message: 'Failed To Update Job' })}
            />
          </div>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title={i18n._({ id: 'Delete Job', message: 'Delete Job' })}
          description={
            confirmDelete
              ? i18n._({
                  id: 'Delete {name} and its stored run history.',
                  message: 'Delete {name} and its stored run history.',
                  values: { name: confirmDelete.name },
                })
              : ''
          }
          confirmLabel={i18n._({ id: 'Delete', message: 'Delete' })}
          error={deleteMutation.error ? getJobFailurePresentation(deleteMutation.error).message : null}
          onClose={() => {
            if (!deleteMutation.isPending) {
              setConfirmDelete(null)
              deleteMutation.reset()
            }
          }}
          onConfirm={() => {
            if (confirmDelete) {
              deleteMutation.mutate(confirmDelete.id)
            }
          }}
          isPending={deleteMutation.isPending}
        />
      ) : null}

      {toolExposureModalOpen ? (
        <Modal
          title={i18n._({ id: 'Tool Exposure', message: 'Tool Exposure' })}
          description={i18n._({
            id: 'Choose whether Codex can use the full Jobs MCP toolset or only selected operations.',
            message: 'Choose whether Codex can use the full Jobs MCP toolset or only selected operations.',
          })}
          onClose={() => setToolExposureModalOpen(false)}
          maxWidth="min(720px, 100%)"
          footer={
            <>
              <Button intent="ghost" onClick={() => setToolExposureModalOpen(false)}>
                {i18n._({ id: 'Close', message: 'Close' })}
              </Button>
              <Button onClick={() => setToolExposureModalOpen(false)}>
                {i18n._({ id: 'Apply', message: 'Apply' })}
              </Button>
            </>
          }
        >
          <fieldset className="feishu-tool-selector-mode" aria-label={i18n._({ id: 'Tool exposure mode', message: 'Tool exposure mode' })}>
            <legend>{i18n._({ id: 'Exposure Mode', message: 'Exposure Mode' })}</legend>
            <label className="feishu-tool-selector-mode__option">
              <input
                type="radio"
                name="jobs-mcp-tool-selection-mode-modal"
                checked={mcpToolSelectionMode === 'all'}
                onChange={() => setMcpToolSelectionMode('all')}
              />
              <div>
                <strong>{i18n._({ id: 'All Tools', message: 'All Tools' })}</strong>
                <span>
                  {i18n._({
                    id: 'Expose the full Jobs MCP toolset to Codex in this workspace.',
                    message: 'Expose the full Jobs MCP toolset to Codex in this workspace.',
                  })}
                </span>
              </div>
            </label>
            <label className="feishu-tool-selector-mode__option">
              <input
                type="radio"
                name="jobs-mcp-tool-selection-mode-modal"
                checked={mcpToolSelectionMode === 'custom'}
                onChange={() => setMcpToolSelectionMode('custom')}
              />
              <div>
                <strong>{i18n._({ id: 'Selected Tools Only', message: 'Selected Tools Only' })}</strong>
                <span>
                  {i18n._({
                    id: 'Expose only the checked Jobs MCP operations.',
                    message: 'Expose only the checked Jobs MCP operations.',
                  })}
                </span>
              </div>
            </label>
          </fieldset>

          {mcpToolSelectionMode === 'all' ? (
            <InlineNotice tone="info" title={i18n._({ id: 'All Tools Exposed', message: 'All Tools Exposed' })}>
              {i18n._({
                id: 'All managed Jobs MCP tools are currently exposed to Codex in this workspace.',
                message: 'All managed Jobs MCP tools are currently exposed to Codex in this workspace.',
              })}
            </InlineNotice>
          ) : null}

          <div className="feishu-tool-selector-card__actions">
            <Button
              intent="secondary"
              type="button"
              onClick={() => setMcpSelectedToolNames(availableManagedToolNames)}
              disabled={mcpToolSelectionMode === 'all' || allManagedToolsSelected}
            >
              {i18n._({ id: 'Select All Tools', message: 'Select All Tools' })}
            </Button>
            <Button
              intent="secondary"
              type="button"
              onClick={() => setMcpSelectedToolNames([])}
              disabled={mcpToolSelectionMode === 'all' || mcpSelectedToolNames.length === 0}
            >
              {i18n._({ id: 'Clear Selection', message: 'Clear Selection' })}
            </Button>
          </div>

          {mcpVisibleSelectedToolNames.length > 0 ? (
            <div className="feishu-tool-selector-chip-list">
              {mcpVisibleSelectedToolNames.map((toolName) => (
                <span className="meta-pill" key={toolName}>
                  {toolName}
                </span>
              ))}
            </div>
          ) : mcpToolSelectionMode === 'custom' ? (
            <InlineNotice tone="info" title={i18n._({ id: 'No Tools Selected', message: 'No Tools Selected' })}>
              {i18n._({
                id: 'Choose at least one Jobs MCP tool or switch back to All Tools.',
                message: 'Choose at least one Jobs MCP tool or switch back to All Tools.',
              })}
            </InlineNotice>
          ) : null}

          {availableManagedToolNames.length ? (
            <>
              <div className="feishu-tool-selector-table__viewport">
                <table className="feishu-tool-selector-table">
                  <colgroup>
                    <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--toggle" />
                    <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--tool" />
                    <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--category" />
                    <col className="feishu-tool-selector-table__col feishu-tool-selector-table__col--controls" />
                  </colgroup>
                   <thead>
                    <tr>
                      <th className="feishu-tool-selector-table__header feishu-tool-selector-table__header--toggle" scope="col">
                        {i18n._({ id: 'Use', message: 'Use' })}
                      </th>
                      <th className="feishu-tool-selector-table__header" scope="col">
                        {i18n._({ id: 'Tool', message: 'Tool' })}
                      </th>
                      <th className="feishu-tool-selector-table__header" scope="col">
                        {i18n._({ id: 'Category', message: 'Category' })}
                      </th>
                      <th className="feishu-tool-selector-table__header" scope="col">
                        {i18n._({ id: 'Operation', message: 'Operation' })}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {availableManagedToolNames
                      .slice((toolTablePage - 1) * TOOL_TABLE_PAGE_SIZE, toolTablePage * TOOL_TABLE_PAGE_SIZE)
                      .map((toolName) => {
                        const checked = mcpToolSelectionMode === 'all' || mcpSelectedToolNames.includes(toolName)
                        const meta = describeManagedTool(toolName)
                        return (
                          <tr
                            className={[
                              'feishu-tool-selector-table__row',
                              checked ? 'feishu-tool-selector-table__row--selected' : '',
                              mcpToolSelectionMode === 'all' ? 'feishu-tool-selector-table__row--muted' : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            key={toolName}
                          >
                            <td className="feishu-tool-selector-table__cell feishu-tool-selector-table__cell--toggle">
                              <Switch
                                aria-label={toolName}
                                checked={checked}
                                disabled={mcpToolSelectionMode === 'all'}
                                onChange={() =>
                                  setMcpSelectedToolNames((current) =>
                                    current.includes(toolName)
                                      ? current.filter((item) => item !== toolName)
                                      : normalizeManagedToolNames([...current, toolName]),
                                  )
                                }
                              />
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__primary">
                                <strong>{meta.title}</strong>
                                <p>{meta.description}</p>
                                <code>{toolName}</code>
                              </div>
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__secondary">
                                <strong>{meta.category}</strong>
                                <span>{meta.scope}</span>
                              </div>
                            </td>
                            <td className="feishu-tool-selector-table__cell">
                              <div className="feishu-tool-selector-table__meta">
                                <span className="meta-pill">{meta.action}</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
              {availableManagedToolNames.length > TOOL_TABLE_PAGE_SIZE ? (
                <div className="feishu-tool-selector-pagination">
                  <span className="feishu-tool-selector-pagination__info">
                    {i18n._({
                      id: '{start}–{end} of {total}',
                      message: '{start}–{end} of {total}',
                      values: {
                        start: (toolTablePage - 1) * TOOL_TABLE_PAGE_SIZE + 1,
                        end: Math.min(toolTablePage * TOOL_TABLE_PAGE_SIZE, availableManagedToolNames.length),
                        total: availableManagedToolNames.length,
                      },
                    })}
                  </span>
                  <div className="feishu-tool-selector-pagination__actions">
                    <Button
                      intent="ghost"
                      disabled={toolTablePage <= 1}
                      onClick={() => setToolTablePage((p) => p - 1)}
                    >
                      {i18n._({ id: 'Previous', message: 'Previous' })}
                    </Button>
                    <Button
                      intent="ghost"
                      disabled={toolTablePage * TOOL_TABLE_PAGE_SIZE >= availableManagedToolNames.length}
                      onClick={() => setToolTablePage((p) => p + 1)}
                    >
                      {i18n._({ id: 'Next', message: 'Next' })}
                    </Button>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

        </Modal>
      ) : null}
    </section>
  )
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleString()
}

function isRunRetryAllowed(run: BackgroundJobRun) {
  const normalizedStatus = run.status.trim().toLowerCase()
  if (normalizedStatus === 'queued' || normalizedStatus === 'running') {
    return false
  }
  return isBackgroundJobRunRetryable(run)
}

function isRunCancelable(run: BackgroundJobRun) {
  const normalizedStatus = run.status.trim().toLowerCase()
  return normalizedStatus === 'queued' || normalizedStatus === 'running'
}

function hasJobFailure(value: {
  error?: string | null
  errorCode?: string | null
  errorMeta?: { code?: string | null } | null
  lastError?: string | null
  lastErrorCode?: string | null
  lastErrorMeta?: { code?: string | null } | null
}) {
  return Boolean(
    value.error?.trim() ||
      value.errorCode?.trim() ||
      value.errorMeta?.code?.trim() ||
      value.lastError?.trim() ||
      value.lastErrorCode?.trim() ||
      value.lastErrorMeta?.code?.trim(),
  )
}

function selectDefaultBackgroundJobExecutor(executors: BackgroundJobExecutor[]) {
  return executors
    .slice()
    .sort((left, right) => {
      const priorityDiff = executorCreatePriority(right) - executorCreatePriority(left)
      if (priorityDiff !== 0) {
        return priorityDiff
      }
      return left.kind.localeCompare(right.kind)
    })[0]
}

function normalizeManagedToolNames(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right))
}

function executorCreatePriority(executor: Pick<BackgroundJobExecutor, 'capabilities' | 'kind'>) {
  const priority = executor.capabilities?.defaultCreatePriority
  return typeof priority === 'number' && Number.isFinite(priority) ? priority : 0
}

function JobRunOutputBlock({ run }: { run: BackgroundJobRun }) {
  const output = readJobRunOutputObject(run.output)
  if (!output) {
    return null
  }

  if (run.executorKind === 'prompt_run') {
    const assistantText = readJobRunOutputString(output, 'assistantText')
    const reasoningText = readJobRunOutputString(output, 'reasoningText')
    const commandOutput = readJobRunOutputString(output, 'commandOutput')
    const promptPreview = readJobRunOutputString(output, 'promptPreview')
    const model = readJobRunOutputString(output, 'model')
    const reasoning = readJobRunOutputString(output, 'reasoning')
    const threadName = readJobRunOutputString(output, 'threadName')
    const threadId = readJobRunOutputString(output, 'threadId')
    const turnId = readJobRunOutputString(output, 'turnId')
    const durationLabel = formatJobRunDuration(readJobRunOutputNumber(output, 'durationMs'))

    return (
      <div className="jobs-page__detail-block">
        <div className="jobs-page__detail-block-header">
          <h4>{i18n._({ id: 'Run Output', message: 'Run Output' })}</h4>
        </div>

        <dl className="definition-grid jobs-page__output-definition-grid">
          {model ? (
            <div>
              <dt>{i18n._({ id: 'Model', message: 'Model' })}</dt>
              <dd>{model}</dd>
            </div>
          ) : null}
          {reasoning ? (
            <div>
              <dt>{i18n._({ id: 'Reasoning', message: 'Reasoning' })}</dt>
              <dd>{reasoning}</dd>
            </div>
          ) : null}
          {threadName ? (
            <div>
              <dt>{i18n._({ id: 'Thread Name', message: 'Thread Name' })}</dt>
              <dd>{threadName}</dd>
            </div>
          ) : null}
          {threadId ? (
            <div>
              <dt>{i18n._({ id: 'Thread ID', message: 'Thread ID' })}</dt>
              <dd>
                <Link
                  className="jobs-page__output-link"
                  rel="noreferrer"
                  target="_blank"
                  to={`/workspaces/${run.workspaceId}/threads/${threadId}`}
                >
                  {threadId}
                </Link>
              </dd>
            </div>
          ) : null}
          {turnId ? (
            <div>
              <dt>{i18n._({ id: 'Turn ID', message: 'Turn ID' })}</dt>
              <dd>
                <code className="jobs-page__output-token">{turnId}</code>
              </dd>
            </div>
          ) : null}
          {durationLabel ? (
            <div>
              <dt>{i18n._({ id: 'Duration', message: 'Duration' })}</dt>
              <dd>{durationLabel}</dd>
            </div>
          ) : null}
        </dl>

        <JobRunTextSection title={i18n._({ id: 'Prompt', message: 'Prompt' })} content={promptPreview} />
        <JobRunTextSection
          title={i18n._({ id: 'Assistant Response', message: 'Assistant Response' })}
          content={assistantText}
        />
        <JobRunTextSection title={i18n._({ id: 'Reasoning', message: 'Reasoning' })} content={reasoningText} />
        <JobRunTextSection title={i18n._({ id: 'Command Output', message: 'Command Output' })} content={commandOutput} />
        <JobRunRawOutputDisclosure output={output} />
      </div>
    )
  }

  if (run.executorKind === 'shell_script') {
    const shell = readJobRunOutputString(output, 'shell')
    const workdir = readJobRunOutputString(output, 'workdir')
    const stdout = readJobRunOutputString(output, 'stdout')
    const stderr = readJobRunOutputString(output, 'stderr')
    const stdoutTruncated = readJobRunOutputBoolean(output, 'stdoutTruncated')
    const stderrTruncated = readJobRunOutputBoolean(output, 'stderrTruncated')
    const exitCode = readJobRunOutputNumber(output, 'exitCode')
    const durationLabel = formatJobRunDuration(readJobRunOutputNumber(output, 'durationMs'))

    return (
      <div className="jobs-page__detail-block">
        <div className="jobs-page__detail-block-header">
          <h4>{i18n._({ id: 'Run Output', message: 'Run Output' })}</h4>
        </div>

        <dl className="definition-grid jobs-page__output-definition-grid">
          {shell ? (
            <div>
              <dt>{i18n._({ id: 'Shell', message: 'Shell' })}</dt>
              <dd>{shell}</dd>
            </div>
          ) : null}
          {workdir ? (
            <div>
              <dt>{i18n._({ id: 'Working Directory', message: 'Working Directory' })}</dt>
              <dd>{workdir}</dd>
            </div>
          ) : null}
          {typeof exitCode === 'number' ? (
            <div>
              <dt>{i18n._({ id: 'Exit Code', message: 'Exit Code' })}</dt>
              <dd>{exitCode}</dd>
            </div>
          ) : null}
          {durationLabel ? (
            <div>
              <dt>{i18n._({ id: 'Duration', message: 'Duration' })}</dt>
              <dd>{durationLabel}</dd>
            </div>
          ) : null}
        </dl>

        <JobRunTextSection
          badgeLabel={stdoutTruncated ? i18n._({ id: 'Truncated', message: 'Truncated' }) : ''}
          content={stdout}
          title={i18n._({ id: 'Stdout', message: 'Stdout' })}
        />
        <JobRunTextSection
          badgeLabel={stderrTruncated ? i18n._({ id: 'Truncated', message: 'Truncated' }) : ''}
          content={stderr}
          title={i18n._({ id: 'Stderr', message: 'Stderr' })}
          tone="danger"
        />
        <JobRunRawOutputDisclosure output={output} />
      </div>
    )
  }

  return (
    <div className="jobs-page__detail-block">
      <div className="jobs-page__detail-block-header">
        <h4>{i18n._({ id: 'Run Output', message: 'Run Output' })}</h4>
      </div>
      <pre className="code-block jobs-page__detail-code">{JSON.stringify(output, null, 2)}</pre>
    </div>
  )
}

function JobRunTextSection({
  title,
  content,
  badgeLabel = '',
  tone = 'default',
}: {
  title: string
  content: string
  badgeLabel?: string
  tone?: 'default' | 'danger'
}) {
  if (!content) {
    return null
  }

  return (
    <div className={`jobs-page__output-section${tone === 'danger' ? ' jobs-page__output-section--danger' : ''}`}>
      <div className="jobs-page__output-section-header">
        <h5>{title}</h5>
        {badgeLabel ? (
          <span className={`meta-pill${tone === 'danger' ? ' meta-pill--danger' : ' meta-pill--warning'}`}>
            {badgeLabel}
          </span>
        ) : null}
      </div>
      <pre className="code-block jobs-page__detail-code jobs-page__output-code">{content}</pre>
    </div>
  )
}

function JobRunRawOutputDisclosure({ output }: { output: Record<string, unknown> }) {
  return (
    <details className="jobs-page__raw-output">
      <summary>{i18n._({ id: 'Raw Output JSON', message: 'Raw Output JSON' })}</summary>
      <pre className="code-block jobs-page__detail-code jobs-page__output-code">{JSON.stringify(output, null, 2)}</pre>
    </details>
  )
}

function readJobRunOutputObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function readJobRunOutputString(output: Record<string, unknown>, key: string) {
  const value = output[key]
  return typeof value === 'string' ? value.trim() : ''
}

function readJobRunOutputNumber(output: Record<string, unknown>, key: string) {
  const value = output[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readJobRunOutputBoolean(output: Record<string, unknown>, key: string) {
  return output[key] === true
}

function formatJobRunDuration(durationMs: number | null) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return ''
  }
  if (durationMs < 1000) {
    return i18n._({
      id: '{value} ms',
      message: '{value} ms',
      values: { value: Math.round(durationMs) },
    })
  }
  return i18n._({
    id: '{value}s',
    message: '{value}s',
    values: { value: (durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1) },
  })
}

function describeManagedTool(toolName: string) {
  switch (toolName) {
    case 'jobs_list':
      return {
        title: i18n._({ id: 'List Jobs', message: 'List Jobs' }),
        description: i18n._({
          id: 'Read the current job inventory in this workspace.',
          message: 'Read the current job inventory in this workspace.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Workspace Inventory', message: 'Workspace Inventory' }),
        action: i18n._({ id: 'Read', message: 'Read' }),
      }
    case 'jobs_get':
      return {
        title: i18n._({ id: 'Get Job Detail', message: 'Get Job Detail' }),
        description: i18n._({
          id: 'Read one job and its current execution state.',
          message: 'Read one job and its current execution state.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Single Job', message: 'Single Job' }),
        action: i18n._({ id: 'Read', message: 'Read' }),
      }
    case 'jobs_create':
      return {
        title: i18n._({ id: 'Create Job', message: 'Create Job' }),
        description: i18n._({
          id: 'Create a new background job through MCP.',
          message: 'Create a new background job through MCP.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Job Definition', message: 'Job Definition' }),
        action: i18n._({ id: 'Create', message: 'Create' }),
      }
    case 'jobs_update':
      return {
        title: i18n._({ id: 'Update Job', message: 'Update Job' }),
        description: i18n._({
          id: 'Modify an existing job definition.',
          message: 'Modify an existing job definition.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Job Definition', message: 'Job Definition' }),
        action: i18n._({ id: 'Update', message: 'Update' }),
      }
    case 'jobs_pause':
      return {
        title: i18n._({ id: 'Pause Job', message: 'Pause Job' }),
        description: i18n._({
          id: 'Pause scheduled execution for a job.',
          message: 'Pause scheduled execution for a job.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Job State', message: 'Job State' }),
        action: i18n._({ id: 'Pause', message: 'Pause' }),
      }
    case 'jobs_resume':
      return {
        title: i18n._({ id: 'Resume Job', message: 'Resume Job' }),
        description: i18n._({
          id: 'Resume scheduled execution for a paused job.',
          message: 'Resume scheduled execution for a paused job.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Job State', message: 'Job State' }),
        action: i18n._({ id: 'Resume', message: 'Resume' }),
      }
    case 'jobs_run':
      return {
        title: i18n._({ id: 'Run Job Now', message: 'Run Job Now' }),
        description: i18n._({
          id: 'Trigger an immediate job run through MCP.',
          message: 'Trigger an immediate job run through MCP.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Execution', message: 'Execution' }),
        action: i18n._({ id: 'Run', message: 'Run' }),
      }
    case 'jobs_delete':
      return {
        title: i18n._({ id: 'Delete Job', message: 'Delete Job' }),
        description: i18n._({
          id: 'Delete a job and its stored run history.',
          message: 'Delete a job and its stored run history.',
        }),
        category: i18n._({ id: 'Jobs', message: 'Jobs' }),
        scope: i18n._({ id: 'Job Definition', message: 'Job Definition' }),
        action: i18n._({ id: 'Delete', message: 'Delete' }),
      }
    case 'job_runs_list':
      return {
        title: i18n._({ id: 'List Job Runs', message: 'List Job Runs' }),
        description: i18n._({
          id: 'Read stored run history for one job.',
          message: 'Read stored run history for one job.',
        }),
        category: i18n._({ id: 'Runs', message: 'Runs' }),
        scope: i18n._({ id: 'Run History', message: 'Run History' }),
        action: i18n._({ id: 'Read', message: 'Read' }),
      }
    case 'job_run_retry':
      return {
        title: i18n._({ id: 'Retry Job Run', message: 'Retry Job Run' }),
        description: i18n._({
          id: 'Retry a previous job run.',
          message: 'Retry a previous job run.',
        }),
        category: i18n._({ id: 'Runs', message: 'Runs' }),
        scope: i18n._({ id: 'Run Recovery', message: 'Run Recovery' }),
        action: i18n._({ id: 'Retry', message: 'Retry' }),
      }
    case 'job_run_cancel':
      return {
        title: i18n._({ id: 'Cancel Job Run', message: 'Cancel Job Run' }),
        description: i18n._({
          id: 'Cancel a queued or running job run.',
          message: 'Cancel a queued or running job run.',
        }),
        category: i18n._({ id: 'Runs', message: 'Runs' }),
        scope: i18n._({ id: 'Run Recovery', message: 'Run Recovery' }),
        action: i18n._({ id: 'Cancel', message: 'Cancel' }),
      }
    case 'job_executors_list':
      return {
        title: i18n._({ id: 'List Executors', message: 'List Executors' }),
        description: i18n._({
          id: 'Read the executor catalog that can be used by jobs.',
          message: 'Read the executor catalog that can be used by jobs.',
        }),
        category: i18n._({ id: 'Catalog', message: 'Catalog' }),
        scope: i18n._({ id: 'Executor Catalog', message: 'Executor Catalog' }),
        action: i18n._({ id: 'Read', message: 'Read' }),
      }
    default:
      return {
        title: toolName,
        description: toolName,
        category: i18n._({ id: 'Other', message: 'Other' }),
        scope: i18n._({ id: 'Workspace', message: 'Workspace' }),
        action: i18n._({ id: 'Use', message: 'Use' }),
      }
  }
}
