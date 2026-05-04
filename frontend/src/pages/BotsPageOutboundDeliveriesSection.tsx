import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { LoadingState } from '../components/ui/LoadingState'
import { StatusPill } from '../components/ui/StatusPill'
import { Tooltip } from '../components/ui/Tooltip'
import { humanizeDisplayValue } from '../i18n/display'
import { i18n } from '../i18n/runtime'
import { buildWorkspaceThreadRoute } from '../lib/thread-routes'
import {
  formatBotDeliveryRouteLabel,
  formatBotDeliveryTargetLabel,
  formatBotTimestamp,
  summarizeBotConversationDeliveryError,
  summarizeBotReplyMessages,
} from './botsPageUtils'
import type { BotDeliveryTarget, BotOutboundDelivery } from '../types/api'
import type { ReactNode } from 'react'

const OUTBOUND_DELIVERIES_PAGE_SIZE = 10

type BotsPageOutboundDeliveriesSectionProps = {
  botOutboundDeliveriesErrorMessage: string
  deliveryTargetById: Map<string, BotDeliveryTarget>
  deliveries: BotOutboundDelivery[]
  isLoading: boolean
  onRetry: () => void
  selectedConnectionDeliveryTargetsCount: number
  selectedConnectionDeliveredOutboundCount: number
  selectedConnectionFailedOutboundCount: number
  selectedConnectionId: string
  selectedConnectionManualOutboundCount: number
  selectedConnectionPendingOutboundCount: number
}

function HelpTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

function formatOutboundDeliverySourceLabel(delivery: BotOutboundDelivery) {
  const sourceType = delivery.sourceType?.trim()
  if (sourceType) {
    return humanizeDisplayValue(sourceType, sourceType)
  }
  return i18n._({ id: 'manual', message: 'manual' })
}

function formatOutboundDeliveryReferenceLabel(delivery: BotOutboundDelivery) {
  const refType = delivery.sourceRefType?.trim() ?? ''
  const refId = delivery.sourceRefId?.trim() ?? ''
  if (refType || refId) {
    return [refType, refId].filter(Boolean).join(' · ')
  }

  if (delivery.runId?.trim()) {
    return i18n._({
      id: 'Run: {id}',
      message: 'Run: {id}',
      values: { id: delivery.runId.trim() },
    })
  }

  if (delivery.triggerId?.trim()) {
    return i18n._({
      id: 'Trigger: {id}',
      message: 'Trigger: {id}',
      values: { id: delivery.triggerId.trim() },
    })
  }

  return ''
}

