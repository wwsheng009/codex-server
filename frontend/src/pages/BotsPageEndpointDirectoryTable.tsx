import { Button } from '../components/ui/Button'
import { StatusPill } from '../components/ui/StatusPill'
import { i18n } from '../i18n/runtime'
import {
  formatBotBackendLabel,
  formatBotProviderLabel,
  formatBotTimestamp,
  formatBotWorkspacePermissionPresetLabel,
  isBotWorkspacePermissionPresetFullAccess,
  summarizeBotConnectionCapabilities,
} from './botsPageUtils'
import type { Bot, BotConnection, Workspace } from '../types/api'

type BotsPageEndpointDirectoryTableProps = {
  connections: BotConnection[]
  botById: Map<string, Bot>
  selectedConnectionId: string
  workspaceById: Map<string, Workspace>
  onEditConnection: (connection: BotConnection) => void
  onOpenConnectionDetail: (connection: BotConnection) => void
  onOpenConnectionOverview: (connection: BotConnection) => void
  onOpenConnectionLogs: (connection: BotConnection) => void
  onSelectConnection: (connection: BotConnection) => void
}

export function BotsPageEndpointDirectoryTable({
  connections,
  botById,
  onEditConnection,
  onOpenConnectionDetail,
  onOpenConnectionLogs,
  onOpenConnectionOverview,
  onSelectConnection,
  selectedConnectionId,
  workspaceById,
}: BotsPageEndpointDirectoryTableProps) {
  return (
    <div className="bots-page-table-wrap">
      <table className="bots-page-table bots-page-table--endpoints">
        <thead>
          <tr>
            <th>{i18n._({ id: 'Workspace', message: 'Workspace' })}</th>
            <th>{i18n._({ id: 'Bot', message: 'Bot' })}</th>
            <th>{i18n._({ id: 'Endpoint', message: 'Endpoint' })}</th>
            <th>{i18n._({ id: 'Provider', message: 'Provider' })}</th>
            <th>{i18n._({ id: 'Backend', message: 'Backend' })}</th>
            <th>{i18n._({ id: 'Status', message: 'Status' })}</th>
            <th>{i18n._({ id: 'Capabilities', message: 'Capabilities' })}</th>
            <th>{i18n._({ id: 'Updated', message: 'Updated' })}</th>
            <th>{i18n._({ id: 'Actions', message: 'Actions' })}</th>
          </tr>
        </thead>
        <tbody>
          {connections.map((connection) => {
            const bot = connection.botId?.trim() ? botById.get(connection.botId.trim()) ?? null : null
            const workspaceName = workspaceById.get(connection.workspaceId)?.name ?? connection.workspaceId
            const botName = bot?.name?.trim() || connection.botId?.trim() || i18n._({ id: 'Unknown bot', message: 'Unknown bot' })
            const isFullAccess =
              connection.aiBackend === 'workspace_thread' &&
              isBotWorkspacePermissionPresetFullAccess(connection.aiConfig?.permission_preset)
            const isSelected = selectedConnectionId === connection.id

            return (
              <tr
                aria-selected={isSelected}
                className={isSelected ? 'bots-page-table__row bots-page-table__row--selected' : 'bots-page-table__row'}
                key={connection.id}
                onClick={() => {
                  onSelectConnection(connection)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelectConnection(connection)
                  }
                }}
                tabIndex={0}
              >
                <td>
                  <div className="bots-page-table__cell-stack">
                    <strong>{workspaceName}</strong>
                    <span>{connection.workspaceId}</span>
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <strong dir="auto">{botName}</strong>
                    {bot?.description?.trim() ? <span>{bot.description.trim()}</span> : null}
                  </div>
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <strong dir="auto">{connection.name}</strong>
                    {connection.lastError ? (
                      <span className="meta-pill meta-pill--warning">
                        {i18n._({ id: 'Last error', message: 'Last error' })}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>{formatBotProviderLabel(connection.provider)}</td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <span>{formatBotBackendLabel(connection.aiBackend)}</span>
                    {isFullAccess ? (
                      <span className="meta-pill meta-pill--danger">
                        {formatBotWorkspacePermissionPresetLabel(connection.aiConfig?.permission_preset)}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td>
                  <StatusPill status={connection.status} />
                </td>
                <td>
                  <div className="bots-page-table__cell-stack">
                    <span>{summarizeBotConnectionCapabilities(connection.capabilities)}</span>
                  </div>
                </td>
                <td>{formatBotTimestamp(connection.updatedAt)}</td>
                <td>
                  <div className="bots-page-table__actions">
                    <Button
                      intent="secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenConnectionDetail(connection)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Detail', message: 'Detail' })}
                    </Button>
                    <Button
                      intent="secondary"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenConnectionOverview(connection)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Overview', message: 'Overview' })}
                    </Button>
                    <Button
                      intent="ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        onOpenConnectionLogs(connection)
                      }}
                      size="sm"
                      type="button"
                    >
                      {i18n._({ id: 'Logs', message: 'Logs' })}
                    </Button>
                    <Button
                      intent="ghost"
                      onClick={(event) => {
                        event.stopPropagation()
                        onEditConnection(connection)
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
