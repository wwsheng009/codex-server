import { useQueries, useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { layoutConfig } from '../../lib/layout-config'
import {
  readLeftSidebarCollapsed,
  readLeftSidebarWidth,
  readWorkspaceThreadGroupsCollapsed,
  writeLeftSidebarCollapsed,
  writeLeftSidebarWidth,
  writeWorkspaceThreadGroupsCollapsed,
} from '../../lib/layout-state'
import {
  AppGridIcon,
  AutomationIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  RailIcon,
  RailIconButton,
  ResizeHandle,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
} from '../ui/RailControls'
import { listThreads } from '../../features/threads/api'
import { listWorkspaces } from '../../features/workspaces/api'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useSessionStore } from '../../stores/session-store'
import { getSelectedThreadIdForWorkspace } from '../../stores/session-store-utils'
import { formatRelativeTimeShort } from '../workspace/renderers'
import { AppMenuBar } from './AppMenuBar'

const primaryNav = [
  { to: '/workspaces', label: 'Workspaces', icon: AppGridIcon },
  { to: '/automations', label: 'Automations', icon: AutomationIcon },
  { to: '/skills', label: 'Skills', icon: SparkIcon },
  { to: '/runtime', label: 'Runtime', icon: TerminalIcon },
]

export function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const isMobileViewport = useMediaQuery('(max-width: 900px)')
  const isSettingsRoute = location.pathname.startsWith('/settings')
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readLeftSidebarCollapsed)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [workspaceThreadGroupsCollapsed, setWorkspaceThreadGroupsCollapsed] = useState(
    readWorkspaceThreadGroupsCollapsed,
  )
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(readLeftSidebarWidth)
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId)
  const selectedThreadIdByWorkspace = useSessionStore((state) => state.selectedThreadIdByWorkspace)

  const workspacesQuery = useQuery({
    queryKey: ['shell-workspaces'],
    queryFn: listWorkspaces,
  })

  const threadQueries = useQueries({
    queries: (workspacesQuery.data ?? []).map((workspace) => ({
      queryKey: ['shell-threads', workspace.id],
      queryFn: () => listThreads(workspace.id),
      enabled: Boolean(workspacesQuery.data?.length) && !isSettingsRoute,
    })),
  })

  useEffect(() => {
    writeLeftSidebarCollapsed(isSidebarCollapsed)
  }, [isSidebarCollapsed])

  useEffect(() => {
    writeLeftSidebarWidth(leftSidebarWidth)
  }, [leftSidebarWidth])

  useEffect(() => {
    writeWorkspaceThreadGroupsCollapsed(workspaceThreadGroupsCollapsed)
  }, [workspaceThreadGroupsCollapsed])

  useEffect(() => {
    if (!isMobileViewport && isMobileSidebarOpen) {
      setIsMobileSidebarOpen(false)
    }
  }, [isMobileSidebarOpen, isMobileViewport])

  useEffect(() => {
    if (isMobileViewport) {
      setIsMobileSidebarOpen(false)
    }
  }, [isMobileViewport, location.pathname])

  useEffect(() => {
    if (!isSidebarResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = sidebarResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = event.clientX - resizeState.startX
      const nextWidth = Math.min(
        layoutConfig.shell.leftSidebar.limits.max,
        Math.max(layoutConfig.shell.leftSidebar.limits.min, resizeState.startWidth + delta),
      )
      setLeftSidebarWidth(nextWidth)
    }

    function stopResizing() {
      sidebarResizeRef.current = null
      setIsSidebarResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isSidebarResizing])

  function handleSidebarResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    sidebarResizeRef.current = {
      startX: event.clientX,
      startWidth: leftSidebarWidth,
    }
    setIsSidebarResizing(true)
  }

  function isWorkspaceGroupExpanded(workspaceId: string) {
    return !workspaceThreadGroupsCollapsed[workspaceId]
  }

  function toggleWorkspaceGroup(workspaceId: string) {
    setWorkspaceThreadGroupsCollapsed((current) => ({
      ...current,
      [workspaceId]: !current[workspaceId],
    }))
  }

  const isDesktopSidebarCollapsed = !isMobileViewport && isSidebarCollapsed
  const shouldShowSidebarLabels = isMobileViewport || !isSidebarCollapsed
  const sidebarClassName = [
    'web-ide__sidebar',
    isDesktopSidebarCollapsed ? 'web-ide__sidebar--collapsed' : '',
    isSidebarResizing ? 'web-ide__sidebar--resizing' : '',
    isMobileViewport ? 'web-ide__sidebar--mobile' : '',
    isMobileViewport && isMobileSidebarOpen ? 'web-ide__sidebar--mobile-open' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const frameClassName = [
    'web-ide__frame',
    isDesktopSidebarCollapsed ? 'web-ide__frame--sidebar-collapsed' : '',
    isMobileViewport ? 'web-ide__frame--mobile' : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className="web-ide">
      <AppMenuBar
        mobileNavOpen={isMobileSidebarOpen}
        onOpenSidebar={() => setIsMobileSidebarOpen((current) => !current)}
        showMobileNavButton={isMobileViewport}
      />

      <div
        className={frameClassName}
        style={{
          ['--shell-sidebar-width' as string]:
            isMobileViewport
              ? '0px'
              : isSidebarCollapsed
                ? 'var(--rail-collapsed-width)'
                : `${leftSidebarWidth}px`,
        }}
      >
        {isMobileViewport && isMobileSidebarOpen ? (
          <button
            aria-label="Close navigation"
            className="web-ide__sidebar-backdrop"
            onClick={() => setIsMobileSidebarOpen(false)}
            type="button"
          />
        ) : null}
        <aside className={sidebarClassName}>
          {!isMobileViewport && !isSidebarCollapsed ? (
            <ResizeHandle
              aria-label="Resize sidebar"
              axis="horizontal"
              className="web-ide__sidebar-resize"
              edge="end"
              onPointerDown={handleSidebarResizeStart}
            />
          ) : null}
          <div className="web-ide__brand">
            <div className="web-ide__brand-mark">C</div>
            {shouldShowSidebarLabels ? (
              <div>
                <strong>codex-server</strong>
                <p>Web IDE prototype</p>
              </div>
            ) : null}
            <RailIconButton
              aria-label={
                isMobileViewport
                  ? 'Close navigation'
                  : isSidebarCollapsed
                    ? 'Expand sidebar'
                    : 'Collapse sidebar'
              }
              className="web-ide__sidebar-toggle"
              onClick={() =>
                isMobileViewport
                  ? setIsMobileSidebarOpen(false)
                  : setIsSidebarCollapsed((current) => !current)
              }
            >
              {isMobileViewport ? <ChevronLeftIcon /> : isSidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </RailIconButton>
          </div>

          <div className="web-ide__sidebar-body">
            <nav className="web-ide__primary-nav">
              {primaryNav.map((item) => (
                <NavLink
                  className={({ isActive }) =>
                    isActive ? 'web-ide__primary-link web-ide__primary-link--active' : 'web-ide__primary-link'
                  }
                  key={item.to}
                  onClick={() => {
                    if (isMobileViewport) {
                      setIsMobileSidebarOpen(false)
                    }
                  }}
                  to={item.to}
                  title={item.label}
                >
                  <RailIcon>
                    <item.icon />
                  </RailIcon>
                  {shouldShowSidebarLabels ? <span className="web-ide__primary-link-label">{item.label}</span> : null}
                </NavLink>
              ))}
            </nav>

            {shouldShowSidebarLabels && !isSettingsRoute ? (
              <div className="web-ide__workspace-tree">
                <div className="web-ide__section-title">Threads</div>
                {workspacesQuery.data?.map((workspace, index) => {
                  const threads = threadQueries[index]?.data ?? []
                  const isWorkspaceGroupOpen = isWorkspaceGroupExpanded(workspace.id)
                  const activeThreadId = getSelectedThreadIdForWorkspace(
                    {
                      selectedWorkspaceId,
                      selectedThreadIdByWorkspace,
                    },
                    workspace.id,
                  )

                  return (
                    <section className="workspace-tree__group" key={workspace.id}>
                      <div className="workspace-tree__group-header">
                        <button
                          className={
                            location.pathname.startsWith(`/workspaces/${workspace.id}`)
                              ? 'workspace-tree__workspace workspace-tree__workspace--active'
                              : 'workspace-tree__workspace'
                          }
                          onClick={() => {
                            setSelectedWorkspace(workspace.id)
                            setWorkspaceThreadGroupsCollapsed((current) => ({
                              ...current,
                              [workspace.id]: false,
                            }))
                            if (isMobileViewport) {
                              setIsMobileSidebarOpen(false)
                            }
                            navigate(`/workspaces/${workspace.id}`)
                          }}
                          type="button"
                        >
                          <span className="workspace-tree__workspace-name">{workspace.name}</span>
                          <span className="workspace-tree__workspace-status">{workspace.runtimeStatus}</span>
                        </button>
                        <button
                          aria-controls={`workspace-threads-${workspace.id}`}
                          aria-expanded={isWorkspaceGroupOpen}
                          className={
                            isWorkspaceGroupOpen
                              ? 'workspace-tree__toggle workspace-tree__toggle--expanded'
                              : 'workspace-tree__toggle'
                          }
                          onClick={() => toggleWorkspaceGroup(workspace.id)}
                          title={isWorkspaceGroupOpen ? 'Collapse workspace threads' : 'Expand workspace threads'}
                          type="button"
                        >
                          <ChevronRightIcon />
                        </button>
                      </div>

                      {isWorkspaceGroupOpen ? (
                        <div className="workspace-tree__threads" id={`workspace-threads-${workspace.id}`}>
                          {threads.slice(0, 8).map((thread) => (
                            <button
                              className={
                                activeThreadId === thread.id
                                  ? 'workspace-tree__thread workspace-tree__thread--active'
                                  : 'workspace-tree__thread'
                              }
                              key={thread.id}
                              onClick={() => {
                                setSelectedWorkspace(workspace.id)
                                setSelectedThread(workspace.id, thread.id)
                                if (isMobileViewport) {
                                  setIsMobileSidebarOpen(false)
                                }
                                navigate(`/workspaces/${workspace.id}`)
                              }}
                              type="button"
                            >
                              <span className="workspace-tree__thread-title">{thread.name}</span>
                              <span className="workspace-tree__thread-meta">
                                {formatRelativeTimeShort(thread.updatedAt)}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </section>
                  )
                })}
              </div>
            ) : null}
          </div>

          <div className="web-ide__sidebar-footer">
            <NavLink
              className={() =>
                isSettingsRoute ? 'web-ide__settings-link web-ide__settings-link--active' : 'web-ide__settings-link'
              }
              onClick={() => {
                if (isMobileViewport) {
                  setIsMobileSidebarOpen(false)
                }
              }}
              title="Settings"
              to="/settings/general"
            >
              <RailIcon>
                <SettingsIcon />
              </RailIcon>
              {shouldShowSidebarLabels ? <span className="web-ide__primary-link-label">Settings</span> : null}
            </NavLink>
          </div>
        </aside>

        <main className="web-ide__main">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
