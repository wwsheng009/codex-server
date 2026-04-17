import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { CommandPalette } from './CommandPalette'
import type { CommandPaletteItem } from './commandPaletteTypes'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { InlineNotice } from '../ui/InlineNotice'
import { RenameDialog } from '../ui/RenameDialog'
import { WorkspaceTreeThreadRow } from './WorkspaceTreeThreadRow'
import { layoutConfig } from '../../lib/layout-config'
import { getErrorMessage } from '../../lib/error-utils'
import { buildWorkspaceThreadRoute } from '../../lib/thread-routes'
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
  ContextIcon,
  FeedIcon,
  FolderClosedIcon,
  FolderOpenIcon,
  MoreActionsIcon,
  PlusIcon,
  RailIcon,
  RailIconButton,
  ResizeHandle,
  SendIcon,
  SettingsIcon,
  SparkIcon,
  TerminalIcon,
} from '../ui/RailControls'
import { createThread, deleteThread, listThreadsPage, renameThread } from '../../features/threads/api'
import {
  removeThreadFromThreadCaches,
  syncThreadIntoThreadCaches,
} from '../../features/threads/cache'
import { removeThreadApprovalsFromList } from '../../features/approvals/cache'
import { refetchApprovalsQueryIfNeeded } from '../../features/approvals/sync'
import { deleteWorkspace, listWorkspaces, renameWorkspace, restartWorkspace } from '../../features/workspaces/api'
import { useMediaQuery } from '../../hooks/useMediaQuery'
import { useSessionStore } from '../../stores/session-store'
import { useUIStore } from '../../stores/ui-store'
import { getSelectedThreadIdForWorkspace } from '../../stores/session-store-utils'
import type {
  PendingApproval,
  Thread,
  ThreadListPage,
  Workspace,
} from '../../types/api'
import { formatLocalizedStatusLabel } from '../../i18n/display'
import { formatRelativeTimeShort } from '../workspace/timeline-utils'
import { AppMenuBar } from './AppMenuBar'
import type {
  CreateThreadMutationInput,
  DeleteTarget,
  DeleteThreadMutationInput,
  RenameTarget,
  RenameThreadMutationInput,
  RenameWorkspaceMutationInput,
  SidebarMenuState,
} from './appShellTypes'
import { getActiveLocale, i18n } from '../../i18n/runtime'

function getPrimaryNavItems() {
  return [
    {
      section: 'workspaces',
      to: '/workspaces',
      label: i18n._({ id: 'Workspaces', message: 'Workspaces' }),
      icon: AppGridIcon,
    },
    {
      section: 'automations',
      to: '/automations',
      label: i18n._({ id: 'Automations', message: 'Automations' }),
      icon: AutomationIcon,
    },
    {
      section: 'notification-center',
      to: '/notification-center',
      label: i18n._({ id: 'Notification Center', message: 'Notification Center' }),
      icon: ContextIcon,
    },
    {
      section: 'bots',
      to: '/bots',
      label: i18n._({ id: 'Bots', message: 'Bots' }),
      icon: FeedIcon,
    },
    {
      section: 'bots-outbound',
      to: '/bots/outbound',
      label: i18n._({ id: 'Bot Outbound', message: 'Bot Outbound' }),
      icon: SendIcon,
    },
    {
      section: 'skills',
      to: '/skills',
      label: i18n._({ id: 'Skills', message: 'Skills' }),
      icon: SparkIcon,
    },
    {
      section: 'runtime',
      to: '/runtime',
      label: i18n._({ id: 'Runtime', message: 'Runtime' }),
      icon: TerminalIcon,
    },
  ] as const
}

const DEFAULT_VISIBLE_THREADS = 8
function updateWorkspaceInList(current: Workspace[] | undefined, workspace: Workspace) {
  if (!current?.length) {
    return current
  }

  return current.map((item) => (item.id === workspace.id ? workspace : item))
}

function getWorkspaceRuntimeTone(status: string) {
  const normalized = status.trim().toLowerCase().replace(/[\s_-]+/g, '')

  if (['ready', 'active', 'connected'].includes(normalized)) {
    return 'success'
  }

  if (['restarting', 'starting', 'loading', 'pending', 'unknown'].includes(normalized)) {
    return 'warning'
  }

  return 'danger'
}

