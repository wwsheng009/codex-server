import { Button } from '../components/ui/Button'
import { i18n } from '../i18n/runtime'

type BotsPageHeaderProps = {
  botsCount: number
  connectionsCount: number
  currentMetricLabel: string
  currentMetricValue: number
  isConfigMode: boolean
  isOutboundMode: boolean
  canOpenCreateConnection: boolean
  onOpenCreateBot: () => void
  onOpenCreateConnection: () => void
  onSwitchToConfig: () => void
  onSwitchToOutbound: () => void
  pageDescription: string
  pageEyebrow: string
  pageTitle: string
}

export function BotsPageHeader({
  botsCount,
  connectionsCount,
  currentMetricLabel,
  currentMetricValue,
  canOpenCreateConnection,
  isConfigMode,
  isOutboundMode,
  onOpenCreateBot,
  onOpenCreateConnection,
  onSwitchToConfig,
  onSwitchToOutbound,
  pageDescription,
  pageEyebrow,
  pageTitle,
}: BotsPageHeaderProps) {
  return (
    <header className="mode-strip">
      <div className="mode-strip__copy">
        <div className="mode-strip__eyebrow">{pageEyebrow}</div>
        <div className="mode-strip__title-row">
          <strong>{pageTitle}</strong>
        </div>
        <div className="mode-strip__description">{pageDescription}</div>
        <div className="segmented-control" style={{ marginTop: '14px', width: 'fit-content' }}>
          <Button
            aria-pressed={isConfigMode}
            className={isConfigMode ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
            intent={isConfigMode ? 'secondary' : 'ghost'}
            onClick={onSwitchToConfig}
            type="button"
          >
            {i18n._({ id: 'Configuration', message: 'Configuration' })}
          </Button>
          <Button
            aria-pressed={isOutboundMode}
            className={isOutboundMode ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
            intent={isOutboundMode ? 'secondary' : 'ghost'}
            onClick={onSwitchToOutbound}
            type="button"
          >
            {i18n._({ id: 'Outbound', message: 'Outbound' })}
          </Button>
        </div>
      </div>
      <div className="mode-strip__actions">
        <div className="mode-metrics">
          <div className="mode-metric">
            <span>{i18n._({ id: 'Bots', message: 'Bots' })}</span>
            <strong>{botsCount}</strong>
          </div>
          <div className="mode-metric">
            <span>{i18n._({ id: 'Endpoints', message: 'Endpoints' })}</span>
            <strong>{connectionsCount}</strong>
          </div>
          <div className="mode-metric">
            <span>{currentMetricLabel}</span>
            <strong>{currentMetricValue}</strong>
          </div>
        </div>
        {isConfigMode ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button intent="secondary" onClick={onOpenCreateBot}>
              {i18n._({ id: 'New Bot', message: 'New Bot' })}
            </Button>
            <Button disabled={!canOpenCreateConnection} onClick={onOpenCreateConnection}>
              {i18n._({ id: 'New Endpoint', message: 'New Endpoint' })}
            </Button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
