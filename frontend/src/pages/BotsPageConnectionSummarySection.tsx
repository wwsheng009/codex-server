import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { StatusPill } from '../components/ui/StatusPill'
import { i18n } from '../i18n/runtime'
import { formatBotRuntimeMessage } from '../features/bots/logStreamUtils'
import {
  FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_UPDATE_ONLY,
  formatBotBackendLabel,
  formatBotProviderLabel,
  formatBotTimestamp,
  formatBotWorkspacePermissionPresetLabel,
  formatFeishuStreamingPlainTextStrategyLabel,
  summarizeBotConnectionCapabilities,
  summarizeBotMap,
} from './botsPageUtils'
import type { BotConnection, BotOutboundDelivery, WeChatAccount } from '../types/api'

type BotsPageConnectionSummaryCounts = {
  conversationCount: number
  deliveryTargetCount: number
  readyRecipientCount: number
  waitingRecipientCount: number
  outboundDeliveryCount: number
  deliveredOutboundCount: number
  manualOutboundCount: number
  pendingOutboundCount: number
  failedOutboundCount: number
  boundConversationCount: number
}

type BotsPageConnectionSummaryLabels = {
  deliveryModeLabel: string
  runtimeMode: 'debug' | 'normal'
  commandOutputModeLabel: string
  usesBackgroundRuntime: boolean
}

type BotsPageConnectionProviderSettings = {
  feishuEnableCards: boolean
  feishuGroupReplyAll: boolean
  feishuThreadIsolation: boolean
  feishuShareSessionInChannel: boolean
  qqbotSandbox: boolean
  qqbotShareSessionInChannel: boolean
  qqbotMarkdownSupport: boolean
}

type BotsPageConnectionSuppressionSummary = {
  suppressedCount: number
  duplicateSuppressedCount: number
  recoverySuppressedCount: number
  latestSuppressedAt?: string
}

export type BotsPageConnectionSummarySectionProps = {
  mode: 'config' | 'outbound'
  connection: BotConnection
  latestOutboundDelivery: BotOutboundDelivery | null
  latestDeliveredOutboundDelivery: BotOutboundDelivery | null
  providerSettings: BotsPageConnectionProviderSettings
  summaryCounts: BotsPageConnectionSummaryCounts
  summaryLabels: BotsPageConnectionSummaryLabels
  suppressionSummary: BotsPageConnectionSuppressionSummary
  wechatAccount: WeChatAccount | null
}

function formatEnabledDisabledLabel(value: boolean) {
  return value
    ? i18n._({ id: 'Enabled', message: 'Enabled' })
    : i18n._({ id: 'Disabled', message: 'Disabled' })
}

function SummaryRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SummarySection({ children, title }: { children: ReactNode; title: ReactNode }) {
  return (
    <section className="settings-subsection settings-output-card">
      <div className="settings-subsection__header">
        <strong>{title}</strong>
      </div>
      <div className="detail-list">{children}</div>
    </section>
  )
}

