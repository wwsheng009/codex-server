import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { toDataURL as toQRCodeDataURL } from 'qrcode'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

import { InlineNotice } from '../components/ui/InlineNotice'
import { BotsPageConnectionModal } from './BotsPageConnectionModal'
import { BotsPageConnectionSummarySection } from './BotsPageConnectionSummarySection'
import { BotsPageBotDetailsModal } from './BotsPageBotDetailsModal'
import { BotsPageDirectorySection } from './BotsPageDirectorySection'
import { BotsPageCreateBotModal } from './BotsPageCreateBotModal'
import { BotsPageFilterSummarySection } from './BotsPageFilterSummarySection'
import { BotsPageDialogs } from './BotsPageDialogs'
import { BotsPageHeader } from './BotsPageHeader'
import {
  clearBotConversationBinding,
  createBot,
  createBotConnection,
  createBotConnectionForBot,
  deleteBotDeliveryTarget,
  deleteWeChatAccount,
  deleteWeChatLogin,
  getWeChatLogin,
  deleteBotConnection,
  listBotConnectionLogsById,
  listBotBindings,
  listBotDeliveryTargets,
  listBotConnectionRecipientCandidates,
  listBotOutboundDeliveries,
  listAllBots,
  listAllBotConnections,
  listAllWeChatAccounts,
  listBotConversations,
  pauseBotConnection,
  replayBotConversationFailedReply,
  resumeBotConnection,
  sendBotDeliveryTargetOutboundMessages,
  sendBotSessionOutboundMessages,
  startWeChatLogin,
  upsertBotDeliveryTarget,
  updateBot,
  updateBotDeliveryTarget,
  updateBotConnection,
  updateBotConversationBinding,
  updateBotDefaultBinding,
  updateWeChatAccount,
  type CreateBotInput,
  type UpdateBotInput,
  type UpdateBotDefaultBindingInput,
  type CreateBotConnectionInput,
  type UpdateBotConversationBindingInput,
  type UpdateBotConnectionInput,
} from '../features/bots/api'
import { getThread, listThreadsPage } from '../features/threads/api'
import { listWorkspaces } from '../features/workspaces/api'
import { summarizeRecentBotConnectionSuppressions } from '../features/bots/logStreamUtils'
import { formatLocalizedNumber } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import { getBotOutboundErrorMessage, getErrorMessage } from '../lib/error-utils'
import {
  buildBotConnectionDetailRoute,
  buildBotConnectionLogsRoute,
  buildBotEndpointsRoute,
} from '../lib/bot-routes'
import {
  BOT_OUTBOUND_MEDIA_KIND_ORDER,
  BOT_OUTBOUND_MEDIA_SOURCE_ORDER,
  BOT_COMMAND_OUTPUT_MODE_BRIEF,
  BOT_COMMAND_OUTPUT_MODE_DETAILED,
  BOT_COMMAND_OUTPUT_MODE_FULL,
  BOT_COMMAND_OUTPUT_MODE_NONE,
  BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE,
  buildBotConnectionCreateInput,
  buildBotConnectionUpdateInput,
  buildBotsPageDraftFromConnection,
  collectBotOutboundMediaAdvisories,
  EMPTY_BOTS_PAGE_DRAFT,
  formatBotCommandOutputModeLabel,
  formatBotTimestamp,
  findWeChatAccountForConnection,
  isBotOutboundMediaKindSupported,
  isBotOutboundMediaSourceSupported,
  isBotWorkspacePermissionPresetFullAccess,
  listSupportedBotOutboundMediaKinds,
  listSupportedBotOutboundMediaSources,
  matchesBotConnectionSearch,
  planBotOutboundMediaDelivery,
  planBotOutboundTextPlacement,
  resolveFeishuDeliveryMode,
  validateBotOutboundMediaLocation,
  resolveBotCommandOutputMode,
  resolveBotBooleanSetting,
  resolveBotProvider,
  resolveBotConversationThreadTarget,
  type BotsPageDraft,
  type BotOutboundMediaKind,
  type BotOutboundMediaSource,
} from './botsPageUtils'
import type {
  Bot,
  BotBinding,
  BotConnection,
  BotConversation,
  BotRecipientCandidate,
  BotDeliveryTarget,
  BotMessageMedia,
  BotReplyMessage,
  Thread,
  WeChatAccount,
  WeChatLogin,
} from '../types/api'
import { useWorkspaceEventSubscription } from '../hooks/useWorkspaceStream'

function normalizeBotConversationDeliveryStatus(status?: string) {
  return status?.trim().toLowerCase() ?? ''
}

