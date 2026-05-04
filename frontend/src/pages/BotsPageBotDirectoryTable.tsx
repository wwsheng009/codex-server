import { Button } from '../components/ui/Button'
import { StatusPill } from '../components/ui/StatusPill'
import { i18n } from '../i18n/runtime'
import {
  formatBotBackendLabel,
  formatBotDefaultBindingModeLabel,
  formatBotProviderLabel,
  formatBotTimestamp,
  formatBotWorkspacePermissionPresetLabel,
  formatBotSharedWorkspaceSummary,
  formatBotScopeLabel,
  formatBotSharingModeLabel,
  isBotWorkspacePermissionPresetFullAccess,
  summarizeBotConnectionCapabilities,
} from './botsPageUtils'
import type { Bot, BotConnection, Workspace } from '../types/api'

export type BotsPageBotOutboundStats = {
  deliveryTargetCount: number
  readyRecipientCount: number
  waitingRecipientCount: number
  outboundDeliveryCount: number
  manualOutboundCount: number
  failedOutboundCount: number
  latestOutboundCreatedAt: string
}

type BotsPageBotDirectoryTableProps = {
  bots: Bot[]
  connectionsByBotId: Map<string, BotConnection[]>
  mode: 'config' | 'outbound'
  outboundStatsByBotId: Map<string, BotsPageBotOutboundStats>
  selectedBotId: string
  workspaceById: Map<string, Workspace>
  onOpenBotEndpoints: (bot: Bot) => void
  onOpenBotInfo: (bot: Bot) => void
  onOpenBotOutbound: (bot: Bot) => void
  onOpenBotEdit: (bot: Bot) => void
  onSelectBot: (bot: Bot) => void
}

