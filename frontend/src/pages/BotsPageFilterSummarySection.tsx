import type { ReactNode } from 'react'

import { Button } from '../components/ui/Button'
import { Tooltip } from '../components/ui/Tooltip'
import { SelectControl } from '../components/ui/SelectControl'
import { i18n } from '../i18n/runtime'
import type { Workspace } from '../types/api'

type BotsPageFilterSummarySectionProps = {
  activeBotsCount: number
  isEndpointsMode: boolean
  onChangeWorkspaceFilterId: (nextValue: string) => void
  onClearSelectedBotFilter: () => void
  selectedBotFilterId: string
  selectedBotFilterLabel: string
  selectedWorkspaceFilterName: string
  workspaceFilterId: string
  workspaces: Workspace[]
}

function HelpTooltip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      <span className="info-label__help">?</span>
    </Tooltip>
  )
}

export function BotsPageFilterSummarySection({
  activeBotsCount,
  isEndpointsMode,
  onClearSelectedBotFilter,
  onChangeWorkspaceFilterId,
  selectedBotFilterId,
  selectedBotFilterLabel,
  selectedWorkspaceFilterName,
  workspaceFilterId,
  workspaces,
}: BotsPageFilterSummarySectionProps) {
  return (
    <section className="mode-panel">
      <div className="section-header section-header--inline">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <h2>{i18n._({ id: 'Workspace Filter', message: 'Workspace Filter' })}</h2>
          <HelpTooltip
            content={i18n._({
              id: 'Browse bots across all workspaces, then optionally narrow the directory to one owner workspace. Binding targets can still point at a different workspace.',
              message:
                'Browse bots across all workspaces, then optionally narrow the directory to one owner workspace. Binding targets can still point at a different workspace.',
            })}
          />
        </div>
      </div>
      {isEndpointsMode && selectedBotFilterId ? (
        <article className="detail-group detail-group--primary bots-page-filter-card bots-page-filter-card--selected">
          <div className="bots-page-filter-card__header">
            <div className="bots-page-filter-card__heading">
              <h3 className="detail-group__title">{i18n._({ id: 'Current Bot', message: 'Current Bot' })}</h3>
              <span className="meta-pill meta-pill--selected">
                {i18n._({ id: 'Selected', message: 'Selected' })}
              </span>
            </div>
            <Button intent="ghost" onClick={onClearSelectedBotFilter} size="sm" type="button">
              {i18n._({ id: 'Clear', message: 'Clear' })}
            </Button>
          </div>
          <div className="bots-page-filter-card__body">
            <strong className="bots-page-filter-card__name" dir="auto">
              {selectedBotFilterLabel}
            </strong>
            <div className="bots-page-filter-card__meta">
              <span>{i18n._({ id: 'Bot ID', message: 'Bot ID' })}</span>
              <strong dir="auto">{selectedBotFilterId}</strong>
            </div>
            <p className="bots-page-filter-card__note">
              {i18n._({
                id: 'Endpoint list below is limited to this bot.',
                message: 'Endpoint list below is limited to this bot.',
              })}
            </p>
          </div>
        </article>
      ) : null}
      <div className="bots-page-filter-summary__controls">
        <label className="field">
          <span>{i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}</span>
          <SelectControl
            ariaLabel={i18n._({ id: 'Owner Workspace', message: 'Owner Workspace' })}
            fullWidth
            onChange={onChangeWorkspaceFilterId}
            options={[
              {
                value: '',
                label: i18n._({ id: 'All Workspaces', message: 'All Workspaces' }),
              },
              ...workspaces.map((workspace) => ({
                value: workspace.id,
                label: workspace.name,
              })),
            ]}
            value={workspaceFilterId}
          />
        </label>
        <article className="detail-stat detail-stat--accent bots-page-filter-summary__stat">
          <span className="detail-stat__label">{i18n._({ id: 'Current Filter', message: 'Current Filter' })}</span>
          <strong className="detail-stat__value" dir="auto">
            {selectedWorkspaceFilterName}
          </strong>
        </article>
        <article className="detail-stat detail-stat--success bots-page-filter-summary__stat">
          <span className="detail-stat__label">
            {i18n._({ id: 'Visible Active Bots', message: 'Visible Active Bots' })}
          </span>
          <strong className="detail-stat__value">{activeBotsCount}</strong>
        </article>
      </div>
    </section>
  )
}
