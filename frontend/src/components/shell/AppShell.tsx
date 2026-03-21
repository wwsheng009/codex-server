import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ConfirmDialog } from '../ui/ConfirmDialog'
import { InlineNotice } from '../ui/InlineNotice'
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
  PlusIcon,
  RailIcon,
  RailIconButton,
  ResizeHandle,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
} from '../ui/RailControls'
import { createThread, deleteThread, listThreads, renameThread } from '../../features/threads/api'
import { deleteWorkspace, listWorkspaces, renameWorkspace, restartWorkspace } from '../../features/workspaces/api'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useSessionStore } from '../../stores/session-store'
import { useUIStore } from '../../stores/ui-store'
import { getSelectedThreadIdForWorkspace } from '../../stores/session-store-utils'
import type { ServerEvent, Thread, ThreadDetail, Workspace } from '../../types/api'
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

const DEFAULT_VISIBLE_THREADS = 8
const RUNNING_THREAD_EVENT_METHODS = new Set([
  'turn/started',
  'item/started',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/summaryTextDelta',
  'item/reasoning/textDelta',
  'item/commandExecution/outputDelta',
])
const STOPPED_THREAD_EVENT_METHODS = new Set([
  'turn/completed',
  'thread/closed',
  'thread/archived',
  'thread/unarchived',
])

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

