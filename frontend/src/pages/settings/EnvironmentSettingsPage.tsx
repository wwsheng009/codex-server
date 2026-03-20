import { useMemo } from 'react'

import {
  SettingsGroup,
  SettingRow,
  SettingsPageHeader,
  SettingsRecord,
} from '../../components/settings/SettingsPrimitives'
import { StatusPill } from '../../components/ui/StatusPill'
import { formatRelativeTimeShort } from '../../components/workspace/renderers'
import { useSettingsShellContext } from '../../features/settings/shell-context'

export function EnvironmentSettingsPage() {
  const { workspaceName, workspaces, workspacesLoading, workspacesError } = useSettingsShellContext()

  const healthyWorkspaces = useMemo(
    () => workspaces.filter((workspace) => ['ready', 'active', 'connected'].includes(workspace.runtimeStatus)).length,
    [workspaces],
  )
  const attentionWorkspaces = workspaces.length - healthyWorkspaces

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Inspect the registered project roots and runtime posture for the current client environment."
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">{workspaces.length} roots</span>
          </>
        }
        title="Environment"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Global environment snapshot across all registered workspaces."
          title="Workspace Registry"
        >
          <SettingRow
            description="Review the current runtime footprint and health across all registered roots."
            title="Summary"
          >
            <div className="mode-metrics">
              <div className="mode-metric">
                <span>Total</span>
                <strong>{workspaces.length}</strong>
              </div>
              <div className="mode-metric">
                <span>Healthy</span>
                <strong>{healthyWorkspaces}</strong>
              </div>
              <div className="mode-metric">
                <span>Attention</span>
                <strong>{attentionWorkspaces}</strong>
              </div>
            </div>
          </SettingRow>

          <SettingRow
            description="Each registered workspace acts as an environment root for threads, runtime tools, and settings-scoped actions."
            title="Registered Roots"
          >
            {workspacesLoading ? <div className="notice">Loading workspaces…</div> : null}
            {workspacesError ? <div className="notice notice--error">{workspacesError}</div> : null}
            {!workspacesLoading && !workspaces.length ? (
              <div className="empty-state">No workspaces registered yet.</div>
            ) : null}
            <div className="settings-record-list">
              {workspaces.map((workspace) => (
                <SettingsRecord
                  action={<span className="meta-pill">Environment Root</span>}
                  description={`${workspace.rootPath} · updated ${formatRelativeTimeShort(workspace.updatedAt)}`}
                  key={workspace.id}
                  marker="EN"
                  meta={
                    <>
                      <span className="meta-pill">{workspace.id.slice(0, 8)}</span>
                      <StatusPill status={workspace.runtimeStatus} />
                    </>
                  }
                  title={workspace.name}
                />
              ))}
            </div>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
