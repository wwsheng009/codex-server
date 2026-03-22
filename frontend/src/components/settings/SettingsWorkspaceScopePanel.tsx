import type { ReactNode } from 'react'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { i18n } from '../../i18n/runtime'
import { InlineNotice } from '../ui/InlineNotice'
import { SelectControl } from '../ui/SelectControl'

export type SettingsSummaryItem = {
  label: string
  value: ReactNode
  tone?: 'active' | 'paused' | 'error' | 'default'
}

type SettingsWorkspaceScopePanelProps = {
  title?: string
  description?: string
  extraSummaryItems?: SettingsSummaryItem[]
}

export function SettingsWorkspaceScopePanel({
  title,
  description,
  extraSummaryItems = [],
}: SettingsWorkspaceScopePanelProps) {
  const resolvedTitle = title ?? i18n._({ id: 'Workspace Scope', message: 'Workspace Scope' })
  const resolvedDescription =
    description ??
    i18n._({
      id: 'Choose the runtime root for this settings page.',
      message: 'Choose the runtime root for this settings page.',
    })
  const {
    workspaceId,
    workspaceName,
    workspaces,
    workspacesLoading,
    workspacesError,
    setSelectedWorkspaceId,
  } = useSettingsShellContext()

  return (
    <section className="mode-panel settings-scope-panel">
      <div className="section-header">
        <div>
          <h2>{resolvedTitle}</h2>
          <p>{resolvedDescription}</p>
        </div>
      </div>
      <label className="field">
        <span>{i18n._({ id: 'Workspace', message: 'Workspace' })}</span>
        <SelectControl
          ariaLabel={i18n._({ id: 'Workspace', message: 'Workspace' })}
          fullWidth
          onChange={setSelectedWorkspaceId}
          options={workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
          }))}
          value={workspaceId ?? ''}
        />
      </label>
      {workspacesLoading ? (
        <div className="notice">{i18n._({ id: 'Loading workspaces…', message: 'Loading workspaces…' })}</div>
      ) : null}
      {workspacesError ? (
        <InlineNotice
          dismissible
          noticeKey={`settings-scope-${workspacesError}`}
          title={i18n._({
            id: 'Workspace Scope Unavailable',
            message: 'Workspace Scope Unavailable',
          })}
          tone="error"
        >
          {workspacesError}
        </InlineNotice>
      ) : null}
      <div className="settings-scope-panel__summary">
        <div className="settings-scope-panel__summary-item">
          <span>{i18n._({ id: 'Active', message: 'Active' })}</span>
          <strong>{workspaceName}</strong>
        </div>
        <div className="settings-scope-panel__summary-item">
          <span>{i18n._({ id: 'Roots', message: 'Roots' })}</span>
          <strong>{workspaces.length}</strong>
        </div>
        <div className="settings-scope-panel__summary-item">
          <span>{i18n._({ id: 'Mode', message: 'Mode' })}</span>
          <strong>
            {workspaceId
              ? i18n._({ id: 'Scoped', message: 'Scoped' })
              : i18n._({ id: 'Required', message: 'Required' })}
          </strong>
        </div>
        {extraSummaryItems.map((item, index) => (
          <div
            className={`settings-scope-panel__summary-item settings-scope-panel__summary-item--${item.tone || 'default'}`}
            key={`${item.label}-${index}`}
          >
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
    </section>
  )
}