export function BotsPageBotDirectoryTable({
  bots,
  connectionsByBotId,
  mode,
  outboundStatsByBotId,
  onOpenBotEdit,
  onOpenBotEndpoints,
  onOpenBotInfo,
  onOpenBotOutbound,
  onSelectBot,
  selectedBotId,
  workspaceById,
}: BotsPageBotDirectoryTableProps) {
  return (
    <div className="bots-page-table-wrap">
      <table className="bots-page-table">
        <thead>
          <tr>
            <th>{i18n._({ id: 'Bot', message: 'Bot' })}</th>
            <th>{i18n._({ id: 'Workspace', message: 'Workspace' })}</th>
            <th>{i18n._({ id: 'Status', message: 'Status' })}</th>
            <th>{i18n._({ id: 'Endpoints', message: 'Endpoints' })}</th>
            <th>
              {mode === 'config'
                ? i18n._({ id: 'Conversations', message: 'Conversations' })
                : i18n._({ id: 'Outbound', message: 'Outbound' })}
            </th>
            <th>{i18n._({ id: 'Updated', message: 'Updated' })}</th>
            <th>{i18n._({ id: 'Actions', message: 'Actions' })}</th>
          </tr>
        </thead>
        <tbody>
          {bots.map((bot) => {
            const botConnections = connectionsByBotId.get(bot.id) ?? []
            const activeConnectionCount = botConnections.filter((connection) => connection.status === 'active').length
            const primaryConnection = botConnections.find((connection) => connection.status === 'active') ?? botConnections[0] ?? null
            const outboundStats = outboundStatsByBotId.get(bot.id) ?? {
              deliveryTargetCount: 0,
              readyRecipientCount: 0,
              waitingRecipientCount: 0,
              outboundDeliveryCount: 0,
              manualOutboundCount: 0,
              failedOutboundCount: 0,
              latestOutboundCreatedAt: '',
            }
            const workspaceName = workspaceById.get(bot.workspaceId)?.name ?? bot.workspaceId
            const isSelected = selectedBotId === bot.id
            const primaryBackendLabel = primaryConnection
              ? formatBotBackendLabel(primaryConnection.aiBackend)
              : i18n._({ id: 'None', message: 'None' })
            const defaultBindingModeLabel = formatBotDefaultBindingModeLabel(
              bot.defaultBindingMode,
              primaryConnection?.aiBackend,
            )
            const workspaceSummary = formatBotSharedWorkspaceSummary(bot, workspaceById)

            return (
                <tr
                  aria-selected={isSelected}
                  className={isSelected ? 'bots-page-table__row bots-page-table__row--selected' : 'bots-page-table__row'}
                  key={bot.id}
                  onClick={() => onSelectBot(bot)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelectBot(bot)
                    }
                  }}
                  tabIndex={0}
                >
                <td>
                  <div className="bots-page-table__bot">
                    <button
                      aria-pressed={isSelected}
                      className="bots-page-table__bot-button"
                      onClick={(event) => {
                        event.stopPropagation()
                        onSelectBot(bot)
                      }}
                      type="button"
                    >
                      <strong dir="auto">{bot.name}</strong>
                      {bot.description?.trim() ? <span>{bot.description.trim()}</span> : null}
                      <span>
                        {primaryConnection ? (
                          <>
                            {formatBotProviderLabel(primaryConnection.provider)} · {primaryBackendLabel}
                          </>
                        ) : (
                          i18n._({ id: 'No endpoints yet', message: 'No endpoints yet' })
                        )}
                      </span>
                    </button>
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <strong>{workspaceName}</strong>
                    <span>{formatBotScopeLabel(bot.scope)}</span>
                    <span>{formatBotSharingModeLabel(bot.sharingMode)}</span>
                    <span>{workspaceSummary}</span>
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <StatusPill status={bot.status} />
                    <span>
                      {i18n._({
                        id: '{count} endpoint(s) · {activeCount} active',
                        message: '{count} endpoint(s) · {activeCount} active',
                        values: {
                          count: bot.endpointCount,
                          activeCount: activeConnectionCount,
                        },
                      })}
                    </span>
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <strong>
                      {i18n._({
                        id: '{count} endpoint(s)',
                        message: '{count} endpoint(s)',
                        values: { count: botConnections.length },
                      })}
                    </strong>
                    {primaryConnection ? (
                      <span>
                        {formatBotProviderLabel(primaryConnection.provider)} · {formatBotBackendLabel(primaryConnection.aiBackend)}
                      </span>
                    ) : null}
                    {primaryConnection?.capabilities?.length ? (
                      <span>{summarizeBotConnectionCapabilities(primaryConnection.capabilities)}</span>
                    ) : null}
                    {primaryConnection?.aiBackend === 'workspace_thread' &&
                    isBotWorkspacePermissionPresetFullAccess(primaryConnection.aiConfig?.permission_preset) ? (
                      <span className="meta-pill meta-pill--danger">
                        {formatBotWorkspacePermissionPresetLabel(primaryConnection.aiConfig?.permission_preset)}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    {mode === 'config' ? (
                      <>
                        <strong>
                          {i18n._({
                            id: '{count} conversation(s)',
                            message: '{count} conversation(s)',
                            values: { count: bot.conversationCount },
                          })}
                        </strong>
                        <span>{defaultBindingModeLabel}</span>
                      </>
                    ) : (
                      <>
                        <strong>
                          {i18n._({
                            id: '{count} recipient(s)',
                            message: '{count} recipient(s)',
                            values: { count: outboundStats.deliveryTargetCount },
                          })}
                        </strong>
                        <span>
                          {i18n._({
                            id: '{deliveryCount} delivery(ies)',
                            message: '{deliveryCount} delivery(ies)',
                            values: { deliveryCount: outboundStats.outboundDeliveryCount },
                          })}
                        </span>
                        <span>
                          {i18n._({
                            id: 'Ready: {readyCount} · Waiting: {waitingCount}',
                            message: 'Ready: {readyCount} · Waiting: {waitingCount}',
                            values: {
                              readyCount: outboundStats.readyRecipientCount,
                              waitingCount: outboundStats.waitingRecipientCount,
                            },
                          })}
                        </span>
                      </>
                    )}
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <span>{formatBotTimestamp(bot.updatedAt)}</span>
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__actions">
                    <Button
                      intent="secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenBotInfo(bot)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Info', message: 'Info' })}
                    </Button>
                    <Button
                      intent="secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenBotEndpoints(bot)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Endpoints', message: 'Endpoints' })}
                    </Button>
                    <Button
                      intent="ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenBotOutbound(bot)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Outbound', message: 'Outbound' })}
                    </Button>
                    <Button
                      intent="ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenBotEdit(bot)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Edit', message: 'Edit' })}
                    </Button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
