import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { Switch } from '../components/ui/Switch'
import { TextArea } from '../components/ui/TextArea'
import {
  createBotConnection,
  deleteBotConnection,
  listBotConnections,
  listBotConversations,
  pauseBotConnection,
  resumeBotConnection,
  updateBotConnectionRuntimeMode,
  type CreateBotConnectionInput,
} from '../features/bots/api'
import { listWorkspaces } from '../features/workspaces/api'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
import {
  buildBotConnectionCreateInput,
  EMPTY_BOTS_PAGE_DRAFT,
  formatBotBackendLabel,
  formatBotConversationTitle,
  formatBotProviderLabel,
  formatBotTimestamp,
  summarizeBotMap,
  type BotsPageDraft,
} from './botsPageUtils'
import type { BotConnection } from '../types/api'

export function BotsPage() {
  const queryClient = useQueryClient()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BotConnection | null>(null)
  const [draft, setDraft] = useState<BotsPageDraft>(EMPTY_BOTS_PAGE_DRAFT)
  const [formError, setFormError] = useState('')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  useEffect(() => {
    if (selectedWorkspaceId || !workspacesQuery.data?.length) {
      return
    }

    setSelectedWorkspaceId(workspacesQuery.data[0].id)
  }, [selectedWorkspaceId, workspacesQuery.data])

  const connectionsQuery = useQuery({
    queryKey: ['bot-connections', selectedWorkspaceId],
    queryFn: () => listBotConnections(selectedWorkspaceId),
    enabled: selectedWorkspaceId.length > 0,
  })

  useEffect(() => {
    const connections = connectionsQuery.data ?? []
    if (!connections.length) {
      if (selectedConnectionId) {
        setSelectedConnectionId('')
      }
      return
    }

    if (!selectedConnectionId || !connections.some((connection) => connection.id === selectedConnectionId)) {
      setSelectedConnectionId(connections[0].id)
    }
  }, [connectionsQuery.data, selectedConnectionId])

  const conversationsQuery = useQuery({
    queryKey: ['bot-conversations', selectedWorkspaceId, selectedConnectionId],
    queryFn: () => listBotConversations(selectedWorkspaceId, selectedConnectionId),
    enabled: selectedWorkspaceId.length > 0 && selectedConnectionId.length > 0,
  })

  const createMutation = useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: CreateBotConnectionInput }) =>
      createBotConnection(workspaceId, input),
    onSuccess: async (connection) => {
      setCreateModalOpen(false)
      setDraft(EMPTY_BOTS_PAGE_DRAFT)
      setFormError('')
      setSelectedWorkspaceId(connection.workspaceId)
      setSelectedConnectionId(connection.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections', connection.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations', connection.workspaceId] }),
      ])
    },
  })

  const actionMutation = useMutation({
    mutationFn: async ({ workspaceId, connection }: { workspaceId: string; connection: BotConnection }) => {
      if (connection.status === 'active') {
        return pauseBotConnection(workspaceId, connection.id)
      }
      return resumeBotConnection(workspaceId, connection.id, {})
    },
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections', connection.workspaceId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ workspaceId, connectionId }: { workspaceId: string; connectionId: string }) =>
      deleteBotConnection(workspaceId, connectionId),
    onSuccess: async (_, variables) => {
      setDeleteTarget(null)
      if (selectedConnectionId === variables.connectionId) {
        setSelectedConnectionId('')
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections', variables.workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations', variables.workspaceId] }),
      ])
    },
  })

  const runtimeModeMutation = useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      runtimeMode,
    }: {
      workspaceId: string
      connectionId: string
      runtimeMode: string
    }) => updateBotConnectionRuntimeMode(workspaceId, connectionId, { runtimeMode }),
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections', connection.workspaceId] })
    },
  })

  const workspaces = workspacesQuery.data ?? []
  const connections = connectionsQuery.data ?? []
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null
  const selectedConnection = connections.find((connection) => connection.id === selectedConnectionId) ?? null
  const conversations = conversationsQuery.data ?? []

  const providerOptions = useMemo(
    () => [
      {
        value: 'telegram',
        label: i18n._({ id: 'Telegram', message: 'Telegram' }),
      },
      {
        value: 'discord',
        label: i18n._({ id: 'Discord (Next)', message: 'Discord (Next)' }),
        disabled: true,
      },
    ],
    [],
  )

  const aiBackendOptions = useMemo(
    () => [
      {
        value: 'workspace_thread',
        label: i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' }),
      },
      {
        value: 'openai_responses',
        label: i18n._({ id: 'OpenAI Responses', message: 'OpenAI Responses' }),
      },
    ],
    [],
  )

  const telegramDeliveryModeOptions = useMemo(
    () => [
      {
        value: 'webhook',
        label: i18n._({ id: 'Webhook', message: 'Webhook' }),
      },
      {
        value: 'polling',
        label: i18n._({ id: 'Long Polling', message: 'Long Polling' }),
      },
    ],
    [],
  )

  const reasoningOptions = useMemo(
    () => [
      { value: 'low', label: i18n._({ id: 'Low', message: 'Low' }) },
      { value: 'medium', label: i18n._({ id: 'Medium', message: 'Medium' }) },
      { value: 'high', label: i18n._({ id: 'High', message: 'High' }) },
      { value: 'xhigh', label: i18n._({ id: 'Extra High', message: 'Extra High' }) },
    ],
    [],
  )

  const collaborationOptions = useMemo(
    () => [
      { value: 'default', label: i18n._({ id: 'Default', message: 'Default' }) },
      { value: 'plan', label: i18n._({ id: 'Plan', message: 'Plan' }) },
    ],
    [],
  )

  const activeConnectionsCount = connections.filter((connection) => connection.status === 'active').length
  const formErrorMessage = formError || (createMutation.error ? getErrorMessage(createMutation.error) : '')
  const actionErrorMessage = actionMutation.error ? getErrorMessage(actionMutation.error) : ''
  const deleteErrorMessage = deleteMutation.error ? getErrorMessage(deleteMutation.error) : ''
  const runtimeModeErrorMessage = runtimeModeMutation.error ? getErrorMessage(runtimeModeMutation.error) : ''
  const draftTelegramDeliveryMode = draft.telegramDeliveryMode.trim().toLowerCase() === 'polling' ? 'polling' : 'webhook'
  const selectedTelegramDeliveryMode =
    selectedConnection?.settings?.telegram_delivery_mode?.trim().toLowerCase() === 'polling' ? 'polling' : 'webhook'
  const selectedRuntimeMode =
    selectedConnection?.settings?.runtime_mode?.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'

  function openCreateModal() {
    createMutation.reset()
    setFormError('')
    setDraft((current) => ({
      ...EMPTY_BOTS_PAGE_DRAFT,
      workspaceId: selectedWorkspaceId || workspaces[0]?.id || '',
      runtimeMode: current.runtimeMode,
      telegramDeliveryMode: current.telegramDeliveryMode,
      publicBaseUrl: current.publicBaseUrl,
    }))
    setCreateModalOpen(true)
  }

  function closeCreateModal() {
    setCreateModalOpen(false)
    setDraft(EMPTY_BOTS_PAGE_DRAFT)
    setFormError('')
    createMutation.reset()
  }

  function handleSubmitCreate() {
    const workspaceId = draft.workspaceId.trim()
    if (!workspaceId) {
      setFormError(
        i18n._({
          id: 'Select a workspace before creating a bot connection.',
          message: 'Select a workspace before creating a bot connection.',
        }),
      )
      return
    }

    if (!draft.telegramBotToken.trim()) {
      setFormError(
        i18n._({
          id: 'Telegram bot token is required.',
          message: 'Telegram bot token is required.',
        }),
      )
      return
    }

    if (draft.aiBackend === 'openai_responses' && !draft.openAIApiKey.trim()) {
      setFormError(
        i18n._({
          id: 'OpenAI API key is required for the OpenAI Responses backend.',
          message: 'OpenAI API key is required for the OpenAI Responses backend.',
        }),
      )
      return
    }

    if (draft.aiBackend === 'openai_responses' && !draft.openAIModel.trim()) {
      setFormError(
        i18n._({
          id: 'OpenAI model is required for the OpenAI Responses backend.',
          message: 'OpenAI model is required for the OpenAI Responses backend.',
        }),
      )
      return
    }

    setFormError('')
    createMutation.mutate({
      workspaceId,
      input: buildBotConnectionCreateInput(draft),
    })
  }

  function handleDeleteConfirm() {
    if (!deleteTarget || deleteMutation.isPending) {
      return
    }

    deleteMutation.mutate({
      workspaceId: deleteTarget.workspaceId,
      connectionId: deleteTarget.id,
    })
  }

  const createModalFooter = (
    <>
      <Button intent="secondary" onClick={closeCreateModal}>
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button isLoading={createMutation.isPending} onClick={handleSubmitCreate}>
        {i18n._({ id: 'Create Connection', message: 'Create Connection' })}
      </Button>
    </>
  )

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">{i18n._({ id: 'Bots', message: 'Bots' })}</div>
          <div className="mode-strip__title-row">
            <strong>{i18n._({ id: 'Bot Integrations', message: 'Bot Integrations' })}</strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: 'Connect Telegram bots with either webhook or long-polling delivery, then route replies through Workspace Thread or OpenAI Responses.',
              message:
                'Connect Telegram bots with either webhook or long-polling delivery, then route replies through Workspace Thread or OpenAI Responses.',
            })}
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>{i18n._({ id: 'Active', message: 'Active' })}</span>
              <strong>{activeConnectionsCount}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: 'Connections', message: 'Connections' })}</span>
              <strong>{connections.length}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: 'Conversations', message: 'Conversations' })}</span>
              <strong>{conversations.length}</strong>
            </div>
          </div>
          <Button disabled={!workspaces.length} onClick={openCreateModal}>
            {i18n._({ id: 'New Connection', message: 'New Connection' })}
          </Button>
        </div>
      </header>

      <div className="mode-layout">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Workspace Scope', message: 'Workspace Scope' })}</h2>
                <p>
                  {i18n._({
                    id: 'Connections are stored per workspace and each external chat can be bound to one internal thread.',
                    message:
                      'Connections are stored per workspace and each external chat can be bound to one internal thread.',
                  })}
                </p>
              </div>
            </div>
            <label className="field">
              <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
                fullWidth
                onChange={(nextValue) => {
                  setSelectedWorkspaceId(nextValue)
                  setSelectedConnectionId('')
                }}
                options={workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                }))}
                value={selectedWorkspaceId}
              />
            </label>
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Current Scope', message: 'Current Scope' })}</span>
                <strong>{selectedWorkspace?.name ?? i18n._({ id: 'No workspace', message: 'No workspace' })}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Active Connections', message: 'Active Connections' })}</span>
                <strong>{activeConnectionsCount}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Selected Connection', message: 'Selected Connection' })}</span>
                <strong>{selectedConnection?.name ?? i18n._({ id: 'None', message: 'None' })}</strong>
              </div>
            </div>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div>
                <h2>{i18n._({ id: 'Provider Posture', message: 'Provider Posture' })}</h2>
                <p>
                  {i18n._({
                    id: 'Telegram supports both webhook and long-polling intake. Discord ordinary message intake can be added later through a gateway worker without changing the core orchestration flow.',
                    message:
                      'Telegram supports both webhook and long-polling intake. Discord ordinary message intake can be added later through a gateway worker without changing the core orchestration flow.',
                  })}
                </p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
                <strong>{selectedConnection ? formatBotProviderLabel(selectedConnection.provider) : 'Telegram'}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Backend', message: 'Backend' })}</span>
                <strong>{selectedConnection ? formatBotBackendLabel(selectedConnection.aiBackend) : 'Workspace Thread'}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Delivery Mode', message: 'Delivery Mode' })}</span>
                <strong>
                  {selectedTelegramDeliveryMode === 'polling'
                    ? i18n._({ id: 'Long Polling', message: 'Long Polling' })
                    : i18n._({ id: 'Webhook', message: 'Webhook' })}
                </strong>
              </div>
              <div className="detail-row">
                <span>
                  {selectedTelegramDeliveryMode === 'polling'
                    ? i18n._({ id: 'Update Intake', message: 'Update Intake' })
                    : i18n._({ id: 'Webhook Route', message: 'Webhook Route' })}
                </span>
                <strong>
                  {selectedTelegramDeliveryMode === 'polling'
                    ? i18n._({ id: 'Telegram getUpdates long polling', message: 'Telegram getUpdates long polling' })
                    : `/hooks/bots/${selectedConnection?.id ?? '{connectionId}'}`}
                </strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Public URL', message: 'Public URL' })}</span>
                <strong>
                  {selectedTelegramDeliveryMode === 'polling'
                    ? i18n._({ id: 'not required in polling mode', message: 'not required in polling mode' })
                    : selectedConnection?.settings?.webhook_url ??
                      i18n._({ id: 'resolved at activation', message: 'resolved at activation' })}
                </strong>
              </div>
            </div>
          </section>
        </aside>

        <div className="mode-stage stack-screen">
          {workspacesQuery.error ? (
            <InlineNotice
              dismissible
              noticeKey={`bot-workspaces-${getErrorMessage(workspacesQuery.error)}`}
              onRetry={() => void workspacesQuery.refetch()}
              title={i18n._({ id: 'Failed To Load Workspaces', message: 'Failed To Load Workspaces' })}
              tone="error"
            >
              {getErrorMessage(workspacesQuery.error)}
            </InlineNotice>
          ) : null}

          {!workspacesQuery.isLoading && !workspaces.length ? (
            <div className="empty-state">
              {i18n._({
                id: 'Create a workspace first before configuring a bot connection.',
                message: 'Create a workspace first before configuring a bot connection.',
              })}
            </div>
          ) : null}

          {workspaces.length ? (
            <>
              {connectionsQuery.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bot-connections-${getErrorMessage(connectionsQuery.error)}`}
                  onRetry={() => void connectionsQuery.refetch()}
                  title={i18n._({
                    id: 'Failed To Load Bot Connections',
                    message: 'Failed To Load Bot Connections',
                  })}
                  tone="error"
                >
                  {getErrorMessage(connectionsQuery.error)}
                </InlineNotice>
              ) : null}

              {actionErrorMessage ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bot-action-${actionErrorMessage}`}
                  title={i18n._({ id: 'Connection Action Failed', message: 'Connection Action Failed' })}
                  tone="error"
                >
                  {actionErrorMessage}
                </InlineNotice>
              ) : null}

              {runtimeModeErrorMessage ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bot-runtime-mode-${runtimeModeErrorMessage}`}
                  title={i18n._({ id: 'Runtime Mode Update Failed', message: 'Runtime Mode Update Failed' })}
                  tone="error"
                >
                  {runtimeModeErrorMessage}
                </InlineNotice>
              ) : null}

              <section className="content-section">
                <div className="section-header section-header--inline">
                  <div>
                    <h2>{i18n._({ id: 'Connections', message: 'Connections' })}</h2>
                  </div>
                  <div className="section-header__meta">{connections.length}</div>
                </div>

                {connectionsQuery.isLoading ? (
                  <div className="notice">
                    {i18n._({ id: 'Loading bot connections...', message: 'Loading bot connections...' })}
                  </div>
                ) : null}

                {!connectionsQuery.isLoading && !connections.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No bot connections yet. Start with a Telegram token, then choose webhook or long polling based on your deployment.',
                      message:
                        'No bot connections yet. Start with a Telegram token, then choose webhook or long polling based on your deployment.',
                    })}
                  </div>
                ) : null}

                <div className="automation-compact-list">
                  {connections.map((connection) => (
                    <button
                      className={[
                        'automation-compact-row',
                        selectedConnectionId === connection.id ? 'automation-compact-row--active' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={connection.id}
                      onClick={() => setSelectedConnectionId(connection.id)}
                      type="button"
                    >
                      <div className="automation-compact-row__main">
                        <strong>{connection.name}</strong>
                        <span>
                          {formatBotProviderLabel(connection.provider)} | {formatBotBackendLabel(connection.aiBackend)} |{' '}
                          {formatBotTimestamp(connection.updatedAt)}
                        </span>
                      </div>
                      <div className="automation-compact-row__actions">
                        <StatusPill status={connection.status} />
                      </div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="content-section">
                <div className="section-header section-header--inline">
                  <div>
                    <h2>{i18n._({ id: 'Connection Detail', message: 'Connection Detail' })}</h2>
                  </div>
                </div>

                {!selectedConnection ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'Select a connection to inspect provider status, AI backend settings, and conversation bindings.',
                      message:
                        'Select a connection to inspect provider status, AI backend settings, and conversation bindings.',
                    })}
                  </div>
                ) : (
                  <div className="stack-screen">
                    <section className="mode-panel">
                      <div
                        style={{
                          alignItems: 'start',
                          display: 'flex',
                          gap: '16px',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '6px' }}>
                          <strong>{selectedConnection.name}</strong>
                          <span>
                            {selectedWorkspace?.name ?? selectedConnection.workspaceId} |{' '}
                            {formatBotProviderLabel(selectedConnection.provider)} |{' '}
                            {formatBotBackendLabel(selectedConnection.aiBackend)}
                          </span>
                        </div>
                        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          <StatusPill status={selectedConnection.status} />
                          <Button
                            intent="ghost"
                            isLoading={
                              actionMutation.isPending && actionMutation.variables?.connection.id === selectedConnection.id
                            }
                            onClick={() =>
                              actionMutation.mutate({
                                workspaceId: selectedConnection.workspaceId,
                                connection: selectedConnection,
                              })
                            }
                          >
                            {selectedConnection.status === 'active'
                              ? i18n._({ id: 'Pause', message: 'Pause' })
                              : i18n._({ id: 'Resume', message: 'Resume' })}
                          </Button>
                          <Button
                            className="ide-button--ghost-danger"
                            intent="ghost"
                            onClick={() => setDeleteTarget(selectedConnection)}
                          >
                            {i18n._({ id: 'Delete', message: 'Delete' })}
                          </Button>
                        </div>
                      </div>
                    </section>

                    {selectedConnection.lastError ? (
                      <InlineNotice
                        dismissible
                        noticeKey={`bot-last-error-${selectedConnection.id}-${selectedConnection.lastError}`}
                        title={i18n._({ id: 'Last Bot Error', message: 'Last Bot Error' })}
                        tone="error"
                      >
                        {selectedConnection.lastError}
                      </InlineNotice>
                    ) : null}

                    <section className="mode-panel">
                      <div className="section-header">
                        <div>
                          <h2>{i18n._({ id: 'Configuration Summary', message: 'Configuration Summary' })}</h2>
                        </div>
                      </div>
                      <div className="detail-list">
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Connection ID', message: 'Connection ID' })}</span>
                          <strong>{selectedConnection.id}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Status', message: 'Status' })}</span>
                          <strong>{selectedConnection.status}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'AI Backend', message: 'AI Backend' })}</span>
                          <strong>{formatBotBackendLabel(selectedConnection.aiBackend)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Runtime Mode', message: 'Runtime Mode' })}</span>
                          <strong>
                            {selectedRuntimeMode === 'debug'
                              ? i18n._({ id: 'Debug', message: 'Debug' })
                              : i18n._({ id: 'Normal', message: 'Normal' })}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Telegram Mode', message: 'Telegram Mode' })}</span>
                          <strong>
                            {selectedTelegramDeliveryMode === 'polling'
                              ? i18n._({ id: 'Long Polling', message: 'Long Polling' })
                              : i18n._({ id: 'Webhook', message: 'Webhook' })}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Updated', message: 'Updated' })}</span>
                          <strong>{formatBotTimestamp(selectedConnection.updatedAt)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Secret Keys', message: 'Secret Keys' })}</span>
                          <strong>
                            {selectedConnection.secretKeys?.join(', ') || i18n._({ id: 'none', message: 'none' })}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Provider Settings', message: 'Provider Settings' })}</span>
                          <strong>{summarizeBotMap(selectedConnection.settings)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'AI Config', message: 'AI Config' })}</span>
                          <strong>{summarizeBotMap(selectedConnection.aiConfig)}</strong>
                        </div>
                      </div>
                    </section>

                    <section className="mode-panel">
                      <div className="section-header">
                        <div>
                          <h2>{i18n._({ id: 'Runtime Diagnostics', message: 'Runtime Diagnostics' })}</h2>
                          <p>
                            {i18n._({
                              id: 'Debug mode adds detailed backend logs for inbound processing, AI execution, streaming updates, and Telegram delivery operations.',
                              message:
                                'Debug mode adds detailed backend logs for inbound processing, AI execution, streaming updates, and Telegram delivery operations.',
                            })}
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={selectedRuntimeMode === 'debug'}
                        disabled={runtimeModeMutation.isPending}
                        hint={i18n._({
                          id: 'Use normal mode in routine operation. Enable debug mode temporarily while diagnosing missing output, truncation, or delivery failures.',
                          message:
                            'Use normal mode in routine operation. Enable debug mode temporarily while diagnosing missing output, truncation, or delivery failures.',
                        })}
                        label={i18n._({ id: 'Enable Backend Debug Logging', message: 'Enable Backend Debug Logging' })}
                        onChange={(event) =>
                          runtimeModeMutation.mutate({
                            workspaceId: selectedConnection.workspaceId,
                            connectionId: selectedConnection.id,
                            runtimeMode: event.target.checked ? 'debug' : 'normal',
                          })
                        }
                      />
                    </section>

                    <section className="mode-panel mode-panel--flush">
                      <div className="mode-panel__body">
                        <div className="section-header section-header--inline">
                          <div>
                            <h2>{i18n._({ id: 'Conversation Bindings', message: 'Conversation Bindings' })}</h2>
                          </div>
                          <div className="section-header__meta">{conversations.length}</div>
                        </div>
                        <p className="mode-panel__description">
                          {i18n._({
                            id: 'Each external chat keeps a conversation record with its last inbound and outbound message plus an optional internal thread binding.',
                            message:
                              'Each external chat keeps a conversation record with its last inbound and outbound message plus an optional internal thread binding.',
                          })}
                        </p>
                      </div>

                      {conversationsQuery.error ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-conversations-${getErrorMessage(conversationsQuery.error)}`}
                          onRetry={() => void conversationsQuery.refetch()}
                          title={i18n._({
                            id: 'Failed To Load Bot Conversations',
                            message: 'Failed To Load Bot Conversations',
                          })}
                          tone="error"
                        >
                          {getErrorMessage(conversationsQuery.error)}
                        </InlineNotice>
                      ) : null}

                      {conversationsQuery.isLoading ? (
                        <div className="notice">
                          {i18n._({ id: 'Loading conversations...', message: 'Loading conversations...' })}
                        </div>
                      ) : null}

                      {!conversationsQuery.isLoading && !conversations.length ? (
                        <div className="empty-state">
                          {i18n._({
                            id: 'No conversations have been mapped yet. The first inbound bot message will create one.',
                            message: 'No conversations have been mapped yet. The first inbound bot message will create one.',
                          })}
                        </div>
                      ) : null}

                      <div className="directory-list">
                        {conversations.map((conversation) => (
                          <article className="directory-item" key={conversation.id}>
                            <div className="directory-item__icon">BT</div>
                            <div className="directory-item__body">
                              <strong>{formatBotConversationTitle(conversation)}</strong>
                              <p>
                                {conversation.lastInboundText ||
                                  i18n._({
                                    id: 'No inbound message recorded yet.',
                                    message: 'No inbound message recorded yet.',
                                  })}
                              </p>
                              {conversation.lastOutboundText ? (
                                <p>
                                  {i18n._({ id: 'Last reply', message: 'Last reply' })}:{' '}
                                  {conversation.lastOutboundText}
                                </p>
                              ) : null}
                            </div>
                            <div
                              className="directory-item__meta"
                              style={{ alignItems: 'end', display: 'grid', gap: '8px' }}
                            >
                              <span className="meta-pill">{formatBotTimestamp(conversation.updatedAt)}</span>
                              {conversation.threadId ? (
                                <Link to={buildWorkspaceThreadRoute(conversation.workspaceId, conversation.threadId)}>
                                  {i18n._({ id: 'Open Thread', message: 'Open Thread' })}
                                </Link>
                              ) : (
                                <span className="meta-pill">
                                  {i18n._({ id: 'Thread pending', message: 'Thread pending' })}
                                </span>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>

      {createModalOpen ? (
        <Modal
          description={i18n._({
            id: 'Create a provider connection, choose webhook or long polling delivery, and bind it to an AI execution backend.',
            message:
              'Create a provider connection, choose webhook or long polling delivery, and bind it to an AI execution backend.',
          })}
          footer={createModalFooter}
          onClose={closeCreateModal}
          title={i18n._({ id: 'New Bot Connection', message: 'New Bot Connection' })}
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmitCreate()
            }}
          >
            {formErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`create-bot-connection-${formErrorMessage}`}
                title={i18n._({ id: 'Create Bot Connection Failed', message: 'Create Bot Connection Failed' })}
                tone="error"
              >
                {formErrorMessage}
              </InlineNotice>
            ) : null}

            <p className="config-inline-note">
              {i18n._({
                id: 'Outbound proxy is configured globally in Settings > Config > Runtime.',
                message: 'Outbound proxy is configured globally in Settings > Config > Runtime.',
              })}{' '}
              <Link to="/settings/config">
                {i18n._({ id: 'Open Settings', message: 'Open Settings' })}
              </Link>
            </p>

            <div className="form-row">
              <label className="field">
                <span>{i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}
                  fullWidth
                  onChange={(nextValue) => setDraft((current) => ({ ...current, workspaceId: nextValue }))}
                  options={workspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  }))}
                  value={draft.workspaceId}
                />
              </label>
              <label className="field">
                <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Provider', message: 'Provider' })}
                  fullWidth
                  onChange={(nextValue) => setDraft((current) => ({ ...current, provider: nextValue }))}
                  options={providerOptions}
                  value={draft.provider}
                />
              </label>
            </div>

            <div className="form-row">
              <label className="field">
                <span>{i18n._({ id: 'Telegram Delivery Mode', message: 'Telegram Delivery Mode' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'Telegram Delivery Mode', message: 'Telegram Delivery Mode' })}
                  fullWidth
                  onChange={(nextValue) => setDraft((current) => ({ ...current, telegramDeliveryMode: nextValue }))}
                  options={telegramDeliveryModeOptions}
                  value={draft.telegramDeliveryMode}
                />
              </label>
              <label className="field">
                <span>{i18n._({ id: 'AI Backend', message: 'AI Backend' })}</span>
                <SelectControl
                  ariaLabel={i18n._({ id: 'AI Backend', message: 'AI Backend' })}
                  fullWidth
                  onChange={(nextValue) => setDraft((current) => ({ ...current, aiBackend: nextValue }))}
                  options={aiBackendOptions}
                  value={draft.aiBackend}
                />
              </label>
            </div>

            <div className="form-row">
              <Input
                hint={i18n._({
                  id: 'Optional. Defaults to a provider-specific connection name.',
                  message: 'Optional. Defaults to a provider-specific connection name.',
                })}
                label={i18n._({ id: 'Connection Name', message: 'Connection Name' })}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={i18n._({ id: 'Support Bot', message: 'Support Bot' })}
                value={draft.name}
              />
            </div>

            <Switch
              checked={draft.runtimeMode === 'debug'}
              hint={i18n._({
                id: 'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and Telegram delivery steps.',
                message:
                  'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and Telegram delivery steps.',
              })}
              label={i18n._({ id: 'Enable Backend Debug Mode', message: 'Enable Backend Debug Mode' })}
              onChange={(event) =>
                setDraft((current) => ({ ...current, runtimeMode: event.target.checked ? 'debug' : 'normal' }))
              }
            />

            {draftTelegramDeliveryMode === 'webhook' ? (
              <Input
                hint={i18n._({
                  id: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                  message: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                })}
                label={i18n._({ id: 'Public Base URL', message: 'Public Base URL' })}
                onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                placeholder="https://bots.example.com"
                value={draft.publicBaseUrl}
              />
            ) : null}

            <Input
              label={i18n._({ id: 'Telegram Bot Token', message: 'Telegram Bot Token' })}
              onChange={(event) => setDraft((current) => ({ ...current, telegramBotToken: event.target.value }))}
              placeholder={i18n._({ id: '123456:ABCDEF...', message: '123456:ABCDEF...' })}
              type="password"
              value={draft.telegramBotToken}
            />

            {draft.aiBackend === 'workspace_thread' ? (
              <>
                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'Workspace Model', message: 'Workspace Model' })}
                    onChange={(event) => setDraft((current) => ({ ...current, workspaceModel: event.target.value }))}
                    placeholder="gpt-5.4"
                    value={draft.workspaceModel}
                  />
                  <label className="field">
                    <span>{i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}
                      fullWidth
                      onChange={(nextValue) => setDraft((current) => ({ ...current, workspaceReasoning: nextValue }))}
                      options={reasoningOptions}
                      value={draft.workspaceReasoning}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>{i18n._({ id: 'Collaboration Mode', message: 'Collaboration Mode' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Collaboration Mode', message: 'Collaboration Mode' })}
                    fullWidth
                    onChange={(nextValue) =>
                      setDraft((current) => ({ ...current, workspaceCollaborationMode: nextValue }))
                    }
                    options={collaborationOptions}
                    value={draft.workspaceCollaborationMode}
                  />
                </label>
              </>
            ) : (
              <>
                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'OpenAI API Key', message: 'OpenAI API Key' })}
                    onChange={(event) => setDraft((current) => ({ ...current, openAIApiKey: event.target.value }))}
                    placeholder={i18n._({ id: 'sk-...', message: 'sk-...' })}
                    type="password"
                    value={draft.openAIApiKey}
                  />
                  <Input
                    hint={i18n._({
                      id: 'Optional. Defaults to the standard Responses API endpoint.',
                      message: 'Optional. Defaults to the standard Responses API endpoint.',
                    })}
                    label={i18n._({ id: 'OpenAI Base URL', message: 'OpenAI Base URL' })}
                    onChange={(event) => setDraft((current) => ({ ...current, openAIBaseUrl: event.target.value }))}
                    placeholder="https://api.openai.com/v1/responses"
                    value={draft.openAIBaseUrl}
                  />
                </div>

                <div className="form-row">
                  <Input
                    label={i18n._({ id: 'OpenAI Model', message: 'OpenAI Model' })}
                    onChange={(event) => setDraft((current) => ({ ...current, openAIModel: event.target.value }))}
                    placeholder="gpt-5.4"
                    value={draft.openAIModel}
                  />
                  <label className="field">
                    <span>{i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Reasoning Effort', message: 'Reasoning Effort' })}
                      fullWidth
                      onChange={(nextValue) => setDraft((current) => ({ ...current, openAIReasoning: nextValue }))}
                      options={reasoningOptions}
                      value={draft.openAIReasoning}
                    />
                  </label>
                </div>

                <TextArea
                  hint={i18n._({
                    id: 'Optional system instructions for the Responses backend.',
                    message: 'Optional system instructions for the Responses backend.',
                  })}
                  label={i18n._({ id: 'Instructions', message: 'Instructions' })}
                  onChange={(event) => setDraft((current) => ({ ...current, openAIInstructions: event.target.value }))}
                  rows={5}
                  value={draft.openAIInstructions}
                />

                <Switch
                  checked={draft.openAIStore}
                  hint={i18n._({
                    id: 'Persist conversation state in the OpenAI Responses API when supported.',
                    message: 'Persist conversation state in the OpenAI Responses API when supported.',
                  })}
                  label={i18n._({ id: 'Store OpenAI Response State', message: 'Store OpenAI Response State' })}
                  onChange={(event) => setDraft((current) => ({ ...current, openAIStore: event.target.checked }))}
                />
              </>
            )}
          </form>
        </Modal>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          confirmLabel={i18n._({ id: 'Delete Connection', message: 'Delete Connection' })}
          description={i18n._({
            id: 'This removes the provider connection and all persisted conversation bindings for it.',
            message: 'This removes the provider connection and all persisted conversation bindings for it.',
          })}
          error={deleteErrorMessage}
          isPending={deleteMutation.isPending}
          onClose={() => {
            if (!deleteMutation.isPending) {
              setDeleteTarget(null)
            }
          }}
          onConfirm={handleDeleteConfirm}
          subject={deleteTarget.name}
          title={i18n._({ id: 'Delete Bot Connection', message: 'Delete Bot Connection' })}
        />
      ) : null}
    </section>
  )
}
