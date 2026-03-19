import { Navigate, createBrowserRouter } from 'react-router-dom'

import { AppShell } from '../components/layout/AppShell'
import { AccountPage } from '../pages/AccountPage'
import { CatalogPage } from '../pages/CatalogPage'
import { NotFoundPage } from '../pages/NotFoundPage'
import { ThreadPage } from '../pages/ThreadPage'
import { WorkspacesPage } from '../pages/WorkspacesPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Navigate replace to="/workspaces" /> },
      { path: 'workspaces', element: <WorkspacesPage /> },
      { path: 'workspaces/:workspaceId', element: <ThreadPage /> },
      { path: 'catalog', element: <CatalogPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])
