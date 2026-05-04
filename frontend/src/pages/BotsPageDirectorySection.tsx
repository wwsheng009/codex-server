import type { ReactNode } from 'react'

import { InlineNotice } from '../components/ui/InlineNotice'
import { Input } from '../components/ui/Input'
import { Switch } from '../components/ui/Switch'
import { Tooltip } from '../components/ui/Tooltip'
import { getErrorMessage } from '../lib/error-utils'
import { i18n } from '../i18n/runtime'
import { BotsPageBotDirectoryTable, type BotsPageBotOutboundStats } from './BotsPageBotDirectoryTable'
import { BotsPageEndpointDirectoryTable } from './BotsPageEndpointDirectoryTable'
import type { Bot, BotConnection, Workspace } from '../types/api'

type BotsPageDirectorySectionMode = 'config' | 'outbound' | 'endpoints'

type BotsPageDirectorySectionProps = {
  actionErrorMessage: string
  bots: Bot[]
  botsQueryError: unknown
  botsQueryIsLoading: boolean
  botById: Map<string, Bot>
  connectionSearch: string
  connections: BotConnection[]
  connectionsByBotId: Map<string, BotConnection[]>
  connectionsQueryError: unknown
  connectionsQueryIsLoading: boolean
  filteredBots: Bot[]
  filteredConnections: BotConnection[]
  hasWorkspaces: boolean
  mode: BotsPageDirectorySectionMode
  onChangeConnectionSearch: (nextValue: string) => void
  onEditConnection: (connection: BotConnection) => void
  onOpenBotEdit: (bot: Bot) => void
  onOpenBotEndpoints: (bot: Bot) => void
  onOpenBotInfo: (bot: Bot) => void
  onOpenBotOutbound: (bot: Bot) => void
  onOpenConnectionDetail: (connection: BotConnection) => void
  onOpenConnectionLogs: (connection: BotConnection) => void
  onOpenConnectionOverview: (connection: BotConnection) => void
  onRetryBots: () => void
  onRetryConnections: () => void
  onRetryWorkspaces: () => void
  onSelectBot: (bot: Bot) => void
  onSelectConnection: (connection: BotConnection) => void
  onToggleShowFullAccessConnectionsOnly: (nextValue: boolean) => void
  replayFailedReplyErrorMessage: string
  selectedBotFilterId: string
  selectedBotFilterLabel: string
  selectedBotId: string
  selectedConnectionId: string
  showFullAccessConnectionsOnly: boolean
  workspaceById: Map<string, Workspace>
  workspacesQueryError: unknown
  workspacesQueryIsLoading: boolean
  outboundStatsByBotId: Map<string, BotsPageBotOutboundStats>
}

function HelpTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

function formatDirectoryTitle(mode: BotsPageDirectorySectionMode) {
  if (mode === 'config') {
    return i18n._({ id: 'Bots', message: 'Bots' })
  }
  if (mode === 'outbound') {
    return i18n._({ id: 'Outbound Bots', message: 'Outbound Bots' })
  }
  return i18n._({ id: 'Endpoints', message: 'Endpoints' })
}

function formatDirectoryDescription(
  mode: BotsPageDirectorySectionMode,
  selectedBotFilterLabel: string,
  selectedBotFilterId: string,
) {
  if (mode === 'config') {
    return i18n._({
      id: 'Search by bot name, endpoint name, provider, backend, status, or linked WeChat account metadata.',
      message:
        'Search by bot name, endpoint name, provider, backend, status, or linked WeChat account metadata.',
    })
  }

  if (mode === 'outbound') {
    return i18n._({
      id: 'Search the outbound directory by bot, endpoint, provider, or linked account metadata, then focus on bots that still have active send surfaces.',
      message:
        'Search the outbound directory by bot, endpoint, provider, or linked account metadata, then focus on bots that still have active send surfaces.',
    })
  }

  return selectedBotFilterId
    ? i18n._({
        id: 'Search endpoints for {botName} by endpoint name, provider, backend, status, or linked WeChat account metadata.',
        message:
          'Search endpoints for {botName} by endpoint name, provider, backend, status, or linked WeChat account metadata.',
        values: { botName: selectedBotFilterLabel },
      })
    : i18n._({
        id: 'Search endpoints by endpoint name, bot name, provider, backend, status, or linked WeChat account metadata.',
        message:
          'Search endpoints by endpoint name, bot name, provider, backend, status, or linked WeChat account metadata.',
      })
}

function formatDirectoryFilterLabel(mode: BotsPageDirectorySectionMode) {
  return mode === 'config'
    ? i18n._({ id: 'Only Show Full Access', message: 'Only Show Full Access' })
    : i18n._({ id: 'Only Show Active Endpoints', message: 'Only Show Active Endpoints' })
}

