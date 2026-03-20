import { useSettingsShellContext } from '../../features/settings/shell-context'

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
        <select value={workspaceId ?? ''} onChange={(event) => setSelectedWorkspaceId(event.target.value)}>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </label>
      {workspacesLoading ? <div className="notice">Loading workspaces…</div> : null}
      {workspacesError ? <p className="error-text">{workspacesError}</p> : null}
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
