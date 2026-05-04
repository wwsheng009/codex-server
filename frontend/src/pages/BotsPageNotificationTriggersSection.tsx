import { Button } from '../components/ui/Button'
import { InlineNotice } from '../components/ui/InlineNotice'
import { LoadingState } from '../components/ui/LoadingState'
import { SelectControl } from '../components/ui/SelectControl'
import { StatusPill } from '../components/ui/StatusPill'
import { Switch } from '../components/ui/Switch'
import { Tooltip } from '../components/ui/Tooltip'
import { i18n } from '../i18n/runtime'
import { humanizeDisplayValue } from '../i18n/display'
import {
  formatBotDeliveryRouteLabel,
  formatBotDeliveryTargetLabel,
  formatBotTimestamp,
  formatBotTriggerFilterSummary,
} from './botsPageUtils'
import type { BotDeliveryTarget, BotTrigger } from '../types/api'
import type { SelectOption } from '../components/ui/selectControlTypes'
import type { ReactNode } from 'react'

type BotsPageNotificationTriggersSectionProps = {
  botTriggersErrorMessage: string
  createBotTriggerErrorMessage: string
  deleteBotTriggerErrorMessage: string
  deliveryTargetById: Map<string, BotDeliveryTarget>
  isCreatePending: boolean
  isDeletePending: boolean
  isLoading: boolean
  isUpdatePending: boolean
  notificationTriggerEnabled: boolean
  notificationTriggerKind: string
  notificationTriggerKindOptions: SelectOption[]
  notificationTriggerLevel: string
  notificationTriggerLevelOptions: SelectOption[]
  notificationTriggerTargetId: string
  notificationTriggerTargetOptions: SelectOption[]
  onChangeEnabled: (checked: boolean) => void
  onChangeKind: (value: string) => void
  onChangeLevel: (value: string) => void
  onChangeTargetId: (value: string) => void
  onCreateTrigger: () => void
  onDeleteTrigger: (trigger: BotTrigger) => void
  onManageRecipients: () => void
  onOpenNotificationCenter: () => void
  onRetry: () => void
  onToggleTrigger: (trigger: BotTrigger) => void
  updateBotTriggerErrorMessage: string
  selectedConnectionDeliveryTargetsCount: number
  selectedConnectionEnabledTriggerCount: number
  selectedConnectionTriggers: BotTrigger[]
}

function HelpTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

