import { Suspense, lazy } from 'react'
import type { ComponentType, LazyExoticComponent } from 'react'
import { Navigate, createBrowserRouter } from 'react-router-dom'

const AppShell = lazy(async () => {
  const module = await import('../components/shell/AppShell')
  return { default: module.AppShell }
})
const SettingsShell = lazy(async () => {
  const module = await import('../components/shell/SettingsShell')
  return { default: module.SettingsShell }
})
const AutomationDetailPage = lazy(async () => {
  const module = await import('../pages/AutomationDetailPage')
  return { default: module.AutomationDetailPage }
})
const AutomationsPage = lazy(async () => {
  const module = await import('../pages/AutomationsPage')
  return { default: module.AutomationsPage }
})
const CatalogPage = lazy(async () => {
  const module = await import('../pages/CatalogPage')
  return { default: module.CatalogPage }
})
const NotFoundPage = lazy(async () => {
  const module = await import('../pages/NotFoundPage')
  return { default: module.NotFoundPage }
})
const SkillsPage = lazy(async () => {
  const module = await import('../pages/SkillsPage')
  return { default: module.SkillsPage }
})
const ThreadPage = lazy(async () => {
  const module = await import('../pages/ThreadPage')
  return { default: module.ThreadPage }
})
const WorkspacesPage = lazy(async () => {
  const module = await import('../pages/WorkspacesPage')
  return { default: module.WorkspacesPage }
})
const AppearanceSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/AppearanceSettingsPage')
  return { default: module.AppearanceSettingsPage }
})
const ArchivedThreadsSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/ArchivedThreadsSettingsPage')
  return { default: module.ArchivedThreadsSettingsPage }
})
const ConfigSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/ConfigSettingsPage')
  return { default: module.ConfigSettingsPage }
})
const EnvironmentSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/EnvironmentSettingsPage')
  return { default: module.EnvironmentSettingsPage }
})
const GitSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/GitSettingsPage')
  return { default: module.GitSettingsPage }
})
const GeneralSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/GeneralSettingsPage')
  return { default: module.GeneralSettingsPage }
})
const McpSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/McpSettingsPage')
  return { default: module.McpSettingsPage }
})
const PersonalizationSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/PersonalizationSettingsPage')
  return { default: module.PersonalizationSettingsPage }
})
const WorktreesSettingsPage = lazy(async () => {
  const module = await import('../pages/settings/WorktreesSettingsPage')
  return { default: module.WorktreesSettingsPage }
})

function RouteLoadingState() {
  return (
    <section className="screen screen--centered">
      <div className="notice">Loading…</div>
    </section>
  )
}

function lazyElement(Component: LazyExoticComponent<ComponentType>) {
  return (
    <Suspense fallback={<RouteLoadingState />}>
      <Component />
    </Suspense>
  )
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: lazyElement(AppShell),
    children: [
      { index: true, element: <Navigate replace to="/workspaces" /> },
      { path: 'workspaces', element: lazyElement(WorkspacesPage) },
      { path: 'workspaces/:workspaceId', element: lazyElement(ThreadPage) },
      { path: 'automations', element: lazyElement(AutomationsPage) },
      { path: 'automations/:automationId', element: lazyElement(AutomationDetailPage) },
      { path: 'skills', element: lazyElement(SkillsPage) },
      { path: 'runtime', element: lazyElement(CatalogPage) },
      {
        path: 'settings',
        element: lazyElement(SettingsShell),
        children: [
          { index: true, element: <Navigate replace to="general" /> },
          { path: 'general', element: lazyElement(GeneralSettingsPage) },
          { path: 'appearance', element: lazyElement(AppearanceSettingsPage) },
          { path: 'config', element: lazyElement(ConfigSettingsPage) },
          { path: 'personalization', element: lazyElement(PersonalizationSettingsPage) },
          { path: 'mcp', element: lazyElement(McpSettingsPage) },
          { path: 'git', element: lazyElement(GitSettingsPage) },
          { path: 'environment', element: lazyElement(EnvironmentSettingsPage) },
          { path: 'worktrees', element: lazyElement(WorktreesSettingsPage) },
          { path: 'archived-threads', element: lazyElement(ArchivedThreadsSettingsPage) },
        ],
      },
      { path: '*', element: lazyElement(NotFoundPage) },
    ],
  },
])