function SummaryTile({
  label,
  tone = 'default',
  value,
}: {
  label: ReactNode
  tone?: 'default' | 'accent' | 'success' | 'warning'
  value: ReactNode
}) {
  const toneClass =
    tone === 'accent'
      ? 'config-summary-card__item--accent'
      : tone === 'success'
        ? 'config-summary-card__item--success'
        : tone === 'warning'
          ? 'config-summary-card__item--warning'
          : ''

  return (
    <div className={`config-summary-card__item ${toneClass}`.trim()}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function BotsPageConnectionSummarySection({
  connection,
  latestDeliveredOutboundDelivery,
  latestOutboundDelivery,
  mode,
  providerSettings,
  summaryCounts,
  summaryLabels,
  suppressionSummary,
  wechatAccount,
}: BotsPageConnectionSummarySectionProps) {
  const [summaryModalOpen, setSummaryModalOpen] = useState(false)

  useEffect(() => {
    setSummaryModalOpen(false)
  }, [connection.id, mode])

  const provider = connection.provider.trim().toLowerCase()
  const providerLabel = formatBotProviderLabel(connection.provider)
  const backendLabel = formatBotBackendLabel(connection.aiBackend)
  const title =
    mode === 'config'
      ? i18n._({ id: 'Configuration Summary', message: 'Configuration Summary' })
      : i18n._({ id: 'Outbound Summary', message: 'Outbound Summary' })

  return (
    <>
      <div className="config-summary-card">
        <div className="config-summary-card__header">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
            <span>{i18n._({ id: 'Endpoint ID', message: 'Endpoint ID' })}</span>
            <strong dir="auto">{connection.id}</strong>
          </div>
          <div style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            <StatusPill status={connection.status} />
            <Button intent="secondary" onClick={() => setSummaryModalOpen(true)} size="sm" type="button">
              {i18n._({ id: 'Open Details', message: 'Open Details' })}
            </Button>
          </div>
        </div>

        <div className="config-summary-card__grid">
          {mode === 'config' ? (
            <>
              <SummaryTile label={i18n._({ id: 'Provider', message: 'Provider' })} tone="accent" value={providerLabel} />
              <SummaryTile
                label={i18n._({ id: 'Delivery Mode', message: 'Delivery Mode' })}
                value={summaryLabels.deliveryModeLabel || i18n._({ id: 'None', message: 'None' })}
              />
              <SummaryTile label={i18n._({ id: 'AI Backend', message: 'AI Backend' })} value={backendLabel} />
            </>
          ) : (
            <>
              <SummaryTile
                label={i18n._({ id: 'Recipients', message: 'Recipients' })}
                tone="accent"
                value={summaryCounts.deliveryTargetCount}
              />
              <SummaryTile
                label={i18n._({ id: 'Outbound Deliveries', message: 'Outbound Deliveries' })}
                value={summaryCounts.outboundDeliveryCount}
              />
              <SummaryTile
                label={i18n._({ id: 'Conversation Records', message: 'Conversation Records' })}
                value={summaryCounts.conversationCount}
              />
            </>
          )}
        </div>
      </div>

      {summaryModalOpen ? (
        <Modal
          footer={
            <Button intent="secondary" onClick={() => setSummaryModalOpen(false)} type="button">
              {i18n._({ id: 'Close', message: 'Close' })}
            </Button>
          }
          maxWidth="min(1120px, 100%)"
          onClose={() => setSummaryModalOpen(false)}
          title={title}
        >
          <div className="form-stack">
            <SummarySection title={i18n._({ id: 'Summary', message: 'Summary' })}>
              {mode === 'config' ? (
                <>
                  <SummaryRow
                    label={i18n._({ id: 'Endpoint ID', message: 'Endpoint ID' })}
                    value={<strong dir="auto">{connection.id}</strong>}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Status', message: 'Status' })}
                    value={<StatusPill status={connection.status} />}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Provider', message: 'Provider' })}
                    value={providerLabel}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Delivery Mode', message: 'Delivery Mode' })}
                    value={summaryLabels.deliveryModeLabel}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Capabilities', message: 'Capabilities' })}
                    value={summarizeBotConnectionCapabilities(connection.capabilities)}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'AI Backend', message: 'AI Backend' })}
                    value={backendLabel}
                  />
                  {connection.aiBackend === 'workspace_thread' ? (
                    <SummaryRow
                      label={i18n._({ id: 'Permission Preset', message: 'Permission Preset' })}
                      value={formatBotWorkspacePermissionPresetLabel(connection.aiConfig?.permission_preset)}
                    />
                  ) : null}
                  <SummaryRow
                    label={i18n._({ id: 'Runtime Mode', message: 'Runtime Mode' })}
                    value={
                      summaryLabels.runtimeMode === 'debug'
                        ? i18n._({ id: 'Debug', message: 'Debug' })
                        : i18n._({ id: 'Normal', message: 'Normal' })
                    }
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}
                    value={summaryLabels.commandOutputModeLabel}
                  />
                  {summaryLabels.usesBackgroundRuntime ? (
                    <>
                      <SummaryRow
                        label={
                          provider === 'feishu' || provider === 'qqbot'
                            ? i18n._({ id: 'Runtime Status', message: 'Runtime Status' })
                            : i18n._({ id: 'Last Poll Status', message: 'Last Poll Status' })
                        }
                        value={
                          connection.lastPollStatus ? (
                            <StatusPill status={connection.lastPollStatus} />
                          ) : (
                            i18n._({ id: 'none', message: 'none' })
                          )
                        }
                      />
                      <SummaryRow
                        label={
                          provider === 'feishu' || provider === 'qqbot'
                            ? i18n._({ id: 'Runtime Updated', message: 'Runtime Updated' })
                            : i18n._({ id: 'Last Poll Time', message: 'Last Poll Time' })
                        }
                        value={formatBotTimestamp(connection.lastPollAt ?? undefined)}
                      />
                      <SummaryRow
                        label={
                          provider === 'feishu' || provider === 'qqbot'
                            ? i18n._({ id: 'Runtime Message', message: 'Runtime Message' })
                            : i18n._({ id: 'Last Poll Message', message: 'Last Poll Message' })
                        }
                        value={
                          formatBotRuntimeMessage(
                            connection.lastPollMessage,
                            connection.lastPollMessageKey,
                            connection.lastPollMessageParams,
                          ) || i18n._({ id: 'none', message: 'none' })
                        }
                      />
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  <SummaryRow
                    label={i18n._({ id: 'Conversation Records', message: 'Conversation Records' })}
                    value={summaryCounts.conversationCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Manual Send Surface', message: 'Manual Send Surface' })}
                    value={summarizeBotConnectionCapabilities(connection.capabilities)}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Threads Resolved', message: 'Threads Resolved' })}
                    value={summaryCounts.boundConversationCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Recipients', message: 'Recipients' })}
                    value={summaryCounts.deliveryTargetCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Ready Recipients', message: 'Ready Recipients' })}
                    value={summaryCounts.readyRecipientCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Waiting for Context', message: 'Waiting for Context' })}
                    value={summaryCounts.waitingRecipientCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Outbound Deliveries', message: 'Outbound Deliveries' })}
                    value={summaryCounts.outboundDeliveryCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Delivered', message: 'Delivered' })}
                    value={summaryCounts.deliveredOutboundCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Manual Sends', message: 'Manual Sends' })}
                    value={summaryCounts.manualOutboundCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'In Flight', message: 'In Flight' })}
                    value={summaryCounts.pendingOutboundCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Failed Deliveries', message: 'Failed Deliveries' })}
                    value={summaryCounts.failedOutboundCount}
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Last Delivery', message: 'Last Delivery' })}
                    value={
                      latestOutboundDelivery
                        ? formatBotTimestamp(latestOutboundDelivery.createdAt)
                        : i18n._({ id: 'none', message: 'none' })
                    }
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Last Delivered', message: 'Last Delivered' })}
                    value={
                      latestDeliveredOutboundDelivery?.deliveredAt
                        ? formatBotTimestamp(latestDeliveredOutboundDelivery.deliveredAt)
                        : i18n._({ id: 'none', message: 'none' })
                    }
                  />
                  <SummaryRow
                    label={i18n._({ id: 'Updated', message: 'Updated' })}
                    value={formatBotTimestamp(connection.updatedAt)}
                  />
                </>
              )}
            </SummarySection>

            {mode === 'config' ? (
              <SummarySection title={i18n._({ id: 'Details', message: 'Details' })}>
                <SummaryRow
                  label={i18n._({ id: 'Suppressed Replays (24h)', message: 'Suppressed Replays (24h)' })}
                  value={suppressionSummary.suppressedCount || i18n._({ id: 'none', message: 'none' })}
                />
                <SummaryRow
                  label={i18n._({
                    id: 'Duplicate Deliveries Suppressed (24h)',
                    message: 'Duplicate Deliveries Suppressed (24h)',
                  })}
                  value={suppressionSummary.duplicateSuppressedCount || i18n._({ id: 'none', message: 'none' })}
                />
                <SummaryRow
                  label={i18n._({ id: 'Restart Replays Suppressed (24h)', message: 'Restart Replays Suppressed (24h)' })}
                  value={suppressionSummary.recoverySuppressedCount || i18n._({ id: 'none', message: 'none' })}
                />
                <SummaryRow
                  label={i18n._({ id: 'Last Suppressed Replay', message: 'Last Suppressed Replay' })}
                  value={
                    suppressionSummary.latestSuppressedAt
                      ? formatBotTimestamp(suppressionSummary.latestSuppressedAt)
                      : i18n._({ id: 'none', message: 'none' })
                  }
                />
                <SummaryRow
                  label={i18n._({ id: 'Secret Keys', message: 'Secret Keys' })}
                  value={connection.secretKeys?.join(', ') || i18n._({ id: 'none', message: 'none' })}
                />
                <SummaryRow
                  label={i18n._({ id: 'Provider Settings', message: 'Provider Settings' })}
                  value={summarizeBotMap(connection.settings)}
                />
                {provider === 'wechat' ? (
                  <SummaryRow
                    label={i18n._({ id: 'Saved WeChat Account', message: 'Saved WeChat Account' })}
                    value={
                      wechatAccount ? formatBotAccountLabel(wechatAccount) : i18n._({ id: 'none', message: 'none' })
                    }
                  />
                ) : null}
                {provider === 'feishu' ? (
                  <>
                    <SummaryRow
                      label={i18n._({ id: 'Feishu App ID', message: 'Feishu App ID' })}
                      value={connection.settings?.feishu_app_id?.trim() || i18n._({ id: 'none', message: 'none' })}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Feishu Delivery Mode', message: 'Feishu Delivery Mode' })}
                      value={summaryLabels.deliveryModeLabel}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Feishu Domain', message: 'Feishu Domain' })}
                      value={connection.settings?.feishu_domain?.trim() || i18n._({ id: 'Default Domain', message: 'Default Domain' })}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Streaming Plain Text', message: 'Streaming Plain Text' })}
                      value={formatFeishuStreamingPlainTextStrategyLabel(
                        connection.settings?.feishu_streaming_plain_text_strategy,
                        FEISHU_STREAMING_PLAIN_TEXT_STRATEGY_UPDATE_ONLY,
                      )}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Interactive Card', message: 'Interactive Card' })}
                      value={formatEnabledDisabledLabel(providerSettings.feishuEnableCards)}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Group Reply All', message: 'Group Reply All' })}
                      value={formatEnabledDisabledLabel(providerSettings.feishuGroupReplyAll)}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Thread Isolation', message: 'Thread Isolation' })}
                      value={formatEnabledDisabledLabel(providerSettings.feishuThreadIsolation)}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Share Session In Channel', message: 'Share Session In Channel' })}
                      value={formatEnabledDisabledLabel(providerSettings.feishuShareSessionInChannel)}
                    />
                  </>
                ) : null}
                {provider === 'qqbot' ? (
                  <>
                    <SummaryRow
                      label={i18n._({ id: 'QQ Bot App ID', message: 'QQ Bot App ID' })}
                      value={connection.settings?.qqbot_app_id?.trim() || i18n._({ id: 'none', message: 'none' })}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Sandbox', message: 'Sandbox' })}
                      value={formatEnabledDisabledLabel(providerSettings.qqbotSandbox)}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Share Session In Channel', message: 'Share Session In Channel' })}
                      value={formatEnabledDisabledLabel(providerSettings.qqbotShareSessionInChannel)}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'Markdown Support', message: 'Markdown Support' })}
                      value={formatEnabledDisabledLabel(providerSettings.qqbotMarkdownSupport)}
                    />
                    <SummaryRow
                      label={i18n._({ id: 'QQ Bot Intents', message: 'QQ Bot Intents' })}
                      value={connection.settings?.qqbot_intents?.trim() || i18n._({ id: 'Recommended default', message: 'Recommended default' })}
                    />
                  </>
                ) : null}
                <SummaryRow
                  label={i18n._({ id: 'AI Config', message: 'AI Config' })}
                  value={summarizeBotMap(connection.aiConfig)}
                />
                <SummaryRow
                  label={i18n._({ id: 'Updated', message: 'Updated' })}
                  value={formatBotTimestamp(connection.updatedAt)}
                />
              </SummarySection>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function formatBotAccountLabel(account: WeChatAccount) {
  const alias = account.alias?.trim()
  if (alias) {
    return alias
  }

  const accountLabel = account.accountId?.trim()
  if (accountLabel) {
    return accountLabel
  }

  return account.id
}
