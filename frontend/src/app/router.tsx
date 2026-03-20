import { Navigate, createBrowserRouter } from 'react-router-dom'

import { AppShell } from '../components/shell/AppShell'
import { SettingsShell } from '../components/shell/SettingsShell'
import { AutomationDetailPage } from '../pages/AutomationDetailPage'
import { AutomationsPage } from '../pages/AutomationsPage'
import { CatalogPage } from '../pages/CatalogPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { SkillsPage } from '../pages/SkillsPage'
import { ThreadPage } from '../pages/ThreadPage'
import { WorkspacesPage } from '../pages/WorkspacesPage'
import { AppearanceSettingsPage } from '../pages/settings/AppearanceSettingsPage'
import { ArchivedThreadsSettingsPage } from '../pages/settings/ArchivedThreadsSettingsPage'
import { ConfigSettingsPage } from '../pages/settings/ConfigSettingsPage'
import { EnvironmentSettingsPage } from '../pages/settings/EnvironmentSettingsPage'
import { GitSettingsPage } from '../pages/settings/GitSettingsPage'
import { GeneralSettingsPage } from '../pages/settings/GeneralSettingsPage'
import { McpSettingsPage } from '../pages/settings/McpSettingsPage'
import { PersonalizationSettingsPage } from '../pages/settings/PersonalizationSettingsPage'
import { WorktreesSettingsPage } from '../pages/settings/WorktreesSettingsPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate replace to="/workspaces" /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: 'workspaces/:workspaceId', element: <ThreadPage /> },
      { path: 'automations', element: <AutomationsPage /> },
      { path: 'automations/:automationId', element: <AutomationDetailPage /> },
      { path: 'skills', element: <SkillsPage /> },
      { path: 'runtime', element: <CatalogPage /> },
      {
        path: 'settings',
        element: <SettingsShell />,
        children: [
          { index: true, element: <Navigate replace to="general" /> },
          { path: 'general', element: <GeneralSettingsPage /> },
          { path: 'appearance', element: <AppearanceSettingsPage /> },
          { path: 'config', element: <ConfigSettingsPage /> },
          { path: 'personalization', element: <PersonalizationSettingsPage /> },
          { path: 'mcp', element: <McpSettingsPage /> },
          { path: 'git', element: <GitSettingsPage /> },
          { path: 'environment', element: <EnvironmentSettingsPage /> },
          { path: 'worktrees', element: <WorktreesSettingsPage /> },
          { path: 'archived-threads', element: <ArchivedThreadsSettingsPage /> },
        ],
      },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
