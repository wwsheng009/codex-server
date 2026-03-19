import { NavLink, Outlet } from 'react-router-dom'

import { API_BASE_URL } from '../../lib/api-client'

const navItems = [
  { to: '/workspaces', label: 'Workspaces' },
  { to: '/catalog', label: 'Catalog' },
  { to: '/account', label: 'Account' },
]

export function AppShell() {
  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div>
          <div className="shell__brand">codex-server</div>
          <p className="shell__subtitle">Go BFF + React/Vite Web UI for Codex</p>
        </div>

        <nav className="shell__nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => (isActive ? 'nav-link nav-link--active' : 'nav-link')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="shell__meta">
          <span className="meta-label">API</span>
          <code>{API_BASE_URL}</code>
        </div>
      </aside>

      <main className="shell__content">
        <Outlet />
      </main>
    </div>
  )
}
