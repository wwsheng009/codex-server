import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { StatusPill } from '../components/ui/StatusPill'
import { AutomationRunLog } from '../features/automations/AutomationRunLog'
import { getBotConnection, listBotConnectionLogs } from '../features/bots/api'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import { formatBotBackendLabel, formatBotProviderLabel, formatBotTimestamp } from './botsPageUtils'

export function BotConnectionLogsPage() {
  const navigate = useNavigate()
  const { workspaceId = '', connectionId = '' } = useParams()

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1)
      return
    }
    navigate('/bots')
  }

  const connectionQuery = useQuery({
    queryKey: ['bot-connection', workspaceId, connectionId],
    queryFn: () => getBotConnection(workspaceId, connectionId),
    enabled: workspaceId.length > 0 && connectionId.length > 0,
    refetchInterval: 5000,
  })

  const logsQuery = useQuery({
    queryKey: ['bot-connection-logs', workspaceId, connectionId],
    queryFn: () => listBotConnectionLogs(workspaceId, connectionId),
    enabled: workspaceId.length > 0 && connectionId.length > 0,
    refetchInterval: 5000,
  })

  if (!workspaceId || !connectionId) {
    return (
      <section className="screen screen--centered">
        <div className="notice">
          {i18n._({ id: 'Bot connection log target is missing.', message: 'Bot connection log target is missing.' })}
        </div>
      </section>
    )
  }

  if (connectionQuery.isLoading && !connectionQuery.data) {
    return (
      <section className="screen screen--centered">
        <div className="notice">{i18n._({ id: 'Loading bot logs…', message: 'Loading bot logs…' })}</div>
      </section>
    )
  }

  if (connectionQuery.error || !connectionQuery.data) {
    return (
      <section className="screen">
        <InlineNotice
          dismissible
          noticeKey={`bot-connection-logs-load-${workspaceId}-${connectionId}-${getErrorMessage(connectionQuery.error)}`}
          title={i18n._({ id: 'Bot Logs Loading Failed', message: 'Bot Logs Loading Failed' })}
          tone="error"
        >
          {getErrorMessage(connectionQuery.error)}
        </InlineNotice>
        <div className="header-actions">
          <Button intent="secondary" onClick={handleBack}>
            {i18n._({ id: 'Back to Bots', message: 'Back to Bots' })}
          </Button>
        </div>
      </section>
    )
  }

  const connection = connectionQuery.data
  const logCount = logsQuery.data?.length ?? 0

  return (
    <section className="screen">
      <PageHeader
        actions={
          <div className="header-actions">
            <Button intent="secondary" onClick={handleBack}>
              {i18n._({ id: 'Back to Bots', message: 'Back to Bots' })}
            </Button>
          </div>
        }
        description={i18n._({
          id: 'Polling runtime history for this bot connection, including worker start/stop, successful polls, and failures.',
          message:
            'Polling runtime history for this bot connection, including worker start/stop, successful polls, and failures.',
        })}
        eyebrow={i18n._({ id: 'Bot Logs', message: 'Bot Logs' })}
        meta={
          <>
            <StatusPill status={connection.status} />
            <span className="meta-pill">{formatBotProviderLabel(connection.provider)}</span>
            <span className="meta-pill">{formatBotBackendLabel(connection.aiBackend)}</span>
            <span className="meta-pill">
              {i18n._({
                id: 'Workspace: {workspaceId}',
                message: 'Workspace: {workspaceId}',
                values: { workspaceId: connection.workspaceId },
              })}
            </span>
          </>
        }
        title={i18n._({
          id: '{name} Runtime Logs',
          message: '{name} Runtime Logs',
          values: { name: connection.name },
        })}
      />

      {connection.lastError ? (
        <InlineNotice
          dismissible
          noticeKey={`bot-runtime-last-error-${connection.id}-${connection.lastError}`}
          title={i18n._({ id: 'Last Bot Error', message: 'Last Bot Error' })}
          tone="error"
        >
          {connection.lastError}
        </InlineNotice>
      ) : null}

      <section className="mode-panel">
        <div className="section-header">
          <div>
            <h2>{i18n._({ id: 'Polling Health', message: 'Polling Health' })}</h2>
            <p>
              {i18n._({
                id: 'Current connection state plus the latest successful or failed poll result recorded by the backend.',
                message:
                  'Current connection state plus the latest successful or failed poll result recorded by the backend.',
              })}
            </p>
          </div>
        </div>
        <div className="detail-list">
          <div className="detail-row">
            <span>{i18n._({ id: 'Connection ID', message: 'Connection ID' })}</span>
            <strong>{connection.id}</strong>
          </div>
          <div className="detail-row">
            <span>{i18n._({ id: 'Connection Status', message: 'Connection Status' })}</span>
            <strong>{connection.status}</strong>
          </div>
          <div className="detail-row">
            <span>{i18n._({ id: 'Last Poll Status', message: 'Last Poll Status' })}</span>
            <strong>{connection.lastPollStatus ? <StatusPill status={connection.lastPollStatus} /> : '-'}</strong>
          </div>
          <div className="detail-row">
            <span>{i18n._({ id: 'Last Poll Time', message: 'Last Poll Time' })}</span>
            <strong>{formatBotTimestamp(connection.lastPollAt ?? undefined)}</strong>
          </div>
          <div className="detail-row">
            <span>{i18n._({ id: 'Last Poll Message', message: 'Last Poll Message' })}</span>
            <strong>{connection.lastPollMessage?.trim() || '-'}</strong>
          </div>
        </div>
      </section>

      <section className="mode-panel">
        <div className="section-header">
          <div>
            <h2>{i18n._({ id: 'Runtime Log Stream', message: 'Runtime Log Stream' })}</h2>
            <p>
              {i18n._({
                id: 'Newest entries first. This stream is specific to the selected bot connection.',
                message: 'Newest entries first. This stream is specific to the selected bot connection.',
              })}
            </p>
          </div>
          <div className="section-header__meta">{logCount}</div>
        </div>

        {logsQuery.error ? (
          <InlineNotice
            dismissible
            noticeKey={`bot-log-stream-${connection.id}-${getErrorMessage(logsQuery.error)}`}
            title={i18n._({ id: 'Bot Log Stream Loading Failed', message: 'Bot Log Stream Loading Failed' })}
            tone="error"
          >
            {getErrorMessage(logsQuery.error)}
          </InlineNotice>
        ) : logsQuery.isLoading && !logsQuery.data ? (
          <div className="notice">{i18n._({ id: 'Loading runtime logs…', message: 'Loading runtime logs…' })}</div>
        ) : (
          <AutomationRunLog logs={logsQuery.data ?? []} />
        )}
      </section>
    </section>
  )
}