function formatWeChatLoginExpiresInLabel(expiresAt?: string, nowMs = Date.now()) {
  const expiresAtMs = Date.parse(expiresAt ?? '')
  if (Number.isNaN(expiresAtMs)) {
    return ''
  }

  const remainingMs = expiresAtMs - nowMs
  if (remainingMs <= 0) {
    return i18n._({
      id: 'Expired',
      message: 'Expired',
    })
  }
  if (remainingMs < 1_000) {
    return i18n._({
      id: 'soon',
      message: 'soon',
    })
  }

  const totalSeconds = Math.ceil(remainingMs / 1_000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (!minutes) {
    return i18n._({
      id: '{seconds} s',
      message: '{seconds} s',
      values: { seconds: formatLocalizedNumber(totalSeconds, '0') },
    })
  }

  const minutesLabel = i18n._({
    id: '{minutes} min',
    message: '{minutes} min',
    values: { minutes: formatLocalizedNumber(minutes, '0') },
  })

  if (!seconds) {
    return minutesLabel
  }

  const secondsLabel = i18n._({
    id: '{seconds} s',
    message: '{seconds} s',
    values: { seconds: formatLocalizedNumber(seconds, '0') },
  })

  return `${minutesLabel} ${secondsLabel}`
}

type BotsPageMode = 'config' | 'outbound' | 'endpoints'

type OutboundComposerMediaDraft = {
  id: string
  kind: BotOutboundMediaKind
  source: BotOutboundMediaSource
  location: string
  fileName: string
  contentType: string
}

function createOutboundComposerMediaDraft(
  kinds: BotOutboundMediaKind[],
  sources: BotOutboundMediaSource[],
): OutboundComposerMediaDraft {
  return {
    id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: kinds[0] ?? 'file',
    source: sources[0] ?? 'url',
    location: '',
    fileName: '',
    contentType: '',
  }
}

function hasOutboundComposerMediaDraftContent(draft: OutboundComposerMediaDraft) {
  return Boolean(draft.location.trim() || draft.fileName.trim() || draft.contentType.trim())
}

function toBotMessageMedia(draft: OutboundComposerMediaDraft): BotMessageMedia | null {
  const location = draft.location.trim()
  if (!location) {
    return null
  }

  return {
    kind: draft.kind,
    url: draft.source === 'url' ? location : undefined,
    path: draft.source === 'path' ? location : undefined,
    fileName: draft.fileName.trim() || undefined,
    contentType: draft.contentType.trim() || undefined,
  }
}

function formatOutboundComposerMediaKindLabel(kind: BotOutboundMediaKind) {
  switch (kind) {
    case 'image':
      return i18n._({ id: 'Image', message: 'Image' })
    case 'video':
      return i18n._({ id: 'Video', message: 'Video' })
    case 'voice':
      return i18n._({ id: 'Voice', message: 'Voice' })
    default:
      return i18n._({ id: 'File', message: 'File' })
  }
}

function formatOutboundComposerMediaSourceLabel(source: BotOutboundMediaSource) {
  switch (source) {
    case 'path':
      return i18n._({ id: 'Local Path', message: 'Local Path' })
    default:
      return i18n._({ id: 'Remote URL', message: 'Remote URL' })
  }
}

function truncateOutboundComposerPreviewValue(value?: string | null, maxLength = 88) {
  const trimmed = value?.trim() ?? ''
  if (!trimmed) {
    return ''
  }
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3).trimEnd()}...` : trimmed
}

function isBotDeliveryTargetReady(target: BotDeliveryTarget) {
  return (target.deliveryReadiness?.trim().toLowerCase() ?? 'ready') === 'ready'
}

function isBotRecipientCandidateReady(candidate: BotRecipientCandidate) {
  return (candidate.deliveryReadiness?.trim().toLowerCase() ?? 'ready') === 'ready'
}

type RouteTargetRecipientMode = 'existing' | 'manual'
type RouteTargetModalMode = 'create' | 'save_from_existing' | 'edit'

type KnownRouteTargetOption = {
  value: string
  label: string
  triggerLabel: string
  chatId: string
  threadId: string
}

function buildKnownRouteTargetOptionsFromCandidates(
  routeType: string,
  candidates: BotRecipientCandidate[],
): KnownRouteTargetOption[] {
  const normalizedRouteType = routeType.trim().toLowerCase()
  const seen = new Set<string>()
  const options: KnownRouteTargetOption[] = []

  for (const candidate of candidates) {
    if ((candidate.routeType?.trim().toLowerCase() ?? '') !== normalizedRouteType) {
      continue
    }
    if (!isBotRecipientCandidateReady(candidate)) {
      continue
    }

    const chatId = candidate.chatId?.trim() ?? ''
    const threadId = candidate.threadId?.trim() ?? ''
    const title = candidate.title?.trim() || chatId
    if (!chatId) {
      continue
    }

    if (normalizedRouteType === 'telegram_topic' || normalizedRouteType === 'feishu_thread') {
      if (!threadId) {
        continue
      }
      const value = `${normalizedRouteType}:${chatId}:${threadId}`
      if (seen.has(value)) {
        continue
      }
      seen.add(value)
      const detailLabel = `${chatId} / ${threadId}`
      options.push({
        value,
        label: title === detailLabel ? detailLabel : `${title} · ${detailLabel}`,
        triggerLabel: title,
        chatId,
        threadId,
      })
      continue
    }

    if (
      normalizedRouteType === 'telegram_chat' ||
      normalizedRouteType === 'wechat_session' ||
      normalizedRouteType === 'feishu_chat' ||
      normalizedRouteType === 'qqbot_group' ||
      normalizedRouteType === 'qqbot_c2c'
    ) {
      const value = `${normalizedRouteType}:${chatId}`
      if (seen.has(value)) {
        continue
      }
      seen.add(value)
      options.push({
        value,
        label: title === chatId ? chatId : `${title} · ${chatId}`,
        triggerLabel: title,
        chatId,
        threadId: '',
      })
    }
  }

  return options
}

function findKnownRouteTargetOption(
  options: KnownRouteTargetOption[],
  chatId: string,
  threadId = '',
): KnownRouteTargetOption | null {
  const normalizedChatId = chatId.trim()
  const normalizedThreadId = threadId.trim()
  return (
    options.find(
      (option) => option.chatId === normalizedChatId && option.threadId === normalizedThreadId,
    ) ?? null
  )
}

function splitCommaSeparatedValues(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

const BOT_THREAD_PICKER_PAGE_LIMIT = 100

type ThreadPickerOption = {
  value: string
  label: string
  triggerLabel?: string
  disabled?: boolean
}

function dedupeThreads(threads: Array<Thread | null | undefined>) {
  const next = new Map<string, Thread>()
  for (const thread of threads) {
    if (!thread?.id) {
      continue
    }
    next.set(`${thread.workspaceId}:${thread.id}`, thread)
  }
  return [...next.values()]
}

function findThreadByReference(threads: Thread[], workspaceId: string, threadId: string) {
  const resolvedWorkspaceId = workspaceId.trim()
  const resolvedThreadId = threadId.trim()
  return (
    threads.find((thread) => thread.workspaceId === resolvedWorkspaceId && thread.id === resolvedThreadId) ?? null
  )
}

function matchesThreadPickerSearch(thread: Thread, search: string) {
  const normalizedSearch = search.trim().toLowerCase()
  if (!normalizedSearch) {
    return true
  }
  return (
    thread.name.toLowerCase().includes(normalizedSearch) ||
    thread.id.toLowerCase().includes(normalizedSearch) ||
    (thread.archived ? 'archived' : 'active').includes(normalizedSearch)
  )
}

function formatThreadPickerOption(thread: Thread, marker?: string) {
  const metadata: string[] = []
  if (marker) {
    metadata.push(marker)
  }
  if (thread.archived) {
    metadata.push(i18n._({ id: 'Archived', message: 'Archived' }))
  }
  if (thread.turnCount) {
    metadata.push(
      i18n._({
        id: '{count} turns',
        message: '{count} turns',
        values: { count: thread.turnCount },
      }),
    )
  }
  metadata.push(formatBotTimestamp(thread.updatedAt))
  return {
    value: thread.id,
    label: [thread.name, thread.id, metadata.filter(Boolean).join(' | ')].filter(Boolean).join(' | '),
    triggerLabel: [thread.name, thread.id].filter(Boolean).join(' | '),
  }
}

function buildThreadPickerPlaceholderOption(): ThreadPickerOption {
  return {
    value: '',
    label: i18n._({ id: 'Select a thread', message: 'Select a thread' }),
    disabled: true,
  }
}

function buildPendingThreadPickerOption(threadId: string, marker: string): ThreadPickerOption {
  return {
    value: threadId,
    label: i18n._({
      id: '{threadId} | {marker} | Resolving thread details...',
      message: '{threadId} | {marker} | Resolving thread details...',
      values: { threadId, marker },
    }),
    triggerLabel: threadId,
    disabled: true,
  }
}

function buildPinnedThreadPickerOption(threadId: string, marker: string): ThreadPickerOption {
  return {
    value: threadId,
    label: [threadId, marker].filter(Boolean).join(' | '),
    triggerLabel: threadId,
  }
}

function buildBotsPageSelectionSearch({
  workspaceFilterId,
  selectedBotId,
  selectedConnectionId,
}: {
  workspaceFilterId: string
  selectedBotId: string
  selectedConnectionId: string
}) {
  const params = new URLSearchParams()
  if (workspaceFilterId.trim()) {
    params.set('workspaceId', workspaceFilterId.trim())
  }
  if (selectedBotId.trim()) {
    params.set('botId', selectedBotId.trim())
  }
  if (selectedConnectionId.trim()) {
    params.set('connectionId', selectedConnectionId.trim())
  }
  return params.toString()
}

function BotsPageScreen({ mode }: { mode: BotsPageMode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isConfigMode = mode === 'config'
  const isOutboundMode = mode === 'outbound'
  const isEndpointsMode = mode === 'endpoints'
  const routeSelection = useMemo(() => {
    const params = new URLSearchParams(location.search)
    return {
      workspaceFilterId: params.get('workspaceId')?.trim() ?? '',
      selectedBotId: params.get('botId')?.trim() ?? '',
      selectedConnectionId: params.get('connectionId')?.trim() ?? '',
    }
  }, [location.search])
  const [workspaceFilterId, setWorkspaceFilterId] = useState(routeSelection.workspaceFilterId)
  const [selectedBotId, setSelectedBotId] = useState(routeSelection.selectedBotId)
  const [selectedConnectionId, setSelectedConnectionId] = useState(routeSelection.selectedConnectionId)
  const selectionSyncOriginRef = useRef<'local' | 'route' | null>(null)
  const [createBotModalOpen, setCreateBotModalOpen] = useState(false)
  const [editingBot, setEditingBot] = useState<Bot | null>(null)
  const [createBotWorkspaceId, setCreateBotWorkspaceId] = useState('')
  const [createBotNameDraft, setCreateBotNameDraft] = useState('')
  const [createBotDescriptionDraft, setCreateBotDescriptionDraft] = useState('')
  const [createBotScopeDraft, setCreateBotScopeDraft] = useState<'workspace' | 'global'>('workspace')
  const [createBotSharingModeDraft, setCreateBotSharingModeDraft] = useState<
    'owner_only' | 'all_workspaces' | 'selected_workspaces'
  >('owner_only')
  const [createBotSharedWorkspaceIdsDraft, setCreateBotSharedWorkspaceIdsDraft] = useState<string[]>([])
  const [createBotFormError, setCreateBotFormError] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<BotConnection | null>(null)
  const [connectionModalBaselineDraft, setConnectionModalBaselineDraft] = useState<BotsPageDraft | null>(null)
  const [discardConnectionModalConfirmOpen, setDiscardConnectionModalConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<BotConnection | null>(null)
  const [deleteWeChatAccountTarget, setDeleteWeChatAccountTarget] = useState<WeChatAccount | null>(null)
  const [editWeChatAccountTarget, setEditWeChatAccountTarget] = useState<WeChatAccount | null>(null)
  const [botDetailsModalBotId, setBotDetailsModalBotId] = useState('')
  const [connectionOverviewModalOpen, setConnectionOverviewModalOpen] = useState(false)
  const [wechatAccountAliasDraft, setWeChatAccountAliasDraft] = useState('')
  const [wechatAccountNoteDraft, setWeChatAccountNoteDraft] = useState('')
  const [connectionSearch, setConnectionSearch] = useState('')
  const [showFullAccessConnectionsOnly, setShowFullAccessConnectionsOnly] = useState(false)
  const [draft, setDraft] = useState<BotsPageDraft>(EMPTY_BOTS_PAGE_DRAFT)
  const [formError, setFormError] = useState('')
  const [wechatLoginModalOpen, setWechatLoginModalOpen] = useState(false)
  const [wechatLoginId, setWechatLoginId] = useState('')
  const [wechatLoginQRCodeUrl, setWechatLoginQRCodeUrl] = useState('')
  const [wechatLoginCopyState, setWechatLoginCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [bindingTarget, setBindingTarget] = useState<BotConversation | null>(null)
  const [bindingMode, setBindingMode] = useState<'existing' | 'new'>('existing')
  const [bindingWorkspaceId, setBindingWorkspaceId] = useState('')
  const [bindingThreadId, setBindingThreadId] = useState('')
  const [bindingThreadSearch, setBindingThreadSearch] = useState('')
  const [bindingTitle, setBindingTitle] = useState('')
  const [defaultBindingModalOpen, setDefaultBindingModalOpen] = useState(false)
  const [defaultBindingMode, setDefaultBindingMode] = useState<'workspace_auto_thread' | 'fixed_thread'>(
    'workspace_auto_thread',
  )
  const [defaultBindingWorkspaceId, setDefaultBindingWorkspaceId] = useState('')
  const [defaultBindingThreadId, setDefaultBindingThreadId] = useState('')
  const [defaultBindingThreadSearch, setDefaultBindingThreadSearch] = useState('')
  const [editingRouteTarget, setEditingRouteTarget] = useState<BotDeliveryTarget | null>(null)
  const [deleteDeliveryTarget, setDeleteDeliveryTarget] = useState<BotDeliveryTarget | null>(null)
  const [routeTargetModalOpen, setRouteTargetModalOpen] = useState(false)
  const [routeTargetModalMode, setRouteTargetModalMode] = useState<RouteTargetModalMode>('create')
  const [routeTargetTitle, setRouteTargetTitle] = useState('')
  const [routeTargetRouteType, setRouteTargetRouteType] = useState('telegram_chat')
  const [routeTargetRecipientMode, setRouteTargetRecipientMode] = useState<RouteTargetRecipientMode>('manual')
  const [routeTargetSuggestedRecipientValue, setRouteTargetSuggestedRecipientValue] = useState('')
  const [routeTargetChatId, setRouteTargetChatId] = useState('')
  const [routeTargetThreadId, setRouteTargetThreadId] = useState('')
  const [routeTargetAdvancedOpen, setRouteTargetAdvancedOpen] = useState(false)
  const [routeTargetStatus, setRouteTargetStatus] = useState<'active' | 'paused'>('active')
  const [routeTargetLabelsDraft, setRouteTargetLabelsDraft] = useState('')
  const [routeTargetCapabilitiesDraft, setRouteTargetCapabilitiesDraft] = useState('')
  const [routeTargetProviderStateDraft, setRouteTargetProviderStateDraft] = useState('')
  const [routeTargetFormError, setRouteTargetFormError] = useState('')
  const [outboundComposerTarget, setOutboundComposerTarget] = useState<BotConversation | null>(null)
  const [outboundComposerDeliveryTarget, setOutboundComposerDeliveryTarget] = useState<BotDeliveryTarget | null>(null)
  const [outboundComposerText, setOutboundComposerText] = useState('')
  const [outboundComposerMediaDrafts, setOutboundComposerMediaDrafts] = useState<OutboundComposerMediaDraft[]>([])
  const [outboundComposerFormError, setOutboundComposerFormError] = useState('')

  function setSelectionState(
    next: Partial<{
      workspaceFilterId: string
      selectedBotId: string
      selectedConnectionId: string
    }>,
    origin: 'local' | 'route' = 'local',
  ) {
    selectionSyncOriginRef.current = origin
    if ('workspaceFilterId' in next) {
      setWorkspaceFilterId(next.workspaceFilterId ?? '')
    }
    if ('selectedBotId' in next) {
      setSelectedBotId(next.selectedBotId ?? '')
    }
    if ('selectedConnectionId' in next) {
      setSelectedConnectionId(next.selectedConnectionId ?? '')
    }
  }

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  const botsQuery = useQuery({
    queryKey: ['bots'],
    queryFn: listAllBots,
    refetchInterval: 5000,
  })

  const connectionsQuery = useQuery({
    queryKey: ['bot-connections'],
    queryFn: listAllBotConnections,
    refetchInterval: 5000,
  })

  useEffect(() => {
    if (!connectionsQuery.data || connectionsQuery.data.length > 0) {
      return
    }
    if (selectedConnectionId) {
      setSelectionState({
        selectedConnectionId: '',
      })
    }
  }, [connectionsQuery.data, selectedConnectionId])

  useEffect(() => {
    if (selectionSyncOriginRef.current === 'local') {
      return
    }
    if (
      routeSelection.workspaceFilterId === workspaceFilterId &&
      routeSelection.selectedBotId === selectedBotId &&
      routeSelection.selectedConnectionId === selectedConnectionId
    ) {
      return
    }
    setSelectionState(routeSelection, 'route')
  }, [
    routeSelection.workspaceFilterId,
    routeSelection.selectedBotId,
    routeSelection.selectedConnectionId,
    workspaceFilterId,
    selectedBotId,
    selectedConnectionId,
  ])

  useEffect(() => {
    if (selectionSyncOriginRef.current === 'route') {
      selectionSyncOriginRef.current = null
      return
    }
    const nextSearch = buildBotsPageSelectionSearch({
      workspaceFilterId,
      selectedBotId,
      selectedConnectionId,
    })
    const currentSearch = location.search.startsWith('?') ? location.search.slice(1) : location.search
    if (currentSearch === nextSearch) {
      selectionSyncOriginRef.current = null
      return
    }
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : '',
      },
      { replace: true },
    )
    selectionSyncOriginRef.current = null
  }, [location.pathname, location.search, navigate, selectedBotId, selectedConnectionId, workspaceFilterId])

  const bots = botsQuery.data ?? []
  const connections = connectionsQuery.data ?? []
  const selectedBot: Bot | null = bots.find((bot) => bot.id === selectedBotId) ?? null
  const selectedBotFilterId = selectedBotId.trim()
  const selectedBotWorkspaceId = selectedBot?.workspaceId?.trim() ?? ''
  const selectedBotConnections = connections.filter((connection) => connection.botId === selectedBotId)
  const selectedConnection =
    selectedBotConnections.find((connection) => connection.id === selectedConnectionId) ?? selectedBotConnections[0] ?? null
  const selectedConnectionWorkspaceId = selectedConnection?.workspaceId?.trim() ?? selectedBotWorkspaceId
  const selectedProvider = resolveBotProvider(selectedConnection?.provider)
  const outboundComposerCapabilities = selectedConnection?.capabilities ?? []
  const outboundComposerSupportedMediaKinds = useMemo(
    () => listSupportedBotOutboundMediaKinds(outboundComposerCapabilities),
    [outboundComposerCapabilities],
  )
  const outboundComposerSupportedMediaSources = useMemo(
    () => listSupportedBotOutboundMediaSources(outboundComposerCapabilities),
    [outboundComposerCapabilities],
  )
  const outboundComposerMediaKindOptions = useMemo(
    () =>
      BOT_OUTBOUND_MEDIA_KIND_ORDER.map((kind) => ({
        value: kind,
        label: formatOutboundComposerMediaKindLabel(kind),
        disabled: !isBotOutboundMediaKindSupported(outboundComposerCapabilities, kind),
      })),
    [outboundComposerCapabilities],
  )
  const outboundComposerMediaSourceOptions = useMemo(
    () =>
      BOT_OUTBOUND_MEDIA_SOURCE_ORDER.map((source) => ({
        value: source,
        label: formatOutboundComposerMediaSourceLabel(source),
        disabled: !isBotOutboundMediaSourceSupported(outboundComposerCapabilities, source),
      })),
    [outboundComposerCapabilities],
  )
  const outboundComposerMedia = useMemo(
    () => outboundComposerMediaDrafts.map((draft) => toBotMessageMedia(draft)).filter(Boolean) as BotMessageMedia[],
    [outboundComposerMediaDrafts],
  )
  const outboundComposerMediaAdvisories = useMemo(
    () =>
      new Map(
        outboundComposerMediaDrafts.map((draft) => [
          draft.id,
          collectBotOutboundMediaAdvisories({
            kind: draft.kind,
            location: draft.location,
            fileName: draft.fileName,
            contentType: draft.contentType,
          }),
        ]),
      ),
    [outboundComposerMediaDrafts],
  )
  const outboundComposerMediaCapabilityIssues = useMemo(
    () =>
      new Map(
        outboundComposerMediaDrafts.map((draft) => [
          draft.id,
          {
            kindUnsupported: !isBotOutboundMediaKindSupported(outboundComposerCapabilities, draft.kind),
            sourceUnsupported: !isBotOutboundMediaSourceSupported(outboundComposerCapabilities, draft.source),
          },
        ]),
      ),
    [outboundComposerCapabilities, outboundComposerMediaDrafts],
  )
  const outboundComposerMediaLocationIssues = useMemo(
    () =>
      new Map(
        outboundComposerMediaDrafts.map((draft) => [draft.id, validateBotOutboundMediaLocation(draft.source, draft.location)]),
      ),
    [outboundComposerMediaDrafts],
  )
  const hasIncompleteOutboundComposerMediaDrafts = outboundComposerMediaDrafts.some(
    (draft) => !draft.location.trim() && hasOutboundComposerMediaDraftContent(draft),
  )
  const hasInvalidOutboundComposerMediaDrafts = outboundComposerMediaDrafts.some((draft) => {
    const issue = outboundComposerMediaLocationIssues.get(draft.id) ?? ''
    return Boolean(issue)
  })
  const hasUnsupportedOutboundComposerMediaDrafts = outboundComposerMediaDrafts.some((draft) => {
    const capabilityIssue = outboundComposerMediaCapabilityIssues.get(draft.id)
    return Boolean(capabilityIssue?.kindUnsupported || capabilityIssue?.sourceUnsupported)
  })
  const outboundComposerMediaDeliveryPlan = useMemo(
    () => planBotOutboundMediaDelivery(outboundComposerCapabilities, outboundComposerMedia),
    [outboundComposerCapabilities, outboundComposerMedia],
  )
  const conversationsQuery = useQuery({
    queryKey: ['bot-conversations', selectedConnectionWorkspaceId, selectedConnectionId],
    queryFn: () => listBotConversations(selectedConnectionWorkspaceId, selectedConnectionId),
    enabled: selectedConnectionWorkspaceId.length > 0 && selectedConnectionId.length > 0,
  })

  const recipientCandidatesQuery = useQuery({
    queryKey: ['bot-recipient-candidates', selectedConnectionWorkspaceId, selectedConnectionId],
    queryFn: () => listBotConnectionRecipientCandidates(selectedConnectionWorkspaceId, selectedConnectionId),
    enabled: selectedConnectionWorkspaceId.length > 0 && selectedConnectionId.length > 0,
    staleTime: 5_000,
  })

  const botBindingsQuery = useQuery({
    queryKey: ['bot-bindings', selectedBotWorkspaceId, selectedBotId],
    queryFn: () => listBotBindings(selectedBotWorkspaceId, selectedBotId),
    enabled: selectedBotWorkspaceId.length > 0 && selectedBotId.length > 0,
    refetchInterval: 15000,
    staleTime: 5000,
  })

  const botDeliveryTargetsQuery = useQuery({
    queryKey: ['bot-delivery-targets', selectedBotWorkspaceId, selectedBotId],
    queryFn: () => listBotDeliveryTargets(selectedBotWorkspaceId, selectedBotId),
    enabled: selectedBotWorkspaceId.length > 0 && selectedBotId.length > 0,
    staleTime: 5_000,
  })

  const botOutboundDeliveriesQuery = useQuery({
    queryKey: ['bot-outbound-deliveries', selectedBotWorkspaceId, selectedBotId],
    queryFn: () => listBotOutboundDeliveries(selectedBotWorkspaceId, selectedBotId),
    enabled: selectedBotWorkspaceId.length > 0 && selectedBotId.length > 0,
    staleTime: 5_000,
  })

  const conversations = conversationsQuery.data ?? []
  const recipientCandidates = recipientCandidatesQuery.data ?? []
  const selectedBotBindings = botBindingsQuery.data ?? []
  const botDeliveryTargets = botDeliveryTargetsQuery.data ?? []
  const botOutboundDeliveries = botOutboundDeliveriesQuery.data ?? []
  const selectedDefaultBinding: BotBinding | null =
    selectedBotBindings.find((binding) => binding.isDefault) ?? null
  const bindingCurrentTarget = bindingTarget
    ? resolveBotConversationThreadTarget(bindingTarget)
    : { workspaceId: '', threadId: '' }
  const bindingCurrentWorkspaceId = bindingCurrentTarget.workspaceId.trim()
  const bindingCurrentThreadId = bindingCurrentTarget.threadId.trim()
  const defaultBindingCurrentWorkspaceId =
    selectedDefaultBinding?.targetWorkspaceId?.trim() ??
    selectedBot?.defaultTargetWorkspaceId?.trim() ??
    selectedBot?.workspaceId ??
    ''
  const defaultBindingCurrentThreadId =
    selectedDefaultBinding?.targetThreadId?.trim() ?? selectedBot?.defaultTargetThreadId?.trim() ?? ''
  const bindingPickerWorkspaceId = bindingWorkspaceId.trim()
  const defaultBindingPickerWorkspaceId = defaultBindingWorkspaceId.trim()
  const threadPickerWorkspaceId = bindingTarget
    ? bindingPickerWorkspaceId
    : defaultBindingModalOpen && defaultBindingMode === 'fixed_thread'
      ? defaultBindingPickerWorkspaceId
      : ''
  const shouldLoadActiveThreads =
    threadPickerWorkspaceId.length > 0 &&
    selectedBotId.length > 0 &&
    (bindingTarget !== null || (defaultBindingModalOpen && defaultBindingMode === 'fixed_thread')) &&
    (defaultBindingModalOpen || selectedConnection?.aiBackend === 'workspace_thread')

  const activeThreadsQuery = useInfiniteQuery({
    queryKey: ['bot-binding-threads', threadPickerWorkspaceId, { archived: false, sortKey: 'updated_at' }],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      listThreadsPage(threadPickerWorkspaceId, {
        archived: false,
        cursor: typeof pageParam === 'string' && pageParam.trim() ? pageParam : undefined,
        limit: BOT_THREAD_PICKER_PAGE_LIMIT,
        preferCached: true,
        sortKey: 'updated_at',
      }),
    getNextPageParam: (lastPage) => {
      const nextCursor = lastPage.nextCursor?.trim()
      return nextCursor ? nextCursor : undefined
    },
    enabled: shouldLoadActiveThreads,
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const loadedActiveThreads = dedupeThreads(activeThreadsQuery.data?.pages.flatMap((page) => page.data) ?? []).filter(
    (thread) => !thread.archived,
  )
  const loadedActiveThreadKeys = new Set(loadedActiveThreads.map((thread) => `${thread.workspaceId}:${thread.id}`))
  const bindingCurrentThreadKey =
    bindingCurrentWorkspaceId && bindingCurrentThreadId ? `${bindingCurrentWorkspaceId}:${bindingCurrentThreadId}` : ''
  const defaultBindingCurrentThreadKey =
    defaultBindingCurrentWorkspaceId && defaultBindingCurrentThreadId
      ? `${defaultBindingCurrentWorkspaceId}:${defaultBindingCurrentThreadId}`
      : ''
  const isBindingPickerOnCurrentWorkspace =
    bindingPickerWorkspaceId.length > 0 && bindingPickerWorkspaceId === bindingCurrentWorkspaceId
  const isDefaultBindingPickerOnCurrentWorkspace =
    defaultBindingPickerWorkspaceId.length > 0 && defaultBindingPickerWorkspaceId === defaultBindingCurrentWorkspaceId

  const currentBindingThreadQuery = useQuery({
    queryKey: ['bot-binding-thread-detail', bindingCurrentWorkspaceId, bindingCurrentThreadId],
    queryFn: () => getThread(bindingCurrentWorkspaceId, bindingCurrentThreadId, { contentMode: 'summary', turnLimit: 1 }),
    enabled:
      bindingTarget !== null &&
      bindingCurrentWorkspaceId.length > 0 &&
      bindingCurrentThreadId.length > 0 &&
      !loadedActiveThreadKeys.has(bindingCurrentThreadKey),
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  })

  const currentDefaultBindingThreadQuery = useQuery({
    queryKey: ['bot-default-binding-thread-detail', defaultBindingCurrentWorkspaceId, defaultBindingCurrentThreadId],
    queryFn: () =>
      getThread(defaultBindingCurrentWorkspaceId, defaultBindingCurrentThreadId, { contentMode: 'summary', turnLimit: 1 }),
    enabled:
      defaultBindingModalOpen &&
      defaultBindingMode === 'fixed_thread' &&
      defaultBindingCurrentWorkspaceId.length > 0 &&
      defaultBindingCurrentThreadId.length > 0 &&
      !loadedActiveThreadKeys.has(defaultBindingCurrentThreadKey),
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
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

  const wechatAccountsQuery = useQuery({
    queryKey: ['wechat-accounts'],
    queryFn: listAllWeChatAccounts,
    refetchInterval: 10000,
  })

  const workspaces = workspacesQuery.data ?? []

  useWorkspaceEventSubscription(
    workspaces.length > 0 ? workspaces.map((workspace) => workspace.id) : undefined,
    (event) => {
      const method = event.method.trim().toLowerCase()
      if (!method.startsWith('bot/')) {
        return
      }

      void queryClient.invalidateQueries({ queryKey: ['bots'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-connections'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-conversations'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-bindings'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-triggers'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-outbound-deliveries'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-connection-logs-summary'] })
      void queryClient.invalidateQueries({ queryKey: ['wechat-accounts'] })
      void queryClient.invalidateQueries({ queryKey: ['bot-binding-threads'] })
    },
  )

  const createMutation = useMutation({
    mutationFn: ({
      botId,
      workspaceId,
      input,
    }: {
      botId?: string
      workspaceId: string
      input: CreateBotConnectionInput
    }) =>
      botId?.trim()
        ? createBotConnectionForBot(workspaceId, botId.trim(), input)
        : createBotConnection(workspaceId, input),
    onSuccess: async (connection) => {
      setCreateModalOpen(false)
      setEditTarget(null)
      setConnectionModalBaselineDraft(null)
      setDiscardConnectionModalConfirmOpen(false)
      resetWeChatLoginState()
      setDraft(EMPTY_BOTS_PAGE_DRAFT)
      setFormError('')
      setSelectionState({
        workspaceFilterId: connection.workspaceId,
        selectedBotId: connection.botId ?? '',
        selectedConnectionId: connection.id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bots'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
      ])
    },
  })

  const createBotMutation = useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: CreateBotInput }) =>
      createBot(workspaceId, input),
    onSuccess: async (bot) => {
      setCreateBotModalOpen(false)
      setEditingBot(null)
      setCreateBotWorkspaceId('')
      setCreateBotNameDraft('')
      setCreateBotDescriptionDraft('')
      setCreateBotScopeDraft('workspace')
      setCreateBotSharingModeDraft('owner_only')
      setCreateBotSharedWorkspaceIdsDraft([])
      setCreateBotFormError('')
      setSelectionState({
        workspaceFilterId: bot.workspaceId,
        selectedBotId: bot.id,
        selectedConnectionId: '',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bots'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
      ])
    },
  })

  const updateBotMutation = useMutation({
    mutationFn: ({ workspaceId, botId, input }: { workspaceId: string; botId: string; input: UpdateBotInput }) =>
      updateBot(workspaceId, botId, input),
    onSuccess: async (bot) => {
      setCreateBotModalOpen(false)
      setEditingBot(null)
      setCreateBotWorkspaceId('')
      setCreateBotNameDraft('')
      setCreateBotDescriptionDraft('')
      setCreateBotScopeDraft('workspace')
      setCreateBotSharingModeDraft('owner_only')
      setCreateBotSharedWorkspaceIdsDraft([])
      setCreateBotFormError('')
      setSelectionState({
        workspaceFilterId: bot.workspaceId,
        selectedBotId: bot.id,
        selectedConnectionId: '',
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bots'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
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
      setSelectionState({
        workspaceFilterId: connection.workspaceId,
        selectedBotId: connection.botId ?? '',
        selectedConnectionId: connection.id,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bots'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
      ])
    },
  })

  const wechatLoginStartMutation = useMutation({
    mutationFn: ({ workspaceId, baseUrl }: { workspaceId: string; baseUrl: string }) =>
      startWeChatLogin(workspaceId, { baseUrl }),
    onSuccess: (result) => {
      if (wechatLoginRefreshReasonRef.current === 'auto-expired') {
        setWechatLoginAutoRefreshNoticeKey(`auto-refreshed-${result.loginId}`)
      }
      setWechatLoginId(result.loginId)
      setWechatLoginCopyState('idle')
    },
    onSettled: () => {
      setWechatLoginAutoRefreshPending(false)
      wechatLoginRefreshReasonRef.current = 'manual'
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
    onSuccess: async (_, variables) => {
      const nextInvalidations = [
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({
          queryKey: ['bot-conversations', variables.workspaceId, variables.connection.id],
        }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs', variables.connection.id] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs-summary', variables.connection.id] }),
      ]

      const botId = variables.connection.botId?.trim() ?? ''
      if (botId) {
        nextInvalidations.push(
          queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, botId] }),
        )
      }

      await Promise.all(nextInvalidations)
    },
  })

  const replayFailedReplyMutation = useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      conversationId,
    }: {
      workspaceId: string
      connectionId: string
      conversationId: string
    }) => replayBotConversationFailedReply(workspaceId, connectionId, conversationId),
    onSuccess: async (_, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations', variables.workspaceId, variables.connectionId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates', variables.workspaceId, variables.connectionId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs', variables.connectionId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs-summary', variables.connectionId] }),
      ])
    },
  })

  const sendSessionOutboundMessageMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      sessionId,
      input,
    }: {
      workspaceId: string
      botId: string
      sessionId: string
      input: { messages: BotReplyMessage[]; originWorkspaceId?: string; originThreadId?: string }
    }) =>
      sendBotSessionOutboundMessages(workspaceId, botId, sessionId, {
        sourceType: 'manual',
        sourceRefType: 'conversation',
        sourceRefId: sessionId,
        idempotencyKey: `manual-${Date.now()}`,
        messages: input.messages,
        originWorkspaceId: input.originWorkspaceId,
        originThreadId: input.originThreadId,
      }),
    onSuccess: () => {
      closeOutboundComposer(true)
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-outbound-deliveries', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs-summary'] }),
      ])
    },
  })

  const sendDeliveryTargetOutboundMessageMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      targetId,
      input,
    }: {
      workspaceId: string
      botId: string
      targetId: string
      input: { messages: BotReplyMessage[]; originWorkspaceId?: string; originThreadId?: string }
    }) =>
      sendBotDeliveryTargetOutboundMessages(workspaceId, botId, targetId, {
        sourceType: 'manual',
        sourceRefType: 'delivery_target',
        sourceRefId: targetId,
        idempotencyKey: `manual-target-${Date.now()}`,
        messages: input.messages,
        originWorkspaceId: input.originWorkspaceId,
        originThreadId: input.originThreadId,
      }),
    onSuccess: (_data, _variables) => {
      closeOutboundComposer(true)
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-outbound-deliveries', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connection-logs-summary'] }),
      ])
    },
  })

  const upsertDeliveryTargetMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      endpointId,
      routeType,
      routeKey,
      title,
      status,
      labels,
      capabilities,
      providerState,
    }: {
      workspaceId: string
      botId: string
      endpointId: string
      routeType: string
      routeKey: string
      title?: string
      status: string
      labels?: string[]
      capabilities?: string[]
      providerState?: Record<string, string>
    }) =>
      upsertBotDeliveryTarget(workspaceId, botId, {
        endpointId,
        targetType: 'route_backed',
        routeType,
        routeKey,
        title,
        status,
        labels,
        capabilities,
        providerState,
      }),
    onSuccess: async (_, variables) => {
      closeRouteTargetModal(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
      ])
    },
  })

  const updateDeliveryTargetMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      targetId,
      routeType,
      routeKey,
      title,
      status,
      labels,
      capabilities,
      providerState,
    }: {
      workspaceId: string
      botId: string
      targetId: string
      routeType: string
      routeKey: string
      title?: string
      status: string
      labels?: string[]
      capabilities?: string[]
      providerState?: Record<string, string>
    }) =>
      updateBotDeliveryTarget(workspaceId, botId, targetId, {
        targetType: 'route_backed',
        routeType,
        routeKey,
        title,
        status,
        labels,
        capabilities,
        providerState,
      }),
    onSuccess: async (_, variables) => {
      closeRouteTargetModal(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
      ])
    },
  })

  const deleteDeliveryTargetMutation = useMutation({
    mutationFn: ({ workspaceId, botId, targetId }: { workspaceId: string; botId: string; targetId: string }) =>
      deleteBotDeliveryTarget(workspaceId, botId, targetId),
    onSuccess: async (_, variables) => {
      if (outboundComposerDeliveryTarget?.id === variables.targetId) {
        closeOutboundComposer(true)
      }
      if (editingRouteTarget?.id === variables.targetId) {
        closeRouteTargetModal(true)
      }
      setDeleteDeliveryTarget(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-triggers', variables.workspaceId, variables.botId] }),
      ])
    },
  })

  const updateConversationBindingMutation = useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      conversationId,
      input,
    }: {
      workspaceId: string
      connectionId: string
      conversationId: string
      input: UpdateBotConversationBindingInput
    }) => updateBotConversationBinding(workspaceId, connectionId, conversationId, input),
    onSuccess: async (_, variables) => {
      resetBindingModalState()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-conversations', variables.workspaceId, variables.connectionId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates', variables.workspaceId, variables.connectionId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-binding-threads'] }),
      ])
    },
  })

  const clearConversationBindingMutation = useMutation({
    mutationFn: ({
      workspaceId,
      connectionId,
      conversationId,
    }: {
      workspaceId: string
      connectionId: string
      conversationId: string
    }) => clearBotConversationBinding(workspaceId, connectionId, conversationId),
    onSuccess: async (_, variables) => {
      resetBindingModalState()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-conversations', variables.workspaceId, variables.connectionId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates', variables.workspaceId, variables.connectionId] }),
      ])
    },
  })

  const updateBotDefaultBindingMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      input,
    }: {
      workspaceId: string
      botId: string
      input: UpdateBotDefaultBindingInput
    }) => updateBotDefaultBinding(workspaceId, botId, input),
    onSuccess: async (_, variables) => {
      closeDefaultBindingModal()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bots'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-bindings', variables.workspaceId, variables.botId] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-binding-threads'] }),
      ])
    },
  })

  const deleteMutation = useMutation({
    mutationFn: ({ workspaceId, connectionId }: { workspaceId: string; connectionId: string }) =>
      deleteBotConnection(workspaceId, connectionId),
    onSuccess: async (_, variables) => {
      setDeleteTarget(null)
      if (selectedConnectionId === variables.connectionId) {
        setSelectionState({ selectedConnectionId: '' })
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bots'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-recipient-candidates'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-triggers'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-outbound-deliveries'] }),
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
      await queryClient.invalidateQueries({ queryKey: ['wechat-accounts'] })
    },
  })

  const updateWeChatAccountMutation = useMutation({
    mutationFn: ({ workspaceId, accountId, alias, note }: { workspaceId: string; accountId: string; alias: string; note: string }) =>
      updateWeChatAccount(workspaceId, accountId, { alias, note }),
    onSuccess: async (account) => {
      setEditWeChatAccountTarget(null)
      setWeChatAccountAliasDraft(account.alias ?? '')
      setWeChatAccountNoteDraft(account.note ?? '')
      await queryClient.invalidateQueries({ queryKey: ['wechat-accounts'] })
    },
  })

  const connectionLogQueries = useQueries({
    queries: connections.map((connection) => ({
      queryKey: ['bot-connection-logs-summary', connection.id],
      queryFn: () => listBotConnectionLogsById(connection.id),
      enabled: connection.id.length > 0,
      refetchInterval: 15000,
      staleTime: 5000,
    })),
  })
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
  )
  const botById = useMemo(
    () => new Map(bots.map((bot) => [bot.id, bot])),
    [bots],
  )
  const createBotShareableWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.id !== createBotWorkspaceId),
    [createBotWorkspaceId, workspaces],
  )
  const selectedWorkspaceFilter = workspaceById.get(workspaceFilterId) ?? null
  const connectionsByBotId = useMemo(() => {
    const next = new Map<string, BotConnection[]>()
    for (const connection of connections) {
      const botId = connection.botId?.trim()
      if (!botId) {
        continue
      }
      const bucket = next.get(botId) ?? []
      bucket.push(connection)
      next.set(botId, bucket)
    }
    return next
  }, [connections])
  const selectedConnectionDeliveryTargets = selectedConnection
    ? botDeliveryTargets.filter((target) => target.endpointId === selectedConnection.id)
    : []
  const selectedConnectionOutboundDeliveries = selectedConnection
    ? botOutboundDeliveries.filter((delivery) => delivery.endpointId === selectedConnection.id)
    : []
  const deliveryTargetByConversationId = useMemo(
    () =>
      new Map(
        selectedConnectionDeliveryTargets
          .filter((target) => target.targetType === 'session_backed' && (target.sessionId?.trim() ?? '') !== '')
          .map((target) => [target.sessionId?.trim() ?? '', target] as const),
      ),
    [selectedConnectionDeliveryTargets],
  )
  const activeThreads = loadedActiveThreads
  const isActiveThreadsInitialLoading = activeThreadsQuery.isPending && activeThreads.length === 0
  const canLoadMoreActiveThreads = Boolean(activeThreadsQuery.hasNextPage)
  const resolvedCurrentBindingThread =
    findThreadByReference(loadedActiveThreads, bindingCurrentWorkspaceId, bindingCurrentThreadId) ??
    currentBindingThreadQuery.data ??
    null
  const resolvedCurrentDefaultBindingThread =
    findThreadByReference(loadedActiveThreads, defaultBindingCurrentWorkspaceId, defaultBindingCurrentThreadId) ??
    currentDefaultBindingThreadQuery.data ??
    null
  const bindingSelectedThread =
    findThreadByReference(loadedActiveThreads, bindingPickerWorkspaceId, bindingThreadId.trim()) ??
    (isBindingPickerOnCurrentWorkspace && bindingThreadId.trim() === bindingCurrentThreadId
      ? resolvedCurrentBindingThread
      : null)
  const defaultBindingSelectedThread =
    findThreadByReference(loadedActiveThreads, defaultBindingPickerWorkspaceId, defaultBindingThreadId.trim()) ??
    (isDefaultBindingPickerOnCurrentWorkspace && defaultBindingThreadId.trim() === defaultBindingCurrentThreadId
      ? resolvedCurrentDefaultBindingThread
      : null)
  const bindingVisibleThreads = useMemo(
    () =>
      dedupeThreads([
        bindingSelectedThread,
        isBindingPickerOnCurrentWorkspace ? resolvedCurrentBindingThread : null,
        ...loadedActiveThreads.filter((thread) => matchesThreadPickerSearch(thread, bindingThreadSearch)),
      ]),
    [
      bindingSelectedThread,
      bindingThreadSearch,
      isBindingPickerOnCurrentWorkspace,
      loadedActiveThreads,
      resolvedCurrentBindingThread,
    ],
  )
  const defaultBindingVisibleThreads = useMemo(
    () =>
      dedupeThreads([
        defaultBindingSelectedThread,
        isDefaultBindingPickerOnCurrentWorkspace ? resolvedCurrentDefaultBindingThread : null,
        ...loadedActiveThreads.filter((thread) => matchesThreadPickerSearch(thread, defaultBindingThreadSearch)),
      ]),
    [
      defaultBindingSelectedThread,
      defaultBindingThreadSearch,
      isDefaultBindingPickerOnCurrentWorkspace,
      loadedActiveThreads,
      resolvedCurrentDefaultBindingThread,
    ],
  )
  const isResolvingCurrentBindingThread =
    bindingMode === 'existing' &&
    bindingCurrentThreadId.length > 0 &&
    isBindingPickerOnCurrentWorkspace &&
    resolvedCurrentBindingThread === null &&
    currentBindingThreadQuery.isPending
  const isResolvingCurrentDefaultBindingThread =
    defaultBindingMode === 'fixed_thread' &&
    defaultBindingCurrentThreadId.length > 0 &&
    isDefaultBindingPickerOnCurrentWorkspace &&
    resolvedCurrentDefaultBindingThread === null &&
    currentDefaultBindingThreadQuery.isPending

  useEffect(() => {
    if (!selectedConnection) {
      setConnectionOverviewModalOpen(false)
    }
  }, [selectedConnection])

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
        value: 'feishu',
        label: i18n._({ id: 'Feishu', message: 'Feishu' }),
      },
      {
        value: 'qqbot',
        label: i18n._({ id: 'QQ Bot', message: 'QQ Bot' }),
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

  const feishuDeliveryModeOptions = useMemo(
    () => [
      {
        value: 'websocket',
        label: i18n._({ id: 'WebSocket', message: 'WebSocket' }),
      },
      {
        value: 'webhook',
        label: i18n._({ id: 'Webhook', message: 'Webhook' }),
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

  const reasoningOptions = useMemo(
    () => [
      { value: 'low', label: i18n._({ id: 'Low', message: 'Low' }) },
      { value: 'medium', label: i18n._({ id: 'Medium', message: 'Medium' }) },
      { value: 'high', label: i18n._({ id: 'High', message: 'High' }) },
      { value: 'xhigh', label: i18n._({ id: 'Extra High', message: 'Extra High' }) },
    ],
    [],
  )

  const permissionPresetOptions = useMemo(
    () => [
      {
        value: 'default',
        label: i18n._({ id: 'Default permission', message: 'Default permission' }),
      },
      {
        value: 'full-access',
        label: i18n._({ id: 'Full access', message: 'Full access' }),
      },
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

  const bindingModeOptions = useMemo(
    () => [
      { value: 'existing', label: i18n._({ id: 'Use Existing Thread', message: 'Use Existing Thread' }) },
      { value: 'new', label: i18n._({ id: 'Create New Thread', message: 'Create New Thread' }) },
    ],
    [],
  )

  const routeTargetRouteTypeOptions = useMemo(() => {
    if (selectedProvider === 'telegram') {
      return [
        {
          value: 'telegram_chat',
          label: i18n._({ id: 'Telegram Chat', message: 'Telegram Chat' }),
        },
        {
          value: 'telegram_topic',
          label: i18n._({ id: 'Telegram Topic', message: 'Telegram Topic' }),
        },
      ]
    }
    if (selectedProvider === 'wechat') {
      return [
        {
          value: 'wechat_session',
          label: i18n._({ id: 'WeChat Recipient', message: 'WeChat Recipient' }),
        },
      ]
    }
    if (selectedProvider === 'feishu') {
      return [
        {
          value: 'feishu_chat',
          label: i18n._({ id: 'Feishu Chat', message: 'Feishu Chat' }),
        },
        {
          value: 'feishu_thread',
          label: i18n._({ id: 'Feishu Thread', message: 'Feishu Thread' }),
        },
      ]
    }
    if (selectedProvider === 'qqbot') {
      return [
        {
          value: 'qqbot_group',
          label: i18n._({ id: 'QQ Bot Group', message: 'QQ Bot Group' }),
        },
        {
          value: 'qqbot_c2c',
          label: i18n._({ id: 'QQ Bot Direct Message', message: 'QQ Bot Direct Message' }),
        },
      ]
    }
    return []
  }, [selectedProvider])

  const routeTargetStatusOptions = useMemo(
    () => [
      {
        value: 'active',
        label: i18n._({ id: 'Active', message: 'Active' }),
      },
      {
        value: 'paused',
        label: i18n._({ id: 'Paused', message: 'Paused' }),
      },
    ],
    [],
  )
  const knownRouteTargetOptions = useMemo(
    () => buildKnownRouteTargetOptionsFromCandidates(routeTargetRouteType, recipientCandidates),
    [recipientCandidates, routeTargetRouteType],
  )
  const knownRouteTargetSelectOptions = useMemo(
    () => [
      {
        value: '',
        label: i18n._({ id: 'Select an available recipient', message: 'Select an available recipient' }),
        triggerLabel: i18n._({ id: 'Select recipient', message: 'Select recipient' }),
        disabled: true,
      },
      ...knownRouteTargetOptions,
    ],
    [knownRouteTargetOptions],
  )
  const selectedKnownRouteTargetOption =
    knownRouteTargetOptions.find((option) => option.value === routeTargetSuggestedRecipientValue) ?? null

  const bindingThreadOptions = useMemo(() => {
    const currentBindingMarker = i18n._({ id: 'Current binding', message: 'Current binding' })
    const options: ThreadPickerOption[] = [buildThreadPickerPlaceholderOption()]
    const selectedThreadId = bindingThreadId.trim()
    const selectedIsCurrentBinding = isBindingPickerOnCurrentWorkspace && selectedThreadId === bindingCurrentThreadId

    if (selectedThreadId && !bindingVisibleThreads.some((thread) => thread.id === selectedThreadId)) {
      options.push(
        isResolvingCurrentBindingThread && selectedIsCurrentBinding
          ? buildPendingThreadPickerOption(selectedThreadId, currentBindingMarker)
          : buildPinnedThreadPickerOption(selectedThreadId, selectedIsCurrentBinding ? currentBindingMarker : ''),
      )
    }

    for (const thread of bindingVisibleThreads) {
      options.push(
        formatThreadPickerOption(
          thread,
          isBindingPickerOnCurrentWorkspace && thread.id === bindingCurrentThreadId ? currentBindingMarker : undefined,
        ),
      )
    }

    return options
  }, [
    bindingCurrentThreadId,
    bindingThreadId,
    bindingVisibleThreads,
    isBindingPickerOnCurrentWorkspace,
    isResolvingCurrentBindingThread,
  ])

  const defaultBindingModeOptions = useMemo(
    () => [
      {
        value: 'workspace_auto_thread',
        label: i18n._({ id: 'Workspace Auto Thread', message: 'Workspace Auto Thread' }),
      },
      {
        value: 'fixed_thread',
        label: i18n._({ id: 'Fixed Thread', message: 'Fixed Thread' }),
      },
    ],
    [],
  )

  const defaultBindingThreadOptions = useMemo(() => {
    const defaultBindingMarker = i18n._({ id: 'Current default binding', message: 'Current default binding' })
    const options: ThreadPickerOption[] = [buildThreadPickerPlaceholderOption()]
    const selectedThreadId = defaultBindingThreadId.trim()
    const selectedIsCurrentDefaultBinding =
      isDefaultBindingPickerOnCurrentWorkspace && selectedThreadId === defaultBindingCurrentThreadId

    if (selectedThreadId && !defaultBindingVisibleThreads.some((thread) => thread.id === selectedThreadId)) {
      options.push(
        isResolvingCurrentDefaultBindingThread && selectedIsCurrentDefaultBinding
          ? buildPendingThreadPickerOption(selectedThreadId, defaultBindingMarker)
          : buildPinnedThreadPickerOption(selectedThreadId, selectedIsCurrentDefaultBinding ? defaultBindingMarker : ''),
      )
    }

    for (const thread of defaultBindingVisibleThreads) {
      options.push(
        formatThreadPickerOption(
          thread,
          isDefaultBindingPickerOnCurrentWorkspace && thread.id === defaultBindingCurrentThreadId
            ? defaultBindingMarker
            : undefined,
        ),
      )
    }

    return options
  }, [
    defaultBindingCurrentThreadId,
    defaultBindingThreadId,
    defaultBindingVisibleThreads,
    isDefaultBindingPickerOnCurrentWorkspace,
    isResolvingCurrentDefaultBindingThread,
  ])
  const bindingThreadSelectableCount = bindingThreadOptions.filter((option) => option.value && !option.disabled).length
  const defaultBindingThreadSelectableCount = defaultBindingThreadOptions.filter(
    (option) => option.value && !option.disabled,
  ).length
  const bindingSearchMatchCount = bindingVisibleThreads.filter((thread) =>
    matchesThreadPickerSearch(thread, bindingThreadSearch),
  ).length
  const defaultBindingSearchMatchCount = defaultBindingVisibleThreads.filter((thread) =>
    matchesThreadPickerSearch(thread, defaultBindingThreadSearch),
  ).length

  const totalBotConversationCount = bots.reduce((count, bot) => count + bot.conversationCount, 0)
  const selectedConnectionReadyRecipientsCount = selectedConnectionDeliveryTargets.filter((target) =>
    isBotDeliveryTargetReady(target),
  ).length
  const selectedConnectionWaitingRecipientsCount =
    selectedConnectionDeliveryTargets.length - selectedConnectionReadyRecipientsCount
  const selectedConnectionManualOutboundCount = selectedConnectionOutboundDeliveries.filter(
    (delivery) => delivery.sourceType?.trim().toLowerCase() === 'manual',
  ).length
  const selectedConnectionPendingOutboundCount = selectedConnectionOutboundDeliveries.filter((delivery) =>
    ['sending', 'retrying'].includes(normalizeBotConversationDeliveryStatus(delivery.status)),
  ).length
  const selectedConnectionFailedOutboundCount = selectedConnectionOutboundDeliveries.filter(
    (delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'failed',
  ).length
  const selectedConnectionDeliveredOutboundCount = selectedConnectionOutboundDeliveries.filter(
    (delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'delivered',
  ).length
  const routeTargetRouteKeyPreview =
    routeTargetRouteType === 'telegram_topic' || routeTargetRouteType === 'feishu_thread'
      ? routeTargetChatId.trim() && routeTargetThreadId.trim()
        ? `chat:${routeTargetChatId.trim()}:thread:${routeTargetThreadId.trim()}`
        : ''
      : routeTargetRouteType === 'wechat_session'
        ? routeTargetChatId.trim()
          ? `user:${routeTargetChatId.trim()}`
          : ''
        : routeTargetRouteType === 'qqbot_c2c'
          ? routeTargetChatId.trim()
            ? `user:${routeTargetChatId.trim()}`
            : ''
          : routeTargetRouteType === 'qqbot_group'
            ? routeTargetChatId.trim()
              ? `group:${routeTargetChatId.trim()}`
              : ''
      : routeTargetChatId.trim()
        ? `chat:${routeTargetChatId.trim()}`
        : ''
  const selectedBotPrimaryBackend =
    selectedDefaultBinding?.aiBackend?.trim() ||
    selectedBotConnections.find((connection) => connection.status === 'active')?.aiBackend?.trim() ||
    selectedBotConnections[0]?.aiBackend?.trim() ||
    ''
  const selectedBotDefaultBindingMode =
    selectedDefaultBinding?.bindingMode?.trim() ||
    (selectedBotPrimaryBackend === 'openai_responses' ? 'stateless' : selectedBot?.defaultBindingMode?.trim() ?? '')
  const selectedBotDefaultBindingWorkspaceId =
    selectedDefaultBinding?.targetWorkspaceId?.trim() ||
    selectedBot?.defaultTargetWorkspaceId?.trim() ||
    selectedBot?.workspaceId ||
    ''
  const selectedBotDefaultBindingThreadId =
    selectedDefaultBinding?.targetThreadId?.trim() || selectedBot?.defaultTargetThreadId?.trim() || ''
  const canConfigureDefaultBinding =
    selectedBot !== null && selectedBotConnections.length > 0 && selectedBotPrimaryBackend === 'workspace_thread'
  const isEditingConnection = editTarget !== null
  const connectionModalBotId = isEditingConnection ? editTarget?.botId?.trim() ?? '' : selectedBotId.trim()
  const connectionModalBot = connectionModalBotId ? bots.find((bot) => bot.id === connectionModalBotId) ?? null : null
  const connectionModalWorkspace = connectionModalBot
    ? workspaceById.get(connectionModalBot.workspaceId) ?? null
    : draft.workspaceId.trim()
      ? workspaceById.get(draft.workspaceId.trim()) ?? null
      : null
  const connectionModalBaselineKey = connectionModalBaselineDraft ? serializeBotsPageDraft(connectionModalBaselineDraft) : ''
  const connectionModalDraftKey = serializeBotsPageDraft(draft)
  const isConnectionModalDirty = createModalOpen && connectionModalBaselineKey !== '' && connectionModalDraftKey !== connectionModalBaselineKey
  const isSaveConnectionDisabled = isEditingConnection && !isConnectionModalDirty
  const formErrorMessage =
    formError || (isEditingConnection ? getErrorMessage(updateMutation.error) : getErrorMessage(createMutation.error))
  const isEditingBot = editingBot !== null
  const createBotFormErrorMessage =
    createBotFormError || getErrorMessage(isEditingBot ? updateBotMutation.error : createBotMutation.error)
  const actionErrorMessage = actionMutation.error ? getErrorMessage(actionMutation.error) : ''
  const replayFailedReplyErrorMessage = replayFailedReplyMutation.error
    ? getErrorMessage(replayFailedReplyMutation.error)
    : ''
  const bindingErrorMessage = updateConversationBindingMutation.error
    ? getErrorMessage(updateConversationBindingMutation.error)
    : clearConversationBindingMutation.error
      ? getErrorMessage(clearConversationBindingMutation.error)
      : ''
  const defaultBindingErrorMessage = updateBotDefaultBindingMutation.error
    ? getErrorMessage(updateBotDefaultBindingMutation.error)
    : ''
  const routeTargetErrorMessage =
    routeTargetFormError ||
    getErrorMessage(upsertDeliveryTargetMutation.error) ||
    getErrorMessage(updateDeliveryTargetMutation.error)
  const routeTargetModalTitle =
    routeTargetModalMode === 'edit'
      ? i18n._({ id: 'Edit Saved Contact', message: 'Edit Saved Contact' })
      : routeTargetModalMode === 'save_from_existing'
        ? i18n._({ id: 'Save Contact', message: 'Save Contact' })
        : i18n._({ id: 'New Saved Contact', message: 'New Saved Contact' })
  const routeTargetModalDescription =
    routeTargetModalMode === 'edit'
      ? i18n._({
          id: 'Update the saved contact used for proactive delivery on this endpoint. Edit the display name, destination, or advanced routing settings as needed.',
          message:
            'Update the saved contact used for proactive delivery on this endpoint. Edit the display name, destination, or advanced routing settings as needed.',
        })
      : routeTargetModalMode === 'save_from_existing'
        ? i18n._({
            id: 'Save this contact for proactive delivery on this endpoint. The destination has been prefilled from the linked conversation so you can keep or refine it before saving.',
            message:
              'Save this contact for proactive delivery on this endpoint. The destination has been prefilled from the linked conversation so you can keep or refine it before saving.',
          })
        : i18n._({
            id: 'Create a saved contact for this endpoint. Choose a known contact or enter a new destination ID, then open advanced options only if you need extra routing settings.',
            message:
              'Create a saved contact for this endpoint. Choose a known contact or enter a new destination ID, then open advanced options only if you need extra routing settings.',
          })
  const routeTargetSubmitLabel =
    routeTargetModalMode === 'edit'
      ? i18n._({ id: 'Save Changes', message: 'Save Changes' })
      : i18n._({ id: 'Save Contact', message: 'Save Contact' })
  const deleteDeliveryTargetErrorMessage = deleteDeliveryTargetMutation.error
    ? getErrorMessage(deleteDeliveryTargetMutation.error)
    : ''
  const sendOutboundMessageErrorMessage =
    outboundComposerFormError ||
    getBotOutboundErrorMessage(sendSessionOutboundMessageMutation.error) ||
    getBotOutboundErrorMessage(sendDeliveryTargetOutboundMessageMutation.error)
  const isBindingMutationPending =
    updateConversationBindingMutation.isPending || clearConversationBindingMutation.isPending
  const isDefaultBindingMutationPending = updateBotDefaultBindingMutation.isPending
  const isRouteTargetMutationPending = upsertDeliveryTargetMutation.isPending || updateDeliveryTargetMutation.isPending
  const isSendOutboundMessagePending =
    sendSessionOutboundMessageMutation.isPending || sendDeliveryTargetOutboundMessageMutation.isPending
  const deleteErrorMessage = deleteMutation.error ? getErrorMessage(deleteMutation.error) : ''
  const deleteWeChatAccountErrorMessage = deleteWeChatAccountMutation.error
    ? getErrorMessage(deleteWeChatAccountMutation.error)
    : ''
  const editingConnectionHasBotToken = editTarget?.secretKeys?.includes('bot_token') ?? false
  const editingConnectionHasFeishuAppSecret = editTarget?.secretKeys?.includes('feishu_app_secret') ?? false
  const editingConnectionHasQQBotAppSecret = editTarget?.secretKeys?.includes('qqbot_app_secret') ?? false
  const editingConnectionHasOpenAIApiKey = editTarget?.secretKeys?.includes('openai_api_key') ?? false
  const draftProvider = resolveBotProvider(draft.provider) || 'telegram'
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
  const selectedConnectionSupportsRouteTargetConfig =
    selectedProvider === 'telegram' ||
    selectedProvider === 'wechat' ||
    selectedProvider === 'feishu' ||
    selectedProvider === 'qqbot'

  useEffect(() => {
    if (!routeTargetModalOpen) {
      return
    }
    if (routeTargetRecipientMode === 'existing' && !knownRouteTargetOptions.length) {
      setRouteTargetRecipientMode('manual')
      setRouteTargetSuggestedRecipientValue('')
      return
    }
    if (
      routeTargetSuggestedRecipientValue &&
      !knownRouteTargetOptions.some((option) => option.value === routeTargetSuggestedRecipientValue)
    ) {
      setRouteTargetSuggestedRecipientValue('')
    }
  }, [
    knownRouteTargetOptions,
    routeTargetModalOpen,
    routeTargetRecipientMode,
    routeTargetSuggestedRecipientValue,
  ])

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
  const outboundDirectoryStatsByConnectionID = useMemo(() => {
    const next = new Map<
      string,
      {
        deliveryTargetCount: number
        readyRecipientCount: number
        waitingRecipientCount: number
        outboundDeliveryCount: number
        manualOutboundCount: number
        failedOutboundCount: number
        latestOutboundCreatedAt: string
      }
    >()

    function ensure(connectionId: string) {
      const existing = next.get(connectionId)
      if (existing) {
        return existing
      }
      const created = {
        deliveryTargetCount: 0,
        readyRecipientCount: 0,
        waitingRecipientCount: 0,
        outboundDeliveryCount: 0,
        manualOutboundCount: 0,
        failedOutboundCount: 0,
        latestOutboundCreatedAt: '',
      }
      next.set(connectionId, created)
      return created
    }

    for (const target of botDeliveryTargets) {
      const connectionId = target.endpointId?.trim() ?? ''
      if (!connectionId) {
        continue
      }
      const stats = ensure(connectionId)
      stats.deliveryTargetCount += 1
      if (isBotDeliveryTargetReady(target)) {
        stats.readyRecipientCount += 1
      } else {
        stats.waitingRecipientCount += 1
      }
    }

    for (const delivery of botOutboundDeliveries) {
      const connectionId = delivery.endpointId?.trim() ?? ''
      if (!connectionId) {
        continue
      }
      const stats = ensure(connectionId)
      stats.outboundDeliveryCount += 1
      if (delivery.sourceType?.trim().toLowerCase() === 'manual') {
        stats.manualOutboundCount += 1
      }
      if (normalizeBotConversationDeliveryStatus(delivery.status) === 'failed') {
        stats.failedOutboundCount += 1
      }
      const createdAt = delivery.createdAt?.trim() ?? ''
      if (createdAt && (!stats.latestOutboundCreatedAt || createdAt > stats.latestOutboundCreatedAt)) {
        stats.latestOutboundCreatedAt = createdAt
      }
    }

    return next
  }, [botDeliveryTargets, botOutboundDeliveries])
  const outboundDirectoryStatsByBotID = useMemo(() => {
    const next = new Map<
      string,
      {
        endpointCount: number
        activeEndpointCount: number
        deliveryTargetCount: number
        readyRecipientCount: number
        waitingRecipientCount: number
        outboundDeliveryCount: number
        manualOutboundCount: number
        failedOutboundCount: number
        latestOutboundCreatedAt: string
      }
    >()

    function ensure(botId: string) {
      const existing = next.get(botId)
      if (existing) {
        return existing
      }
      const created = {
        endpointCount: 0,
        activeEndpointCount: 0,
        deliveryTargetCount: 0,
        readyRecipientCount: 0,
        waitingRecipientCount: 0,
        outboundDeliveryCount: 0,
        manualOutboundCount: 0,
        failedOutboundCount: 0,
        latestOutboundCreatedAt: '',
      }
      next.set(botId, created)
      return created
    }

    for (const connection of connections) {
      const botId = connection.botId?.trim() ?? ''
      if (!botId) {
        continue
      }
      const stats = ensure(botId)
      stats.endpointCount += 1
      if (connection.status === 'active') {
        stats.activeEndpointCount += 1
      }
      const connectionStats = outboundDirectoryStatsByConnectionID.get(connection.id)
      if (!connectionStats) {
        continue
      }
      stats.deliveryTargetCount += connectionStats.deliveryTargetCount
      stats.readyRecipientCount += connectionStats.readyRecipientCount
      stats.waitingRecipientCount += connectionStats.waitingRecipientCount
      stats.outboundDeliveryCount += connectionStats.outboundDeliveryCount
      stats.manualOutboundCount += connectionStats.manualOutboundCount
      stats.failedOutboundCount += connectionStats.failedOutboundCount
      if (
        connectionStats.latestOutboundCreatedAt &&
        (!stats.latestOutboundCreatedAt || connectionStats.latestOutboundCreatedAt > stats.latestOutboundCreatedAt)
      ) {
        stats.latestOutboundCreatedAt = connectionStats.latestOutboundCreatedAt
      }
    }

    return next
  }, [connections, outboundDirectoryStatsByConnectionID])
  const filteredBots = useMemo(
    () =>
      bots.filter((bot) => {
        if (workspaceFilterId.trim() && bot.workspaceId !== workspaceFilterId.trim()) {
          return false
        }
        const botConnections = connectionsByBotId.get(bot.id) ?? []
        const matchesSearch =
          bot.name.toLowerCase().includes(connectionSearch.trim().toLowerCase()) ||
          botConnections.some((connection) =>
            matchesBotConnectionSearch(
              connection,
              connectionSearch,
              linkedWeChatAccountByConnectionID.get(connection.id) ?? null,
            ),
          )
        if (!matchesSearch) {
          return false
        }
        if (!showFullAccessConnectionsOnly) {
          return true
        }
        if (isOutboundMode) {
          return botConnections.some((connection) => connection.status === 'active')
        }
        return botConnections.some(
          (connection) =>
            connection.aiBackend === 'workspace_thread' &&
            isBotWorkspacePermissionPresetFullAccess(connection.aiConfig?.permission_preset),
        )
      }),
    [
      bots,
      connectionSearch,
      connectionsByBotId,
      isOutboundMode,
      linkedWeChatAccountByConnectionID,
      showFullAccessConnectionsOnly,
      workspaceFilterId,
    ],
  )
  const filteredConnections = useMemo(
    () =>
      connections.filter((connection) => {
        if (workspaceFilterId.trim() && connection.workspaceId !== workspaceFilterId.trim()) {
          return false
        }
        if (isEndpointsMode && selectedBotFilterId && connection.botId?.trim() !== selectedBotFilterId) {
          return false
        }
        const search = connectionSearch.trim().toLowerCase()
        const bot = botById.get(connection.botId?.trim() ?? '') ?? null
        const linkedWeChatAccount = linkedWeChatAccountByConnectionID.get(connection.id) ?? null
        const botNameSearch = (bot?.name ?? '').toLowerCase()
        const botDescriptionSearch = (bot?.description ?? '').toLowerCase()
        const matchesSearch =
          !search ||
          matchesBotConnectionSearch(connection, connectionSearch, linkedWeChatAccount) ||
          botNameSearch.includes(search) ||
          botDescriptionSearch.includes(search)
        if (!matchesSearch) {
          return false
        }
        if (!showFullAccessConnectionsOnly) {
          return true
        }
        return connection.status === 'active'
      }),
    [
      botById,
      connectionSearch,
      connections,
      isEndpointsMode,
      linkedWeChatAccountByConnectionID,
      selectedBotFilterId,
      showFullAccessConnectionsOnly,
      workspaceFilterId,
    ],
  )
  const selectedBotFilterLabel = selectedBot?.name?.trim() || selectedBotFilterId || i18n._({ id: 'All bots', message: 'All bots' })
  const activeBotsCount = filteredBots.filter((bot) => bot.status === 'active').length
  const activeConnectionsCount = filteredConnections.filter((connection) => connection.status === 'active').length
  const selectedConnectionSuppressionSummary =
    (selectedConnection && recentSuppressionSummaryByConnectionID.get(selectedConnection.id)) ?? {
      suppressedCount: 0,
      duplicateSuppressedCount: 0,
      recoverySuppressedCount: 0,
      latestSuppressedAt: undefined,
    }
  const selectedConnectionOutboundDeliveriesSorted = useMemo(
    () =>
      [...selectedConnectionOutboundDeliveries].sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      ),
    [selectedConnectionOutboundDeliveries],
  )
  const selectedConnectionLatestOutboundDelivery = selectedConnectionOutboundDeliveriesSorted[0] ?? null
  const selectedConnectionLatestDeliveredOutboundDelivery =
    selectedConnectionOutboundDeliveriesSorted.find(
      (delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'delivered',
    ) ?? null
  const selectedConnectionBoundConversationCount = conversations.filter(
    (conversation) => resolveBotConversationThreadTarget(conversation).threadId.length > 0,
  ).length
  const selectedTelegramDeliveryMode =
    selectedProvider === 'telegram' && selectedConnection?.settings?.telegram_delivery_mode?.trim().toLowerCase() === 'polling'
      ? 'polling'
      : 'webhook'
  const selectedFeishuDeliveryMode =
    selectedProvider === 'feishu' ? resolveFeishuDeliveryMode(selectedConnection?.settings?.feishu_delivery_mode) : 'websocket'
  const selectedDeliveryMode =
    selectedProvider === 'wechat'
      ? 'polling'
      : selectedProvider === 'telegram'
        ? selectedTelegramDeliveryMode
        : selectedProvider === 'feishu'
          ? selectedFeishuDeliveryMode
          : selectedProvider === 'qqbot'
            ? 'gateway_websocket'
            : ''
  const selectedRuntimeMode: 'debug' | 'normal' =
    selectedConnection?.settings?.runtime_mode?.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
  const selectedConnectionDeliveryModeLabel =
    selectedDeliveryMode === 'gateway_websocket'
      ? i18n._({ id: 'Gateway WebSocket', message: 'Gateway WebSocket' })
      : selectedDeliveryMode === 'websocket'
        ? i18n._({ id: 'WebSocket', message: 'WebSocket' })
        : selectedDeliveryMode === 'polling'
          ? i18n._({ id: 'Long Polling', message: 'Long Polling' })
          : selectedDeliveryMode === 'webhook'
            ? i18n._({ id: 'Webhook', message: 'Webhook' })
            : i18n._({ id: 'None', message: 'None' })
  const selectedConnectionUsesBackgroundRuntime =
    selectedProvider === 'wechat' ||
    (selectedProvider === 'feishu' && selectedDeliveryMode === 'websocket') ||
    selectedProvider === 'qqbot' ||
    (selectedProvider === 'telegram' && selectedDeliveryMode === 'polling')
  const selectedConnectionSummary = selectedConnection
    ? {
        conversationCount: conversations.length,
        deliveryTargetCount: selectedConnectionDeliveryTargets.length,
        readyRecipientCount: selectedConnectionReadyRecipientsCount,
        waitingRecipientCount: selectedConnectionWaitingRecipientsCount,
        outboundDeliveryCount: selectedConnectionOutboundDeliveries.length,
        deliveredOutboundCount: selectedConnectionDeliveredOutboundCount,
        manualOutboundCount: selectedConnectionManualOutboundCount,
        pendingOutboundCount: selectedConnectionPendingOutboundCount,
        failedOutboundCount: selectedConnectionFailedOutboundCount,
        boundConversationCount: selectedConnectionBoundConversationCount,
      }
    : null
  const selectedConnectionLabels = selectedConnection
    ? {
        deliveryModeLabel: selectedConnectionDeliveryModeLabel,
        runtimeMode: selectedRuntimeMode,
        commandOutputModeLabel: formatBotCommandOutputModeLabel(
          resolveBotCommandOutputMode(selectedConnection.settings?.command_output_mode),
        ),
        usesBackgroundRuntime: selectedConnectionUsesBackgroundRuntime,
      }
    : null
  const selectedConnectionProviderSettings = selectedConnection
    ? {
        feishuEnableCards: resolveBotBooleanSetting(selectedConnection.settings?.feishu_enable_cards),
        feishuGroupReplyAll: resolveBotBooleanSetting(selectedConnection.settings?.feishu_group_reply_all),
        feishuThreadIsolation: resolveBotBooleanSetting(selectedConnection.settings?.feishu_thread_isolation),
        feishuShareSessionInChannel: resolveBotBooleanSetting(selectedConnection.settings?.feishu_share_session_in_channel),
        qqbotSandbox: resolveBotBooleanSetting(selectedConnection.settings?.qqbot_sandbox),
        qqbotShareSessionInChannel: resolveBotBooleanSetting(selectedConnection.settings?.qqbot_share_session_in_channel),
        qqbotMarkdownSupport: resolveBotBooleanSetting(selectedConnection.settings?.qqbot_markdown_support),
      }
    : null
  const selectedConnectionWeChatAccount = selectedConnection
    ? linkedWeChatAccountByConnectionID.get(selectedConnection.id) ?? null
    : null
  const activeWeChatLogin: WeChatLogin | null = wechatLoginQuery.data ?? wechatLoginStartMutation.data ?? null
  const activeWeChatLoginStatus = activeWeChatLogin?.status?.trim().toLowerCase() ?? ''
  const [wechatLoginNow, setWechatLoginNow] = useState(() => Date.now())
  const [wechatLoginAutoRefreshEnabled, setWechatLoginAutoRefreshEnabled] = useState(false)
  const [wechatLoginAutoRefreshPending, setWechatLoginAutoRefreshPending] = useState(false)
  const [wechatLoginAutoRefreshNoticeKey, setWechatLoginAutoRefreshNoticeKey] = useState('')
  const isWechatLoginExpired = activeWeChatLoginStatus === 'expired'
  const isWechatLoginRefreshPending = wechatLoginStartMutation.isPending || wechatLoginDeleteMutation.isPending
  const shouldShowWeChatLoginExpiresIn =
    Boolean(activeWeChatLogin?.qrCodeContent?.trim()) && !activeWeChatLogin?.credentialReady
  const wechatLoginExpiresAtMs = Date.parse(activeWeChatLogin?.expiresAt ?? '')
  const wechatLoginRemainingMs = Number.isNaN(wechatLoginExpiresAtMs) ? 0 : wechatLoginExpiresAtMs - wechatLoginNow
  const isWechatLoginExpiringSoon =
    shouldShowWeChatLoginExpiresIn && wechatLoginRemainingMs > 0 && wechatLoginRemainingMs <= 30_000
  const showWechatLoginRefreshPlaceholder =
    wechatLoginAutoRefreshPending && !(activeWeChatLogin?.qrCodeContent?.trim() ?? '')
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
  const wechatLoginExpiresInLabel = shouldShowWeChatLoginExpiresIn
    ? formatWeChatLoginExpiresInLabel(activeWeChatLogin?.expiresAt, wechatLoginNow)
    : ''
  const wechatLoginAutoRefreshHandledLoginIdRef = useRef('')
  const wechatLoginRefreshReasonRef = useRef<'manual' | 'auto-expired'>('manual')

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
    if (!wechatLoginModalOpen || !shouldShowWeChatLoginExpiresIn) {
      return
    }

    setWechatLoginNow(Date.now())
    const intervalID = window.setInterval(() => {
      setWechatLoginNow(Date.now())
    }, 1000)

    return () => {
      window.clearInterval(intervalID)
    }
  }, [activeWeChatLogin?.expiresAt, shouldShowWeChatLoginExpiresIn, wechatLoginModalOpen])

  useEffect(() => {
    if (
      !wechatLoginModalOpen ||
      !wechatLoginAutoRefreshEnabled ||
      !isWechatLoginExpired ||
      isWechatLoginRefreshPending
    ) {
      return
    }

    const currentLoginId = activeWeChatLogin?.loginId?.trim() ?? ''
    if (!currentLoginId || wechatLoginAutoRefreshHandledLoginIdRef.current === currentLoginId) {
      return
    }

    wechatLoginAutoRefreshHandledLoginIdRef.current = currentLoginId
    void handleRefreshWeChatQRCode('auto-expired')
  }, [
    activeWeChatLogin?.loginId,
    isWechatLoginExpired,
    isWechatLoginRefreshPending,
    wechatLoginAutoRefreshEnabled,
    wechatLoginModalOpen,
  ])

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
    void queryClient.invalidateQueries({ queryKey: ['wechat-accounts'] })
  }, [activeWeChatLoginStatus, draft.workspaceId, queryClient])

  useEffect(() => {
    setConnectionSearch('')
    setEditWeChatAccountTarget(null)
    setWeChatAccountAliasDraft('')
    setWeChatAccountNoteDraft('')
    updateWeChatAccountMutation.reset()
  }, [workspaceFilterId])

  useEffect(() => {
    resetBindingModalState()
    closeDefaultBindingModal()
    closeRouteTargetModal(true)
    setDeleteDeliveryTarget(null)
    closeOutboundComposer(true)
  }, [workspaceFilterId, selectedBotId, selectedConnectionId])

  useEffect(() => {
    if (botsQuery.isLoading) {
      return
    }
    if (!bots.length) {
      if (selectedBotId || selectedConnectionId) {
        setSelectionState({
          selectedBotId: '',
          selectedConnectionId: '',
        })
      }
      return
    }
    if (!filteredBots.length) {
      if (selectedBotId || selectedConnectionId) {
        setSelectionState({
          selectedBotId: '',
          selectedConnectionId: '',
        })
      }
      return
    }
    if (!selectedBotId || !filteredBots.some((bot) => bot.id === selectedBotId)) {
      setSelectionState({ selectedBotId: filteredBots[0].id })
    }
  }, [bots.length, botsQuery.isLoading, filteredBots, selectedBotId, selectedConnectionId])

  useEffect(() => {
    if (connectionsQuery.isLoading) {
      return
    }
    if (!selectedBotId) {
      if (selectedConnectionId) {
        setSelectionState({ selectedConnectionId: '' })
      }
      return
    }
    if (!selectedBotConnections.length) {
      if (selectedConnectionId) {
        setSelectionState({ selectedConnectionId: '' })
      }
      return
    }
    if (!selectedConnectionId || !selectedBotConnections.some((connection) => connection.id === selectedConnectionId)) {
      setSelectionState({ selectedConnectionId: selectedBotConnections[0].id })
    }
  }, [connectionsQuery.isLoading, selectedBotConnections, selectedBotId, selectedConnectionId])

  function selectBot(bot: Bot) {
    setSelectionState({
      selectedBotId: bot.id,
      selectedConnectionId: '',
    })
  }

  function selectConnection(connection: BotConnection) {
    setSelectionState({
      selectedBotId: connection.botId?.trim() ?? '',
      selectedConnectionId: connection.id,
    })
  }

  function openBotDetailsModal(bot: Bot) {
    selectBot(bot)
    setBotDetailsModalBotId(bot.id)
  }

  function closeBotDetailsModal() {
    setBotDetailsModalBotId('')
  }

  function openBotOutbound(bot: Bot) {
    const botConnections = connectionsByBotId.get(bot.id) ?? []
    const preferredConnection =
      botConnections.find((connection) => connection.status === 'active') ?? botConnections[0] ?? null
    const nextSearch = buildBotsPageSelectionSearch({
      workspaceFilterId,
      selectedBotId: bot.id,
      selectedConnectionId: preferredConnection?.id ?? '',
    })
    navigate({
      pathname: '/bots/outbound',
      search: nextSearch ? `?${nextSearch}` : '',
    })
  }

  function openBotEndpoints(bot: Bot) {
    const botConnections = connectionsByBotId.get(bot.id) ?? []
    const preferredConnection =
      botConnections.find((connection) => connection.status === 'active') ?? botConnections[0] ?? null
    navigate(buildBotEndpointsRoute(bot.workspaceId, bot.id, preferredConnection?.id))
  }

  function resetWeChatLoginState() {
    setWechatLoginModalOpen(false)
    setWechatLoginId('')
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    setWechatLoginAutoRefreshEnabled(false)
    setWechatLoginAutoRefreshPending(false)
    setWechatLoginAutoRefreshNoticeKey('')
    wechatLoginAutoRefreshHandledLoginIdRef.current = ''
    wechatLoginRefreshReasonRef.current = 'manual'
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
    setWechatLoginAutoRefreshEnabled(false)
    setWechatLoginAutoRefreshPending(false)
    setWechatLoginAutoRefreshNoticeKey('')
    wechatLoginAutoRefreshHandledLoginIdRef.current = ''
    wechatLoginRefreshReasonRef.current = 'manual'
    wechatLoginDeleteMutation.reset()
  }

  function handleDraftProviderChange(nextValue: string) {
    const nextProvider = resolveBotProvider(nextValue) || 'telegram'
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
    setWechatLoginAutoRefreshEnabled(false)
    setWechatLoginAutoRefreshPending(false)
    setWechatLoginAutoRefreshNoticeKey('')
    wechatLoginAutoRefreshHandledLoginIdRef.current = ''
    wechatLoginRefreshReasonRef.current = 'manual'
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
          id: 'Select an owner workspace before starting WeChat login.',
          message: 'Select an owner workspace before starting WeChat login.',
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
    setWechatLoginAutoRefreshPending(false)
    setWechatLoginAutoRefreshNoticeKey('')
    setWechatLoginId('')
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    wechatLoginRefreshReasonRef.current = 'manual'
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

  async function handleRefreshWeChatQRCode(reason: 'manual' | 'auto-expired' = 'manual') {
    if (!wechatLoginWorkspaceId) {
      setWechatLoginAutoRefreshPending(false)
      setFormError(
        i18n._({
          id: 'Select an owner workspace before starting WeChat login.',
          message: 'Select an owner workspace before starting WeChat login.',
        }),
      )
      return
    }
    if (!draft.wechatBaseUrl.trim()) {
      setWechatLoginAutoRefreshPending(false)
      setFormError(
        i18n._({
          id: 'WeChat base URL is required before starting QR login.',
          message: 'WeChat base URL is required before starting QR login.',
        }),
      )
      return
    }

    const previousLoginId = wechatLoginId.trim()

    setFormError('')
    setWechatLoginAutoRefreshPending(reason === 'auto-expired')
    if (reason === 'manual') {
      setWechatLoginAutoRefreshNoticeKey('')
    }
    setWechatLoginId('')
    setWechatLoginQRCodeUrl('')
    setWechatLoginCopyState('idle')
    wechatLoginRefreshReasonRef.current = reason
    setDraft((current) => ({
      ...current,
      wechatLoginSessionId: '',
      wechatLoginStatus: '',
      wechatQrCodeContent: '',
    }))
    wechatLoginStartMutation.reset()

    if (previousLoginId) {
      try {
        await wechatLoginDeleteMutation.mutateAsync({
          workspaceId: wechatLoginWorkspaceId,
          loginId: previousLoginId,
        })
      } catch {
        // Ignore stale session cleanup errors and still request a fresh QR code.
      } finally {
        wechatLoginDeleteMutation.reset()
      }
    } else {
      wechatLoginDeleteMutation.reset()
    }

    wechatLoginStartMutation.mutate({
      workspaceId: wechatLoginWorkspaceId,
      baseUrl: draft.wechatBaseUrl.trim(),
    })
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

  function openCreateBotModal() {
    createBotMutation.reset()
    updateBotMutation.reset()
    setCreateBotFormError('')
    setEditingBot(null)
    setCreateBotWorkspaceId(
      workspaceFilterId.trim() || selectedBotWorkspaceId || selectedConnectionWorkspaceId || workspaces[0]?.id || '',
    )
    setCreateBotNameDraft('')
    setCreateBotDescriptionDraft('')
    setCreateBotScopeDraft('workspace')
    setCreateBotSharingModeDraft('owner_only')
    setCreateBotSharedWorkspaceIdsDraft([])
    setCreateBotModalOpen(true)
  }

  function openEditBotModal(bot: Bot | null = selectedBot) {
    const targetBot = bot ?? selectedBot
    if (!targetBot) {
      setCreateBotFormError(
        i18n._({
          id: 'Select a bot before editing.',
          message: 'Select a bot before editing.',
        }),
      )
      return
    }

    selectBot(targetBot)
    createBotMutation.reset()
    updateBotMutation.reset()
    setEditingBot(targetBot)
    setCreateBotFormError('')
    setCreateBotWorkspaceId(targetBot.workspaceId)
    setCreateBotNameDraft(targetBot.name ?? '')
    setCreateBotDescriptionDraft(targetBot.description ?? '')
    setCreateBotScopeDraft(targetBot.scope?.trim().toLowerCase() === 'global' ? 'global' : 'workspace')
    setCreateBotSharingModeDraft(
      targetBot.sharingMode?.trim().toLowerCase() === 'selected_workspaces'
        ? 'selected_workspaces'
        : targetBot.sharingMode?.trim().toLowerCase() === 'owner_only'
          ? 'owner_only'
          : 'all_workspaces',
    )
    setCreateBotSharedWorkspaceIdsDraft(
      (targetBot.sharedWorkspaceIds ?? []).filter((workspaceId) => workspaceId !== targetBot.workspaceId),
    )
    setCreateBotModalOpen(true)
  }

  function closeCreateBotModal() {
    if (createBotMutation.isPending || updateBotMutation.isPending) {
      return
    }
    setCreateBotModalOpen(false)
    setEditingBot(null)
    setCreateBotWorkspaceId('')
    setCreateBotFormError('')
    setCreateBotNameDraft('')
    setCreateBotDescriptionDraft('')
    setCreateBotScopeDraft('workspace')
    setCreateBotSharingModeDraft('owner_only')
    setCreateBotSharedWorkspaceIdsDraft([])
    createBotMutation.reset()
    updateBotMutation.reset()
  }

  function handleSubmitCreateBot() {
    const ownerWorkspaceId = createBotWorkspaceId.trim()
    if (!ownerWorkspaceId) {
      setCreateBotFormError(
        i18n._({
          id: 'Select an owner workspace before creating a bot.',
          message: 'Select an owner workspace before creating a bot.',
        }),
      )
      return
    }

    if (!createBotNameDraft.trim()) {
      setCreateBotFormError(
        i18n._({
          id: 'Bot name is required.',
          message: 'Bot name is required.',
        }),
      )
      return
    }

    if (createBotScopeDraft === 'global' && createBotSharingModeDraft === 'selected_workspaces' && !createBotSharedWorkspaceIdsDraft.length) {
      setCreateBotFormError(
        i18n._({
          id: 'Select at least one shared workspace when using selected workspace sharing.',
          message: 'Select at least one shared workspace when using selected workspace sharing.',
        }),
      )
      return
    }

    setCreateBotFormError('')
    const input = {
      name: createBotNameDraft.trim(),
      description: createBotDescriptionDraft.trim(),
      scope: createBotScopeDraft,
      sharingMode: createBotScopeDraft === 'global' ? createBotSharingModeDraft : 'owner_only',
      sharedWorkspaceIds:
        createBotScopeDraft === 'global' && createBotSharingModeDraft === 'selected_workspaces'
          ? createBotSharedWorkspaceIdsDraft
          : [],
    }

    if (editingBot) {
      updateBotMutation.mutate({
        workspaceId: ownerWorkspaceId,
        botId: editingBot.id,
        input,
      })
      return
    }

    createBotMutation.mutate({
      workspaceId: ownerWorkspaceId,
      input,
    })
  }

  function openCreateModal() {
    if (!selectedBotId.trim()) {
      setFormError(
        i18n._({
          id: 'Select a bot before creating an endpoint.',
          message: 'Select a bot before creating an endpoint.',
        }),
      )
      return
    }
    createMutation.reset()
    updateMutation.reset()
    setFormError('')
    setEditTarget(null)
    resetWeChatLoginState()
    const nextDraft = {
      ...EMPTY_BOTS_PAGE_DRAFT,
      workspaceId: workspaceFilterId.trim() || selectedBotWorkspaceId || selectedConnectionWorkspaceId || workspaces[0]?.id || '',
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

  function openEditModal(connection: BotConnection) {
    createMutation.reset()
    updateMutation.reset()
    setFormError('')
    resetWeChatLoginState()
    selectConnection(connection)
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
          id: 'Resolve the owner workspace before creating an endpoint.',
          message: 'Resolve the owner workspace before creating an endpoint.',
        }),
      )
      return
    }

    if (!isEditingConnection && !connectionModalBotId) {
      setFormError(
        i18n._({
          id: 'Select a bot before creating an endpoint.',
          message: 'Select a bot before creating an endpoint.',
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

    if (draftProvider === 'feishu' && !draft.feishuAppId.trim()) {
      setFormError(
        i18n._({
          id: 'Feishu App ID is required.',
          message: 'Feishu App ID is required.',
        }),
      )
      return
    }

    if (draftProvider === 'feishu' && !draft.feishuAppSecret.trim() && !(isEditingConnection && editingConnectionHasFeishuAppSecret)) {
      setFormError(
        i18n._({
          id: 'Feishu App Secret is required. Leave it blank only when editing a connection that already stores one.',
          message: 'Feishu App Secret is required. Leave it blank only when editing a connection that already stores one.',
        }),
      )
      return
    }

    if (draftProvider === 'qqbot' && !draft.qqbotAppId.trim()) {
      setFormError(
        i18n._({
          id: 'QQ Bot App ID is required.',
          message: 'QQ Bot App ID is required.',
        }),
      )
      return
    }

    if (draftProvider === 'qqbot' && !draft.qqbotAppSecret.trim() && !(isEditingConnection && editingConnectionHasQQBotAppSecret)) {
      setFormError(
        i18n._({
          id: 'QQ Bot App Secret is required. Leave it blank only when editing a connection that already stores one.',
          message: 'QQ Bot App Secret is required. Leave it blank only when editing a connection that already stores one.',
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
      botId: connectionModalBotId,
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

  function resetBindingModalState() {
    setBindingTarget(null)
    setBindingMode('existing')
    setBindingWorkspaceId('')
    setBindingThreadId('')
    setBindingThreadSearch('')
    setBindingTitle('')
    updateConversationBindingMutation.reset()
    clearConversationBindingMutation.reset()
  }

  function closeBindingModal() {
    if (isBindingMutationPending) {
      return
    }
    resetBindingModalState()
  }

  function handleSubmitBinding() {
    if (!bindingTarget || !selectedConnection || isBindingMutationPending) {
      return
    }

    if (bindingMode === 'existing') {
      if (!bindingThreadId.trim()) {
        return
      }
      updateConversationBindingMutation.mutate({
        workspaceId: bindingTarget.workspaceId,
        connectionId: bindingTarget.connectionId,
        conversationId: bindingTarget.id,
        input: {
          threadId: bindingThreadId.trim(),
          targetWorkspaceId: bindingWorkspaceId.trim() || bindingTarget.workspaceId,
        },
      })
      return
    }

    updateConversationBindingMutation.mutate({
      workspaceId: bindingTarget.workspaceId,
      connectionId: bindingTarget.connectionId,
      conversationId: bindingTarget.id,
      input: {
        createThread: true,
        title: bindingTitle.trim() || undefined,
        targetWorkspaceId: bindingWorkspaceId.trim() || bindingTarget.workspaceId,
      },
    })
  }

  function handleClearBinding() {
    if (!bindingTarget || !bindingTarget.threadId || isBindingMutationPending) {
      return
    }

    clearConversationBindingMutation.mutate({
      workspaceId: bindingTarget.workspaceId,
      connectionId: bindingTarget.connectionId,
      conversationId: bindingTarget.id,
    })
  }

  function closeDefaultBindingModal() {
    if (isDefaultBindingMutationPending) {
      return
    }
    setDefaultBindingModalOpen(false)
    setDefaultBindingMode('workspace_auto_thread')
    setDefaultBindingWorkspaceId('')
    setDefaultBindingThreadId('')
    setDefaultBindingThreadSearch('')
    updateBotDefaultBindingMutation.reset()
  }

  function handleSubmitDefaultBinding() {
    if (!selectedBot || !canConfigureDefaultBinding || isDefaultBindingMutationPending) {
      return
    }
    if (defaultBindingMode === 'fixed_thread' && !defaultBindingThreadId.trim()) {
      return
    }
    updateBotDefaultBindingMutation.mutate({
      workspaceId: selectedBot.workspaceId,
      botId: selectedBot.id,
      input: {
        bindingMode: defaultBindingMode,
        targetWorkspaceId: defaultBindingWorkspaceId.trim() || selectedBot.workspaceId,
        targetThreadId: defaultBindingMode === 'fixed_thread' ? defaultBindingThreadId.trim() : undefined,
      },
    })
  }

  function closeRouteTargetModal(force = false) {
    if (!force && isRouteTargetMutationPending) {
      return
    }
    setRouteTargetModalOpen(false)
    setRouteTargetModalMode('create')
    setEditingRouteTarget(null)
    setRouteTargetTitle('')
    setRouteTargetRouteType(
      selectedProvider === 'wechat'
        ? 'wechat_session'
        : selectedProvider === 'feishu'
          ? 'feishu_chat'
          : selectedProvider === 'qqbot'
            ? 'qqbot_group'
            : 'telegram_chat',
    )
    setRouteTargetRecipientMode('manual')
    setRouteTargetSuggestedRecipientValue('')
    setRouteTargetChatId('')
    setRouteTargetThreadId('')
    setRouteTargetAdvancedOpen(false)
    setRouteTargetStatus('active')
    setRouteTargetLabelsDraft('')
    setRouteTargetCapabilitiesDraft('')
    setRouteTargetProviderStateDraft('')
    setRouteTargetFormError('')
    upsertDeliveryTargetMutation.reset()
    updateDeliveryTargetMutation.reset()
  }

  function handleSubmitRouteTarget() {
    if (!selectedBot || !selectedConnection || !selectedConnectionSupportsRouteTargetConfig || isRouteTargetMutationPending) {
      return
    }

    const chatId = routeTargetChatId.trim()
    const threadId = routeTargetThreadId.trim()
    if (routeTargetRecipientMode === 'existing' && knownRouteTargetOptions.length > 0 && !routeTargetSuggestedRecipientValue.trim()) {
      setRouteTargetFormError(
        i18n._({
          id: 'Select an available recipient or switch to manual entry.',
          message: 'Select an available recipient or switch to manual entry.',
        }),
      )
      return
    }
    if (!chatId) {
      setRouteTargetFormError(
        selectedProvider === 'wechat'
          ? i18n._({
              id: 'WeChat user ID is required for a saved contact.',
              message: 'WeChat user ID is required for a saved contact.',
            })
          : i18n._({
              id: 'Chat ID is required for a saved contact.',
              message: 'Chat ID is required for a saved contact.',
            }),
      )
      return
    }
    if ((routeTargetRouteType === 'telegram_topic' || routeTargetRouteType === 'feishu_thread') && !threadId) {
      setRouteTargetFormError(
        routeTargetRouteType === 'telegram_topic'
          ? i18n._({
              id: 'Thread ID is required for Telegram topic targets.',
              message: 'Thread ID is required for Telegram topic targets.',
            })
          : i18n._({
              id: 'Thread ID is required for thread targets.',
              message: 'Thread ID is required for thread targets.',
            }),
      )
      return
    }

    let providerState: Record<string, string> | undefined
    const providerStateText = routeTargetProviderStateDraft.trim()
    if (providerStateText) {
      try {
        const parsed = JSON.parse(providerStateText) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setRouteTargetFormError(
            i18n._({
              id: 'Provider state must be a JSON object.',
              message: 'Provider state must be a JSON object.',
            }),
          )
          return
        }
        providerState = Object.fromEntries(
          Object.entries(parsed)
            .filter((entry) => entry[0].trim())
            .map(([key, value]) => [
              key.trim(),
              typeof value === 'string' ? value.trim() : JSON.stringify(value),
            ]),
        )
      } catch {
        setRouteTargetFormError(
          i18n._({
            id: 'Provider state must be valid JSON.',
            message: 'Provider state must be valid JSON.',
          }),
        )
        return
      }
    }

    const routeKey =
      routeTargetRouteType === 'telegram_topic' || routeTargetRouteType === 'feishu_thread'
        ? `chat:${chatId}:thread:${threadId}`
        : routeTargetRouteType === 'wechat_session'
          ? `user:${chatId}`
          : routeTargetRouteType === 'qqbot_c2c'
            ? `user:${chatId}`
            : routeTargetRouteType === 'qqbot_group'
              ? `group:${chatId}`
          : `chat:${chatId}`
    setRouteTargetFormError('')
    if (editingRouteTarget) {
      updateDeliveryTargetMutation.mutate({
        workspaceId: selectedConnection.workspaceId,
        botId: selectedBot.id,
        targetId: editingRouteTarget.id,
        routeType: routeTargetRouteType,
        routeKey,
        title: routeTargetTitle.trim() || undefined,
        status: routeTargetStatus,
        labels: splitCommaSeparatedValues(routeTargetLabelsDraft),
        capabilities: splitCommaSeparatedValues(routeTargetCapabilitiesDraft),
        providerState,
      })
      return
    }

    upsertDeliveryTargetMutation.mutate({
      workspaceId: selectedConnection.workspaceId,
      botId: selectedBot.id,
      endpointId: selectedConnection.id,
      routeType: routeTargetRouteType,
      routeKey,
      title: routeTargetTitle.trim() || undefined,
      status: routeTargetStatus,
      labels: splitCommaSeparatedValues(routeTargetLabelsDraft),
      capabilities: splitCommaSeparatedValues(routeTargetCapabilitiesDraft),
      providerState,
    })
  }

  function applySuggestedRouteTarget(option: KnownRouteTargetOption | null) {
    setRouteTargetSuggestedRecipientValue(option?.value ?? '')
    if (!option) {
      return
    }
    setRouteTargetChatId(option.chatId)
    setRouteTargetThreadId(option.threadId)
  }

  function handleRouteTargetRecipientModeChange(nextMode: RouteTargetRecipientMode) {
    setRouteTargetFormError('')
    setRouteTargetRecipientMode(nextMode)
    if (nextMode !== 'existing') {
      setRouteTargetSuggestedRecipientValue('')
      return
    }
    const matchingOption = findKnownRouteTargetOption(knownRouteTargetOptions, routeTargetChatId, routeTargetThreadId)
    setRouteTargetSuggestedRecipientValue(matchingOption?.value ?? '')
  }

  function resetOutboundComposerFeedback() {
    setOutboundComposerFormError('')
    sendSessionOutboundMessageMutation.reset()
    sendDeliveryTargetOutboundMessageMutation.reset()
  }

  function addOutboundComposerMediaDraft() {
    if (!outboundComposerSupportedMediaKinds.length || !outboundComposerSupportedMediaSources.length) {
      return
    }
    resetOutboundComposerFeedback()
    setOutboundComposerMediaDrafts((current) => [
      ...current,
      createOutboundComposerMediaDraft(outboundComposerSupportedMediaKinds, outboundComposerSupportedMediaSources),
    ])
  }

  function updateOutboundComposerMediaDraft(
    draftID: string,
    updates: Partial<OutboundComposerMediaDraft>,
  ) {
    resetOutboundComposerFeedback()
    setOutboundComposerMediaDrafts((current) =>
      current.map((draft) => {
        if (draft.id !== draftID) {
          return draft
        }
        const nextDraft = { ...draft, ...updates }
        if (updates.kind && !outboundComposerSupportedMediaKinds.includes(nextDraft.kind)) {
          nextDraft.kind = outboundComposerSupportedMediaKinds[0] ?? 'file'
        }
        if (updates.source && !outboundComposerSupportedMediaSources.includes(nextDraft.source)) {
          nextDraft.source = outboundComposerSupportedMediaSources[0] ?? 'url'
        }
        return nextDraft
      }),
    )
  }

  function removeOutboundComposerMediaDraft(draftID: string) {
    resetOutboundComposerFeedback()
    setOutboundComposerMediaDrafts((current) => current.filter((draft) => draft.id !== draftID))
  }

  function closeOutboundComposer(force = false) {
    if (!force && isSendOutboundMessagePending) {
      return
    }
    setOutboundComposerTarget(null)
    setOutboundComposerDeliveryTarget(null)
    setOutboundComposerText('')
    setOutboundComposerMediaDrafts([])
    resetOutboundComposerFeedback()
  }

  function handleSubmitOutboundComposer() {
    if (!selectedBot || !selectedConnection || isSendOutboundMessagePending) {
      return
    }

    const text = outboundComposerText.trim()
    if (hasIncompleteOutboundComposerMediaDrafts) {
      setOutboundComposerFormError(
        i18n._({
          id: 'Each attachment needs a URL or absolute local path before you can send it.',
          message: 'Each attachment needs a URL or absolute local path before you can send it.',
        }),
      )
      return
    }
    if (hasUnsupportedOutboundComposerMediaDrafts) {
      setOutboundComposerFormError(
        i18n._({
          id: 'Fix or remove the attachments that use media types or sources unsupported by this endpoint before sending.',
          message: 'Fix or remove the attachments that use media types or sources unsupported by this endpoint before sending.',
        }),
      )
      return
    }
    if (hasInvalidOutboundComposerMediaDrafts) {
      setOutboundComposerFormError(
        i18n._({
          id: 'Fix the invalid attachment locations before sending this message.',
          message: 'Fix the invalid attachment locations before sending this message.',
        }),
      )
      return
    }
    if (outboundComposerMediaDrafts.length > 0 && outboundComposerMedia.length === 0) {
      setOutboundComposerFormError(
        i18n._({
          id: 'Add at least one complete attachment, or remove the empty attachment rows before sending.',
          message: 'Add at least one complete attachment, or remove the empty attachment rows before sending.',
        }),
      )
      return
    }
    if (!text && outboundComposerMedia.length === 0) {
      return
    }

    resetOutboundComposerFeedback()
    const messages: BotReplyMessage[] = [{ text: text || undefined, media: outboundComposerMedia.length ? outboundComposerMedia : undefined }]

    if (outboundComposerTarget) {
      const originTarget = resolveBotConversationThreadTarget(outboundComposerTarget)
      sendSessionOutboundMessageMutation.mutate({
        workspaceId: outboundComposerTarget.workspaceId,
        botId: selectedBot.id,
        sessionId: outboundComposerTarget.id,
        input: {
          messages,
          originWorkspaceId: originTarget.workspaceId.trim() || undefined,
          originThreadId: originTarget.threadId.trim() || undefined,
        },
      })
      return
    }

    if (outboundComposerDeliveryTarget) {
      sendDeliveryTargetOutboundMessageMutation.mutate({
        workspaceId: selectedConnection.workspaceId,
        botId: selectedBot.id,
        targetId: outboundComposerDeliveryTarget.id,
        input: {
          messages,
        },
      })
    }
  }

  const outboundComposerHasPreviewContent = Boolean(outboundComposerText.trim() || outboundComposerMedia.length > 0)
  const outboundComposerTextPlacement = planBotOutboundTextPlacement(
    outboundComposerText,
    outboundComposerMedia,
    outboundComposerMediaDeliveryPlan,
  )
  const outboundComposerTextPreview = truncateOutboundComposerPreviewValue(outboundComposerText, 180)
  let outboundComposerTextPlacementMessage = ''
  switch (outboundComposerTextPlacement) {
    case 'text_only':
      outboundComposerTextPlacementMessage = i18n._({
        id: 'Text will be sent as a standalone message.',
        message: 'Text will be sent as a standalone message.',
      })
      break
    case 'caption_single':
      outboundComposerTextPlacementMessage = i18n._({
        id: 'Text will be sent as the attachment caption when the provider supports captions for that media type.',
        message: 'Text will be sent as the attachment caption when the provider supports captions for that media type.',
      })
      break
    case 'caption_group':
      outboundComposerTextPlacementMessage = i18n._({
        id: 'Text will be attached to the first grouped media item as the album caption.',
        message: 'Text will be attached to the first grouped media item as the album caption.',
      })
      break
    case 'separate_before_media':
      outboundComposerTextPlacementMessage = i18n._({
        id: 'Text will be sent before the attachments as a separate message.',
        message: 'Text will be sent before the attachments as a separate message.',
      })
      break
    default:
      outboundComposerTextPlacementMessage = ''
      break
  }
  let outboundComposerMediaDeliverySummary = ''
  switch (outboundComposerMediaDeliveryPlan.mode) {
    case 'single':
      outboundComposerMediaDeliverySummary = i18n._({
        id: 'Single attachment delivery',
        message: 'Single attachment delivery',
      })
      break
    case 'group':
      outboundComposerMediaDeliverySummary = i18n._({
        id: 'Grouped album delivery',
        message: 'Grouped album delivery',
      })
      break
    case 'sequential':
      outboundComposerMediaDeliverySummary = i18n._({
        id: 'Sequential attachment delivery',
        message: 'Sequential attachment delivery',
      })
      break
    case 'unsupported':
      outboundComposerMediaDeliverySummary = i18n._({
        id: 'Attachment delivery is not supported by this endpoint',
        message: 'Attachment delivery is not supported by this endpoint',
      })
      break
    default:
      outboundComposerMediaDeliverySummary = ''
      break
  }
  let outboundComposerMediaPlanMessage = ''
  switch (outboundComposerMediaDeliveryPlan.reason) {
    case 'group_supported':
      outboundComposerMediaPlanMessage = i18n._({
        id: 'This attachment set can use grouped album delivery on this endpoint.',
        message: 'This attachment set can use grouped album delivery on this endpoint.',
      })
      break
    case 'group_not_supported_by_connection':
      outboundComposerMediaPlanMessage = i18n._({
        id: 'Multiple attachments will be sent sequentially because this endpoint does not expose grouped media delivery.',
        message:
          'Multiple attachments will be sent sequentially because this endpoint does not expose grouped media delivery.',
      })
      break
    case 'voice_not_groupable':
      outboundComposerMediaPlanMessage = i18n._({
        id: 'Voice attachments are sent sequentially. Telegram media groups do not support voice items.',
        message: 'Voice attachments are sent sequentially. Telegram media groups do not support voice items.',
      })
      break
    case 'mixed_document_with_visual_media':
      outboundComposerMediaPlanMessage = i18n._({
        id: 'Mixed files with images or videos will be sent sequentially. Grouped Telegram delivery only combines images and videos together, or files together.',
        message:
          'Mixed files with images or videos will be sent sequentially. Grouped Telegram delivery only combines images and videos together, or files together.',
      })
      break
    default:
      outboundComposerMediaPlanMessage = ''
      break
  }

  const pageEyebrow = isConfigMode
    ? i18n._({ id: 'Bots', message: 'Bots' })
    : isOutboundMode
      ? i18n._({ id: 'Bot Outbound', message: 'Bot Outbound' })
      : i18n._({ id: 'Endpoints', message: 'Endpoints' })
  const pageTitle = isConfigMode
    ? i18n._({ id: 'Bot Integrations', message: 'Bot Integrations' })
    : isOutboundMode
      ? i18n._({ id: 'Bot Outbound Operations', message: 'Bot Outbound Operations' })
      : i18n._({ id: 'Endpoint Directory', message: 'Endpoint Directory' })
  const pageDescription = isConfigMode
    ? i18n._({
        id: 'Connect Telegram, WeChat, Feishu, or QQ Bot endpoints, choose the right delivery posture for each provider, then route replies through Workspace Thread or OpenAI Responses.',
        message:
          'Connect Telegram, WeChat, Feishu, or QQ Bot endpoints, choose the right delivery posture for each provider, then route replies through Workspace Thread or OpenAI Responses.',
      })
    : isOutboundMode
      ? i18n._({
          id: 'Review proactive recipients, send manual outbound messages, and inspect outbound delivery history without mixing those workflows into the bot configuration surface.',
          message:
            'Review proactive recipients, send manual outbound messages, and inspect outbound delivery history without mixing those workflows into the bot configuration surface.',
        })
      : selectedBotFilterId
        ? i18n._({
            id: 'Inspect the endpoints attached to {botName}, then jump into detail, overview, logs, or edit actions without folding them into the bot directory.',
            message:
              'Inspect the endpoints attached to {botName}, then jump into detail, overview, logs, or edit actions without folding them into the bot directory.',
            values: { botName: selectedBotFilterLabel },
          })
        : i18n._({
            id: 'Inspect endpoint records from a dedicated list view, then jump into detail, overview, logs, or edit actions without folding them into the bot directory.',
            message:
              'Inspect endpoint records from a dedicated list view, then jump into detail, overview, logs, or edit actions without folding them into the bot directory.',
          })
  const selectedPageQuery = buildBotsPageSelectionSearch({
    workspaceFilterId,
    selectedBotId,
    selectedConnectionId,
  })
  const configBotsPageRoute = selectedPageQuery ? `/bots?${selectedPageQuery}` : '/bots'
  const outboundBotsPageRoute = selectedPageQuery ? `/bots/outbound?${selectedPageQuery}` : '/bots/outbound'
  const endpointsBotsPageRoute = selectedPageQuery ? `/bots/endpoints?${selectedPageQuery}` : '/bots/endpoints'
  const currentMetricLabel = isConfigMode
    ? i18n._({ id: 'Conversations', message: 'Conversations' })
    : isOutboundMode
      ? i18n._({ id: 'Recipients', message: 'Recipients' })
      : i18n._({ id: 'Active Endpoints', message: 'Active Endpoints' })
  const currentMetricValue = isConfigMode
    ? totalBotConversationCount
    : isOutboundMode
      ? selectedConnectionDeliveryTargets.length
      : activeConnectionsCount

  const botsPageDialogsProps = {
    shared: {
      isOutboundMode,
      workspaces,
      selectedBot,
      selectedConnection,
      selectedProvider,
      selectedBotConnectionsCount: selectedBotConnections.length,
      selectedBotPrimaryBackend,
      selectedBotDefaultBindingMode,
      selectedBotDefaultBindingWorkspaceId,
      selectedBotDefaultBindingThreadId,
      selectedConnectionSupportsRouteTargetConfig,
      deliveryTargetByConversationId,
    },
    binding: {
      target: bindingTarget,
      currentWorkspaceId: bindingCurrentWorkspaceId,
      currentThreadId: bindingCurrentThreadId,
      errorMessage: bindingErrorMessage,
      workspaceId: bindingWorkspaceId,
      mode: bindingMode,
      modeOptions: bindingModeOptions,
      threadSearch: bindingThreadSearch,
      threadId: bindingThreadId,
      threadOptions: bindingThreadOptions,
      threadSelectableCount: bindingThreadSelectableCount,
      searchMatchCount: bindingSearchMatchCount,
      isInitialLoading: isActiveThreadsInitialLoading,
      isResolvingCurrentThread: isResolvingCurrentBindingThread,
      activeThreadsError: activeThreadsQuery.error,
      canLoadMore: canLoadMoreActiveThreads,
      isFetchingNextPage: activeThreadsQuery.isFetchingNextPage,
      currentThreadError: currentBindingThreadQuery.error,
      isPickerOnCurrentWorkspace: isBindingPickerOnCurrentWorkspace,
      activeThreads,
      resolvedCurrentThread: resolvedCurrentBindingThread,
      onClose: closeBindingModal,
      onSubmit: handleSubmitBinding,
      onChangeWorkspaceId: setBindingWorkspaceId,
      onChangeThreadSearch: setBindingThreadSearch,
      onChangeThreadId: setBindingThreadId,
      onLoadMore: () => {
        void activeThreadsQuery.fetchNextPage()
      },
      onClearBinding: handleClearBinding,
      onChangeMode: setBindingMode,
      bindingTitle,
      onChangeTitle: setBindingTitle,
      onResetClearBindingMutation: () => {
        clearConversationBindingMutation.reset()
        updateConversationBindingMutation.reset()
      },
      onResetUpdateBindingMutation: () => {
        clearConversationBindingMutation.reset()
        updateConversationBindingMutation.reset()
      },
      isBindingMutationPending,
      isClearConversationBindingPending: clearConversationBindingMutation.isPending,
      isUpdateConversationBindingPending: updateConversationBindingMutation.isPending,
    },
    defaultBinding: {
      open: defaultBindingModalOpen,
      errorMessage: defaultBindingErrorMessage,
      workspaceId: defaultBindingWorkspaceId,
      mode: defaultBindingMode,
      modeOptions: defaultBindingModeOptions,
      threadSearch: defaultBindingThreadSearch,
      threadId: defaultBindingThreadId,
      threadOptions: defaultBindingThreadOptions,
      threadSelectableCount: defaultBindingThreadSelectableCount,
      searchMatchCount: defaultBindingSearchMatchCount,
      isInitialLoading: isActiveThreadsInitialLoading,
      isResolvingCurrentThread: isResolvingCurrentDefaultBindingThread,
      activeThreadsError: activeThreadsQuery.error,
      isFetchingNextPage: activeThreadsQuery.isFetchingNextPage,
      currentThreadError: currentDefaultBindingThreadQuery.error,
      isPickerOnCurrentWorkspace: isDefaultBindingPickerOnCurrentWorkspace,
      activeThreads,
      resolvedCurrentThread: resolvedCurrentDefaultBindingThread,
      onClose: closeDefaultBindingModal,
      onSubmit: handleSubmitDefaultBinding,
      onChangeWorkspaceId: setDefaultBindingWorkspaceId,
      onChangeThreadSearch: setDefaultBindingThreadSearch,
      onChangeThreadId: setDefaultBindingThreadId,
      onLoadMore: () => {
        void activeThreadsQuery.fetchNextPage()
      },
      onChangeMode: setDefaultBindingMode,
      onResetUpdateBindingMutation: () => {
        updateBotDefaultBindingMutation.reset()
      },
      isDefaultBindingMutationPending,
      isUpdateBotDefaultBindingPending: updateBotDefaultBindingMutation.isPending,
    },
    routeTarget: {
      open: routeTargetModalOpen,
      mode: routeTargetModalMode,
      title: routeTargetModalTitle,
      description: routeTargetModalDescription,
      submitLabel: routeTargetSubmitLabel,
      errorMessage: routeTargetErrorMessage,
      routeTargetRouteTypeOptions,
      routeTargetStatusOptions,
      routeTargetRouteType,
      routeTargetTitle,
      routeTargetRecipientMode,
      routeTargetSuggestedRecipientValue,
      routeTargetChatId,
      routeTargetThreadId,
      routeTargetAdvancedOpen,
      routeTargetStatus,
      routeTargetLabelsDraft,
      routeTargetCapabilitiesDraft,
      routeTargetProviderStateDraft,
      knownRouteTargetOptions,
      knownRouteTargetSelectOptions,
      selectedKnownRouteTargetOption,
      recipientCandidatesError: recipientCandidatesQuery.error,
      recipientCandidatesLoading: recipientCandidatesQuery.isLoading,
      routeTargetRouteKeyPreview,
      selectedProvider,
      onClose: closeRouteTargetModal,
      onSubmit: handleSubmitRouteTarget,
      onResetCreateOrEditMutation: () => {
        upsertDeliveryTargetMutation.reset()
        updateDeliveryTargetMutation.reset()
      },
      onResetRouteTargetMutation: () => {
        upsertDeliveryTargetMutation.reset()
        updateDeliveryTargetMutation.reset()
      },
      onResetFormError: () => setRouteTargetFormError(''),
      onChangeRouteType: setRouteTargetRouteType,
      onChangeTitle: setRouteTargetTitle,
      onChangeRecipientMode: handleRouteTargetRecipientModeChange,
      onChangeSuggestedRecipientValue: setRouteTargetSuggestedRecipientValue,
      onChangeChatId: setRouteTargetChatId,
      onChangeThreadId: setRouteTargetThreadId,
      onToggleAdvanced: () => setRouteTargetAdvancedOpen((current) => !current),
      onChangeStatus: setRouteTargetStatus,
      onChangeLabels: setRouteTargetLabelsDraft,
      onChangeCapabilities: setRouteTargetCapabilitiesDraft,
      onChangeProviderState: setRouteTargetProviderStateDraft,
      onApplySuggestedRouteTarget: applySuggestedRouteTarget,
      isRouteTargetMutationPending,
    },
    outboundComposer: {
      open: Boolean(outboundComposerTarget || outboundComposerDeliveryTarget),
      errorMessage: sendOutboundMessageErrorMessage,
      isSendOutboundMessagePending,
      outboundComposerTarget,
      outboundComposerDeliveryTarget,
      outboundComposerText,
      outboundComposerMediaDrafts,
      outboundComposerMedia,
      outboundComposerMediaCapabilityIssues,
      outboundComposerMediaLocationIssues,
      outboundComposerMediaAdvisories,
      outboundComposerMediaDeliveryPlan,
      outboundComposerMediaKindOptions,
      outboundComposerMediaSourceOptions,
      outboundComposerSupportedMediaKinds,
      outboundComposerSupportedMediaSources,
      outboundComposerHasPreviewContent,
      outboundComposerTextPreview,
      outboundComposerTextPlacementMessage,
      outboundComposerMediaDeliverySummary,
      outboundComposerMediaPlanMessage,
      onClose: closeOutboundComposer,
      onSubmit: handleSubmitOutboundComposer,
      onAddMediaDraft: addOutboundComposerMediaDraft,
      onRemoveMediaDraft: removeOutboundComposerMediaDraft,
      onUpdateMediaDraft: updateOutboundComposerMediaDraft,
      onResetFeedback: resetOutboundComposerFeedback,
      onChangeText: setOutboundComposerText,
    },
    wechatLogin: {
      open: wechatLoginModalOpen,
      errorMessage: wechatLoginErrorMessage,
      autoRefreshNoticeKey: wechatLoginAutoRefreshNoticeKey,
      autoRefreshPending: wechatLoginAutoRefreshPending,
      wechatLoginId,
      draft,
      wechatLoginAutoRefreshEnabled,
      activeWeChatLogin,
      activeWeChatLoginStatus,
      wechatLoginExpiresInLabel,
      isWechatLoginExpiringSoon,
      isWechatLoginExpired,
      showWechatLoginRefreshPlaceholder,
      wechatLoginQRCodeUrl,
      wechatLoginCopyLabel,
      isWechatLoginRefreshPending,
      isDeleteWeChatLoginPending: wechatLoginDeleteMutation.isPending,
      onClose: closeWeChatLoginModal,
      onDeleteWeChatLogin: handleDeleteWeChatLogin,
      onUseWeChatCredentials: handleUseWeChatCredentials,
      onRefreshWeChatQRCode: handleRefreshWeChatQRCode,
      onStartWeChatLogin: handleStartWeChatLogin,
      onCopyWeChatPayload: handleCopyWeChatPayload,
      onChangeWechatBaseUrl: (nextValue: string) => setDraft((current) => ({ ...current, wechatBaseUrl: nextValue })),
      onChangeAutoRefreshEnabled: setWechatLoginAutoRefreshEnabled,
    },
    wechatAccount: {
      target: editWeChatAccountTarget,
      errorMessage: updateWeChatAccountErrorMessage,
      aliasDraft: wechatAccountAliasDraft,
      noteDraft: wechatAccountNoteDraft,
      isPending: updateWeChatAccountMutation.isPending,
      onClose: closeWeChatAccountEditModal,
      onSubmit: handleUpdateWeChatAccount,
      onChangeAlias: setWeChatAccountAliasDraft,
      onChangeNote: setWeChatAccountNoteDraft,
    },
    confirms: {
      isOutboundMode,
      deleteDeliveryTarget,
      deleteDeliveryTargetErrorMessage,
      deleteDeliveryTargetIsPending: deleteDeliveryTargetMutation.isPending,
      onCloseDeleteDeliveryTarget: () => {
        if (!deleteDeliveryTargetMutation.isPending) {
          setDeleteDeliveryTarget(null)
          deleteDeliveryTargetMutation.reset()
        }
      },
      onConfirmDeleteDeliveryTarget: () => {
        if (!selectedBot || deleteDeliveryTargetMutation.isPending || !deleteDeliveryTarget) {
          return
        }
        deleteDeliveryTargetMutation.mutate({
          workspaceId: selectedBotWorkspaceId,
          botId: selectedBot.id,
          targetId: deleteDeliveryTarget.id,
        })
      },
      deleteTarget,
      deleteErrorMessage,
      deleteIsPending: deleteMutation.isPending,
      onCloseDeleteTarget: () => {
        if (!deleteMutation.isPending) {
          setDeleteTarget(null)
        }
      },
      onConfirmDeleteTarget: handleDeleteConfirm,
      deleteWeChatAccountTarget,
      deleteWeChatAccountErrorMessage,
      deleteWeChatAccountIsPending: deleteWeChatAccountMutation.isPending,
      onCloseDeleteWeChatAccount: () => {
        if (!deleteWeChatAccountMutation.isPending) {
          setDeleteWeChatAccountTarget(null)
        }
      },
      onConfirmDeleteWeChatAccount: handleDeleteWeChatAccountConfirm,
      discardConnectionModalConfirmOpen,
      isEditingConnection,
      draftName: draft.name,
      editTargetName: editTarget?.name ?? '',
      onCloseDiscardConnectionConfirm: () => setDiscardConnectionModalConfirmOpen(false),
      onConfirmDiscardConnection: handleDiscardConnectionModalConfirm,
    },
  }

  const botDetailsModalBot = botDetailsModalBotId ? bots.find((bot) => bot.id === botDetailsModalBotId) ?? null : null
  const botDetailsModalConnections = botDetailsModalBot
    ? connections.filter((connection) => connection.botId === botDetailsModalBot.id)
    : []

  return (
    <section className="screen">
      <BotsPageHeader
        botsCount={bots.length}
        connectionsCount={connections.length}
        currentMetricLabel={currentMetricLabel}
        currentMetricValue={currentMetricValue}
        isConfigMode={isConfigMode}
        isOutboundMode={isOutboundMode}
        isEndpointsMode={isEndpointsMode}
        onOpenCreateEndpoint={openCreateModal}
        onOpenCreateBot={openCreateBotModal}
        onSwitchToConfig={() => navigate(configBotsPageRoute)}
        onSwitchToOutbound={() => navigate(outboundBotsPageRoute)}
        onSwitchToEndpoints={() => navigate(endpointsBotsPageRoute)}
        pageDescription={pageDescription}
        pageEyebrow={pageEyebrow}
        pageTitle={pageTitle}
      />

      <div className="mode-layout mode-layout--bots-page">
        <div className="mode-stage stack-screen">
          <BotsPageFilterSummarySection
            activeBotsCount={activeBotsCount}
            isEndpointsMode={isEndpointsMode}
            onChangeWorkspaceFilterId={(nextValue) => {
              setSelectionState({
                workspaceFilterId: nextValue,
                selectedBotId: '',
                selectedConnectionId: '',
              })
            }}
            onClearSelectedBotFilter={() => {
              setSelectionState({
                selectedBotId: '',
                selectedConnectionId: '',
              })
            }}
            selectedBotFilterId={selectedBotFilterId}
            selectedBotFilterLabel={selectedBotFilterLabel}
            selectedWorkspaceFilterName={
              selectedWorkspaceFilter?.name ?? i18n._({ id: 'All workspaces', message: 'All workspaces' })
            }
            workspaceFilterId={workspaceFilterId}
            workspaces={workspaces}
          />
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

              {botsQuery.error ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bots-${getErrorMessage(botsQuery.error)}`}
                  onRetry={() => void botsQuery.refetch()}
                  title={i18n._({ id: 'Failed To Load Bots', message: 'Failed To Load Bots' })}
                  tone="error"
                >
                  {getErrorMessage(botsQuery.error)}
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

              {replayFailedReplyErrorMessage ? (
                <InlineNotice
                  dismissible
                  noticeKey={`bot-replay-failed-reply-${replayFailedReplyErrorMessage}`}
                  title={i18n._({ id: 'Reply Redelivery Failed', message: 'Reply Redelivery Failed' })}
                  tone="error"
                >
                  {replayFailedReplyErrorMessage}
                </InlineNotice>
              ) : null}

              <BotsPageDirectorySection
                actionErrorMessage={actionErrorMessage}
                botById={botById}
                bots={bots}
                botsQueryError={botsQuery.error}
                botsQueryIsLoading={botsQuery.isLoading}
                connectionSearch={connectionSearch}
                connections={connections}
                connectionsByBotId={connectionsByBotId}
                connectionsQueryError={connectionsQuery.error}
                connectionsQueryIsLoading={connectionsQuery.isLoading}
                filteredBots={filteredBots}
                filteredConnections={filteredConnections}
                hasWorkspaces={Boolean(workspaces.length)}
                mode={mode}
                onChangeConnectionSearch={(nextValue) => setConnectionSearch(nextValue)}
                onEditConnection={openEditModal}
                onOpenBotEdit={openEditBotModal}
                onOpenBotEndpoints={openBotEndpoints}
                onOpenBotInfo={openBotDetailsModal}
                onOpenBotOutbound={openBotOutbound}
                onOpenConnectionDetail={(connection) =>
                  navigate(buildBotConnectionDetailRoute(connection.workspaceId, connection.id))
                }
                onOpenConnectionLogs={(connection) =>
                  navigate(buildBotConnectionLogsRoute(connection.workspaceId, connection.id))
                }
                onOpenConnectionOverview={(connection) => {
                  selectConnection(connection)
                  setConnectionOverviewModalOpen(true)
                }}
                onRetryBots={() => void botsQuery.refetch()}
                onRetryConnections={() => void connectionsQuery.refetch()}
                onRetryWorkspaces={() => void workspacesQuery.refetch()}
                onSelectBot={selectBot}
                onSelectConnection={selectConnection}
                onToggleShowFullAccessConnectionsOnly={(nextValue) => setShowFullAccessConnectionsOnly(nextValue)}
                replayFailedReplyErrorMessage={replayFailedReplyErrorMessage}
                selectedBotFilterId={selectedBotFilterId}
                selectedBotFilterLabel={selectedBotFilterLabel}
                selectedBotId={selectedBotId}
                selectedConnectionId={selectedConnectionId}
                showFullAccessConnectionsOnly={showFullAccessConnectionsOnly}
                workspaceById={workspaceById}
                workspacesQueryError={workspacesQuery.error}
                workspacesQueryIsLoading={workspacesQuery.isLoading}
                outboundStatsByBotId={outboundDirectoryStatsByBotID}
              />
            </>
          ) : null}
        </div>
      </div>

      <BotsPageCreateBotModal
        createBotDescriptionDraft={createBotDescriptionDraft}
        createBotFormErrorMessage={createBotFormErrorMessage}
        createBotModalOpen={createBotModalOpen}
        createBotNameDraft={createBotNameDraft}
        createBotScopeDraft={createBotScopeDraft}
        createBotShareableWorkspaces={createBotShareableWorkspaces}
        createBotSharedWorkspaceIdsDraft={createBotSharedWorkspaceIdsDraft}
        createBotSharingModeDraft={createBotSharingModeDraft}
        createBotWorkspaceId={createBotWorkspaceId}
        isCreateBotPending={isEditingBot ? updateBotMutation.isPending : createBotMutation.isPending}
        isEditingBot={isEditingBot}
        onChangeCreateBotDescription={(nextValue) => setCreateBotDescriptionDraft(nextValue)}
        onChangeCreateBotName={(nextValue) => setCreateBotNameDraft(nextValue)}
        onChangeCreateBotScope={(nextValue) => {
          const nextScope = nextValue === 'global' ? 'global' : 'workspace'
          setCreateBotScopeDraft(nextScope)
          if (nextScope === 'workspace') {
            setCreateBotSharingModeDraft('owner_only')
            setCreateBotSharedWorkspaceIdsDraft([])
          } else if (createBotSharingModeDraft === 'owner_only') {
            setCreateBotSharingModeDraft('all_workspaces')
          }
          setCreateBotFormError('')
        }}
        onChangeCreateBotSharingMode={(nextValue) => {
          const nextMode =
            nextValue === 'selected_workspaces'
              ? 'selected_workspaces'
              : nextValue === 'owner_only'
                ? 'owner_only'
                : 'all_workspaces'
          setCreateBotSharingModeDraft(nextMode)
          if (nextMode !== 'selected_workspaces') {
            setCreateBotSharedWorkspaceIdsDraft([])
          }
          setCreateBotFormError('')
        }}
        onChangeCreateBotWorkspaceId={(nextValue) => {
          setCreateBotWorkspaceId(nextValue)
          setCreateBotSharedWorkspaceIdsDraft((current) => current.filter((workspaceId) => workspaceId !== nextValue))
          setCreateBotFormError('')
        }}
        onClose={closeCreateBotModal}
        onSubmit={handleSubmitCreateBot}
        onToggleCreateBotSharedWorkspaceId={(workspaceId, checked) => {
          setCreateBotSharedWorkspaceIdsDraft((current) => {
            if (checked) {
              return [...current, workspaceId]
            }
            return current.filter((existingWorkspaceId) => existingWorkspaceId !== workspaceId)
          })
          setCreateBotFormError('')
        }}
        workspaces={workspaces}
      />
      <BotsPageConnectionModal
        activeWeChatLoginCredentialReady={Boolean(activeWeChatLogin?.credentialReady)}
        aiBackendOptions={aiBackendOptions}
        collaborationOptions={collaborationOptions}
        closeCreateModal={closeCreateModal}
        commandOutputModeOptions={commandOutputModeOptions}
        connectionModalBot={connectionModalBot}
        connectionModalBotId={connectionModalBotId}
        connectionModalWorkspace={connectionModalWorkspace}
        createModalOpen={createModalOpen}
        draft={draft}
        feishuDeliveryModeOptions={feishuDeliveryModeOptions}
        formErrorMessage={formErrorMessage}
        handleDraftProviderChange={handleDraftProviderChange}
        handleSubmitCreate={handleSubmitCreate}
        handleWeChatCredentialSourceChange={handleWeChatCredentialSourceChange}
        isCreateOrUpdatePending={createMutation.isPending || updateMutation.isPending}
        isEditingConnection={isEditingConnection}
        isSaveConnectionDisabled={isSaveConnectionDisabled}
        openWeChatAccountEditModal={openWeChatAccountEditModal}
        openWeChatLoginModal={openWeChatLoginModal}
        permissionPresetOptions={permissionPresetOptions}
        providerOptions={providerOptions}
        reasoningOptions={reasoningOptions}
        savedWeChatAccounts={savedWeChatAccounts}
        setDeleteWeChatAccountTarget={setDeleteWeChatAccountTarget}
        setDraft={setDraft}
        telegramDeliveryModeOptions={telegramDeliveryModeOptions}
        wechatAccountsErrorMessage={wechatAccountsErrorMessage}
        wechatAccountsQueryIsLoading={wechatAccountsQuery.isLoading}
      />

      <BotsPageBotDetailsModal
        bot={botDetailsModalBot}
        connections={botDetailsModalConnections}
        onClose={closeBotDetailsModal}
        workspaceById={workspaceById}
      />

      {connectionOverviewModalOpen &&
      selectedConnection &&
      selectedConnectionSummary &&
      selectedConnectionLabels &&
      selectedConnectionProviderSettings ? (
        <BotsPageConnectionSummarySection
          connection={selectedConnection}
          latestDeliveredOutboundDelivery={selectedConnectionLatestDeliveredOutboundDelivery}
          latestOutboundDelivery={selectedConnectionLatestOutboundDelivery}
          mode="config"
          onOpenChange={setConnectionOverviewModalOpen}
          open={connectionOverviewModalOpen}
          providerSettings={selectedConnectionProviderSettings}
          showCard={false}
          summaryCounts={selectedConnectionSummary}
          summaryLabels={selectedConnectionLabels}
          suppressionSummary={selectedConnectionSuppressionSummary}
          wechatAccount={selectedConnectionWeChatAccount}
        />
      ) : null}

      <BotsPageDialogs {...botsPageDialogsProps} />
    </section>
  )
}

