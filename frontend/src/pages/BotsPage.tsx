import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { toDataURL as toQRCodeDataURL } from 'qrcode'
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

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
  deleteWeChatAccount,
  deleteWeChatLogin,
  getWeChatLogin,
  deleteBotConnection,
  listBotConnectionLogs,
  listWeChatAccounts,
  listBotConnections,
  listBotConversations,
  pauseBotConnection,
  resumeBotConnection,
  startWeChatLogin,
  updateBotConnection,
  updateBotConnectionCommandOutputMode,
  updateBotConnectionRuntimeMode,
  updateWeChatAccount,
  updateWeChatChannelTiming,
  type CreateBotConnectionInput,
  type UpdateBotConnectionInput,
} from '../features/bots/api'
import { listWorkspaces } from '../features/workspaces/api'
import { summarizeRecentBotConnectionSuppressions } from '../features/bots/logStreamUtils'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
import {
  BOT_COMMAND_OUTPUT_MODE_BRIEF,
  BOT_COMMAND_OUTPUT_MODE_DETAILED,
  BOT_COMMAND_OUTPUT_MODE_FULL,
  BOT_COMMAND_OUTPUT_MODE_NONE,
  BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE,
  buildBotConnectionCreateInput,
  buildBotConnectionUpdateInput,
  buildBotsPageDraftFromConnection,
  countWeChatConnectionsForAccount,
  EMPTY_BOTS_PAGE_DRAFT,
  formatBotBackendLabel,
  formatBotCommandOutputModeLabel,
  formatBotConversationTitle,
  formatBotProviderLabel,
  formatBotTimestamp,
  findWeChatAccountForConnection,
  formatWeChatAccountLabel,
  listWeChatConnectionsForAccount,
  matchesBotConnectionSearch,
  matchesWeChatAccountSearch,
  resolveBotCommandOutputMode,
  resolveWeChatChannelTimingEnabled,
  summarizeBotMap,
  type BotsPageDraft,
} from './botsPageUtils'
import type { BotConnection, WeChatAccount, WeChatLogin } from '../types/api'

