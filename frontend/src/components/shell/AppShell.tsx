import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '../ui/ConfirmDialog'
import { RenameDialog } from '../ui/RenameDialog'
import { layoutConfig } from '../../lib/layout-config'
import { getErrorMessage } from '../../lib/error-utils'
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
  FolderClosedIcon,
  FolderOpenIcon,
  MoreActionsIcon,
  RailIcon,
  RailIconButton,
  ResizeHandle,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
} from '../ui/RailControls'
import { createThread, deleteThread, listThreads, renameThread } from '../../features/threads/api'
import { deleteWorkspace, listWorkspaces, renameWorkspace } from '../../features/workspaces/api'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useSessionStore } from '../../stores/session-store'
import { getSelectedThreadIdForWorkspace } from '../../stores/session-store-utils'
import type { Thread, ThreadDetail, Workspace } from '../../types/api'
import { formatRelativeTimeShort } from '../workspace/timeline-utils'
import { AppMenuBar } from './AppMenuBar'

const primaryNav = [
  { to: '/workspaces', label: 'Workspaces', icon: AppGridIcon },
  { to: '/automations', label: 'Automations', icon: AutomationIcon },
  { to: '/skills', label: 'Skills', icon: SparkIcon },
  { to: '/runtime', label: 'Runtime', icon: TerminalIcon },
]

type SidebarMenuState =
  | {
      kind: 'workspace'
      workspaceId: string
    }
  | {
      kind: 'thread'
      workspaceId: string
      threadId: string
    }
  | null

type RenameTarget =
  | {
      kind: 'workspace'
      workspace: Workspace
    }
  | {
      kind: 'thread'
      workspaceId: string
      thread: Thread
    }
  | null

type DeleteTarget =
  | {
      kind: 'workspace'
      workspace: Workspace
    }
  | {
      kind: 'thread'
      workspaceId: string
      thread: Thread
    }
  | null

type CreateThreadTarget = Workspace | null

const DEFAULT_VISIBLE_THREADS = 8

function updateThreadInList(current: Thread[] | undefined, thread: Thread) {
  if (!current?.length) {
    return current
  }

  return current.map((item) => (item.id === thread.id ? thread : item))
}

function upsertThreadInList(current: Thread[] | undefined, thread: Thread) {
  const items = current ?? []
  const nextItems = items.some((item) => item.id === thread.id)
    ? items.map((item) => (item.id === thread.id ? thread : item))
    : [thread, ...items]

  return [...nextItems].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )
}

function updateWorkspaceInList(current: Workspace[] | undefined, workspace: Workspace) {
  if (!current?.length) {
    return current
  }

  return current.map((item) => (item.id === workspace.id ? workspace : item))
}