export function BotsPageOutboundDeliveriesSection({
  botOutboundDeliveriesErrorMessage,
  deliveryTargetById,
  deliveries,
  isLoading,
  onRetry,
  selectedConnectionDeliveryTargetsCount,
  selectedConnectionDeliveredOutboundCount,
  selectedConnectionFailedOutboundCount,
  selectedConnectionId,
  selectedConnectionManualOutboundCount,
  selectedConnectionPendingOutboundCount,
}: BotsPageOutboundDeliveriesSectionProps) {
  const [page, setPage] = useState(1)

  const pageCount = Math.max(1, Math.ceil(deliveries.length / OUTBOUND_DELIVERIES_PAGE_SIZE))

  useEffect(() => {
    setPage(1)
  }, [selectedConnectionId])

  useEffect(() => {
    setPage((current) => Math.min(current, pageCount))
  }, [pageCount])

  const currentPage = Math.min(page, pageCount)
  const visibleDeliveries = useMemo(
    () =>
      deliveries.slice(
        (currentPage - 1) * OUTBOUND_DELIVERIES_PAGE_SIZE,
        currentPage * OUTBOUND_DELIVERIES_PAGE_SIZE,
      ),
    [currentPage, deliveries],
  )
  const showPagination = deliveries.length > OUTBOUND_DELIVERIES_PAGE_SIZE

  return (
    <section className="mode-panel mode-panel--flush">
      <div className="mode-panel__body">
        <div className="section-header section-header--inline">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2>{i18n._({ id: 'Outbound Deliveries', message: 'Outbound Deliveries' })}</h2>
            <HelpTooltip
              content={i18n._({
                id: 'This table records proactive sends created by manual actions, notifications, or future automation runs. Use pagination to move through older deliveries without losing the latest results.',
                message:
                  'This table records proactive sends created by manual actions, notifications, or future automation runs. Use pagination to move through older deliveries without losing the latest results.',
              })}
            />
          </div>
          <div style={{ alignItems: 'center', display: 'flex', gap: '12px' }}>
            <div className="section-header__meta">{deliveries.length}</div>
          </div>
        </div>

        {deliveries.length ? (
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

      {botOutboundDeliveriesErrorMessage ? (
        <InlineNotice
          dismissible
          noticeKey={`bot-outbound-deliveries-${botOutboundDeliveriesErrorMessage}`}
          onRetry={onRetry}
          title={i18n._({
            id: 'Failed To Load Outbound Deliveries',
            message: 'Failed To Load Outbound Deliveries',
          })}
          tone="error"
        >
          {botOutboundDeliveriesErrorMessage}
        </InlineNotice>
      ) : null}

      {isLoading && !deliveries.length ? (
        <LoadingState
          fill={false}
          message={i18n._({
            id: 'Loading outbound deliveries...',
            message: 'Loading outbound deliveries...',
          })}
        />
      ) : null}

      {!isLoading && !deliveries.length ? (
        <div className="empty-state">
          {selectedConnectionDeliveryTargetsCount === 0
            ? i18n._({
                id: 'Create a recipient first, then send outbound deliveries to it.',
                message: 'Create a recipient first, then send outbound deliveries to it.',
              })
            : i18n._({
                id: 'No proactive outbound deliveries have been recorded for this endpoint yet.',
                message: 'No proactive outbound deliveries have been recorded for this endpoint yet.',
              })}
        </div>
      ) : null}

      {visibleDeliveries.length ? (
        <>
          <div className="bots-page-table-wrap">
            <table className="bots-page-table">
              <thead>
                <tr>
                  <th>{i18n._({ id: 'Delivery', message: 'Delivery' })}</th>
                  <th>{i18n._({ id: 'Payload', message: 'Payload' })}</th>
                  <th>{i18n._({ id: 'Target', message: 'Target' })}</th>
                  <th>{i18n._({ id: 'Source', message: 'Source' })}</th>
                  <th>{i18n._({ id: 'Status', message: 'Status' })}</th>
                  <th>{i18n._({ id: 'Error', message: 'Error' })}</th>
                  <th>{i18n._({ id: 'Actions', message: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody>
                {visibleDeliveries.map((delivery) => {
                  const deliveryTarget = delivery.deliveryTargetId
                    ? deliveryTargetById.get(delivery.deliveryTargetId) ?? null
                    : null
                  const payloadSummary =
                    summarizeBotReplyMessages(delivery.messages) ||
                    i18n._({ id: 'No outbound payload recorded.', message: 'No outbound payload recorded.' })
                  const referenceLabel = formatOutboundDeliveryReferenceLabel(delivery)
                  const sourceLabel = formatOutboundDeliverySourceLabel(delivery)
                  const errorLabel = delivery.lastError ? summarizeBotConversationDeliveryError(delivery.lastError) : ''

                  return (
                    <tr key={delivery.id}>
                      <td>
                        <div className="bots-page-table__cell-stack">
                          <strong>{formatBotTimestamp(delivery.createdAt)}</strong>
                          {delivery.deliveredAt ? (
                            <span>
                              {i18n._({ id: 'Delivered', message: 'Delivered' })}: {formatBotTimestamp(delivery.deliveredAt)}
                            </span>
                          ) : (
                            <span>{i18n._({ id: 'Pending', message: 'Pending' })}</span>
                          )}
                          {typeof delivery.attemptCount === 'number' ? (
                            <span className="meta-pill">
                              {i18n._({
                                id: 'Attempt {count}',
                                message: 'Attempt {count}',
                                values: { count: delivery.attemptCount },
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="bots-page-table__cell-stack">
                          <strong>{payloadSummary}</strong>
                          {delivery.messages?.length ? (
                            <span>
                              {i18n._({
                                id: '{count} message(s)',
                                message: '{count} message(s)',
                                values: { count: delivery.messages.length },
                              })}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <div className="bots-page-table__cell-stack">
                          <strong>{deliveryTarget ? formatBotDeliveryTargetLabel(deliveryTarget) : delivery.deliveryTargetId ?? '-'}</strong>
                          {deliveryTarget ? <span>{formatBotDeliveryRouteLabel(deliveryTarget.routeType)}</span> : null}
                          {deliveryTarget?.routeKey?.trim() ? <span>{deliveryTarget.routeKey.trim()}</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className="bots-page-table__cell-stack">
                          <strong>{sourceLabel}</strong>
                          {referenceLabel ? <span>{referenceLabel}</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className="bots-page-table__cell-stack">
                          <StatusPill status={delivery.status} />
                          {delivery.updatedAt ? <span>{formatBotTimestamp(delivery.updatedAt)}</span> : null}
                        </div>
                      </td>
                      <td>
                        <div className="bots-page-table__cell-stack">
                          {errorLabel ? <span>{errorLabel}</span> : <span>{i18n._({ id: 'None', message: 'None' })}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="bots-page-table__actions">
                          {delivery.originWorkspaceId && delivery.originThreadId ? (
                            <Link to={buildWorkspaceThreadRoute(delivery.originWorkspaceId, delivery.originThreadId)}>
                              {i18n._({ id: 'Open Origin Thread', message: 'Open Origin Thread' })}
                            </Link>
                          ) : (
                            <span>{i18n._({ id: 'No thread', message: 'No thread' })}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {showPagination ? (
            <div className="feishu-tool-selector-pagination">
              <span className="feishu-tool-selector-pagination__info">
                {i18n._({
                  id: '{start}–{end} of {total}',
                  message: '{start}–{end} of {total}',
                  values: {
                    start: (currentPage - 1) * OUTBOUND_DELIVERIES_PAGE_SIZE + 1,
                    end: Math.min(currentPage * OUTBOUND_DELIVERIES_PAGE_SIZE, deliveries.length),
                    total: deliveries.length,
                  },
                })}
              </span>
              <div className="feishu-tool-selector-pagination__actions">
                <Button intent="ghost" disabled={currentPage <= 1} onClick={() => setPage((current) => current - 1)} type="button">
                  {i18n._({ id: 'Previous', message: 'Previous' })}
                </Button>
                <Button
                  intent="ghost"
                  disabled={currentPage * OUTBOUND_DELIVERIES_PAGE_SIZE >= deliveries.length}
                  onClick={() => setPage((current) => current + 1)}
                  type="button"
                >
                  {i18n._({ id: 'Next', message: 'Next' })}
                </Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