export function BotsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BotConnection | null>(null)
  const [connectionModalBaselineDraft, setConnectionModalBaselineDraft] = useState<BotsPageDraft | null>(null)
  const [discardConnectionModalConfirmOpen, setDiscardConnectionModalConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BotConnection | null>(null)
  const [deleteWeChatAccountTarget, setDeleteWeChatAccountTarget] = useState<WeChatAccount | null>(null)
  const [editWeChatAccountTarget, setEditWeChatAccountTarget] = useState<WeChatAccount | null>(null)
  const [wechatAccountAliasDraft, setWeChatAccountAliasDraft] = useState('')
  const [wechatAccountNoteDraft, setWeChatAccountNoteDraft] = useState('')
  const [connectionSearch, setConnectionSearch] = useState('')
  const [wechatAccountSearch, setWeChatAccountSearch] = useState('')
  const [showUnusedWeChatAccountsOnly, setShowUnusedWeChatAccountsOnly] = useState(false)
  const [draft, setDraft] = useState<BotsPageDraft>(EMPTY_BOTS_PAGE_DRAFT)
  const [formError, setFormError] = useState('')
  const [wechatLoginModalOpen, setWechatLoginModalOpen] = useState(false)
  const [wechatLoginId, setWechatLoginId] = useState('')
  const [wechatLoginQRCodeUrl, setWechatLoginQRCodeUrl] = useState('')
  const [wechatLoginCopyState, setWechatLoginCopyState] = useState<'idle' | 'copied' | 'error'>('idle')

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
    refetchInterval: 5000,
  })

  useEffect(() => {
    const connections = connectionsQuery.data ?? []
    if (!connections.length) {
      if (selectedConnectionId) {
        setSelectedConnectionId('')
      }
    }
  }, [connectionsQuery.data, selectedConnectionId])

  const conversationsQuery = useQuery({
    queryKey: ['bot-conversations', selectedWorkspaceId, selectedConnectionId],
    queryFn: () => listBotConversations(selectedWorkspaceId, selectedConnectionId),
    enabled: selectedWorkspaceId.length > 0 && selectedConnectionId.length > 0,
  })

  const wechatLoginQuery = useQuery({
    queryKey: ['wechat-login', draft.workspaceId.trim(), wechatLoginId],
    queryFn: () => getWeChatLogin(draft.workspaceId.trim(), wechatLoginId),
    enabled: wechatLoginModalOpen && draft.workspaceId.trim().length > 0 && wechatLoginId.trim().length > 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status?.trim().toLowerCase() ?? ''
      if (status === 'confirmed' || status === 'expired') {
        return false
      }
      return 2000
    },
  })

  const wechatAccountsWorkspaceId =
    createModalOpen && draft.provider.trim().toLowerCase() === 'wechat' ? draft.workspaceId.trim() : selectedWorkspaceId.trim()
  const wechatAccountsQuery = useQuery({
    queryKey: ['wechat-accounts', wechatAccountsWorkspaceId],
    queryFn: () => listWeChatAccounts(wechatAccountsWorkspaceId),
    enabled: wechatAccountsWorkspaceId.length > 0,
    refetchInterval: 10000,
  })

  const createMutation = useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: CreateBotConnectionInput }) =>
      createBotConnection(workspaceId, input),
    onSuccess: async (connection) => {
      setCreateModalOpen(false)
      setEditTarget(null)
      setConnectionModalBaselineDraft(null)
      setDiscardConnectionModalConfirmOpen(false)
      resetWeChatLoginState()
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

  const updateMutation = useMutation({
    mutationFn: ({ workspaceId, connectionId, input }: { workspaceId: string; connectionId: string; input: UpdateBotConnectionInput }) =>
      updateBotConnection(workspaceId, connectionId, input),
    onSuccess: async (connection) => {
      setCreateModalOpen(false)
      setEditTarget(null)
      setConnectionModalBaselineDraft(null)
      setDiscardConnectionModalConfirmOpen(false)
      resetWeChatLoginState()
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

  const wechatLoginStartMutation = useMutation({
    mutationFn: ({ workspaceId, baseUrl }: { workspaceId: string; baseUrl: string }) =>
      startWeChatLogin(workspaceId, { baseUrl }),
    onSuccess: (result) => {
      setWechatLoginId(result.loginId)
      setWechatLoginCopyState('idle')
    },
  })

  const wechatLoginDeleteMutation = useMutation({
    mutationFn: ({ workspaceId, loginId }: { workspaceId: string; loginId: string }) =>
      deleteWeChatLogin(workspaceId, loginId),
    onSuccess: () => {
      setWechatLoginId('')
      setWechatLoginQRCodeUrl('')
      setWechatLoginCopyState('idle')
      setDraft((current) => ({
        ...current,
        wechatLoginSessionId: '',
        wechatLoginStatus: '',
        wechatQrCodeContent: '',
      }))
      wechatLoginStartMutation.reset()
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

  const deleteWeChatAccountMutation = useMutation({
    mutationFn: ({ workspaceId, accountId }: { workspaceId: string; accountId: string }) =>
      deleteWeChatAccount(workspaceId, accountId),
    onSuccess: async (_, variables) => {
      if (draft.wechatSavedAccountId === variables.accountId) {
        setDraft((current) => ({
          ...current,
          wechatSavedAccountId: '',
        }))
      }
      setDeleteWeChatAccountTarget(null)
      await queryClient.invalidateQueries({ queryKey: ['wechat-accounts', variables.workspaceId] })
    },
  })

  const updateWeChatAccountMutation = useMutation({
    mutationFn: ({ workspaceId, accountId, alias, note }: { workspaceId: string; accountId: string; alias: string; note: string }) =>
      updateWeChatAccount(workspaceId, accountId, { alias, note }),
    onSuccess: async (account) => {
      setEditWeChatAccountTarget(null)
      setWeChatAccountAliasDraft(account.alias ?? '')
      setWeChatAccountNoteDraft(account.note ?? '')
      await queryClient.invalidateQueries({ queryKey: ['wechat-accounts', account.workspaceId] })
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

  const commandOutputModeMutation = useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      commandOutputMode,
    }: {
      workspaceId: string
      connectionId: string
      commandOutputMode: string
    }) => updateBotConnectionCommandOutputMode(workspaceId, connectionId, { commandOutputMode }),
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections', connection.workspaceId] })
    },
  })

  const wechatChannelTimingMutation = useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      enabled,
    }: {
      workspaceId: string
      connectionId: string
      enabled: boolean
    }) => updateWeChatChannelTiming(workspaceId, connectionId, { enabled }),
    onSuccess: async (connection) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections', connection.workspaceId] })
    },
  })

  const workspaces = workspacesQuery.data ?? []
  const connections = connectionsQuery.data ?? []
  const connectionLogQueries = useQueries({
    queries: connections.map((connection) => ({
      queryKey: ['bot-connection-logs-summary', selectedWorkspaceId, connection.id],
      queryFn: () => listBotConnectionLogs(selectedWorkspaceId, connection.id),
      enabled: selectedWorkspaceId.length > 0 && connection.id.length > 0,
      refetchInterval: 15000,
      staleTime: 5000,
    })),
  })
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
        value: 'wechat',
        label: i18n._({ id: 'WeChat', message: 'WeChat' }),
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

  const commandOutputModeOptions = useMemo(
    () => [
      {
        value: BOT_COMMAND_OUTPUT_MODE_NONE,
        label: i18n._({ id: 'No Command Output', message: 'No Command Output' }),
      },
      {
        value: BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE,
        label: i18n._({ id: 'Single Line', message: 'Single Line' }),
      },
      {
        value: BOT_COMMAND_OUTPUT_MODE_BRIEF,
        label: i18n._({ id: 'Brief (3-5 lines)', message: 'Brief (3-5 lines)' }),
      },
      {
        value: BOT_COMMAND_OUTPUT_MODE_DETAILED,
        label: i18n._({ id: 'Detailed', message: 'Detailed' }),
      },
      {
        value: BOT_COMMAND_OUTPUT_MODE_FULL,
        label: i18n._({ id: 'Full Output', message: 'Full Output' }),
      },
    ],
    [],
  )

  const wechatCredentialSourceOptions = useMemo(
    () => [
      {
        value: 'saved',
        label: i18n._({ id: 'Saved Account', message: 'Saved Account' }),
      },
      {
        value: 'manual',
        label: i18n._({ id: 'Manual Entry', message: 'Manual Entry' }),
      },
      {
        value: 'qr',
        label: i18n._({ id: 'QR Login', message: 'QR Login' }),
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
  const isEditingConnection = editTarget !== null
  const connectionModalBaselineKey = connectionModalBaselineDraft ? serializeBotsPageDraft(connectionModalBaselineDraft) : ''
  const connectionModalDraftKey = serializeBotsPageDraft(draft)
  const isConnectionModalDirty = createModalOpen && connectionModalBaselineKey !== '' && connectionModalDraftKey !== connectionModalBaselineKey
  const isSaveConnectionDisabled = isEditingConnection && !isConnectionModalDirty
  const formErrorMessage =
    formError || (isEditingConnection ? getErrorMessage(updateMutation.error) : getErrorMessage(createMutation.error))
  const actionErrorMessage = actionMutation.error ? getErrorMessage(actionMutation.error) : ''
  const deleteErrorMessage = deleteMutation.error ? getErrorMessage(deleteMutation.error) : ''
  const deleteWeChatAccountErrorMessage = deleteWeChatAccountMutation.error
    ? getErrorMessage(deleteWeChatAccountMutation.error)
    : ''
  const runtimeModeErrorMessage = runtimeModeMutation.error ? getErrorMessage(runtimeModeMutation.error) : ''
  const commandOutputModeErrorMessage = commandOutputModeMutation.error
    ? getErrorMessage(commandOutputModeMutation.error)
    : ''
  const wechatChannelTimingErrorMessage = wechatChannelTimingMutation.error
    ? getErrorMessage(wechatChannelTimingMutation.error)
    : ''
  const editingConnectionHasBotToken = editTarget?.secretKeys?.includes('bot_token') ?? false
  const editingConnectionHasOpenAIApiKey = editTarget?.secretKeys?.includes('openai_api_key') ?? false
  const draftProvider = draft.provider.trim().toLowerCase() === 'wechat' ? 'wechat' : 'telegram'
  const draftTelegramDeliveryMode = draft.telegramDeliveryMode.trim().toLowerCase() === 'polling' ? 'polling' : 'webhook'
  const draftWeChatCredentialSource =
    draft.wechatCredentialSource.trim().toLowerCase() === 'saved'
      ? 'saved'
      : draft.wechatCredentialSource.trim().toLowerCase() === 'qr'
        ? 'qr'
        : 'manual'
  const hasDraftWeChatCredentialBundle =
    draft.wechatAccountId.trim().length > 0 &&
    draft.wechatUserId.trim().length > 0 &&
    draft.wechatBotToken.trim().length > 0
  const hasDraftConfirmedWeChatLoginSession =
    draft.wechatLoginSessionId.trim().length > 0 && draft.wechatLoginStatus.trim().toLowerCase() === 'confirmed'
  const selectedProvider =
    selectedConnection?.provider?.trim().toLowerCase() === 'wechat'
      ? 'wechat'
      : selectedConnection?.provider?.trim().toLowerCase() === 'telegram'
        ? 'telegram'
        : ''
  const savedWeChatAccounts = wechatAccountsQuery.data ?? []
  const linkedWeChatAccountByConnectionID = useMemo(
    () =>
      new Map(
        connections
          .map((connection) => [connection.id, findWeChatAccountForConnection(savedWeChatAccounts, connection)] as const)
          .filter((entry) => entry[1] !== null),
      ),
    [connections, savedWeChatAccounts],
  )
  const recentSuppressionSummaryByConnectionID = useMemo(() => {
    const now = Date.now()
    return new Map(
      connections.map((connection, index) => [
        connection.id,
        summarizeRecentBotConnectionSuppressions(connectionLogQueries[index]?.data ?? [], now),
      ]),
    )
  }, [connectionLogQueries, connections])
  const savedWeChatAccountConnections = useMemo(
    () =>
      new Map(
        savedWeChatAccounts.map((account) => [account.id, listWeChatConnectionsForAccount(connections, account)]),
      ),
    [connections, savedWeChatAccounts],
  )
  const savedWeChatAccountConnectionCounts = useMemo(
    () =>
      new Map(
        savedWeChatAccounts.map((account) => [
          account.id,
          savedWeChatAccountConnections.get(account.id)?.length ?? countWeChatConnectionsForAccount(connections, account),
        ]),
      ),
    [connections, savedWeChatAccountConnections, savedWeChatAccounts],
  )
  const filteredSavedWeChatAccounts = useMemo(
    () =>
      savedWeChatAccounts.filter((account) => {
        if (!matchesWeChatAccountSearch(account, wechatAccountSearch)) {
          return false
        }
        if (!showUnusedWeChatAccountsOnly) {
          return true
        }
        return (savedWeChatAccountConnections.get(account.id) ?? []).length === 0
      }),
    [savedWeChatAccountConnections, savedWeChatAccounts, showUnusedWeChatAccountsOnly, wechatAccountSearch],
  )
  const filteredConnections = useMemo(
    () =>
      connections.filter((connection) =>
        matchesBotConnectionSearch(connection, connectionSearch, linkedWeChatAccountByConnectionID.get(connection.id) ?? null),
      ),
    [connectionSearch, connections, linkedWeChatAccountByConnectionID],
  )
  const selectedSavedWeChatAccount =
    savedWeChatAccounts.find((account) => account.id === draft.wechatSavedAccountId.trim()) ?? null
  const selectedConnectionWeChatAccount =
    selectedProvider === 'wechat'
      ? findWeChatAccountForConnection(savedWeChatAccounts, selectedConnection)
      : null
  const selectedConnectionSuppressionSummary =
    (selectedConnection && recentSuppressionSummaryByConnectionID.get(selectedConnection.id)) ?? {
      suppressedCount: 0,
      duplicateSuppressedCount: 0,
      recoverySuppressedCount: 0,
      latestSuppressedAt: undefined,
    }
  const selectedTelegramDeliveryMode =
    selectedProvider === 'telegram' && selectedConnection?.settings?.telegram_delivery_mode?.trim().toLowerCase() === 'polling'
      ? 'polling'
      : 'webhook'
  const selectedDeliveryMode =
    selectedProvider === 'wechat' ? 'polling' : selectedProvider === 'telegram' ? selectedTelegramDeliveryMode : ''
  const selectedConnectionUsesPolling =
    selectedProvider === 'wechat' || (selectedProvider === 'telegram' && selectedDeliveryMode === 'polling')
  const selectedRuntimeMode =
    selectedConnection?.settings?.runtime_mode?.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
  const selectedCommandOutputMode = resolveBotCommandOutputMode(selectedConnection?.settings?.command_output_mode)
  const selectedWeChatChannelTimingEnabled =
    selectedProvider === 'wechat'
      ? resolveWeChatChannelTimingEnabled(selectedConnection?.settings, selectedRuntimeMode)
      : false
  const selectedProviderLabel = selectedConnection
    ? formatBotProviderLabel(selectedConnection.provider)
    : i18n._({ id: 'None', message: 'None' })
  const selectedBackendLabel = selectedConnection
    ? formatBotBackendLabel(selectedConnection.aiBackend)
    : i18n._({ id: 'None', message: 'None' })
  const selectedDeliveryModeLabel =
    selectedDeliveryMode === 'polling'
      ? i18n._({ id: 'Long Polling', message: 'Long Polling' })
      : selectedDeliveryMode === 'webhook'
        ? i18n._({ id: 'Webhook', message: 'Webhook' })
        : i18n._({ id: 'None', message: 'None' })
  const selectedCommandOutputModeLabel = formatBotCommandOutputModeLabel(selectedCommandOutputMode)
  const selectedProviderPosture =
    selectedProvider === 'wechat'
      ? i18n._({
          id: 'WeChat currently uses polling-only intake. No public callback URL is required, and replies depend on the latest inbound context token stored with each conversation.',
          message:
            'WeChat currently uses polling-only intake. No public callback URL is required, and replies depend on the latest inbound context token stored with each conversation.',
        })
      : selectedProvider === 'telegram'
        ? i18n._({
            id: 'Telegram supports both webhook and long-polling intake. Use webhook for public deployments or polling when inbound connectivity must remain outbound-only.',
            message:
              'Telegram supports both webhook and long-polling intake. Use webhook for public deployments or polling when inbound connectivity must remain outbound-only.',
          })
        : i18n._({
            id: 'Telegram supports webhook or long polling, while WeChat currently uses polling only with per-conversation reply context.',
            message:
              'Telegram supports webhook or long polling, while WeChat currently uses polling only with per-conversation reply context.',
          })
  const selectedIntakeLabel =
    selectedProvider === 'telegram' && selectedDeliveryMode === 'webhook'
      ? i18n._({ id: 'Webhook Route', message: 'Webhook Route' })
      : i18n._({ id: 'Update Intake', message: 'Update Intake' })
  const selectedIntakeValue =
    selectedProvider === 'wechat'
      ? i18n._({ id: 'WeChat iLink long polling', message: 'WeChat iLink long polling' })
      : selectedProvider === 'telegram'
        ? selectedDeliveryMode === 'polling'
          ? i18n._({ id: 'Telegram getUpdates long polling', message: 'Telegram getUpdates long polling' })
          : `/hooks/bots/${selectedConnection?.id ?? '{connectionId}'}`
        : i18n._({ id: 'None', message: 'None' })
  const selectedPublicUrlValue =
    selectedProvider === 'telegram' && selectedDeliveryMode === 'webhook'
      ? selectedConnection?.settings?.webhook_url ??
        i18n._({ id: 'resolved at activation', message: 'resolved at activation' })
      : selectedProvider === 'telegram' || selectedProvider === 'wechat'
        ? i18n._({ id: 'not required in polling mode', message: 'not required in polling mode' })
        : i18n._({ id: 'None', message: 'None' })
  const activeWeChatLogin: WeChatLogin | null = wechatLoginQuery.data ?? wechatLoginStartMutation.data ?? null
  const activeWeChatLoginStatus = activeWeChatLogin?.status?.trim().toLowerCase() ?? ''
  const wechatLoginWorkspaceId = draft.workspaceId.trim()
  const wechatLoginErrorMessage =
    getErrorMessage(wechatLoginStartMutation.error) ||
    getErrorMessage(wechatLoginQuery.error) ||
    getErrorMessage(wechatLoginDeleteMutation.error)
  const wechatAccountsErrorMessage = getErrorMessage(wechatAccountsQuery.error)
  const updateWeChatAccountErrorMessage = updateWeChatAccountMutation.error
    ? getErrorMessage(updateWeChatAccountMutation.error)
    : ''
  const wechatLoginCopyLabel =
    wechatLoginCopyState === 'copied'
      ? i18n._({ id: 'Copied', message: 'Copied' })
      : wechatLoginCopyState === 'error'
        ? i18n._({ id: 'Copy failed', message: 'Copy failed' })
        : i18n._({ id: 'Copy payload', message: 'Copy payload' })
  const wechatLoginEntryLabel = hasDraftWeChatCredentialBundle
    ? i18n._({ id: 'Replace Credentials', message: 'Replace Credentials' })
    : activeWeChatLogin?.credentialReady
      ? i18n._({ id: 'Review Credentials', message: 'Review Credentials' })
      : draft.wechatLoginSessionId
        ? i18n._({ id: 'Continue QR Login', message: 'Continue QR Login' })
        : i18n._({ id: 'Start QR Login', message: 'Start QR Login' })
  const wechatDraftSessionIdLabel = draft.wechatLoginSessionId || i18n._({ id: 'Not started', message: 'Not started' })
  const wechatDraftSessionStatusLabel = draft.wechatLoginStatus
    ? formatWeChatLoginStatus(draft.wechatLoginStatus)
    : i18n._({ id: 'Not started', message: 'Not started' })
  const wechatDraftPayloadLabel = draft.wechatQrCodeContent.trim()
    ? i18n._({ id: 'Ready', message: 'Ready' })
    : i18n._({ id: 'Not fetched', message: 'Not fetched' })
  const wechatDraftCredentialBundleLabel = hasDraftWeChatCredentialBundle
    ? i18n._({ id: 'Applied to form', message: 'Applied to form' })
    : hasDraftConfirmedWeChatLoginSession || activeWeChatLogin?.credentialReady
      ? i18n._({ id: 'Ready to create', message: 'Ready to create' })
      : draft.wechatLoginSessionId
        ? i18n._({ id: 'Pending confirmation', message: 'Pending confirmation' })
        : i18n._({ id: 'Not loaded', message: 'Not loaded' })
  const wechatQrCredentialNotice = hasDraftWeChatCredentialBundle
    ? ''
    : hasDraftConfirmedWeChatLoginSession || activeWeChatLogin?.credentialReady
      ? i18n._({
          id: 'The remote service has already confirmed this login. You can create the connection directly now, or reopen the QR dialog and click Use Credentials to copy the bundle into the form.',
          message:
            'The remote service has already confirmed this login. You can create the connection directly now, or reopen the QR dialog and click Use Credentials to copy the bundle into the form.',
        })
      : draft.wechatLoginSessionId
        ? i18n._({
            id: 'A QR login session is already in progress. Reopen the dialog to continue polling until the credential bundle is confirmed.',
            message:
              'A QR login session is already in progress. Reopen the dialog to continue polling until the credential bundle is confirmed.',
          })
        : i18n._({
            id: 'Start a QR login session to fetch the account ID, owner user ID, and bot token automatically from the remote WeChat service.',
            message:
              'Start a QR login session to fetch the account ID, owner user ID, and bot token automatically from the remote WeChat service.',
          })
  const savedWeChatAccountOptions = useMemo(
    () =>
      savedWeChatAccounts.map((account: WeChatAccount) => ({
        value: account.id,
        label: formatWeChatAccountLabel(account),
      })),
    [savedWeChatAccounts],
  )

  useEffect(() => {
    setWechatLoginModalOpen(false)
    setWechatLoginId('')
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    setDraft((current) => ({
      ...current,
      wechatLoginSessionId: '',
      wechatLoginStatus: '',
      wechatQrCodeContent: '',
    }))
    wechatLoginStartMutation.reset()
    wechatLoginDeleteMutation.reset()
  }, [draft.workspaceId])

  useEffect(() => {
    setDraft((current) => {
      const nextLoginID = activeWeChatLogin?.loginId ?? ''
      const nextStatus = activeWeChatLogin?.status ?? ''
      const nextQRCodeContent = activeWeChatLogin?.qrCodeContent ?? ''
      if (
        current.wechatLoginSessionId === nextLoginID &&
        current.wechatLoginStatus === nextStatus &&
        current.wechatQrCodeContent === nextQRCodeContent
      ) {
        return current
      }
      return {
        ...current,
        wechatLoginSessionId: nextLoginID,
        wechatLoginStatus: nextStatus,
        wechatQrCodeContent: nextQRCodeContent,
      }
    })
  }, [activeWeChatLogin?.loginId, activeWeChatLogin?.qrCodeContent, activeWeChatLogin?.status])

  useEffect(() => {
    const qrCodeContent = activeWeChatLogin?.qrCodeContent?.trim() ?? ''
    if (!wechatLoginModalOpen || qrCodeContent === '') {
      setWechatLoginQRCodeUrl('')
      return
    }

    let cancelled = false
    void toQRCodeDataURL(qrCodeContent, { margin: 1, width: 320 })
      .then((nextUrl: string) => {
        if (!cancelled) {
          setWechatLoginQRCodeUrl(nextUrl)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setWechatLoginQRCodeUrl('')
        }
      })

    return () => {
      cancelled = true
    }
  }, [activeWeChatLogin?.qrCodeContent, wechatLoginModalOpen])

  useEffect(() => {
    if (activeWeChatLoginStatus !== 'confirmed' || !draft.workspaceId.trim()) {
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['wechat-accounts', draft.workspaceId.trim()] })
  }, [activeWeChatLoginStatus, draft.workspaceId, queryClient])

  useEffect(() => {
    setConnectionSearch('')
    setWeChatAccountSearch('')
    setShowUnusedWeChatAccountsOnly(false)
    setEditWeChatAccountTarget(null)
    setWeChatAccountAliasDraft('')
    setWeChatAccountNoteDraft('')
    updateWeChatAccountMutation.reset()
  }, [selectedWorkspaceId])

  useEffect(() => {
    if (!connections.length) {
      return
    }
    if (!filteredConnections.length) {
      if (selectedConnectionId) {
        setSelectedConnectionId('')
      }
      return
    }
    if (!selectedConnectionId || !filteredConnections.some((connection) => connection.id === selectedConnectionId)) {
      setSelectedConnectionId(filteredConnections[0].id)
    }
  }, [connections.length, filteredConnections, selectedConnectionId])

  function resetWeChatLoginState() {
    setWechatLoginModalOpen(false)
    setWechatLoginId('')
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    setDraft((current) => ({
      ...current,
      wechatLoginSessionId: '',
      wechatLoginStatus: '',
      wechatQrCodeContent: '',
    }))
    wechatLoginStartMutation.reset()
    wechatLoginDeleteMutation.reset()
  }

  function dismissWeChatLoginModal() {
    setWechatLoginModalOpen(false)
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    wechatLoginDeleteMutation.reset()
  }

  function handleDraftProviderChange(nextValue: string) {
    const nextProvider = nextValue.trim().toLowerCase() === 'wechat' ? 'wechat' : 'telegram'
    if (nextProvider !== 'wechat') {
      resetWeChatLoginState()
    }
    setFormError('')
    setDraft((current) => ({
      ...current,
      provider: nextProvider,
      wechatCredentialSource: nextProvider === 'wechat' ? current.wechatCredentialSource : 'manual',
    }))
  }

  function handleWeChatCredentialSourceChange(nextValue: string) {
    const nextSource =
      nextValue.trim().toLowerCase() === 'saved'
        ? 'saved'
        : nextValue.trim().toLowerCase() === 'qr'
          ? 'qr'
          : 'manual'
    setFormError('')
    if (nextSource === 'manual') {
      resetWeChatLoginState()
      setDraft((current) => ({
        ...current,
        wechatCredentialSource: 'manual',
        wechatSavedAccountId: '',
      }))
      return
    }
    if (nextSource === 'saved') {
      resetWeChatLoginState()
      setDraft((current) => ({
        ...current,
        wechatCredentialSource: 'saved',
      }))
      return
    }

    setDraft((current) => ({
      ...current,
      wechatCredentialSource: 'qr',
      wechatSavedAccountId: '',
      wechatAccountId: current.wechatCredentialSource === 'manual' ? '' : current.wechatAccountId,
      wechatUserId: current.wechatCredentialSource === 'manual' ? '' : current.wechatUserId,
      wechatBotToken: current.wechatCredentialSource === 'manual' ? '' : current.wechatBotToken,
    }))
  }

  function openWeChatLoginModal() {
    setWechatLoginModalOpen(true)
    setWechatLoginCopyState('idle')
    if (!draft.wechatBaseUrl.trim()) {
      setDraft((current) => ({
        ...current,
        wechatBaseUrl: 'https://ilinkai.weixin.qq.com',
      }))
    }
  }

  function closeWeChatLoginModal() {
    dismissWeChatLoginModal()
  }

  function handleStartWeChatLogin() {
    if (!wechatLoginWorkspaceId) {
      setFormError(
        i18n._({
          id: 'Select a workspace before starting WeChat login.',
          message: 'Select a workspace before starting WeChat login.',
        }),
      )
      return
    }
    if (!draft.wechatBaseUrl.trim()) {
      setFormError(
        i18n._({
          id: 'WeChat base URL is required before starting QR login.',
          message: 'WeChat base URL is required before starting QR login.',
        }),
      )
      return
    }

    setFormError('')
    setWechatLoginId('')
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    setDraft((current) => ({
      ...current,
      wechatLoginSessionId: '',
      wechatLoginStatus: '',
      wechatQrCodeContent: '',
    }))
    wechatLoginStartMutation.reset()
    wechatLoginDeleteMutation.reset()
    wechatLoginStartMutation.mutate({
      workspaceId: wechatLoginWorkspaceId,
      baseUrl: draft.wechatBaseUrl.trim(),
    })
  }

  async function handleCopyWeChatPayload() {
    const value = activeWeChatLogin?.qrCodeContent?.trim() ?? ''
    if (!value || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      setWechatLoginCopyState('error')
      return
    }
    try {
      await navigator.clipboard.writeText(value)
      setWechatLoginCopyState('copied')
    } catch {
      setWechatLoginCopyState('error')
    }
  }

  function handleUseWeChatCredentials() {
    if (!activeWeChatLogin?.credentialReady) {
      return
    }
    setDraft((current) => ({
      ...current,
      provider: 'wechat',
      wechatCredentialSource: 'qr',
      wechatSavedAccountId: '',
      wechatBaseUrl: activeWeChatLogin.baseUrl ?? current.wechatBaseUrl,
      wechatAccountId: activeWeChatLogin.accountId ?? current.wechatAccountId,
      wechatUserId: activeWeChatLogin.userId ?? current.wechatUserId,
      wechatBotToken: activeWeChatLogin.botToken ?? current.wechatBotToken,
    }))
    setFormError('')
    resetWeChatLoginState()
  }

  function handleDeleteWeChatLogin() {
    if (!wechatLoginWorkspaceId || !wechatLoginId.trim()) {
      resetWeChatLoginState()
      return
    }
    wechatLoginDeleteMutation.mutate({
      workspaceId: wechatLoginWorkspaceId,
      loginId: wechatLoginId.trim(),
    })
  }

  function openCreateModal() {
    createMutation.reset()
    updateMutation.reset()
    setFormError('')
    setEditTarget(null)
    resetWeChatLoginState()
    const nextDraft = {
      ...EMPTY_BOTS_PAGE_DRAFT,
      workspaceId: selectedWorkspaceId || workspaces[0]?.id || '',
      runtimeMode: draft.runtimeMode,
      telegramDeliveryMode: draft.telegramDeliveryMode,
      publicBaseUrl: draft.publicBaseUrl,
      wechatChannelTimingEnabled: draft.wechatChannelTimingEnabled,
    }
    setDraft(nextDraft)
    setConnectionModalBaselineDraft(nextDraft)
    setDiscardConnectionModalConfirmOpen(false)
    setCreateModalOpen(true)
  }

  function openCreateModalWithSavedWeChatAccount(account: WeChatAccount) {
    createMutation.reset()
    updateMutation.reset()
    setFormError('')
    setEditTarget(null)
    resetWeChatLoginState()
    const nextDraft = {
      ...EMPTY_BOTS_PAGE_DRAFT,
      workspaceId: account.workspaceId,
      provider: 'wechat',
      runtimeMode: draft.runtimeMode,
      telegramDeliveryMode: draft.telegramDeliveryMode,
      publicBaseUrl: draft.publicBaseUrl,
      wechatBaseUrl: account.baseUrl,
      wechatChannelTimingEnabled: draft.wechatChannelTimingEnabled,
      wechatCredentialSource: 'saved',
      wechatSavedAccountId: account.id,
    }
    setDraft(nextDraft)
    setConnectionModalBaselineDraft(nextDraft)
    setDiscardConnectionModalConfirmOpen(false)
    setCreateModalOpen(true)
  }

  function openEditModal(connection: BotConnection) {
    createMutation.reset()
    updateMutation.reset()
    setFormError('')
    resetWeChatLoginState()
    setSelectedWorkspaceId(connection.workspaceId)
    setSelectedConnectionId(connection.id)
    setEditTarget(connection)
    const nextDraft = buildBotsPageDraftFromConnection(connection, savedWeChatAccounts)
    setDraft(nextDraft)
    setConnectionModalBaselineDraft(nextDraft)
    setDiscardConnectionModalConfirmOpen(false)
    setCreateModalOpen(true)
  }

  function openWeChatAccountEditModal(account: WeChatAccount) {
    updateWeChatAccountMutation.reset()
    setEditWeChatAccountTarget(account)
    setWeChatAccountAliasDraft(account.alias ?? '')
    setWeChatAccountNoteDraft(account.note ?? '')
  }

  function closeWeChatAccountEditModal() {
    if (updateWeChatAccountMutation.isPending) {
      return
    }
    setEditWeChatAccountTarget(null)
    setWeChatAccountAliasDraft('')
    setWeChatAccountNoteDraft('')
    updateWeChatAccountMutation.reset()
  }

  function closeCreateModal() {
    if (createMutation.isPending || updateMutation.isPending) {
      return
    }

    if (isConnectionModalDirty) {
      setDiscardConnectionModalConfirmOpen(true)
      return
    }

    forceCloseCreateModal()
  }

  function forceCloseCreateModal() {
    setCreateModalOpen(false)
    setEditTarget(null)
    setConnectionModalBaselineDraft(null)
    setDiscardConnectionModalConfirmOpen(false)
    resetWeChatLoginState()
    setDraft(EMPTY_BOTS_PAGE_DRAFT)
    setFormError('')
    createMutation.reset()
    updateMutation.reset()
  }

  function handleDiscardConnectionModalConfirm() {
    if (createMutation.isPending || updateMutation.isPending) {
      return
    }
    forceCloseCreateModal()
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

    if (draftProvider === 'telegram' && !draft.telegramBotToken.trim() && !(isEditingConnection && editingConnectionHasBotToken)) {
      setFormError(
        i18n._({
          id: 'Telegram bot token is required. Leave it blank only when editing a connection that already stores one.',
          message: 'Telegram bot token is required. Leave it blank only when editing a connection that already stores one.',
        }),
      )
      return
    }

    if (draftProvider === 'wechat' && draftWeChatCredentialSource !== 'saved' && !draft.wechatBaseUrl.trim()) {
      setFormError(
        i18n._({
          id: 'WeChat base URL is required.',
          message: 'WeChat base URL is required.',
        }),
      )
      return
    }

    if (
      draftProvider === 'wechat' &&
      draftWeChatCredentialSource === 'qr' &&
      !hasDraftWeChatCredentialBundle &&
      !hasDraftConfirmedWeChatLoginSession
    ) {
      setFormError(
        i18n._({
          id: 'Complete WeChat QR login until the session is confirmed before creating the connection.',
          message: 'Complete WeChat QR login until the session is confirmed before creating the connection.',
        }),
      )
      return
    }

    if (draftProvider === 'wechat' && draftWeChatCredentialSource === 'saved' && !draft.wechatSavedAccountId.trim()) {
      setFormError(
        i18n._({
          id: 'Select a saved WeChat account before creating the connection.',
          message: 'Select a saved WeChat account before creating the connection.',
        }),
      )
      return
    }

    if (draftProvider === 'wechat' && draftWeChatCredentialSource === 'manual' && !draft.wechatAccountId.trim()) {
      setFormError(
        i18n._({
          id: 'WeChat account ID is required.',
          message: 'WeChat account ID is required.',
        }),
      )
      return
    }

    if (draftProvider === 'wechat' && draftWeChatCredentialSource === 'manual' && !draft.wechatUserId.trim()) {
      setFormError(
        i18n._({
          id: 'WeChat owner user ID is required.',
          message: 'WeChat owner user ID is required.',
        }),
      )
      return
    }

    if (draftProvider === 'wechat' && draftWeChatCredentialSource === 'manual' && !draft.wechatBotToken.trim()) {
      if (!(isEditingConnection && editingConnectionHasBotToken)) {
        setFormError(
          i18n._({
            id: 'WeChat bot token is required. Leave it blank only when editing a connection that already stores one.',
            message: 'WeChat bot token is required. Leave it blank only when editing a connection that already stores one.',
          }),
        )
        return
      }
    }

    if (
      draft.aiBackend === 'openai_responses' &&
      !draft.openAIApiKey.trim() &&
      !(isEditingConnection && editingConnectionHasOpenAIApiKey)
    ) {
      setFormError(
        i18n._({
          id: 'OpenAI API key is required for the OpenAI Responses backend. Leave it blank only when editing a connection that already stores one.',
          message:
            'OpenAI API key is required for the OpenAI Responses backend. Leave it blank only when editing a connection that already stores one.',
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
    if (editTarget) {
      updateMutation.mutate({
        workspaceId,
        connectionId: editTarget.id,
        input: buildBotConnectionUpdateInput(draft),
      })
      return
    }

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

  function handleDeleteWeChatAccountConfirm() {
    if (!deleteWeChatAccountTarget || deleteWeChatAccountMutation.isPending) {
      return
    }

    deleteWeChatAccountMutation.mutate({
      workspaceId: deleteWeChatAccountTarget.workspaceId,
      accountId: deleteWeChatAccountTarget.id,
    })
  }

  function handleUpdateWeChatAccount() {
    if (!editWeChatAccountTarget || updateWeChatAccountMutation.isPending) {
      return
    }

    updateWeChatAccountMutation.mutate({
      workspaceId: editWeChatAccountTarget.workspaceId,
      accountId: editWeChatAccountTarget.id,
      alias: wechatAccountAliasDraft,
      note: wechatAccountNoteDraft,
    })
  }

  const createModalFooter = (
    <>
      <Button intent="secondary" onClick={closeCreateModal}>
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={isSaveConnectionDisabled}
        isLoading={isEditingConnection ? updateMutation.isPending : createMutation.isPending}
        onClick={handleSubmitCreate}
      >
        {isEditingConnection
          ? i18n._({ id: 'Save Changes', message: 'Save Changes' })
          : i18n._({ id: 'Create Connection', message: 'Create Connection' })}
      </Button>
    </>
  )

  const wechatLoginModalFooter = (
    <>
      {wechatLoginId ? (
        <Button
          intent="secondary"
          isLoading={wechatLoginDeleteMutation.isPending}
          onClick={handleDeleteWeChatLogin}
          type="button"
        >
          {activeWeChatLoginStatus === 'confirmed'
            ? i18n._({ id: 'Discard Session', message: 'Discard Session' })
            : i18n._({ id: 'Cancel Login', message: 'Cancel Login' })}
        </Button>
      ) : (
        <Button intent="secondary" onClick={closeWeChatLoginModal} type="button">
          {i18n._({ id: 'Close', message: 'Close' })}
        </Button>
      )}
      {activeWeChatLogin?.credentialReady ? (
        <Button onClick={handleUseWeChatCredentials} type="button">
          {i18n._({ id: 'Use Credentials', message: 'Use Credentials' })}
        </Button>
      ) : (
        <Button isLoading={wechatLoginStartMutation.isPending} onClick={handleStartWeChatLogin} type="button">
          {wechatLoginId
            ? i18n._({ id: 'Restart Login', message: 'Restart Login' })
            : i18n._({ id: 'Fetch QR Code', message: 'Fetch QR Code' })}
        </Button>
      )}
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
              id: 'Connect Telegram or WeChat bots, choose the right delivery posture for each provider, then route replies through Workspace Thread or OpenAI Responses.',
              message:
                'Connect Telegram or WeChat bots, choose the right delivery posture for each provider, then route replies through Workspace Thread or OpenAI Responses.',
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
                <p>{selectedProviderPosture}</p>
              </div>
            </div>
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
                <strong>{selectedProviderLabel}</strong>
              </div>
              <div className="mode-metric">
                <span>{i18n._({ id: 'Backend', message: 'Backend' })}</span>
                <strong>{selectedBackendLabel}</strong>
              </div>
            </div>
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Delivery Mode', message: 'Delivery Mode' })}</span>
                <strong>{selectedDeliveryModeLabel}</strong>
              </div>
              <div className="detail-row">
                <span>{selectedIntakeLabel}</span>
                <strong>{selectedIntakeValue}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Public URL', message: 'Public URL' })}</span>
                <strong>{selectedPublicUrlValue}</strong>
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

              {commandOutputModeErrorMessage ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bot-command-output-mode-${commandOutputModeErrorMessage}`}
                  title={i18n._({
                    id: 'Command Output Mode Update Failed',
                    message: 'Command Output Mode Update Failed',
                  })}
                  tone="error"
                >
                  {commandOutputModeErrorMessage}
                </InlineNotice>
              ) : null}

              {wechatChannelTimingErrorMessage ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bot-wechat-channel-timing-${wechatChannelTimingErrorMessage}`}
                  title={i18n._({
                    id: 'WeChat Channel Timing Update Failed',
                    message: 'WeChat Channel Timing Update Failed',
                  })}
                  tone="error"
                >
                  {wechatChannelTimingErrorMessage}
                </InlineNotice>
              ) : null}

              <section className="content-section">
                <div className="section-header section-header--inline">
                  <div>
                    <h2>{i18n._({ id: 'Connections', message: 'Connections' })}</h2>
                  </div>
                  <div className="section-header__meta">{filteredConnections.length}</div>
                </div>

                <Input
                  hint={i18n._({
                    id: 'Search by connection name, provider, backend, status, or linked WeChat account alias and note.',
                    message:
                      'Search by connection name, provider, backend, status, or linked WeChat account alias and note.',
                  })}
                  label={i18n._({ id: 'Search Connections', message: 'Search Connections' })}
                  onChange={(event) => setConnectionSearch(event.target.value)}
                  placeholder={i18n._({ id: 'Support, paused, openai, support queue', message: 'Support, paused, openai, support queue' })}
                  value={connectionSearch}
                />

                {connectionsQuery.isLoading ? (
                  <div className="notice">
                    {i18n._({ id: 'Loading bot connections...', message: 'Loading bot connections...' })}
                  </div>
                ) : null}

                {!connectionsQuery.isLoading && !connections.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No bot connections yet. Start with a Telegram or WeChat credential bundle, then choose the delivery posture that matches your deployment.',
                      message:
                        'No bot connections yet. Start with a Telegram or WeChat credential bundle, then choose the delivery posture that matches your deployment.',
                    })}
                  </div>
                ) : null}

                {!connectionsQuery.isLoading && connections.length > 0 && !filteredConnections.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No bot connections match the current search.',
                      message: 'No bot connections match the current search.',
                    })}
                  </div>
                ) : null}

                <div className="automation-compact-list">
                  {filteredConnections.map((connection) => {
                    const linkedWeChatAccount = linkedWeChatAccountByConnectionID.get(connection.id) ?? null
                    const recentSuppressionSummary = recentSuppressionSummaryByConnectionID.get(connection.id) ?? {
                      suppressedCount: 0,
                      duplicateSuppressedCount: 0,
                      recoverySuppressedCount: 0,
                      latestSuppressedAt: undefined,
                    }
                    return (
                      <div
                        className={[
                          'automation-compact-row',
                          selectedConnectionId === connection.id ? 'automation-compact-row--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={connection.id}
                      >
                        <button
                          aria-pressed={selectedConnectionId === connection.id}
                          className="automation-compact-row__main"
                          onClick={() => setSelectedConnectionId(connection.id)}
                          style={{
                            background: 'transparent',
                            border: 0,
                            cursor: 'pointer',
                            flex: 1,
                            minWidth: 0,
                            padding: 0,
                            textAlign: 'left',
                          }}
                          type="button"
                        >
                          <strong>{connection.name}</strong>
                          <span>
                            {formatBotProviderLabel(connection.provider)} | {formatBotBackendLabel(connection.aiBackend)} |{' '}
                            {formatBotTimestamp(connection.updatedAt)}
                          </span>
                          {linkedWeChatAccount ? (
                            <span>
                              {i18n._({ id: 'Saved Account', message: 'Saved Account' })}:{' '}
                              {formatWeChatAccountLabel(linkedWeChatAccount)}
                              {linkedWeChatAccount.note?.trim() ? ` | ${linkedWeChatAccount.note.trim()}` : ''}
                            </span>
                          ) : null}
                          {recentSuppressionSummary.suppressedCount > 0 ? (
                            <div className="automation-compact-row__meta">
                              <span className="meta-pill meta-pill--warning">
                                {i18n._({
                                  id: 'Suppressed 24h: {count}',
                                  message: 'Suppressed 24h: {count}',
                                  values: { count: recentSuppressionSummary.suppressedCount },
                                })}
                              </span>
                              {recentSuppressionSummary.duplicateSuppressedCount > 0 ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({
                                    id: 'Duplicate: {count}',
                                    message: 'Duplicate: {count}',
                                    values: { count: recentSuppressionSummary.duplicateSuppressedCount },
                                  })}
                                </span>
                              ) : null}
                              {recentSuppressionSummary.recoverySuppressedCount > 0 ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({
                                    id: 'Restart: {count}',
                                    message: 'Restart: {count}',
                                    values: { count: recentSuppressionSummary.recoverySuppressedCount },
                                  })}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </button>
                        <div className="automation-compact-row__actions">
                          <StatusPill status={connection.status} />
                          <Button intent="ghost" onClick={() => openEditModal(connection)} type="button">
                            {i18n._({ id: 'Edit', message: 'Edit' })}
                          </Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="content-section">
                <div className="section-header section-header--inline">
                  <div>
                    <h2>{i18n._({ id: 'Saved WeChat Accounts', message: 'Saved WeChat Accounts' })}</h2>
                    <p>
                      {i18n._({
                        id: 'Confirmed WeChat QR logins are stored per workspace so you can create new connections without rescanning the same account.',
                        message:
                          'Confirmed WeChat QR logins are stored per workspace so you can create new connections without rescanning the same account.',
                      })}
                    </p>
                  </div>
                  <div className="section-header__meta">{filteredSavedWeChatAccounts.length}</div>
                </div>

                <Input
                  hint={i18n._({
                    id: 'Search by alias, note, account ID, user ID, or base URL.',
                    message: 'Search by alias, note, account ID, user ID, or base URL.',
                  })}
                  label={i18n._({ id: 'Search Saved Accounts', message: 'Search Saved Accounts' })}
                  onChange={(event) => setWeChatAccountSearch(event.target.value)}
                  placeholder={i18n._({ id: 'Support, acct_123, wechat.example.com', message: 'Support, acct_123, wechat.example.com' })}
                  value={wechatAccountSearch}
                />

                <Switch
                  checked={showUnusedWeChatAccountsOnly}
                  hint={i18n._({
                    id: 'Show only saved WeChat accounts that are not currently linked to any bot connection in this workspace.',
                    message:
                      'Show only saved WeChat accounts that are not currently linked to any bot connection in this workspace.',
                  })}
                  label={i18n._({ id: 'Only Show Unbound Accounts', message: 'Only Show Unbound Accounts' })}
                  onChange={(event) => setShowUnusedWeChatAccountsOnly(event.target.checked)}
                />

                {wechatAccountsErrorMessage ? (
                  <InlineNotice
                    dismissible
                    noticeKey={`saved-wechat-accounts-${wechatAccountsErrorMessage}`}
                    onRetry={() => void wechatAccountsQuery.refetch()}
                    title={i18n._({
                      id: 'Failed To Load Saved WeChat Accounts',
                      message: 'Failed To Load Saved WeChat Accounts',
                    })}
                    tone="error"
                  >
                    {wechatAccountsErrorMessage}
                  </InlineNotice>
                ) : null}

                {wechatAccountsQuery.isLoading ? (
                  <div className="notice">
                    {i18n._({ id: 'Loading saved WeChat accounts...', message: 'Loading saved WeChat accounts...' })}
                  </div>
                ) : null}

                {!wechatAccountsQuery.isLoading && !savedWeChatAccounts.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No saved WeChat accounts yet. Complete one confirmed QR login to save an account for reuse in this workspace.',
                      message:
                        'No saved WeChat accounts yet. Complete one confirmed QR login to save an account for reuse in this workspace.',
                    })}
                  </div>
                ) : null}

                {!wechatAccountsQuery.isLoading && savedWeChatAccounts.length > 0 && !filteredSavedWeChatAccounts.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No saved WeChat accounts match the current filters.',
                      message: 'No saved WeChat accounts match the current filters.',
                    })}
                  </div>
                ) : null}

                {filteredSavedWeChatAccounts.length ? (
                  <div className="directory-list">
                    {filteredSavedWeChatAccounts.map((account) => (
                      <article className="directory-item" key={account.id}>
                        <div className="directory-item__icon">WX</div>
                        <div className="directory-item__body">
                          <strong>{formatWeChatAccountLabel(account)}</strong>
                          {account.alias?.trim() ? (
                            <p>
                              {i18n._({ id: 'Alias', message: 'Alias' })}: {account.alias}
                            </p>
                          ) : null}
                          <p>
                            {i18n._({ id: 'Base URL', message: 'Base URL' })}: {account.baseUrl}
                          </p>
                          <p>
                            {i18n._({ id: 'Last Confirmed', message: 'Last Confirmed' })}:{' '}
                            {formatBotTimestamp(account.lastConfirmedAt)}
                          </p>
                          {account.note?.trim() ? <p>{account.note}</p> : null}
                          {(savedWeChatAccountConnections.get(account.id) ?? []).length ? (
                            <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
                              <strong>{i18n._({ id: 'Linked Connections', message: 'Linked Connections' })}</strong>
                              <div style={{ display: 'grid', gap: '8px' }}>
                                {(savedWeChatAccountConnections.get(account.id) ?? []).map((connection) => (
                                  <div
                                    key={connection.id}
                                    style={{
                                      alignItems: 'center',
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: '8px',
                                      justifyContent: 'space-between',
                                    }}
                                  >
                                    <div style={{ display: 'grid', gap: '4px' }}>
                                      <strong>{connection.name}</strong>
                                      <span>
                                        {formatBotBackendLabel(connection.aiBackend)} | {formatBotTimestamp(connection.updatedAt)}
                                      </span>
                                    </div>
                                    <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                      <StatusPill status={connection.status} />
                                      <Button intent="ghost" onClick={() => openEditModal(connection)} type="button">
                                        {i18n._({ id: 'Edit', message: 'Edit' })}
                                      </Button>
                                      <Button
                                        intent="ghost"
                                        onClick={() => setSelectedConnectionId(connection.id)}
                                        type="button"
                                      >
                                        {i18n._({ id: 'Open Connection', message: 'Open Connection' })}
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <p>
                              {i18n._({
                                id: 'Not used by any bot connection yet.',
                                message: 'Not used by any bot connection yet.',
                              })}
                            </p>
                          )}
                        </div>
                        <div
                          className="directory-item__meta"
                          style={{ alignItems: 'end', display: 'grid', gap: '8px', justifyItems: 'end' }}
                        >
                          <span className="meta-pill">
                            {i18n._({ id: 'Connections', message: 'Connections' })}:{' '}
                            {savedWeChatAccountConnectionCounts.get(account.id) ?? 0}
                          </span>
                          <span className="meta-pill">{formatBotTimestamp(account.updatedAt)}</span>
                          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            <Button intent="secondary" onClick={() => openCreateModalWithSavedWeChatAccount(account)} type="button">
                              {i18n._({ id: 'Use For New Connection', message: 'Use For New Connection' })}
                            </Button>
                            <Button intent="ghost" onClick={() => openWeChatAccountEditModal(account)} type="button">
                              {i18n._({ id: 'Edit Details', message: 'Edit Details' })}
                            </Button>
                            <Button
                              className="ide-button--ghost-danger"
                              intent="ghost"
                              onClick={() => setDeleteWeChatAccountTarget(account)}
                              type="button"
                            >
                              {i18n._({ id: 'Delete', message: 'Delete' })}
                            </Button>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}
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
                          <Button intent="secondary" onClick={() => openEditModal(selectedConnection)}>
                            {i18n._({ id: 'Edit', message: 'Edit' })}
                          </Button>
                          <Button
                            intent="secondary"
                            onClick={() => navigate(`/bots/${selectedConnection.workspaceId}/${selectedConnection.id}/logs`)}
                          >
                            {i18n._({ id: 'View Logs', message: 'View Logs' })}
                          </Button>
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

                    {selectedConnectionSuppressionSummary.suppressedCount > 0 ? (
                      <InlineNotice
                        dismissible
                        noticeKey={`bot-suppression-summary-${selectedConnection.id}-${selectedConnectionSuppressionSummary.suppressedCount}-${selectedConnectionSuppressionSummary.latestSuppressedAt ?? 'none'}`}
                        title={i18n._({
                          id: 'Replay Suppressions Recorded',
                          message: 'Replay Suppressions Recorded',
                        })}
                      >
                        {i18n._({
                          id: 'The backend suppressed {count} replay attempt(s) for this connection in the last 24 hours to avoid duplicating previously sent content.',
                          message:
                            'The backend suppressed {count} replay attempt(s) for this connection in the last 24 hours to avoid duplicating previously sent content.',
                          values: { count: selectedConnectionSuppressionSummary.suppressedCount },
                        })}
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
                          <span>{i18n._({ id: 'Delivery Mode', message: 'Delivery Mode' })}</span>
                          <strong>{selectedDeliveryModeLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
                          <strong>{selectedCommandOutputModeLabel}</strong>
                        </div>
                        {selectedConnectionUsesPolling ? (
                          <>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Last Poll Status', message: 'Last Poll Status' })}</span>
                              <strong>
                                {selectedConnection.lastPollStatus ? (
                                  <StatusPill status={selectedConnection.lastPollStatus} />
                                ) : (
                                  i18n._({ id: 'none', message: 'none' })
                                )}
                              </strong>
                            </div>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Last Poll Time', message: 'Last Poll Time' })}</span>
                              <strong>{formatBotTimestamp(selectedConnection.lastPollAt ?? undefined)}</strong>
                            </div>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Last Poll Message', message: 'Last Poll Message' })}</span>
                              <strong>{selectedConnection.lastPollMessage?.trim() || i18n._({ id: 'none', message: 'none' })}</strong>
                            </div>
                          </>
                        ) : null}
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Updated', message: 'Updated' })}</span>
                          <strong>{formatBotTimestamp(selectedConnection.updatedAt)}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Suppressed Replays (24h)', message: 'Suppressed Replays (24h)' })}</span>
                          <strong>{selectedConnectionSuppressionSummary.suppressedCount || i18n._({ id: 'none', message: 'none' })}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Duplicate Deliveries Suppressed (24h)', message: 'Duplicate Deliveries Suppressed (24h)' })}</span>
                          <strong>
                            {selectedConnectionSuppressionSummary.duplicateSuppressedCount ||
                              i18n._({ id: 'none', message: 'none' })}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Restart Replays Suppressed (24h)', message: 'Restart Replays Suppressed (24h)' })}</span>
                          <strong>
                            {selectedConnectionSuppressionSummary.recoverySuppressedCount ||
                              i18n._({ id: 'none', message: 'none' })}
                          </strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Last Suppressed Replay', message: 'Last Suppressed Replay' })}</span>
                          <strong>
                            {selectedConnectionSuppressionSummary.latestSuppressedAt
                              ? formatBotTimestamp(selectedConnectionSuppressionSummary.latestSuppressedAt)
                              : i18n._({ id: 'none', message: 'none' })}
                          </strong>
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
                        {selectedProvider === 'wechat' ? (
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Saved WeChat Account', message: 'Saved WeChat Account' })}</span>
                          <strong>
                            {selectedConnectionWeChatAccount
                              ? formatWeChatAccountLabel(selectedConnectionWeChatAccount)
                              : i18n._({ id: 'none', message: 'none' })}
                          </strong>
                        </div>
                        ) : null}
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
                              id: 'Debug mode adds detailed backend logs for inbound processing, AI execution, streaming updates, and provider delivery operations.',
                              message:
                                'Debug mode adds detailed backend logs for inbound processing, AI execution, streaming updates, and provider delivery operations.',
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

                    <section className="mode-panel">
                      <div className="section-header">
                        <div>
                          <h2>{i18n._({ id: 'Reply Formatting', message: 'Reply Formatting' })}</h2>
                          <p>
                            {i18n._({
                              id: 'Control how workspace command items are summarized when replies are mirrored back into Telegram or WeChat.',
                              message:
                                'Control how workspace command items are summarized when replies are mirrored back into Telegram or WeChat.',
                            })}
                          </p>
                        </div>
                      </div>
                      <label className="field">
                        <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
                        <SelectControl
                          ariaLabel={i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}
                          disabled={commandOutputModeMutation.isPending}
                          fullWidth
                          onChange={(nextValue) =>
                            commandOutputModeMutation.mutate({
                              workspaceId: selectedConnection.workspaceId,
                              connectionId: selectedConnection.id,
                              commandOutputMode: nextValue,
                            })
                          }
                          options={commandOutputModeOptions}
                          value={selectedCommandOutputMode}
                        />
                      </label>
                      <p className="config-inline-note">
                        {i18n._({
                          id: 'No Command Output omits command items entirely.',
                          message: 'No Command Output omits command items entirely.',
                        })}{' '}
                        {i18n._({
                          id: 'Brief keeps command excerpts to roughly 3-5 lines and is the default for new bot connections. Full Output forwards the entire command transcript.',
                          message:
                            'Brief keeps command excerpts to roughly 3-5 lines and is the default for new bot connections. Full Output forwards the entire command transcript.',
                        })}
                      </p>
                      {selectedProvider === 'wechat' ? (
                        <Switch
                          checked={selectedWeChatChannelTimingEnabled}
                          disabled={wechatChannelTimingMutation.isPending}
                          hint={i18n._({
                            id: 'Append the WeChat Channel timing block to final replies. This is independent from backend debug logging; existing connections still inherit debug mode until you change this switch.',
                            message:
                              'Append the WeChat Channel timing block to final replies. This is independent from backend debug logging; existing connections still inherit debug mode until you change this switch.',
                          })}
                          label={i18n._({
                            id: 'Append WeChat Channel Timing',
                            message: 'Append WeChat Channel Timing',
                          })}
                          onChange={(event) =>
                            wechatChannelTimingMutation.mutate({
                              workspaceId: selectedConnection.workspaceId,
                              connectionId: selectedConnection.id,
                              enabled: event.target.checked,
                            })
                          }
                        />
                      ) : null}
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
          description={
            isEditingConnection
              ? i18n._({
                  id: 'Update the provider delivery settings, credentials, and AI backend binding for this existing bot connection.',
                  message:
                    'Update the provider delivery settings, credentials, and AI backend binding for this existing bot connection.',
                })
              : i18n._({
                  id: 'Create a provider connection, configure the provider-specific delivery settings, and bind it to an AI execution backend.',
                  message:
                    'Create a provider connection, configure the provider-specific delivery settings, and bind it to an AI execution backend.',
                })
          }
          footer={createModalFooter}
          onClose={closeCreateModal}
          title={
            isEditingConnection
              ? i18n._({ id: 'Edit Bot Connection', message: 'Edit Bot Connection' })
              : i18n._({ id: 'New Bot Connection', message: 'New Bot Connection' })
          }
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
                noticeKey={`${isEditingConnection ? 'edit' : 'create'}-bot-connection-${formErrorMessage}`}
                title={
                  isEditingConnection
                    ? i18n._({ id: 'Update Bot Connection Failed', message: 'Update Bot Connection Failed' })
                    : i18n._({ id: 'Create Bot Connection Failed', message: 'Create Bot Connection Failed' })
                }
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
                  disabled={isEditingConnection}
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
                  disabled={isEditingConnection}
                  fullWidth
                  onChange={handleDraftProviderChange}
                  options={providerOptions}
                  value={draft.provider}
                />
              </label>
            </div>

            <div className="form-row">
              {draftProvider === 'telegram' ? (
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
              ) : (
                <Input
                  disabled
                  hint={i18n._({
                    id: 'WeChat currently uses polling-only intake in this phase.',
                    message: 'WeChat currently uses polling-only intake in this phase.',
                  })}
                  label={i18n._({ id: 'WeChat Delivery Mode', message: 'WeChat Delivery Mode' })}
                  value={i18n._({ id: 'Long Polling only', message: 'Long Polling only' })}
                />
              )}
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
                id: 'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and provider delivery steps.',
                message:
                  'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and provider delivery steps.',
              })}
              label={i18n._({ id: 'Enable Backend Debug Mode', message: 'Enable Backend Debug Mode' })}
              onChange={(event) =>
                setDraft((current) => ({ ...current, runtimeMode: event.target.checked ? 'debug' : 'normal' }))
              }
            />

            <label className="field">
              <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}
                fullWidth
                onChange={(nextValue) => setDraft((current) => ({ ...current, commandOutputMode: nextValue }))}
                options={commandOutputModeOptions}
                value={resolveBotCommandOutputMode(draft.commandOutputMode)}
              />
            </label>
            <p className="config-inline-note">
              {i18n._({
                id: 'No Command Output omits command items entirely.',
                message: 'No Command Output omits command items entirely.',
              })}{' '}
              {i18n._({
                id: 'Controls how command items are summarized in Telegram and WeChat replies. Brief keeps the command excerpt within about 3-5 lines and is the default.',
                message:
                  'Controls how command items are summarized in Telegram and WeChat replies. Brief keeps the command excerpt within about 3-5 lines and is the default.',
              })}
            </p>

            {draftProvider === 'telegram' ? (
              <>
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
                  hint={
                    isEditingConnection
                      ? i18n._({
                          id: 'Leave blank to keep the current Telegram bot token. Enter a new token only when rotating credentials.',
                          message:
                            'Leave blank to keep the current Telegram bot token. Enter a new token only when rotating credentials.',
                        })
                      : undefined
                  }
                  label={i18n._({ id: 'Telegram Bot Token', message: 'Telegram Bot Token' })}
                  onChange={(event) => setDraft((current) => ({ ...current, telegramBotToken: event.target.value }))}
                  placeholder={i18n._({ id: '123456:ABCDEF...', message: '123456:ABCDEF...' })}
                  type="password"
                  value={draft.telegramBotToken}
                />
              </>
            ) : (
              <>
                <div className="form-row">
                  <Input
                    hint={i18n._({
                      id: 'Required. Use the iLink channel base URL for this WeChat account.',
                      message: 'Required. Use the iLink channel base URL for this WeChat account.',
                    })}
                    label={i18n._({ id: 'WeChat Base URL', message: 'WeChat Base URL' })}
                    onChange={(event) => setDraft((current) => ({ ...current, wechatBaseUrl: event.target.value }))}
                    placeholder="https://wechat.example.com"
                    value={draft.wechatBaseUrl}
                  />
                  <label className="field">
                    <span>{i18n._({ id: 'Credential Source', message: 'Credential Source' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Credential Source', message: 'Credential Source' })}
                      fullWidth
                      onChange={handleWeChatCredentialSourceChange}
                      options={wechatCredentialSourceOptions}
                      value={draftWeChatCredentialSource}
                    />
                  </label>
                </div>

                <Input
                  hint={i18n._({
                    id: 'Optional. Adds the SKRouteTag header for WeChat API requests when your iLink deployment requires route pinning.',
                    message:
                      'Optional. Adds the SKRouteTag header for WeChat API requests when your iLink deployment requires route pinning.',
                  })}
                  label={i18n._({ id: 'WeChat Route Tag', message: 'WeChat Route Tag' })}
                  onChange={(event) => setDraft((current) => ({ ...current, wechatRouteTag: event.target.value }))}
                  placeholder={i18n._({ id: 'route-tag-1', message: 'route-tag-1' })}
                  value={draft.wechatRouteTag}
                />

                <Switch
                  checked={draft.wechatChannelTimingEnabled}
                  hint={i18n._({
                    id: 'Append the WeChat Channel timing block to final replies. This is independent from backend debug mode and defaults to disabled for new connections.',
                    message:
                      'Append the WeChat Channel timing block to final replies. This is independent from backend debug mode and defaults to disabled for new connections.',
                  })}
                  label={i18n._({
                    id: 'Append WeChat Channel Timing',
                    message: 'Append WeChat Channel Timing',
                  })}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, wechatChannelTimingEnabled: event.target.checked }))
                  }
                />

                {draftWeChatCredentialSource === 'saved' ? (
                  <>
                    <label className="field">
                      <span>{i18n._({ id: 'Saved WeChat Account', message: 'Saved WeChat Account' })}</span>
                      <SelectControl
                        ariaLabel={i18n._({ id: 'Saved WeChat Account', message: 'Saved WeChat Account' })}
                        fullWidth
                        onChange={(nextValue) =>
                          setDraft((current) => ({
                            ...current,
                            wechatBaseUrl:
                              savedWeChatAccounts.find((account) => account.id === nextValue)?.baseUrl ?? current.wechatBaseUrl,
                            wechatSavedAccountId: nextValue,
                          }))
                        }
                        options={savedWeChatAccountOptions}
                        value={draft.wechatSavedAccountId}
                      />
                    </label>

                    {wechatAccountsErrorMessage ? (
                      <InlineNotice
                        dismissible={false}
                        noticeKey={`wechat-accounts-error-${wechatAccountsErrorMessage}`}
                        title={i18n._({ id: 'Saved Account Lookup Failed', message: 'Saved Account Lookup Failed' })}
                      >
                        {wechatAccountsErrorMessage}
                      </InlineNotice>
                    ) : null}

                    {!savedWeChatAccounts.length ? (
                      <InlineNotice
                        dismissible={false}
                        noticeKey="wechat-saved-accounts-empty"
                        title={i18n._({ id: 'No Saved Accounts Yet', message: 'No Saved Accounts Yet' })}
                      >
                        {i18n._({
                          id: 'Complete one WeChat QR login first. Confirmed accounts are saved automatically and will appear here for reuse.',
                          message:
                            'Complete one WeChat QR login first. Confirmed accounts are saved automatically and will appear here for reuse.',
                        })}
                      </InlineNotice>
                    ) : selectedSavedWeChatAccount ? (
                      <>
                        <div
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '8px',
                            justifyContent: 'space-between',
                          }}
                        >
                          <strong>{i18n._({ id: 'Saved Account Detail', message: 'Saved Account Detail' })}</strong>
                          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            <Button intent="ghost" onClick={() => openWeChatAccountEditModal(selectedSavedWeChatAccount)} type="button">
                              {i18n._({ id: 'Edit Details', message: 'Edit Details' })}
                            </Button>
                            <Button
                              className="ide-button--ghost-danger"
                              intent="ghost"
                              onClick={() => setDeleteWeChatAccountTarget(selectedSavedWeChatAccount)}
                              type="button"
                            >
                              {i18n._({ id: 'Delete Saved Account', message: 'Delete Saved Account' })}
                            </Button>
                          </div>
                        </div>
                        <div className="detail-list">
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Label', message: 'Label' })}</span>
                            <strong>{formatWeChatAccountLabel(selectedSavedWeChatAccount)}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Alias', message: 'Alias' })}</span>
                            <strong>{selectedSavedWeChatAccount.alias?.trim() || i18n._({ id: 'none', message: 'none' })}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Account ID', message: 'Account ID' })}</span>
                            <strong>{selectedSavedWeChatAccount.accountId}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Owner User ID', message: 'Owner User ID' })}</span>
                            <strong>{selectedSavedWeChatAccount.userId}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Resolved Base URL', message: 'Resolved Base URL' })}</span>
                            <strong>{selectedSavedWeChatAccount.baseUrl}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Last Confirmed', message: 'Last Confirmed' })}</span>
                            <strong>{formatBotTimestamp(selectedSavedWeChatAccount.lastConfirmedAt)}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Notes', message: 'Notes' })}</span>
                            <strong>{selectedSavedWeChatAccount.note?.trim() || i18n._({ id: 'none', message: 'none' })}</strong>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </>
                ) : draftWeChatCredentialSource === 'manual' ? (
                  <>
                    <div className="form-row">
                      <Input
                        label={i18n._({ id: 'WeChat Account ID', message: 'WeChat Account ID' })}
                        onChange={(event) => setDraft((current) => ({ ...current, wechatAccountId: event.target.value }))}
                        placeholder={i18n._({ id: 'wechat-account-1', message: 'wechat-account-1' })}
                        value={draft.wechatAccountId}
                      />
                      <Input
                        hint={i18n._({
                          id: 'Required. This maps to wechat_owner_user_id on the backend.',
                          message: 'Required. This maps to wechat_owner_user_id on the backend.',
                        })}
                        label={i18n._({ id: 'WeChat Owner User ID', message: 'WeChat Owner User ID' })}
                        onChange={(event) => setDraft((current) => ({ ...current, wechatUserId: event.target.value }))}
                        placeholder={i18n._({ id: 'wechat-owner-1', message: 'wechat-owner-1' })}
                        value={draft.wechatUserId}
                      />
                    </div>

                    <Input
                      hint={
                        isEditingConnection
                          ? i18n._({
                              id: 'Leave blank to keep the current WeChat bot token. Enter a new token only when rotating credentials.',
                              message:
                                'Leave blank to keep the current WeChat bot token. Enter a new token only when rotating credentials.',
                            })
                          : i18n._({
                              id: 'Enter the bot token issued by the WeChat iLink backend for this account.',
                              message: 'Enter the bot token issued by the WeChat iLink backend for this account.',
                            })
                      }
                      label={i18n._({ id: 'WeChat Bot Token', message: 'WeChat Bot Token' })}
                      onChange={(event) => setDraft((current) => ({ ...current, wechatBotToken: event.target.value }))}
                      placeholder={i18n._({ id: 'wechat-token-1', message: 'wechat-token-1' })}
                      type="password"
                      value={draft.wechatBotToken}
                    />
                  </>
                ) : (
                  <>
                    <section className="mode-panel">
                      <div
                        style={{
                          alignItems: 'start',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '16px',
                          justifyContent: 'space-between',
                        }}
                      >
                        <div style={{ display: 'grid', gap: '6px' }}>
                          <strong>{i18n._({ id: 'WeChat QR Login', message: 'WeChat QR Login' })}</strong>
                          <span>
                            {i18n._({
                              id: 'Fetch the WeChat credential bundle from the remote iLink service, then apply it back into this form without manual secret entry.',
                              message:
                                'Fetch the WeChat credential bundle from the remote iLink service, then apply it back into this form without manual secret entry.',
                            })}
                          </span>
                        </div>
                        <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {draft.wechatLoginStatus ? <StatusPill status={draft.wechatLoginStatus} /> : null}
                          <Button intent="secondary" onClick={openWeChatLoginModal} type="button">
                            {wechatLoginEntryLabel}
                          </Button>
                        </div>
                      </div>

                      <div className="detail-list" style={{ marginTop: '16px' }}>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Login Session', message: 'Login Session' })}</span>
                          <strong>{wechatDraftSessionIdLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Session Status', message: 'Session Status' })}</span>
                          <strong>{wechatDraftSessionStatusLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'QR Payload', message: 'QR Payload' })}</span>
                          <strong>{wechatDraftPayloadLabel}</strong>
                        </div>
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Credential Bundle', message: 'Credential Bundle' })}</span>
                          <strong>{wechatDraftCredentialBundleLabel}</strong>
                        </div>
                      </div>
                    </section>

                    {!hasDraftWeChatCredentialBundle ? (
                      <InlineNotice
                        dismissible={false}
                        noticeKey={`wechat-qr-credential-${draft.wechatLoginSessionId || 'idle'}-${draft.wechatLoginStatus || 'none'}`}
                        title={
                          hasDraftConfirmedWeChatLoginSession
                            ? i18n._({ id: 'QR Session Ready', message: 'QR Session Ready' })
                            : i18n._({ id: 'QR Credentials Required', message: 'QR Credentials Required' })
                        }
                      >
                        {wechatQrCredentialNotice}
                      </InlineNotice>
                    ) : (
                      <>
                        <div className="form-row">
                          <Input
                            hint={i18n._({
                              id: 'Applied from the confirmed QR login session. Switch back to Manual Entry if you need to override it manually.',
                              message:
                                'Applied from the confirmed QR login session. Switch back to Manual Entry if you need to override it manually.',
                            })}
                            label={i18n._({ id: 'WeChat Account ID', message: 'WeChat Account ID' })}
                            readOnly
                            value={draft.wechatAccountId}
                          />
                          <Input
                            hint={i18n._({
                              id: 'Read-only while QR Login is selected.',
                              message: 'Read-only while QR Login is selected.',
                            })}
                            label={i18n._({ id: 'WeChat Owner User ID', message: 'WeChat Owner User ID' })}
                            readOnly
                            value={draft.wechatUserId}
                          />
                        </div>

                        <Input
                          hint={i18n._({
                            id: 'Stored in the form and submitted on create. Start a new QR login if you need to rotate it.',
                            message:
                              'Stored in the form and submitted on create. Start a new QR login if you need to rotate it.',
                          })}
                          label={i18n._({ id: 'WeChat Bot Token', message: 'WeChat Bot Token' })}
                          readOnly
                          type="password"
                          value={draft.wechatBotToken}
                        />
                      </>
                    )}
                  </>
                )}
              </>
            )}

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
                    hint={
                      isEditingConnection
                        ? i18n._({
                            id: 'Leave blank to keep the current OpenAI API key. Enter a new key only when rotating credentials.',
                            message:
                              'Leave blank to keep the current OpenAI API key. Enter a new key only when rotating credentials.',
                          })
                        : undefined
                    }
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

      {wechatLoginModalOpen ? (
        <Modal
          description={i18n._({
            id: 'Start a short-lived WeChat login session, display the provider-issued QR code, then pull the confirmed credential bundle back into the connection form.',
            message:
              'Start a short-lived WeChat login session, display the provider-issued QR code, then pull the confirmed credential bundle back into the connection form.',
          })}
          footer={wechatLoginModalFooter}
          onClose={closeWeChatLoginModal}
          title={i18n._({ id: 'WeChat QR Login', message: 'WeChat QR Login' })}
        >
          <div className="form-stack">
            {wechatLoginErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`wechat-login-${wechatLoginErrorMessage}`}
                title={i18n._({ id: 'WeChat Login Failed', message: 'WeChat Login Failed' })}
                tone="error"
              >
                {wechatLoginErrorMessage}
              </InlineNotice>
            ) : null}

            <Input
              hint={i18n._({
                id: 'This base URL is used both for fetching the QR code and for the final confirmed credential bundle.',
                message:
                  'This base URL is used both for fetching the QR code and for the final confirmed credential bundle.',
              })}
              label={i18n._({ id: 'WeChat Base URL', message: 'WeChat Base URL' })}
              onChange={(event) => setDraft((current) => ({ ...current, wechatBaseUrl: event.target.value }))}
              placeholder="https://ilinkai.weixin.qq.com"
              value={draft.wechatBaseUrl}
            />

            {activeWeChatLogin ? (
              <div className="mode-panel" style={{ margin: 0 }}>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Session Status', message: 'Session Status' })}</span>
                    <strong>{formatWeChatLoginStatus(activeWeChatLogin.status)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Login ID', message: 'Login ID' })}</span>
                    <strong>{activeWeChatLogin.loginId}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Expires', message: 'Expires' })}</span>
                    <strong>{formatBotTimestamp(activeWeChatLogin.expiresAt)}</strong>
                  </div>
                </div>
              </div>
            ) : null}

            {activeWeChatLogin?.qrCodeContent ? (
              <div
                style={{
                  alignItems: 'center',
                  display: 'grid',
                  gap: '16px',
                  justifyItems: 'center',
                }}
              >
                {wechatLoginQRCodeUrl ? (
                  <img
                    alt={i18n._({ id: 'WeChat login QR code', message: 'WeChat login QR code' })}
                    src={wechatLoginQRCodeUrl}
                    style={{
                      background: '#fff',
                      border: '1px solid rgba(15, 23, 42, 0.12)',
                      borderRadius: '16px',
                      maxWidth: '100%',
                      padding: '12px',
                      width: '320px',
                    }}
                  />
                ) : (
                  <div className="notice">
                    {i18n._({ id: 'Rendering QR code...', message: 'Rendering QR code...' })}
                  </div>
                )}
                <Button intent="secondary" onClick={() => void handleCopyWeChatPayload()} type="button">
                  {wechatLoginCopyLabel}
                </Button>
                <TextArea
                  hint={i18n._({
                    id: 'Fallback payload for copy or external inspection. The QR image above is rendered locally from this exact value.',
                    message:
                      'Fallback payload for copy or external inspection. The QR image above is rendered locally from this exact value.',
                  })}
                  label={i18n._({ id: 'QR Payload', message: 'QR Payload' })}
                  readOnly
                  rows={3}
                  value={activeWeChatLogin.qrCodeContent}
                />
              </div>
            ) : null}

            {activeWeChatLoginStatus === 'scaned' ? (
              <InlineNotice
                dismissible={false}
                noticeKey="wechat-login-scanned"
                title={i18n._({ id: 'QR Code Scanned', message: 'QR Code Scanned' })}
                tone="info"
              >
                {i18n._({
                  id: 'The QR code has been scanned. Keep this dialog open until the remote service confirms the login and returns the final credential bundle.',
                  message:
                    'The QR code has been scanned. Keep this dialog open until the remote service confirms the login and returns the final credential bundle.',
                })}
              </InlineNotice>
            ) : null}

            {activeWeChatLogin?.credentialReady ? (
              <div className="mode-panel" style={{ margin: 0 }}>
                <div className="section-header">
                  <div>
                    <h2>{i18n._({ id: 'Confirmed Credentials', message: 'Confirmed Credentials' })}</h2>
                    <p>
                      {i18n._({
                        id: 'Review the confirmed credential bundle before applying it back into the connection form.',
                        message:
                          'Review the confirmed credential bundle before applying it back into the connection form.',
                      })}
                    </p>
                  </div>
                </div>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Base URL', message: 'Base URL' })}</span>
                    <strong>{activeWeChatLogin.baseUrl ?? '-'}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Account ID', message: 'Account ID' })}</span>
                    <strong>{activeWeChatLogin.accountId ?? '-'}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Owner User ID', message: 'Owner User ID' })}</span>
                    <strong>{activeWeChatLogin.userId ?? '-'}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Bot Token', message: 'Bot Token' })}</span>
                    <strong>{activeWeChatLogin.botToken ? i18n._({ id: 'received', message: 'received' }) : '-'}</strong>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {editWeChatAccountTarget ? (
        <Modal
          footer={
            <>
              <Button intent="secondary" onClick={closeWeChatAccountEditModal} type="button">
                {i18n._({ id: 'Cancel', message: 'Cancel' })}
              </Button>
              <Button isLoading={updateWeChatAccountMutation.isPending} onClick={handleUpdateWeChatAccount} type="button">
                {i18n._({ id: 'Save Account Details', message: 'Save Account Details' })}
              </Button>
            </>
          }
          onClose={closeWeChatAccountEditModal}
          title={i18n._({ id: 'Edit Saved WeChat Account', message: 'Edit Saved WeChat Account' })}
        >
          <div className="form-stack">
            {updateWeChatAccountErrorMessage ? (
              <InlineNotice
                dismissible={false}
                noticeKey={`update-wechat-account-${updateWeChatAccountErrorMessage}`}
                title={i18n._({ id: 'Update Saved Account Failed', message: 'Update Saved Account Failed' })}
                tone="error"
              >
                {updateWeChatAccountErrorMessage}
              </InlineNotice>
            ) : null}

            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Account', message: 'Account' })}</span>
                <strong>{formatWeChatAccountLabel(editWeChatAccountTarget)}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Resolved Base URL', message: 'Resolved Base URL' })}</span>
                <strong>{editWeChatAccountTarget.baseUrl}</strong>
              </div>
            </div>

            <Input
              hint={i18n._({
                id: 'Optional. Use a short label that makes this WeChat account easier to find later.',
                message: 'Optional. Use a short label that makes this WeChat account easier to find later.',
              })}
              label={i18n._({ id: 'Alias', message: 'Alias' })}
              onChange={(event) => setWeChatAccountAliasDraft(event.target.value)}
              placeholder={i18n._({ id: 'Support Queue', message: 'Support Queue' })}
              value={wechatAccountAliasDraft}
            />

            <TextArea
              hint={i18n._({
                id: 'Optional. Add operational notes such as owner, queue purpose, or handoff details.',
                message: 'Optional. Add operational notes such as owner, queue purpose, or handoff details.',
              })}
              label={i18n._({ id: 'Notes', message: 'Notes' })}
              onChange={(event) => setWeChatAccountNoteDraft(event.target.value)}
              rows={5}
              value={wechatAccountNoteDraft}
            />
          </div>
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

      {deleteWeChatAccountTarget ? (
        <ConfirmDialog
          confirmLabel={i18n._({ id: 'Delete Saved Account', message: 'Delete Saved Account' })}
          description={i18n._({
            id: 'This only removes the saved WeChat account record for future reuse. Existing bot connections keep their own copied credentials.',
            message:
              'This only removes the saved WeChat account record for future reuse. Existing bot connections keep their own copied credentials.',
          })}
          error={deleteWeChatAccountErrorMessage}
          isPending={deleteWeChatAccountMutation.isPending}
          onClose={() => {
            if (!deleteWeChatAccountMutation.isPending) {
              setDeleteWeChatAccountTarget(null)
            }
          }}
          onConfirm={handleDeleteWeChatAccountConfirm}
          subject={formatWeChatAccountLabel(deleteWeChatAccountTarget)}
          title={i18n._({ id: 'Delete Saved WeChat Account', message: 'Delete Saved WeChat Account' })}
        />
      ) : null}

      {discardConnectionModalConfirmOpen ? (
        <ConfirmDialog
          cancelLabel={i18n._({ id: 'Keep Editing', message: 'Keep Editing' })}
          confirmLabel={i18n._({ id: 'Discard Changes', message: 'Discard Changes' })}
          description={
            isEditingConnection
              ? i18n._({
                  id: 'Close the editor and discard the unsaved bot connection changes.',
                  message: 'Close the editor and discard the unsaved bot connection changes.',
                })
              : i18n._({
                  id: 'Close the new bot connection form and discard the unsaved draft.',
                  message: 'Close the new bot connection form and discard the unsaved draft.',
                })
          }
          onClose={() => setDiscardConnectionModalConfirmOpen(false)}
          onConfirm={handleDiscardConnectionModalConfirm}
          subject={draft.name.trim() || editTarget?.name || i18n._({ id: 'Untitled Connection', message: 'Untitled Connection' })}
          title={
            isEditingConnection
              ? i18n._({ id: 'Discard Bot Connection Changes', message: 'Discard Bot Connection Changes' })
              : i18n._({ id: 'Discard New Connection Draft', message: 'Discard New Connection Draft' })
          }
        />
      ) : null}
    </section>
  )
}

function formatWeChatLoginStatus(status: string) {
  switch (status.trim().toLowerCase()) {
    case 'wait':
      return i18n._({ id: 'Waiting for scan', message: 'Waiting for scan' })
    case 'scaned':
      return i18n._({ id: 'Scanned', message: 'Scanned' })
    case 'confirmed':
      return i18n._({ id: 'Confirmed', message: 'Confirmed' })
    case 'expired':
      return i18n._({ id: 'Expired', message: 'Expired' })
    default:
      return status || i18n._({ id: 'Unknown', message: 'Unknown' })
  }
}

function serializeBotsPageDraft(draft: BotsPageDraft) {
  return JSON.stringify([
    draft.workspaceId,
    draft.provider,
    draft.name,
    draft.runtimeMode,
    draft.commandOutputMode,
    draft.telegramDeliveryMode,
    draft.publicBaseUrl,
    draft.wechatBaseUrl,
    draft.wechatRouteTag,
    draft.wechatChannelTimingEnabled,
    draft.wechatCredentialSource,
    draft.wechatSavedAccountId,
    draft.wechatLoginSessionId,
    draft.wechatLoginStatus,
    draft.wechatQrCodeContent,
    draft.aiBackend,
    draft.telegramBotToken,
    draft.wechatBotToken,
    draft.wechatAccountId,
    draft.wechatUserId,
    draft.workspaceModel,
    draft.workspaceReasoning,
    draft.workspaceCollaborationMode,
    draft.openAIApiKey,
    draft.openAIBaseUrl,
    draft.openAIModel,
    draft.openAIInstructions,
    draft.openAIReasoning,
    draft.openAIStore,
  ])
}
