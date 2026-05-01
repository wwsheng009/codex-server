import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { LoadingState } from '../components/ui/LoadingState'
import { Modal } from '../components/ui/Modal'
import { SelectControl } from '../components/ui/SelectControl'
import { Switch } from '../components/ui/Switch'
import { TextArea } from '../components/ui/TextArea'
import { Link } from 'react-router-dom'
import { formatLocalizedStatusLabel } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
import {
  formatBotConversationTitle,
  formatBotProviderLabel,
  formatBotTimestamp,
  formatWeChatAccountLabel,
  summarizeBotConnectionCapabilities,
  type BotOutboundMediaAdvisory,
  type BotOutboundMediaDeliveryPlan,
  type BotOutboundMediaKind,
  type BotOutboundMediaSource,
  type BotsPageDraft,
} from './botsPageUtils'
import type {
  Bot,
  BotConnection,
  BotConversation,
  BotDeliveryTarget,
  BotMessageMedia,
  Thread,
  WeChatAccount,
  WeChatLogin,
} from '../types/api'

type WorkspaceOption = {
  id: string
  name: string
}

type ThreadPickerOption = {
  value: string
  label: string
  triggerLabel?: string
  disabled?: boolean
}

type KnownRouteTargetOption = {
  value: string
  label: string
  triggerLabel: string
  chatId: string
  threadId: string
}

type OutboundComposerMediaDraft = {
  id: string
  kind: BotOutboundMediaKind
  source: BotOutboundMediaSource
  location: string
  fileName: string
  contentType: string
}

type ThreadModalBase = {
  target: BotConversation | null
  currentWorkspaceId: string
  currentThreadId: string
  errorMessage: string
  workspaceId: string
  modeOptions: ThreadPickerOption[]
  threadSearch: string
  threadId: string
  threadOptions: ThreadPickerOption[]
  threadSelectableCount: number
  searchMatchCount: number
  isInitialLoading: boolean
  isResolvingCurrentThread: boolean
  activeThreadsError: unknown
  canLoadMore: boolean
  isFetchingNextPage: boolean
  currentThreadError: unknown
  isPickerOnCurrentWorkspace: boolean
  activeThreads: Thread[]
  onClose: () => void
  onSubmit: () => void
  onChangeWorkspaceId: (nextValue: string) => void
  onChangeThreadSearch: (nextValue: string) => void
  onChangeThreadId: (nextValue: string) => void
  onLoadMore: () => void
}