function formatDirectoryFilterDescription(mode: BotsPageDirectorySectionMode) {
  return mode === 'config'
    ? i18n._({
        id: 'Restrict the bot list to entries that include at least one workspace-thread endpoint with full-access execution.',
        message:
          'Restrict the bot list to entries that include at least one workspace-thread endpoint with full-access execution.',
      })
    : i18n._({
        id: 'Restrict the list to active endpoints that can still be used for inspection, logs, and outbound operations.',
        message:
          'Restrict the list to active endpoints that can still be used for inspection, logs, and outbound operations.',
      })
}

function formatSearchLabel(mode: BotsPageDirectorySectionMode) {
  return mode === 'endpoints'
    ? i18n._({ id: 'Search Endpoints', message: 'Search Endpoints' })
    : i18n._({ id: 'Search Bots', message: 'Search Bots' })
}

function formatSearchPlaceholder(mode: BotsPageDirectorySectionMode) {
  if (mode === 'endpoints') {
    return i18n._({
      id: 'Telegram endpoint, workspace_thread, alerts, retry',
      message: 'Telegram endpoint, workspace_thread, alerts, retry',
    })
  }
  if (mode === 'config') {
    return i18n._({
      id: 'Support bot, telegram, openai, support queue',
      message: 'Support bot, telegram, openai, support queue',
    })
  }
  return i18n._({
    id: 'Ops bot, telegram, alerts endpoint',
    message: 'Ops bot, telegram, alerts endpoint',
  })
}

function formatEmptyStateMessage(mode: BotsPageDirectorySectionMode) {
  if (mode === 'config') {
    return i18n._({
      id: 'No bots yet. Create a bot first, then attach one or more Telegram, WeChat, Feishu, or QQ Bot endpoints to it.',
      message:
        'No bots yet. Create a bot first, then attach one or more Telegram, WeChat, Feishu, or QQ Bot endpoints to it.',
    })
  }

  if (mode === 'outbound') {
    return i18n._({
      id: 'No outbound bots are ready yet. Create a bot, attach an endpoint, then return here to manage recipients and deliveries.',
      message:
        'No outbound bots are ready yet. Create a bot, attach an endpoint, then return here to manage recipients and deliveries.',
    })
  }

  return i18n._({
    id: 'No endpoints yet. Create a bot first, then attach one or more endpoints to it.',
    message: 'No endpoints yet. Create a bot first, then attach one or more endpoints to it.',
  })
}

function formatFilteredEmptyStateMessage(
  mode: BotsPageDirectorySectionMode,
  showFullAccessConnectionsOnly: boolean,
  selectedBotFilterLabel: string,
  selectedBotFilterId: string,
) {
  if (showFullAccessConnectionsOnly) {
    if (mode === 'config') {
      return i18n._({
        id: 'No bots with full-access endpoints match the current search and filters.',
        message: 'No bots with full-access endpoints match the current search and filters.',
      })
    }

    if (mode === 'outbound') {
      return i18n._({
        id: 'No bots with active endpoints match the current search and filters.',
        message: 'No bots with active endpoints match the current search and filters.',
      })
    }

    return i18n._({
      id: 'No endpoints with active status match the current search and filters.',
      message: 'No endpoints with active status match the current search and filters.',
    })
  }

  if (mode === 'endpoints') {
    return selectedBotFilterId
      ? i18n._({
          id: 'No endpoints for {botName} match the current search.',
          message: 'No endpoints for {botName} match the current search.',
          values: { botName: selectedBotFilterLabel },
        })
      : i18n._({
          id: 'No endpoints match the current search.',
          message: 'No endpoints match the current search.',
        })
  }

  return i18n._({ id: 'No bots match the current search.', message: 'No bots match the current search.' })
}