export function AppShell() {
  const queryClient = useQueryClient()
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
  const [openMenu, setOpenMenu] = useState<SidebarMenuState>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [createThreadTarget, setCreateThreadTarget] = useState<CreateThreadTarget>(null)
  const [createThreadName, setCreateThreadName] = useState('')
  const [visibleThreadCountByWorkspace, setVisibleThreadCountByWorkspace] = useState<Record<string, number>>({})
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeThread = useSessionStore((state) => state.removeThread)
  const removeWorkspace = useSessionStore((state) => state.removeWorkspace)
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
    setOpenMenu(null)
    setRenameTarget(null)
    setDeleteTarget(null)
    setCreateThreadTarget(null)
  }, [location.pathname])

  useEffect(() => {
    if (!openMenu) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      const menu = menuRef.current
      if (menu && event.target instanceof Node && !menu.contains(event.target)) {
        setOpenMenu(null)
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpenMenu(null)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [openMenu])

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

  async function invalidateWorkspaceQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
      queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
    ])
  }

  async function invalidateThreadQueries(workspaceId: string) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
    ])
  }

  const renameWorkspaceMutation = useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      renameWorkspace(workspaceId, { name }),
    onSuccess: async (workspace) => {
      setOpenMenu(null)
      setRenameTarget(null)
      setRenameValue('')
      queryClient.setQueryData<Workspace[]>(['shell-workspaces'], (current) =>
        updateWorkspaceInList(current, workspace),
      )
      queryClient.setQueryData<Workspace[]>(['workspaces'], (current) =>
        updateWorkspaceInList(current, workspace),
      )
      queryClient.setQueryData<Workspace>(['workspace', workspace.id], workspace)
      await invalidateWorkspaceQueries()
    },
  })

  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => deleteWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      removeWorkspace(workspaceId)
      queryClient.removeQueries({ queryKey: ['workspace', workspaceId] })
      queryClient.removeQueries({ queryKey: ['threads', workspaceId] })
      queryClient.removeQueries({ queryKey: ['thread-detail', workspaceId] })
      queryClient.removeQueries({ queryKey: ['approvals', workspaceId] })
      queryClient.removeQueries({ queryKey: ['models', workspaceId] })
      queryClient.removeQueries({ queryKey: ['shell-threads', workspaceId] })
      setOpenMenu(null)
      setDeleteTarget(null)
      if (location.pathname.startsWith(`/workspaces/${workspaceId}`)) {
        navigate('/workspaces')
      }
      await Promise.all([
        invalidateWorkspaceQueries(),
        queryClient.invalidateQueries({ queryKey: ['shell-threads'] }),
      ])
    },
  })

  const createThreadMutation = useMutation({
    mutationFn: ({ workspaceId, name }: { workspaceId: string; name: string }) =>
      createThread(workspaceId, { name }),
    onSuccess: async (thread) => {
      queryClient.setQueryData<Thread[]>(['threads', thread.workspaceId], (current) =>
        upsertThreadInList(current, thread),
      )
      queryClient.setQueryData<Thread[]>(['shell-threads', thread.workspaceId], (current) =>
        upsertThreadInList(current, thread),
      )
      setSelectedWorkspace(thread.workspaceId)
      setSelectedThread(thread.workspaceId, thread.id)
      setWorkspaceThreadGroupsCollapsed((current) => ({
        ...current,
        [thread.workspaceId]: false,
      }))
      setVisibleThreadCountByWorkspace((current) => ({
        ...current,
        [thread.workspaceId]: Math.max(current[thread.workspaceId] ?? DEFAULT_VISIBLE_THREADS, DEFAULT_VISIBLE_THREADS),
      }))
      setOpenMenu(null)
      setCreateThreadTarget(null)
      setCreateThreadName('')
      await Promise.all([
        invalidateThreadQueries(thread.workspaceId),
        invalidateWorkspaceQueries(),
      ])
      if (isMobileViewport) {
        setIsMobileSidebarOpen(false)
      }
      navigate(`/workspaces/${thread.workspaceId}`)
    },
  })

  const renameThreadMutation = useMutation({
    mutationFn: ({ workspaceId, threadId, name }: { workspaceId: string; threadId: string; name: string }) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async (thread) => {
      setOpenMenu(null)
      setRenameTarget(null)
      setRenameValue('')
      queryClient.setQueryData<Thread[]>(['threads', thread.workspaceId], (current) =>
        updateThreadInList(current, thread),
      )
      queryClient.setQueryData<Thread[]>(['shell-threads', thread.workspaceId], (current) =>
        updateThreadInList(current, thread),
      )
      queryClient.setQueryData<ThreadDetail>(['thread-detail', thread.workspaceId, thread.id], (current) =>
        current
          ? {
              ...current,
              ...thread,
            }
          : current,
      )
      await invalidateThreadQueries(thread.workspaceId)
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: ({ workspaceId, threadId }: { workspaceId: string; threadId: string }) =>
      deleteThread(workspaceId, threadId),
    onSuccess: async (_, variables) => {
      const currentThreadId = getSelectedThreadIdForWorkspace(
        {
          selectedWorkspaceId,
          selectedThreadIdByWorkspace,
        },
        variables.workspaceId,
      )

      const remainingThreads = (
        queryClient.getQueryData<Thread[]>(['shell-threads', variables.workspaceId]) ?? []
      ).filter((thread) => thread.id !== variables.threadId)

      queryClient.setQueryData<Thread[]>(['shell-threads', variables.workspaceId], remainingThreads)
      queryClient.setQueryData<Thread[]>(['threads', variables.workspaceId], (current) =>
        (current ?? []).filter((thread) => thread.id !== variables.threadId),
      )
      queryClient.removeQueries({ queryKey: ['thread-detail', variables.workspaceId, variables.threadId] })

      removeThread(variables.workspaceId, variables.threadId)
      if (currentThreadId === variables.threadId) {
        setSelectedThread(variables.workspaceId, remainingThreads[0]?.id)
      }

      setOpenMenu(null)
      setDeleteTarget(null)
      await invalidateThreadQueries(variables.workspaceId)
    },
  })

  function handleWorkspaceClick(workspaceId: string) {
    const isExpanded = isWorkspaceGroupExpanded(workspaceId)

    setSelectedWorkspace(workspaceId)
    setWorkspaceThreadGroupsCollapsed((current) => ({
      ...current,
      [workspaceId]: isExpanded,
    }))

    if (isMobileViewport) {
      setIsMobileSidebarOpen(false)
    }

    navigate(`/workspaces/${workspaceId}`)
  }

  function handleCreateThreadForWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      deleteWorkspaceMutation.isPending ||
      renameThreadMutation.isPending ||
      deleteThreadMutation.isPending
    ) {
      return
    }

    createThreadMutation.reset()
    setOpenMenu(null)
    setCreateThreadTarget(workspace)
    setCreateThreadName('New Thread')
  }

  function handleRenameWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      deleteWorkspaceMutation.isPending ||
      renameThreadMutation.isPending ||
      deleteThreadMutation.isPending
    ) {
      return
    }

    renameWorkspaceMutation.reset()
    setOpenMenu(null)
    setRenameTarget({
      kind: 'workspace',
      workspace,
    })
    setRenameValue(workspace.name)
  }

  function handleDeleteWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      deleteWorkspaceMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      renameThreadMutation.isPending ||
      deleteThreadMutation.isPending
    ) {
      return
    }

    deleteWorkspaceMutation.reset()
    setOpenMenu(null)
    setDeleteTarget({
      kind: 'workspace',
      workspace,
    })
  }

  function handleRenameThread(workspaceId: string, thread: Thread) {
    if (
      createThreadMutation.isPending ||
      renameThreadMutation.isPending ||
      deleteThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      deleteWorkspaceMutation.isPending
    ) {
      return
    }

    renameThreadMutation.reset()
    setOpenMenu(null)
    setRenameTarget({
      kind: 'thread',
      workspaceId,
      thread,
    })
    setRenameValue(thread.name)
  }

  function handleDeleteThread(workspaceId: string, thread: Thread) {
    if (
      createThreadMutation.isPending ||
      deleteThreadMutation.isPending ||
      renameThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      deleteWorkspaceMutation.isPending
    ) {
      return
    }

    deleteThreadMutation.reset()
    setOpenMenu(null)
    setDeleteTarget({
      kind: 'thread',
      workspaceId,
      thread,
    })
  }

  function handleCloseRenameDialog() {
    if (renameThreadMutation.isPending || renameWorkspaceMutation.isPending) {
      return
    }

    setRenameTarget(null)
    setRenameValue('')
    renameWorkspaceMutation.reset()
    renameThreadMutation.reset()
  }

  function handleCloseCreateThreadDialog() {
    if (createThreadMutation.isPending) {
      return
    }

    setCreateThreadTarget(null)
    setCreateThreadName('')
    createThreadMutation.reset()
  }

  function handleSubmitRenameDialog() {
    if (!renameTarget || renameThreadMutation.isPending || renameWorkspaceMutation.isPending) {
      return
    }

    const trimmedName = renameValue.trim()
    if (!trimmedName) {
      return
    }

    if (renameTarget.kind === 'workspace') {
      if (trimmedName === renameTarget.workspace.name) {
        return
      }

      renameWorkspaceMutation.mutate({
        workspaceId: renameTarget.workspace.id,
        name: trimmedName,
      })
      return
    }

    if (trimmedName === renameTarget.thread.name) {
      return
    }

    renameThreadMutation.mutate({
      workspaceId: renameTarget.workspaceId,
      threadId: renameTarget.thread.id,
      name: trimmedName,
    })
  }

  function handleSubmitCreateThreadDialog() {
    if (!createThreadTarget || createThreadMutation.isPending) {
      return
    }

    const trimmedName = createThreadName.trim()
    if (!trimmedName) {
      return
    }

    createThreadMutation.mutate({
      workspaceId: createThreadTarget.id,
      name: trimmedName,
    })
  }

  function handleCloseDeleteDialog() {
    if (deleteThreadMutation.isPending || deleteWorkspaceMutation.isPending || createThreadMutation.isPending) {
      return
    }

    setDeleteTarget(null)
    deleteWorkspaceMutation.reset()
    deleteThreadMutation.reset()
  }

  function handleShowMoreThreads(workspaceId: string) {
    setVisibleThreadCountByWorkspace((current) => ({
      ...current,
      [workspaceId]: (current[workspaceId] ?? DEFAULT_VISIBLE_THREADS) + DEFAULT_VISIBLE_THREADS,
    }))
  }

  function handleConfirmDeleteDialog() {
    if (!deleteTarget || deleteThreadMutation.isPending || deleteWorkspaceMutation.isPending) {
      return
    }

    if (deleteTarget.kind === 'workspace') {
      deleteWorkspaceMutation.mutate(deleteTarget.workspace.id)
      return
    }

    deleteThreadMutation.mutate({
      workspaceId: deleteTarget.workspaceId,
      threadId: deleteTarget.thread.id,
    })
  }

  function isWorkspaceMenuOpen(workspaceId: string) {
    return openMenu?.kind === 'workspace' && openMenu.workspaceId === workspaceId
  }

  function isThreadMenuOpen(workspaceId: string, threadId: string) {
    return (
      openMenu?.kind === 'thread' &&
      openMenu.workspaceId === workspaceId &&
      openMenu.threadId === threadId
    )
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
                <div className="web-ide__section-title">Workspaces</div>
                {workspacesQuery.data?.map((workspace, index) => {
                  const threads = threadQueries[index]?.data ?? []
                  const isWorkspaceGroupOpen = isWorkspaceGroupExpanded(workspace.id)
                  const visibleThreadCount =
                    visibleThreadCountByWorkspace[workspace.id] ?? DEFAULT_VISIBLE_THREADS
                  const visibleThreads = threads.slice(0, visibleThreadCount)
                  const remainingThreadCount = Math.max(0, threads.length - visibleThreads.length)
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
                            isWorkspaceGroupOpen
                              ? location.pathname.startsWith(`/workspaces/${workspace.id}`)
                                ? 'workspace-tree__workspace workspace-tree__workspace--expanded workspace-tree__workspace--active'
                                : 'workspace-tree__workspace workspace-tree__workspace--expanded'
                              : location.pathname.startsWith(`/workspaces/${workspace.id}`)
                                ? 'workspace-tree__workspace workspace-tree__workspace--active'
                                : 'workspace-tree__workspace'
                          }
                          onClick={() => handleWorkspaceClick(workspace.id)}
                          type="button"
                        >
                          <span className="workspace-tree__workspace-icon" aria-hidden="true">
                            {isWorkspaceGroupOpen ? <FolderOpenIcon /> : <FolderClosedIcon />}
                          </span>
                          <span className="workspace-tree__workspace-copy">
                            <span className="workspace-tree__workspace-name">{workspace.name}</span>
                            <span className="workspace-tree__workspace-meta">
                              {threads.length} threads · {workspace.runtimeStatus}
                            </span>
                          </span>
                        </button>
                        <div
                          className="workspace-tree__workspace-actions"
                          ref={isWorkspaceMenuOpen(workspace.id) ? menuRef : undefined}
                        >
                          <button
                            aria-expanded={isWorkspaceMenuOpen(workspace.id)}
                            aria-label={`Open actions for ${workspace.name}`}
                            className={
                              isWorkspaceMenuOpen(workspace.id)
                                ? 'workspace-tree__menu-trigger workspace-tree__menu-trigger--active'
                                : 'workspace-tree__menu-trigger'
                            }
                            onClick={(event) => {
                              event.stopPropagation()
                              setOpenMenu((current) =>
                                current?.kind === 'workspace' && current.workspaceId === workspace.id
                                  ? null
                                  : { kind: 'workspace', workspaceId: workspace.id },
                              )
                            }}
                            type="button"
                          >
                            <MoreActionsIcon />
                          </button>
                          {isWorkspaceMenuOpen(workspace.id) ? (
                            <div className="workspace-tree__menu" role="menu">
                              <button
                                className="workspace-tree__menu-item"
                                disabled={createThreadMutation.isPending}
                                onClick={() => handleCreateThreadForWorkspace(workspace)}
                                type="button"
                              >
                                {createThreadMutation.isPending &&
                                createThreadTarget?.id === workspace.id
                                  ? 'Creating…'
                                  : 'New Thread'}
                              </button>
                              <button
                                className="workspace-tree__menu-item"
                                disabled={
                                  renameWorkspaceMutation.isPending || deleteWorkspaceMutation.isPending
                                }
                                onClick={() => handleRenameWorkspace(workspace)}
                                type="button"
                              >
                                Rename
                              </button>
                              <button
                                className="workspace-tree__menu-item workspace-tree__menu-item--danger"
                                disabled={
                                  renameWorkspaceMutation.isPending || deleteWorkspaceMutation.isPending
                                }
                                onClick={() => handleDeleteWorkspace(workspace)}
                                type="button"
                              >
                                {deleteWorkspaceMutation.isPending &&
                                deleteTarget?.kind === 'workspace' &&
                                deleteTarget.workspace.id === workspace.id
                                  ? 'Removing...'
                                  : 'Remove'}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {isWorkspaceGroupOpen ? (
                        <div className="workspace-tree__threads" id={`workspace-threads-${workspace.id}`}>
                          {visibleThreads.map((thread) => (
                            <div className="workspace-tree__thread-row" key={thread.id}>
                              <button
                                className={
                                  activeThreadId === thread.id
                                    ? 'workspace-tree__thread workspace-tree__thread--active'
                                    : 'workspace-tree__thread'
                                }
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
                              <div
                                className="workspace-tree__thread-actions"
                                ref={
                                  isThreadMenuOpen(workspace.id, thread.id) ? menuRef : undefined
                                }
                              >
                                <button
                                  aria-expanded={isThreadMenuOpen(workspace.id, thread.id)}
                                  aria-label={`Open actions for ${thread.name}`}
                                  className={
                                    isThreadMenuOpen(workspace.id, thread.id)
                                      ? 'workspace-tree__menu-trigger workspace-tree__menu-trigger--active'
                                      : 'workspace-tree__menu-trigger'
                                  }
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    setOpenMenu((current) =>
                                      current?.kind === 'thread' &&
                                      current.workspaceId === workspace.id &&
                                      current.threadId === thread.id
                                        ? null
                                        : { kind: 'thread', workspaceId: workspace.id, threadId: thread.id },
                                    )
                                  }}
                                  type="button"
                                >
                                  <MoreActionsIcon />
                                </button>
                                {isThreadMenuOpen(workspace.id, thread.id) ? (
                                  <div className="workspace-tree__menu" role="menu">
                                    <button
                                      className="workspace-tree__menu-item"
                                      disabled={renameThreadMutation.isPending || deleteThreadMutation.isPending}
                                      onClick={() => handleRenameThread(workspace.id, thread)}
                                      type="button"
                                    >
                                      Rename
                                    </button>
                                    <button
                                      className="workspace-tree__menu-item workspace-tree__menu-item--danger"
                                      disabled={renameThreadMutation.isPending || deleteThreadMutation.isPending}
                                      onClick={() => handleDeleteThread(workspace.id, thread)}
                                      type="button"
                                    >
                                      {deleteThreadMutation.isPending &&
                                      deleteTarget?.kind === 'thread' &&
                                      deleteTarget.workspaceId === workspace.id &&
                                      deleteTarget.thread.id === thread.id
                                        ? 'Deleting…'
                                        : 'Delete'}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          {remainingThreadCount > 0 ? (
                            <button
                              className="workspace-tree__show-more"
                              onClick={() => handleShowMoreThreads(workspace.id)}
                              type="button"
                            >
                              Show {Math.min(DEFAULT_VISIBLE_THREADS, remainingThreadCount)} more
                            </button>
                          ) : null}
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

      {renameTarget ? (
        <RenameDialog
          description={
            renameTarget.kind === 'workspace'
              ? 'Enter a new name for this workspace folder.'
              : 'Enter a new name for this thread.'
          }
          error={
            renameTarget.kind === 'workspace'
              ? renameWorkspaceMutation.error
                ? getErrorMessage(renameWorkspaceMutation.error)
                : null
              : renameThreadMutation.error
                ? getErrorMessage(renameThreadMutation.error)
                : null
          }
          isPending={
            renameTarget.kind === 'workspace'
              ? renameWorkspaceMutation.isPending
              : renameThreadMutation.isPending
          }
          onChange={setRenameValue}
          onClose={handleCloseRenameDialog}
          onSubmit={handleSubmitRenameDialog}
          fieldLabel={renameTarget.kind === 'workspace' ? 'Workspace Name' : 'Thread Name'}
          isSubmitDisabled={
            !renameValue.trim() ||
            (renameTarget.kind === 'workspace'
              ? renameValue.trim() === renameTarget.workspace.name
              : renameValue.trim() === renameTarget.thread.name)
          }
          placeholder={
            renameTarget.kind === 'workspace' ? renameTarget.workspace.name : renameTarget.thread.name
          }
          submitLabel={renameTarget.kind === 'workspace' ? 'Save Workspace' : 'Save Thread'}
          title={renameTarget.kind === 'workspace' ? 'Rename Workspace' : 'Rename Thread'}
          value={renameValue}
        />
      ) : null}
      {createThreadTarget ? (
        <RenameDialog
          description={`Create a new thread in ${createThreadTarget.name}.`}
          error={createThreadMutation.error ? getErrorMessage(createThreadMutation.error) : null}
          fieldLabel="Thread Name"
          isPending={createThreadMutation.isPending}
          isSubmitDisabled={!createThreadName.trim()}
          onChange={setCreateThreadName}
          onClose={handleCloseCreateThreadDialog}
          onSubmit={handleSubmitCreateThreadDialog}
          placeholder="New Thread"
          submitLabel="Create Thread"
          title="Create Thread"
          value={createThreadName}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          confirmLabel={deleteTarget.kind === 'workspace' ? 'Remove Workspace' : 'Delete Thread'}
          description={
            deleteTarget.kind === 'workspace'
              ? 'This removes the workspace from the sidebar registry and clears its loaded thread list from the UI.'
              : 'This will remove the thread from the current workspace list.'
          }
          error={
            deleteTarget.kind === 'workspace'
              ? deleteWorkspaceMutation.error
                ? getErrorMessage(deleteWorkspaceMutation.error)
                : null
              : deleteThreadMutation.error
                ? getErrorMessage(deleteThreadMutation.error)
                : null
          }
          isPending={
            deleteTarget.kind === 'workspace'
              ? deleteWorkspaceMutation.isPending
              : deleteThreadMutation.isPending
          }
          onClose={handleCloseDeleteDialog}
          onConfirm={handleConfirmDeleteDialog}
          subject={deleteTarget.kind === 'workspace' ? deleteTarget.workspace.name : deleteTarget.thread.name}
          title={deleteTarget.kind === 'workspace' ? 'Remove Workspace?' : 'Delete Thread?'}
        />
      ) : null}
    </div>
  )
}