export function BotsPageNotificationTriggersSection({
  botTriggersErrorMessage,
  createBotTriggerErrorMessage,
  deleteBotTriggerErrorMessage,
  deliveryTargetById,
  isCreatePending,
  isDeletePending,
  isLoading,
  isUpdatePending,
  notificationTriggerEnabled,
  notificationTriggerKind,
  notificationTriggerKindOptions,
  notificationTriggerLevel,
  notificationTriggerLevelOptions,
  notificationTriggerTargetId,
  notificationTriggerTargetOptions,
  onChangeEnabled,
  onChangeKind,
  onChangeLevel,
  onChangeTargetId,
  onCreateTrigger,
  onDeleteTrigger,
  onManageRecipients,
  onOpenNotificationCenter,
  onRetry,
  onToggleTrigger,
  updateBotTriggerErrorMessage,
  selectedConnectionDeliveryTargetsCount,
  selectedConnectionEnabledTriggerCount,
  selectedConnectionTriggers,
}: BotsPageNotificationTriggersSectionProps) {
  const effectiveTargetOptions = notificationTriggerTargetOptions.length
    ? notificationTriggerTargetOptions
    : [
        {
          value: '',
          label: i18n._({ id: 'No recipients available', message: 'No recipients available' }),
          disabled: true,
        },
      ]

  return (
    <details className="bots-page-secondary-details">
      <summary className="bots-page-secondary-details__summary">
        <div className="bots-page-secondary-details__summary-copy">
          <span>{i18n._({ id: 'Notification Triggers', message: 'Notification Triggers' })}</span>
        </div>
        <div className="section-header__meta">{selectedConnectionTriggers.length}</div>
      </summary>
      <section className="mode-panel mode-panel--flush">
        <div className="mode-panel__body">
          <div className="section-header section-header--inline">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2>{i18n._({ id: 'Notification Triggers', message: 'Notification Triggers' })}</h2>
              <HelpTooltip
                content={i18n._({
                  id: 'This panel is a compatibility view over Notification Center rules for the legacy system.notification.created topic.',
                  message:
                    'This panel is a compatibility view over Notification Center rules for the legacy system.notification.created topic.',
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
              <Button intent="secondary" onClick={onManageRecipients} size="sm" type="button">
                {i18n._({ id: 'Manage Recipients', message: 'Manage Recipients' })}
              </Button>
            </div>
          </div>

          <InlineNotice
            dismissible={false}
            noticeKey="bot-trigger-compat-view"
            title={i18n._({
              id: 'Notification Center manages these trigger rules',
              message: 'Notification Center manages these trigger rules',
            })}
          >
            <span>
              {i18n._({
                id: 'Use this panel for the legacy notification topic only. New hook, automation, bot failure, and email routing should be configured in Notification Center.',
                message:
                  'Use this panel for the legacy notification topic only. New hook, automation, bot failure, and email routing should be configured in Notification Center.',
              })}
            </span>{' '}
            <Button intent="secondary" onClick={onOpenNotificationCenter} size="sm" type="button">
              {i18n._({
                id: 'Open Notification Center',
                message: 'Open Notification Center',
              })}
            </Button>
          </InlineNotice>

          <div className="form-row">
            <label className="field">
              <span>{i18n._({ id: 'Recipient', message: 'Recipient' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Notification Trigger Recipient', message: 'Notification Trigger Recipient' })}
                fullWidth
                onChange={onChangeTargetId}
                options={effectiveTargetOptions}
                value={notificationTriggerTargetId}
              />
            </label>
            <label className="field">
              <span>{i18n._({ id: 'Kind Filter', message: 'Kind Filter' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Notification Trigger Kind Filter', message: 'Notification Trigger Kind Filter' })}
                fullWidth
                onChange={onChangeKind}
                options={notificationTriggerKindOptions}
                value={notificationTriggerKind}
              />
            </label>
            <label className="field">
              <span>{i18n._({ id: 'Level Filter', message: 'Level Filter' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Notification Trigger Level Filter', message: 'Notification Trigger Level Filter' })}
                fullWidth
                onChange={onChangeLevel}
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
              onChange={(event) => onChangeEnabled(event.target.checked)}
            />
            <Button
              disabled={!notificationTriggerTargetId.trim() || isCreatePending}
              isLoading={isCreatePending}
              onClick={onCreateTrigger}
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
            onRetry={onRetry}
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

        {isLoading && !selectedConnectionTriggers.length ? (
          <LoadingState
            fill={false}
            message={i18n._({
              id: 'Loading notification triggers...',
              message: 'Loading notification triggers...',
            })}
          />
        ) : null}

        {!isLoading && !selectedConnectionTriggers.length && selectedConnectionDeliveryTargetsCount === 0 ? (
          <div className="empty-state">
            {i18n._({
              id: 'Create a recipient first, then attach notification triggers to it.',
              message: 'Create a recipient first, then attach notification triggers to it.',
            })}
          </div>
        ) : null}

        {!isLoading && !selectedConnectionTriggers.length && selectedConnectionDeliveryTargetsCount > 0 ? (
          <div className="empty-state">
            {i18n._({
              id: 'No notification triggers are configured for this endpoint yet.',
              message: 'No notification triggers are configured for this endpoint yet.',
            })}
          </div>
        ) : null}

        <div className="directory-list">
          {selectedConnectionTriggers.map((trigger) => {
            const target = deliveryTargetById.get(trigger.deliveryTargetId) ?? null
            return (
              <article className="directory-item" key={trigger.id}>
                <div className="directory-item__icon">{i18n._({ id: 'NT', message: 'NT' })}</div>
                <div className="directory-item__body">
                  <strong>{target ? formatBotDeliveryTargetLabel(target) : trigger.deliveryTargetId}</strong>
                  <p>
                    {i18n._({ id: 'Type', message: 'Type' })}: {humanizeDisplayValue(trigger.type, trigger.type)}
                  </p>
                  <p>
                    {i18n._({ id: 'Filters', message: 'Filters' })}: {formatBotTriggerFilterSummary(trigger)}
                  </p>
                  {target ? (
                    <p>
                      {i18n._({ id: 'Route', message: 'Route' })}: {formatBotDeliveryRouteLabel(target.routeType)} |{' '}
                      {target.routeKey?.trim() || target.id}
                    </p>
                  ) : null}
                </div>
                <div className="directory-item__meta" style={{ alignItems: 'end', display: 'grid', gap: '8px' }}>
                  <span className="meta-pill">{formatBotTimestamp(trigger.updatedAt)}</span>
                  <StatusPill status={trigger.enabled ? 'active' : 'paused'} />
                  <Button
                    disabled={isUpdatePending}
                    intent="secondary"
                    onClick={() => onToggleTrigger(trigger)}
                    size="sm"
                    type="button"
                  >
                    {trigger.enabled ? i18n._({ id: 'Pause', message: 'Pause' }) : i18n._({ id: 'Enable', message: 'Enable' })}
                  </Button>
                  <Button
                    className="ide-button--ghost-danger"
                    disabled={isDeletePending}
                    intent="ghost"
                    onClick={() => onDeleteTrigger(trigger)}
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
    </details>
  )
}
