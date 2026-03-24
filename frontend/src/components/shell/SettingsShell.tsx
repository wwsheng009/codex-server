import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'

import { getSettingsSections } from '../../features/settings/sections'
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import { listWorkspaces } from '../../features/workspaces/api'
import { useSessionStore } from '../../stores/session-store'

export function SettingsShell() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState('')
  const sessionSelectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId)
  const settingsSections = getSettingsSections()

  const workspacesQuery = useQuery({
    queryKey: ['settings-shell-workspaces'],
    queryFn: listWorkspaces,
  })

  const workspaceId = useMemo(() => {
    const workspaces = workspacesQuery.data ?? []
    if (!workspaces.length) {
      return undefined
    }

    if (selectedWorkspaceId && workspaces.some((workspace) => workspace.id === selectedWorkspaceId)) {
      return selectedWorkspaceId
    }

    if (
      sessionSelectedWorkspaceId &&
      workspaces.some((workspace) => workspace.id === sessionSelectedWorkspaceId)
    ) {
      return sessionSelectedWorkspaceId
    }

    return workspaces[0]?.id
  }, [selectedWorkspaceId, sessionSelectedWorkspaceId, workspacesQuery.data])

  const workspaceName =
    workspacesQuery.data?.find((workspace) => workspace.id === workspaceId)?.name ??
    i18n._({ id: 'No workspace', message: 'No workspace' })

  return (
    <section className="settings-shell">
      <div className="settings-shell__frame">
        <aside className="settings-shell__sidebar">
          <section className="mode-panel mode-panel--flush settings-shell__nav-panel">
            <div className="mode-panel__body settings-shell__nav-body">
              <NavLink className="settings-shell__back" to="/workspaces">
                {i18n._({ id: 'Back to App', message: 'Back to App' })}
              </NavLink>
              <div className="settings-shell__workspace">
                <span className="settings-shell__workspace-label">
                  {i18n._({ id: 'Workspace', message: 'Workspace' })}
                </span>
                <p>{workspaceName}</p>
              </div>
            </div>
            <nav className="settings-shell__nav">
              {settingsSections.map((section) => (
                <NavLink
                  className={({ isActive }) =>
                    isActive
                      ? 'settings-shell__nav-item settings-shell__nav-item--active'
                      : 'settings-shell__nav-item'
                  }
                  key={section.id}
                  to={section.to}
                >
                  <span className="settings-shell__nav-item-label">{section.label}</span>
                </NavLink>
              ))}
            </nav>
          </section>
        </aside>

        <main className="settings-shell__content">
          <Outlet
            context={{
              workspaceId,
              workspaceName,
              workspaces: workspacesQuery.data ?? [],
              workspacesLoading: workspacesQuery.isLoading,
              workspacesError: workspacesQuery.error ? getErrorMessage(workspacesQuery.error) : null,
              setSelectedWorkspaceId,
            }}
          />
        </main>
      </div>
    </section>
  )
}
