import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'

import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { PageHeader } from '../components/ui/PageHeader'
import { StatusPill } from '../components/ui/StatusPill'
import { BotsPageConnectionSummarySection } from './BotsPageConnectionSummarySection'
import { BotsPageOutboundDeliveriesSection } from './BotsPageOutboundDeliveriesSection'
import { buildBotConnectionLogsRoute, buildBotEndpointsRoute } from '../lib/bot-routes'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
import { listWorkspaces } from '../features/workspaces/api'
import {
  getBotConnectionById,
  listBotConnectionLogsById,
  listBotConversations,
  listBotDeliveryTargets,
  listBotOutboundDeliveries,
  listWeChatAccounts,
} from '../features/bots/api'
import { summarizeRecentBotConnectionSuppressions } from '../features/bots/logStreamUtils'
import { formatLocalizedStatusLabel } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import {
  formatBotBackendLabel,
  formatBotCommandOutputModeLabel,
  formatBotConversationTitle,
  formatBotDeliveryRouteLabel,
  formatBotDeliveryTargetLabel,
  formatBotProviderLabel,
  formatBotTimestamp,
  findWeChatAccountForConnection,
  resolveBotBooleanSetting,
  resolveBotCommandOutputMode,
  resolveBotProvider,
  resolveFeishuDeliveryMode,
  resolveWeChatChannelTimingEnabled,
} from './botsPageUtils'
import { resolveBotConversationThreadTarget } from './botsPageUtils'
import type { BotConversation, BotDeliveryTarget, BotOutboundDelivery } from '../types/api'
function normalizeBotConversationDeliveryStatus(status?: string) {
  return status?.trim().toLowerCase() ?? ''
}