export function BotsPage() {
  return <BotsPageScreen mode="config" />
}

export function BotsOutboundPage() {
  return <BotsPageScreen mode="outbound" />
}

export function BotsEndpointsPage() {
  return <BotsPageScreen mode="endpoints" />
}

function serializeBotsPageDraft(draft: BotsPageDraft) {
  return JSON.stringify([
    draft.workspaceId,
    draft.provider,
    draft.name,
    draft.runtimeMode,
    draft.commandOutputMode,
    draft.telegramDeliveryMode,
    draft.feishuDeliveryMode,
    draft.publicBaseUrl,
    draft.wechatBaseUrl,
    draft.wechatRouteTag,
    draft.wechatChannelTimingEnabled,
    draft.wechatCredentialSource,
    draft.wechatSavedAccountId,
    draft.wechatLoginSessionId,
    draft.wechatLoginStatus,
    draft.wechatQrCodeContent,
    draft.feishuAppId,
    draft.feishuAppSecret,
    draft.feishuDomain,
    draft.feishuStreamingPlainTextStrategy,
    draft.feishuEnableCards,
    draft.feishuGroupReplyAll,
    draft.feishuThreadIsolation,
    draft.feishuShareSessionInChannel,
    draft.qqbotAppId,
    draft.qqbotAppSecret,
    draft.qqbotSandbox,
    draft.qqbotShareSessionInChannel,
    draft.qqbotMarkdownSupport,
    draft.qqbotIntents,
    draft.aiBackend,
    draft.telegramBotToken,
    draft.wechatBotToken,
    draft.wechatAccountId,
    draft.wechatUserId,
    draft.workspaceModel,
    draft.workspacePermissionPreset,
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