function statusIsInterruptible(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(normalized)
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function threadStatusFromEvent(event?: ServerEvent) {
  if (!event || event.method !== 'thread/status/changed') {
    return ''
  }

  if (typeof event.payload !== 'object' || event.payload === null) {
    return ''
  }

  const payload = event.payload as Record<string, unknown>
  const status = payload.status
  if (typeof status !== 'object' || status === null) {
    return ''
  }

  return stringField((status as Record<string, unknown>).type)
}

function threadIsRunning(thread: Thread, events: ServerEvent[] | undefined) {
  const latestEvent = events?.[events.length - 1]
  if (latestEvent) {
    const nextStatus = threadStatusFromEvent(latestEvent)
    if (nextStatus) {
      return statusIsInterruptible(nextStatus)
    }

    if (STOPPED_THREAD_EVENT_METHODS.has(latestEvent.method)) {
      return false
    }

    if (RUNNING_THREAD_EVENT_METHODS.has(latestEvent.method)) {
      return true
    }
  }

  return statusIsInterruptible(thread.status)
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
  const [visibleThreadCountByWorkspace, setVisibleThreadCountByWorkspace] = useState<Record<string, number>>({})
  const [refreshingWorkspaceIds, setRefreshingWorkspaceIds] = useState<Set<string>>(new Set())
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeThread = useSessionStore((state) => state.removeThread)
  const removeWorkspace = useSessionStore((state) => state.removeWorkspace)
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId)
  const selectedThreadIdByWorkspace = useSessionStore((state) => state.selectedThreadIdByWorkspace)
  const eventsByThread = useSessionStore((state) => state.eventsByThread)
  const workspaceRestartStateById = useUIStore((state) => state.workspaceRestartStateById)
  const markWorkspaceRestarting = useUIStore((state) => state.markWorkspaceRestarting)
  const markWorkspaceRestarted = useUIStore((state) => state.markWorkspaceRestarted)
  const clearWorkspaceRestartState = useUIStore((state) => state.clearWorkspaceRestartState)

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

  async function invalidateWorkspaceRuntimeQueries(workspaceId: string) {
    await Promise.all([
      invalidateWorkspaceQueries(),
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
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

  const restartWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => restartWorkspace(workspaceId),
    onMutate: (workspaceId) => {
      markWorkspaceRestarting(workspaceId)
    },
    onSuccess: async (workspace) => {
      markWorkspaceRestarted(workspace.id)
      setOpenMenu(null)
      queryClient.setQueryData<Workspace[]>(['shell-workspaces'], (current) =>
        updateWorkspaceInList(current, workspace),
      )
      queryClient.setQueryData<Workspace[]>(['workspaces'], (current) =>
        updateWorkspaceInList(current, workspace),
      )
      queryClient.setQueryData<Workspace>(['workspace', workspace.id], workspace)
    },
    onError: (_, workspaceId) => {
      clearWorkspaceRestartState(workspaceId)
    },
    onSettled: async (_, __, workspaceId) => {
      await invalidateWorkspaceRuntimeQueries(workspaceId)
    },
  })

  const createThreadMutation = useMutation({
    mutationFn: ({ workspaceId }: { workspaceId: string }) => createThread(workspaceId),
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

    setWorkspaceThreadGroupsCollapsed((current) => ({
      ...current,
      [workspaceId]: isExpanded,
    }))
  }

  function handleCreateThreadForWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      restartWorkspaceMutation.isPending ||
      deleteWorkspaceMutation.isPending ||
      renameThreadMutation.isPending ||
      deleteThreadMutation.isPending
    ) {
      return
    }

    createThreadMutation.reset()
    setOpenMenu(null)
    createThreadMutation.mutate({
      workspaceId: workspace.id,
    })
  }

  function handleRenameWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      restartWorkspaceMutation.isPending ||
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

  function handleRestartWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      renameWorkspaceMutation.isPending ||
      restartWorkspaceMutation.isPending ||
      deleteWorkspaceMutation.isPending ||
      renameThreadMutation.isPending ||
      deleteThreadMutation.isPending
    ) {
      return
    }

    restartWorkspaceMutation.reset()
    setOpenMenu(null)
    restartWorkspaceMutation.mutate(workspace.id)
  }

  async function handleRefreshWorkspace(workspaceId: string) {
    setOpenMenu(null)
    setRefreshingWorkspaceIds((current) => new Set([...current, workspaceId]))
    try {
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.refetchQueries({ queryKey: ['shell-threads', workspaceId] }),
        queryClient.refetchQueries({ queryKey: ['workspace-detail', workspaceId] }),
        queryClient.refetchQueries({ queryKey: ['workspaces'] }),
        queryClient.refetchQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.refetchQueries({ queryKey: ['approvals', workspaceId] }),
      ])
    } finally {
      setTimeout(() => {
        setRefreshingWorkspaceIds((current) => {
          const next = new Set(current)
          next.delete(workspaceId)
          return next
        })
      }, 1000) // Keep the visual feedback for at least 1s
    }
  }

  function handleDeleteWorkspace(workspace: Workspace) {
    if (
      createThreadMutation.isPending ||
      restartWorkspaceMutation.isPending ||
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

  function handleShowLessThreads(workspaceId: string) {
    setVisibleThreadCountByWorkspace((current) => ({
      ...current,
      [workspaceId]: DEFAULT_VISIBLE_THREADS,
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
                {restartWorkspaceMutation.error ? (
                  <InlineNotice
                    details={getErrorMessage(restartWorkspaceMutation.error)}
                    dismissible
                    noticeKey={`sidebar-restart-workspace-${restartWorkspaceMutation.error instanceof Error ? restartWorkspaceMutation.error.message : 'unknown'}`}
                    onRetry={() => {
                      if (restartWorkspaceMutation.variables) {
                        restartWorkspaceMutation.mutate(restartWorkspaceMutation.variables)
                      }
                    }}
                    title="Failed To Restart Workspace"
                    tone="error"
                  >
                    {getErrorMessage(restartWorkspaceMutation.error)}
                  </InlineNotice>
                ) : null}
                {createThreadMutation.error ? (
                  <InlineNotice
                    details={getErrorMessage(createThreadMutation.error)}
                    dismissible
                    noticeKey={`sidebar-create-thread-${createThreadMutation.error instanceof Error ? createThreadMutation.error.message : 'unknown'}`}
                    onRetry={() => {
                      if (createThreadMutation.variables?.workspaceId) {
                        createThreadMutation.mutate(createThreadMutation.variables)
                      }
                    }}
                    title="Failed To Create Thread"
                    tone="error"
                  >
                    {getErrorMessage(createThreadMutation.error)}
                  </InlineNotice>
                ) : null}
                {workspacesQuery.data?.map((workspace, index) => {
                  const threads = threadQueries[index]?.data ?? []
                  const restartPhase = workspaceRestartStateById[workspace.id]
                  const visualRuntimeStatus =
                    restartPhase === 'restarting' ? 'restarting' : workspace.runtimeStatus
                  const isWorkspaceGroupOpen = isWorkspaceGroupExpanded(workspace.id)
                  const visibleThreadCount =
                    visibleThreadCountByWorkspace[workspace.id] ?? DEFAULT_VISIBLE_THREADS
                  const visibleThreads = threads.slice(0, visibleThreadCount)
                  const remainingThreadCount = Math.max(0, threads.length - visibleThreads.length)
                  const canShowLessThreads =
                    visibleThreadCount > DEFAULT_VISIBLE_THREADS && threads.length > DEFAULT_VISIBLE_THREADS
                  const activeThreadId = getSelectedThreadIdForWorkspace(
                    {
                      selectedWorkspaceId,
                      selectedThreadIdByWorkspace,
                    },
                    workspace.id,
                  )
                  const workspaceRouteActive = location.pathname.startsWith(`/workspaces/${workspace.id}`)

                  return (
                    <section
                      className={[
                        'workspace-tree__group',
                        restartPhase === 'restarting' ? 'workspace-tree__group--restarting' : '',
                        restartPhase === 'restarted' ? 'workspace-tree__group--restarted' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      key={workspace.id}
                    >
                      <div className="workspace-tree__group-header">
                        <button
                          aria-controls={`workspace-threads-${workspace.id}`}
                          aria-expanded={isWorkspaceGroupOpen}
                          aria-busy={restartPhase === 'restarting'}
                          className={[
                            'workspace-tree__workspace',
                            isWorkspaceGroupOpen ? 'workspace-tree__workspace--expanded' : '',
                            location.pathname.startsWith(`/workspaces/${workspace.id}`)
                              ? 'workspace-tree__workspace--active'
                              : '',
                            restartPhase === 'restarting' ? 'workspace-tree__workspace--restarting' : '',
                            restartPhase === 'restarted' ? 'workspace-tree__workspace--restarted' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => handleWorkspaceClick(workspace.id)}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={[
                              'workspace-tree__workspace-icon',
                              restartPhase === 'restarting'
                                ? 'workspace-tree__workspace-icon--restarting'
                                : '',
                              restartPhase === 'restarted'
                                ? 'workspace-tree__workspace-icon--restarted'
                                : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                          >
                            {isWorkspaceGroupOpen ? <FolderOpenIcon /> : <FolderClosedIcon />}
                          </span>
                          <span className="workspace-tree__workspace-copy">
                            <span className="workspace-tree__workspace-name">{workspace.name}</span>
                            <span className="workspace-tree__workspace-meta">
                              {threads.length} threads · {visualRuntimeStatus}
                            </span>
                            {restartPhase || refreshingWorkspaceIds.has(workspace.id) ? (
                              <span
                                className={[
                                  'workspace-tree__workspace-runtime',
                                  restartPhase === 'restarting' || refreshingWorkspaceIds.has(workspace.id)
                                    ? 'workspace-tree__workspace-runtime--restarting'
                                    : 'workspace-tree__workspace-runtime--restarted',
                                ].join(' ')}
                              >
                                {refreshingWorkspaceIds.has(workspace.id)
                                  ? 'Refreshing...'
                                  : restartPhase === 'restarting'
                                    ? 'Restarting runtime'
                                    : 'Runtime refreshed'}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <div
                          className="workspace-tree__workspace-actions"
                          ref={isWorkspaceMenuOpen(workspace.id) ? menuRef : undefined}
                        >
                          <button
                            aria-label={`Create thread in ${workspace.name}`}
                            className="workspace-tree__create-trigger"
                            disabled={createThreadMutation.isPending || restartPhase === 'restarting'}
                            onClick={() => handleCreateThreadForWorkspace(workspace)}
                            title={`Create thread in ${workspace.name}`}
                            type="button"
                          >
                            <PlusIcon />
                          </button>
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
                                onClick={() => void handleRefreshWorkspace(workspace.id)}
                                type="button"
                              >
                                Refresh
                              </button>
                              <button
                                className="workspace-tree__menu-item"
                                disabled={
                                  restartPhase === 'restarting' ||
                                  renameWorkspaceMutation.isPending ||
                                  restartWorkspaceMutation.isPending ||
                                  deleteWorkspaceMutation.isPending
                                }
                                onClick={() => handleRestartWorkspace(workspace)}
                                type="button"
                              >
                                {restartWorkspaceMutation.isPending &&
                                restartWorkspaceMutation.variables === workspace.id
                                  ? 'Restarting…'
                                  : 'Restart'}
                              </button>
                              <button
                                className="workspace-tree__menu-item"
                                disabled={
                                  restartPhase === 'restarting' ||
                                  renameWorkspaceMutation.isPending ||
                                  restartWorkspaceMutation.isPending ||
                                  deleteWorkspaceMutation.isPending
                                }
                                onClick={() => handleRenameWorkspace(workspace)}
                                type="button"
                              >
                                Rename
                              </button>
                              <button
                                className="workspace-tree__menu-item workspace-tree__menu-item--danger"
                                disabled={
                                  restartPhase === 'restarting' ||
                                  renameWorkspaceMutation.isPending ||
                                  restartWorkspaceMutation.isPending ||
                                  deleteWorkspaceMutation.isPending
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
                          {visibleThreads.map((thread) => {
                            const running = threadIsRunning(thread, eventsByThread[thread.id])
                            const activityTone = running
                              ? workspaceRouteActive &&
                                selectedWorkspaceId === workspace.id &&
                                activeThreadId === thread.id
                                ? 'foreground'
                                : 'background'
                              : null

                            return (
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
                                <span className="workspace-tree__thread-title-shell">
                                  {activityTone ? (
                                    <span
                                      aria-hidden="true"
                                      className={
                                        activityTone === 'foreground'
                                          ? 'workspace-tree__thread-activity workspace-tree__thread-activity--foreground'
                                          : 'workspace-tree__thread-activity workspace-tree__thread-activity--background'
                                      }
                                    />
                                  ) : null}
                                  <span className="workspace-tree__thread-title">{thread.name}</span>
                                </span>
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
                            )
                          })}
                          {remainingThreadCount > 0 || canShowLessThreads ? (
                            <div className="workspace-tree__thread-pagination">
                              {remainingThreadCount > 0 ? (
                                <button
                                  className="workspace-tree__show-more"
                                  onClick={() => handleShowMoreThreads(workspace.id)}
                                  type="button"
                                >
                                  Show {Math.min(DEFAULT_VISIBLE_THREADS, remainingThreadCount)} more
                                </button>
                              ) : null}
                              {canShowLessThreads ? (
                                <button
                                  className="workspace-tree__show-more"
                                  onClick={() => handleShowLessThreads(workspace.id)}
                                  type="button"
                                >
                                  Show less
                                </button>
                              ) : null}
                            </div>
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
            <RailIconButton
              aria-label={
                isMobileViewport ? 'Close navigation' : isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
              }
              className="web-ide__sidebar-toggle"
              onClick={() => {
                if (isMobileViewport) {
                  setIsMobileSidebarOpen(false)
                  return
                }

                setIsSidebarCollapsed((current) => !current)
              }}
              title={isMobileViewport ? 'Close navigation' : isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isMobileViewport ? <ChevronLeftIcon /> : isSidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </RailIconButton>
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