export function BotsPageDirectorySection({
  actionErrorMessage,
  bots,
  botsQueryError,
  botsQueryIsLoading,
  botById,
  connectionSearch,
  connections,
  connectionsByBotId,
  connectionsQueryError,
  connectionsQueryIsLoading,
  filteredBots,
  filteredConnections,
  hasWorkspaces,
  mode,
  onChangeConnectionSearch,
  onEditConnection,
  onOpenBotEdit,
  onOpenBotEndpoints,
  onOpenBotInfo,
  onOpenBotOutbound,
  onOpenConnectionDetail,
  onOpenConnectionLogs,
  onOpenConnectionOverview,
  onRetryBots,
  onRetryConnections,
  onRetryWorkspaces,
  onSelectBot,
  onSelectConnection,
  onToggleShowFullAccessConnectionsOnly,
  replayFailedReplyErrorMessage,
  selectedBotFilterId,
  selectedBotFilterLabel,
  selectedBotId,
  selectedConnectionId,
  showFullAccessConnectionsOnly,
  workspaceById,
  workspacesQueryError,
  workspacesQueryIsLoading,
  outboundStatsByBotId,
}: BotsPageDirectorySectionProps) {
  const isEndpointsMode = mode === 'endpoints'
  const sectionTitle = formatDirectoryTitle(mode)
  const sectionDescription = formatDirectoryDescription(mode, selectedBotFilterLabel, selectedBotFilterId)
  const directoryFilterLabel = formatDirectoryFilterLabel(mode)
  const directoryFilterDescription = formatDirectoryFilterDescription(mode)
  const searchLabel = formatSearchLabel(mode)
  const searchPlaceholder = formatSearchPlaceholder(mode)

  return (
    <>
      {workspacesQueryError ? (
        <InlineNotice
          dismissible
          noticeKey={`bot-workspaces-${getErrorMessage(workspacesQueryError)}`}
          onRetry={onRetryWorkspaces}
          title={i18n._({ id: 'Failed To Load Workspaces', message: 'Failed To Load Workspaces' })}
          tone="error"
        >
          {getErrorMessage(workspacesQueryError)}
        </InlineNotice>
      ) : null}

      {!workspacesQueryIsLoading && !hasWorkspaces ? (
        <div className="empty-state">
          {i18n._({
            id: 'Create a workspace first before configuring a bot connection.',
            message: 'Create a workspace first before configuring a bot connection.',
          })}
        </div>
      ) : null}

      {hasWorkspaces ? (
        <>
          {connectionsQueryError ? (
            <InlineNotice
              dismissible
              noticeKey={`bot-connections-${getErrorMessage(connectionsQueryError)}`}
              onRetry={onRetryConnections}
              title={i18n._({
                id: 'Failed To Load Bot Connections',
                message: 'Failed To Load Bot Connections',
              })}
              tone="error"
            >
              {getErrorMessage(connectionsQueryError)}
            </InlineNotice>
          ) : null}

          {botsQueryError ? (
            <InlineNotice
              dismissible
              noticeKey={`bots-${getErrorMessage(botsQueryError)}`}
              onRetry={onRetryBots}
              title={i18n._({ id: 'Failed To Load Bots', message: 'Failed To Load Bots' })}
              tone="error"
            >
              {getErrorMessage(botsQueryError)}
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

          <section className="content-section">
            <div className="section-header section-header--inline">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h2>{sectionTitle}</h2>
                <HelpTooltip content={sectionDescription} />
              </div>
              <div className="section-header__meta">{isEndpointsMode ? filteredConnections.length : filteredBots.length}</div>
            </div>

            <Input
              label={searchLabel}
              onChange={(event) => onChangeConnectionSearch(event.target.value)}
              placeholder={searchPlaceholder}
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
              onChange={(event) => onToggleShowFullAccessConnectionsOnly(event.target.checked)}
            />

            {botsQueryIsLoading || connectionsQueryIsLoading ? (
              <div className="notice">
                {i18n._({ id: 'Loading bots...', message: 'Loading bots...' })}
              </div>
            ) : null}

            {!botsQueryIsLoading && !connectionsQueryIsLoading && !bots.length && !connections.length ? (
              <div className="empty-state">{formatEmptyStateMessage(mode)}</div>
            ) : null}

            {!botsQueryIsLoading &&
            !connectionsQueryIsLoading &&
            (isEndpointsMode ? connections.length > 0 && !filteredConnections.length : bots.length > 0 && !filteredBots.length) ? (
              <div className="empty-state">
                {formatFilteredEmptyStateMessage(
                  mode,
                  showFullAccessConnectionsOnly,
                  selectedBotFilterLabel,
                  selectedBotFilterId,
                )}
              </div>
            ) : null}

            {isEndpointsMode ? (
              filteredConnections.length ? (
                <BotsPageEndpointDirectoryTable
                  botById={botById}
                  connections={filteredConnections}
                  onEditConnection={onEditConnection}
                  onOpenConnectionDetail={onOpenConnectionDetail}
                  onOpenConnectionLogs={onOpenConnectionLogs}
                  onOpenConnectionOverview={onOpenConnectionOverview}
                  onSelectConnection={onSelectConnection}
                  selectedConnectionId={selectedConnectionId}
                  workspaceById={workspaceById}
                />
              ) : null
            ) : filteredBots.length ? (
              <BotsPageBotDirectoryTable
                bots={filteredBots}
                connectionsByBotId={connectionsByBotId}
                mode={mode}
                outboundStatsByBotId={outboundStatsByBotId}
                onOpenBotEdit={onOpenBotEdit}
                onOpenBotEndpoints={onOpenBotEndpoints}
                onOpenBotInfo={onOpenBotInfo}
                onOpenBotOutbound={onOpenBotOutbound}
                onSelectBot={onSelectBot}
                selectedBotId={selectedBotId}
                workspaceById={workspaceById}
              />
            ) : null}
          </section>
        </>
      ) : null}
    </>
  )
}
