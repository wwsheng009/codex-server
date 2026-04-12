import { useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { toDataURL as toQRCodeDataURL } from 'qrcode'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { LoadingState } from '../components/ui/LoadingState'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { Switch } from '../components/ui/Switch'
import { TextArea } from '../components/ui/TextArea'
import { Tooltip } from '../components/ui/Tooltip'
import {
  clearBotConversationBinding,
  createBot,
  createBotTrigger,
  createBotConnection,
  createBotConnectionForBot,
  deleteBotDeliveryTarget,
  deleteBotTrigger,
  deleteWeChatAccount,
  deleteWeChatLogin,
  getWeChatLogin,
  deleteBotConnection,
  listBotConnectionLogsById,
  listBotBindings,
  listBotDeliveryTargets,
  listBotOutboundDeliveries,
  listBotTriggers,
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
  updateBotTrigger,
  updateBotDeliveryTarget,
  updateBotConnection,
  updateBotConnectionCommandOutputMode,
  updateBotConversationBinding,
  updateBotConnectionRuntimeMode,
  updateBotDefaultBinding,
  updateWeChatAccount,
  updateWeChatChannelTiming,
  type CreateBotInput,
  type UpdateBotDefaultBindingInput,
  type CreateBotConnectionInput,
  type UpdateBotConversationBindingInput,
  type UpdateBotConnectionInput,
} from '../features/bots/api'
import { getThread, listThreadsPage } from '../features/threads/api'
import { listWorkspaces } from '../features/workspaces/api'
import { summarizeRecentBotConnectionSuppressions } from '../features/bots/logStreamUtils'
import { formatLocalizedStatusLabel, humanizeDisplayValue } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
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
  countWeChatConnectionsForAccount,
  EMPTY_BOTS_PAGE_DRAFT,
  formatBotBackendLabel,
  formatBotCommandOutputModeLabel,
  formatBotConversationBindingModeLabel,
  formatBotConversationBindingSourceLabel,
  formatBotConversationTitle,
  formatBotWorkspacePermissionPresetLabel,
  formatBotProviderLabel,
  formatBotTimestamp,
  findWeChatAccountForConnection,
  formatWeChatAccountLabel,
  isBotOutboundMediaKindSupported,
  isBotOutboundMediaSourceSupported,
  isBotWorkspacePermissionPresetFullAccess,
  listSupportedBotOutboundMediaKinds,
  listSupportedBotOutboundMediaSources,
  listWeChatConnectionsForAccount,
  matchesBotConnectionSearch,
  matchesWeChatAccountSearch,
  planBotOutboundMediaDelivery,
  planBotOutboundTextPlacement,
  validateBotOutboundMediaLocation,
  resolveBotCommandOutputMode,
  resolveBotConversationThreadTarget,
  resolveWeChatChannelTimingEnabled,
  summarizeBotMap,
  type BotsPageDraft,
  type BotOutboundMediaAdvisory,
  type BotOutboundMediaKind,
  type BotOutboundMediaSource,
} from './botsPageUtils'
import type {
  Bot,
  BotBinding,
  BotConnection,
  BotConversation,
  BotDeliveryTarget,
  BotMessageMedia,
  BotReplyMessage,
  BotTrigger,
  Thread,
  WeChatAccount,
  WeChatLogin,
} from '../types/api'
import { useWorkspaceEventSubscription } from '../hooks/useWorkspaceStream'