function sortDeliveriesDescending(deliveries: BotOutboundDelivery[]) {
  return [...deliveries].sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function sortConversationsDescending(conversations: BotConversation[]) {
  return [...conversations].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function formatEnabledDisabledLabel(value: boolean) {
  return value
    ? i18n._({ id: 'Enabled', message: 'Enabled' })
    : i18n._({ id: 'Disabled', message: 'Disabled' })
}

function DetailRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function DetailSection({ children, title }: { children: ReactNode; title: ReactNode }) {
  return (
    <section className="mode-panel">
      <div className="section-header section-header--inline">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2>{title}</h2>
        </div>
      </div>
      <div className="detail-list">{children}</div>
    </section>
  )
}

export function BotConnectionDetailPage() {
  const navigate = useNavigate()
  const { workspaceId = '', connectionId = '' } = useParams()

  const connectionQuery = useQuery({
    queryKey: ['bot-connection', connectionId],
    queryFn: () => getBotConnectionById(connectionId),
    enabled: connectionId.length > 0,
    refetchInterval: 5000,
  })

  const connection = connectionQuery.data ?? null
  const connectionWorkspaceId = connection?.workspaceId?.trim() || workspaceId.trim()
  const connectionBotId = connection?.botId?.trim() || ''
  const selectedProvider = resolveBotProvider(connection?.provider)

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  const weChatAccountsQuery = useQuery({
    queryKey: ['wechat-accounts', connectionWorkspaceId],
    queryFn: () => listWeChatAccounts(connectionWorkspaceId),
    enabled: connectionWorkspaceId.length > 0,
    refetchInterval: 10000,
  })

  const botDeliveryTargetsQuery = useQuery({
    queryKey: ['bot-delivery-targets', connectionWorkspaceId, connectionBotId],
    queryFn: () => listBotDeliveryTargets(connectionWorkspaceId, connectionBotId),
    enabled: connectionWorkspaceId.length > 0 && connectionBotId.length > 0,
    refetchInterval: 5000,
  })

  const botOutboundDeliveriesQuery = useQuery({
    queryKey: ['bot-outbound-deliveries', connectionWorkspaceId, connectionBotId],
    queryFn: () => listBotOutboundDeliveries(connectionWorkspaceId, connectionBotId),
    enabled: connectionWorkspaceId.length > 0 && connectionBotId.length > 0,
    refetchInterval: 5000,
  })

  const botConversationsQuery = useQuery({
    queryKey: ['bot-conversations', connectionWorkspaceId, connectionId],
    queryFn: () => listBotConversations(connectionWorkspaceId, connectionId),
    enabled: connectionWorkspaceId.length > 0 && connectionId.length > 0,
    refetchInterval: 5000,
  })

  const connectionLogsQuery = useQuery({
    queryKey: ['bot-connection-logs', connectionId],
    queryFn: () => listBotConnectionLogsById(connectionId),
    enabled: connectionId.length > 0,
    refetchInterval: 5000,
  })

  const workspaceById = useMemo(
    () => new Map((workspacesQuery.data ?? []).map((workspace) => [workspace.id, workspace] as const)),
    [workspacesQuery.data],
  )

  const deliveryTargets = botDeliveryTargetsQuery.data ?? []
  const outboundDeliveries = sortDeliveriesDescending(botOutboundDeliveriesQuery.data ?? [])
  const conversations = botConversationsQuery.data ?? []
  const deliveryTargetById = useMemo(
    () => new Map(deliveryTargets.map((target) => [target.id, target] as const)),
    [deliveryTargets],
  )

  const linkedWeChatAccount = useMemo(() => {
    if (!connection) {
      return null
    }
    return findWeChatAccountForConnection(weChatAccountsQuery.data ?? [], connection)
  }, [connection, weChatAccountsQuery.data])

  const selectedConnectionReadyRecipientsCount = deliveryTargets.filter((target) => isBotDeliveryTargetReady(target)).length
  const selectedConnectionWaitingRecipientsCount = deliveryTargets.length - selectedConnectionReadyRecipientsCount
  const selectedConnectionManualOutboundCount = outboundDeliveries.filter(
    (delivery) => delivery.sourceType?.trim().toLowerCase() === 'manual',
  ).length
  const selectedConnectionPendingOutboundCount = outboundDeliveries.filter((delivery) =>
    ['sending', 'retrying'].includes(normalizeBotConversationDeliveryStatus(delivery.status)),
  ).length
  const selectedConnectionFailedOutboundCount = outboundDeliveries.filter(
    (delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'failed',
  ).length
  const selectedConnectionDeliveredOutboundCount = outboundDeliveries.filter(
    (delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'delivered',
  ).length
  const selectedConnectionBoundConversationCount = conversations.filter(
    (conversation) => resolveBotConversationThreadTarget(conversation).threadId.length > 0,
  ).length
  const selectedConnectionLatestOutboundDelivery = outboundDeliveries[0] ?? null
  const selectedConnectionLatestDeliveredOutboundDelivery =
    outboundDeliveries.find((delivery) => normalizeBotConversationDeliveryStatus(delivery.status) === 'delivered') ?? null

  const selectedConnectionDeliveryMode =
    selectedProvider === 'telegram'
      ? connection?.settings?.telegram_delivery_mode?.trim().toLowerCase() === 'polling'
        ? 'polling'
        : 'webhook'
      : selectedProvider === 'feishu'
        ? resolveFeishuDeliveryMode(connection?.settings?.feishu_delivery_mode)
        : selectedProvider === 'qqbot'
          ? 'gateway_websocket'
          : selectedProvider === 'wechat'
            ? 'polling'
            : ''
  const selectedConnectionRuntimeMode: 'debug' | 'normal' =
    connection?.settings?.runtime_mode?.trim().toLowerCase() === 'debug' ? 'debug' : 'normal'
  const selectedConnectionCommandOutputMode = resolveBotCommandOutputMode(connection?.settings?.command_output_mode)
  const selectedConnectionUsesBackgroundRuntime =
    selectedProvider === 'wechat' ||
    (selectedProvider === 'feishu' && selectedConnectionDeliveryMode === 'websocket') ||
    selectedProvider === 'qqbot' ||
    (selectedProvider === 'telegram' && selectedConnectionDeliveryMode === 'polling')
  const selectedConnectionWeChatChannelTimingEnabled =
    selectedProvider === 'wechat'
      ? resolveWeChatChannelTimingEnabled(connection?.settings, selectedConnectionRuntimeMode)
      : false
  const sortedConversations = useMemo(() => sortConversationsDescending(conversations), [conversations])

  const selectedConnectionSummary = connection
    ? {
        conversationCount: conversations.length,
        deliveryTargetCount: deliveryTargets.length,
        readyRecipientCount: selectedConnectionReadyRecipientsCount,
        waitingRecipientCount: selectedConnectionWaitingRecipientsCount,
        outboundDeliveryCount: outboundDeliveries.length,
        deliveredOutboundCount: selectedConnectionDeliveredOutboundCount,
        manualOutboundCount: selectedConnectionManualOutboundCount,
        pendingOutboundCount: selectedConnectionPendingOutboundCount,
        failedOutboundCount: selectedConnectionFailedOutboundCount,
        boundConversationCount: selectedConnectionBoundConversationCount,
      }
    : null

  const selectedConnectionLabels = connection
    ? {
        deliveryModeLabel:
          selectedConnectionDeliveryMode === 'gateway_websocket'
            ? i18n._({ id: 'Gateway WebSocket', message: 'Gateway WebSocket' })
            : selectedConnectionDeliveryMode === 'websocket'
              ? i18n._({ id: 'WebSocket', message: 'WebSocket' })
              : selectedConnectionDeliveryMode === 'polling'
                ? i18n._({ id: 'Long Polling', message: 'Long Polling' })
                : selectedConnectionDeliveryMode === 'webhook'
                  ? i18n._({ id: 'Webhook', message: 'Webhook' })
                  : i18n._({ id: 'None', message: 'None' }),
        runtimeMode: selectedConnectionRuntimeMode,
        commandOutputModeLabel: formatBotCommandOutputModeLabel(selectedConnectionCommandOutputMode),
        usesBackgroundRuntime: selectedConnectionUsesBackgroundRuntime,
      }
    : null

  const selectedConnectionProviderSettings = connection
    ? {
        feishuEnableCards: resolveBotBooleanSetting(connection.settings?.feishu_enable_cards),
        feishuGroupReplyAll: resolveBotBooleanSetting(connection.settings?.feishu_group_reply_all),
        feishuThreadIsolation: resolveBotBooleanSetting(connection.settings?.feishu_thread_isolation),
        feishuShareSessionInChannel: resolveBotBooleanSetting(connection.settings?.feishu_share_session_in_channel),
        qqbotSandbox: resolveBotBooleanSetting(connection.settings?.qqbot_sandbox),
        qqbotShareSessionInChannel: resolveBotBooleanSetting(connection.settings?.qqbot_share_session_in_channel),
        qqbotMarkdownSupport: resolveBotBooleanSetting(connection.settings?.qqbot_markdown_support),
      }
    : null

  const selectedConnectionSuppressionSummary = useMemo(() => {
    const now = Date.now()
    return summarizeRecentBotConnectionSuppressions(connectionLogsQuery.data ?? [], now)
  }, [connectionLogsQuery.data])

  const workspaceName = connectionWorkspaceId
    ? workspaceById.get(connectionWorkspaceId)?.name ?? connectionWorkspaceId
    : ''
  const connectionErrorMessage = getErrorMessage(connectionQuery.error)
  const pageErrorMessage =
    connectionErrorMessage ||
    getErrorMessage(botDeliveryTargetsQuery.error) ||
    getErrorMessage(botOutboundDeliveriesQuery.error) ||
    getErrorMessage(botConversationsQuery.error) ||
    getErrorMessage(connectionLogsQuery.error) ||
    getErrorMessage(weChatAccountsQuery.error) ||
    ''

  function openLogs() {
    if (!connection || !connectionWorkspaceId) {
      return
    }
    navigate(buildBotConnectionLogsRoute(connectionWorkspaceId, connection.id))
  }

  function goBack() {
    navigate(buildBotEndpointsRoute(connectionWorkspaceId || workspaceId, connectionBotId, connection?.id ?? connectionId))
  }

  if (!connectionId) {
    return (
      <section className="screen screen--centered">
        <div className="notice">
          {i18n._({ id: 'Endpoint detail target is missing.', message: 'Endpoint detail target is missing.' })}
        </div>
      </section>
    )
  }

  if (connectionQuery.isLoading && !connectionQuery.data) {
    return (
      <section className="screen screen--centered">
        <div className="notice">{i18n._({ id: 'Loading endpoint detail…', message: 'Loading endpoint detail…' })}</div>
      </section>
    )
  }

  if (connectionQuery.error || !connection) {
    return (
      <section className="screen">
        <InlineNotice
          dismissible
          noticeKey={`bot-connection-detail-load-${workspaceId}-${connectionId}-${connectionErrorMessage}`}
          title={i18n._({ id: 'Endpoint Detail Loading Failed', message: 'Endpoint Detail Loading Failed' })}
          tone="info"
        >
          {connectionErrorMessage}
        </InlineNotice>
        <div className="header-actions">
          <Button intent="secondary" onClick={goBack}>
            {i18n._({ id: 'Back to Endpoints', message: 'Back to Endpoints' })}
          </Button>
        </div>
      </section>
    )
  }

  if (!selectedConnectionSummary || !selectedConnectionLabels || !selectedConnectionProviderSettings) {
    return null
  }

  return (
    <section className="screen">
      <PageHeader
        actions={
          <div className="header-actions">
            <Button intent="secondary" onClick={goBack}>
              {i18n._({ id: 'Back to Endpoints', message: 'Back to Endpoints' })}
            </Button>
            <Button intent="ghost" onClick={openLogs}>
              {i18n._({ id: 'View Logs', message: 'View Logs' })}
            </Button>
          </div>
        }
        description={i18n._({
          id: 'Dedicated workspace view for a single bot endpoint. Use it to inspect the connection summary and recent outbound activity without the bot list around it.',
          message:
            'Dedicated workspace view for a single bot endpoint. Use it to inspect the connection summary and recent outbound activity without the bot list around it.',
        })}
        eyebrow={i18n._({ id: 'Endpoint Detail', message: 'Endpoint Detail' })}
        meta={
          <>
            <StatusPill status={connection.status} />
            <span className="meta-pill">{formatBotProviderLabel(connection.provider)}</span>
            <span className="meta-pill">{formatBotBackendLabel(connection.aiBackend)}</span>
            <span className="meta-pill">{workspaceName}</span>
          </>
        }
        title={connection.name}
      />

      {pageErrorMessage ? (
        <InlineNotice
          dismissible
          noticeKey={`bot-connection-detail-error-${connectionId}-${pageErrorMessage}`}
          title={i18n._({ id: 'Endpoint Detail Partial Load', message: 'Endpoint Detail Partial Load' })}
          tone="info"
        >
          {pageErrorMessage}
        </InlineNotice>
      ) : null}

      <div className="form-stack">
        <section className="mode-panel">
          <BotsPageConnectionSummarySection
            connection={connection}
            latestDeliveredOutboundDelivery={selectedConnectionLatestDeliveredOutboundDelivery}
            latestOutboundDelivery={selectedConnectionLatestOutboundDelivery}
            mode="config"
            providerSettings={selectedConnectionProviderSettings}
            summaryCounts={selectedConnectionSummary}
            summaryLabels={selectedConnectionLabels}
            suppressionSummary={selectedConnectionSuppressionSummary}
            wechatAccount={linkedWeChatAccount}
          />
        </section>

        <DetailSection
          title={i18n._({
            id: 'Configuration',
            message: 'Configuration',
          })}
        >
          <DetailRow
            label={i18n._({ id: 'Runtime Mode', message: 'Runtime Mode' })}
            value={
              selectedConnectionLabels.runtimeMode === 'debug'
                ? i18n._({ id: 'Debug', message: 'Debug' })
                : i18n._({ id: 'Normal', message: 'Normal' })
            }
          />
          <DetailRow
            label={i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}
            value={selectedConnectionLabels.commandOutputModeLabel}
          />
          <DetailRow
            label={i18n._({ id: 'Background Runtime', message: 'Background Runtime' })}
            value={formatEnabledDisabledLabel(selectedConnectionLabels.usesBackgroundRuntime)}
          />
          {selectedProvider === 'wechat' ? (
            <DetailRow
              label={i18n._({ id: 'Append WeChat Channel Timing', message: 'Append WeChat Channel Timing' })}
              value={formatEnabledDisabledLabel(selectedConnectionWeChatChannelTimingEnabled)}
            />
          ) : null}
        </DetailSection>

        <DetailSection
          title={i18n._({
            id: 'Recipients',
            message: 'Recipients',
          })}
        >
          <DetailRow
            label={i18n._({ id: 'Total', message: 'Total' })}
            value={deliveryTargets.length}
          />
          <DetailRow
            label={i18n._({ id: 'Ready', message: 'Ready' })}
            value={selectedConnectionReadyRecipientsCount}
          />
          <DetailRow
            label={i18n._({ id: 'Waiting', message: 'Waiting' })}
            value={selectedConnectionWaitingRecipientsCount}
          />
          <div className="directory-list">
            {deliveryTargets.slice(0, 6).map((target) => {
              const targetThread = resolveBotConversationThreadTarget(
                conversations.find((conversation) => conversation.id === target.sessionId) ?? null,
              )
              return (
                <article className="directory-item" key={target.id}>
                  <div className="directory-item__icon">{i18n._({ id: 'DT', message: 'DT' })}</div>
                  <div className="directory-item__body">
                    <strong>{formatBotDeliveryTargetLabel(target)}</strong>
                    <p>
                      {i18n._({ id: 'Channel', message: 'Channel' })}: {formatBotDeliveryRouteLabel(target.routeType)}
                    </p>
                    <p>
                      {i18n._({ id: 'Delivery readiness', message: 'Delivery readiness' })}:{' '}
                      {target.deliveryReadiness?.trim() || i18n._({ id: 'Ready', message: 'Ready' })}
                    </p>
                    <p>
                      {i18n._({ id: 'Status', message: 'Status' })}:{' '}
                      {formatLocalizedStatusLabel(target.status)}
                    </p>
                  </div>
                  <div className="directory-item__meta" style={{ alignItems: 'end', display: 'grid', gap: '8px' }}>
                    <span className="meta-pill">{formatBotTimestamp(target.updatedAt)}</span>
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
        </DetailSection>

        <DetailSection
          title={i18n._({
            id: 'Conversations',
            message: 'Conversations',
          })}
        >
          <DetailRow
            label={i18n._({ id: 'Total', message: 'Total' })}
            value={sortedConversations.length}
          />
          <DetailRow
            label={i18n._({ id: 'Bound', message: 'Bound' })}
            value={selectedConnectionBoundConversationCount}
          />
          <div className="directory-list">
            {sortedConversations.slice(0, 6).map((conversation) => {
              const effectiveThreadTarget = resolveBotConversationThreadTarget(conversation)
              const hasEffectiveThreadTarget = effectiveThreadTarget.threadId.length > 0
              return (
                <article className="directory-item" key={conversation.id}>
                  <div className="directory-item__icon">{i18n._({ id: 'BT', message: 'BT' })}</div>
                  <div className="directory-item__body">
                    <strong>{formatBotConversationTitle(conversation)}</strong>
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
                        {i18n._({ id: 'Last outbound', message: 'Last outbound' })}: {conversation.lastOutboundText}
                      </p>
                    ) : null}
                    <p>
                      {i18n._({ id: 'Reply delivery', message: 'Reply delivery' })}:{' '}
                      <StatusPill status={normalizeBotConversationDeliveryStatus(conversation.lastOutboundDeliveryStatus)} />
                    </p>
                  </div>
                  <div className="directory-item__meta" style={{ alignItems: 'end', display: 'grid', gap: '8px' }}>
                    <span className="meta-pill">{formatBotTimestamp(conversation.updatedAt)}</span>
                    {hasEffectiveThreadTarget ? (
                      <Link to={buildWorkspaceThreadRoute(effectiveThreadTarget.workspaceId, effectiveThreadTarget.threadId)}>
                        {i18n._({ id: 'Open Thread', message: 'Open Thread' })}
                      </Link>
                    ) : (
                      <span className="meta-pill">{i18n._({ id: 'Thread pending', message: 'Thread pending' })}</span>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        </DetailSection>

        <InlineNotice
          dismissible={false}
          noticeKey={`bot-connection-detail-notification-center-${connectionId}`}
          title={i18n._({
            id: 'Notification Center owns trigger rules',
            message: 'Notification Center owns trigger rules',
          })}
          tone="info"
        >
          {i18n._({
            id: 'Legacy notification trigger rules are managed in Notification Center, not on the Bots page.',
            message: 'Legacy notification trigger rules are managed in Notification Center, not on the Bots page.',
          })}{' '}
          <Button intent="secondary" onClick={() => navigate('/notification-center')} size="sm" type="button">
            {i18n._({
              id: 'Open Notification Center',
              message: 'Open Notification Center',
            })}
          </Button>
        </InlineNotice>

        <BotsPageOutboundDeliveriesSection
          botOutboundDeliveriesErrorMessage={getErrorMessage(botOutboundDeliveriesQuery.error)}
          deliveryTargetById={deliveryTargetById}
          deliveries={outboundDeliveries}
          isLoading={botOutboundDeliveriesQuery.isLoading}
          onRetry={() => void botOutboundDeliveriesQuery.refetch()}
          selectedConnectionDeliveryTargetsCount={deliveryTargets.length}
          selectedConnectionDeliveredOutboundCount={selectedConnectionDeliveredOutboundCount}
          selectedConnectionFailedOutboundCount={selectedConnectionFailedOutboundCount}
          selectedConnectionId={connection.id}
          selectedConnectionManualOutboundCount={selectedConnectionManualOutboundCount}
          selectedConnectionPendingOutboundCount={selectedConnectionPendingOutboundCount}
        />
      </div>

      {selectedConnectionSuppressionSummary.suppressedCount > 0 ? (
        <div className="notice">
          {i18n._({
            id: 'This endpoint has recent replay suppressions. Full suppression history remains in the bots workspace view.',
            message:
              'This endpoint has recent replay suppressions. Full suppression history remains in the bots workspace view.',
          })}
        </div>
      ) : null}
    </section>
  )
}

function isBotDeliveryTargetReady(target: BotDeliveryTarget) {
  return target.status?.trim().toLowerCase() === 'active' || target.deliveryReadiness?.trim().toLowerCase() === 'ready'
}
