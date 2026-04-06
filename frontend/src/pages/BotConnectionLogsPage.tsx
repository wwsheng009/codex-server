import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'

import { PageHeader } from '../components/ui/PageHeader'
import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { BotConnectionLogStream } from '../features/bots/BotConnectionLogStream'
import { getBotConnection, listBotConnectionLogs } from '../features/bots/api'
import {
  filterBotConnectionLogs,
  summarizeBotConnectionLogs,
  type BotConnectionLogFilter,
} from '../features/bots/logStreamUtils'
import { i18n } from '../i18n/runtime'
import { getErrorMessage } from '../lib/error-utils'
import {
  formatBotBackendLabel,
  formatBotCommandOutputModeLabel,
  formatBotProviderLabel,
  formatBotTimestamp,
  resolveBotCommandOutputMode,
} from './botsPageUtils'

export function BotConnectionLogsPage() {
  const navigate = useNavigate()
  const { workspaceId = '', connectionId = '' } = useParams()
  const [logFilter, setLogFilter] = useState<BotConnectionLogFilter>('all')

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

  const logs = logsQuery.data ?? []
  const logSummary = useMemo(() => summarizeBotConnectionLogs(logs), [logs])
  const filteredLogs = useMemo(() => filterBotConnectionLogs(logs, logFilter), [logs, logFilter])
  const visibleLogCount = filteredLogs.length
  const logCountLabel =
    logFilter === 'all'
      ? String(logSummary.totalCount)
      : i18n._({
          id: '{visibleLogCount} / {totalLogCount}',
          message: '{visibleLogCount} / {totalLogCount}',
          values: {
            visibleLogCount,
            totalLogCount: logSummary.totalCount,
          },
        })
  const logFilterOptions = useMemo(
    () => [
      {
        value: 'all',
        label: i18n._({
          id: 'All Entries ({count})',
          message: 'All Entries ({count})',
          values: { count: logSummary.totalCount },
        }),
      },
      {
        value: 'suppressed',
        label: i18n._({
          id: 'Suppressed Replays ({count})',
          message: 'Suppressed Replays ({count})',
          values: { count: logSummary.suppressedCount },
        }),
      },
      {
        value: 'attention',
        label: i18n._({
          id: 'Warnings And Errors ({count})',
          message: 'Warnings And Errors ({count})',
          values: { count: logSummary.attentionCount },
        }),
      },
    ],
    [logSummary.attentionCount, logSummary.suppressedCount, logSummary.totalCount],
  )

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
          id: 'Runtime history for this bot connection, including polling activity, provider failures, and suppressed replay attempts.',
          message:
            'Runtime history for this bot connection, including polling activity, provider failures, and suppressed replay attempts.',
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
            <span>{i18n._({ id: 'Command Output In Replies', message: 'Command Output In Replies' })}</span>
            <strong>
              {formatBotCommandOutputModeLabel(resolveBotCommandOutputMode(connection.settings?.command_output_mode))}
            </strong>
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
                id: 'Newest entries first. Filter to isolate suppressed duplicate deliveries, restart replays, and other warning paths.',
                message:
                  'Newest entries first. Filter to isolate suppressed duplicate deliveries, restart replays, and other warning paths.',
              })}
            </p>
          </div>
          <div className="section-header__meta">{logCountLabel}</div>
        </div>

        <div className="bot-connection-log-toolbar">
          <label className="field">
            <span>{i18n._({ id: 'Log Filter', message: 'Log Filter' })}</span>
            <SelectControl
              ariaLabel={i18n._({ id: 'Filter runtime logs', message: 'Filter runtime logs' })}
              fullWidth
              onChange={(nextValue) => setLogFilter(nextValue as BotConnectionLogFilter)}
              options={logFilterOptions}
              value={logFilter}
            />
          </label>

          {logSummary.suppressedCount > 0 ? (
            <div className="bot-connection-log-toolbar__summary">
              <span className="meta-pill meta-pill--warning">
                {i18n._({
                  id: 'Suppressed replays: {count}',
                  message: 'Suppressed replays: {count}',
                  values: { count: logSummary.suppressedCount },
                })}
              </span>
              {logSummary.duplicateSuppressedCount > 0 ? (
                <span className="meta-pill meta-pill--warning">
                  {i18n._({
                    id: 'Duplicate deliveries: {count}',
                    message: 'Duplicate deliveries: {count}',
                    values: { count: logSummary.duplicateSuppressedCount },
                  })}
                </span>
              ) : null}
              {logSummary.recoverySuppressedCount > 0 ? (
                <span className="meta-pill meta-pill--warning">
                  {i18n._({
                    id: 'Restart recoveries: {count}',
                    message: 'Restart recoveries: {count}',
                    values: { count: logSummary.recoverySuppressedCount },
                  })}
                </span>
              ) : null}
            </div>
          ) : null}
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
        ) : !filteredLogs.length && logs.length > 0 ? (
          <div className="notice">
            {i18n._({
              id: 'No runtime logs matched the current filter.',
              message: 'No runtime logs matched the current filter.',
            })}
          </div>
        ) : (
          <BotConnectionLogStream logs={filteredLogs} />
        )}
      </section>
    </section>
  )
}