function HelpTooltip({ content }: { content: React.ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

function normalizeBotConversationDeliveryStatus(status?: string) {
  return status?.trim().toLowerCase() ?? ''
}

function botConversationDeliveryPillStatus(status?: string) {
  switch (normalizeBotConversationDeliveryStatus(status)) {
    case 'delivered':
      return 'delivered'
    case 'sending':
      return 'sending'
    case 'retrying':
      return 'retrying'
    case 'failed':
      return 'failed'
    default:
      return ''
  }
}

function summarizeBotConversationDeliveryError(error?: string) {
  const trimmed = error?.trim() ?? ''
  if (!trimmed) {
    return ''
  }
  return trimmed.length > 180 ? `${trimmed.slice(0, 177).trimEnd()}...` : trimmed
}

function summarizeBotReplyMessages(messages?: BotReplyMessage[] | null) {
  const items = messages ?? []
  if (!items.length) {
    return ''
  }

  const summary = items
    .map((message) => {
      const parts: string[] = []
      const text = message.text?.trim() ?? ''
      if (text) {
        parts.push(text)
      }
      const mediaCount = message.media?.length ?? 0
      if (mediaCount > 0) {
        parts.push(
          i18n._({
            id: '{count} attachment(s)',
            message: '{count} attachment(s)',
            values: { count: mediaCount },
          }),
        )
      }
      return parts.join(' | ')
    })
    .filter(Boolean)
    .join(' / ')

  if (!summary) {
    return ''
  }

  return summary.length > 220 ? `${summary.slice(0, 217).trimEnd()}...` : summary
}

type BotsPageMode = 'config' | 'outbound'

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

function formatBotDeliveryTargetLabel(target: BotDeliveryTarget) {
  const title = target.title?.trim()
  if (title) {
    return title
  }
  const routeKey = target.routeKey?.trim()
  if (routeKey) {
    return routeKey
  }
  const sessionId = target.sessionId?.trim()
  if (sessionId) {
    return sessionId
  }
  return target.id
}

function formatBotTriggerFilterSummary(trigger: BotTrigger) {
  const filter = trigger.filter ?? {}
  const parts = Object.entries(filter)
    .map(([rawKey, rawValue]) => {
      const key = rawKey.trim()
      const value = typeof rawValue === 'string' ? rawValue.trim() : ''
      if (!key || !value) {
        return ''
      }
      return `${humanizeDisplayValue(key, key)}=${humanizeDisplayValue(value, value)}`
    })
    .filter(Boolean)

  if (!parts.length) {
    return i18n._({ id: 'All notifications', message: 'All notifications' })
  }

  return parts.join(' | ')
}

function formatBotConnectionCapabilityLabel(capability?: string | null) {
  switch ((capability ?? '').trim()) {
    case 'supportsTextOutbound':
      return i18n._({ id: 'Text outbound', message: 'Text outbound' })
    case 'supportsMediaOutbound':
      return i18n._({ id: 'Media outbound', message: 'Media outbound' })
    case 'supportsMediaGroup':
      return i18n._({ id: 'Media groups', message: 'Media groups' })
    case 'supportsImageOutbound':
      return i18n._({ id: 'Image outbound', message: 'Image outbound' })
    case 'supportsVideoOutbound':
      return i18n._({ id: 'Video outbound', message: 'Video outbound' })
    case 'supportsVoiceOutbound':
      return i18n._({ id: 'Voice outbound', message: 'Voice outbound' })
    case 'supportsFileOutbound':
      return i18n._({ id: 'File outbound', message: 'File outbound' })
    case 'supportsRemoteMediaURLSource':
      return i18n._({ id: 'Remote media URLs', message: 'Remote media URLs' })
    case 'supportsLocalMediaPathSource':
      return i18n._({ id: 'Local file uploads', message: 'Local file uploads' })
    case 'supportsProactivePush':
      return i18n._({ id: 'Proactive push', message: 'Proactive push' })
    case 'supportsSessionlessPush':
      return i18n._({ id: 'Sessionless push', message: 'Sessionless push' })
    case 'requiresRouteState':
      return i18n._({ id: 'Existing reply context required', message: 'Existing reply context required' })
    default:
      return humanizeDisplayValue(capability, i18n._({ id: 'Unknown', message: 'Unknown' }))
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

function summarizeOutboundComposerMediaPreview(media: BotMessageMedia) {
  const kind = formatOutboundComposerMediaKindLabel(
    ((media.kind ?? '').trim().toLowerCase() as BotOutboundMediaKind) || 'file',
  )
  const source: BotOutboundMediaSource = media.path?.trim() ? 'path' : 'url'
  const sourceLabel = formatOutboundComposerMediaSourceLabel(source)
  const location = truncateOutboundComposerPreviewValue(media.path ?? media.url ?? media.fileName ?? '')
  if (!location) {
    return `${kind} | ${sourceLabel}`
  }
  return `${kind} | ${sourceLabel} | ${location}`
}

function formatOutboundComposerMediaLocationError(
  source: BotOutboundMediaSource,
  issue: ReturnType<typeof validateBotOutboundMediaLocation>,
) {
  switch (issue) {
    case 'path_must_be_absolute':
      return i18n._({
        id: 'Use an absolute local path such as E:\\media\\image.png.',
        message: 'Use an absolute local path such as E:\\media\\image.png.',
      })
    case 'url_invalid':
      return i18n._({
        id: 'Use an absolute http(s) URL such as https://example.com/image.png.',
        message: 'Use an absolute http(s) URL such as https://example.com/image.png.',
      })
    default:
      return source === 'path'
        ? i18n._({
            id: 'Enter an absolute local path.',
            message: 'Enter an absolute local path.',
          })
        : i18n._({
            id: 'Enter an absolute http(s) URL.',
            message: 'Enter an absolute http(s) URL.',
          })
  }
}

function formatOutboundComposerUnsupportedKindError(kind: BotOutboundMediaKind) {
  return i18n._({
    id: 'This endpoint does not expose {kind} outbound.',
    message: 'This endpoint does not expose {kind} outbound.',
    values: { kind: formatOutboundComposerMediaKindLabel(kind).toLowerCase() },
  })
}

function formatOutboundComposerUnsupportedSourceError(source: BotOutboundMediaSource) {
  if (source === 'path') {
    return i18n._({
      id: 'This endpoint does not expose local file path attachments.',
      message: 'This endpoint does not expose local file path attachments.',
    })
  }

  return i18n._({
    id: 'This endpoint does not expose remote URL attachments.',
    message: 'This endpoint does not expose remote URL attachments.',
  })
}

function describeOutboundComposerMediaRowDelivery(
  kind: BotOutboundMediaKind,
  totalMediaCount: number,
  mediaDeliveryPlan: ReturnType<typeof planBotOutboundMediaDelivery>,
) {
  if (totalMediaCount <= 0) {
    return ''
  }
  if (totalMediaCount === 1) {
    return i18n._({
      id: 'This attachment will be sent as a single media item.',
      message: 'This attachment will be sent as a single media item.',
    })
  }

  switch (mediaDeliveryPlan.reason) {
    case 'group_supported':
      return i18n._({
        id: 'This attachment is eligible for grouped album delivery.',
        message: 'This attachment is eligible for grouped album delivery.',
      })
    case 'group_not_supported_by_connection':
      return i18n._({
        id: 'This attachment will be sent sequentially because this endpoint does not expose grouped media delivery.',
        message:
          'This attachment will be sent sequentially because this endpoint does not expose grouped media delivery.',
      })
    case 'voice_not_groupable':
      if (kind === 'voice') {
        return i18n._({
          id: 'Voice items are not groupable on Telegram, so this attachment will be sent sequentially.',
          message: 'Voice items are not groupable on Telegram, so this attachment will be sent sequentially.',
        })
      }
      return i18n._({
        id: 'This attachment will be sent sequentially because the set includes voice items.',
        message: 'This attachment will be sent sequentially because the set includes voice items.',
      })
    case 'mixed_document_with_visual_media':
      if (kind === 'file') {
        return i18n._({
          id: 'Files cannot be grouped with images or videos on Telegram, so this attachment will be sent sequentially.',
          message:
            'Files cannot be grouped with images or videos on Telegram, so this attachment will be sent sequentially.',
        })
      }
      return i18n._({
        id: 'Images and videos cannot be grouped with files on Telegram, so this attachment will be sent sequentially.',
        message:
          'Images and videos cannot be grouped with files on Telegram, so this attachment will be sent sequentially.',
      })
    default:
      return ''
  }
}

function formatOutboundComposerMediaAdvisory(advisory: BotOutboundMediaAdvisory, selectedKind: BotOutboundMediaKind) {
  const selectedKindLabel = formatOutboundComposerMediaKindLabel(selectedKind).toLowerCase()

  switch (advisory.code) {
    case 'kind_mismatch': {
      const detectedKindLabel = formatOutboundComposerMediaKindLabel(advisory.detectedKind).toLowerCase()
      switch (advisory.source) {
        case 'file_name':
          return i18n._({
            id: 'The file name looks like {detectedKind}, but this row is set to {selectedKind}.',
            message: 'The file name looks like {detectedKind}, but this row is set to {selectedKind}.',
            values: { detectedKind: detectedKindLabel, selectedKind: selectedKindLabel },
          })
        case 'content_type':
          return i18n._({
            id: 'The content type looks like {detectedKind}, but this row is set to {selectedKind}.',
            message: 'The content type looks like {detectedKind}, but this row is set to {selectedKind}.',
            values: { detectedKind: detectedKindLabel, selectedKind: selectedKindLabel },
          })
        case 'location':
        default:
          return i18n._({
            id: 'The attachment location looks like {detectedKind}, but this row is set to {selectedKind}.',
            message: 'The attachment location looks like {detectedKind}, but this row is set to {selectedKind}.',
            values: { detectedKind: detectedKindLabel, selectedKind: selectedKindLabel },
          })
      }
    }
    case 'metadata_mismatch':
      return i18n._({
        id: 'The file name/location looks like {nameKind}, but the content type looks like {contentTypeKind}.',
        message: 'The file name/location looks like {nameKind}, but the content type looks like {contentTypeKind}.',
        values: {
          nameKind: formatOutboundComposerMediaKindLabel(advisory.nameKind).toLowerCase(),
          contentTypeKind: formatOutboundComposerMediaKindLabel(advisory.contentTypeKind).toLowerCase(),
        },
      })
    default:
      return ''
  }
}

function summarizeBotConnectionCapabilities(capabilities?: string[] | null) {
  const values = (capabilities ?? []).map((capability) => formatBotConnectionCapabilityLabel(capability)).filter(Boolean)
  if (!values.length) {
    return i18n._({ id: 'none', message: 'none' })
  }
  return values.join(', ')
}

function formatBotDeliveryRouteLabel(routeType?: string | null) {
  switch (routeType?.trim().toLowerCase()) {
    case 'telegram_chat':
      return i18n._({ id: 'Telegram Chat', message: 'Telegram Chat' })
    case 'telegram_topic':
      return i18n._({ id: 'Telegram Topic', message: 'Telegram Topic' })
    case 'wechat_session':
      return i18n._({ id: 'WeChat Recipient', message: 'WeChat Recipient' })
    default:
      return i18n._({ id: 'Derived route', message: 'Derived route' })
  }
}

function formatBotDeliveryReadinessLabel(readiness?: string | null) {
  switch (readiness?.trim().toLowerCase()) {
    case 'waiting_for_context':
      return i18n._({ id: 'Waiting for Context', message: 'Waiting for Context' })
    case 'stale_context':
      return i18n._({ id: 'Context Needs Refresh', message: 'Context Needs Refresh' })
    case 'ready':
    default:
      return i18n._({ id: 'Ready', message: 'Ready' })
  }
}

function isBotDeliveryTargetReady(target: BotDeliveryTarget) {
  return (target.deliveryReadiness?.trim().toLowerCase() ?? 'ready') === 'ready'
}

function parseTelegramRouteKey(routeType?: string | null, routeKey?: string | null) {
  const normalizedRouteType = routeType?.trim().toLowerCase() ?? ''
  const normalizedRouteKey = routeKey?.trim() ?? ''
  if (!normalizedRouteKey) {
    return { chatId: '', threadId: '' }
  }

  if (normalizedRouteType === 'telegram_topic') {
    const withoutPrefix = normalizedRouteKey.startsWith('chat:') ? normalizedRouteKey.slice(5) : normalizedRouteKey
    const [chatId = '', threadId = ''] = withoutPrefix.split(':thread:')
    return { chatId: chatId.trim(), threadId: threadId.trim() }
  }

  const chatId = normalizedRouteKey.startsWith('chat:') ? normalizedRouteKey.slice(5) : normalizedRouteKey
  return { chatId: chatId.trim(), threadId: '' }
}

function parseWeChatRouteKey(routeKey?: string | null) {
  const normalizedRouteKey = routeKey?.trim() ?? ''
  if (!normalizedRouteKey) {
    return ''
  }
  if (normalizedRouteKey.startsWith('user:')) {
    return normalizedRouteKey.slice(5).trim()
  }
  if (normalizedRouteKey.startsWith('chat:')) {
    return normalizedRouteKey.slice(5).trim()
  }
  return normalizedRouteKey
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

function buildKnownRouteTargetOptions(
  provider: string,
  routeType: string,
  conversations: BotConversation[],
): KnownRouteTargetOption[] {
  const normalizedProvider = provider.trim().toLowerCase()
  const normalizedRouteType = routeType.trim().toLowerCase()
  const orderedConversations = [...conversations].sort((left, right) => {
    const leftTimestamp = Date.parse(left.updatedAt)
    const rightTimestamp = Date.parse(right.updatedAt)
    return (Number.isFinite(rightTimestamp) ? rightTimestamp : 0) - (Number.isFinite(leftTimestamp) ? leftTimestamp : 0)
  })
  const seen = new Set<string>()
  const options: KnownRouteTargetOption[] = []

  for (const conversation of orderedConversations) {
    const chatId = conversation.externalChatId.trim()
    const threadId = conversation.externalThreadId?.trim() ?? ''
    const title = formatBotConversationTitle(conversation).trim() || chatId
    if (!chatId) {
      continue
    }

    if (normalizedProvider === 'telegram' && normalizedRouteType === 'telegram_topic') {
      if (!threadId) {
        continue
      }
      const value = `telegram_topic:${chatId}:${threadId}`
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

    if (normalizedProvider === 'telegram' && normalizedRouteType === 'telegram_chat') {
      const value = `telegram_chat:${chatId}`
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
      continue
    }

    if (normalizedProvider === 'wechat' && normalizedRouteType === 'wechat_session') {
      const value = `wechat_session:${chatId}`
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

function isSavedBotDeliveryTarget(target?: BotDeliveryTarget | null) {
  return (target?.targetType?.trim().toLowerCase() ?? '') === 'route_backed'
}

function buildBotDeliveryTargetRouteSignature(target?: Pick<BotDeliveryTarget, 'routeType' | 'routeKey'> | null) {
  const routeType = target?.routeType?.trim().toLowerCase() ?? ''
  const routeKey = target?.routeKey?.trim() ?? ''
  if (!routeType || !routeKey) {
    return ''
  }
  return `${routeType}:${routeKey}`
}

function stripManagedRouteTargetProviderState(
  provider: string,
  providerState?: Record<string, string> | null,
) {
  if (!providerState) {
    return undefined
  }

  const normalizedProvider = provider.trim().toLowerCase()
  const entries = Object.entries(providerState).filter(([rawKey]) => {
    const key = rawKey.trim()
    if (!key) {
      return false
    }
    if (
      normalizedProvider === 'wechat' &&
      (
        key === 'wechat_context_token' ||
        key === 'wechat_session_id' ||
        key === 'wechat_created_at_ms' ||
        key === 'to_user_id' ||
        key === 'external_chat_id'
      )
    ) {
      return false
    }
    return true
  })

  if (!entries.length) {
    return undefined
  }

  return Object.fromEntries(entries)
}

function splitCommaSeparatedValues(value: string) {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function formatCommaSeparatedValues(values?: string[] | null) {
  return (values ?? []).join(', ')
}

function stringifyProviderState(providerState?: Record<string, string> | null) {
  if (!providerState || Object.keys(providerState).length === 0) {
    return ''
  }
  return JSON.stringify(providerState, null, 2)
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
  const [createBotWorkspaceId, setCreateBotWorkspaceId] = useState('')
  const [createBotNameDraft, setCreateBotNameDraft] = useState('')
  const [createBotDescriptionDraft, setCreateBotDescriptionDraft] = useState('')
  const [createBotFormError, setCreateBotFormError] = useState('')
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
  const [showFullAccessConnectionsOnly, setShowFullAccessConnectionsOnly] = useState(false)
  const [wechatAccountSearch, setWeChatAccountSearch] = useState('')
  const [showUnusedWeChatAccountsOnly, setShowUnusedWeChatAccountsOnly] = useState(false)
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
  const [notificationTriggerTargetId, setNotificationTriggerTargetId] = useState('')
  const [notificationTriggerKind, setNotificationTriggerKind] = useState('automation_run_completed')
  const [notificationTriggerLevel, setNotificationTriggerLevel] = useState('')
  const [notificationTriggerEnabled, setNotificationTriggerEnabled] = useState(true)

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
    const connections = connectionsQuery.data ?? []
    if (!connections.length) {
      if (selectedBotId || selectedConnectionId) {
        setSelectionState({
          selectedBotId: '',
          selectedConnectionId: '',
        })
      }
    }
  }, [connectionsQuery.data, selectedBotId, selectedConnectionId])

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
  const selectedBotWorkspaceId = selectedBot?.workspaceId?.trim() ?? ''
  const selectedBotConnections = connections.filter((connection) => connection.botId === selectedBotId)
  const selectedConnection =
    selectedBotConnections.find((connection) => connection.id === selectedConnectionId) ?? selectedBotConnections[0] ?? null
  const selectedConnectionWorkspaceId = selectedConnection?.workspaceId?.trim() ?? selectedBotWorkspaceId
  const selectedProvider =
    selectedConnection?.provider?.trim().toLowerCase() === 'wechat'
      ? 'wechat'
      : selectedConnection?.provider?.trim().toLowerCase() === 'telegram'
        ? 'telegram'
        : ''
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
  const hasOutboundComposerMediaAdvisories = outboundComposerMediaDrafts.some((draft) => {
    const advisories = outboundComposerMediaAdvisories.get(draft.id) ?? []
    return advisories.length > 0
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
  const botTriggersQuery = useQuery({
    queryKey: ['bot-triggers', selectedBotWorkspaceId, selectedBotId],
    queryFn: () => listBotTriggers(selectedBotWorkspaceId, selectedBotId),
    enabled: selectedBotWorkspaceId.length > 0 && selectedBotId.length > 0,
    staleTime: 5_000,
  })

  const conversations = conversationsQuery.data ?? []
  const selectedBotBindings = botBindingsQuery.data ?? []
  const botDeliveryTargets = botDeliveryTargetsQuery.data ?? []
  const botOutboundDeliveries = botOutboundDeliveriesQuery.data ?? []
  const selectedBotTriggers = botTriggersQuery.data ?? []
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
      ])
    },
  })

  const createBotMutation = useMutation({
    mutationFn: ({ workspaceId, input }: { workspaceId: string; input: CreateBotInput }) =>
      createBot(workspaceId, input),
    onSuccess: async (bot) => {
      setCreateBotModalOpen(false)
      setCreateBotWorkspaceId('')
      setCreateBotNameDraft('')
      setCreateBotDescriptionDraft('')
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
    onSuccess: async (_, variables) => {
      closeOutboundComposer(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
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
    onSuccess: async (_, variables) => {
      closeOutboundComposer(true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['bot-connections'] }),
        queryClient.invalidateQueries({ queryKey: ['bot-conversations'] }),
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
      await queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] })
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
      await queryClient.invalidateQueries({ queryKey: ['bot-delivery-targets', variables.workspaceId, variables.botId] })
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
        queryClient.invalidateQueries({ queryKey: ['bot-triggers', variables.workspaceId, variables.botId] }),
      ])
    },
  })

  const createBotTriggerMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      input,
    }: {
      workspaceId: string
      botId: string
      input: { deliveryTargetId: string; filter?: Record<string, string>; enabled: boolean }
    }) =>
      createBotTrigger(workspaceId, botId, {
        type: 'notification',
        deliveryTargetId: input.deliveryTargetId,
        filter: input.filter,
        enabled: input.enabled,
      }),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-triggers', variables.workspaceId, variables.botId] })
    },
  })

  const updateBotTriggerMutation = useMutation({
    mutationFn: ({
      workspaceId,
      botId,
      triggerId,
      input,
    }: {
      workspaceId: string
      botId: string
      triggerId: string
      input: { deliveryTargetId: string; filter?: Record<string, string>; enabled?: boolean }
    }) => updateBotTrigger(workspaceId, botId, triggerId, input),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-triggers', variables.workspaceId, variables.botId] })
    },
  })

  const deleteBotTriggerMutation = useMutation({
    mutationFn: ({ workspaceId, botId, triggerId }: { workspaceId: string; botId: string; triggerId: string }) =>
      deleteBotTrigger(workspaceId, botId, triggerId),
    onSuccess: async (_, variables) => {
      await queryClient.invalidateQueries({ queryKey: ['bot-triggers', variables.workspaceId, variables.botId] })
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
      await queryClient.invalidateQueries({ queryKey: ['bot-conversations', variables.workspaceId, variables.connectionId] })
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections'] })
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections'] })
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
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['bot-connections'] })
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
  const selectedWorkspaceFilter = workspaceById.get(workspaceFilterId) ?? null
  const selectedBotWorkspace = selectedBotWorkspaceId ? workspaceById.get(selectedBotWorkspaceId) ?? null : null
  const selectedConnectionWorkspace =
    selectedConnectionWorkspaceId ? workspaceById.get(selectedConnectionWorkspaceId) ?? null : null
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
  const conversationById = useMemo(
    () => new Map(conversations.map((conversation) => [conversation.id, conversation])),
    [conversations],
  )
  const selectedConnectionDeliveryTargets = selectedConnection
    ? botDeliveryTargets.filter((target) => target.endpointId === selectedConnection.id)
    : []
  const selectedConnectionDeliveryTargetIDs = useMemo(
    () => new Set(selectedConnectionDeliveryTargets.map((target) => target.id)),
    [selectedConnectionDeliveryTargets],
  )
  const selectedConnectionTriggers = useMemo(
    () =>
      selectedBotTriggers.filter((trigger: BotTrigger) =>
        selectedConnectionDeliveryTargetIDs.has(trigger.deliveryTargetId),
      ),
    [selectedBotTriggers, selectedConnectionDeliveryTargetIDs],
  )
  const selectedConnectionOutboundDeliveries = selectedConnection
    ? botOutboundDeliveries.filter((delivery) => delivery.endpointId === selectedConnection.id)
    : []
  const deliveryTargetByID = useMemo(() => new Map(botDeliveryTargets.map((target) => [target.id, target])), [botDeliveryTargets])
  const deliveryTargetByConversationId = useMemo(
    () =>
      new Map(
        selectedConnectionDeliveryTargets
          .filter((target) => target.targetType === 'session_backed' && (target.sessionId?.trim() ?? '') !== '')
          .map((target) => [target.sessionId?.trim() ?? '', target] as const),
      ),
    [selectedConnectionDeliveryTargets],
  )
  const savedDeliveryTargetByRouteSignature = useMemo(
    () =>
      new Map(
        selectedConnectionDeliveryTargets.flatMap((target) => {
          if (!isSavedBotDeliveryTarget(target)) {
            return []
          }
          const signature = buildBotDeliveryTargetRouteSignature(target)
          if (!signature) {
            return []
          }
          return [[signature, target] as const]
        }),
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
    if (!selectedConnectionDeliveryTargets.length) {
      if (notificationTriggerTargetId) {
        setNotificationTriggerTargetId('')
      }
      return
    }
    if (
      !notificationTriggerTargetId ||
      !selectedConnectionDeliveryTargets.some((target) => target.id === notificationTriggerTargetId)
    ) {
      setNotificationTriggerTargetId(selectedConnectionDeliveryTargets[0].id)
    }
  }, [notificationTriggerTargetId, selectedConnectionDeliveryTargets])

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

  const notificationTriggerTargetOptions = useMemo(
    () =>
      selectedConnectionDeliveryTargets.map((target) => ({
        value: target.id,
        label: `${formatBotDeliveryTargetLabel(target)} | ${formatBotDeliveryRouteLabel(target.routeType)}`,
      })),
    [selectedConnectionDeliveryTargets],
  )

  const notificationTriggerKindOptions = useMemo(
    () => [
      {
        value: '',
        label: i18n._({ id: 'All notification kinds', message: 'All notification kinds' }),
      },
      {
        value: 'automation_run_completed',
        label: i18n._({ id: 'Automation Completed', message: 'Automation Completed' }),
      },
      {
        value: 'automation_run_failed',
        label: i18n._({ id: 'Automation Failed', message: 'Automation Failed' }),
      },
      {
        value: 'automation_run_skipped',
        label: i18n._({ id: 'Automation Skipped', message: 'Automation Skipped' }),
      },
    ],
    [],
  )

  const notificationTriggerLevelOptions = useMemo(
    () => [
      {
        value: '',
        label: i18n._({ id: 'All levels', message: 'All levels' }),
      },
      {
        value: 'success',
        label: i18n._({ id: 'Success', message: 'Success' }),
      },
      {
        value: 'warning',
        label: i18n._({ id: 'Warning', message: 'Warning' }),
      },
      {
        value: 'error',
        label: i18n._({ id: 'Error', message: 'Error' }),
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
    () => buildKnownRouteTargetOptions(selectedProvider, routeTargetRouteType, conversations),
    [conversations, routeTargetRouteType, selectedProvider],
  )
  const knownRouteTargetSelectOptions = useMemo(
    () => [
      {
        value: '',
        label: i18n._({ id: 'Select a recent recipient', message: 'Select a recent recipient' }),
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
  const selectedBotActiveConnectionsCount = selectedBotConnections.filter((connection) => connection.status === 'active').length
  const selectedConnectionReadyRecipientsCount = selectedConnectionDeliveryTargets.filter((target) =>
    isBotDeliveryTargetReady(target),
  ).length
  const selectedConnectionWaitingRecipientsCount =
    selectedConnectionDeliveryTargets.length - selectedConnectionReadyRecipientsCount
  const selectedConnectionEnabledTriggerCount = selectedConnectionTriggers.filter((trigger) => trigger.enabled).length
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
  const selectedConnectionBoundConversationCount = conversations.filter(
    (conversation) => resolveBotConversationThreadTarget(conversation).threadId.length > 0,
  ).length
  const selectedConnectionLatestOutboundDelivery = selectedConnectionOutboundDeliveries[0] ?? null
  const selectedConnectionLatestDeliveredOutboundDelivery =
    selectedConnectionOutboundDeliveries.find(
      (delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'delivered',
    ) ?? null
  const recentSelectedConnectionOutboundDeliveries = selectedConnectionOutboundDeliveries.slice(0, 12)
  const routeTargetRouteKeyPreview =
    routeTargetRouteType === 'telegram_topic'
      ? routeTargetChatId.trim() && routeTargetThreadId.trim()
        ? `chat:${routeTargetChatId.trim()}:thread:${routeTargetThreadId.trim()}`
        : ''
      : routeTargetRouteType === 'wechat_session'
        ? routeTargetChatId.trim()
          ? `user:${routeTargetChatId.trim()}`
          : ''
      : routeTargetChatId.trim()
        ? `chat:${routeTargetChatId.trim()}`
        : ''
  const selectedBotPrimaryBackend =
    selectedDefaultBinding?.aiBackend?.trim() || selectedBotConnections[0]?.aiBackend?.trim() || ''
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
  const connectionModalBot =
    isEditingConnection && editTarget?.botId
      ? bots.find((bot) => bot.id === editTarget.botId) ?? selectedBot
      : selectedBot
  const connectionModalWorkspace = connectionModalBot
    ? workspaceById.get(connectionModalBot.workspaceId) ?? null
    : selectedWorkspaceFilter
  const connectionModalBaselineKey = connectionModalBaselineDraft ? serializeBotsPageDraft(connectionModalBaselineDraft) : ''
  const connectionModalDraftKey = serializeBotsPageDraft(draft)
  const isConnectionModalDirty = createModalOpen && connectionModalBaselineKey !== '' && connectionModalDraftKey !== connectionModalBaselineKey
  const isSaveConnectionDisabled = isEditingConnection && !isConnectionModalDirty
  const formErrorMessage =
    formError || (isEditingConnection ? getErrorMessage(updateMutation.error) : getErrorMessage(createMutation.error))
  const createBotFormErrorMessage = createBotFormError || getErrorMessage(createBotMutation.error)
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
  const deliveryTargetsErrorMessage = botDeliveryTargetsQuery.error ? getErrorMessage(botDeliveryTargetsQuery.error) : ''
  const outboundDeliveriesErrorMessage = botOutboundDeliveriesQuery.error
    ? getErrorMessage(botOutboundDeliveriesQuery.error)
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
            id: 'Create a saved contact for this endpoint. Choose a recent contact or enter a new destination ID, then open advanced options only if you need extra routing settings.',
            message:
              'Create a saved contact for this endpoint. Choose a recent contact or enter a new destination ID, then open advanced options only if you need extra routing settings.',
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
    getErrorMessage(sendSessionOutboundMessageMutation.error) ||
    getErrorMessage(sendDeliveryTargetOutboundMessageMutation.error)
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
  const botTriggersErrorMessage = botTriggersQuery.error ? getErrorMessage(botTriggersQuery.error) : ''
  const createBotTriggerErrorMessage = createBotTriggerMutation.error
    ? getErrorMessage(createBotTriggerMutation.error)
    : ''
  const updateBotTriggerErrorMessage = updateBotTriggerMutation.error
    ? getErrorMessage(updateBotTriggerMutation.error)
    : ''
  const deleteBotTriggerErrorMessage = deleteBotTriggerMutation.error
    ? getErrorMessage(deleteBotTriggerMutation.error)
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
  const selectedConnectionSupportsRouteTargetConfig = selectedProvider === 'telegram' || selectedProvider === 'wechat'

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
  const filteredSavedWeChatAccounts = useMemo(
    () =>
      savedWeChatAccounts.filter((account) => {
        if (workspaceFilterId.trim() && account.workspaceId !== workspaceFilterId.trim()) {
          return false
        }
        if (!matchesWeChatAccountSearch(account, wechatAccountSearch)) {
          return false
        }
        if (!showUnusedWeChatAccountsOnly) {
          return true
        }
        return (savedWeChatAccountConnections.get(account.id) ?? []).length === 0
      }),
    [
      savedWeChatAccountConnections,
      savedWeChatAccounts,
      showUnusedWeChatAccountsOnly,
      wechatAccountSearch,
      workspaceFilterId,
    ],
  )
  const filteredBotConnections = useMemo(
    () =>
      selectedBotConnections.filter((connection) => {
        if (!showFullAccessConnectionsOnly) {
          return true
        }
        if (isOutboundMode) {
          return connection.status === 'active'
        }
        return (
          connection.aiBackend === 'workspace_thread' &&
          isBotWorkspacePermissionPresetFullAccess(connection.aiConfig?.permission_preset)
        )
      }),
    [isOutboundMode, selectedBotConnections, showFullAccessConnectionsOnly],
  )
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
  const botDirectorySectionTitle = isConfigMode
    ? i18n._({ id: 'Bots', message: 'Bots' })
    : i18n._({ id: 'Outbound Bots', message: 'Outbound Bots' })
  const botDirectorySectionDescription = isConfigMode
    ? i18n._({
        id: 'Search by bot name, endpoint name, provider, backend, status, or linked WeChat account metadata.',
        message:
          'Search by bot name, endpoint name, provider, backend, status, or linked WeChat account metadata.',
      })
    : i18n._({
        id: 'Search the outbound directory by bot, endpoint, provider, or linked account metadata, then focus on bots that still have active send surfaces.',
        message:
          'Search the outbound directory by bot, endpoint, provider, or linked account metadata, then focus on bots that still have active send surfaces.',
      })
  const endpointDirectorySectionTitle = isConfigMode
    ? i18n._({ id: 'Endpoints', message: 'Endpoints' })
    : i18n._({ id: 'Outbound Endpoints', message: 'Outbound Endpoints' })
  const endpointDirectorySectionDescription = isConfigMode
    ? i18n._({
        id: 'After selecting a bot, keep using endpoints as the execution units for provider delivery, runtime settings, logs, and conversations.',
        message:
          'After selecting a bot, keep using endpoints as the execution units for provider delivery, runtime settings, logs, and conversations.',
      })
    : i18n._({
        id: 'After selecting a bot, choose the endpoint that should own recipients, delivery history, and manual proactive sends.',
        message:
          'After selecting a bot, choose the endpoint that should own recipients, delivery history, and manual proactive sends.',
      })
  const directoryFilterLabel = isConfigMode
    ? i18n._({ id: 'Only Show Full Access', message: 'Only Show Full Access' })
    : i18n._({ id: 'Only Show Active Endpoints', message: 'Only Show Active Endpoints' })
  const directoryFilterDescription = isConfigMode
    ? i18n._({
        id: 'Restrict the bot list to entries that include at least one workspace-thread endpoint with full-access execution.',
        message:
          'Restrict the bot list to entries that include at least one workspace-thread endpoint with full-access execution.',
      })
    : i18n._({
        id: 'Restrict both bot and endpoint directories to entries that still expose an active endpoint for outbound operations.',
        message:
          'Restrict both bot and endpoint directories to entries that still expose an active endpoint for outbound operations.',
      })
  const activeBotsCount = filteredBots.filter((bot) => bot.status === 'active').length
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
  const selectedDeliveryModeLabel =
    selectedDeliveryMode === 'polling'
      ? i18n._({ id: 'Long Polling', message: 'Long Polling' })
      : selectedDeliveryMode === 'webhook'
        ? i18n._({ id: 'Webhook', message: 'Webhook' })
        : i18n._({ id: 'None', message: 'None' })
  const selectedCommandOutputModeLabel = formatBotCommandOutputModeLabel(selectedCommandOutputMode)
  const selectedBotDefaultBindingModeLabel =
    selectedBotDefaultBindingMode === 'fixed_thread'
      ? i18n._({ id: 'Fixed Thread', message: 'Fixed Thread' })
      : selectedBotDefaultBindingMode === 'stateless'
        ? i18n._({ id: 'Stateless', message: 'Stateless' })
        : selectedBot
          ? i18n._({ id: 'Workspace Auto Thread', message: 'Workspace Auto Thread' })
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
    ? formatLocalizedStatusLabel(draft.wechatLoginStatus)
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
    void queryClient.invalidateQueries({ queryKey: ['wechat-accounts'] })
  }, [activeWeChatLoginStatus, draft.workspaceId, queryClient])

  useEffect(() => {
    setConnectionSearch('')
    setWeChatAccountSearch('')
    setShowUnusedWeChatAccountsOnly(false)
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
  }, [filteredBots, bots.length, selectedBotId, selectedConnectionId])

  useEffect(() => {
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
  }, [selectedBotConnections, selectedBotId, selectedConnectionId])

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

  function openCreateBotModal() {
    createBotMutation.reset()
    setCreateBotFormError('')
    setCreateBotWorkspaceId(
      workspaceFilterId.trim() || selectedBotWorkspaceId || selectedConnectionWorkspaceId || workspaces[0]?.id || '',
    )
    setCreateBotNameDraft('')
    setCreateBotDescriptionDraft('')
    setCreateBotModalOpen(true)
  }

  function closeCreateBotModal() {
    if (createBotMutation.isPending) {
      return
    }
    setCreateBotModalOpen(false)
    setCreateBotWorkspaceId('')
    setCreateBotFormError('')
    setCreateBotNameDraft('')
    setCreateBotDescriptionDraft('')
    createBotMutation.reset()
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

    setCreateBotFormError('')
    createBotMutation.mutate({
      workspaceId: ownerWorkspaceId,
      input: {
        name: createBotNameDraft.trim(),
        description: createBotDescriptionDraft.trim(),
      },
    })
  }

  function openCreateModal() {
    if (!selectedBot) {
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
      workspaceId: selectedBot.workspaceId,
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
    if (!selectedBot) {
      setFormError(
        i18n._({
          id: 'Select a bot before creating an endpoint from a saved WeChat account.',
          message: 'Select a bot before creating an endpoint from a saved WeChat account.',
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
      workspaceId: selectedBot.workspaceId,
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

    if (!isEditingConnection && !connectionModalBot) {
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
      botId: connectionModalBot?.id,
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

  function buildNotificationTriggerFilter() {
    const filter: Record<string, string> = {}
    if (notificationTriggerKind.trim()) {
      filter.kind = notificationTriggerKind.trim()
    }
    if (notificationTriggerLevel.trim()) {
      filter.level = notificationTriggerLevel.trim()
    }
    return Object.keys(filter).length ? filter : undefined
  }

  function handleCreateNotificationTrigger() {
    if (!selectedBot || !selectedConnection || createBotTriggerMutation.isPending || !notificationTriggerTargetId.trim()) {
      return
    }

    createBotTriggerMutation.mutate({
      workspaceId: selectedBotWorkspaceId,
      botId: selectedBot.id,
      input: {
        deliveryTargetId: notificationTriggerTargetId.trim(),
        filter: buildNotificationTriggerFilter(),
        enabled: notificationTriggerEnabled,
      },
    })
  }

  function handleToggleNotificationTrigger(trigger: BotTrigger) {
    if (!selectedBot || updateBotTriggerMutation.isPending) {
      return
    }

    updateBotTriggerMutation.mutate({
      workspaceId: selectedBotWorkspaceId,
      botId: selectedBot.id,
      triggerId: trigger.id,
      input: {
        deliveryTargetId: trigger.deliveryTargetId,
        enabled: !trigger.enabled,
      },
    })
  }

  function handleDeleteNotificationTrigger(trigger: BotTrigger) {
    if (!selectedBot || deleteBotTriggerMutation.isPending) {
      return
    }

    deleteBotTriggerMutation.mutate({
      workspaceId: selectedBotWorkspaceId,
      botId: selectedBot.id,
      triggerId: trigger.id,
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

  function openBindingModal(conversation: BotConversation) {
    updateConversationBindingMutation.reset()
    clearConversationBindingMutation.reset()
    const currentTarget = resolveBotConversationThreadTarget(conversation)
    const currentThreadId = currentTarget.threadId.trim()
    setBindingTarget(conversation)
    setBindingMode(currentThreadId ? 'existing' : 'new')
    setBindingWorkspaceId(currentTarget.workspaceId.trim() || conversation.workspaceId)
    setBindingThreadId(currentThreadId)
    setBindingThreadSearch('')
    setBindingTitle('')
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

  function openDefaultBindingModal() {
    if (!selectedBot || !canConfigureDefaultBinding) {
      return
    }
    updateBotDefaultBindingMutation.reset()
    setDefaultBindingMode(selectedDefaultBinding?.bindingMode === 'fixed_thread' ? 'fixed_thread' : 'workspace_auto_thread')
    setDefaultBindingWorkspaceId(selectedDefaultBinding?.targetWorkspaceId?.trim() || selectedBot.workspaceId)
    setDefaultBindingThreadId(selectedDefaultBinding?.targetThreadId?.trim() ?? '')
    setDefaultBindingThreadSearch('')
    setDefaultBindingModalOpen(true)
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

  function openRouteTargetModal(target?: BotDeliveryTarget, mode?: RouteTargetModalMode) {
    if (!selectedConnection || !selectedBot || !selectedConnectionSupportsRouteTargetConfig) {
      return
    }
    upsertDeliveryTargetMutation.reset()
    updateDeliveryTargetMutation.reset()
    setRouteTargetFormError('')
    const sourceTarget = target ?? null
    const resolvedMode =
      mode ?? (isSavedBotDeliveryTarget(sourceTarget) ? 'edit' : sourceTarget ? 'save_from_existing' : 'create')
    const editableTarget = resolvedMode === 'edit' && isSavedBotDeliveryTarget(sourceTarget) ? sourceTarget : null
    const telegramRouteFields = parseTelegramRouteKey(sourceTarget?.routeType, sourceTarget?.routeKey)
    const nextRouteType =
      sourceTarget?.routeType?.trim() === 'telegram_topic'
        ? 'telegram_topic'
        : sourceTarget?.routeType?.trim() === 'wechat_session'
          ? 'wechat_session'
          : selectedProvider === 'wechat'
            ? 'wechat_session'
            : 'telegram_chat'
    const nextChatId =
      nextRouteType === 'wechat_session'
        ? parseWeChatRouteKey(sourceTarget?.routeKey)
        : telegramRouteFields.chatId
    const nextThreadId = nextRouteType === 'telegram_topic' ? telegramRouteFields.threadId : ''
    const advancedProviderState = stripManagedRouteTargetProviderState(selectedProvider, sourceTarget?.providerState)
    const initialKnownRouteTargetOptions = buildKnownRouteTargetOptions(selectedProvider, nextRouteType, conversations)
    const matchingKnownRouteTarget = findKnownRouteTargetOption(initialKnownRouteTargetOptions, nextChatId, nextThreadId)
    setRouteTargetModalMode(resolvedMode)
    setEditingRouteTarget(editableTarget)
    setRouteTargetTitle(sourceTarget?.title?.trim() ?? '')
    setRouteTargetRouteType(nextRouteType)
    setRouteTargetRecipientMode(
      matchingKnownRouteTarget || (!sourceTarget && initialKnownRouteTargetOptions.length > 0) ? 'existing' : 'manual',
    )
    setRouteTargetSuggestedRecipientValue(matchingKnownRouteTarget?.value ?? '')
    setRouteTargetChatId(nextChatId)
    setRouteTargetThreadId(nextThreadId)
    setRouteTargetAdvancedOpen(
      sourceTarget?.status?.trim() === 'paused' ||
        Boolean(sourceTarget?.labels?.length) ||
        Boolean(sourceTarget?.capabilities?.length) ||
        Boolean(advancedProviderState && Object.keys(advancedProviderState).length > 0),
    )
    setRouteTargetStatus(sourceTarget?.status?.trim() === 'paused' ? 'paused' : 'active')
    setRouteTargetLabelsDraft(formatCommaSeparatedValues(sourceTarget?.labels))
    setRouteTargetCapabilitiesDraft(formatCommaSeparatedValues(sourceTarget?.capabilities))
    setRouteTargetProviderStateDraft(stringifyProviderState(advancedProviderState))
    setRouteTargetModalOpen(true)
  }

  function closeRouteTargetModal(force = false) {
    if (!force && isRouteTargetMutationPending) {
      return
    }
    setRouteTargetModalOpen(false)
    setRouteTargetModalMode('create')
    setEditingRouteTarget(null)
    setRouteTargetTitle('')
    setRouteTargetRouteType('telegram_chat')
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

  function openNewRouteTargetModal() {
    openRouteTargetModal(undefined, 'create')
  }

  function openEditRouteTargetModal(target: BotDeliveryTarget) {
    openRouteTargetModal(target, 'edit')
  }

  function openSaveRouteTargetModal(target: BotDeliveryTarget) {
    openRouteTargetModal(target, 'save_from_existing')
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
          id: 'Select a recent recipient or switch to manual entry.',
          message: 'Select a recent recipient or switch to manual entry.',
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
    if (routeTargetRouteType === 'telegram_topic' && !threadId) {
      setRouteTargetFormError(
        i18n._({
          id: 'Thread ID is required for Telegram topic targets.',
          message: 'Thread ID is required for Telegram topic targets.',
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
      routeTargetRouteType === 'telegram_topic'
        ? `chat:${chatId}:thread:${threadId}`
        : routeTargetRouteType === 'wechat_session'
          ? `user:${chatId}`
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

  function openOutboundComposer(conversation: BotConversation) {
    resetOutboundComposerFeedback()
    setOutboundComposerDeliveryTarget(null)
    setOutboundComposerTarget(conversation)
    setOutboundComposerText('')
    setOutboundComposerMediaDrafts([])
  }

  function openOutboundComposerForDeliveryTarget(target: BotDeliveryTarget) {
    resetOutboundComposerFeedback()
    setOutboundComposerTarget(null)
    setOutboundComposerDeliveryTarget(target)
    setOutboundComposerText('')
    setOutboundComposerMediaDrafts([])
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
          : i18n._({ id: 'Create Endpoint', message: 'Create Endpoint' })}
      </Button>
    </>
  )

  const bindingModalFooter = (
    <>
      <Button disabled={isBindingMutationPending} intent="secondary" onClick={closeBindingModal} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      {bindingTarget?.threadId ? (
        <Button
          disabled={isBindingMutationPending}
          intent="secondary"
          isLoading={clearConversationBindingMutation.isPending}
          onClick={handleClearBinding}
          type="button"
        >
          {i18n._({ id: 'Clear Binding', message: 'Clear Binding' })}
        </Button>
      ) : null}
      <Button
        disabled={isBindingMutationPending || (bindingMode === 'existing' && !bindingThreadId.trim())}
        isLoading={updateConversationBindingMutation.isPending}
        onClick={handleSubmitBinding}
        type="button"
      >
        {bindingMode === 'new'
          ? i18n._({ id: 'Create And Bind', message: 'Create And Bind' })
          : i18n._({ id: 'Update Binding', message: 'Update Binding' })}
      </Button>
    </>
  )

  const defaultBindingModalFooter = (
    <>
      <Button disabled={isDefaultBindingMutationPending} intent="secondary" onClick={closeDefaultBindingModal} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={isDefaultBindingMutationPending || (defaultBindingMode === 'fixed_thread' && !defaultBindingThreadId.trim())}
        isLoading={updateBotDefaultBindingMutation.isPending}
        onClick={handleSubmitDefaultBinding}
        type="button"
      >
        {i18n._({ id: 'Save Default Binding', message: 'Save Default Binding' })}
      </Button>
    </>
  )

  const routeTargetModalFooter = (
    <>
      <Button disabled={isRouteTargetMutationPending} intent="secondary" onClick={() => closeRouteTargetModal()} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={
          !selectedConnectionSupportsRouteTargetConfig ||
          !routeTargetChatId.trim() ||
          (routeTargetRouteType === 'telegram_topic' && !routeTargetThreadId.trim())
        }
        isLoading={isRouteTargetMutationPending}
        onClick={handleSubmitRouteTarget}
        type="button"
      >
        {routeTargetSubmitLabel}
      </Button>
    </>
  )

  const isOutboundComposerSubmitDisabled =
    isSendOutboundMessagePending ||
    (!outboundComposerText.trim() && outboundComposerMedia.length === 0) ||
    hasIncompleteOutboundComposerMediaDrafts ||
    hasInvalidOutboundComposerMediaDrafts ||
    hasUnsupportedOutboundComposerMediaDrafts
  const outboundComposerCanAttachMedia =
    outboundComposerSupportedMediaKinds.length > 0 && outboundComposerSupportedMediaSources.length > 0
  const outboundComposerShowsAttachmentEditor =
    outboundComposerCanAttachMedia || outboundComposerMediaDrafts.length > 0
  const outboundComposerSupportedMediaKindSummary = outboundComposerSupportedMediaKinds
    .map((kind) => formatOutboundComposerMediaKindLabel(kind))
    .join(', ')
  const outboundComposerSupportedMediaSourceSummary = outboundComposerSupportedMediaSources
    .map((source) => formatOutboundComposerMediaSourceLabel(source))
    .join(', ')
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

  const outboundComposerModalFooter = (
    <>
      <Button disabled={isSendOutboundMessagePending} intent="secondary" onClick={() => closeOutboundComposer()} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={isOutboundComposerSubmitDisabled}
        isLoading={isSendOutboundMessagePending}
        onClick={handleSubmitOutboundComposer}
        type="button"
      >
        {i18n._({ id: 'Send Message', message: 'Send Message' })}
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

  const pageEyebrow = isConfigMode
    ? i18n._({ id: 'Bots', message: 'Bots' })
    : i18n._({ id: 'Bot Outbound', message: 'Bot Outbound' })
  const pageTitle = isConfigMode
    ? i18n._({ id: 'Bot Integrations', message: 'Bot Integrations' })
    : i18n._({ id: 'Bot Outbound Operations', message: 'Bot Outbound Operations' })
  const pageDescription = isConfigMode
    ? i18n._({
        id: 'Connect Telegram or WeChat bots, choose the right delivery posture for each provider, then route replies through Workspace Thread or OpenAI Responses.',
        message:
          'Connect Telegram or WeChat bots, choose the right delivery posture for each provider, then route replies through Workspace Thread or OpenAI Responses.',
      })
    : i18n._({
        id: 'Review proactive recipients, send manual outbound messages, and inspect outbound delivery history without mixing those workflows into the bot configuration surface.',
        message:
          'Review proactive recipients, send manual outbound messages, and inspect outbound delivery history without mixing those workflows into the bot configuration surface.',
      })
  const selectedPageQuery = buildBotsPageSelectionSearch({
    workspaceFilterId,
    selectedBotId,
    selectedConnectionId,
  })
  const configBotsPageRoute = selectedPageQuery ? `/bots?${selectedPageQuery}` : '/bots'
  const outboundBotsPageRoute = selectedPageQuery ? `/bots/outbound?${selectedPageQuery}` : '/bots/outbound'
  const peerBotsPageRoute = isConfigMode ? outboundBotsPageRoute : configBotsPageRoute
  const detailSectionTitle = isConfigMode
    ? i18n._({ id: 'Endpoint Detail', message: 'Endpoint Detail' })
    : i18n._({ id: 'Outbound Operations', message: 'Outbound Operations' })
  const detailSectionDescription = isConfigMode
    ? i18n._({
        id: 'Select an endpoint to inspect provider status, delivery posture, AI backend settings, logs, and conversation bindings.',
        message:
          'Select an endpoint to inspect provider status, delivery posture, AI backend settings, logs, and conversation bindings.',
      })
    : i18n._({
        id: 'Select an endpoint to manage recipients, review delivery readiness, inspect recent outbound history, and trigger manual sends.',
        message:
          'Select an endpoint to manage recipients, review delivery readiness, inspect recent outbound history, and trigger manual sends.',
      })
  const conversationSectionTitle = isConfigMode
    ? i18n._({ id: 'Conversation Bindings', message: 'Conversation Bindings' })
    : i18n._({ id: 'Recent Conversations', message: 'Recent Conversations' })
  const conversationSectionDescription = isConfigMode
    ? i18n._({
        id: 'Each external chat keeps a conversation record with its last inbound and outbound message plus an optional internal thread binding.',
        message:
          'Each external chat keeps a conversation record with its last inbound and outbound message plus an optional internal thread binding.',
      })
    : i18n._({
        id: 'Browse recent chats on this endpoint, inspect their latest inbound and outbound activity, and start a manual send without leaving the outbound workspace.',
        message:
          'Browse recent chats on this endpoint, inspect their latest inbound and outbound activity, and start a manual send without leaving the outbound workspace.',
      })

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">{pageEyebrow}</div>
          <div className="mode-strip__title-row">
            <strong>{pageTitle}</strong>
          </div>
          <div className="mode-strip__description">{pageDescription}</div>
          <div className="segmented-control" style={{ marginTop: '14px', width: 'fit-content' }}>
            <Button
              aria-pressed={isConfigMode}
              className={isConfigMode ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
              intent={isConfigMode ? 'secondary' : 'ghost'}
              onClick={() => navigate(configBotsPageRoute)}
              type="button"
            >
              {i18n._({ id: 'Configuration', message: 'Configuration' })}
            </Button>
            <Button
              aria-pressed={isOutboundMode}
              className={isOutboundMode ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
              intent={isOutboundMode ? 'secondary' : 'ghost'}
              onClick={() => navigate(outboundBotsPageRoute)}
              type="button"
            >
              {i18n._({ id: 'Outbound', message: 'Outbound' })}
            </Button>
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>{i18n._({ id: 'Bots', message: 'Bots' })}</span>
              <strong>{bots.length}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: 'Endpoints', message: 'Endpoints' })}</span>
              <strong>{connections.length}</strong>
            </div>
            <div className="mode-metric">
              <span>
                {isConfigMode
                  ? i18n._({ id: 'Conversations', message: 'Conversations' })
                  : i18n._({ id: 'Recipients', message: 'Recipients' })}
              </span>
              <strong>{isConfigMode ? totalBotConversationCount : selectedConnectionDeliveryTargets.length}</strong>
            </div>
          </div>
          {isConfigMode ? (
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button intent="secondary" onClick={openCreateBotModal}>
                {i18n._({ id: 'New Bot', message: 'New Bot' })}
              </Button>
              <Button disabled={!selectedBot} onClick={openCreateModal}>
                {i18n._({ id: 'New Endpoint', message: 'New Endpoint' })}
              </Button>
            </div>
          ) : null}
        </div>
      </header>

      <div className="mode-layout">
        <aside className="mode-rail">
          <section className="mode-panel">
            <div className="section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2>{i18n._({ id: 'Workspace Filter', message: 'Workspace Filter' })}</h2>
                <HelpTooltip
                  content={i18n._({
                    id: 'Browse bots across all workspaces, then optionally narrow the directory to one owner workspace. Binding targets can still point at a different workspace.',
                    message:
                      'Browse bots across all workspaces, then optionally narrow the directory to one owner workspace. Binding targets can still point at a different workspace.',
                  })}
                />
              </div>
            </div>
            <label className="field">
              <span>{i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}
                fullWidth
                onChange={(nextValue) => {
                  setSelectionState({
                    workspaceFilterId: nextValue,
                    selectedBotId: '',
                    selectedConnectionId: '',
                  })
                }}
                options={[
                  {
                    value: '',
                    label: i18n._({ id: 'All Workspaces', message: 'All Workspaces' }),
                  },
                  ...workspaces.map((workspace) => ({
                    value: workspace.id,
                    label: workspace.name,
                  })),
                ]}
                value={workspaceFilterId}
              />
            </label>
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Current Filter', message: 'Current Filter' })}</span>
                <strong>{selectedWorkspaceFilter?.name ?? i18n._({ id: 'All workspaces', message: 'All workspaces' })}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Visible Active Bots', message: 'Visible Active Bots' })}</span>
                <strong>{activeBotsCount}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Selected Bot', message: 'Selected Bot' })}</span>
                <strong>{selectedBot?.name ?? i18n._({ id: 'None', message: 'None' })}</strong>
              </div>
            </div>
          </section>

          <section className="mode-panel">
            <div className="section-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2>
                  {isConfigMode
                    ? i18n._({ id: 'Selected Bot', message: 'Selected Bot' })
                    : i18n._({ id: 'Outbound Focus', message: 'Outbound Focus' })}
                </h2>
                <HelpTooltip
                  content={
                    isConfigMode
                      ? i18n._({
                          id: 'Bots are the first routing layer. Each bot can own one or more endpoints and a default binding that decides how new conversations resolve internally.',
                          message:
                            'Bots are the first routing layer. Each bot can own one or more endpoints and a default binding that decides how new conversations resolve internally.',
                        })
                      : i18n._({
                          id: 'Outbound mode keeps the same bot and endpoint selection, but this panel stays focused on recipient readiness, recent deliveries, and quick operational actions.',
                          message:
                            'Outbound mode keeps the same bot and endpoint selection, but this panel stays focused on recipient readiness, recent deliveries, and quick operational actions.',
                        })
                  }
                />
              </div>
            </div>
            {isConfigMode ? (
              !selectedBot ? (
                <div className="empty-state">
                  {i18n._({
                    id: 'Select a bot to inspect its default routing and endpoint coverage.',
                    message: 'Select a bot to inspect its default routing and endpoint coverage.',
                  })}
                </div>
              ) : (
                <>
                  <div
                    style={{
                      alignItems: 'start',
                      display: 'flex',
                      gap: '16px',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'grid', gap: '6px' }}>
                      <strong dir="auto">{selectedBot.name}</strong>
                      <span>{selectedBotWorkspace?.name ?? selectedBot.workspaceId}</span>
                    </div>
                    <StatusPill status={selectedBot.status} />
                  </div>
                  <div className="mode-metrics">
                    <div className="mode-metric">
                      <span>{i18n._({ id: 'Endpoints', message: 'Endpoints' })}</span>
                      <strong>{selectedBotConnections.length}</strong>
                    </div>
                    <div className="mode-metric">
                      <span>{i18n._({ id: 'Active', message: 'Active' })}</span>
                      <strong>{selectedBotActiveConnectionsCount}</strong>
                    </div>
                    <div className="mode-metric">
                      <span>{i18n._({ id: 'Conversations', message: 'Conversations' })}</span>
                      <strong>{selectedBot.conversationCount}</strong>
                    </div>
                  </div>
                  <div className="detail-list">
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Default Binding', message: 'Default Binding' })}</span>
                      <strong>{selectedBotDefaultBindingModeLabel}</strong>
                    </div>
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}</span>
                      <strong>
                        {selectedBotDefaultBindingMode === 'stateless'
                          ? i18n._({ id: 'No workspace thread target', message: 'No workspace thread target' })
                          : selectedBotDefaultBindingWorkspaceId}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Binding Target', message: 'Binding Target' })}</span>
                      <strong>
                        {selectedBotDefaultBindingMode === 'fixed_thread' && selectedBotDefaultBindingThreadId ? (
                          <Link
                            to={buildWorkspaceThreadRoute(
                              selectedBotDefaultBindingWorkspaceId,
                              selectedBotDefaultBindingThreadId,
                            )}
                          >
                            {selectedBotDefaultBindingWorkspaceId !== selectedBot.workspaceId
                              ? `${selectedBotDefaultBindingWorkspaceId} / ${selectedBotDefaultBindingThreadId}`
                              : selectedBotDefaultBindingThreadId}
                          </Link>
                        ) : selectedBotDefaultBindingMode === 'stateless' ? (
                          i18n._({ id: 'No workspace thread target', message: 'No workspace thread target' })
                        ) : (
                          i18n._({
                            id: 'Resolve a workspace thread from conversation context',
                            message: 'Resolve a workspace thread from conversation context',
                          })
                        )}
                      </strong>
                    </div>
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Updated', message: 'Updated' })}</span>
                      <strong>{formatBotTimestamp(selectedBot.updatedAt)}</strong>
                    </div>
                  </div>
                  {botBindingsQuery.error ? (
                    <InlineNotice
                      dismissible
                      noticeKey={`bot-bindings-${selectedBot.id}-${getErrorMessage(botBindingsQuery.error)}`}
                      onRetry={() => void botBindingsQuery.refetch()}
                      title={i18n._({ id: 'Failed To Load Bot Bindings', message: 'Failed To Load Bot Bindings' })}
                      tone="error"
                    >
                      {getErrorMessage(botBindingsQuery.error)}
                    </InlineNotice>
                  ) : null}
                  {selectedBotPrimaryBackend === 'openai_responses' ? (
                    <div className="notice">
                      {i18n._({
                        id: 'This bot currently resolves through OpenAI Responses endpoints, so its default binding stays stateless and does not target a workspace thread.',
                        message:
                          'This bot currently resolves through OpenAI Responses endpoints, so its default binding stays stateless and does not target a workspace thread.',
                      })}
                    </div>
                  ) : null}
                  {botBindingsQuery.isLoading ? (
                    <div className="notice">
                      {i18n._({ id: 'Loading bot bindings...', message: 'Loading bot bindings...' })}
                    </div>
                  ) : null}
                  <Button
                    disabled={!canConfigureDefaultBinding}
                    intent="secondary"
                    onClick={openDefaultBindingModal}
                    type="button"
                  >
                    {i18n._({ id: 'Manage Default Binding', message: 'Manage Default Binding' })}
                  </Button>
                </>
              )
            ) : !selectedConnection ? (
              <div className="empty-state">
                {i18n._({
                  id: 'Select an endpoint to review recipient readiness, recent manual sends, and delivery history.',
                  message: 'Select an endpoint to review recipient readiness, recent manual sends, and delivery history.',
                })}
              </div>
            ) : (
              <>
                <div
                  style={{
                    alignItems: 'start',
                    display: 'flex',
                    gap: '16px',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'grid', gap: '6px' }}>
                    <strong dir="auto">{selectedConnection.name}</strong>
                    <span dir="auto">
                      {selectedBot?.name ?? i18n._({ id: 'No bot selected', message: 'No bot selected' })}
                    </span>
                  </div>
                  <StatusPill status={selectedConnection.status} />
                </div>
                <div className="mode-metrics">
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Recipients', message: 'Recipients' })}</span>
                    <strong>{selectedConnectionDeliveryTargets.length}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Deliveries', message: 'Deliveries' })}</span>
                    <strong>{selectedConnectionOutboundDeliveries.length}</strong>
                  </div>
                  <div className="mode-metric">
                    <span>{i18n._({ id: 'Conversations', message: 'Conversations' })}</span>
                    <strong>{conversations.length}</strong>
                  </div>
                </div>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
                    <strong>{selectedConnectionWorkspace?.name ?? selectedConnection.workspaceId}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
                    <strong>{formatBotProviderLabel(selectedConnection.provider)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Ready Recipients', message: 'Ready Recipients' })}</span>
                    <strong>{selectedConnectionReadyRecipientsCount}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Failed Deliveries', message: 'Failed Deliveries' })}</span>
                    <strong>{selectedConnectionFailedOutboundCount}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Last Delivery', message: 'Last Delivery' })}</span>
                    <strong>
                      {selectedConnectionLatestOutboundDelivery
                        ? formatBotTimestamp(selectedConnectionLatestOutboundDelivery.createdAt)
                        : i18n._({ id: 'none', message: 'none' })}
                    </strong>
                  </div>
                </div>
              </>
            )}
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2>{botDirectorySectionTitle}</h2>
                    <HelpTooltip content={botDirectorySectionDescription} />
                  </div>
                  <div className="section-header__meta">{filteredBots.length}</div>
                </div>

                <Input
                  label={i18n._({ id: 'Search Bots', message: 'Search Bots' })}
                  onChange={(event) => setConnectionSearch(event.target.value)}
                  placeholder={
                    isConfigMode
                      ? i18n._({
                          id: 'Support bot, telegram, openai, support queue',
                          message: 'Support bot, telegram, openai, support queue',
                        })
                      : i18n._({
                          id: 'Ops bot, telegram, alerts endpoint',
                          message: 'Ops bot, telegram, alerts endpoint',
                        })
                  }
                  value={connectionSearch}
                />

                <Switch
                  checked={showFullAccessConnectionsOnly}
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {directoryFilterLabel}
                      <HelpTooltip content={directoryFilterDescription} />
                    </div>
                  }
                  onChange={(event) => setShowFullAccessConnectionsOnly(event.target.checked)}
                />

                {botsQuery.isLoading || connectionsQuery.isLoading ? (
                  <div className="notice">
                    {i18n._({ id: 'Loading bots...', message: 'Loading bots...' })}
                  </div>
                ) : null}

                {!botsQuery.isLoading && !connectionsQuery.isLoading && !bots.length ? (
                  <div className="empty-state">
                    {isConfigMode
                      ? i18n._({
                          id: 'No bots yet. Create a bot first, then attach one or more Telegram or WeChat endpoints to it.',
                          message:
                            'No bots yet. Create a bot first, then attach one or more Telegram or WeChat endpoints to it.',
                        })
                      : i18n._({
                          id: 'No outbound bots are ready yet. Create a bot, attach an endpoint, then return here to manage recipients and deliveries.',
                          message:
                            'No outbound bots are ready yet. Create a bot, attach an endpoint, then return here to manage recipients and deliveries.',
                        })}
                  </div>
                ) : null}

                {!botsQuery.isLoading && !connectionsQuery.isLoading && bots.length > 0 && !filteredBots.length ? (
                  <div className="empty-state">
                    {showFullAccessConnectionsOnly
                      ? isConfigMode
                        ? i18n._({
                            id: 'No bots with full-access endpoints match the current search and filters.',
                            message: 'No bots with full-access endpoints match the current search and filters.',
                          })
                        : i18n._({
                            id: 'No bots with active endpoints match the current search and filters.',
                            message: 'No bots with active endpoints match the current search and filters.',
                          })
                      : i18n._({
                          id: 'No bots match the current search.',
                          message: 'No bots match the current search.',
                        })}
                  </div>
                ) : null}

                <div className="automation-compact-list">
                  {filteredBots.map((bot) => {
                    const botConnections = connectionsByBotId.get(bot.id) ?? []
                    const activeEndpointCount = botConnections.filter((connection) => connection.status === 'active').length
                    const outboundBotStats = outboundDirectoryStatsByBotID.get(bot.id) ?? {
                      endpointCount: botConnections.length,
                      activeEndpointCount,
                      deliveryTargetCount: 0,
                      readyRecipientCount: 0,
                      waitingRecipientCount: 0,
                      outboundDeliveryCount: 0,
                      manualOutboundCount: 0,
                      failedOutboundCount: 0,
                      latestOutboundCreatedAt: '',
                    }
                    const botUsesFullAccess = botConnections.some(
                      (connection) =>
                        connection.aiBackend === 'workspace_thread' &&
                        isBotWorkspacePermissionPresetFullAccess(connection.aiConfig?.permission_preset),
                    )
                    const botPrimaryBackend = botConnections[0]?.aiBackend?.trim() ?? ''
                    const botDefaultBindingMode =
                      bot.defaultBindingMode?.trim() || (botPrimaryBackend === 'openai_responses' ? 'stateless' : 'workspace_auto_thread')
                    const botDefaultBindingLabel =
                      botDefaultBindingMode === 'fixed_thread'
                        ? i18n._({ id: 'Fixed Thread', message: 'Fixed Thread' })
                        : botDefaultBindingMode === 'stateless'
                          ? i18n._({ id: 'Stateless', message: 'Stateless' })
                          : i18n._({ id: 'Workspace Auto Thread', message: 'Workspace Auto Thread' })
                    return (
                      <div
                        className={[
                          'automation-compact-row',
                          selectedBotId === bot.id ? 'automation-compact-row--active' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        key={bot.id}
                      >
                        <button
                          aria-pressed={selectedBotId === bot.id}
                          className="automation-compact-row__main"
                          onClick={() => selectBot(bot)}
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
                          <strong dir="auto">{bot.name}</strong>
                          {isConfigMode ? (
                            <span>
                              {i18n._({
                                id: '{count} endpoint(s) | {conversationCount} conversation(s) | {bindingLabel}',
                                message: '{count} endpoint(s) | {conversationCount} conversation(s) | {bindingLabel}',
                                values: {
                                  count: botConnections.length,
                                  conversationCount: bot.conversationCount,
                                  bindingLabel: botDefaultBindingLabel,
                                },
                              })}
                            </span>
                          ) : (
                            <span>
                              {i18n._({
                                id: '{count} endpoint(s) | {recipientCount} recipient(s) | {deliveryCount} delivery(ies)',
                                message: '{count} endpoint(s) | {recipientCount} recipient(s) | {deliveryCount} delivery(ies)',
                                values: {
                                  count: botConnections.length,
                                  recipientCount: outboundBotStats.deliveryTargetCount,
                                  deliveryCount: outboundBotStats.outboundDeliveryCount,
                                },
                              })}
                            </span>
                          )}
                          {bot.description?.trim() ? <span>{bot.description.trim()}</span> : null}
                          {botConnections[0] ? (
                            isConfigMode ? (
                              <span>
                                {workspaceById.get(bot.workspaceId)?.name ?? bot.workspaceId} |{' '}
                                {formatBotProviderLabel(botConnections[0].provider)} |{' '}
                                {formatBotBackendLabel(botConnections[0].aiBackend)} |{' '}
                                {formatBotTimestamp(bot.updatedAt)}
                              </span>
                            ) : (
                              <span>
                                {workspaceById.get(bot.workspaceId)?.name ?? bot.workspaceId} |{' '}
                                {i18n._({
                                  id: 'Active endpoints: {count}',
                                  message: 'Active endpoints: {count}',
                                  values: { count: outboundBotStats.activeEndpointCount },
                                })}{' '}
                                |{' '}
                                {outboundBotStats.latestOutboundCreatedAt
                                  ? formatBotTimestamp(outboundBotStats.latestOutboundCreatedAt)
                                  : i18n._({ id: 'No deliveries yet', message: 'No deliveries yet' })}
                              </span>
                            )
                          ) : null}
                          {isConfigMode && botUsesFullAccess ? (
                            <div className="automation-compact-row__meta">
                              <span className="meta-pill meta-pill--danger">
                                {i18n._({ id: 'Has Full Access Endpoint', message: 'Has Full Access Endpoint' })}
                              </span>
                              <span className="meta-pill">
                                {i18n._({
                                  id: 'Active Endpoints: {count}',
                                  message: 'Active Endpoints: {count}',
                                  values: { count: activeEndpointCount },
                                })}
                              </span>
                            </div>
                          ) : null}
                          {isOutboundMode &&
                          (outboundBotStats.readyRecipientCount > 0 ||
                            outboundBotStats.failedOutboundCount > 0 ||
                            outboundBotStats.manualOutboundCount > 0) ? (
                            <div className="automation-compact-row__meta">
                              <span className="meta-pill">
                                {i18n._({
                                  id: 'Ready recipients: {count}',
                                  message: 'Ready recipients: {count}',
                                  values: { count: outboundBotStats.readyRecipientCount },
                                })}
                              </span>
                              {outboundBotStats.manualOutboundCount > 0 ? (
                                <span className="meta-pill">
                                  {i18n._({
                                    id: 'Manual sends: {count}',
                                    message: 'Manual sends: {count}',
                                    values: { count: outboundBotStats.manualOutboundCount },
                                  })}
                                </span>
                              ) : null}
                              {outboundBotStats.failedOutboundCount > 0 ? (
                                <span className="meta-pill meta-pill--warning">
                                  {i18n._({
                                    id: 'Failed deliveries: {count}',
                                    message: 'Failed deliveries: {count}',
                                    values: { count: outboundBotStats.failedOutboundCount },
                                  })}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </button>
                        <div className="automation-compact-row__actions">
                          <StatusPill status={bot.status} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </section>

              <section className="content-section">
                <div className="section-header section-header--inline">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2>{endpointDirectorySectionTitle}</h2>
                    <HelpTooltip content={endpointDirectorySectionDescription} />
                  </div>
                  <div style={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
                    <div className="section-header__meta">{filteredBotConnections.length}</div>
                    {isConfigMode ? (
                      <Button disabled={!selectedBot} onClick={openCreateModal} size="sm" type="button">
                        {i18n._({ id: 'New Endpoint', message: 'New Endpoint' })}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {!selectedBot ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'Select a bot first, then choose which endpoint you want to inspect.',
                      message: 'Select a bot first, then choose which endpoint you want to inspect.',
                    })}
                  </div>
                ) : null}

                {selectedBot && !selectedBotConnections.length ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'This bot does not have any endpoints yet.',
                      message: 'This bot does not have any endpoints yet.',
                    })}
                  </div>
                ) : null}

                {selectedBotConnections.length > 0 && !filteredBotConnections.length ? (
                  <div className="empty-state">
                    {showFullAccessConnectionsOnly
                      ? isConfigMode
                        ? i18n._({
                            id: 'No full-access endpoints match the current filters for this bot.',
                            message: 'No full-access endpoints match the current filters for this bot.',
                          })
                        : i18n._({
                            id: 'No active endpoints match the current filters for this bot.',
                            message: 'No active endpoints match the current filters for this bot.',
                          })
                      : i18n._({
                          id: 'No endpoints match the current filters for this bot.',
                          message: 'No endpoints match the current filters for this bot.',
                        })}
                  </div>
                ) : null}

                {filteredBotConnections.length ? (
                  <div className="automation-compact-list">
                    {filteredBotConnections.map((connection) => {
                      const linkedWeChatAccount = linkedWeChatAccountByConnectionID.get(connection.id) ?? null
                      const outboundConnectionStats = outboundDirectoryStatsByConnectionID.get(connection.id) ?? {
                        deliveryTargetCount: 0,
                        readyRecipientCount: 0,
                        waitingRecipientCount: 0,
                        outboundDeliveryCount: 0,
                        manualOutboundCount: 0,
                        failedOutboundCount: 0,
                        latestOutboundCreatedAt: '',
                      }
                      const connectionUsesFullAccess =
                        connection.aiBackend === 'workspace_thread' &&
                        isBotWorkspacePermissionPresetFullAccess(connection.aiConfig?.permission_preset)
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
                            onClick={() => selectConnection(connection)}
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
                            <strong dir="auto">{connection.name}</strong>
                            {isConfigMode ? (
                              <span>
                                {formatBotProviderLabel(connection.provider)} | {formatBotBackendLabel(connection.aiBackend)} |{' '}
                                {formatBotTimestamp(connection.updatedAt)}
                              </span>
                            ) : (
                              <span>
                                {formatBotProviderLabel(connection.provider)} |{' '}
                                {outboundConnectionStats.deliveryTargetCount > 0 ||
                                outboundConnectionStats.outboundDeliveryCount > 0
                                  ? i18n._({
                                      id: '{readyCount}/{recipientCount} recipient(s) ready | {manualCount} manual send(s) | {deliveryCount} delivery(ies)',
                                      message:
                                        '{readyCount}/{recipientCount} recipient(s) ready | {manualCount} manual send(s) | {deliveryCount} delivery(ies)',
                                      values: {
                                        readyCount: outboundConnectionStats.readyRecipientCount,
                                        recipientCount: outboundConnectionStats.deliveryTargetCount,
                                        manualCount: outboundConnectionStats.manualOutboundCount,
                                        deliveryCount: outboundConnectionStats.outboundDeliveryCount,
                                      },
                                    })
                                  : i18n._({
                                      id: 'No recipients or proactive deliveries recorded yet.',
                                      message: 'No recipients or proactive deliveries recorded yet.',
                                    })}
                              </span>
                            )}
                            {linkedWeChatAccount ? (
                              <span>
                                {i18n._({ id: 'Saved Account', message: 'Saved Account' })}:{' '}
                                {formatWeChatAccountLabel(linkedWeChatAccount)}
                                {linkedWeChatAccount.note?.trim() ? ` | ${linkedWeChatAccount.note.trim()}` : ''}
                              </span>
                            ) : null}
                            {isConfigMode && (connectionUsesFullAccess || recentSuppressionSummary.suppressedCount > 0) ? (
                              <div className="automation-compact-row__meta">
                                {connectionUsesFullAccess ? (
                                  <span className="meta-pill meta-pill--danger">
                                    {formatBotWorkspacePermissionPresetLabel(connection.aiConfig?.permission_preset)}
                                  </span>
                                ) : null}
                                {recentSuppressionSummary.suppressedCount > 0 ? (
                                  <span className="meta-pill meta-pill--warning">
                                    {i18n._({
                                      id: 'Suppressed 24h: {count}',
                                      message: 'Suppressed 24h: {count}',
                                      values: { count: recentSuppressionSummary.suppressedCount },
                                    })}
                                  </span>
                                ) : null}
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
                            {isOutboundMode &&
                            (outboundConnectionStats.deliveryTargetCount > 0 ||
                              outboundConnectionStats.failedOutboundCount > 0 ||
                              outboundConnectionStats.latestOutboundCreatedAt) ? (
                              <div className="automation-compact-row__meta">
                                <span className="meta-pill">
                                  {i18n._({
                                    id: 'Ready: {readyCount}/{recipientCount}',
                                    message: 'Ready: {readyCount}/{recipientCount}',
                                    values: {
                                      readyCount: outboundConnectionStats.readyRecipientCount,
                                      recipientCount: outboundConnectionStats.deliveryTargetCount,
                                    },
                                  })}
                                </span>
                                {outboundConnectionStats.waitingRecipientCount > 0 ? (
                                  <span className="meta-pill">
                                    {i18n._({
                                      id: 'Waiting: {count}',
                                      message: 'Waiting: {count}',
                                      values: { count: outboundConnectionStats.waitingRecipientCount },
                                    })}
                                  </span>
                                ) : null}
                                {outboundConnectionStats.failedOutboundCount > 0 ? (
                                  <span className="meta-pill meta-pill--warning">
                                    {i18n._({
                                      id: 'Failed: {count}',
                                      message: 'Failed: {count}',
                                      values: { count: outboundConnectionStats.failedOutboundCount },
                                    })}
                                  </span>
                                ) : null}
                                {outboundConnectionStats.latestOutboundCreatedAt ? (
                                  <span className="meta-pill">
                                    {formatBotTimestamp(outboundConnectionStats.latestOutboundCreatedAt)}
                                  </span>
                                ) : null}
                              </div>
                            ) : null}
                          </button>
                          <div className="automation-compact-row__actions">
                            <StatusPill status={connection.status} />
                            {isConfigMode ? (
                              <Button intent="ghost" onClick={() => openEditModal(connection)} type="button">
                                {i18n._({ id: 'Edit', message: 'Edit' })}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}
              </section>

              {isConfigMode ? (
                <section className="content-section">
                  <div className="section-header section-header--inline">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2>{i18n._({ id: 'Saved WeChat Accounts', message: 'Saved WeChat Accounts' })}</h2>
                    <HelpTooltip
                      content={i18n._({
                        id: 'Confirmed WeChat QR logins remain workspace-owned, but this directory shows every saved account and can be narrowed with the workspace filter.',
                        message:
                          'Confirmed WeChat QR logins remain workspace-owned, but this directory shows every saved account and can be narrowed with the workspace filter.',
                      })}
                    />
                  </div>
                  <div className="section-header__meta">{filteredSavedWeChatAccounts.length}</div>
                </div>

                <Input
                  label={i18n._({ id: 'Search Saved Accounts', message: 'Search Saved Accounts' })}
                  onChange={(event) => setWeChatAccountSearch(event.target.value)}
                  placeholder={i18n._({ id: 'Support, acct_123, wechat.example.com', message: 'Support, acct_123, wechat.example.com' })}
                  value={wechatAccountSearch}
                />

                <Switch
                  checked={showUnusedWeChatAccountsOnly}
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Only Show Unbound Accounts', message: 'Only Show Unbound Accounts' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Show only saved WeChat accounts that are not currently linked to any visible bot connection.',
                          message:
                            'Show only saved WeChat accounts that are not currently linked to any visible bot connection.',
                        })}
                      />
                    </div>
                  }
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
                      id: 'No saved WeChat accounts yet. Complete one confirmed QR login to save an account for reuse.',
                      message:
                        'No saved WeChat accounts yet. Complete one confirmed QR login to save an account for reuse.',
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
                        <div className="directory-item__icon">{i18n._({ id: 'WX', message: 'WX' })}</div>
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
                                      <strong dir="auto">{connection.name}</strong>
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
                                        onClick={() => selectConnection(connection)}
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
                            <Button
                              disabled={!selectedBot}
                              intent="secondary"
                              onClick={() => openCreateModalWithSavedWeChatAccount(account)}
                              type="button"
                            >
                              {i18n._({ id: 'Use For New Endpoint', message: 'Use For New Endpoint' })}
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
              ) : null}

              <section className="content-section">
                <div className="section-header section-header--inline">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h2>{detailSectionTitle}</h2>
                    <HelpTooltip content={detailSectionDescription} />
                  </div>
                </div>

                {!selectedConnection ? (
                  <div className="empty-state">
                    {i18n._({
                      id: 'No endpoint selected.',
                      message: 'No endpoint selected.',
                    })}
                  </div>
                ) : (
                  <div className="stack-screen">
                    {isConfigMode ? (
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
                            <strong dir="auto">{selectedConnection.name}</strong>
                            <span>
                              {selectedConnectionWorkspace?.name ?? selectedConnection.workspaceId} |{' '}
                              {formatBotProviderLabel(selectedConnection.provider)} |{' '}
                              {formatBotBackendLabel(selectedConnection.aiBackend)}
                            </span>
                          </div>
                          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            <StatusPill status={selectedConnection.status} />
                            {selectedConnection.aiBackend === 'workspace_thread' &&
                            isBotWorkspacePermissionPresetFullAccess(selectedConnection.aiConfig?.permission_preset) ? (
                              <span className="meta-pill meta-pill--danger">
                                {formatBotWorkspacePermissionPresetLabel(
                                  selectedConnection.aiConfig?.permission_preset,
                                )}
                              </span>
                            ) : null}
                            <Button intent="secondary" onClick={() => openEditModal(selectedConnection)} type="button">
                              {i18n._({ id: 'Edit', message: 'Edit' })}
                            </Button>
                            <Button
                              intent="secondary"
                              onClick={() => navigate(`/bots/${selectedConnection.id}/logs`)}
                              type="button"
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
                              type="button"
                            >
                              {selectedConnection.status === 'active'
                                ? i18n._({ id: 'Pause', message: 'Pause' })
                                : i18n._({ id: 'Resume', message: 'Resume' })}
                            </Button>
                            <Button
                              className="ide-button--ghost-danger"
                              intent="ghost"
                              onClick={() => setDeleteTarget(selectedConnection)}
                              type="button"
                            >
                              {i18n._({ id: 'Delete', message: 'Delete' })}
                            </Button>
                          </div>
                        </div>
                      </section>
                    ) : null}

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
                            id: 'The backend suppressed {count} replay attempt(s) for this endpoint in the last 24 hours to avoid duplicating previously sent content.',
                            message:
                              'The backend suppressed {count} replay attempt(s) for this endpoint in the last 24 hours to avoid duplicating previously sent content.',
                            values: { count: selectedConnectionSuppressionSummary.suppressedCount },
                          })}
                        </InlineNotice>
                    ) : null}

                    {isOutboundMode && selectedConnection.status !== 'active' ? (
                      <InlineNotice
                        dismissible
                        noticeKey={`bot-outbound-paused-${selectedConnection.id}-${selectedConnection.status}`}
                        title={i18n._({ id: 'Outbound Sending Paused', message: 'Outbound Sending Paused' })}
                      >
                        {i18n._({
                          id: 'This endpoint is not active, so manual proactive sends stay disabled until you resume it from the Configuration tab.',
                          message:
                            'This endpoint is not active, so manual proactive sends stay disabled until you resume it from the Configuration tab.',
                        })}
                      </InlineNotice>
                    ) : null}

                    <section
                      className={isConfigMode ? 'mode-panel' : 'mode-panel mode-panel--compact'}
                      style={isOutboundMode ? { order: 40 } : undefined}
                    >
                      <div className={isConfigMode ? 'section-header' : 'section-header section-header--inline'}>
                        <div>
                          <h2>
                            {isConfigMode
                              ? i18n._({ id: 'Configuration Summary', message: 'Configuration Summary' })
                              : i18n._({ id: 'Outbound Summary', message: 'Outbound Summary' })}
                          </h2>
                          {isOutboundMode ? (
                            <p dir="auto">
                              {selectedConnection.name} | {selectedConnectionWorkspace?.name ?? selectedConnection.workspaceId}
                            </p>
                          ) : null}
                        </div>
                        {isOutboundMode ? (
                          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                            <StatusPill status={selectedConnection.status} />
                            <Button
                              intent="secondary"
                              onClick={() => navigate(`/bots/${selectedConnection.id}/logs`)}
                              size="sm"
                              type="button"
                            >
                              {i18n._({ id: 'View Logs', message: 'View Logs' })}
                            </Button>
                          </div>
                        ) : null}
                      </div>
                      <div className="detail-list">
                        <div className="detail-row">
                          <span>{i18n._({ id: 'Endpoint ID', message: 'Endpoint ID' })}</span>
                          <strong>{selectedConnection.id}</strong>
                        </div>
                        {isConfigMode ? (
                          <>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Status', message: 'Status' })}</span>
                              <strong>{formatLocalizedStatusLabel(selectedConnection.status)}</strong>
                            </div>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
                              <strong>{formatBotProviderLabel(selectedConnection.provider)}</strong>
                            </div>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Delivery Mode', message: 'Delivery Mode' })}</span>
                              <strong>{selectedDeliveryModeLabel}</strong>
                            </div>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Capabilities', message: 'Capabilities' })}</span>
                              <strong>{summarizeBotConnectionCapabilities(selectedConnection.capabilities)}</strong>
                            </div>
                            <div className="detail-row">
                              <span>{i18n._({ id: 'AI Backend', message: 'AI Backend' })}</span>
                              <strong>{formatBotBackendLabel(selectedConnection.aiBackend)}</strong>
                            </div>
                            {selectedConnection.aiBackend === 'workspace_thread' ? (
                              <div className="detail-row">
                                <span>{i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}</span>
                                <strong>
                                  {formatBotWorkspacePermissionPresetLabel(
                                    selectedConnection.aiConfig?.permission_preset,
                                  )}
                                </strong>
                              </div>
                            ) : null}
                            <div className="detail-row">
                              <span>{i18n._({ id: 'Runtime Mode', message: 'Runtime Mode' })}</span>
                              <strong>
                                {selectedRuntimeMode === 'debug'
                                  ? i18n._({ id: 'Debug', message: 'Debug' })
                                  : i18n._({ id: 'Normal', message: 'Normal' })}
                              </strong>
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
                                  <strong>
                                    {selectedConnection.lastPollMessage?.trim() || i18n._({ id: 'none', message: 'none' })}
                                  </strong>
                                </div>
                              </>
                            ) : null}
                          </>
                        ) : (
                          <details className="config-details-box">
                            <summary className="config-details-box__summary">
                              <span className="config-details-box__summary-copy">
                                <span className="config-details-box__summary-title">
                                  {i18n._({
                                    id: '{recipientCount} recipient(s) | {deliveryCount} delivery(ies) | {conversationCount} conversation(s)',
                                    message:
                                      '{recipientCount} recipient(s) | {deliveryCount} delivery(ies) | {conversationCount} conversation(s)',
                                    values: {
                                      recipientCount: selectedConnectionDeliveryTargets.length,
                                      deliveryCount: selectedConnectionOutboundDeliveries.length,
                                      conversationCount: conversations.length,
                                    },
                                  })}
                                </span>
                                <small className="config-details-box__summary-description">
                                  {i18n._({
                                    id: 'Ready: {readyCount} | Waiting: {waitingCount} | Failed: {failedCount} | Updated {updatedAt}',
                                    message:
                                      'Ready: {readyCount} | Waiting: {waitingCount} | Failed: {failedCount} | Updated {updatedAt}',
                                    values: {
                                      readyCount: selectedConnectionReadyRecipientsCount,
                                      waitingCount: selectedConnectionWaitingRecipientsCount,
                                      failedCount: selectedConnectionFailedOutboundCount,
                                      updatedAt: formatBotTimestamp(selectedConnection.updatedAt),
                                    },
                                  })}
                                </small>
                              </span>
                              <span aria-hidden="true" className="config-details-box__summary-action">
                                <span className="config-details-box__summary-state config-details-box__summary-state--collapsed">
                                  {i18n._({ id: 'Expand', message: 'Expand' })}
                                </span>
                                <span className="config-details-box__summary-state config-details-box__summary-state--expanded">
                                  {i18n._({ id: 'Collapse', message: 'Collapse' })}
                                </span>
                                <svg
                                  className="config-details-box__summary-chevron"
                                  fill="none"
                                  height="14"
                                  stroke="currentColor"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth="1.8"
                                  viewBox="0 0 24 24"
                                  width="14"
                                >
                                  <path d="m7 10 5 5 5-5" />
                                </svg>
                              </span>
                            </summary>
                            <div className="config-details-box__content">
                              <div className="detail-list">
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Conversation Records', message: 'Conversation Records' })}</span>
                                  <strong>{conversations.length}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Manual Send Surface', message: 'Manual Send Surface' })}</span>
                                  <strong>{summarizeBotConnectionCapabilities(selectedConnection.capabilities)}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Threads Resolved', message: 'Threads Resolved' })}</span>
                                  <strong>{selectedConnectionBoundConversationCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Recipients', message: 'Recipients' })}</span>
                                  <strong>{selectedConnectionDeliveryTargets.length}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Ready Recipients', message: 'Ready Recipients' })}</span>
                                  <strong>{selectedConnectionReadyRecipientsCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Waiting for Context', message: 'Waiting for Context' })}</span>
                                  <strong>{selectedConnectionWaitingRecipientsCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Outbound Deliveries', message: 'Outbound Deliveries' })}</span>
                                  <strong>{selectedConnectionOutboundDeliveries.length}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Delivered', message: 'Delivered' })}</span>
                                  <strong>{selectedConnectionDeliveredOutboundCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Manual Sends', message: 'Manual Sends' })}</span>
                                  <strong>{selectedConnectionManualOutboundCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'In Flight', message: 'In Flight' })}</span>
                                  <strong>{selectedConnectionPendingOutboundCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Failed Deliveries', message: 'Failed Deliveries' })}</span>
                                  <strong>{selectedConnectionFailedOutboundCount}</strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Last Delivery', message: 'Last Delivery' })}</span>
                                  <strong>
                                    {selectedConnectionLatestOutboundDelivery
                                      ? formatBotTimestamp(selectedConnectionLatestOutboundDelivery.createdAt)
                                      : i18n._({ id: 'none', message: 'none' })}
                                  </strong>
                                </div>
                                <div className="detail-row">
                                  <span>{i18n._({ id: 'Last Delivered', message: 'Last Delivered' })}</span>
                                  <strong>
                                    {selectedConnectionLatestDeliveredOutboundDelivery?.deliveredAt
                                      ? formatBotTimestamp(selectedConnectionLatestDeliveredOutboundDelivery.deliveredAt)
                                      : i18n._({ id: 'none', message: 'none' })}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          </details>
                        )}
                        {isConfigMode ? (
                          <>
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
                          </>
                        ) : null}
                        {isConfigMode ? (
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Updated', message: 'Updated' })}</span>
                            <strong>{formatBotTimestamp(selectedConnection.updatedAt)}</strong>
                          </div>
                        ) : null}
                      </div>
                    </section>

                    {isConfigMode ? (
                      <section className="mode-panel">
                        <div className="section-header section-header--inline">
                          <div>
                            <h2>{i18n._({ id: 'Default Bot Binding', message: 'Default Bot Binding' })}</h2>
                            <p dir="auto">{selectedBot?.name ?? i18n._({ id: 'None', message: 'None' })}</p>
                          </div>
                          {canConfigureDefaultBinding ? (
                            <Button intent="secondary" onClick={openDefaultBindingModal} type="button">
                              {i18n._({ id: 'Edit', message: 'Edit' })}
                            </Button>
                          ) : null}
                        </div>
                        <div className="detail-list">
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Connections', message: 'Connections' })}</span>
                            <strong>{selectedBotConnections.length}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Active', message: 'Active' })}</span>
                            <strong>{selectedBotActiveConnectionsCount}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Backend', message: 'Backend' })}</span>
                            <strong>
                              {selectedBotPrimaryBackend
                                ? formatBotBackendLabel(selectedBotPrimaryBackend)
                                : i18n._({ id: 'None', message: 'None' })}
                            </strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Binding Mode', message: 'Binding Mode' })}</span>
                            <strong>{selectedBotDefaultBindingModeLabel}</strong>
                          </div>
                          <div className="detail-row">
                            <span>{i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}</span>
                            <strong>
                              {selectedBotDefaultBindingMode === 'fixed_thread' && selectedBotDefaultBindingThreadId ? (
                                <Link
                                  to={buildWorkspaceThreadRoute(
                                    selectedBotDefaultBindingWorkspaceId,
                                    selectedBotDefaultBindingThreadId,
                                  )}
                                >
                                  {selectedBotDefaultBindingWorkspaceId !== (selectedBot?.workspaceId ?? '')
                                    ? `${selectedBotDefaultBindingWorkspaceId} / ${selectedBotDefaultBindingThreadId}`
                                    : selectedBotDefaultBindingThreadId}
                                </Link>
                              ) : selectedBotDefaultBindingMode === 'fixed_thread' ? (
                                i18n._({ id: 'No thread selected', message: 'No thread selected' })
                              ) : selectedBotDefaultBindingMode === 'stateless' ? (
                                i18n._({ id: 'Stateless', message: 'Stateless' })
                              ) : selectedBot ? (
                                i18n._({ id: 'Workspace Auto Thread', message: 'Workspace Auto Thread' })
                              ) : (
                                i18n._({ id: 'None', message: 'None' })
                              )}
                            </strong>
                          </div>
                        </div>
                      </section>
                    ) : null}

                    {isOutboundMode ? (
                      <section className="mode-panel mode-panel--flush">
                      <div className="mode-panel__body">
                        <div className="section-header section-header--inline">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h2>{i18n._({ id: 'Recipients', message: 'Recipients' })}</h2>
                            <HelpTooltip
                              content={i18n._({
                                id: 'Recipients are the proactive send destinations for this endpoint. Recent contacts appear automatically after the first manual send or notification run.',
                                message:
                                  'Recipients are the proactive send destinations for this endpoint. Recent contacts appear automatically after the first manual send or notification run.',
                              })}
                            />
                          </div>
                          <div style={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
                            <div className="section-header__meta">{selectedConnectionDeliveryTargets.length}</div>
                            {selectedConnectionSupportsRouteTargetConfig ? (
                              <Button intent="secondary" onClick={openNewRouteTargetModal} size="sm" type="button">
                                {i18n._({ id: 'New Saved Contact', message: 'New Saved Contact' })}
                              </Button>
                            ) : null}
                          </div>
                        </div>
                        {selectedConnectionDeliveryTargets.length ? (
                          <div className="mode-metrics">
                            <div className="mode-metric">
                              <span>{i18n._({ id: 'Ready', message: 'Ready' })}</span>
                              <strong>{selectedConnectionReadyRecipientsCount}</strong>
                            </div>
                            <div className="mode-metric">
                              <span>{i18n._({ id: 'Waiting', message: 'Waiting' })}</span>
                              <strong>{selectedConnectionWaitingRecipientsCount}</strong>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {deliveryTargetsErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-delivery-targets-${deliveryTargetsErrorMessage}`}
                          onRetry={() => void botDeliveryTargetsQuery.refetch()}
                          title={i18n._({
                            id: 'Failed To Load Recipients',
                            message: 'Failed To Load Recipients',
                          })}
                          tone="error"
                        >
                          {deliveryTargetsErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {deleteDeliveryTargetErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-delete-delivery-target-${deleteDeliveryTargetErrorMessage}`}
                          title={i18n._({
                            id: 'Remove Saved Contact Failed',
                            message: 'Remove Saved Contact Failed',
                          })}
                          tone="error"
                        >
                          {deleteDeliveryTargetErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {botDeliveryTargetsQuery.isLoading && !selectedConnectionDeliveryTargets.length ? (
                        <LoadingState
                          fill={false}
                          message={i18n._({
                            id: 'Loading recipients...',
                            message: 'Loading recipients...',
                          })}
                        />
                      ) : null}

                      {!botDeliveryTargetsQuery.isLoading && !selectedConnectionDeliveryTargets.length ? (
                        <div className="empty-state">
                          {i18n._({
                            id: 'No proactive recipients exist for this endpoint yet. Recent contacts will appear after the first manual send or notification run.',
                            message:
                              'No proactive recipients exist for this endpoint yet. Recent contacts will appear after the first manual send or notification run.',
                          })}
                        </div>
                      ) : null}

                      <div className="directory-list">
                        {selectedConnectionDeliveryTargets.map((target) => {
                          const targetConversation =
                            target.sessionId?.trim() ? conversationById.get(target.sessionId.trim()) ?? null : null
                          const targetThread = targetConversation
                            ? resolveBotConversationThreadTarget(targetConversation)
                            : { workspaceId: '', threadId: '' }
                          const savedContactRouteSignature = buildBotDeliveryTargetRouteSignature(target)
                          const linkedSavedContact =
                            isSavedBotDeliveryTarget(target)
                              ? target
                              : savedContactRouteSignature
                                ? savedDeliveryTargetByRouteSignature.get(savedContactRouteSignature) ?? null
                                : null
                          const isSavedContact = Boolean(linkedSavedContact)
                          const deliveryReadinessLabel = formatBotDeliveryReadinessLabel(target.deliveryReadiness)
                          const targetReadyForSend = isBotDeliveryTargetReady(target)
                          const sendDisabledReason =
                            !targetReadyForSend && target.deliveryReadinessMessage?.trim()
                              ? target.deliveryReadinessMessage.trim()
                              : undefined

                          return (
                            <article className="directory-item" key={target.id}>
                              <div className="directory-item__icon">{i18n._({ id: 'DT', message: 'DT' })}</div>
                              <div className="directory-item__body">
                                <strong>{formatBotDeliveryTargetLabel(target)}</strong>
                                <p>
                                  {i18n._({ id: 'Channel', message: 'Channel' })}: {formatBotDeliveryRouteLabel(target.routeType)}
                                </p>
                                <p>
                                  {i18n._({ id: 'Recipient ID', message: 'Recipient ID' })}:{' '}
                                  {target.routeKey?.trim() || i18n._({ id: 'Not persisted', message: 'Not persisted' })}
                                </p>
                                <p>
                                  {i18n._({ id: 'Delivery readiness', message: 'Delivery readiness' })}: {deliveryReadinessLabel}
                                </p>
                                <p>
                                  {i18n._({ id: 'Contact status', message: 'Contact status' })}:{' '}
                                  {isSavedContact
                                    ? i18n._({ id: 'Saved contact', message: 'Saved contact' })
                                    : i18n._({ id: 'Not saved yet', message: 'Not saved yet' })}
                                </p>
                                {target.capabilities?.length ? (
                                  <p>
                                    {i18n._({ id: 'Capabilities', message: 'Capabilities' })}:{' '}
                                    {target.capabilities.join(', ')}
                                  </p>
                                ) : null}
                                {target.labels?.length ? (
                                  <p>
                                    {i18n._({ id: 'Labels', message: 'Labels' })}: {target.labels.join(', ')}
                                  </p>
                                ) : null}
                                {target.deliveryReadiness?.trim().toLowerCase() !== 'ready' &&
                                target.deliveryReadinessMessage?.trim() ? (
                                  <p>
                                    {target.deliveryReadinessMessage}
                                  </p>
                                ) : null}
                                {target.lastContextSeenAt ? (
                                  <p>
                                    {i18n._({ id: 'Last context seen', message: 'Last context seen' })}:{' '}
                                    {formatBotTimestamp(target.lastContextSeenAt)}
                                  </p>
                                ) : null}
                              </div>
                              <div
                                className="directory-item__meta"
                                style={{ alignItems: 'end', display: 'grid', gap: '8px' }}
                              >
                                <span className="meta-pill">{formatBotTimestamp(target.updatedAt)}</span>
                                <span className="meta-pill" title={sendDisabledReason}>
                                  {deliveryReadinessLabel}
                                </span>
                                <StatusPill status={target.status} />
                                <Button
                                  disabled={selectedConnection?.status !== 'active' || target.status !== 'active' || !targetReadyForSend}
                                  intent="secondary"
                                  onClick={() => openOutboundComposerForDeliveryTarget(target)}
                                  size="sm"
                                  title={sendDisabledReason}
                                  type="button"
                                >
                                  {i18n._({ id: 'Send Message', message: 'Send Message' })}
                                </Button>
                                {isSavedBotDeliveryTarget(target) ? (
                                  <Button intent="ghost" onClick={() => openEditRouteTargetModal(target)} size="sm" type="button">
                                    {i18n._({ id: 'Edit Contact', message: 'Edit Contact' })}
                                  </Button>
                                ) : linkedSavedContact ? (
                                  <Button
                                    intent="ghost"
                                    onClick={() => openEditRouteTargetModal(linkedSavedContact)}
                                    size="sm"
                                    type="button"
                                  >
                                    {i18n._({ id: 'Edit Saved Contact', message: 'Edit Saved Contact' })}
                                  </Button>
                                ) : selectedConnectionSupportsRouteTargetConfig ? (
                                  <Button intent="ghost" onClick={() => openSaveRouteTargetModal(target)} size="sm" type="button">
                                    {i18n._({ id: 'Save Contact', message: 'Save Contact' })}
                                  </Button>
                                ) : null}
                                {isSavedBotDeliveryTarget(target) ? (
                                  <Button
                                    className="ide-button--ghost-danger"
                                    intent="ghost"
                                    onClick={() => setDeleteDeliveryTarget(target)}
                                    size="sm"
                                    type="button"
                                  >
                                    {i18n._({ id: 'Remove Saved Contact', message: 'Remove Saved Contact' })}
                                  </Button>
                                ) : null}
                                {targetThread.threadId ? (
                                  <Link to={buildWorkspaceThreadRoute(targetThread.workspaceId, targetThread.threadId)}>
                                    {i18n._({ id: 'Open Thread', message: 'Open Thread' })}
                                  </Link>
                                ) : null}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                      </section>
                    ) : null}

                    {isConfigMode ? (
                      <section className="mode-panel mode-panel--flush">
                      <div className="mode-panel__body">
                        <div className="section-header section-header--inline">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h2>{i18n._({ id: 'Notification Triggers', message: 'Notification Triggers' })}</h2>
                            <HelpTooltip
                              content={i18n._({
                                id: 'Subscribe this endpoint to workspace notifications. Each trigger listens for notification/created events and forwards matching items to one saved recipient.',
                                message:
                                  'Subscribe this endpoint to workspace notifications. Each trigger listens for notification/created events and forwards matching items to one saved recipient.',
                              })}
                            />
                          </div>
                          <div style={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
                            <div className="section-header__meta">{selectedConnectionTriggers.length}</div>
                            <div className="section-header__meta">
                              {i18n._({
                                id: '{count} enabled',
                                message: '{count} enabled',
                                values: { count: selectedConnectionEnabledTriggerCount },
                              })}
                            </div>
                            <Button intent="secondary" onClick={() => navigate(peerBotsPageRoute)} size="sm" type="button">
                              {i18n._({ id: 'Manage Recipients', message: 'Manage Recipients' })}
                            </Button>
                          </div>
                        </div>

                        <div className="form-row">
                          <label className="field">
                            <span>{i18n._({ id: 'Recipient', message: 'Recipient' })}</span>
                            <SelectControl
                              ariaLabel={i18n._({ id: 'Notification Trigger Recipient', message: 'Notification Trigger Recipient' })}
                              fullWidth
                              onChange={(nextValue) => setNotificationTriggerTargetId(nextValue)}
                              options={
                                notificationTriggerTargetOptions.length
                                  ? notificationTriggerTargetOptions
                                  : [
                                      {
                                        value: '',
                                        label: i18n._({
                                          id: 'No recipients available',
                                          message: 'No recipients available',
                                        }),
                                        disabled: true,
                                      },
                                    ]
                              }
                              value={notificationTriggerTargetId}
                            />
                          </label>
                          <label className="field">
                            <span>{i18n._({ id: 'Kind Filter', message: 'Kind Filter' })}</span>
                            <SelectControl
                              ariaLabel={i18n._({ id: 'Notification Trigger Kind Filter', message: 'Notification Trigger Kind Filter' })}
                              fullWidth
                              onChange={(nextValue) => setNotificationTriggerKind(nextValue)}
                              options={notificationTriggerKindOptions}
                              value={notificationTriggerKind}
                            />
                          </label>
                          <label className="field">
                            <span>{i18n._({ id: 'Level Filter', message: 'Level Filter' })}</span>
                            <SelectControl
                              ariaLabel={i18n._({ id: 'Notification Trigger Level Filter', message: 'Notification Trigger Level Filter' })}
                              fullWidth
                              onChange={(nextValue) => setNotificationTriggerLevel(nextValue)}
                              options={notificationTriggerLevelOptions}
                              value={notificationTriggerLevel}
                            />
                          </label>
                        </div>

                        <div
                          style={{
                            alignItems: 'center',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '12px',
                            justifyContent: 'space-between',
                          }}
                        >
                          <Switch
                            checked={notificationTriggerEnabled}
                            label={i18n._({ id: 'Enable on create', message: 'Enable on create' })}
                            onChange={(event) => setNotificationTriggerEnabled(event.target.checked)}
                          />
                          <Button
                            disabled={!notificationTriggerTargetId.trim() || createBotTriggerMutation.isPending}
                            isLoading={createBotTriggerMutation.isPending}
                            onClick={handleCreateNotificationTrigger}
                            type="button"
                          >
                            {i18n._({ id: 'Add Trigger', message: 'Add Trigger' })}
                          </Button>
                        </div>
                      </div>

                      {botTriggersErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-triggers-${botTriggersErrorMessage}`}
                          onRetry={() => void botTriggersQuery.refetch()}
                          title={i18n._({
                            id: 'Failed To Load Notification Triggers',
                            message: 'Failed To Load Notification Triggers',
                          })}
                          tone="error"
                        >
                          {botTriggersErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {createBotTriggerErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-trigger-create-${createBotTriggerErrorMessage}`}
                          title={i18n._({
                            id: 'Create Trigger Failed',
                            message: 'Create Trigger Failed',
                          })}
                          tone="error"
                        >
                          {createBotTriggerErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {updateBotTriggerErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-trigger-update-${updateBotTriggerErrorMessage}`}
                          title={i18n._({
                            id: 'Update Trigger Failed',
                            message: 'Update Trigger Failed',
                          })}
                          tone="error"
                        >
                          {updateBotTriggerErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {deleteBotTriggerErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-trigger-delete-${deleteBotTriggerErrorMessage}`}
                          title={i18n._({
                            id: 'Delete Trigger Failed',
                            message: 'Delete Trigger Failed',
                          })}
                          tone="error"
                        >
                          {deleteBotTriggerErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {botTriggersQuery.isLoading && !selectedConnectionTriggers.length ? (
                        <LoadingState
                          fill={false}
                          message={i18n._({
                            id: 'Loading notification triggers...',
                            message: 'Loading notification triggers...',
                          })}
                        />
                      ) : null}

                      {!botTriggersQuery.isLoading &&
                      !selectedConnectionTriggers.length &&
                      !selectedConnectionDeliveryTargets.length ? (
                        <div className="empty-state">
                          {i18n._({
                            id: 'Create a recipient first, then attach notification triggers to it.',
                            message: 'Create a recipient first, then attach notification triggers to it.',
                          })}
                        </div>
                      ) : null}

                      {!botTriggersQuery.isLoading &&
                      !selectedConnectionTriggers.length &&
                      selectedConnectionDeliveryTargets.length ? (
                        <div className="empty-state">
                          {i18n._({
                            id: 'No notification triggers are configured for this endpoint yet.',
                            message: 'No notification triggers are configured for this endpoint yet.',
                          })}
                        </div>
                      ) : null}

                      <div className="directory-list">
                        {selectedConnectionTriggers.map((trigger) => {
                          const target = deliveryTargetByID.get(trigger.deliveryTargetId) ?? null
                          return (
                            <article className="directory-item" key={trigger.id}>
                              <div className="directory-item__icon">{i18n._({ id: 'NT', message: 'NT' })}</div>
                              <div className="directory-item__body">
                                <strong>
                                  {target
                                    ? formatBotDeliveryTargetLabel(target)
                                    : trigger.deliveryTargetId}
                                </strong>
                                <p>
                                  {i18n._({ id: 'Type', message: 'Type' })}:{' '}
                                  {humanizeDisplayValue(trigger.type, trigger.type)}
                                </p>
                                <p>
                                  {i18n._({ id: 'Filters', message: 'Filters' })}: {formatBotTriggerFilterSummary(trigger)}
                                </p>
                                {target ? (
                                  <p>
                                    {i18n._({ id: 'Route', message: 'Route' })}:{' '}
                                    {formatBotDeliveryRouteLabel(target.routeType)} | {target.routeKey?.trim() || target.id}
                                  </p>
                                ) : null}
                              </div>
                              <div
                                className="directory-item__meta"
                                style={{ alignItems: 'end', display: 'grid', gap: '8px' }}
                              >
                                <span className="meta-pill">{formatBotTimestamp(trigger.updatedAt)}</span>
                                <StatusPill status={trigger.enabled ? 'active' : 'paused'} />
                                <Button
                                  disabled={updateBotTriggerMutation.isPending}
                                  intent="secondary"
                                  onClick={() => handleToggleNotificationTrigger(trigger)}
                                  size="sm"
                                  type="button"
                                >
                                  {trigger.enabled
                                    ? i18n._({ id: 'Pause', message: 'Pause' })
                                    : i18n._({ id: 'Enable', message: 'Enable' })}
                                </Button>
                                <Button
                                  className="ide-button--ghost-danger"
                                  disabled={deleteBotTriggerMutation.isPending}
                                  intent="ghost"
                                  onClick={() => handleDeleteNotificationTrigger(trigger)}
                                  size="sm"
                                  type="button"
                                >
                                  {i18n._({ id: 'Delete', message: 'Delete' })}
                                </Button>
                              </div>
                            </article>
                          )
                        })}
                      </div>
                      </section>
                    ) : null}

                    {isOutboundMode ? (
                      <section className="mode-panel mode-panel--flush">
                      <div className="mode-panel__body">
                        <div className="section-header section-header--inline">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h2>{i18n._({ id: 'Outbound Deliveries', message: 'Outbound Deliveries' })}</h2>
                            <HelpTooltip
                              content={i18n._({
                                id: 'This feed records proactive sends created by manual actions, notifications, or future automation runs. It is separate from normal inbound reply delivery.',
                                message:
                                  'This feed records proactive sends created by manual actions, notifications, or future automation runs. It is separate from normal inbound reply delivery.',
                              })}
                            />
                          </div>
                          <div className="section-header__meta">{selectedConnectionOutboundDeliveries.length}</div>
                        </div>
                        {selectedConnectionOutboundDeliveries.length ? (
                          <div className="mode-metrics">
                            <div className="mode-metric">
                              <span>{i18n._({ id: 'Delivered', message: 'Delivered' })}</span>
                              <strong>{selectedConnectionDeliveredOutboundCount}</strong>
                            </div>
                            <div className="mode-metric">
                              <span>{i18n._({ id: 'In Flight', message: 'In Flight' })}</span>
                              <strong>{selectedConnectionPendingOutboundCount}</strong>
                            </div>
                            <div className="mode-metric">
                              <span>{i18n._({ id: 'Failed', message: 'Failed' })}</span>
                              <strong>{selectedConnectionFailedOutboundCount}</strong>
                            </div>
                            <div className="mode-metric">
                              <span>{i18n._({ id: 'Manual', message: 'Manual' })}</span>
                              <strong>{selectedConnectionManualOutboundCount}</strong>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {outboundDeliveriesErrorMessage ? (
                        <InlineNotice
                          dismissible
                          noticeKey={`bot-outbound-deliveries-${outboundDeliveriesErrorMessage}`}
                          onRetry={() => void botOutboundDeliveriesQuery.refetch()}
                          title={i18n._({
                            id: 'Failed To Load Outbound Deliveries',
                            message: 'Failed To Load Outbound Deliveries',
                          })}
                          tone="error"
                        >
                          {outboundDeliveriesErrorMessage}
                        </InlineNotice>
                      ) : null}

                      {botOutboundDeliveriesQuery.isLoading && !selectedConnectionOutboundDeliveries.length ? (
                        <LoadingState
                          fill={false}
                          message={i18n._({
                            id: 'Loading outbound deliveries...',
                            message: 'Loading outbound deliveries...',
                          })}
                        />
                      ) : null}

                      {!botOutboundDeliveriesQuery.isLoading && !selectedConnectionOutboundDeliveries.length ? (
                        <div className="empty-state">
                          {i18n._({
                            id: 'No proactive outbound deliveries have been recorded for this endpoint yet.',
                            message: 'No proactive outbound deliveries have been recorded for this endpoint yet.',
                          })}
                        </div>
                      ) : null}

                      <div className="directory-list">
                        {recentSelectedConnectionOutboundDeliveries.map((delivery) => {
                          const deliverySummary =
                            summarizeBotReplyMessages(delivery.messages) ||
                            i18n._({ id: 'No outbound payload recorded.', message: 'No outbound payload recorded.' })
                          const deliveryTarget = delivery.deliveryTargetId
                            ? selectedConnectionDeliveryTargets.find((target) => target.id === delivery.deliveryTargetId) ?? null
                            : null

                          return (
                            <article className="directory-item" key={delivery.id}>
                              <div className="directory-item__icon">{i18n._({ id: 'OD', message: 'OD' })}</div>
                              <div className="directory-item__body">
                                <strong>{deliverySummary}</strong>
                                <p>
                                  {i18n._({ id: 'Source', message: 'Source' })}:{' '}
                                  {delivery.sourceType?.trim() || i18n._({ id: 'manual', message: 'manual' })}
                                </p>
                                {deliveryTarget ? (
                                  <p>
                                    {i18n._({ id: 'Delivery target', message: 'Delivery target' })}:{' '}
                                    {formatBotDeliveryTargetLabel(deliveryTarget)}
                                  </p>
                                ) : null}
                                {delivery.lastError ? (
                                  <p>
                                    {i18n._({ id: 'Last error', message: 'Last error' })}:{' '}
                                    {summarizeBotConversationDeliveryError(delivery.lastError)}
                                  </p>
                                ) : null}
                              </div>
                              <div
                                className="directory-item__meta"
                                style={{ alignItems: 'end', display: 'grid', gap: '8px' }}
                              >
                                <span className="meta-pill">{formatBotTimestamp(delivery.createdAt)}</span>
                                <StatusPill status={delivery.status} />
                                {delivery.deliveredAt ? (
                                  <span className="meta-pill">{formatBotTimestamp(delivery.deliveredAt)}</span>
                                ) : null}
                                {delivery.originWorkspaceId && delivery.originThreadId ? (
                                  <Link to={buildWorkspaceThreadRoute(delivery.originWorkspaceId, delivery.originThreadId)}>
                                    {i18n._({ id: 'Open Origin Thread', message: 'Open Origin Thread' })}
                                  </Link>
                                ) : null}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                      </section>
                    ) : null}

                    {isConfigMode ? (
                      <section className="mode-panel">
                      <div className="section-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h2>{i18n._({ id: 'Runtime Diagnostics', message: 'Runtime Diagnostics' })}</h2>
                          <HelpTooltip
                            content={i18n._({
                              id: 'Debug mode adds detailed backend logs for inbound processing, AI execution, streaming updates, and provider delivery operations.',
                              message:
                                'Debug mode adds detailed backend logs for inbound processing, AI execution, streaming updates, and provider delivery operations.',
                            })}
                          />
                        </div>
                      </div>
                      <Switch
                        checked={selectedRuntimeMode === 'debug'}
                        disabled={runtimeModeMutation.isPending}
                        label={
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {i18n._({ id: 'Enable Backend Debug Logging', message: 'Enable Backend Debug Logging' })}
                            <HelpTooltip
                              content={i18n._({
                                id: 'Use normal mode in routine operation. Enable debug mode temporarily while diagnosing missing output, truncation, or delivery failures.',
                                message:
                                  'Use normal mode in routine operation. Enable debug mode temporarily while diagnosing missing output, truncation, or delivery failures.',
                              })}
                            />
                          </div>
                        }
                        onChange={(event) =>
                          runtimeModeMutation.mutate({
                            workspaceId: selectedConnection.workspaceId,
                            connectionId: selectedConnection.id,
                            runtimeMode: event.target.checked ? 'debug' : 'normal',
                          })
                        }
                      />
                      </section>
                    ) : null}

                    {isConfigMode ? (
                      <section className="mode-panel">
                      <div className="section-header">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <h2>{i18n._({ id: 'Reply Formatting', message: 'Reply Formatting' })}</h2>
                          <HelpTooltip
                            content={i18n._({
                              id: 'Control how workspace command items are summarized when replies are mirrored back into Telegram or WeChat.',
                              message:
                                'Control how workspace command items are summarized when replies are mirrored back into Telegram or WeChat.',
                            })}
                          />
                        </div>
                      </div>
                      <label className="field">
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
                          <HelpTooltip
                            content={
                              <>
                                {i18n._({
                                  id: 'No Command Output omits command items entirely.',
                                  message: 'No Command Output omits command items entirely.',
                                })}{' '}
                                {i18n._({
                                  id: 'Brief keeps command excerpts to roughly 3-5 lines and is the default for new bot connections. Full Output forwards the entire command transcript.',
                                  message:
                                    'Brief keeps command excerpts to roughly 3-5 lines and is the default for new bot connections. Full Output forwards the entire command transcript.',
                                })}
                              </>
                            }
                          />
                        </div>
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
                      {selectedProvider === 'wechat' ? (
                        <Switch
                          checked={selectedWeChatChannelTimingEnabled}
                          disabled={wechatChannelTimingMutation.isPending}
                          label={
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              {i18n._({
                                id: 'Append WeChat Channel Timing',
                                message: 'Append WeChat Channel Timing',
                              })}
                              <HelpTooltip
                                content={i18n._({
                                  id: 'Append the WeChat Channel timing block to final replies. This is independent from backend debug logging; existing connections still inherit debug mode until you change this switch.',
                                  message:
                                    'Append the WeChat Channel timing block to final replies. This is independent from backend debug logging; existing connections still inherit debug mode until you change this switch.',
                                })}
                              />
                            </div>
                          }
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
                    ) : null}

                    <section className="mode-panel mode-panel--flush">
                      <div className="mode-panel__body">
                        <div className="section-header section-header--inline">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h2>{conversationSectionTitle}</h2>
                            <HelpTooltip content={conversationSectionDescription} />
                          </div>
                          <div className="section-header__meta">{conversations.length}</div>
                        </div>
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
                        {conversations.map((conversation) => {
                          const effectiveThreadTarget = resolveBotConversationThreadTarget(conversation)
                          const hasEffectiveThreadTarget = effectiveThreadTarget.threadId.length > 0
                          const bindingSourceLabel = formatBotConversationBindingSourceLabel(conversation)
                          const bindingModeLabel = formatBotConversationBindingModeLabel(conversation)
                          const sessionDeliveryTarget = deliveryTargetByConversationId.get(conversation.id) ?? null
                          const bindingTargetLabel = hasEffectiveThreadTarget
                            ? effectiveThreadTarget.workspaceId !== conversation.workspaceId
                              ? `${effectiveThreadTarget.workspaceId} / ${effectiveThreadTarget.threadId}`
                              : effectiveThreadTarget.threadId
                            : ''

                          return (
                            <article className="directory-item" key={conversation.id}>
                              <div className="directory-item__icon">{i18n._({ id: 'BT', message: 'BT' })}</div>
                              <div className="directory-item__body">
                                <strong>{formatBotConversationTitle(conversation)}</strong>
                                {isConfigMode ? (
                                  <>
                                    <p>
                                      {conversation.lastInboundText ||
                                        i18n._({
                                          id: 'No inbound message recorded yet.',
                                          message: 'No inbound message recorded yet.',
                                        })}
                                    </p>
                                    <p>
                                      {i18n._({ id: 'Binding', message: 'Binding' })}: {bindingSourceLabel} | {bindingModeLabel}
                                    </p>
                                    {bindingTargetLabel ? (
                                      <p>
                                        {i18n._({ id: 'Binding target', message: 'Binding target' })}: {bindingTargetLabel}
                                      </p>
                                    ) : null}
                                    {conversation.lastOutboundText ? (
                                      <p>
                                        {i18n._({ id: 'Last reply', message: 'Last reply' })}:{' '}
                                        {conversation.lastOutboundText}
                                      </p>
                                    ) : null}
                                    {sessionDeliveryTarget ? (
                                      <p>
                                        {i18n._({ id: 'Delivery target', message: 'Delivery target' })}:{' '}
                                        {formatBotDeliveryTargetLabel(sessionDeliveryTarget)} |{' '}
                                        {formatLocalizedStatusLabel(sessionDeliveryTarget.status)}
                                      </p>
                                    ) : null}
                                  </>
                                ) : (
                                  <>
                                    <p>
                                      {i18n._({ id: 'Last inbound', message: 'Last inbound' })}:{' '}
                                      {conversation.lastInboundText ||
                                        i18n._({
                                          id: 'No inbound message recorded yet.',
                                          message: 'No inbound message recorded yet.',
                                        })}
                                    </p>
                                    {conversation.lastOutboundText ? (
                                      <p>
                                        {i18n._({ id: 'Last outbound', message: 'Last outbound' })}:{' '}
                                        {conversation.lastOutboundText}
                                      </p>
                                    ) : null}
                                    {sessionDeliveryTarget ? (
                                      <p>
                                        {i18n._({ id: 'Recipient', message: 'Recipient' })}:{' '}
                                        {formatBotDeliveryTargetLabel(sessionDeliveryTarget)} |{' '}
                                        {formatLocalizedStatusLabel(sessionDeliveryTarget.status)}
                                      </p>
                                    ) : null}
                                    {bindingTargetLabel ? (
                                      <p>
                                        {i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}:{' '}
                                        {bindingTargetLabel}
                                      </p>
                                    ) : null}
                                  </>
                                )}
                              {botConversationDeliveryPillStatus(conversation.lastOutboundDeliveryStatus) ? (
                                <div
                                  style={{
                                    alignItems: 'center',
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: '8px',
                                  }}
                                >
                                  <span>{i18n._({ id: 'Reply delivery', message: 'Reply delivery' })}:</span>
                                  <StatusPill
                                    status={botConversationDeliveryPillStatus(
                                      conversation.lastOutboundDeliveryStatus,
                                    )}
                                  />
                                  {conversation.lastOutboundDeliveryAttemptCount &&
                                  conversation.lastOutboundDeliveryAttemptCount > 1 ? (
                                    <span>
                                      {i18n._({
                                        id: 'Attempts: {count}',
                                        message: 'Attempts: {count}',
                                        values: { count: conversation.lastOutboundDeliveryAttemptCount },
                                      })}
                                    </span>
                                  ) : null}
                                  {conversation.lastOutboundDeliveredAt ? (
                                    <span>{formatBotTimestamp(conversation.lastOutboundDeliveredAt)}</span>
                                  ) : null}
                                </div>
                              ) : null}
                              {['retrying', 'failed'].includes(
                                normalizeBotConversationDeliveryStatus(
                                  conversation.lastOutboundDeliveryStatus,
                                ),
                              ) && conversation.lastOutboundDeliveryError ? (
                                <p>
                                  {normalizeBotConversationDeliveryStatus(
                                    conversation.lastOutboundDeliveryStatus,
                                  ) === 'retrying'
                                    ? i18n._({
                                        id: 'Latest delivery error',
                                        message: 'Latest delivery error',
                                      })
                                    : i18n._({ id: 'Delivery error', message: 'Delivery error' })}
                                  :{' '}
                                  {summarizeBotConversationDeliveryError(
                                    conversation.lastOutboundDeliveryError,
                                  )}
                                </p>
                                ) : null}
                              </div>
                              <div
                                className="directory-item__meta"
                                style={{ alignItems: 'end', display: 'grid', gap: '8px' }}
                              >
                                <span className="meta-pill">{formatBotTimestamp(conversation.updatedAt)}</span>
                                {isConfigMode && selectedConnection?.aiBackend === 'workspace_thread' ? (
                                  <Button
                                    intent="secondary"
                                    onClick={() => openBindingModal(conversation)}
                                    size="sm"
                                    type="button"
                                  >
                                    {i18n._({ id: 'Manage Binding', message: 'Manage Binding' })}
                                  </Button>
                                ) : null}
                                {isOutboundMode ? (
                                  <Button
                                    intent="secondary"
                                    onClick={() => openOutboundComposer(conversation)}
                                    size="sm"
                                    type="button"
                                    disabled={selectedConnection?.status !== 'active'}
                                  >
                                    {i18n._({ id: 'Send Message', message: 'Send Message' })}
                                  </Button>
                                ) : null}
                                {normalizeBotConversationDeliveryStatus(conversation.lastOutboundDeliveryStatus) ===
                                'failed' ? (
                                  <Button
                                    intent="secondary"
                                    isLoading={
                                      replayFailedReplyMutation.isPending &&
                                      replayFailedReplyMutation.variables?.conversationId === conversation.id
                                    }
                                    onClick={() =>
                                      replayFailedReplyMutation.mutate({
                                        workspaceId: conversation.workspaceId,
                                        connectionId: conversation.connectionId,
                                        conversationId: conversation.id,
                                      })
                                    }
                                    size="sm"
                                    disabled={selectedConnection?.status !== 'active'}
                                  >
                                    {i18n._({ id: 'Redeliver Reply', message: 'Redeliver Reply' })}
                                  </Button>
                                ) : null}
                                {hasEffectiveThreadTarget ? (
                                  <Link
                                    to={buildWorkspaceThreadRoute(
                                      effectiveThreadTarget.workspaceId,
                                      effectiveThreadTarget.threadId,
                                    )}
                                  >
                                    {i18n._({ id: 'Open Thread', message: 'Open Thread' })}
                                  </Link>
                                ) : (
                                  <span className="meta-pill">
                                    {i18n._({ id: 'Thread pending', message: 'Thread pending' })}
                                  </span>
                                )}
                              </div>
                            </article>
                          )
                        })}
                      </div>
                    </section>
                  </div>
                )}
              </section>
            </>
          ) : null}
        </div>
      </div>

      {createBotModalOpen ? (
        <Modal
          footer={
            <>
              <Button intent="secondary" onClick={closeCreateBotModal} type="button">
                {i18n._({ id: 'Cancel', message: 'Cancel' })}
              </Button>
              <Button isLoading={createBotMutation.isPending} onClick={handleSubmitCreateBot} type="button">
                {i18n._({ id: 'Create Bot', message: 'Create Bot' })}
              </Button>
            </>
          }
          onClose={closeCreateBotModal}
          title={i18n._({ id: 'New Bot', message: 'New Bot' })}
        >
          <div className="form-stack">
            {createBotFormErrorMessage ? (
              <InlineNotice
                dismissible={false}
                noticeKey={`create-bot-${createBotFormErrorMessage}`}
                title={i18n._({ id: 'Create Bot Failed', message: 'Create Bot Failed' })}
                tone="error"
              >
                {createBotFormErrorMessage}
              </InlineNotice>
            ) : null}

            <label className="field">
              <span>{i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}
                fullWidth
                onChange={(nextValue) => {
                  setCreateBotWorkspaceId(nextValue)
                  setCreateBotFormError('')
                }}
                options={workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                }))}
                value={createBotWorkspaceId}
              />
            </label>

            <Input
              hint={i18n._({
                id: 'Bots are the stable logical identity. Endpoints get attached after the bot exists.',
                message: 'Bots are the stable logical identity. Endpoints get attached after the bot exists.',
              })}
              label={i18n._({ id: 'Bot Name', message: 'Bot Name' })}
              onChange={(event) => setCreateBotNameDraft(event.target.value)}
              placeholder={i18n._({ id: 'Ops Bot', message: 'Ops Bot' })}
              value={createBotNameDraft}
            />

            <TextArea
              hint={i18n._({
                id: 'Optional. Use this to describe the bot role before endpoints are attached.',
                message: 'Optional. Use this to describe the bot role before endpoints are attached.',
              })}
              label={i18n._({ id: 'Description', message: 'Description' })}
              onChange={(event) => setCreateBotDescriptionDraft(event.target.value)}
              rows={4}
              value={createBotDescriptionDraft}
            />
          </div>
        </Modal>
      ) : null}

      {createModalOpen ? (
        <Modal
          description={
            isEditingConnection
              ? i18n._({
                  id: 'Update the provider delivery settings, credentials, and AI backend binding for this existing endpoint.',
                  message:
                    'Update the provider delivery settings, credentials, and AI backend binding for this existing endpoint.',
                })
              : i18n._({
                  id: 'Create a provider endpoint under the selected bot, configure the provider-specific delivery settings, and bind it to an AI execution backend.',
                  message:
                    'Create a provider endpoint under the selected bot, configure the provider-specific delivery settings, and bind it to an AI execution backend.',
                })
          }
          footer={createModalFooter}
          onClose={closeCreateModal}
          title={
            isEditingConnection
              ? i18n._({ id: 'Edit Endpoint', message: 'Edit Endpoint' })
              : i18n._({ id: 'New Endpoint', message: 'New Endpoint' })
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
                    ? i18n._({ id: 'Update Endpoint Failed', message: 'Update Endpoint Failed' })
                    : i18n._({ id: 'Create Endpoint Failed', message: 'Create Endpoint Failed' })
                }
                tone="error"
              >
                {formErrorMessage}
              </InlineNotice>
            ) : null}

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
              <p className="config-inline-note" style={{ margin: 0 }}>
                {i18n._({
                  id: 'Outbound proxy is configured globally in Settings > Config > Runtime.',
                  message: 'Outbound proxy is configured globally in Settings > Config > Runtime.',
                })}
              </p>
              <Link to="/settings/config">
                {i18n._({ id: 'Open Settings', message: 'Open Settings' })}
              </Link>
            </div>

            <div className="form-row">
              <Input
                disabled
                label={i18n._({ id: 'Workspace', message: 'Workspace' })}
                value={connectionModalWorkspace?.name ?? draft.workspaceId}
              />
              <Input
                disabled
                label={i18n._({ id: 'Bot', message: 'Bot' })}
                value={connectionModalBot?.name ?? ''}
              />
            </div>

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
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'WeChat Delivery Mode', message: 'WeChat Delivery Mode' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'WeChat currently uses polling-only intake in this phase.',
                          message: 'WeChat currently uses polling-only intake in this phase.',
                        })}
                      />
                    </div>
                  }
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
                label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {i18n._({ id: 'Endpoint Name', message: 'Endpoint Name' })}
                    <HelpTooltip
                      content={i18n._({
                        id: 'Optional. Defaults to a provider-specific endpoint name.',
                        message: 'Optional. Defaults to a provider-specific endpoint name.',
                      })}
                    />
                  </div>
                }
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={i18n._({ id: 'Support Bot', message: 'Support Bot' })}
                value={draft.name}
              />
            </div>

            <Switch
              checked={draft.runtimeMode === 'debug'}
              label={
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {i18n._({ id: 'Enable Backend Debug Mode', message: 'Enable Backend Debug Mode' })}
                  <HelpTooltip
                    content={i18n._({
                      id: 'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and provider delivery steps.',
                      message:
                        'Debug mode records detailed backend logs for this bot connection, including inbound processing, AI execution, and provider delivery steps.',
                    })}
                  />
                </div>
              }
              onChange={(event) =>
                setDraft((current) => ({ ...current, runtimeMode: event.target.checked ? 'debug' : 'normal' }))
              }
            />

            <label className="field">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
                <HelpTooltip
                  content={
                    <>
                      {i18n._({
                        id: 'No Command Output omits command items entirely.',
                        message: 'No Command Output omits command items entirely.',
                      })}{' '}
                      {i18n._({
                        id: 'Controls how command items are summarized in Telegram and WeChat replies. Brief keeps the command excerpt within about 3-5 lines and is the default.',
                        message:
                          'Controls how command items are summarized in Telegram and WeChat replies. Brief keeps the command excerpt within about 3-5 lines and is the default.',
                      })}
                    </>
                  }
                />
              </div>
              <SelectControl
                ariaLabel={i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}
                fullWidth
                onChange={(nextValue) => setDraft((current) => ({ ...current, commandOutputMode: nextValue }))}
                options={commandOutputModeOptions}
                value={resolveBotCommandOutputMode(draft.commandOutputMode)}
              />
            </label>

            {draftProvider === 'telegram' ? (
              <>
                {draftTelegramDeliveryMode === 'webhook' ? (
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'Public Base URL', message: 'Public Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                            message: 'Required unless the backend already provides CODEX_SERVER_PUBLIC_BASE_URL.',
                          })}
                        />
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                    placeholder="https://bots.example.com"
                    value={draft.publicBaseUrl}
                  />
                ) : null}

                <Input
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Telegram Bot Token', message: 'Telegram Bot Token' })}
                      {isEditingConnection && (
                        <HelpTooltip
                          content={i18n._({
                            id: 'Leave blank to keep the current Telegram bot token. Enter a new token only when rotating credentials.',
                            message:
                              'Leave blank to keep the current Telegram bot token. Enter a new token only when rotating credentials.',
                          })}
                        />
                      )}
                    </div>
                  }
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
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'WeChat Base URL', message: 'WeChat Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Required. Use the iLink channel base URL for this WeChat account.',
                            message: 'Required. Use the iLink channel base URL for this WeChat account.',
                          })}
                        />
                      </div>
                    }
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
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'WeChat Route Tag', message: 'WeChat Route Tag' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Optional. Adds the SKRouteTag header for WeChat API requests when your iLink deployment requires route pinning.',
                          message:
                            'Optional. Adds the SKRouteTag header for WeChat API requests when your iLink deployment requires route pinning.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, wechatRouteTag: event.target.value }))}
                  placeholder={i18n._({ id: 'route-tag-1', message: 'route-tag-1' })}
                  value={draft.wechatRouteTag}
                />

                <Switch
                  checked={draft.wechatChannelTimingEnabled}
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({
                        id: 'Append WeChat Channel Timing',
                        message: 'Append WeChat Channel Timing',
                      })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Append the WeChat Channel timing block to final replies. This is independent from backend debug mode and defaults to disabled for new connections.',
                          message:
                            'Append the WeChat Channel timing block to final replies. This is independent from backend debug mode and defaults to disabled for new connections.',
                        })}
                      />
                    </div>
                  }
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
                          id: 'Complete one WeChat QR login first. Confirmed accounts are saved automatically.',
                          message:
                            'Complete one WeChat QR login first. Confirmed accounts are saved automatically.',
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
                        label={
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {i18n._({ id: 'WeChat Owner User ID', message: 'WeChat Owner User ID' })}
                            <HelpTooltip
                              content={i18n._({
                                id: 'Required. This maps to wechat_owner_user_id on the backend.',
                                message: 'Required. This maps to wechat_owner_user_id on the backend.',
                              })}
                            />
                          </div>
                        }
                        onChange={(event) => setDraft((current) => ({ ...current, wechatUserId: event.target.value }))}
                        placeholder={i18n._({ id: 'wechat-owner-1', message: 'wechat-owner-1' })}
                        value={draft.wechatUserId}
                      />
                      </div>

                      <Input
                      label={
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {i18n._({ id: 'WeChat Bot Token', message: 'WeChat Bot Token' })}
                          <HelpTooltip
                            content={
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
                          />
                        </div>
                      }
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
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}
                    <HelpTooltip
                      content={i18n._({
                        id: 'Matches the workspace composer permission preset. Full access sends approvalPolicy=never and a danger-full-access sandbox to app-server so bot turns can avoid interactive approval prompts.',
                        message:
                          'Matches the workspace composer permission preset. Full access sends approvalPolicy=never and a danger-full-access sandbox to app-server so bot turns can avoid interactive approval prompts.',
                      })}
                    />
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}
                    fullWidth
                    onChange={(nextValue) =>
                      setDraft((current) => ({ ...current, workspacePermissionPreset: nextValue }))
                    }
                    options={permissionPresetOptions}
                    value={draft.workspacePermissionPreset}
                  />
                </label>

                {draft.workspacePermissionPreset === 'full-access' ? (
                  <InlineNotice
                    dismissible={false}
                    noticeKey="bot-workspace-thread-full-access"
                    title={i18n._({ id: 'Full Access Enabled', message: 'Full Access Enabled' })}
                  >
                    {i18n._({
                      id: 'New bot threads and turns will request full access from app-server with approval prompts disabled. Use this only for trusted bot workflows.',
                      message:
                        'New bot threads and turns will request full access from app-server with approval prompts disabled. Use this only for trusted bot workflows.',
                    })}
                  </InlineNotice>
                ) : null}

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
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'OpenAI API Key', message: 'OpenAI API Key' })}
                        {isEditingConnection && (
                          <HelpTooltip
                            content={i18n._({
                              id: 'Leave blank to keep the current OpenAI API key. Enter a new key only when rotating credentials.',
                              message:
                                'Leave blank to keep the current OpenAI API key. Enter a new key only when rotating credentials.',
                            })}
                          />
                        )}
                      </div>
                    }
                    onChange={(event) => setDraft((current) => ({ ...current, openAIApiKey: event.target.value }))}
                    placeholder={i18n._({ id: 'sk-...', message: 'sk-...' })}
                    type="password"
                    value={draft.openAIApiKey}
                  />
                  <Input
                    label={
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {i18n._({ id: 'OpenAI Base URL', message: 'OpenAI Base URL' })}
                        <HelpTooltip
                          content={i18n._({
                            id: 'Optional. Defaults to the standard Responses API endpoint.',
                            message: 'Optional. Defaults to the standard Responses API endpoint.',
                          })}
                        />
                      </div>
                    }
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
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Instructions', message: 'Instructions' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Optional system instructions for the Responses backend.',
                          message: 'Optional system instructions for the Responses backend.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, openAIInstructions: event.target.value }))}
                  rows={5}
                  value={draft.openAIInstructions}
                />

                <Switch
                  checked={draft.openAIStore}
                  label={
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {i18n._({ id: 'Store OpenAI Response State', message: 'Store OpenAI Response State' })}
                      <HelpTooltip
                        content={i18n._({
                          id: 'Persist conversation state in the OpenAI Responses API when supported.',
                          message: 'Persist conversation state in the OpenAI Responses API when supported.',
                        })}
                      />
                    </div>
                  }
                  onChange={(event) => setDraft((current) => ({ ...current, openAIStore: event.target.checked }))}
                />
              </>
            )}
          </form>
        </Modal>
      ) : null}

      {bindingTarget ? (
        <Modal
          description={i18n._({
            id: 'Rebind this bot conversation to another workspace thread, optionally in a different workspace, or clear the existing binding so the next inbound message starts fresh.',
            message:
              'Rebind this bot conversation to another workspace thread, optionally in a different workspace, or clear the existing binding so the next inbound message starts fresh.',
          })}
          footer={bindingModalFooter}
          onClose={closeBindingModal}
          title={i18n._({ id: 'Manage Conversation Binding', message: 'Manage Conversation Binding' })}
        >
          <div className="form-stack">
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Conversation', message: 'Conversation' })}</span>
                <strong dir="auto">{formatBotConversationTitle(bindingTarget)}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Bot Connection', message: 'Bot Connection' })}</span>
                <strong dir="auto">{selectedConnection?.name ?? bindingTarget.connectionId}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Current Binding', message: 'Current Binding' })}</span>
                <strong>
                  {bindingCurrentThreadId ? (
                    <Link to={buildWorkspaceThreadRoute(bindingCurrentWorkspaceId, bindingCurrentThreadId)}>
                      {bindingCurrentWorkspaceId !== bindingTarget.workspaceId
                        ? `${bindingCurrentWorkspaceId} / ${bindingCurrentThreadId}`
                        : bindingCurrentThreadId}
                    </Link>
                  ) : (
                    i18n._({ id: 'Not bound', message: 'Not bound' })
                  )}
                </strong>
              </div>
            </div>

            {bindingErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`bot-binding-${bindingErrorMessage}`}
                title={i18n._({ id: 'Binding Update Failed', message: 'Binding Update Failed' })}
                tone="error"
              >
                {bindingErrorMessage}
              </InlineNotice>
            ) : null}

            <label className="field">
              <span>{i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}
                fullWidth
                onChange={(nextValue) => {
                  updateConversationBindingMutation.reset()
                  clearConversationBindingMutation.reset()
                  setBindingWorkspaceId(nextValue)
                  setBindingThreadId('')
                  setBindingThreadSearch('')
                }}
                options={workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: `${workspace.name} | ${workspace.id}`,
                }))}
                value={bindingWorkspaceId}
              />
            </label>

            <label className="field">
              <span>{i18n._({ id: 'Binding Mode', message: 'Binding Mode' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Binding Mode', message: 'Binding Mode' })}
                fullWidth
                onChange={(nextValue) => {
                  updateConversationBindingMutation.reset()
                  clearConversationBindingMutation.reset()
                  setBindingMode(nextValue === 'new' ? 'new' : 'existing')
                }}
                options={bindingModeOptions}
                value={bindingMode}
              />
            </label>

            {bindingMode === 'existing' ? (
              <>
                {isActiveThreadsInitialLoading ? (
                  <LoadingState
                    fill={false}
                    message={i18n._({
                      id: 'Loading recent threads in the selected workspace...',
                      message: 'Loading recent threads in the selected workspace...',
                    })}
                  />
                ) : null}

                {isResolvingCurrentBindingThread ? (
                  <LoadingState
                    fill={false}
                    message={i18n._({
                      id: 'Resolving the current binding thread in its workspace...',
                      message: 'Resolving the current binding thread in its workspace...',
                    })}
                  />
                ) : null}

                {activeThreadsQuery.error ? (
                  <InlineNotice
                    dismissible={false}
                    noticeKey="bot-binding-threads-load-failed"
                    title={i18n._({ id: 'Thread List Unavailable', message: 'Thread List Unavailable' })}
                    tone="error"
                  >
                    {getErrorMessage(activeThreadsQuery.error)}
                  </InlineNotice>
                ) : null}

                {isBindingPickerOnCurrentWorkspace &&
                currentBindingThreadQuery.error &&
                bindingCurrentThreadId &&
                resolvedCurrentBindingThread === null ? (
                  <div className="notice">
                    {i18n._({
                      id: 'The current binding thread could not be resolved, but its thread ID is still preserved when the selected workspace matches the current binding workspace.',
                      message:
                        'The current binding thread could not be resolved, but its thread ID is still preserved when the selected workspace matches the current binding workspace.',
                    })}
                  </div>
                ) : null}

                <Input
                  hint={i18n._({
                    id: 'Search loaded threads in the selected workspace by thread name or ID. Use Load More to continue scanning older active threads.',
                    message:
                      'Search loaded threads in the selected workspace by thread name or ID. Use Load More to continue scanning older active threads.',
                  })}
                  label={i18n._({ id: 'Search Threads', message: 'Search Threads' })}
                  onChange={(event) => setBindingThreadSearch(event.target.value)}
                  placeholder={i18n._({ id: 'Search by thread name or ID', message: 'Search by thread name or ID' })}
                  value={bindingThreadSearch}
                />

                {!activeThreadsQuery.error && (activeThreads.length > 0 || canLoadMoreActiveThreads) ? (
                  <div className="notice">
                    {i18n._({
                      id: 'Showing {count} loaded active threads from the selected workspace. Search locally, then load more if the thread is older.',
                      message:
                        'Showing {count} loaded active threads from the selected workspace. Search locally, then load more if the thread is older.',
                      values: { count: activeThreads.length },
                    })}
                  </div>
                ) : null}

                <label className="field">
                  <span>{i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}
                    disabled={isActiveThreadsInitialLoading || bindingThreadSelectableCount === 0}
                    fullWidth
                    onChange={(nextValue) => {
                      updateConversationBindingMutation.reset()
                      clearConversationBindingMutation.reset()
                      setBindingThreadId(nextValue)
                    }}
                    options={bindingThreadOptions}
                    value={bindingThreadId}
                  />
                </label>

                {canLoadMoreActiveThreads ? (
                  <Button
                    intent="secondary"
                    isLoading={activeThreadsQuery.isFetchingNextPage}
                    onClick={() => {
                      void activeThreadsQuery.fetchNextPage()
                    }}
                    size="sm"
                  >
                    {i18n._({ id: 'Load More Threads', message: 'Load More Threads' })}
                  </Button>
                ) : null}

                {bindingThreadSearch.trim() && bindingSearchMatchCount === 0 ? (
                  <div className="notice">
                    {canLoadMoreActiveThreads
                      ? i18n._({
                          id: 'No loaded thread matches this search yet. Load more to continue scanning older threads.',
                          message: 'No loaded thread matches this search yet. Load more to continue scanning older threads.',
                        })
                      : i18n._({
                          id: 'No loaded thread matches this search.',
                          message: 'No loaded thread matches this search.',
                        })}
                  </div>
                ) : null}

                {!isActiveThreadsInitialLoading && !activeThreadsQuery.error && activeThreads.length === 0 && !bindingTarget.threadId ? (
                  <div className="notice">
                    {i18n._({
                      id: 'No active threads are available in the selected workspace yet. Switch to Create New Thread to create one and bind this conversation immediately.',
                      message:
                        'No active threads are available in the selected workspace yet. Switch to Create New Thread to create one and bind this conversation immediately.',
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <Input
                hint={i18n._({
                  id: 'Optional. Leave this blank to let the server build a default thread title from the bot and conversation metadata.',
                  message:
                    'Optional. Leave this blank to let the server build a default thread title from the bot and conversation metadata.',
                })}
                label={i18n._({ id: 'New Thread Title', message: 'New Thread Title' })}
                onChange={(event) => {
                  updateConversationBindingMutation.reset()
                  clearConversationBindingMutation.reset()
                  setBindingTitle(event.target.value)
                }}
                placeholder={i18n._({ id: 'VIP Queue', message: 'VIP Queue' })}
                value={bindingTitle}
              />
            )}
          </div>
        </Modal>
      ) : null}

      {defaultBindingModalOpen && selectedBot ? (
        <Modal
          description={i18n._({
            id: 'Choose how new conversations for this bot should bind to workspace threads before any per-conversation override is applied, including routing into another workspace when needed.',
            message:
              'Choose how new conversations for this bot should bind to workspace threads before any per-conversation override is applied, including routing into another workspace when needed.',
          })}
          footer={defaultBindingModalFooter}
          onClose={closeDefaultBindingModal}
          title={i18n._({ id: 'Default Bot Binding', message: 'Default Bot Binding' })}
        >
          <div className="form-stack">
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Connections', message: 'Connections' })}</span>
                <strong>{selectedBotConnections.length}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Backend', message: 'Backend' })}</span>
                <strong>
                  {selectedBotPrimaryBackend
                    ? formatBotBackendLabel(selectedBotPrimaryBackend)
                    : i18n._({ id: 'None', message: 'None' })}
                </strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Current Target Workspace', message: 'Current Target Workspace' })}</span>
                <strong>
                  {selectedBotDefaultBindingMode === 'stateless'
                    ? i18n._({ id: 'No workspace thread target', message: 'No workspace thread target' })
                    : selectedBotDefaultBindingWorkspaceId}
                </strong>
              </div>
            </div>

            {defaultBindingErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`bot-default-binding-${defaultBindingErrorMessage}`}
                title={i18n._({ id: 'Binding Update Failed', message: 'Binding Update Failed' })}
                tone="error"
              >
                {defaultBindingErrorMessage}
              </InlineNotice>
            ) : null}

            <label className="field">
              <span>{i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Target Workspace', message: 'Target Workspace' })}
                fullWidth
                onChange={(nextValue) => {
                  updateBotDefaultBindingMutation.reset()
                  setDefaultBindingWorkspaceId(nextValue)
                  setDefaultBindingThreadId('')
                  setDefaultBindingThreadSearch('')
                }}
                options={workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: `${workspace.name} | ${workspace.id}`,
                }))}
                value={defaultBindingWorkspaceId}
              />
            </label>

            <label className="field">
              <span>{i18n._({ id: 'Binding Mode', message: 'Binding Mode' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Binding Mode', message: 'Binding Mode' })}
                fullWidth
                onChange={(nextValue) => {
                  updateBotDefaultBindingMutation.reset()
                  setDefaultBindingMode(nextValue === 'fixed_thread' ? 'fixed_thread' : 'workspace_auto_thread')
                }}
                options={defaultBindingModeOptions}
                value={defaultBindingMode}
              />
            </label>

            {defaultBindingMode === 'fixed_thread' ? (
              <>
                {isActiveThreadsInitialLoading ? (
                  <LoadingState
                    fill={false}
                    message={i18n._({
                      id: 'Loading recent threads in the selected workspace...',
                      message: 'Loading recent threads in the selected workspace...',
                    })}
                  />
                ) : null}

                {isResolvingCurrentDefaultBindingThread ? (
                  <LoadingState
                    fill={false}
                    message={i18n._({
                      id: 'Resolving the current default binding thread in its workspace...',
                      message: 'Resolving the current default binding thread in its workspace...',
                    })}
                  />
                ) : null}

                {activeThreadsQuery.error ? (
                  <InlineNotice
                    dismissible={false}
                    noticeKey="bot-default-binding-threads-load-failed"
                    title={i18n._({ id: 'Thread List Unavailable', message: 'Thread List Unavailable' })}
                    tone="error"
                  >
                    {getErrorMessage(activeThreadsQuery.error)}
                  </InlineNotice>
                ) : null}

                {isDefaultBindingPickerOnCurrentWorkspace &&
                currentDefaultBindingThreadQuery.error &&
                defaultBindingCurrentThreadId &&
                resolvedCurrentDefaultBindingThread === null ? (
                  <div className="notice">
                    {i18n._({
                      id: 'The current default binding thread could not be resolved, but its thread ID is still preserved when the selected workspace matches the current default binding workspace.',
                      message:
                        'The current default binding thread could not be resolved, but its thread ID is still preserved when the selected workspace matches the current default binding workspace.',
                    })}
                  </div>
                ) : null}

                <Input
                  hint={i18n._({
                    id: 'Search loaded threads in the selected workspace by thread name or ID. Use Load More to continue scanning older active threads.',
                    message:
                      'Search loaded threads in the selected workspace by thread name or ID. Use Load More to continue scanning older active threads.',
                  })}
                  label={i18n._({ id: 'Search Threads', message: 'Search Threads' })}
                  onChange={(event) => setDefaultBindingThreadSearch(event.target.value)}
                  placeholder={i18n._({ id: 'Search by thread name or ID', message: 'Search by thread name or ID' })}
                  value={defaultBindingThreadSearch}
                />

                {!activeThreadsQuery.error && (activeThreads.length > 0 || canLoadMoreActiveThreads) ? (
                  <div className="notice">
                    {i18n._({
                      id: 'Showing {count} loaded active threads from the selected workspace. Search locally, then load more if the thread is older.',
                      message:
                        'Showing {count} loaded active threads from the selected workspace. Search locally, then load more if the thread is older.',
                      values: { count: activeThreads.length },
                    })}
                  </div>
                ) : null}

                <label className="field">
                  <span>{i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}
                    disabled={isActiveThreadsInitialLoading || defaultBindingThreadSelectableCount === 0}
                    fullWidth
                    onChange={(nextValue) => {
                      updateBotDefaultBindingMutation.reset()
                      setDefaultBindingThreadId(nextValue)
                    }}
                    options={defaultBindingThreadOptions}
                    value={defaultBindingThreadId}
                  />
                </label>

                {canLoadMoreActiveThreads ? (
                  <Button
                    intent="secondary"
                    isLoading={activeThreadsQuery.isFetchingNextPage}
                    onClick={() => {
                      void activeThreadsQuery.fetchNextPage()
                    }}
                    size="sm"
                  >
                    {i18n._({ id: 'Load More Threads', message: 'Load More Threads' })}
                  </Button>
                ) : null}

                {defaultBindingThreadSearch.trim() && defaultBindingSearchMatchCount === 0 ? (
                  <div className="notice">
                    {canLoadMoreActiveThreads
                      ? i18n._({
                          id: 'No loaded thread matches this search yet. Load more to continue scanning older threads.',
                          message: 'No loaded thread matches this search yet. Load more to continue scanning older threads.',
                        })
                      : i18n._({
                          id: 'No loaded thread matches this search.',
                          message: 'No loaded thread matches this search.',
                        })}
                  </div>
                ) : null}

                {!isActiveThreadsInitialLoading && !activeThreadsQuery.error && activeThreads.length === 0 ? (
                  <div className="notice">
                    {i18n._({
                      id: 'No active threads are available in the selected workspace yet. Create one first or switch back to workspace auto thread.',
                      message:
                        'No active threads are available in the selected workspace yet. Create one first or switch back to workspace auto thread.',
                    })}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="notice">
                {i18n._({
                  id: 'New conversations will resolve to a workspace thread dynamically from bot conversation context unless a per-conversation binding overrides it.',
                  message:
                    'New conversations will resolve to a workspace thread dynamically from bot conversation context unless a per-conversation binding overrides it.',
                })}
              </div>
            )}
          </div>
        </Modal>
      ) : null}

      {isOutboundMode && routeTargetModalOpen && selectedBot && selectedConnection ? (
        <Modal
          description={routeTargetModalDescription}
          footer={routeTargetModalFooter}
          onClose={() => closeRouteTargetModal()}
          title={routeTargetModalTitle}
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmitRouteTarget()
            }}
          >
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Bot', message: 'Bot' })}</span>
                <strong>{selectedBot.name}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Endpoint', message: 'Endpoint' })}</span>
                <strong>{selectedConnection.name}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Provider', message: 'Provider' })}</span>
                <strong>{formatBotProviderLabel(selectedConnection.provider)}</strong>
              </div>
            </div>

            {routeTargetErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`route-target-${routeTargetErrorMessage}`}
                title={i18n._({ id: 'Save Contact Failed', message: 'Save Contact Failed' })}
                tone="error"
              >
                {routeTargetErrorMessage}
              </InlineNotice>
            ) : null}

            {!selectedConnectionSupportsRouteTargetConfig ? (
              <div className="notice">
                {i18n._({
                  id: 'This endpoint does not expose manual saved contact configuration yet.',
                  message: 'This endpoint does not expose manual saved contact configuration yet.',
                })}
              </div>
            ) : (
              <>
                <label className="field">
                  <span>{i18n._({ id: 'Recipient Type', message: 'Recipient Type' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Recipient Type', message: 'Recipient Type' })}
                    fullWidth
                    onChange={(nextValue) => {
                      setRouteTargetFormError('')
                      upsertDeliveryTargetMutation.reset()
                      updateDeliveryTargetMutation.reset()
                      setRouteTargetSuggestedRecipientValue('')
                      setRouteTargetRouteType(nextValue)
                      if (nextValue !== 'telegram_topic') {
                        setRouteTargetThreadId('')
                      }
                    }}
                    options={routeTargetRouteTypeOptions}
                    value={routeTargetRouteType}
                  />
                </label>

                <Input
                  hint={i18n._({
                    id: 'Optional display name shown in target lists and delivery history.',
                    message: 'Optional display name shown in target lists and delivery history.',
                  })}
                  label={i18n._({ id: 'Display Name', message: 'Display Name' })}
                  onChange={(event) => {
                    setRouteTargetFormError('')
                    setRouteTargetTitle(event.target.value)
                  }}
                  placeholder={i18n._({ id: 'Ops Alert Channel', message: 'Ops Alert Channel' })}
                  value={routeTargetTitle}
                />

                {knownRouteTargetOptions.length ? (
                  <div className="field">
                    <span className="field-label">{i18n._({ id: 'Recipient Source', message: 'Recipient Source' })}</span>
                    <div className="segmented-control segmented-control--sm">
                      <Button
                        intent={routeTargetRecipientMode === 'existing' ? 'secondary' : 'ghost'}
                        onClick={() => handleRouteTargetRecipientModeChange('existing')}
                        type="button"
                      >
                        {i18n._({ id: 'Choose Existing', message: 'Choose Existing' })}
                      </Button>
                      <Button
                        intent={routeTargetRecipientMode === 'manual' ? 'secondary' : 'ghost'}
                        onClick={() => handleRouteTargetRecipientModeChange('manual')}
                        type="button"
                      >
                        {i18n._({ id: 'Enter Manually', message: 'Enter Manually' })}
                      </Button>
                    </div>
                    <small className="field-hint">
                      {i18n._({
                        id: 'Use a recent conversation on this endpoint, or switch to manual entry for a brand-new destination.',
                        message:
                          'Use a recent conversation on this endpoint, or switch to manual entry for a brand-new destination.',
                      })}
                    </small>
                  </div>
                ) : (
                  <div className="notice">
                    {i18n._({
                      id: 'No recent recipients are available on this endpoint yet, so this saved contact needs a manual destination ID.',
                      message:
                        'No recent recipients are available on this endpoint yet, so this saved contact needs a manual destination ID.',
                    })}
                  </div>
                )}

                {knownRouteTargetOptions.length && routeTargetRecipientMode === 'existing' ? (
                  <label className="field">
                    <span>{i18n._({ id: 'Recent Recipient', message: 'Recent Recipient' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Recent Recipient', message: 'Recent Recipient' })}
                      fullWidth
                      onChange={(nextValue) => {
                        setRouteTargetFormError('')
                        const nextOption = knownRouteTargetOptions.find((option) => option.value === nextValue) ?? null
                        applySuggestedRouteTarget(nextOption)
                      }}
                      options={knownRouteTargetSelectOptions}
                      value={routeTargetSuggestedRecipientValue}
                    />
                  </label>
                ) : (
                  <>
                    <Input
                      hint={i18n._({
                        id:
                          selectedProvider === 'wechat'
                            ? 'WeChat external user ID for proactive delivery. If this contact has not messaged the bot yet, the target will wait until a reply context becomes available.'
                            : 'Telegram chat ID, for example -1001234567890.',
                        message:
                          selectedProvider === 'wechat'
                            ? 'WeChat external user ID for proactive delivery. If this contact has not messaged the bot yet, the target will wait until a reply context becomes available.'
                            : 'Telegram chat ID, for example -1001234567890.',
                      })}
                      label={
                        selectedProvider === 'wechat'
                          ? i18n._({ id: 'WeChat User ID', message: 'WeChat User ID' })
                          : i18n._({ id: 'Chat ID', message: 'Chat ID' })
                      }
                      onChange={(event) => {
                        setRouteTargetFormError('')
                        setRouteTargetChatId(event.target.value)
                      }}
                      placeholder={selectedProvider === 'wechat' ? 'wxid_xxx' : '-1001234567890'}
                      value={routeTargetChatId}
                    />

                    {routeTargetRouteType === 'telegram_topic' ? (
                      <Input
                        hint={i18n._({
                          id: 'Telegram topic thread ID inside the target supergroup.',
                          message: 'Telegram topic thread ID inside the target supergroup.',
                        })}
                        label={i18n._({ id: 'Thread ID', message: 'Thread ID' })}
                        onChange={(event) => {
                          setRouteTargetFormError('')
                          setRouteTargetThreadId(event.target.value)
                        }}
                        placeholder="42"
                        value={routeTargetThreadId}
                      />
                    ) : null}
                  </>
                )}

                {selectedKnownRouteTargetOption ? (
                  <div className="notice">
                    {routeTargetRouteType === 'telegram_topic'
                      ? i18n._({
                          id: 'Selected destination: chat {chatId}, topic {threadId}.',
                          message: 'Selected destination: chat {chatId}, topic {threadId}.',
                          values: {
                            chatId: selectedKnownRouteTargetOption.chatId,
                            threadId: selectedKnownRouteTargetOption.threadId,
                          },
                        })
                      : selectedProvider === 'wechat'
                        ? i18n._({
                            id: 'Selected destination: WeChat user {chatId}.',
                            message: 'Selected destination: WeChat user {chatId}.',
                            values: { chatId: selectedKnownRouteTargetOption.chatId },
                          })
                        : i18n._({
                            id: 'Selected destination: chat {chatId}.',
                            message: 'Selected destination: chat {chatId}.',
                            values: { chatId: selectedKnownRouteTargetOption.chatId },
                          })}
                  </div>
                ) : null}

                <Button
                  intent={routeTargetAdvancedOpen ? 'secondary' : 'ghost'}
                  onClick={() => setRouteTargetAdvancedOpen((current) => !current)}
                  type="button"
                >
                  {routeTargetAdvancedOpen
                    ? i18n._({ id: 'Hide Advanced Options', message: 'Hide Advanced Options' })
                    : i18n._({ id: 'Show Advanced Options', message: 'Show Advanced Options' })}
                </Button>

                {routeTargetAdvancedOpen ? (
                  <>
                    <label className="field">
                      <span>{i18n._({ id: 'Status', message: 'Status' })}</span>
                      <SelectControl
                        ariaLabel={i18n._({ id: 'Status', message: 'Status' })}
                        fullWidth
                        onChange={(nextValue) => {
                          setRouteTargetFormError('')
                          setRouteTargetStatus(nextValue === 'paused' ? 'paused' : 'active')
                        }}
                        options={routeTargetStatusOptions}
                        value={routeTargetStatus}
                      />
                    </label>

                    <Input
                      hint={i18n._({
                        id: 'Optional tags for search, routing groups, or ownership.',
                        message: 'Optional tags for search, routing groups, or ownership.',
                      })}
                      label={i18n._({ id: 'Labels', message: 'Labels' })}
                      onChange={(event) => {
                        setRouteTargetFormError('')
                        setRouteTargetLabelsDraft(event.target.value)
                      }}
                      placeholder={i18n._({ id: 'ops, alerts, p1', message: 'ops, alerts, p1' })}
                      value={routeTargetLabelsDraft}
                    />

                    <Input
                      hint={i18n._({
                        id: 'Only needed when you want to add extra capability tags beyond the provider defaults.',
                        message: 'Only needed when you want to add extra capability tags beyond the provider defaults.',
                      })}
                      label={i18n._({ id: 'Additional Capabilities', message: 'Additional Capabilities' })}
                      onChange={(event) => {
                        setRouteTargetFormError('')
                        setRouteTargetCapabilitiesDraft(event.target.value)
                      }}
                      placeholder={i18n._({
                        id: 'supportsNotifications, supportsEscalation',
                        message: 'supportsNotifications, supportsEscalation',
                      })}
                      value={routeTargetCapabilitiesDraft}
                    />

                    <TextArea
                      hint={
                        selectedProvider === 'wechat'
                          ? i18n._({
                              id: 'Optional extra provider state as JSON. WeChat reply context is managed automatically by the backend.',
                              message:
                                'Optional extra provider state as JSON. WeChat reply context is managed automatically by the backend.',
                            })
                          : i18n._({
                              id: 'Optional extra provider state as JSON. Leave blank unless this provider route needs additional metadata.',
                              message:
                                'Optional extra provider state as JSON. Leave blank unless this provider route needs additional metadata.',
                            })
                      }
                      label={i18n._({ id: 'Extra Provider State (JSON)', message: 'Extra Provider State (JSON)' })}
                      onChange={(event) => {
                        setRouteTargetFormError('')
                        setRouteTargetProviderStateDraft(event.target.value)
                      }}
                      rows={selectedProvider === 'wechat' ? 6 : 5}
                      value={routeTargetProviderStateDraft}
                    />
                  </>
                ) : null}

                {routeTargetRouteKeyPreview ? (
                  <div className="notice">
                    {i18n._({
                      id: 'Recipient ID preview: {routeKey}',
                      message: 'Recipient ID preview: {routeKey}',
                      values: { routeKey: routeTargetRouteKeyPreview },
                    })}
                  </div>
                ) : null}
              </>
            )}
          </form>
        </Modal>
      ) : null}

      {isOutboundMode && (outboundComposerTarget || outboundComposerDeliveryTarget) && selectedBot && selectedConnection ? (
        <Modal
          description={i18n._({
            id: 'Send text and optional attachments to the selected recipient. The backend records a dedicated outbound delivery entry for manual sends.',
            message:
              'Send text and optional attachments to the selected recipient. The backend records a dedicated outbound delivery entry for manual sends.',
          })}
          footer={outboundComposerModalFooter}
          onClose={() => closeOutboundComposer()}
          title={i18n._({ id: 'Send Proactive Message', message: 'Send Proactive Message' })}
        >
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault()
              handleSubmitOutboundComposer()
            }}
          >
            <div className="detail-list">
              <div className="detail-row">
                <span>{i18n._({ id: 'Bot', message: 'Bot' })}</span>
                <strong>{selectedBot.name}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Endpoint', message: 'Endpoint' })}</span>
                <strong>{selectedConnection.name}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Conversation', message: 'Conversation' })}</span>
                <strong dir="auto">
                  {outboundComposerTarget
                    ? formatBotConversationTitle(outboundComposerTarget)
                    : outboundComposerDeliveryTarget?.sessionId?.trim()
                      ? i18n._({ id: 'Linked conversation', message: 'Linked conversation' })
                      : i18n._({ id: 'No linked conversation', message: 'No linked conversation' })}
                </strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Recipient', message: 'Recipient' })}</span>
                <strong>
                  {outboundComposerTarget
                    ? deliveryTargetByConversationId.get(outboundComposerTarget.id)
                      ? formatBotDeliveryTargetLabel(deliveryTargetByConversationId.get(outboundComposerTarget.id)!)
                      : i18n._({ id: 'Will be created on send', message: 'Will be created on send' })
                    : outboundComposerDeliveryTarget
                      ? formatBotDeliveryTargetLabel(outboundComposerDeliveryTarget)
                      : i18n._({ id: 'Unknown recipient', message: 'Unknown recipient' })}
                </strong>
              </div>
              {outboundComposerDeliveryTarget ? (
                <div className="detail-row">
                  <span>{i18n._({ id: 'Channel', message: 'Channel' })}</span>
                  <strong>
                    {formatBotDeliveryRouteLabel(outboundComposerDeliveryTarget.routeType)} |{' '}
                    {outboundComposerDeliveryTarget.routeKey?.trim() || i18n._({ id: 'Not persisted', message: 'Not persisted' })}
                  </strong>
                </div>
              ) : null}
              <div className="detail-row">
                <span>{i18n._({ id: 'Capabilities', message: 'Capabilities' })}</span>
                <strong>{summarizeBotConnectionCapabilities(selectedConnection.capabilities)}</strong>
              </div>
            </div>

            {sendOutboundMessageErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`send-bot-outbound-${sendOutboundMessageErrorMessage}`}
                title={i18n._({ id: 'Send Proactive Message Failed', message: 'Send Proactive Message Failed' })}
                tone="error"
              >
                {sendOutboundMessageErrorMessage}
              </InlineNotice>
            ) : null}

            {!outboundComposerCanAttachMedia ? (
              <div className="notice">
                {i18n._({
                  id: 'This endpoint currently exposes text outbound only in the manual send composer.',
                  message: 'This endpoint currently exposes text outbound only in the manual send composer.',
                })}
              </div>
            ) : (
              <div className="notice">
                {i18n._({
                  id: 'Attachments are supported here. Media types: {kinds}. Sources: {sources}.',
                  message: 'Attachments are supported here. Media types: {kinds}. Sources: {sources}.',
                  values: {
                    kinds: outboundComposerSupportedMediaKindSummary || i18n._({ id: 'none', message: 'none' }),
                    sources: outboundComposerSupportedMediaSourceSummary || i18n._({ id: 'none', message: 'none' }),
                  },
                })}
              </div>
            )}

            {outboundComposerMedia.length > 1 && outboundComposerMediaPlanMessage ? (
              <div className="notice">{outboundComposerMediaPlanMessage}</div>
            ) : null}

            <TextArea
              hint={i18n._({
                id: 'Optional when you are sending attachments only. For single Telegram attachments, short text is sent as the media caption when possible.',
                message:
                  'Optional when you are sending attachments only. For single Telegram attachments, short text is sent as the media caption when possible.',
              })}
              label={i18n._({ id: 'Message', message: 'Message' })}
              onChange={(event) => {
                resetOutboundComposerFeedback()
                setOutboundComposerText(event.target.value)
              }}
              placeholder={i18n._({
                id: 'Write the proactive message that should be sent to this bot conversation.',
                message: 'Write the proactive message that should be sent to this bot conversation.',
              })}
              rows={6}
              value={outboundComposerText}
            />

            {hasUnsupportedOutboundComposerMediaDrafts ? (
              <div className="notice">
                {i18n._({
                  id: 'Some attachments currently use a media type or source that this endpoint does not expose. Update those rows or remove them before sending.',
                  message:
                    'Some attachments currently use a media type or source that this endpoint does not expose. Update those rows or remove them before sending.',
                })}
              </div>
            ) : null}

            {hasOutboundComposerMediaAdvisories ? (
              <div className="notice">
                {i18n._({
                  id: 'Some attachments look inconsistent with their selected media type or metadata. Review the row hints before sending.',
                  message:
                    'Some attachments look inconsistent with their selected media type or metadata. Review the row hints before sending.',
                })}
              </div>
            ) : null}

            {outboundComposerShowsAttachmentEditor ? (
              <>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Attachments', message: 'Attachments' })}</span>
                    <Button
                      disabled={!outboundComposerCanAttachMedia}
                      intent="secondary"
                      onClick={addOutboundComposerMediaDraft}
                      type="button"
                    >
                      {i18n._({ id: 'Add Attachment', message: 'Add Attachment' })}
                    </Button>
                  </div>
                </div>

                {outboundComposerMediaDrafts.length ? (
                  <div className="form-stack">
                    {outboundComposerMediaDrafts.map((draft, index) => {
                      const capabilityIssue = outboundComposerMediaCapabilityIssues.get(draft.id) ?? {
                        kindUnsupported: false,
                        sourceUnsupported: false,
                      }
                      const hasPartialDraftWithoutLocation =
                        !draft.location.trim() && (draft.fileName.trim().length > 0 || draft.contentType.trim().length > 0)
                      const locationIssue = outboundComposerMediaLocationIssues.get(draft.id) ?? ''
                      const advisoryMessages =
                        !capabilityIssue.kindUnsupported && !capabilityIssue.sourceUnsupported
                          ? (outboundComposerMediaAdvisories.get(draft.id) ?? []).map((advisory) =>
                              formatOutboundComposerMediaAdvisory(advisory, draft.kind),
                            )
                          : []
                      const kindErrorMessage = capabilityIssue.kindUnsupported
                        ? formatOutboundComposerUnsupportedKindError(draft.kind)
                        : ''
                      const sourceErrorMessage = capabilityIssue.sourceUnsupported
                        ? formatOutboundComposerUnsupportedSourceError(draft.source)
                        : ''
                      const locationErrorMessage = hasPartialDraftWithoutLocation
                        ? formatOutboundComposerMediaLocationError(draft.source, '')
                        : locationIssue
                          ? formatOutboundComposerMediaLocationError(draft.source, locationIssue)
                          : ''
                      const rowDeliveryNote =
                        !capabilityIssue.kindUnsupported &&
                        !capabilityIssue.sourceUnsupported &&
                        draft.location.trim()
                        ? describeOutboundComposerMediaRowDelivery(
                            draft.kind,
                            outboundComposerMedia.length,
                            outboundComposerMediaDeliveryPlan,
                          )
                          : ''
                      const rowHintMessages = [rowDeliveryNote, ...advisoryMessages].filter(Boolean)

                      return (
                        <div className="notice" key={draft.id}>
                          <div className="detail-list">
                            <div className="detail-row">
                              <span>
                                {i18n._({
                                  id: 'Attachment {index}',
                                  message: 'Attachment {index}',
                                  values: { index: index + 1 },
                                })}
                              </span>
                              <Button intent="ghost" onClick={() => removeOutboundComposerMediaDraft(draft.id)} type="button">
                                {i18n._({ id: 'Remove', message: 'Remove' })}
                              </Button>
                            </div>
                          </div>

                          <div className="form-stack">
                            <label className="field">
                              <span>{i18n._({ id: 'Media Type', message: 'Media Type' })}</span>
                            <SelectControl
                              ariaLabel={i18n._({ id: 'Media Type', message: 'Media Type' })}
                              fullWidth
                              onChange={(nextValue) =>
                                updateOutboundComposerMediaDraft(draft.id, { kind: nextValue as BotOutboundMediaKind })
                              }
                              options={outboundComposerMediaKindOptions}
                              value={draft.kind}
                            />
                            {kindErrorMessage ? <small className="field-error">{kindErrorMessage}</small> : null}
                          </label>

                          <label className="field">
                            <span>{i18n._({ id: 'Source', message: 'Source' })}</span>
                            <SelectControl
                                ariaLabel={i18n._({ id: 'Source', message: 'Source' })}
                                fullWidth
                                onChange={(nextValue) =>
                                updateOutboundComposerMediaDraft(draft.id, { source: nextValue as BotOutboundMediaSource })
                              }
                              options={outboundComposerMediaSourceOptions}
                              value={draft.source}
                            />
                            {sourceErrorMessage ? <small className="field-error">{sourceErrorMessage}</small> : null}
                          </label>

                            <Input
                              error={locationErrorMessage || undefined}
                              hint={
                                draft.source === 'path'
                                  ? i18n._({
                                      id: 'Enter an absolute file path that the backend can read, for example E:\\media\\image.png.',
                                      message:
                                        'Enter an absolute file path that the backend can read, for example E:\\media\\image.png.',
                                    })
                                  : i18n._({
                                      id: 'Enter an absolute http(s) URL that the provider can fetch directly.',
                                      message: 'Enter an absolute http(s) URL that the provider can fetch directly.',
                                    })
                              }
                              label={
                                draft.source === 'path'
                                  ? i18n._({ id: 'Absolute Local Path', message: 'Absolute Local Path' })
                                  : i18n._({ id: 'Remote URL', message: 'Remote URL' })
                              }
                              onChange={(event) => updateOutboundComposerMediaDraft(draft.id, { location: event.target.value })}
                              placeholder={draft.source === 'path' ? 'E:\\media\\image.png' : 'https://example.com/image.png'}
                              value={draft.location}
                            />

                            <Input
                              hint={i18n._({
                                id: 'Optional override for the uploaded file name shown to the provider.',
                                message: 'Optional override for the uploaded file name shown to the provider.',
                              })}
                              label={i18n._({ id: 'File Name', message: 'File Name' })}
                              onChange={(event) => updateOutboundComposerMediaDraft(draft.id, { fileName: event.target.value })}
                              placeholder="report.pdf"
                              value={draft.fileName}
                            />

                            <Input
                              hint={i18n._({
                                id: 'Optional content type hint such as image/png or application/pdf.',
                                message: 'Optional content type hint such as image/png or application/pdf.',
                              })}
                              label={i18n._({ id: 'Content Type', message: 'Content Type' })}
                              onChange={(event) =>
                                updateOutboundComposerMediaDraft(draft.id, { contentType: event.target.value })
                              }
                              placeholder="image/png"
                              value={draft.contentType}
                            />

                            {rowHintMessages.map((message) => (
                              <small className="field-hint" key={`${draft.id}-${message}`}>
                                {message}
                              </small>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div className="notice">
                    {i18n._({
                      id: 'No attachments added yet. You can send text only, or add one or more attachments above.',
                      message: 'No attachments added yet. You can send text only, or add one or more attachments above.',
                    })}
                  </div>
                )}
              </>
            ) : null}

            {outboundComposerHasPreviewContent ? (
              <div className="notice">
                <div className="detail-list">
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Send Preview', message: 'Send Preview' })}</span>
                    <strong>{i18n._({ id: 'Ready to send', message: 'Ready to send' })}</strong>
                  </div>
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Text', message: 'Text' })}</span>
                    <strong>{outboundComposerTextPreview || i18n._({ id: 'none', message: 'none' })}</strong>
                  </div>
                  {outboundComposerTextPlacementMessage ? (
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Text Handling', message: 'Text Handling' })}</span>
                      <strong>{outboundComposerTextPlacementMessage}</strong>
                    </div>
                  ) : null}
                  <div className="detail-row">
                    <span>{i18n._({ id: 'Attachment Count', message: 'Attachment Count' })}</span>
                    <strong>
                      {i18n._({
                        id: '{count} attachment(s)',
                        message: '{count} attachment(s)',
                        values: { count: outboundComposerMedia.length },
                      })}
                    </strong>
                  </div>
                  {outboundComposerMediaDeliverySummary ? (
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Attachment Delivery', message: 'Attachment Delivery' })}</span>
                      <strong>{outboundComposerMediaDeliverySummary}</strong>
                    </div>
                  ) : null}
                </div>

                {outboundComposerMedia.length ? (
                  <div style={{ display: 'grid', gap: '8px', marginTop: '12px' }}>
                    {outboundComposerMedia.map((media, index) => (
                      <div key={`${media.kind}-${media.path ?? media.url ?? media.fileName ?? index}`}>
                        <strong>
                          {i18n._({
                            id: 'Attachment {index}',
                            message: 'Attachment {index}',
                            values: { index: index + 1 },
                          })}
                        </strong>
                        {' | '}
                        <span>{summarizeOutboundComposerMediaPreview(media)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
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
                    <strong>{formatLocalizedStatusLabel(activeWeChatLogin.status)}</strong>
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

      {isOutboundMode && deleteDeliveryTarget ? (
        <ConfirmDialog
          confirmLabel={i18n._({ id: 'Remove Saved Contact', message: 'Remove Saved Contact' })}
          description={i18n._({
            id: 'This removes the saved contact configuration. Existing outbound delivery history stays visible, but future proactive sends to this destination will stop until you recreate it.',
            message:
              'This removes the saved contact configuration. Existing outbound delivery history stays visible, but future proactive sends to this destination will stop until you recreate it.',
          })}
          error={deleteDeliveryTargetErrorMessage}
          isPending={deleteDeliveryTargetMutation.isPending}
          onClose={() => {
            if (!deleteDeliveryTargetMutation.isPending) {
              setDeleteDeliveryTarget(null)
              deleteDeliveryTargetMutation.reset()
            }
          }}
          onConfirm={() => {
            if (!selectedBot || deleteDeliveryTargetMutation.isPending) {
              return
            }
            deleteDeliveryTargetMutation.mutate({
              workspaceId: selectedBotWorkspaceId,
              botId: selectedBot.id,
              targetId: deleteDeliveryTarget.id,
            })
          }}
          subject={formatBotDeliveryTargetLabel(deleteDeliveryTarget)}
          title={i18n._({ id: 'Remove Saved Contact', message: 'Remove Saved Contact' })}
        />
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          confirmLabel={i18n._({ id: 'Delete Endpoint', message: 'Delete Endpoint' })}
          description={i18n._({
            id: 'This removes the provider endpoint and all persisted conversation bindings for it.',
            message: 'This removes the provider endpoint and all persisted conversation bindings for it.',
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
          title={i18n._({ id: 'Delete Endpoint', message: 'Delete Endpoint' })}
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
                  id: 'Close the editor and discard the unsaved endpoint changes.',
                  message: 'Close the editor and discard the unsaved endpoint changes.',
                })
              : i18n._({
                  id: 'Close the new endpoint form and discard the unsaved draft.',
                  message: 'Close the new endpoint form and discard the unsaved draft.',
                })
          }
          onClose={() => setDiscardConnectionModalConfirmOpen(false)}
          onConfirm={handleDiscardConnectionModalConfirm}
          subject={draft.name.trim() || editTarget?.name || i18n._({ id: 'Untitled Endpoint', message: 'Untitled Endpoint' })}
          title={
            isEditingConnection
              ? i18n._({ id: 'Discard Endpoint Changes', message: 'Discard Endpoint Changes' })
              : i18n._({ id: 'Discard New Endpoint Draft', message: 'Discard New Endpoint Draft' })
          }
        />
      ) : null}
    </section>
  )
}

export function BotsPage() {
  return <BotsPageScreen mode="config" />
}

export function BotsOutboundPage() {
  return <BotsPageScreen mode="outbound" />
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
