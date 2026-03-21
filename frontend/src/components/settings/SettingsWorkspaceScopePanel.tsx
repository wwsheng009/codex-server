import { useSettingsShellContext } from '../../features/settings/shell-context'
import { InlineNotice } from '../ui/InlineNotice'
import { SelectControl } from '../ui/SelectControl'

type SettingsWorkspaceScopePanelProps = {
  title?: string
  description?: string
}

export function SettingsWorkspaceScopePanel({
  title = 'Workspace Scope',
  description = 'Choose the runtime root for this settings page.',
}: SettingsWorkspaceScopePanelProps) {
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
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      <label className="field">
        <span>Workspace</span>
        <SelectControl
          ariaLabel="Workspace"
          fullWidth
          onChange={setSelectedWorkspaceId}
          options={workspaces.map((workspace) => ({
            value: workspace.id,
            label: workspace.name,
          }))}
          value={workspaceId ?? ''}
        />
      </label>
      {workspacesLoading ? <div className="notice">Loading workspaces…</div> : null}
      {workspacesError ? (
        <InlineNotice
          dismissible
          noticeKey={`settings-scope-${workspacesError}`}
          title="Workspace Scope Unavailable"
          tone="error"
        >
          {workspacesError}
        </InlineNotice>
      ) : null}
      <div className="settings-scope-panel__summary">
        <div className="settings-scope-panel__summary-item">
          <span>Active</span>
          <strong>{workspaceName}</strong>
        </div>
        <div className="settings-scope-panel__summary-item">
          <span>Roots</span>
          <strong>{workspaces.length}</strong>
        </div>
        <div className="settings-scope-panel__summary-item">
          <span>Mode</span>
          <strong>{workspaceId ? 'Scoped' : 'Required'}</strong>
        </div>
      </div>
    </section>
  )
}