type BotsPageDialogsProps = {
  shared: {
    isOutboundMode: boolean
    workspaces: WorkspaceOption[]
    selectedBot: Bot | null
    selectedConnection: BotConnection | null
    selectedProvider: string
    selectedBotConnectionsCount: number
    selectedBotPrimaryBackend: string
    selectedBotDefaultBindingMode: string
    selectedBotDefaultBindingWorkspaceId: string
    selectedBotDefaultBindingThreadId: string
    selectedConnectionSupportsRouteTargetConfig: boolean
    deliveryTargetByConversationId: Map<string, BotDeliveryTarget>
  }
  binding: ThreadModalBase & {
    mode: 'existing' | 'new'
    bindingTitle: string
    onClearBinding: () => void
    onChangeMode: (nextValue: 'existing' | 'new') => void
    onChangeTitle: (nextValue: string) => void
    onResetClearBindingMutation: () => void
    onResetUpdateBindingMutation: () => void
    resolvedCurrentThread: Thread | null
    isBindingMutationPending: boolean
    isClearConversationBindingPending: boolean
    isUpdateConversationBindingPending: boolean
  }
  defaultBinding: {
    open: boolean
    mode: 'workspace_auto_thread' | 'fixed_thread'
    errorMessage: string
    workspaceId: string
    modeOptions: ThreadPickerOption[]
    threadSearch: string
    threadId: string
    threadOptions: ThreadPickerOption[]
    threadSelectableCount: number
    searchMatchCount: number
    isInitialLoading: boolean
    isResolvingCurrentThread: boolean
    activeThreadsError: unknown
    isFetchingNextPage: boolean
    currentThreadError: unknown
    isPickerOnCurrentWorkspace: boolean
    activeThreads: Thread[]
    resolvedCurrentThread: Thread | null
    onClose: () => void
    onSubmit: () => void
    onChangeWorkspaceId: (nextValue: string) => void
    onChangeThreadSearch: (nextValue: string) => void
    onChangeThreadId: (nextValue: string) => void
    onLoadMore: () => void
    onChangeMode: (nextValue: 'workspace_auto_thread' | 'fixed_thread') => void
    onResetUpdateBindingMutation: () => void
    isDefaultBindingMutationPending: boolean
    isUpdateBotDefaultBindingPending: boolean
  }
  routeTarget: {
    open: boolean
    mode: 'create' | 'save_from_existing' | 'edit'
    title: string
    description: string
    submitLabel: string
    errorMessage: string
    routeTargetRouteTypeOptions: ThreadPickerOption[]
    routeTargetStatusOptions: ThreadPickerOption[]
    routeTargetRouteType: string
    routeTargetTitle: string
    routeTargetRecipientMode: 'existing' | 'manual'
    routeTargetSuggestedRecipientValue: string
    routeTargetChatId: string
    routeTargetThreadId: string
    routeTargetAdvancedOpen: boolean
    routeTargetStatus: 'active' | 'paused'
    routeTargetLabelsDraft: string
    routeTargetCapabilitiesDraft: string
    routeTargetProviderStateDraft: string
    knownRouteTargetOptions: KnownRouteTargetOption[]
    knownRouteTargetSelectOptions: ThreadPickerOption[]
    selectedKnownRouteTargetOption: KnownRouteTargetOption | null
    recipientCandidatesError: unknown
    recipientCandidatesLoading: boolean
    routeTargetRouteKeyPreview: string
    selectedProvider: string
    onClose: () => void
    onSubmit: () => void
    onResetCreateOrEditMutation: () => void
    onResetRouteTargetMutation: () => void
    onResetFormError: () => void
    onChangeRouteType: (nextValue: string) => void
    onChangeTitle: (nextValue: string) => void
    onChangeRecipientMode: (nextValue: 'existing' | 'manual') => void
    onChangeSuggestedRecipientValue: (nextValue: string) => void
    onChangeChatId: (nextValue: string) => void
    onChangeThreadId: (nextValue: string) => void
    onToggleAdvanced: () => void
    onChangeStatus: (nextValue: 'active' | 'paused') => void
    onChangeLabels: (nextValue: string) => void
    onChangeCapabilities: (nextValue: string) => void
    onChangeProviderState: (nextValue: string) => void
    onApplySuggestedRouteTarget: (option: KnownRouteTargetOption | null) => void
    isRouteTargetMutationPending: boolean
  }
  outboundComposer: {
    open: boolean
    errorMessage: string
    isSendOutboundMessagePending: boolean
    outboundComposerTarget: BotConversation | null
    outboundComposerDeliveryTarget: BotDeliveryTarget | null
    outboundComposerText: string
    outboundComposerMediaDrafts: OutboundComposerMediaDraft[]
    outboundComposerMedia: BotMessageMedia[]
    outboundComposerMediaCapabilityIssues: Map<
      string,
      {
        kindUnsupported: boolean
        sourceUnsupported: boolean
      }
    >
    outboundComposerMediaLocationIssues: Map<string, string>
    outboundComposerMediaAdvisories: Map<string, BotOutboundMediaAdvisory[]>
    outboundComposerMediaDeliveryPlan: BotOutboundMediaDeliveryPlan
    outboundComposerMediaKindOptions: ThreadPickerOption[]
    outboundComposerMediaSourceOptions: ThreadPickerOption[]
    outboundComposerSupportedMediaKinds: BotOutboundMediaKind[]
    outboundComposerSupportedMediaSources: BotOutboundMediaSource[]
    outboundComposerHasPreviewContent: boolean
    outboundComposerTextPreview: string
    outboundComposerTextPlacementMessage: string
    outboundComposerMediaDeliverySummary: string
    outboundComposerMediaPlanMessage: string
    onClose: () => void
    onSubmit: () => void
    onAddMediaDraft: () => void
    onRemoveMediaDraft: (id: string) => void
    onUpdateMediaDraft: (id: string, updates: Partial<OutboundComposerMediaDraft>) => void
    onResetFeedback: () => void
    onChangeText: (nextValue: string) => void
  }
  wechatLogin: {
    open: boolean
    errorMessage: string
    autoRefreshNoticeKey: string
    autoRefreshPending: boolean
    wechatLoginId: string
    draft: BotsPageDraft
    wechatLoginAutoRefreshEnabled: boolean
    activeWeChatLogin: WeChatLogin | null
    activeWeChatLoginStatus: string
    wechatLoginExpiresInLabel: string
    isWechatLoginExpiringSoon: boolean
    isWechatLoginExpired: boolean
    showWechatLoginRefreshPlaceholder: boolean
    wechatLoginQRCodeUrl: string
    wechatLoginCopyLabel: string
    isWechatLoginRefreshPending: boolean
    isDeleteWeChatLoginPending: boolean
    onClose: () => void
    onDeleteWeChatLogin: () => void
    onUseWeChatCredentials: () => void
    onRefreshWeChatQRCode: () => void
    onStartWeChatLogin: () => void
    onCopyWeChatPayload: () => void
    onChangeWechatBaseUrl: (nextValue: string) => void
    onChangeAutoRefreshEnabled: (nextValue: boolean) => void
  }
  wechatAccount: {
    target: WeChatAccount | null
    errorMessage: string
    aliasDraft: string
    noteDraft: string
    isPending: boolean
    onClose: () => void
    onSubmit: () => void
    onChangeAlias: (nextValue: string) => void
    onChangeNote: (nextValue: string) => void
  }
  confirms: {
    isOutboundMode: boolean
    deleteDeliveryTarget: BotDeliveryTarget | null
    deleteDeliveryTargetErrorMessage: string
    deleteDeliveryTargetIsPending: boolean
    onCloseDeleteDeliveryTarget: () => void
    onConfirmDeleteDeliveryTarget: () => void
    deleteTarget: BotConnection | null
    deleteErrorMessage: string
    deleteIsPending: boolean
    onCloseDeleteTarget: () => void
    onConfirmDeleteTarget: () => void
    deleteWeChatAccountTarget: WeChatAccount | null
    deleteWeChatAccountErrorMessage: string
    deleteWeChatAccountIsPending: boolean
    onCloseDeleteWeChatAccount: () => void
    onConfirmDeleteWeChatAccount: () => void
    discardConnectionModalConfirmOpen: boolean
    isEditingConnection: boolean
    draftName: string
    editTargetName: string
    onCloseDiscardConnectionConfirm: () => void
    onConfirmDiscardConnection: () => void
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
  issue: string,
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
  mediaDeliveryPlan: BotOutboundMediaDeliveryPlan,
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

function formatBotDeliveryRouteLabel(routeType?: string | null) {
  switch (routeType?.trim().toLowerCase()) {
    case 'telegram_chat':
      return i18n._({ id: 'Telegram Chat', message: 'Telegram Chat' })
    case 'telegram_topic':
      return i18n._({ id: 'Telegram Topic', message: 'Telegram Topic' })
    case 'wechat_session':
      return i18n._({ id: 'WeChat Recipient', message: 'WeChat Recipient' })
    case 'feishu_chat':
      return i18n._({ id: 'Feishu Chat', message: 'Feishu Chat' })
    case 'feishu_thread':
      return i18n._({ id: 'Feishu Thread', message: 'Feishu Thread' })
    case 'qqbot_group':
      return i18n._({ id: 'QQ Bot Group', message: 'QQ Bot Group' })
    case 'qqbot_c2c':
      return i18n._({ id: 'QQ Bot Direct Message', message: 'QQ Bot Direct Message' })
    default:
      return i18n._({ id: 'Derived route', message: 'Derived route' })
  }
}

export function BotsPageDialogs(props: BotsPageDialogsProps) {
  const { shared, binding, defaultBinding, routeTarget, outboundComposer, wechatLogin, wechatAccount, confirms } = props
  const {
    isOutboundMode,
    workspaces,
    selectedBot,
    selectedConnection,
    selectedBotConnectionsCount,
    selectedBotPrimaryBackend,
    selectedBotDefaultBindingMode,
    selectedBotDefaultBindingWorkspaceId,
    selectedBotDefaultBindingThreadId,
    selectedConnectionSupportsRouteTargetConfig,
    deliveryTargetByConversationId,
  } = shared

  const {
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
    activeThreadsError,
    canLoadMore: canLoadMoreActiveThreads,
    isFetchingNextPage: isBindingThreadsFetchingNextPage,
    currentThreadError: currentBindingThreadQueryError,
    isPickerOnCurrentWorkspace: isBindingPickerOnCurrentWorkspace,
    activeThreads,
    resolvedCurrentThread: bindingResolvedCurrentThread,
    onClose: closeBindingModal,
    onSubmit: handleSubmitBinding,
    onChangeWorkspaceId: setBindingWorkspaceId,
    onChangeThreadSearch: setBindingThreadSearch,
    onChangeThreadId: setBindingThreadId,
    onLoadMore: handleLoadMoreBindingThreads,
    onClearBinding: handleClearBinding,
    onChangeMode: setBindingMode,
    bindingTitle,
    onChangeTitle: setBindingTitle,
    onResetClearBindingMutation: resetClearConversationBindingMutation,
    onResetUpdateBindingMutation: resetUpdateConversationBindingMutation,
    isBindingMutationPending,
    isClearConversationBindingPending,
    isUpdateConversationBindingPending,
  } = binding

  const {
    open: defaultBindingOpen,
    errorMessage: defaultBindingErrorMessage,
    workspaceId: defaultBindingWorkspaceId,
    mode: defaultBindingMode,
    modeOptions: defaultBindingModeOptions,
    threadSearch: defaultBindingThreadSearch,
    threadId: defaultBindingThreadId,
    threadOptions: defaultBindingThreadOptions,
    threadSelectableCount: defaultBindingThreadSelectableCount,
    searchMatchCount: defaultBindingSearchMatchCount,
    isInitialLoading: isDefaultBindingActiveThreadsInitialLoading,
    isResolvingCurrentThread: isResolvingCurrentDefaultBindingThread,
    activeThreadsError: defaultBindingActiveThreadsError,
    isFetchingNextPage: isDefaultBindingThreadsFetchingNextPage,
    currentThreadError: currentDefaultBindingThreadQueryError,
    isPickerOnCurrentWorkspace: isDefaultBindingPickerOnCurrentWorkspace,
    activeThreads: defaultBindingActiveThreads,
    resolvedCurrentThread: defaultBindingResolvedCurrentThread,
    onClose: closeDefaultBindingModal,
    onSubmit: handleSubmitDefaultBinding,
    onChangeWorkspaceId: setDefaultBindingWorkspaceId,
    onChangeThreadSearch: setDefaultBindingThreadSearch,
    onChangeThreadId: setDefaultBindingThreadId,
    onLoadMore: handleLoadMoreDefaultBindingThreads,
    onChangeMode: setDefaultBindingMode,
    onResetUpdateBindingMutation: resetUpdateBotDefaultBindingMutation,
    isDefaultBindingMutationPending,
    isUpdateBotDefaultBindingPending,
  } = defaultBinding

  const {
    open: routeTargetOpen,
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
    recipientCandidatesError,
    recipientCandidatesLoading,
    routeTargetRouteKeyPreview,
    selectedProvider,
    isRouteTargetMutationPending,
    onClose: closeRouteTargetModal,
    onSubmit: handleSubmitRouteTarget,
    onResetCreateOrEditMutation,
    onResetRouteTargetMutation,
    onResetFormError,
    onChangeRouteType,
    onChangeTitle,
    onChangeRecipientMode,
    onChangeSuggestedRecipientValue,
    onChangeChatId,
    onChangeThreadId,
    onToggleAdvanced,
    onChangeStatus,
    onChangeLabels,
    onChangeCapabilities,
    onChangeProviderState,
    onApplySuggestedRouteTarget,
  } = routeTarget

  const {
    open: outboundComposerOpen,
    errorMessage: outboundComposerErrorMessage,
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
  } = outboundComposer

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
  const hasIncompleteOutboundComposerMediaDrafts = outboundComposerMediaDrafts.some(
    (draft) => !draft.location.trim() && (draft.fileName.trim().length > 0 || draft.contentType.trim().length > 0),
  )
  const hasInvalidOutboundComposerMediaDrafts = outboundComposerMediaDrafts.some((draft) =>
    Boolean(outboundComposerMediaLocationIssues.get(draft.id)),
  )
  const hasUnsupportedOutboundComposerMediaDrafts = outboundComposerMediaDrafts.some((draft) => {
    const capabilityIssue = outboundComposerMediaCapabilityIssues.get(draft.id)
    return Boolean(capabilityIssue?.kindUnsupported || capabilityIssue?.sourceUnsupported)
  })
  const hasOutboundComposerMediaAdvisories = outboundComposerMediaDrafts.some((draft) => {
    const advisories = outboundComposerMediaAdvisories.get(draft.id) ?? []
    return advisories.length > 0
  })
  const outboundComposerModalFooter = (
    <>
      <Button disabled={isSendOutboundMessagePending} intent="secondary" onClick={closeOutboundComposer} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={
          isSendOutboundMessagePending ||
          (!outboundComposerText.trim() && outboundComposerMedia.length === 0) ||
          hasIncompleteOutboundComposerMediaDrafts ||
          hasInvalidOutboundComposerMediaDrafts ||
          hasUnsupportedOutboundComposerMediaDrafts
        }
        isLoading={isSendOutboundMessagePending}
        onClick={handleSubmitOutboundComposer}
        type="button"
      >
        {i18n._({ id: 'Send Message', message: 'Send Message' })}
      </Button>
    </>
  )

  const {
    open: wechatLoginOpen,
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
    isDeleteWeChatLoginPending,
    onClose: closeWeChatLoginModal,
    onDeleteWeChatLogin,
    onUseWeChatCredentials,
    onRefreshWeChatQRCode,
    onStartWeChatLogin,
    onCopyWeChatPayload,
    onChangeWechatBaseUrl,
    onChangeAutoRefreshEnabled,
  } = wechatLogin

  const {
    target: editWeChatAccountTarget,
    errorMessage: updateWeChatAccountErrorMessage,
    aliasDraft: wechatAccountAliasDraft,
    noteDraft: wechatAccountNoteDraft,
    isPending: isUpdateWeChatAccountPending,
    onClose: closeWeChatAccountEditModal,
    onSubmit: handleUpdateWeChatAccount,
    onChangeAlias: setWeChatAccountAliasDraft,
    onChangeNote: setWeChatAccountNoteDraft,
  } = wechatAccount

  const {
    isOutboundMode: isConfirmOutboundMode,
    deleteDeliveryTarget,
    deleteDeliveryTargetErrorMessage,
    deleteDeliveryTargetIsPending,
    onCloseDeleteDeliveryTarget,
    onConfirmDeleteDeliveryTarget,
    deleteTarget,
    deleteErrorMessage,
    deleteIsPending,
    onCloseDeleteTarget,
    onConfirmDeleteTarget,
    deleteWeChatAccountTarget,
    deleteWeChatAccountErrorMessage,
    deleteWeChatAccountIsPending,
    onCloseDeleteWeChatAccount,
    onConfirmDeleteWeChatAccount,
    discardConnectionModalConfirmOpen,
    isEditingConnection,
    draftName,
    editTargetName,
    onCloseDiscardConnectionConfirm,
    onConfirmDiscardConnection,
  } = confirms

  const bindingModalFooter = (
    <>
      <Button disabled={isBindingMutationPending} intent="secondary" onClick={closeBindingModal} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      {bindingTarget?.threadId ? (
        <Button
          disabled={isBindingMutationPending}
          intent="secondary"
          isLoading={isClearConversationBindingPending}
          onClick={handleClearBinding}
          type="button"
        >
          {i18n._({ id: 'Clear Binding', message: 'Clear Binding' })}
        </Button>
      ) : null}
      <Button
        disabled={isBindingMutationPending || (bindingMode === 'existing' && !bindingThreadId.trim())}
        isLoading={isUpdateConversationBindingPending}
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
      <Button
        disabled={isDefaultBindingMutationPending}
        intent="secondary"
        onClick={closeDefaultBindingModal}
        type="button"
      >
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={
          isDefaultBindingMutationPending ||
          (defaultBindingMode === 'fixed_thread' && !defaultBindingThreadId.trim())
        }
        isLoading={isUpdateBotDefaultBindingPending}
        onClick={handleSubmitDefaultBinding}
        type="button"
      >
        {i18n._({ id: 'Save Default Binding', message: 'Save Default Binding' })}
      </Button>
    </>
  )

  const routeTargetModalFooter = (
    <>
      <Button disabled={isRouteTargetMutationPending} intent="secondary" onClick={closeRouteTargetModal} type="button">
        {i18n._({ id: 'Cancel', message: 'Cancel' })}
      </Button>
      <Button
        disabled={
          !selectedConnectionSupportsRouteTargetConfig ||
          !routeTargetChatId.trim() ||
          ((routeTargetRouteType === 'telegram_topic' || routeTargetRouteType === 'feishu_thread') &&
            !routeTargetThreadId.trim())
        }
        isLoading={isRouteTargetMutationPending}
        onClick={handleSubmitRouteTarget}
        type="button"
      >
        {routeTargetSubmitLabel}
      </Button>
    </>
  )

  return (
    <>
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
                  resetUpdateConversationBindingMutation()
                  resetClearConversationBindingMutation()
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
                  resetUpdateConversationBindingMutation()
                  resetClearConversationBindingMutation()
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

                {activeThreadsError ? (
                  <InlineNotice
                    dismissible={false}
                    noticeKey="bot-binding-threads-load-failed"
                    title={i18n._({ id: 'Thread List Unavailable', message: 'Thread List Unavailable' })}
                    tone="error"
                  >
                    {getErrorMessage(activeThreadsError)}
                  </InlineNotice>
                ) : null}

                {isBindingPickerOnCurrentWorkspace &&
                currentBindingThreadQueryError &&
                bindingCurrentThreadId &&
                bindingResolvedCurrentThread === null ? (
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

                {!activeThreadsError && (activeThreads.length > 0 || canLoadMoreActiveThreads) ? (
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
                      resetUpdateConversationBindingMutation()
                      resetClearConversationBindingMutation()
                      setBindingThreadId(nextValue)
                    }}
                    options={bindingThreadOptions}
                    value={bindingThreadId}
                  />
                </label>

                {canLoadMoreActiveThreads ? (
                  <Button
                    intent="secondary"
                    isLoading={isBindingThreadsFetchingNextPage}
                    onClick={() => {
                      handleLoadMoreBindingThreads()
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

                {!isActiveThreadsInitialLoading && !activeThreadsError && activeThreads.length === 0 && !bindingTarget.threadId ? (
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
                  resetUpdateConversationBindingMutation()
                  resetClearConversationBindingMutation()
                  setBindingTitle(event.target.value)
                }}
                placeholder={i18n._({ id: 'VIP Queue', message: 'VIP Queue' })}
                value={bindingTitle}
              />
            )}
          </div>
        </Modal>
      ) : null}

      {defaultBindingOpen && selectedBot ? (
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
                <strong>{selectedBotConnectionsCount}</strong>
              </div>
              <div className="detail-row">
                <span>{i18n._({ id: 'Backend', message: 'Backend' })}</span>
                <strong>
                  {selectedBotPrimaryBackend
                    ? selectedBotPrimaryBackend
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
                  resetUpdateBotDefaultBindingMutation()
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
                  resetUpdateBotDefaultBindingMutation()
                  setDefaultBindingMode(nextValue === 'fixed_thread' ? 'fixed_thread' : 'workspace_auto_thread')
                }}
                options={defaultBindingModeOptions}
                value={defaultBindingMode}
              />
            </label>

            {defaultBindingMode === 'fixed_thread' ? (
              <>
                {isDefaultBindingActiveThreadsInitialLoading ? (
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

                {defaultBindingActiveThreadsError ? (
                  <InlineNotice
                    dismissible={false}
                    noticeKey="bot-default-binding-threads-load-failed"
                    title={i18n._({ id: 'Thread List Unavailable', message: 'Thread List Unavailable' })}
                    tone="error"
                  >
                    {getErrorMessage(defaultBindingActiveThreadsError)}
                  </InlineNotice>
                ) : null}

                {isDefaultBindingPickerOnCurrentWorkspace &&
                currentDefaultBindingThreadQueryError &&
                selectedBotDefaultBindingThreadId &&
                defaultBindingResolvedCurrentThread === null ? (
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

                {!defaultBindingActiveThreadsError && (defaultBindingActiveThreads.length > 0 || canLoadMoreActiveThreads) ? (
                  <div className="notice">
                    {i18n._({
                      id: 'Showing {count} loaded active threads from the selected workspace. Search locally, then load more if the thread is older.',
                      message:
                        'Showing {count} loaded active threads from the selected workspace. Search locally, then load more if the thread is older.',
                      values: { count: defaultBindingActiveThreads.length },
                    })}
                  </div>
                ) : null}

                <label className="field">
                  <span>{i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}</span>
                  <SelectControl
                    ariaLabel={i18n._({ id: 'Workspace Thread', message: 'Workspace Thread' })}
                    disabled={isDefaultBindingActiveThreadsInitialLoading || defaultBindingThreadSelectableCount === 0}
                    fullWidth
                    onChange={(nextValue) => {
                      resetUpdateBotDefaultBindingMutation()
                      setDefaultBindingThreadId(nextValue)
                    }}
                    options={defaultBindingThreadOptions}
                    value={defaultBindingThreadId}
                  />
                </label>

                {canLoadMoreActiveThreads ? (
                  <Button
                    intent="secondary"
                    isLoading={isDefaultBindingThreadsFetchingNextPage}
                    onClick={() => {
                      handleLoadMoreDefaultBindingThreads()
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

                {!isDefaultBindingActiveThreadsInitialLoading && !defaultBindingActiveThreadsError && defaultBindingActiveThreads.length === 0 ? (
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

      {isOutboundMode && routeTargetOpen && selectedBot && selectedConnection ? (
        <Modal
          description={routeTargetModalDescription}
          footer={routeTargetModalFooter}
          onClose={closeRouteTargetModal}
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
                      onResetFormError()
                      onResetCreateOrEditMutation()
                      onResetRouteTargetMutation()
                      onChangeSuggestedRecipientValue('')
                      onChangeRouteType(nextValue)
                      if (nextValue !== 'telegram_topic' && nextValue !== 'feishu_thread') {
                        onChangeThreadId('')
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
                    onResetFormError()
                    onChangeTitle(event.target.value)
                  }}
                  placeholder={i18n._({ id: 'Ops Alert Channel', message: 'Ops Alert Channel' })}
                  value={routeTargetTitle}
                />

                {recipientCandidatesError ? (
                  <div className="notice">
                    {i18n._({
                      id: 'Recipient suggestions could not be loaded right now. You can still enter a destination ID manually.',
                      message:
                        'Recipient suggestions could not be loaded right now. You can still enter a destination ID manually.',
                    })}
                  </div>
                ) : null}

                {recipientCandidatesLoading && !knownRouteTargetOptions.length ? (
                  <div className="notice">
                    {i18n._({
                      id: 'Loading recipient suggestions...',
                      message: 'Loading recipient suggestions...',
                    })}
                  </div>
                ) : null}

                {knownRouteTargetOptions.length ? (
                  <div className="field">
                    <span className="field-label">{i18n._({ id: 'Recipient Source', message: 'Recipient Source' })}</span>
                    <div className="segmented-control segmented-control--sm">
                      <Button
                        intent={routeTargetRecipientMode === 'existing' ? 'secondary' : 'ghost'}
                        onClick={() => onChangeRecipientMode('existing')}
                        type="button"
                      >
                        {i18n._({ id: 'Choose Existing', message: 'Choose Existing' })}
                      </Button>
                      <Button
                        intent={routeTargetRecipientMode === 'manual' ? 'secondary' : 'ghost'}
                        onClick={() => onChangeRecipientMode('manual')}
                        type="button"
                      >
                        {i18n._({ id: 'Enter Manually', message: 'Enter Manually' })}
                      </Button>
                    </div>
                    <small className="field-hint">
                      {i18n._({
                        id: 'Use a known recipient on this endpoint, or switch to manual entry for a brand-new destination.',
                        message:
                          'Use a known recipient on this endpoint, or switch to manual entry for a brand-new destination.',
                      })}
                    </small>
                  </div>
                ) : !recipientCandidatesLoading && !recipientCandidatesError ? (
                  <div className="notice">
                    {i18n._({
                      id: 'No known recipients are available on this endpoint yet, so this saved contact needs a manual destination ID.',
                      message:
                        'No known recipients are available on this endpoint yet, so this saved contact needs a manual destination ID.',
                    })}
                  </div>
                ) : null}

                {knownRouteTargetOptions.length && routeTargetRecipientMode === 'existing' ? (
                  <label className="field">
                    <span>{i18n._({ id: 'Available Recipient', message: 'Available Recipient' })}</span>
                    <SelectControl
                      ariaLabel={i18n._({ id: 'Available Recipient', message: 'Available Recipient' })}
                      fullWidth
                      onChange={(nextValue) => {
                        onResetFormError()
                        const nextOption = knownRouteTargetOptions.find((option) => option.value === nextValue) ?? null
                        onApplySuggestedRouteTarget(nextOption)
                      }}
                      options={knownRouteTargetSelectOptions}
                      value={routeTargetSuggestedRecipientValue}
                    />
                  </label>
                ) : (
                  <>
                    <Input
                      hint={
                        selectedProvider === 'wechat'
                          ? i18n._({
                              id: 'WeChat external user ID for proactive delivery. If this contact has not messaged the bot yet, the target will wait until a reply context becomes available.',
                              message:
                                'WeChat external user ID for proactive delivery. If this contact has not messaged the bot yet, the target will wait until a reply context becomes available.',
                            })
                          : routeTargetRouteType === 'telegram_chat' || routeTargetRouteType === 'telegram_topic'
                            ? i18n._({
                                id: 'Telegram chat ID, for example -1001234567890.',
                                message: 'Telegram chat ID, for example -1001234567890.',
                              })
                            : undefined
                      }
                      label={
                        selectedProvider === 'wechat'
                          ? i18n._({ id: 'WeChat User ID', message: 'WeChat User ID' })
                          : routeTargetRouteType === 'qqbot_c2c'
                            ? i18n._({ id: 'Recipient ID', message: 'Recipient ID' })
                            : i18n._({ id: 'Chat ID', message: 'Chat ID' })
                      }
                      onChange={(event) => {
                        onResetFormError()
                        onChangeChatId(event.target.value)
                      }}
                      placeholder={
                        selectedProvider === 'wechat'
                          ? 'wxid_xxx'
                          : routeTargetRouteType === 'qqbot_group'
                            ? 'group_openid_xxx'
                            : routeTargetRouteType === 'qqbot_c2c'
                              ? 'user_openid_xxx'
                              : routeTargetRouteType === 'feishu_chat' || routeTargetRouteType === 'feishu_thread'
                                ? 'oc_xxx'
                                : '-1001234567890'
                      }
                      value={routeTargetChatId}
                    />

                    {routeTargetRouteType === 'telegram_topic' || routeTargetRouteType === 'feishu_thread' ? (
                      <Input
                        hint={
                          routeTargetRouteType === 'telegram_topic'
                            ? i18n._({
                                id: 'Telegram topic thread ID inside the target supergroup.',
                                message: 'Telegram topic thread ID inside the target supergroup.',
                              })
                            : undefined
                        }
                        label={i18n._({ id: 'Thread ID', message: 'Thread ID' })}
                        onChange={(event) => {
                          onResetFormError()
                          onChangeThreadId(event.target.value)
                        }}
                        placeholder={routeTargetRouteType === 'telegram_topic' ? '42' : 'om_xxx'}
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
                      : routeTargetRouteType === 'feishu_thread'
                        ? i18n._({
                            id: 'Selected destination: chat {chatId}, thread {threadId}.',
                            message: 'Selected destination: chat {chatId}, thread {threadId}.',
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
                          : routeTargetRouteType === 'qqbot_c2c'
                            ? i18n._({
                                id: 'Selected destination: recipient {chatId}.',
                                message: 'Selected destination: recipient {chatId}.',
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
                  onClick={() => onToggleAdvanced()}
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
                          onResetFormError()
                          onChangeStatus(nextValue === 'paused' ? 'paused' : 'active')
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
                        onResetFormError()
                        onChangeLabels(event.target.value)
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
                        onResetFormError()
                        onChangeCapabilities(event.target.value)
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
                        onResetFormError()
                        onChangeProviderState(event.target.value)
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

      {isOutboundMode && outboundComposerOpen && selectedBot && selectedConnection ? (
        <Modal
          description={i18n._({
            id: 'Send text and optional attachments to the selected recipient. The backend records a dedicated outbound delivery entry for manual sends.',
            message:
              'Send text and optional attachments to the selected recipient. The backend records a dedicated outbound delivery entry for manual sends.',
          })}
          footer={outboundComposerModalFooter}
          onClose={closeOutboundComposer}
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
                <strong>{selectedConnection ? summarizeBotConnectionCapabilities(selectedConnection.capabilities) : i18n._({ id: 'none', message: 'none' })}</strong>
              </div>
            </div>

            {outboundComposerErrorMessage ? (
              <InlineNotice
                dismissible
                noticeKey={`send-bot-outbound-${outboundComposerErrorMessage}`}
                title={i18n._({ id: 'Send Proactive Message Failed', message: 'Send Proactive Message Failed' })}
                tone="error"
              >
                {outboundComposerErrorMessage}
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
                  message: 'Some attachments look inconsistent with their selected media type or metadata. Review the row hints before sending.',
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
                              label={draft.source === 'path' ? i18n._({ id: 'Absolute Local Path', message: 'Absolute Local Path' }) : i18n._({ id: 'Remote URL', message: 'Remote URL' })}
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

      {wechatLoginOpen ? (
        <Modal
          description={i18n._({
            id: 'Start a short-lived WeChat login session, display the provider-issued QR code, then pull the confirmed credential bundle back into the connection form.',
            message:
              'Start a short-lived WeChat login session, display the provider-issued QR code, then pull the confirmed credential bundle back into the connection form.',
          })}
          footer={
            <>
              {wechatLoginId ? (
                <Button intent="secondary" isLoading={isDeleteWeChatLoginPending} onClick={onDeleteWeChatLogin} type="button">
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
                <Button onClick={onUseWeChatCredentials} type="button">
                  {i18n._({ id: 'Use Credentials', message: 'Use Credentials' })}
                </Button>
              ) : (
                <Button
                  isLoading={isWechatLoginRefreshPending}
                  onClick={wechatLoginId ? () => void onRefreshWeChatQRCode() : onStartWeChatLogin}
                  type="button"
                >
                  {wechatLoginId
                    ? i18n._({ id: 'Refresh QR Code', message: 'Refresh QR Code' })
                    : i18n._({ id: 'Fetch QR Code', message: 'Fetch QR Code' })}
                </Button>
              )}
            </>
          }
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

            {wechatLoginAutoRefreshNoticeKey ? (
              <InlineNotice
                dismissible
                noticeKey={wechatLoginAutoRefreshNoticeKey}
                title={i18n._({ id: 'QR Code Auto-Refreshed', message: 'QR Code Auto-Refreshed' })}
                tone="info"
              >
                {i18n._({
                  id: 'A fresh QR code was requested automatically after the previous one expired.',
                  message: 'A fresh QR code was requested automatically after the previous one expired.',
                })}
              </InlineNotice>
            ) : null}

            {wechatLoginAutoRefreshPending ? (
              <InlineNotice
                dismissible={false}
                noticeKey="wechat-login-auto-refreshing"
                title={i18n._({
                  id: 'Refreshing QR Code Automatically',
                  message: 'Refreshing QR Code Automatically',
                })}
                tone="info"
              >
                {i18n._({
                  id: 'The previous QR code expired. Requesting a fresh code automatically now.',
                  message: 'The previous QR code expired. Requesting a fresh code automatically now.',
                })}
              </InlineNotice>
            ) : null}

            <Input
              hint={i18n._({
                id: 'This base URL is used both for fetching the QR code and for the final confirmed credential bundle.',
                message:
                  'This base URL is used both for fetching the QR code and for the final confirmed credential bundle.',
              })}
              label={i18n._({ id: 'WeChat Base URL', message: 'WeChat Base URL' })}
              onChange={(event) => onChangeWechatBaseUrl(event.target.value)}
              placeholder="https://ilinkai.weixin.qq.com"
              value={draft.wechatBaseUrl}
            />

            <Switch
              checked={wechatLoginAutoRefreshEnabled}
              hint={i18n._({
                id: 'When enabled, the dialog automatically requests a fresh QR code after the current one expires.',
                message: 'When enabled, the dialog automatically requests a fresh QR code after the current one expires.',
              })}
              label={i18n._({
                id: 'Auto Refresh When Expired',
                message: 'Auto Refresh When Expired',
              })}
              onChange={(event) => onChangeAutoRefreshEnabled(event.target.checked)}
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
                  {wechatLoginExpiresInLabel ? (
                    <div className="detail-row">
                      <span>{i18n._({ id: 'Expires In', message: 'Expires In' })}</span>
                      <strong
                        style={
                          isWechatLoginExpiringSoon
                            ? {
                                color: '#b45309',
                              }
                            : undefined
                        }
                      >
                        {wechatLoginExpiresInLabel}
                      </strong>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {showWechatLoginRefreshPlaceholder ? (
              <div
                style={{
                  alignItems: 'center',
                  display: 'grid',
                  gap: '16px',
                  justifyItems: 'center',
                }}
              >
                <div
                  aria-live="polite"
                  style={{
                    alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.96), rgba(226, 232, 240, 0.9))',
                    border: '1px dashed rgba(71, 85, 105, 0.3)',
                    borderRadius: '16px',
                    color: '#334155',
                    display: 'flex',
                    fontWeight: 600,
                    height: '320px',
                    justifyContent: 'center',
                    maxWidth: '100%',
                    padding: '24px',
                    textAlign: 'center',
                    width: '320px',
                  }}
                >
                  <div style={{ display: 'grid', gap: '10px' }}>
                    <strong>{i18n._({ id: 'Getting a Fresh QR Code...', message: 'Getting a Fresh QR Code...' })}</strong>
                    <span style={{ fontSize: '0.95rem', fontWeight: 500 }}>
                      {i18n._({
                        id: 'Please wait while the expired QR code is replaced.',
                        message: 'Please wait while the expired QR code is replaced.',
                      })}
                    </span>
                  </div>
                </div>
                <div className="notice">
                  {i18n._({
                    id: 'The QR area will update automatically as soon as the new code is ready.',
                    message: 'The QR area will update automatically as soon as the new code is ready.',
                  })}
                </div>
              </div>
            ) : activeWeChatLogin?.qrCodeContent ? (
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
                      opacity: isWechatLoginExpired ? 0.5 : 1,
                      padding: '12px',
                      width: '320px',
                    }}
                  />
                ) : (
                  <div className="notice">
                    {i18n._({ id: 'Rendering QR code...', message: 'Rendering QR code...' })}
                  </div>
                )}
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '12px',
                    justifyContent: 'center',
                  }}
                >
                  <Button
                    disabled={isWechatLoginExpired}
                    intent="secondary"
                    onClick={() => void onCopyWeChatPayload()}
                    type="button"
                  >
                    {wechatLoginCopyLabel}
                  </Button>
                  <Button
                    intent="secondary"
                    isLoading={isWechatLoginRefreshPending}
                    onClick={() => void onRefreshWeChatQRCode()}
                    type="button"
                  >
                    {i18n._({ id: 'Refresh QR Code', message: 'Refresh QR Code' })}
                  </Button>
                </div>
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

            {isWechatLoginExpiringSoon ? (
              <InlineNotice
                action={
                  <Button intent="secondary" isLoading={isWechatLoginRefreshPending} onClick={() => void onRefreshWeChatQRCode()} type="button">
                    {i18n._({ id: 'Refresh QR Code', message: 'Refresh QR Code' })}
                  </Button>
                }
                dismissible={false}
                noticeKey="wechat-login-expiring-soon"
                title={i18n._({ id: 'QR Code Expiring Soon', message: 'QR Code Expiring Soon' })}
              >
                {i18n._({
                  id: 'This QR code will expire in less than 30 seconds. Refresh it now if you still need time to scan in WeChat.',
                  message:
                    'This QR code will expire in less than 30 seconds. Refresh it now if you still need time to scan in WeChat.',
                })}
              </InlineNotice>
            ) : null}

            {isWechatLoginExpired ? (
              <InlineNotice
                action={
                  <Button isLoading={isWechatLoginRefreshPending} onClick={() => void onRefreshWeChatQRCode()} type="button">
                    {i18n._({ id: 'Refresh QR Code', message: 'Refresh QR Code' })}
                  </Button>
                }
                dismissible={false}
                noticeKey="wechat-login-expired"
                title={i18n._({ id: 'QR Code Expired', message: 'QR Code Expired' })}
                tone="error"
              >
                {i18n._({
                  id: 'This login QR code has expired. Refresh it to fetch a new code before scanning in WeChat.',
                  message: 'This login QR code has expired. Refresh it to fetch a new code before scanning in WeChat.',
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
              <Button isLoading={isUpdateWeChatAccountPending} onClick={handleUpdateWeChatAccount} type="button">
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

      {isConfirmOutboundMode && deleteDeliveryTarget ? (
        <ConfirmDialog
          confirmLabel={i18n._({ id: 'Remove Saved Contact', message: 'Remove Saved Contact' })}
          description={i18n._({
            id: 'This removes the saved contact configuration. Existing outbound delivery history stays visible, but future proactive sends to this destination will stop until you recreate it.',
            message:
              'This removes the saved contact configuration. Existing outbound delivery history stays visible, but future proactive sends to this destination will stop until you recreate it.',
          })}
          error={deleteDeliveryTargetErrorMessage}
          isPending={deleteDeliveryTargetIsPending}
          onClose={onCloseDeleteDeliveryTarget}
          onConfirm={onConfirmDeleteDeliveryTarget}
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
          isPending={deleteIsPending}
          onClose={onCloseDeleteTarget}
          onConfirm={onConfirmDeleteTarget}
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
          isPending={deleteWeChatAccountIsPending}
          onClose={onCloseDeleteWeChatAccount}
          onConfirm={onConfirmDeleteWeChatAccount}
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
          onClose={onCloseDiscardConnectionConfirm}
          onConfirm={onConfirmDiscardConnection}
          subject={draftName.trim() || editTargetName || i18n._({ id: 'Untitled Endpoint', message: 'Untitled Endpoint' })}
          title={
            isEditingConnection
              ? i18n._({ id: 'Discard Endpoint Changes', message: 'Discard Endpoint Changes' })
              : i18n._({ id: 'Discard New Endpoint Draft', message: 'Discard New Endpoint Draft' })
          }
        />
      ) : null}
    </>
  )
}