export function AppShell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const activeLocale = getActiveLocale()
  const isMobileViewport = useMediaQuery('(max-width: 900px)')
  const isSettingsRoute = location.pathname.startsWith('/settings')
  const shouldDeferOffscreenWorkspaceThreadQueries =
    location.pathname.startsWith('/workspaces/')
  const [isSidebarResizing, setIsSidebarResizing] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readLeftSidebarCollapsed)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
  const [workspaceThreadGroupsCollapsed, setWorkspaceThreadGroupsCollapsed] = useState(
    readWorkspaceThreadGroupsCollapsed,
  )
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(readLeftSidebarWidth)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [openMenu, setOpenMenu] = useState<SidebarMenuState>(null)
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [visibleThreadCountByWorkspace, setVisibleThreadCountByWorkspace] = useState<Record<string, number>>({})
  const [refreshingWorkspaceIds, setRefreshingWorkspaceIds] = useState<Set<string>>(new Set())
  const [areDeferredWorkspaceThreadQueriesEnabled, setAreDeferredWorkspaceThreadQueriesEnabled] =
    useState(() => !shouldDeferOffscreenWorkspaceThreadQueries)
  const sidebarResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeThread = useSessionStore((state) => state.removeThread)
  const removeWorkspace = useSessionStore((state) => state.removeWorkspace)
  const selectedWorkspaceId = useSessionStore((state) => state.selectedWorkspaceId)
  const selectedThreadIdByWorkspace = useSessionStore((state) => state.selectedThreadIdByWorkspace)
  const connectionByWorkspace = useSessionStore((state) => state.connectionByWorkspace)
  const workspaceRestartStateById = useUIStore((state) => state.workspaceRestartStateById)
  const markWorkspaceRestarting = useUIStore((state) => state.markWorkspaceRestarting)
  const markWorkspaceRestarted = useUIStore((state) => state.markWorkspaceRestarted)
  const clearWorkspaceRestartState = useUIStore((state) => state.clearWorkspaceRestartState)

  const workspacesQuery = useQuery({
    queryKey: ['shell-workspaces'],
    queryFn: listWorkspaces,
  })

  const threadQueries = useQueries({
    queries: (workspacesQuery.data ?? []).map((workspace) => {
      const requestedThreadCount =
        visibleThreadCountByWorkspace[workspace.id] ?? DEFAULT_VISIBLE_THREADS
      const workspaceRouteActive = location.pathname.startsWith(`/workspaces/${workspace.id}`)
      const preferCachedThreadPage = !refreshingWorkspaceIds.has(workspace.id)
      const shouldLoadWorkspaceThreads =
        !isSettingsRoute && (isWorkspaceGroupExpanded(workspace.id) || workspaceRouteActive)
      const shouldEnableThreadQuery =
        shouldLoadWorkspaceThreads &&
        (workspaceRouteActive || areDeferredWorkspaceThreadQueriesEnabled)

      return {
        queryKey: [
          'shell-threads',
          workspace.id,
          {
            archived: false,
            limit: requestedThreadCount,
            preferCached: preferCachedThreadPage,
            sortKey: 'created_at',
          },
        ],
        queryFn: () =>
          listThreadsPage(workspace.id, {
            archived: false,
            limit: requestedThreadCount,
            preferCached: preferCachedThreadPage,
            sortKey: 'created_at',
          }),
        enabled: shouldEnableThreadQuery,
        placeholderData: (previous: ThreadListPage | undefined) => previous,
        staleTime: 30_000,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false,
      }
    }),
  })

  useEffect(() => {
    if (!shouldDeferOffscreenWorkspaceThreadQueries) {
      setAreDeferredWorkspaceThreadQueriesEnabled(true)
      return
    }

    setAreDeferredWorkspaceThreadQueriesEnabled(false)
    if (typeof window === 'undefined') {
      setAreDeferredWorkspaceThreadQueriesEnabled(true)
      return
    }

    const enableDeferredQueries = () => {
      setAreDeferredWorkspaceThreadQueriesEnabled(true)
    }

    if (typeof window.requestIdleCallback === 'function') {
      const idleCallbackId = window.requestIdleCallback(enableDeferredQueries, {
        timeout: 800,
      })
      return () => {
        window.cancelIdleCallback(idleCallbackId)
      }
    }

    const timeoutId = window.setTimeout(enableDeferredQueries, 250)
    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [shouldDeferOffscreenWorkspaceThreadQueries])

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
    setIsCommandPaletteOpen(false)
  }, [location.pathname])

  useEffect(() => {
    function handleCommandPaletteKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setIsCommandPaletteOpen(true)
      }
    }

    window.addEventListener('keydown', handleCommandPaletteKeyDown)
    return () => {
      window.removeEventListener('keydown', handleCommandPaletteKeyDown)
    }
  }, [])

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
    ])
  }

  const renameWorkspaceMutation = useMutation({
    mutationFn: ({ workspaceId, name }: RenameWorkspaceMutationInput) =>
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
      queryClient.setQueryData<PendingApproval[]>(['approvals', workspace.id], [])
    },
    onError: (_, workspaceId) => {
      clearWorkspaceRestartState(workspaceId)
    },
    onSettled: async (_, __, workspaceId) => {
      await invalidateWorkspaceRuntimeQueries(workspaceId)
    },
  })

  const createThreadMutation = useMutation({
    mutationFn: ({ workspaceId }: CreateThreadMutationInput) => createThread(workspaceId),
    onSuccess: async (thread) => {
      syncThreadIntoThreadCaches(queryClient, thread.workspaceId, thread)
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
      navigate(buildWorkspaceThreadRoute(thread.workspaceId, thread.id))
    },
  })

  const renameThreadMutation = useMutation({
    mutationFn: ({ workspaceId, threadId, name }: RenameThreadMutationInput) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async (thread) => {
      setOpenMenu(null)
      setRenameTarget(null)
      setRenameValue('')
      syncThreadIntoThreadCaches(queryClient, thread.workspaceId, thread)
      await invalidateThreadQueries(thread.workspaceId)
    },
  })

  const deleteThreadMutation = useMutation({
    mutationFn: ({ workspaceId, threadId }: DeleteThreadMutationInput) =>
      deleteThread(workspaceId, threadId),
    onSuccess: async (_, variables) => {
      const currentThreadId = getSelectedThreadIdForWorkspace(
        {
          selectedWorkspaceId,
          selectedThreadIdByWorkspace,
        },
        variables.workspaceId,
      )

      const cachedShellThreads = queryClient
        .getQueriesData<ThreadListPage>({ queryKey: ['shell-threads', variables.workspaceId] })
        .reduce<Thread[]>(
          (largestPage, [, page]) =>
            page?.data && page.data.length > largestPage.length ? page.data : largestPage,
          [],
        )
      const remainingThreads = (
        queryClient.getQueryData<Thread[]>(['threads', variables.workspaceId]) ?? cachedShellThreads
      ).filter((thread) => thread.id !== variables.threadId)

      removeThreadFromThreadCaches(queryClient, variables.workspaceId, variables.threadId)
      queryClient.setQueryData<PendingApproval[]>(
        ['approvals', variables.workspaceId],
        (current: PendingApproval[] | undefined) =>
          removeThreadApprovalsFromList(current, variables.threadId),
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
        refetchApprovalsQueryIfNeeded({
          connectionState: connectionByWorkspace[workspaceId],
          queryClient,
          workspaceId,
        }),
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
  const commandPaletteShortcutLabel = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return 'Ctrl K'
    }

    return /mac/i.test(navigator.platform) ? '⌘K' : 'Ctrl K'
  }, [])
  const threadsByWorkspace = useMemo(
    () =>
      new Map(
        (workspacesQuery.data ?? []).map((workspace, index) => [
          workspace.id,
          threadQueries[index]?.data?.data ?? [],
        ]),
      ),
    [threadQueries, workspacesQuery.data],
  )
  const selectedWorkspace = useMemo(
    () => (workspacesQuery.data ?? []).find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspacesQuery.data],
  )
  const currentSection = location.pathname.startsWith('/workspaces')
    ? 'workspaces'
    : location.pathname.startsWith('/automations')
      ? 'automations'
      : location.pathname.startsWith('/bots/outbound')
        ? 'bots-outbound'
      : location.pathname.startsWith('/bots')
        ? 'bots'
      : location.pathname.startsWith('/skills')
        ? 'skills'
        : location.pathname.startsWith('/runtime')
          ? 'runtime'
          : location.pathname.startsWith('/settings')
            ? 'settings'
            : 'other'
  const primaryNav = getPrimaryNavItems()
  const paletteItems = useMemo(() => {
    const nextItems: CommandPaletteItem[] = [
      {
        id: 'nav-workspaces',
        group: 'Nav',
        title: i18n._({ id: 'Open Workspaces', message: 'Open Workspaces' }),
        subtitle: i18n._({
          id: 'Go to the workspace registry',
          message: 'Go to the workspace registry',
        }),
        keywords: ['workspace', 'registry', 'workbench'],
        priority: currentSection === 'workspaces' ? 40 : 10,
        onSelect: () => navigate('/workspaces'),
      },
      {
        id: 'nav-automations',
        group: 'Nav',
        title: i18n._({ id: 'Open Automations', message: 'Open Automations' }),
        subtitle: i18n._({
          id: 'Browse automation runs and templates',
          message: 'Browse automation runs and templates',
        }),
        keywords: ['automation', 'jobs', 'scheduler'],
        priority: currentSection === 'automations' ? 40 : 11,
        onSelect: () => navigate('/automations'),
      },
      {
        id: 'nav-bots',
        group: 'Nav',
        title: i18n._({ id: 'Open Bots', message: 'Open Bots' }),
        subtitle: i18n._({
          id: 'Manage bot integrations and chat bindings',
          message: 'Manage bot integrations and chat bindings',
        }),
        keywords: ['bots', 'telegram', 'webhook', 'integrations'],
        priority: currentSection === 'bots' ? 40 : 12,
        onSelect: () => navigate('/bots'),
      },
      {
        id: 'nav-bots-outbound',
        group: 'Nav',
        title: i18n._({ id: 'Open Bot Outbound', message: 'Open Bot Outbound' }),
        subtitle: i18n._({
          id: 'Manage proactive recipients and outbound deliveries',
          message: 'Manage proactive recipients and outbound deliveries',
        }),
        keywords: ['bots', 'outbound', 'proactive', 'recipients', 'deliveries', 'operations'],
        priority: currentSection === 'bots-outbound' ? 40 : 13,
        onSelect: () => navigate('/bots/outbound'),
      },
      {
        id: 'nav-skills',
        group: 'Nav',
        title: i18n._({ id: 'Open Skills', message: 'Open Skills' }),
        subtitle: i18n._({
          id: 'Browse installed workspace skills',
          message: 'Browse installed workspace skills',
        }),
        keywords: ['skills', 'catalog', 'directory'],
        priority: currentSection === 'skills' ? 40 : 14,
        onSelect: () => navigate('/skills'),
      },
      {
        id: 'nav-runtime',
        group: 'Nav',
        title: i18n._({ id: 'Open Runtime', message: 'Open Runtime' }),
        subtitle: i18n._({
          id: 'Inspect runtime inventory and actions',
          message: 'Inspect runtime inventory and actions',
        }),
        keywords: ['runtime', 'catalog', 'models', 'plugins'],
        priority: currentSection === 'runtime' ? 40 : 15,
        onSelect: () => navigate('/runtime'),
      },
      {
        id: 'nav-settings-general',
        group: 'Nav',
        title: i18n._({
          id: 'Open Settings: General',
          message: 'Open Settings: General',
        }),
        subtitle: i18n._({
          id: 'Account, login, and usage limits',
          message: 'Account, login, and usage limits',
        }),
        keywords: ['settings', 'general', 'account', 'login'],
        priority: currentSection === 'settings' ? 42 : 15,
        onSelect: () => navigate('/settings/general'),
      },
      {
        id: 'nav-settings-appearance',
        group: 'Nav',
        title: i18n._({
          id: 'Open Settings: Appearance',
          message: 'Open Settings: Appearance',
        }),
        subtitle: i18n._({
          id: 'Theme, density, and motion preferences',
          message: 'Theme, density, and motion preferences',
        }),
        keywords: ['settings', 'appearance', 'theme', 'motion'],
        priority: currentSection === 'settings' ? 43 : 16,
        onSelect: () => navigate('/settings/appearance'),
      },
    ]

    if (selectedWorkspace) {
      nextItems.unshift(
        {
          id: `action-new-thread-${selectedWorkspace.id}`,
          group: 'Action',
          title: i18n._({
            id: 'New Thread in {workspace}',
            message: 'New Thread in {workspace}',
            values: { workspace: selectedWorkspace.name },
          }),
          subtitle: selectedWorkspace.rootPath,
          keywords: ['new thread', 'create thread', 'workspace'],
          priority: currentSection === 'workspaces' ? 0 : 4,
          shortcut: 'Enter',
          onSelect: () => handleCreateThreadForWorkspace(selectedWorkspace),
        },
        {
          id: `action-refresh-workspace-${selectedWorkspace.id}`,
          group: 'Action',
          title: i18n._({
            id: 'Refresh {workspace}',
            message: 'Refresh {workspace}',
            values: { workspace: selectedWorkspace.name },
          }),
          subtitle: i18n._({
            id: 'Refetch threads, workspace state, and approvals',
            message: 'Refetch threads, workspace state, and approvals',
          }),
          keywords: ['refresh', 'reload', 'sync', 'workspace'],
          priority: currentSection === 'workspaces' ? 1 : 5,
          onSelect: () => void handleRefreshWorkspace(selectedWorkspace.id),
        },
        {
          id: `nav-current-workspace-${selectedWorkspace.id}`,
          group: 'Nav',
          title: i18n._({
            id: 'Open {workspace}',
            message: 'Open {workspace}',
            values: { workspace: selectedWorkspace.name },
          }),
          subtitle: selectedWorkspace.rootPath,
          keywords: ['open workspace', 'current workspace', selectedWorkspace.name],
          priority: currentSection === 'workspaces' ? 2 : 16,
          onSelect: () => {
            setSelectedWorkspace(selectedWorkspace.id)
            navigate(
              buildWorkspaceThreadRoute(
                selectedWorkspace.id,
                getSelectedThreadIdForWorkspace(
                  {
                    selectedWorkspaceId,
                    selectedThreadIdByWorkspace,
                  },
                  selectedWorkspace.id,
                ),
              ),
            )
          },
        },
      )
    }

    const recentWorkspaces = [...(workspacesQuery.data ?? [])]
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
      .slice(0, 5)

    recentWorkspaces.forEach((workspace, index) => {
      nextItems.push({
        id: `recent-workspace-${workspace.id}`,
        group: 'Recent',
        title: workspace.name,
        subtitle: workspace.rootPath,
        keywords: ['recent workspace', workspace.name, workspace.rootPath],
        priority: 100 + index,
        onSelect: () => {
          setSelectedWorkspace(workspace.id)
          navigate(
            buildWorkspaceThreadRoute(
              workspace.id,
              getSelectedThreadIdForWorkspace(
                {
                  selectedWorkspaceId,
                  selectedThreadIdByWorkspace,
                },
                workspace.id,
              ),
            ),
          )
        },
      })
    })

    const recentThreads = [...(workspacesQuery.data ?? [])]
      .flatMap((workspace) =>
        (threadsByWorkspace.get(workspace.id) ?? []).map((thread) => ({
          workspace,
          thread,
        })),
      )
      .sort((left, right) => new Date(right.thread.updatedAt).getTime() - new Date(left.thread.updatedAt).getTime())
      .slice(0, 6)

    recentThreads.forEach(({ workspace, thread }, index) => {
      nextItems.push({
        id: `recent-thread-${thread.id}`,
        group: 'Recent',
        title: thread.name,
        subtitle: `${workspace.name} · ${formatRelativeTimeShort(thread.updatedAt)}`,
        keywords: ['recent thread', 'thread', thread.name, workspace.name],
        priority: 120 + index,
        onSelect: () => {
          setSelectedWorkspace(workspace.id)
          setSelectedThread(workspace.id, thread.id)
          navigate(buildWorkspaceThreadRoute(workspace.id, thread.id))
        },
      })
    })

    return nextItems
  }, [
    activeLocale,
    currentSection,
    navigate,
    selectedWorkspace,
    setSelectedThread,
    setSelectedWorkspace,
    threadsByWorkspace,
    workspacesQuery.data,
  ])
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
        commandPaletteShortcutLabel={commandPaletteShortcutLabel}
        mobileNavOpen={isMobileSidebarOpen}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
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
            aria-label={i18n._({ id: 'Close navigation', message: 'Close navigation' })}
            className="web-ide__sidebar-backdrop"
            onClick={() => setIsMobileSidebarOpen(false)}
            type="button"
          />
        ) : null}
        <aside className={sidebarClassName}>
          {!isMobileViewport && !isSidebarCollapsed ? (
            <ResizeHandle
              aria-label={i18n._({ id: 'Resize sidebar', message: 'Resize sidebar' })}
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
                  className={
                    item.section === currentSection
                      ? 'web-ide__primary-link web-ide__primary-link--active'
                      : 'web-ide__primary-link'
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
                <div className="web-ide__section-title">
                  {i18n._({ id: 'Workspaces', message: 'Workspaces' })}
                </div>
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
                    title={i18n._({
                      id: 'Failed To Restart Workspace',
                      message: 'Failed To Restart Workspace',
                    })}
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
                    title={i18n._({
                      id: 'Failed To Create Thread',
                      message: 'Failed To Create Thread',
                    })}
                    tone="error"
                  >
                    {getErrorMessage(createThreadMutation.error)}
                  </InlineNotice>
                ) : null}
                {workspacesQuery.data?.map((workspace, index) => {
                  const threadQuery = threadQueries[index]
                  const threadPage = threadQuery?.data
                  const threads = threadPage?.data ?? []
                  const hasMoreThreads = Boolean(threadPage?.nextCursor)
                  const restartPhase = workspaceRestartStateById[workspace.id]
                  const visualRuntimeStatus =
                    restartPhase === 'restarting' ? 'restarting' : workspace.runtimeStatus
                  const workspaceStatusLabel = formatLocalizedStatusLabel(visualRuntimeStatus)
                  const workspaceStatusTone = getWorkspaceRuntimeTone(visualRuntimeStatus)
                  const isWorkspaceGroupOpen = isWorkspaceGroupExpanded(workspace.id)
                  const visibleThreadCount =
                    visibleThreadCountByWorkspace[workspace.id] ?? DEFAULT_VISIBLE_THREADS
                  const visibleThreads = threads.slice(0, visibleThreadCount)
                  const remainingThreadCount = Math.max(0, threads.length - visibleThreads.length)
                  const canShowLessThreads =
                    visibleThreadCount > DEFAULT_VISIBLE_THREADS && threads.length > DEFAULT_VISIBLE_THREADS
                  const workspaceThreadCountLabel = threadPage
                    ? hasMoreThreads
                      ? i18n._({
                          id: 'At least {count} threads',
                          message: 'At least {count} threads',
                          values: {
                            count: threads.length,
                          },
                        })
                      : i18n._({
                          id: '{count} threads',
                          message: '{count} threads',
                          values: {
                            count: threads.length,
                          },
                        })
                    : i18n._({
                        id: 'Threads not loaded',
                        message: 'Threads not loaded',
                      })
                  const workspaceThreadCountText = threadPage
                    ? hasMoreThreads
                      ? `${threads.length}+`
                      : String(threads.length)
                    : null
                  const threadListError = threadQuery?.error ? getErrorMessage(threadQuery.error) : null
                  const isInitialThreadListLoading = Boolean(threadQuery?.isLoading && !threads.length)
                  const shouldShowThreadPagination =
                    remainingThreadCount > 0 || hasMoreThreads || canShowLessThreads
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
                          title={workspace.name}
                          onClick={() => handleWorkspaceClick(workspace.id)}
                          type="button"
                        >
                          <span className="workspace-tree__workspace-leading">
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
                              <span
                                aria-label={workspaceStatusLabel}
                                className={`workspace-tree__workspace-status-dot workspace-tree__workspace-status-dot--${workspaceStatusTone}`}
                                role="img"
                                title={workspaceStatusLabel}
                              />
                            </span>
                            {workspaceThreadCountText ? (
                              <span
                                aria-label={workspaceThreadCountLabel}
                                className="workspace-tree__workspace-count-badge"
                                title={workspaceThreadCountLabel}
                              >
                                {workspaceThreadCountText}
                              </span>
                            ) : null}
                          </span>
                          <span className="workspace-tree__workspace-copy">
                            <span className="workspace-tree__workspace-name" dir="auto">
                              {workspace.name}
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
                                  ? i18n._({ id: 'Refreshing...', message: 'Refreshing...' })
                                  : restartPhase === 'restarting'
                                    ? i18n._({
                                        id: 'Restarting runtime',
                                        message: 'Restarting runtime',
                                      })
                                    : i18n._({
                                        id: 'Runtime refreshed',
                                        message: 'Runtime refreshed',
                                      })}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        <div
                          className={
                            isWorkspaceMenuOpen(workspace.id)
                              ? 'workspace-tree__workspace-actions workspace-tree__workspace-actions--visible'
                              : 'workspace-tree__workspace-actions'
                          }
                          ref={isWorkspaceMenuOpen(workspace.id) ? menuRef : undefined}
                        >
                          <button
                            aria-label={i18n._({
                              id: 'Create thread in {workspace}',
                              message: 'Create thread in {workspace}',
                              values: { workspace: workspace.name },
                            })}
                            className="workspace-tree__create-trigger"
                            disabled={createThreadMutation.isPending || restartPhase === 'restarting'}
                            onClick={() => handleCreateThreadForWorkspace(workspace)}
                            title={i18n._({
                              id: 'Create thread in {workspace}',
                              message: 'Create thread in {workspace}',
                              values: { workspace: workspace.name },
                            })}
                            type="button"
                          >
                            <PlusIcon />
                          </button>
                          <button
                            aria-expanded={isWorkspaceMenuOpen(workspace.id)}
                            aria-label={i18n._({
                              id: 'Open actions for {name}',
                              message: 'Open actions for {name}',
                              values: { name: workspace.name },
                            })}
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
                                {i18n._({ id: 'Refresh', message: 'Refresh' })}
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
                                  ? i18n._({ id: 'Restarting…', message: 'Restarting…' })
                                  : i18n._({ id: 'Restart', message: 'Restart' })}
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
                                {i18n._({ id: 'Rename', message: 'Rename' })}
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
                                  ? i18n._({ id: 'Removing...', message: 'Removing...' })
                                  : i18n._({ id: 'Remove', message: 'Remove' })}
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {isWorkspaceGroupOpen ? (
                        <div className="workspace-tree__threads" id={`workspace-threads-${workspace.id}`}>
                          {threadListError ? (
                            <InlineNotice
                              details={threadListError}
                              dismissible
                              noticeKey={`workspace-thread-list-${workspace.id}-${threadListError}`}
                              onRetry={() => {
                                void threadQuery?.refetch()
                              }}
                              title={i18n._({
                                id: 'Failed To Load Threads',
                                message: 'Failed To Load Threads',
                              })}
                              tone="error"
                            >
                              {threadListError}
                            </InlineNotice>
                          ) : null}
                          {isInitialThreadListLoading ? (
                            <div className="workspace-tree__thread-pagination">
                              <span className="workspace-tree__show-more">
                                {i18n._({
                                  id: 'Loading threads…',
                                  message: 'Loading threads…',
                                })}
                              </span>
                            </div>
                          ) : null}
                          {visibleThreads.map((thread) => {
                            return (
                              <WorkspaceTreeThreadRow
                                activeThreadId={activeThreadId}
                                deleteInProgress={
                                  deleteThreadMutation.isPending &&
                                  deleteTarget?.kind === 'thread' &&
                                  deleteTarget.workspaceId === workspace.id &&
                                  deleteTarget.thread.id === thread.id
                                }
                                isMenuOpen={isThreadMenuOpen(workspace.id, thread.id)}
                                isRenameOrDeletePending={
                                  renameThreadMutation.isPending || deleteThreadMutation.isPending
                                }
                                isSelectedWorkspaceRoute={
                                  workspaceRouteActive && selectedWorkspaceId === workspace.id
                                }
                                key={thread.id}
                                menuRef={menuRef}
                                onDeleteThread={() => handleDeleteThread(workspace.id, thread)}
                                onOpenThread={() => {
                                  setSelectedWorkspace(workspace.id)
                                  setSelectedThread(workspace.id, thread.id)
                                  if (isMobileViewport) {
                                    setIsMobileSidebarOpen(false)
                                  }
                                  navigate(buildWorkspaceThreadRoute(workspace.id, thread.id))
                                }}
                                onRenameThread={() => handleRenameThread(workspace.id, thread)}
                                onToggleMenu={() =>
                                  setOpenMenu((current) =>
                                    current?.kind === 'thread' &&
                                    current.workspaceId === workspace.id &&
                                    current.threadId === thread.id
                                      ? null
                                      : {
                                          kind: 'thread',
                                          workspaceId: workspace.id,
                                          threadId: thread.id,
                                        },
                                  )
                                }
                                thread={thread}
                              />
                            )
                          })}
                          {shouldShowThreadPagination ? (
                            <div className="workspace-tree__thread-pagination">
                              {remainingThreadCount > 0 ? (
                                <button
                                  className="workspace-tree__show-more"
                                  onClick={() => handleShowMoreThreads(workspace.id)}
                                  type="button"
                                >
                                  {i18n._({
                                    id: 'Show {count} more',
                                    message: 'Show {count} more',
                                    values: {
                                      count: Math.min(DEFAULT_VISIBLE_THREADS, remainingThreadCount),
                                    },
                                  })}
                                </button>
                              ) : hasMoreThreads ? (
                                <button
                                  className="workspace-tree__show-more"
                                  onClick={() => handleShowMoreThreads(workspace.id)}
                                  disabled={threadQuery?.isFetching}
                                  type="button"
                                >
                                  {threadQuery?.isFetching
                                    ? i18n._({
                                        id: 'Loading more…',
                                        message: 'Loading more…',
                                      })
                                    : i18n._({
                                        id: 'Load more',
                                        message: 'Load more',
                                      })}
                                </button>
                              ) : null}
                              {canShowLessThreads ? (
                                <button
                                  className="workspace-tree__show-more"
                                  onClick={() => handleShowLessThreads(workspace.id)}
                                  type="button"
                                >
                                  {i18n._({ id: 'Show less', message: 'Show less' })}
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
              title={i18n._({ id: 'Settings', message: 'Settings' })}
              to="/settings/general"
            >
              <RailIcon>
                <SettingsIcon />
              </RailIcon>
              {shouldShowSidebarLabels ? (
                <span className="web-ide__primary-link-label">
                  {i18n._({ id: 'Settings', message: 'Settings' })}
                </span>
              ) : null}
            </NavLink>
            <RailIconButton
              aria-label={
                isMobileViewport
                  ? i18n._({ id: 'Close navigation', message: 'Close navigation' })
                  : isSidebarCollapsed
                    ? i18n._({ id: 'Expand sidebar', message: 'Expand sidebar' })
                    : i18n._({ id: 'Collapse sidebar', message: 'Collapse sidebar' })
              }
              className="web-ide__sidebar-toggle"
              onClick={() => {
                if (isMobileViewport) {
                  setIsMobileSidebarOpen(false)
                  return
                }

                setIsSidebarCollapsed((current) => !current)
              }}
              title={
                isMobileViewport
                  ? i18n._({ id: 'Close navigation', message: 'Close navigation' })
                  : isSidebarCollapsed
                    ? i18n._({ id: 'Expand sidebar', message: 'Expand sidebar' })
                    : i18n._({ id: 'Collapse sidebar', message: 'Collapse sidebar' })
              }
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
              ? i18n._({
                  id: 'Enter a new name for this workspace folder.',
                  message: 'Enter a new name for this workspace folder.',
                })
              : i18n._({
                  id: 'Enter a new name for this thread.',
                  message: 'Enter a new name for this thread.',
                })
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
          fieldLabel={
            renameTarget.kind === 'workspace'
              ? i18n._({ id: 'Workspace Name', message: 'Workspace Name' })
              : i18n._({ id: 'Thread Name', message: 'Thread Name' })
          }
          isSubmitDisabled={
            !renameValue.trim() ||
            (renameTarget.kind === 'workspace'
              ? renameValue.trim() === renameTarget.workspace.name
              : renameValue.trim() === renameTarget.thread.name)
          }
          placeholder={
            renameTarget.kind === 'workspace' ? renameTarget.workspace.name : renameTarget.thread.name
          }
          submitLabel={
            renameTarget.kind === 'workspace'
              ? i18n._({ id: 'Save Workspace', message: 'Save Workspace' })
              : i18n._({ id: 'Save Thread', message: 'Save Thread' })
          }
          title={
            renameTarget.kind === 'workspace'
              ? i18n._({ id: 'Rename Workspace', message: 'Rename Workspace' })
              : i18n._({ id: 'Rename Thread', message: 'Rename Thread' })
          }
          value={renameValue}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          confirmLabel={
            deleteTarget.kind === 'workspace'
              ? i18n._({ id: 'Remove Workspace', message: 'Remove Workspace' })
              : i18n._({ id: 'Delete Thread', message: 'Delete Thread' })
          }
          description={
            deleteTarget.kind === 'workspace'
              ? i18n._({
                  id: 'This removes the workspace from the sidebar registry and clears its loaded thread list from the UI.',
                  message:
                    'This removes the workspace from the sidebar registry and clears its loaded thread list from the UI.',
                })
              : i18n._({
                  id: 'This will remove the thread from the current workspace list.',
                  message: 'This will remove the thread from the current workspace list.',
                })
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
          title={
            deleteTarget.kind === 'workspace'
              ? i18n._({ id: 'Remove Workspace?', message: 'Remove Workspace?' })
              : i18n._({ id: 'Delete Thread?', message: 'Delete Thread?' })
          }
        />
      ) : null}
      <CommandPalette
        isOpen={isCommandPaletteOpen}
        items={paletteItems}
        onClose={() => setIsCommandPaletteOpen(false)}
        shortcutLabel={commandPaletteShortcutLabel}
      />
    </div>
  )
}
