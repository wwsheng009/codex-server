import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, PointerEvent as ReactPointerEvent } from 'react'
import { Link, useParams } from 'react-router-dom'

import {
  ApprovalIcon,
  ContextIcon,
  FeedIcon,
  PanelOpenIcon,
  RailIconButton,
  ResizeHandle,
  SendIcon,
  StopIcon,
  ToolsIcon,
} from '../components/ui/RailControls'
import {
  readRightRailExpanded,
  readRightRailWidth,
  readSurfacePanelSides,
  readSurfacePanelWidths,
  writeRightRailExpanded,
  writeRightRailWidth,
  writeSurfacePanelSides,
  writeSurfacePanelWidths,
} from '../lib/layout-state'
import {
  layoutConfig,
  type SurfacePanelSide,
  type SurfacePanelView,
} from '../lib/layout-config'
import { getErrorMessage, isAuthenticationError } from '../lib/error-utils'
import { InlineNotice } from '../components/ui/InlineNotice'
import { isApiClientErrorCode } from '../lib/api-client'
import { StatusPill } from '../components/ui/StatusPill'
import { ApprovalDialog, ApprovalStack, buildLiveTimelineEntries, formatRelativeTimeShort, LiveFeed, TurnTimeline } from '../components/workspace/renderers'
import { getAccount } from '../features/account/api'
import { listPendingApprovals, respondServerRequestWithDetails } from '../features/approvals/api'
import { listModels } from '../features/catalog/api'
import { startCommand, terminateCommand, writeCommand } from '../features/commands/api'
import { archiveThread, createThread, getThread, listThreads, renameThread, resumeThread, unarchiveThread } from '../features/threads/api'
import { interruptTurn, startTurn } from '../features/turns/api'
import { getWorkspace } from '../features/workspaces/api'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useWorkspaceStream } from '../hooks/useWorkspaceStream'
import { useSessionStore } from '../stores/session-store'
import { getSelectedThreadIdForWorkspace } from '../stores/session-store-utils'
import { useUIStore } from '../stores/ui-store'
import {
  isViewportNearBottom,
  shouldRefreshApprovalsForEvent,
  shouldRefreshThreadDetailForEvent,
  shouldRefreshThreadsForEvent,
  shouldThrottleThreadDetailRefreshForEvent,
} from './threadPageUtils'
import type { ServerEvent, Thread, ThreadDetail, ThreadTurn, TurnResult } from '../types/api'

const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS = {}
const MIN_SEND_FEEDBACK_MS = 700
const STREAMING_DETAIL_REFRESH_DELAY_MS = 180
const COMPOSER_PREFERENCES_STORAGE_PREFIX = 'codex-server:composer-preferences:'
const FALLBACK_MODEL_OPTIONS = ['gpt-5.4', 'gpt-5.3-codex']

type ComposerPermissionPreset = 'default' | 'full-access'
type ComposerReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

type PendingThreadTurn = {
  localId: string
  threadId: string
  input: string
  submittedAt: string
  phase: 'sending' | 'waiting'
  turnId?: string
}

type ComposerPreferences = {
  permissionPreset: ComposerPermissionPreset
  model: string
  reasoningEffort: ComposerReasoningEffort
}

const DEFAULT_COMPOSER_PREFERENCES: ComposerPreferences = {
  permissionPreset: 'default',
  model: '',
  reasoningEffort: 'medium',
}

function upsertThreadList(current: Thread[] | undefined, thread: Thread) {
  const items = current ?? []
  const nextItems = items.some((item) => item.id === thread.id)
    ? items.map((item) => (item.id === thread.id ? thread : item))
    : [thread, ...items]

  return [...nextItems].sort(
    (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  )
}

function createPendingTurn(threadId: string, input: string): PendingThreadTurn {
  const localId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `pending-${Date.now()}`

  return {
    localId,
    threadId,
    input,
    submittedAt: new Date().toISOString(),
    phase: 'sending',
  }
}

function buildPendingThreadTurn(pendingTurn: PendingThreadTurn): ThreadTurn {
  return {
    id: pendingTurn.turnId ?? `pending-${pendingTurn.localId}`,
    status: pendingTurn.phase === 'sending' ? 'sending' : 'inProgress',
    items: [
      {
        content: [
          {
            text: pendingTurn.input,
            type: 'inputText',
          },
        ],
        id: `pending-user-${pendingTurn.localId}`,
        type: 'userMessage',
      },
    ],
  }
}

function shouldRetryTurnAfterResume(error: unknown) {
  if (isApiClientErrorCode(error, 'thread_not_found')) {
    return true
  }

  const message = error instanceof Error ? error.message.toLowerCase() : ''
  return message.includes('thread not found') || message.includes('thread not loaded')
}

function normalizePermissionPreset(value: string): ComposerPermissionPreset {
  return value === 'full-access' ? 'full-access' : 'default'
}

function normalizeReasoningEffort(value: string): ComposerReasoningEffort {
  switch (value) {
    case 'low':
    case 'high':
    case 'xhigh':
      return value
    default:
      return 'medium'
  }
}

function readComposerPreferences(workspaceId: string): ComposerPreferences {
  if (!workspaceId || typeof window === 'undefined') {
    return DEFAULT_COMPOSER_PREFERENCES
  }

  try {
    const raw = window.localStorage.getItem(`${COMPOSER_PREFERENCES_STORAGE_PREFIX}${workspaceId}`)
    if (!raw) {
      return DEFAULT_COMPOSER_PREFERENCES
    }

    const parsed = JSON.parse(raw) as Partial<ComposerPreferences>
    return {
      permissionPreset: normalizePermissionPreset(String(parsed.permissionPreset ?? 'default')),
      model: typeof parsed.model === 'string' ? parsed.model : '',
      reasoningEffort: normalizeReasoningEffort(String(parsed.reasoningEffort ?? 'medium')),
    }
  } catch {
    return DEFAULT_COMPOSER_PREFERENCES
  }
}

function writeComposerPreferences(workspaceId: string, preferences: ComposerPreferences) {
  if (!workspaceId || typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      `${COMPOSER_PREFERENCES_STORAGE_PREFIX}${workspaceId}`,
      JSON.stringify(preferences),
    )
  } catch {
    // Ignore browser storage failures.
  }
}

function statusIsInterruptible(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')
  return ['running', 'processing', 'sending', 'waiting', 'inprogress', 'started'].includes(normalized)
}

function compactStatusTone(value?: string) {
  return (value ?? 'idle').toLowerCase().replace(/\s+/g, '-')
}

function compactStatusLabel(value?: string) {
  const normalized = (value ?? '').toLowerCase().replace(/[\s_-]+/g, '')

  switch (normalized) {
    case 'running':
    case 'processing':
    case 'sending':
    case 'waiting':
    case 'inprogress':
    case 'started':
      return '处理中'
    case 'connected':
    case 'ready':
    case 'open':
    case 'active':
      return '在线'
    case 'archived':
      return '归档'
    case 'failed':
    case 'error':
    case 'systemerror':
      return '异常'
    default:
      return '空闲'
  }
}

export function ThreadPage() {
  const { workspaceId = '' } = useParams()
  const queryClient = useQueryClient()

  const [newThreadName, setNewThreadName] = useState('New Thread')
  const [message, setMessage] = useState('')
  const [pendingTurn, setPendingTurn] = useState<PendingThreadTurn | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [command, setCommand] = useState('git status')
  const [stdinValue, setStdinValue] = useState('')
  const [selectedProcessId, setSelectedProcessId] = useState<string>()
  const [surfacePanelView, setSurfacePanelView] = useState<SurfacePanelView | null>(null)
  const [surfacePanelWidths, setSurfacePanelWidths] = useState(readSurfacePanelWidths)
  const [surfacePanelSides, setSurfacePanelSides] = useState(readSurfacePanelSides)
  const [isSurfacePanelResizing, setIsSurfacePanelResizing] = useState(false)
  const [editingThreadId, setEditingThreadId] = useState<string>()
  const [editingThreadName, setEditingThreadName] = useState('')
  const [isTerminalDockExpanded, setIsTerminalDockExpanded] = useState(false)
  const [isTerminalDockResizing, setIsTerminalDockResizing] = useState(false)
  const [terminalDockHeight, setTerminalDockHeight] = useState<number>(layoutConfig.workbench.terminalDock.defaultHeight)
  const [inspectorWidth, setInspectorWidth] = useState<number>(readRightRailWidth)
  const [isInspectorResizing, setIsInspectorResizing] = useState(false)
  const [isThreadToolsExpanded, setIsThreadToolsExpanded] = useState(false)
  const [isWorkbenchToolsExpanded, setIsWorkbenchToolsExpanded] = useState(false)
  const [isInspectorExpanded, setIsInspectorExpanded] = useState(readRightRailExpanded)
  const [approvalAnswers, setApprovalAnswers] = useState<Record<string, Record<string, string>>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  const [composerPreferences, setComposerPreferences] = useState<ComposerPreferences>(DEFAULT_COMPOSER_PREFERENCES)
  const [hasUnreadThreadUpdates, setHasUnreadThreadUpdates] = useState(false)
  const [isThreadPinnedToLatest, setIsThreadPinnedToLatest] = useState(true)
  const inspectorResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const surfacePanelResizeRef = useRef<{ side: SurfacePanelSide; startX: number; startWidth: number; view: SurfacePanelView } | null>(null)
  const terminalDockResizeRef = useRef<{ startY: number; startHeight: number } | null>(null)
  const threadDetailRefreshTimerRef = useRef<number | null>(null)
  const threadViewportRef = useRef<HTMLDivElement | null>(null)
  const threadBottomRef = useRef<HTMLDivElement | null>(null)
  const threadAutoScrollKeyRef = useRef('')
  const shouldFollowThreadRef = useRef(true)

  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const removeCommandSession = useSessionStore((state) => state.removeCommandSession)
  const clearCompletedCommandSessions = useSessionStore((state) => state.clearCompletedCommandSessions)
  const mobileThreadToolsOpen = useUIStore((state) => state.mobileThreadToolsOpen)
  const setMobileThreadChrome = useUIStore((state) => state.setMobileThreadChrome)
  const setMobileThreadToolsOpen = useUIStore((state) => state.setMobileThreadToolsOpen)
  const resetMobileThreadChrome = useUIStore((state) => state.resetMobileThreadChrome)
  const selectedThreadId = useSessionStore((state) => getSelectedThreadIdForWorkspace(state, workspaceId))
  const isMobileViewport = useMediaQuery('(max-width: 900px)')
  const streamState = useWorkspaceStream(workspaceId)

  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
  })
  const accountQuery = useQuery({
    queryKey: ['account'],
    queryFn: getAccount,
    staleTime: 15_000,
  })
  const threadsQuery = useQuery({
    queryKey: ['threads', workspaceId],
    queryFn: () => listThreads(workspaceId),
    enabled: Boolean(workspaceId),
  })
  const modelsQuery = useQuery({
    queryKey: ['models', workspaceId],
    queryFn: () => listModels(workspaceId),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
  })
  const threadDetailQuery = useQuery({
    queryKey: ['thread-detail', workspaceId, selectedThreadId],
    queryFn: () => getThread(workspaceId, selectedThreadId ?? ''),
    enabled: Boolean(workspaceId && selectedThreadId),
    refetchInterval:
      selectedThreadId && pendingTurn?.threadId === selectedThreadId
        ? 1_000
        : selectedThreadId && streamState !== 'open'
          ? 5_000
          : false,
  })
  const approvalsQuery = useQuery({
    queryKey: ['approvals', workspaceId],
    queryFn: () => listPendingApprovals(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: workspaceId && streamState !== 'open' ? 4_000 : false,
  })

  async function invalidateThreadQueries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
    ])
  }

  const createThreadMutation = useMutation({
    mutationFn: (input: { name: string; model?: string; permissionPreset?: string }) =>
      createThread(workspaceId, input),
    onSuccess: async (thread) => {
      setNewThreadName('New Thread')
      queryClient.setQueryData<Thread[]>(['threads', workspaceId], (current) =>
        upsertThreadList(current, thread),
      )
      queryClient.setQueryData<ThreadDetail>(['thread-detail', workspaceId, thread.id], {
        ...thread,
        turns: [],
      })
      setSelectedThread(workspaceId, thread.id)
      await invalidateThreadQueries()
    },
  })
  const renameThreadMutation = useMutation({
    mutationFn: ({ threadId, name }: { threadId: string; name: string }) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async () => {
      setEditingThreadId(undefined)
      setEditingThreadName('')
      await invalidateThreadQueries()
    },
  })
  const archiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => archiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await invalidateThreadQueries()
    },
  })
  const unarchiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => unarchiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await invalidateThreadQueries()
    },
  })
  const startTurnMutation = useMutation<
    TurnResult,
    Error,
    {
      threadId: string
      input: string
      model?: string
      reasoningEffort?: string
      permissionPreset?: string
    }
  >({
    mutationFn: ({ threadId, input, model, reasoningEffort, permissionPreset }) =>
      startTurn(workspaceId, threadId, {
        input,
        model,
        reasoningEffort,
        permissionPreset,
      }),
  })
  const interruptTurnMutation = useMutation({
    mutationFn: () => interruptTurn(workspaceId, selectedThreadId ?? ''),
    onSuccess: async () => {
      setPendingTurn(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      ])
    },
  })
  const respondApprovalMutation = useMutation({
    mutationFn: ({
      requestId,
      action,
      answers,
    }: {
      requestId: string
      action: string
      answers?: Record<string, string[]>
    }) => respondServerRequestWithDetails(requestId, { action, answers }),
    onSuccess: async (_, variables) => {
      setApprovalAnswers((current) => {
        const next = { ...current }
        delete next[variables.requestId]
        return next
      })
      setApprovalErrors((current) => {
        const next = { ...current }
        delete next[variables.requestId]
        return next
      })
      await queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    },
  })
  const startCommandMutation = useMutation({
    mutationFn: (input: { command: string }) => startCommand(workspaceId, input),
    onSuccess: (session) => {
      useSessionStore.getState().upsertCommandSession(session)
      setSelectedProcessId(session.id)
      setIsTerminalDockExpanded(true)
      setCommand('')
    },
  })
  const writeCommandMutation = useMutation({
    mutationFn: ({ processId, input }: { processId: string; input: string }) =>
      writeCommand(workspaceId, processId, { input }),
    onSuccess: () => {
      setStdinValue('')
    },
  })
  const terminateCommandMutation = useMutation({
    mutationFn: (processId: string) => terminateCommand(workspaceId, processId),
  })

  const selectedThreadEvents = useSessionStore((state) =>
    selectedThreadId ? state.eventsByThread[selectedThreadId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceEvents = useSessionStore((state) =>
    workspaceId ? state.workspaceEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceActivityEvents = useSessionStore((state) =>
    workspaceId ? state.activityEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceCommandSessions = useSessionStore((state) =>
    workspaceId
      ? state.commandSessionsByWorkspace[workspaceId] ?? (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string])
      : (EMPTY_COMMAND_SESSIONS as typeof state.commandSessionsByWorkspace[string]),
  )

  const commandSessions = useMemo(
    () =>
      Object.values(workspaceCommandSessions).sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [workspaceCommandSessions],
  )

  useEffect(() => {
    setSelectedWorkspace(workspaceId)
  }, [setSelectedWorkspace, workspaceId])

  useEffect(() => {
    setComposerPreferences(readComposerPreferences(workspaceId))
  }, [workspaceId])

  useEffect(() => {
    writeComposerPreferences(workspaceId, composerPreferences)
  }, [composerPreferences, workspaceId])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    setIsTerminalDockExpanded(false)
  }, [isMobileViewport])

  useEffect(() => {
    const currentThreads = threadsQuery.data ?? []
    if (!currentThreads.length) {
      return
    }

    const hasSelectedThread = currentThreads.some((thread) => thread.id === selectedThreadId)
    if (!hasSelectedThread) {
      setSelectedThread(workspaceId, currentThreads[0].id)
    }
  }, [selectedThreadId, setSelectedThread, threadsQuery.data, workspaceId])

  useEffect(() => {
    setPendingTurn((current) => {
      if (!current) {
        return null
      }

      return current.threadId === selectedThreadId ? current : null
    })
  }, [selectedThreadId])

  useEffect(() => {
    shouldFollowThreadRef.current = true
    threadAutoScrollKeyRef.current = ''
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)

    if (!selectedThreadId) {
      return
    }

    const frameId = window.requestAnimationFrame(() => {
      threadBottomRef.current?.scrollIntoView({ block: 'end' })
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [selectedThreadId])

  useEffect(() => {
    if (!selectedThreadId || !pendingTurn?.turnId || pendingTurn.threadId !== selectedThreadId) {
      return
    }

    const turns = threadDetailQuery.data?.turns ?? []
    if (!turns.some((turn) => turn.id === pendingTurn.turnId)) {
      return
    }

    const submittedAtMs = new Date(pendingTurn.submittedAt).getTime()
    const elapsedMs = Number.isNaN(submittedAtMs) ? MIN_SEND_FEEDBACK_MS : Date.now() - submittedAtMs
    const remainingMs = Math.max(0, MIN_SEND_FEEDBACK_MS - elapsedMs)

    if (remainingMs === 0) {
      setPendingTurn((current) =>
        current?.turnId === pendingTurn.turnId && current?.threadId === selectedThreadId ? null : current,
      )
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPendingTurn((current) =>
        current?.turnId === pendingTurn.turnId && current?.threadId === selectedThreadId ? null : current,
      )
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [pendingTurn, selectedThreadId, threadDetailQuery.data?.turns])

  useEffect(() => {
    if (!selectedThreadId || !selectedThreadEvents.length) {
      return
    }

    const latestEvent = selectedThreadEvents[selectedThreadEvents.length - 1]
    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      void queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] })
    }

    if (!shouldRefreshThreadDetailForEvent(latestEvent.method)) {
      return
    }

    const runRefresh = () => {
      threadDetailRefreshTimerRef.current = null
      void queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })
    }

    if (threadDetailRefreshTimerRef.current) {
      window.clearTimeout(threadDetailRefreshTimerRef.current)
      threadDetailRefreshTimerRef.current = null
    }

    if (!shouldThrottleThreadDetailRefreshForEvent(latestEvent.method)) {
      runRefresh()
      return
    }

    threadDetailRefreshTimerRef.current = window.setTimeout(
      runRefresh,
      STREAMING_DETAIL_REFRESH_DELAY_MS,
    )
  }, [queryClient, selectedThreadEvents, selectedThreadId, workspaceId])

  useEffect(() => {
    if (!workspaceActivityEvents.length) {
      return
    }

    const latestEvent = workspaceActivityEvents[workspaceActivityEvents.length - 1]

    if (shouldRefreshThreadsForEvent(latestEvent.method)) {
      void queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] })
    }

    if (shouldRefreshApprovalsForEvent(latestEvent.method, latestEvent.serverRequestId)) {
      void queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] })
    }
  }, [queryClient, workspaceActivityEvents, workspaceId])

  useEffect(
    () => () => {
      if (threadDetailRefreshTimerRef.current) {
        window.clearTimeout(threadDetailRefreshTimerRef.current)
      }
    },
    [],
  )

  useEffect(() => {
    if (!pendingTurn?.turnId || pendingTurn.threadId !== selectedThreadId) {
      return
    }

    const hasCompletedEvent = selectedThreadEvents.some(
      (event) => event.turnId === pendingTurn.turnId && event.method === 'turn/completed',
    )
    if (!hasCompletedEvent) {
      return
    }

    const submittedAtMs = new Date(pendingTurn.submittedAt).getTime()
    const elapsedMs = Number.isNaN(submittedAtMs) ? MIN_SEND_FEEDBACK_MS : Date.now() - submittedAtMs
    const remainingMs = Math.max(0, MIN_SEND_FEEDBACK_MS - elapsedMs)

    if (remainingMs === 0) {
      setPendingTurn((current) =>
        current?.turnId === pendingTurn.turnId && current?.threadId === selectedThreadId ? null : current,
      )
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPendingTurn((current) =>
        current?.turnId === pendingTurn.turnId && current?.threadId === selectedThreadId ? null : current,
      )
    }, remainingMs)

    return () => window.clearTimeout(timeoutId)
  }, [pendingTurn, selectedThreadEvents, selectedThreadId])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    if (mobileThreadToolsOpen && !isInspectorExpanded) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(true)
      return
    }

    if (!mobileThreadToolsOpen && isInspectorExpanded && !surfacePanelView) {
      setIsInspectorExpanded(false)
    }
  }, [isInspectorExpanded, isMobileViewport, mobileThreadToolsOpen, surfacePanelView])

  useEffect(() => {
    if (!isTerminalDockResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = terminalDockResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = resizeState.startY - event.clientY
      const nextHeight = Math.min(
        layoutConfig.workbench.terminalDock.limits.max,
        Math.max(layoutConfig.workbench.terminalDock.limits.min, resizeState.startHeight + delta),
      )
      setTerminalDockHeight(nextHeight)
    }

    function stopResizing() {
      terminalDockResizeRef.current = null
      setIsTerminalDockResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isTerminalDockResizing])

  useEffect(() => {
    if (!isInspectorResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = inspectorResizeRef.current
      if (!resizeState) {
        return
      }

      const delta = resizeState.startX - event.clientX
      const nextWidth = Math.min(
        layoutConfig.workbench.rightRail.limits.max,
        Math.max(layoutConfig.workbench.rightRail.limits.min, resizeState.startWidth + delta),
      )
      setInspectorWidth(nextWidth)
    }

    function stopResizing() {
      inspectorResizeRef.current = null
      setIsInspectorResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isInspectorResizing])

  useEffect(() => {
    writeRightRailExpanded(isInspectorExpanded)
  }, [isInspectorExpanded])

  useEffect(() => {
    writeRightRailWidth(inspectorWidth)
  }, [inspectorWidth])

  useEffect(() => {
    writeSurfacePanelWidths(surfacePanelWidths)
  }, [surfacePanelWidths])

  useEffect(() => {
    writeSurfacePanelSides(surfacePanelSides)
  }, [surfacePanelSides])

  useEffect(() => {
    if (!isSurfacePanelResizing) {
      return
    }

    function handlePointerMove(event: PointerEvent) {
      const resizeState = surfacePanelResizeRef.current
      if (!resizeState) {
        return
      }

      const delta =
        resizeState.side === 'right'
          ? resizeState.startX - event.clientX
          : event.clientX - resizeState.startX
      const nextWidth = Math.min(
        layoutConfig.workbench.surfacePanel.widthLimits.max,
        Math.max(layoutConfig.workbench.surfacePanel.widthLimits.min, resizeState.startWidth + delta),
      )
      setSurfacePanelWidths((current) => ({
        ...current,
        [resizeState.view]: nextWidth,
      }))
    }

    function stopResizing() {
      surfacePanelResizeRef.current = null
      setIsSurfacePanelResizing(false)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', stopResizing)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', stopResizing)
    }
  }, [isSurfacePanelResizing])

  const selectedThread = useMemo(
    () => threadsQuery.data?.find((thread) => thread.id === selectedThreadId),
    [selectedThreadId, threadsQuery.data],
  )
  const displayedTurns = useMemo(() => {
    const turns = threadDetailQuery.data?.turns ?? []

    if (!pendingTurn || pendingTurn.threadId !== selectedThreadId) {
      return turns
    }

    if (pendingTurn.turnId && turns.some((turn) => turn.id === pendingTurn.turnId)) {
      return turns
    }

    return [...turns, buildPendingThreadTurn(pendingTurn)]
  }, [pendingTurn, selectedThreadId, threadDetailQuery.data?.turns])
  const liveTimelineEntries = useMemo(
    () =>
      buildLiveTimelineEntries(
        [...workspaceEvents, ...selectedThreadEvents].sort(
          (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime(),
        ),
      ),
    [selectedThreadEvents, workspaceEvents],
  )
  const selectedCommandSession = useMemo(
    () => commandSessions.find((session) => session.id === selectedProcessId) ?? commandSessions[0],
    [commandSessions, selectedProcessId],
  )
  const availableModels = useMemo(
    () =>
      Array.from(
        new Set(
          [composerPreferences.model, ...(modelsQuery.data ?? []).map((item) => item.name), ...FALLBACK_MODEL_OPTIONS].filter(Boolean),
        ),
      ),
    [composerPreferences.model, modelsQuery.data],
  )
  const activeComposerApproval = useMemo(() => {
    const approvals = approvalsQuery.data ?? []
    if (!approvals.length) {
      return null
    }

    const threadApproval = selectedThreadId
      ? approvals.find((approval) => approval.threadId === selectedThreadId)
      : undefined

    return threadApproval ?? approvals[0]
  }, [approvalsQuery.data, selectedThreadId])
  const latestDisplayedTurn = displayedTurns[displayedTurns.length - 1]
  const turnCount = displayedTurns.length
  const timelineItemCount = displayedTurns.reduce((count, turn) => count + turn.items.length, 0)
  const latestThreadEventTs = selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ?? ''
  const threadAutoScrollKey = [
    selectedThreadId ?? '',
    turnCount,
    timelineItemCount,
    latestDisplayedTurn?.id ?? '',
    latestDisplayedTurn?.status ?? '',
    latestThreadEventTs,
    pendingTurn?.phase ?? '',
    pendingTurn?.turnId ?? '',
    threadDetailQuery.data?.updatedAt ?? '',
    selectedThread?.updatedAt ?? '',
  ].join('|')
  const isWaitingForThreadData = Boolean(pendingTurn && pendingTurn.threadId === selectedThreadId)
  const isApprovalDialogOpen = Boolean(activeComposerApproval)
  const requiresOpenAIAuth =
    accountQuery.data?.status === 'requires_openai_auth' || isAuthenticationError(accountQuery.error)
  const isThreadSystemError = (threadDetailQuery.data?.status ?? selectedThread?.status) === 'systemError'
  const isThreadInterruptible = Boolean(
    selectedThreadId &&
      (isWaitingForThreadData ||
        statusIsInterruptible(selectedThread?.status) ||
        statusIsInterruptible(latestDisplayedTurn?.status)),
  )
  const isSendBusy = startTurnMutation.isPending || isWaitingForThreadData
  const isThreadProcessing =
    startTurnMutation.isPending || interruptTurnMutation.isPending || isThreadInterruptible
  const isInterruptMode = Boolean(
    selectedThreadId &&
      !isApprovalDialogOpen &&
      !startTurnMutation.isPending &&
      (interruptTurnMutation.isPending || isThreadInterruptible),
  )
  const isComposerLocked =
    isApprovalDialogOpen ||
    startTurnMutation.isPending ||
    interruptTurnMutation.isPending ||
    isThreadInterruptible
  const sendButtonLabel = interruptTurnMutation.isPending
    ? 'Stopping…'
    : startTurnMutation.isPending
      ? 'Sending…'
      : isInterruptMode
        ? 'Stop'
        : requiresOpenAIAuth
          ? 'Reconnect Required'
        : 'Send'
  const shouldShowComposerSpinner =
    startTurnMutation.isPending || interruptTurnMutation.isPending || isInterruptMode
  const composerActivityTitle = interruptTurnMutation.isPending
    ? 'Stopping current reply…'
    : startTurnMutation.isPending || pendingTurn?.phase === 'sending'
      ? 'Sending message to Codex…'
      : isThreadInterruptible
        ? 'Codex is replying…'
        : null
  const composerActivityDetail = interruptTurnMutation.isPending
    ? 'The runtime is stopping the active turn. The thread will settle in place when it completes.'
    : startTurnMutation.isPending || pendingTurn?.phase === 'sending'
      ? 'Your message is staged. The primary action will switch to Stop as soon as the turn is live.'
      : isThreadInterruptible
        ? isThreadPinnedToLatest
          ? 'Auto-follow is keeping the latest output in view.'
          : hasUnreadThreadUpdates
            ? 'New output is available below. Jump to latest to follow it.'
            : 'Scroll back to the latest message to resume auto-follow.'
        : null
  const mobileStatus = isWaitingForThreadData
    ? 'running'
    : selectedThread?.status ?? streamState
  const composerStatusMessage = accountQuery.error
    ? `Unable to verify account status right now. You can keep drafting, but sending may fail: ${getErrorMessage(accountQuery.error)}`
    : requiresOpenAIAuth
      ? 'Codex cannot reply until authentication is fixed. You can keep drafting below, then reconnect the account in Settings → General before sending.'
      : sendError
        ? sendError
        : null
  const activeCommandCount = commandSessions.filter((session) => session.status === 'running').length
  const lastTimelineEventTs =
    selectedThreadEvents[selectedThreadEvents.length - 1]?.ts ?? workspaceEvents[workspaceEvents.length - 1]?.ts
  const terminalDockClassName = [
    'terminal-dock',
    'terminal-dock--attached',
    !commandSessions.length ? 'terminal-dock--empty' : '',
    !isTerminalDockExpanded ? 'terminal-dock--collapsed' : '',
    isTerminalDockResizing ? 'terminal-dock--resizing' : '',
  ]
    .filter(Boolean)
    .join(' ')
  const activeSurfacePanelWidth = surfacePanelView
    ? surfacePanelWidths[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultWidths.feed
  const activeSurfacePanelSide = surfacePanelView
    ? surfacePanelSides[surfacePanelView]
    : layoutConfig.workbench.surfacePanel.defaultSides.feed
  const isMobileInspectorOpen = isMobileViewport && isInspectorExpanded
  const isMobileSurfacePanelOpen = isMobileViewport && Boolean(surfacePanelView)
  const isMobileWorkbenchOverlayOpen = isMobileInspectorOpen || isMobileSurfacePanelOpen
  const workbenchRailWidth = isMobileViewport
    ? '0px'
    : isInspectorExpanded
      ? `${inspectorWidth}px`
      : 'var(--rail-collapsed-width)'
  const workbenchLayoutStyle = {
    ['--surface-panel-width' as string]: `${activeSurfacePanelWidth}px`,
    ['--terminal-dock-height' as string]: `${terminalDockHeight}px`,
    ['--workbench-rail-width' as string]: workbenchRailWidth,
  }

  useEffect(() => {
    if (!isMobileViewport) {
      setMobileThreadToolsOpen(false)
      resetMobileThreadChrome()
      return
    }

    setMobileThreadChrome({
      visible: true,
      statusLabel: compactStatusLabel(mobileStatus),
      statusTone: compactStatusTone(mobileStatus),
    })

    return () => {
      setMobileThreadToolsOpen(false)
      resetMobileThreadChrome()
    }
  }, [
    isMobileViewport,
    mobileStatus,
    resetMobileThreadChrome,
    setMobileThreadChrome,
    setMobileThreadToolsOpen,
  ])

  useEffect(() => {
    if (!isMobileViewport) {
      return
    }

    if (mobileThreadToolsOpen && !isMobileWorkbenchOverlayOpen) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(true)
      return
    }

    if (!mobileThreadToolsOpen && isMobileWorkbenchOverlayOpen) {
      setSurfacePanelView(null)
      setIsInspectorExpanded(false)
    }
  }, [
    isMobileViewport,
    isMobileWorkbenchOverlayOpen,
    mobileThreadToolsOpen,
    setMobileThreadToolsOpen,
  ])

  useEffect(() => {
    if (!selectedThreadId) {
      threadAutoScrollKeyRef.current = ''
      return
    }

    const previousKey = threadAutoScrollKeyRef.current
    if (previousKey === threadAutoScrollKey) {
      return
    }

    const isInitialPaintForThread = !previousKey || !previousKey.startsWith(`${selectedThreadId}|`)
    threadAutoScrollKeyRef.current = threadAutoScrollKey

    const viewport = threadViewportRef.current
    const pinnedToLatest = viewport
      ? isViewportNearBottom(viewport.scrollTop, viewport.scrollHeight, viewport.clientHeight)
      : true

    if (pinnedToLatest) {
      shouldFollowThreadRef.current = true
      setIsThreadPinnedToLatest(true)
    }

    if (shouldFollowThreadRef.current || pinnedToLatest || isInitialPaintForThread) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)

      const frameId = window.requestAnimationFrame(() => {
        threadBottomRef.current?.scrollIntoView({
          behavior: isInitialPaintForThread ? 'auto' : 'smooth',
          block: 'end',
        })
      })

      return () => window.cancelAnimationFrame(frameId)
    }

    setHasUnreadThreadUpdates(true)
  }, [selectedThreadId, threadAutoScrollKey])

  function syncThreadViewportState() {
    const viewport = threadViewportRef.current
    if (!viewport) {
      shouldFollowThreadRef.current = true
      setHasUnreadThreadUpdates(false)
      setIsThreadPinnedToLatest(true)
      return true
    }

    const pinnedToLatest = isViewportNearBottom(
      viewport.scrollTop,
      viewport.scrollHeight,
      viewport.clientHeight,
    )

    shouldFollowThreadRef.current = pinnedToLatest
    setIsThreadPinnedToLatest(pinnedToLatest)

    if (pinnedToLatest) {
      setHasUnreadThreadUpdates(false)
    }

    return pinnedToLatest
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'smooth') {
    shouldFollowThreadRef.current = true
    setHasUnreadThreadUpdates(false)
    setIsThreadPinnedToLatest(true)
    window.requestAnimationFrame(() => {
      threadBottomRef.current?.scrollIntoView({ behavior, block: 'end' })
    })
  }

  function handleThreadViewportScroll() {
    syncThreadViewportState()
  }

  function handleJumpToLatest() {
    scrollThreadToLatest('smooth')
  }

  function handleCreateThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!newThreadName.trim()) {
      return
    }
    createThreadMutation.mutate({
      name: newThreadName.trim(),
      model: composerPreferences.model || undefined,
      permissionPreset: composerPreferences.permissionPreset,
    })
  }

  function handleQuickCreateThread() {
    createThreadMutation.mutate({
      name: newThreadName.trim() || 'New Thread',
      model: composerPreferences.model || undefined,
      permissionPreset: composerPreferences.permissionPreset,
    })
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedThreadId || !selectedThread || !message.trim()) {
      return
    }
    if (requiresOpenAIAuth) {
      setSendError(
        'Authentication is required before Codex can reply. Reconnect the account in Settings → General, then try again.',
      )
      return
    }

    const input = message.trim()
    const optimisticTurn = createPendingTurn(selectedThreadId, input)

    setSendError(null)
    setPendingTurn(optimisticTurn)
    setMessage('')
    scrollThreadToLatest('smooth')

    try {
      let result: TurnResult

      try {
        result = await startTurnMutation.mutateAsync({
          threadId: selectedThreadId,
          input,
          model: composerPreferences.model || undefined,
          reasoningEffort: composerPreferences.reasoningEffort,
          permissionPreset: composerPreferences.permissionPreset,
        })
      } catch (error) {
        if (!shouldRetryTurnAfterResume(error)) {
          throw error
        }

        await resumeThread(workspaceId, selectedThreadId)
        result = await startTurnMutation.mutateAsync({
          threadId: selectedThreadId,
          input,
          model: composerPreferences.model || undefined,
          reasoningEffort: composerPreferences.reasoningEffort,
          permissionPreset: composerPreferences.permissionPreset,
        })
      }

      setPendingTurn((current) =>
        current?.localId === optimisticTurn.localId
          ? {
              ...current,
              phase: 'waiting',
              turnId: result.turnId,
            }
          : current,
      )

      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
      ])
    } catch (error) {
      setPendingTurn((current) => (current?.localId === optimisticTurn.localId ? null : current))
      setMessage(input)
      if (isApiClientErrorCode(error, 'requires_openai_auth')) {
        void queryClient.invalidateQueries({ queryKey: ['account'] })
      }
      setSendError(getErrorMessage(error, 'Failed to send message.'))
    }
  }

  function handleStartCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command.trim()) {
      return
    }
    startCommandMutation.mutate({ command: command.trim() })
  }

  function handleSendStdin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedCommandSession?.id || !stdinValue.trim()) {
      return
    }
    writeCommandMutation.mutate({
      processId: selectedCommandSession.id,
      input: `${stdinValue}\n`,
    })
  }

  function handleApprovalAnswerChange(requestId: string, questionId: string, value: string) {
    setApprovalAnswers((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: value,
      },
    }))
  }

  function handleRespondApproval(input: {
    requestId: string
    action: string
    answers?: Record<string, string[]>
  }) {
    respondApprovalMutation.mutate(input)
  }

  function handlePrimaryComposerAction() {
    if (!isInterruptMode || !selectedThreadId) {
      return
    }

    interruptTurnMutation.mutate()
  }

  function handleTerminalResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    terminalDockResizeRef.current = {
      startY: event.clientY,
      startHeight: terminalDockHeight,
    }
    setIsTerminalDockResizing(true)
  }

  function handleRemoveCommandSession(processId: string) {
    const remainingSessions = commandSessions.filter((session) => session.id !== processId)
    removeCommandSession(workspaceId, processId)

    if (selectedProcessId === processId) {
      setSelectedProcessId(remainingSessions[0]?.id)
    }

    if (!remainingSessions.length) {
      setIsTerminalDockExpanded(false)
    }
  }

  function handleClearCompletedCommandSessions() {
    const remainingSessions = commandSessions.filter((session) => ['running', 'starting'].includes(session.status))
    clearCompletedCommandSessions(workspaceId)

    if (selectedProcessId && !remainingSessions.some((session) => session.id === selectedProcessId)) {
      setSelectedProcessId(remainingSessions[0]?.id)
    }

    if (!remainingSessions.length) {
      setIsTerminalDockExpanded(false)
    }
  }

  function handleOpenInspector() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(true)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  function handleOpenSurfacePanel(view: SurfacePanelView) {
    setIsInspectorExpanded(false)
    setSurfacePanelView(view)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(true)
    }
  }

  function handleCloseWorkbenchOverlay() {
    setSurfacePanelView(null)
    setIsInspectorExpanded(false)
    if (isMobileViewport) {
      setMobileThreadToolsOpen(false)
    }
  }

  function handleSurfacePanelResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    if (!surfacePanelView) {
      return
    }
    surfacePanelResizeRef.current = {
      side: activeSurfacePanelSide,
      startX: event.clientX,
      startWidth: activeSurfacePanelWidth,
      view: surfacePanelView,
    }
    setIsSurfacePanelResizing(true)
  }

  function handleInspectorResizeStart(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault()
    inspectorResizeRef.current = {
      startX: event.clientX,
      startWidth: inspectorWidth,
    }
    setIsInspectorResizing(true)
  }

  function handleResetInspectorWidth() {
    setInspectorWidth(layoutConfig.workbench.rightRail.defaultWidth)
  }

  return (
    <section className={isMobileViewport ? 'screen workbench-screen workbench-screen--mobile' : 'screen workbench-screen'}>
      {isMobileWorkbenchOverlayOpen ? (
        <button
          aria-label="Close workbench panel"
          className="workbench-mobile-backdrop"
          onClick={handleCloseWorkbenchOverlay}
          type="button"
        />
      ) : null}
      <div className="workbench-layout" style={workbenchLayoutStyle}>
        <section className="workbench-main">
          <section className="workbench-surface workbench-surface--ide">
            <div className="workbench-stage__topbar workbench-stage__topbar--compact">
              <div className="workbench-stage__copy">
                <div className="workbench-stage__title-row">
                  <strong>{selectedThread?.name ?? 'No thread selected'}</strong>
                </div>
              </div>
              {!isMobileViewport ? (
                <div className="workbench-stage__meta-bar">
                  <>
                    <button
                      className="ide-button"
                      disabled={createThreadMutation.isPending}
                      onClick={handleQuickCreateThread}
                      type="button"
                    >
                      {createThreadMutation.isPending ? 'Creating…' : 'New Thread'}
                    </button>
                    <button
                      className={surfacePanelView === 'feed' ? 'ide-button ide-button--secondary workbench-stage__peek-button workbench-stage__peek-button--active' : 'ide-button ide-button--secondary workbench-stage__peek-button'}
                      onClick={() => {
                        if (surfacePanelView === 'feed') {
                          setSurfacePanelView(null)
                          return
                        }

                        handleOpenSurfacePanel('feed')
                      }}
                      type="button"
                    >
                      Feed
                    </button>
                    <button
                      className={
                        surfacePanelView === 'approvals'
                          ? 'ide-button ide-button--secondary workbench-stage__peek-button workbench-stage__peek-button--active'
                          : 'ide-button ide-button--secondary workbench-stage__peek-button'
                      }
                      onClick={() => {
                        if (surfacePanelView === 'approvals') {
                          setSurfacePanelView(null)
                          return
                        }

                        handleOpenSurfacePanel('approvals')
                      }}
                      type="button"
                    >
                      Approvals
                    </button>
                    <StatusPill status={streamState} />
                  </>
                </div>
              ) : null}
            </div>

            <div className="workbench-stage__canvas">
              <div className="workbench-log">
                <div
                  aria-busy={isThreadProcessing}
                  className="workbench-log__viewport"
                  onScroll={handleThreadViewportScroll}
                  ref={threadViewportRef}
                >
                  {selectedThread ? (
                    threadDetailQuery.isLoading && !displayedTurns.length ? (
                      <div className="notice">Loading thread surface…</div>
                    ) : threadDetailQuery.error && !displayedTurns.length ? (
                      <InlineNotice
                        dismissible
                        noticeKey={`thread-load-${threadDetailQuery.error instanceof Error ? threadDetailQuery.error.message : 'unknown'}`}
                        title="Failed To Load Thread"
                        tone="error"
                      >
                        {getErrorMessage(threadDetailQuery.error)}
                      </InlineNotice>
                    ) : displayedTurns.length ? (
                      <div className="workbench-log__thread">
                        {isThreadSystemError ? (
                          <InlineNotice
                            dismissible
                            noticeKey={`thread-runtime-${selectedThreadId}-${threadDetailQuery.data?.status ?? selectedThread?.status ?? 'unknown'}`}
                            title="Thread Runtime Error"
                            tone="error"
                          >
                            {requiresOpenAIAuth
                              ? 'OpenAI authentication is required. Reconnect the account in Settings → General before sending again.'
                              : 'Thread status is systemError. The runtime did not return a more specific error message for this turn.'}
                          </InlineNotice>
                        ) : null}
                        <TurnTimeline turns={displayedTurns} />
                        {isWaitingForThreadData ? (
                          <div
                            aria-live="polite"
                            className={
                              pendingTurn?.phase === 'sending'
                                ? 'thread-pending-state thread-pending-state--sending'
                                : 'thread-pending-state thread-pending-state--waiting'
                            }
                            role="status"
                          >
                            <span aria-hidden="true" className="thread-pending-state__spinner" />
                            <div className="thread-pending-state__copy">
                              <strong>
                                {pendingTurn?.phase === 'sending'
                                  ? 'Sending message…'
                                  : 'Generating reply…'}
                              </strong>
                              <span>
                                {pendingTurn?.phase === 'sending'
                                  ? 'Your message is staged and the thread is preparing a response.'
                                  : isThreadPinnedToLatest
                                    ? 'Auto-follow is keeping the newest output in view.'
                                    : 'New output is arriving. Jump to latest to keep following it.'}
                              </span>
                            </div>
                          </div>
                        ) : null}
                        <div aria-hidden="true" className="workbench-log__bottom-anchor" ref={threadBottomRef} />
                      </div>
                    ) : (
                      <div className="empty-state workbench-log__empty">Send the first message to start this thread.</div>
                    )
                  ) : (
                    <div className="empty-state workbench-log__empty">
                      <div className="form-stack">
                        <p>Select a thread from the left sidebar or create a new thread in this workspace.</p>
                        <div className="header-actions">
                          <button
                            className="ide-button"
                            disabled={createThreadMutation.isPending}
                            onClick={handleQuickCreateThread}
                            type="button"
                          >
                            {createThreadMutation.isPending ? 'Creating…' : 'Create Thread'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                {selectedThread && displayedTurns.length && !isThreadPinnedToLatest ? (
                  <div className="workbench-log__jump-shell">
                    <button
                      className={
                        hasUnreadThreadUpdates
                          ? 'workbench-log__jump workbench-log__jump--unread'
                          : 'workbench-log__jump'
                      }
                      onClick={handleJumpToLatest}
                      type="button"
                    >
                      <span aria-hidden="true" className="workbench-log__jump-indicator" />
                      <span>{hasUnreadThreadUpdates ? 'New messages below' : 'Back to latest'}</span>
                    </button>
                  </div>
                ) : null}
                {surfacePanelView ? (
                  <section
                    className={
                      isMobileViewport
                        ? 'workbench-log__panel workbench-log__panel--mobile'
                        : isSurfacePanelResizing
                          ? `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide} workbench-log__panel--resizing`
                          : `workbench-log__panel workbench-log__panel--${activeSurfacePanelSide}`
                    }
                  >
                    {!isMobileViewport ? (
                      <button
                        aria-label="Resize surface panel"
                        className="workbench-log__panel-resize"
                        onPointerDown={handleSurfacePanelResizeStart}
                        type="button"
                      />
                    ) : null}
                    <div className="workbench-log__panel-header">
                      <div>
                        <h2>{surfacePanelView === 'feed' ? 'Live Feed' : 'Approvals'}</h2>
                        <p>
                          {surfacePanelView === 'feed'
                            ? 'Inspect recent live activity without opening the full side rail.'
                            : 'Review pending approvals as a smaller in-surface panel.'}
                        </p>
                      </div>
                      <div className="workbench-log__panel-actions">
                        {!isMobileViewport ? (
                          <button
                            className="pane-section__toggle"
                            onClick={() =>
                              surfacePanelView &&
                              setSurfacePanelSides((current) => ({
                                ...current,
                                [surfacePanelView]:
                                  current[surfacePanelView] === 'right' ? 'left' : 'right',
                              }))
                            }
                            type="button"
                          >
                            {activeSurfacePanelSide === 'right' ? 'Dock Left' : 'Dock Right'}
                          </button>
                        ) : null}
                        <button
                          className="pane-section__toggle"
                          onClick={handleCloseWorkbenchOverlay}
                          type="button"
                        >
                          Close
                        </button>
                      </div>
                    </div>
                    <div className="workbench-log__panel-body">
                      {surfacePanelView === 'feed' ? (
                        liveTimelineEntries.length ? <LiveFeed entries={liveTimelineEntries} /> : <div className="empty-state">No live feed entries yet.</div>
                      ) : approvalsQuery.data?.length ? (
                        <ApprovalStack
                          approvalAnswers={approvalAnswers}
                          approvalErrors={approvalErrors}
                          approvals={approvalsQuery.data}
                          responding={respondApprovalMutation.isPending}
                          onChangeAnswer={handleApprovalAnswerChange}
                          onRespond={handleRespondApproval}
                        />
                      ) : (
                        <div className="empty-state">No pending approvals in this workspace.</div>
                      )}
                    </div>
                  </section>
                ) : null}
              </div>

              <form
                className={isApprovalDialogOpen ? 'composer-dock composer-dock--workbench composer-dock--with-approval' : 'composer-dock composer-dock--workbench'}
                onSubmit={handleSendMessage}
              >
                {activeComposerApproval ? (
                  <ApprovalDialog
                    approval={activeComposerApproval}
                    approvalAnswers={approvalAnswers}
                    approvalErrors={approvalErrors}
                    approvalQueueCount={approvalsQuery.data?.length ?? 0}
                    key={activeComposerApproval.id}
                    responding={respondApprovalMutation.isPending}
                    onChangeAnswer={handleApprovalAnswerChange}
                    onRespond={handleRespondApproval}
                  />
                ) : null}
                {composerStatusMessage ? (
                  <InlineNotice
                    action={
                      requiresOpenAIAuth ? (
                        <Link className="ide-button ide-button--secondary" to="/settings/general">
                          Open Settings
                        </Link>
                      ) : null
                    }
                    className="composer-dock__status-banner"
                    dismissible
                    noticeKey={composerStatusMessage ?? 'composer-status'}
                    title={requiresOpenAIAuth ? 'Authentication Required' : accountQuery.error ? 'Account Status Unavailable' : 'Send Failed'}
                    tone={requiresOpenAIAuth || accountQuery.error ? 'error' : 'info'}
                  >
                    {composerStatusMessage}
                  </InlineNotice>
                ) : null}
                <div
                  aria-busy={isThreadProcessing}
                  className={
                    isThreadProcessing
                      ? 'composer-dock__surface composer-dock__surface--live'
                      : 'composer-dock__surface'
                  }
                >
                  <textarea
                    className="composer-dock__input"
                    disabled={!selectedThread || isComposerLocked}
                    onChange={(event) => {
                      setMessage(event.target.value)
                      if (sendError) {
                        setSendError(null)
                      }
                    }}
                    placeholder={
                      isApprovalDialogOpen
                        ? 'Resolve the approval request above to continue this thread.'
                        : selectedThread
                        ? 'Describe the next task, continue the conversation, or ask for a repo change.'
                        : 'Select a thread to activate the workspace composer.'
                    }
                    rows={isMobileViewport ? 2 : 3}
                    value={message}
                  />
                  {composerActivityTitle && composerActivityDetail ? (
                    <div
                      aria-live="polite"
                      className={
                        interruptTurnMutation.isPending
                          ? 'composer-dock__live-status composer-dock__live-status--interrupt'
                          : 'composer-dock__live-status'
                      }
                      role="status"
                    >
                      <span aria-hidden="true" className="composer-dock__live-status-dot" />
                      <div className="composer-dock__live-status-copy">
                        <strong>{composerActivityTitle}</strong>
                        <span>{composerActivityDetail}</span>
                      </div>
                    </div>
                  ) : null}
                  {isMobileViewport ? (
                    <div className="composer-dock__footer composer-dock__footer--mobile">
                      <div className="composer-dock__mobile-controls">
                        <select
                          aria-label="Permission preset"
                          className="composer-dock__mobile-select"
                          disabled={!workspaceId || isComposerLocked}
                          onChange={(event) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              permissionPreset: normalizePermissionPreset(event.target.value),
                            }))
                          }
                          value={composerPreferences.permissionPreset}
                        >
                          <option value="default">默认权限</option>
                          <option value="full-access">完全访问</option>
                        </select>
                        <select
                          aria-label="Model"
                          className="composer-dock__mobile-select composer-dock__mobile-select--model"
                          disabled={!workspaceId || isComposerLocked || modelsQuery.isLoading}
                          onChange={(event) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              model: event.target.value,
                            }))
                          }
                          value={composerPreferences.model}
                        >
                          <option value="">默认模型</option>
                          {availableModels.map((model) => (
                            <option key={model} value={model}>
                              {model}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label="Reasoning effort"
                          className="composer-dock__mobile-select composer-dock__mobile-select--reasoning"
                          disabled={!workspaceId || isComposerLocked}
                          onChange={(event) =>
                            setComposerPreferences((current) => ({
                              ...current,
                              reasoningEffort: normalizeReasoningEffort(event.target.value),
                            }))
                          }
                          value={composerPreferences.reasoningEffort}
                        >
                          <option value="low">低推理</option>
                          <option value="medium">中推理</option>
                          <option value="high">高推理</option>
                          <option value="xhigh">超高推理</option>
                        </select>
                      </div>
                      <div className="composer-dock__actions">
                        <button
                          aria-label={sendButtonLabel}
                          className={
                            isInterruptMode
                              ? 'ide-button composer-dock__action composer-dock__action--interrupt composer-dock__action--mobile'
                              : isSendBusy
                                ? 'ide-button ide-button--busy composer-dock__action composer-dock__action--mobile'
                                : 'ide-button composer-dock__action composer-dock__action--mobile'
                          }
                          disabled={
                            isInterruptMode
                              ? !selectedThreadId || interruptTurnMutation.isPending
                              : !selectedThread || isComposerLocked || requiresOpenAIAuth || !message.trim()
                          }
                          onClick={isInterruptMode ? handlePrimaryComposerAction : undefined}
                          title={sendButtonLabel}
                          type={isInterruptMode ? 'button' : 'submit'}
                        >
                          {isInterruptMode ? (
                            <span
                              aria-hidden="true"
                              className={
                                shouldShowComposerSpinner
                                  ? 'composer-dock__action-icon composer-dock__action-icon--spinning'
                                  : 'composer-dock__action-icon'
                              }
                            >
                              <StopIcon />
                            </span>
                          ) : shouldShowComposerSpinner ? (
                            <span aria-hidden="true" className="composer-dock__spinner" />
                          ) : (
                            <span aria-hidden="true" className="composer-dock__action-icon">
                              <SendIcon />
                            </span>
                          )}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="composer-dock__footer">
                      <div className="composer-dock__footer-main">
                        <div className="composer-dock__control-strip">
                          <div
                            className={
                              composerPreferences.permissionPreset === 'full-access'
                                ? 'composer-control-group composer-control-group--active composer-control-group--danger-active'
                                : 'composer-control-group composer-control-group--active'
                            }
                            role="group"
                            aria-label="权限"
                          >
                            <span className="composer-control-group__label">权限</span>
                            <div className="segmented-control composer-control-group__segmented">
                              <button
                                className={
                                  composerPreferences.permissionPreset === 'default'
                                    ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                                    : 'segmented-control__item composer-control-group__item'
                                }
                                aria-pressed={composerPreferences.permissionPreset === 'default'}
                                disabled={!workspaceId || isComposerLocked}
                                onClick={() =>
                                  setComposerPreferences((current) => ({
                                    ...current,
                                    permissionPreset: 'default',
                                  }))
                                }
                                type="button"
                              >
                                默认
                              </button>
                              <button
                                className={
                                  composerPreferences.permissionPreset === 'full-access'
                                    ? 'segmented-control__item segmented-control__item--active composer-control-group__item composer-control-group__item--danger'
                                    : 'segmented-control__item composer-control-group__item composer-control-group__item--danger'
                                }
                                aria-pressed={composerPreferences.permissionPreset === 'full-access'}
                                disabled={!workspaceId || isComposerLocked}
                                onClick={() =>
                                  setComposerPreferences((current) => ({
                                    ...current,
                                    permissionPreset: 'full-access',
                                  }))
                                }
                                type="button"
                              >
                                完全访问
                              </button>
                            </div>
                          </div>
                          <label
                            className={
                              composerPreferences.model
                                ? 'composer-control-select composer-control-select--active composer-control-select--model'
                                : 'composer-control-select composer-control-select--model'
                            }
                          >
                            <span className="composer-control-group__label">模型</span>
                            <select
                              className="composer-control-select__input"
                              disabled={!workspaceId || isComposerLocked || modelsQuery.isLoading}
                              onChange={(event) =>
                                setComposerPreferences((current) => ({
                                  ...current,
                                  model: event.target.value,
                                }))
                              }
                              value={composerPreferences.model}
                            >
                              <option value="">默认模型</option>
                              {availableModels.map((model) => (
                                <option key={model} value={model}>
                                  {model}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="composer-control-group composer-control-group--active" role="group" aria-label="推理强度">
                            <span className="composer-control-group__label">推理</span>
                            <div className="segmented-control composer-control-group__segmented">
                              {[
                                ['low', '低'],
                                ['medium', '中'],
                                ['high', '高'],
                                ['xhigh', '超高'],
                              ].map(([value, label]) => (
                                <button
                                  className={
                                    composerPreferences.reasoningEffort === value
                                      ? 'segmented-control__item segmented-control__item--active composer-control-group__item'
                                      : 'segmented-control__item composer-control-group__item'
                                  }
                                  aria-pressed={composerPreferences.reasoningEffort === value}
                                  disabled={!workspaceId || isComposerLocked}
                                  key={value}
                                  onClick={() =>
                                    setComposerPreferences((current) => ({
                                      ...current,
                                      reasoningEffort: normalizeReasoningEffort(value),
                                    }))
                                  }
                                  type="button"
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                        <div className="composer-dock__meta composer-dock__meta--surface">
                          {selectedThread ? <span className="meta-pill">{selectedThread.status}</span> : null}
                          {isApprovalDialogOpen ? <span className="meta-pill">approval required</span> : null}
                          {isWaitingForThreadData ? <span className="composer-dock__hint">Waiting for backend turn data…</span> : null}
                        </div>
                      </div>
                      <div className="composer-dock__actions">
                        <button
                          className={
                            isInterruptMode
                              ? 'ide-button composer-dock__action composer-dock__action--interrupt'
                              : isSendBusy
                                ? 'ide-button ide-button--busy composer-dock__action'
                                : 'ide-button composer-dock__action'
                          }
                          disabled={
                            isInterruptMode
                              ? !selectedThreadId || interruptTurnMutation.isPending
                              : !selectedThread || isComposerLocked || requiresOpenAIAuth || !message.trim()
                          }
                          onClick={isInterruptMode ? handlePrimaryComposerAction : undefined}
                          type={isInterruptMode ? 'button' : 'submit'}
                        >
                          {isInterruptMode ? (
                            <span
                              aria-hidden="true"
                              className={
                                shouldShowComposerSpinner
                                  ? 'composer-dock__action-icon composer-dock__action-icon--spinning'
                                  : 'composer-dock__action-icon'
                              }
                            >
                              <StopIcon />
                            </span>
                          ) : shouldShowComposerSpinner ? (
                            <span aria-hidden="true" className="composer-dock__spinner" />
                          ) : null}
                          <span>{sendButtonLabel}</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </form>
            </div>

            {!isMobileViewport ? (
            <section className={terminalDockClassName}>
              <div className="terminal-dock__bar">
                <div className="terminal-dock__bar-copy">
                  <h2>Terminal</h2>
                </div>
                <div className="terminal-dock__bar-meta">
                  {isTerminalDockExpanded ? (
                    <>
                      <span className="meta-pill">{commandSessions.length} sessions</span>
                      <span className="meta-pill">{activeCommandCount} running</span>
                      <span className="meta-pill">
                        {selectedCommandSession?.updatedAt
                          ? `updated ${formatRelativeTimeShort(selectedCommandSession.updatedAt)}`
                          : 'idle'}
                      </span>
                      {commandSessions.some((session) => !['running', 'starting'].includes(session.status)) ? (
                        <button
                          className="terminal-dock__toggle"
                          onClick={handleClearCompletedCommandSessions}
                          type="button"
                        >
                          Clear Finished
                        </button>
                      ) : null}
                    </>
                  ) : commandSessions.length ? (
                    <span className="meta-pill">
                      {activeCommandCount ? `${activeCommandCount} active` : `${commandSessions.length} stored`}
                    </span>
                  ) : null}
                  <button
                    aria-expanded={isTerminalDockExpanded}
                    className="terminal-dock__toggle"
                    onClick={() => setIsTerminalDockExpanded((current) => !current)}
                    type="button"
                  >
                    {isTerminalDockExpanded ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {isTerminalDockExpanded ? (
                <>
                  <ResizeHandle
                    aria-label="Resize terminal dock"
                    axis="vertical"
                    className="terminal-dock__resize-handle"
                    onPointerDown={handleTerminalResizeStart}
                  />
                  {commandSessions.length ? (
                    <div className="terminal-dock__workspace">
                      <div className="terminal-dock__tabs">
                        {commandSessions.map((session) => (
                          <div
                            className={
                              session.id === selectedCommandSession?.id
                                ? 'terminal-dock__tab terminal-dock__tab--active'
                                : 'terminal-dock__tab'
                            }
                            key={session.id}
                          >
                            <button
                              className="terminal-dock__tab-select"
                              onClick={() => setSelectedProcessId(session.id)}
                              type="button"
                            >
                              <strong>{session.command}</strong>
                              <span>
                                {session.status}
                                {session.updatedAt ? ` · ${formatRelativeTimeShort(session.updatedAt)}` : ''}
                              </span>
                            </button>
                            <button
                              aria-label={`Close ${session.command}`}
                              className="terminal-dock__tab-close"
                              onClick={() => handleRemoveCommandSession(session.id)}
                              type="button"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="terminal-dock__console-shell">
                        <div className="terminal-dock__console">
                          <div className="terminal-dock__meta">
                            <span>{selectedCommandSession?.status ?? 'idle'}</span>
                            {typeof selectedCommandSession?.exitCode === 'number' ? <span>exit {selectedCommandSession.exitCode}</span> : null}
                            {selectedCommandSession?.id ? <code>{selectedCommandSession.id}</code> : null}
                          </div>
                          <pre className="code-block code-block--terminal">
                            {selectedCommandSession?.combinedOutput || 'Run a command to see output.'}
                          </pre>
                          <form className="terminal-dock__input" onSubmit={handleSendStdin}>
                            <input
                              disabled={!selectedCommandSession?.id}
                              onChange={(event) => setStdinValue(event.target.value)}
                              placeholder="Send stdin to selected process"
                              value={stdinValue}
                            />
                            <button className="ide-button ide-button--secondary" disabled={!selectedCommandSession?.id || !stdinValue.trim()} type="submit">
                              Send
                            </button>
                            <button
                              className="ide-button ide-button--secondary"
                              disabled={!selectedCommandSession?.id}
                              onClick={() => selectedCommandSession?.id && terminateCommandMutation.mutate(selectedCommandSession.id)}
                              type="button"
                            >
                              Stop
                            </button>
                          </form>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="terminal-dock__empty">
                      Run a command to mount the dock. Sessions stay attached to the workspace and can be revisited from this bottom panel.
                    </div>
                  )}
                </>
              ) : null}
            </section>
            ) : null}
          </section>
        </section>

        {isInspectorExpanded ? (
          <aside
            className={
              isMobileViewport
                ? 'workbench-pane workbench-pane--expanded workbench-pane--mobile'
                : isInspectorResizing
                  ? 'workbench-pane workbench-pane--expanded workbench-pane--resizing'
                  : 'workbench-pane workbench-pane--expanded'
            }
          >
            {!isMobileViewport ? (
              <ResizeHandle
                aria-label="Resize side rail"
                axis="horizontal"
                className="workbench-pane__resize-handle"
                onPointerDown={handleInspectorResizeStart}
              />
            ) : null}
            <div className="workbench-pane__topbar">
              <span className="meta-pill">{isMobileViewport ? 'workbench' : 'side rail'}</span>
              <div className="workbench-pane__topbar-actions">
                {!isMobileViewport ? (
                  <button className="pane-section__toggle" onClick={handleResetInspectorWidth} type="button">
                    Reset Width
                  </button>
                ) : null}
                <button
                  className="pane-section__toggle"
                  onClick={handleCloseWorkbenchOverlay}
                  type="button"
                >
                  {isMobileViewport ? 'Close' : 'Hide Rail'}
                </button>
              </div>
            </div>

            {isMobileViewport ? (
              <div className="pane-section">
                <div className="section-header section-header--inline">
                  <div>
                    <h2>Quick Actions</h2>
                    <p>Only open side panels when you need them.</p>
                  </div>
                </div>
                <div className="workbench-mobile-actions">
                  <button
                    className="pane-section__toggle workbench-mobile-actions__button"
                    disabled={createThreadMutation.isPending}
                    onClick={handleQuickCreateThread}
                    type="button"
                  >
                    {createThreadMutation.isPending ? 'Creating…' : 'New Thread'}
                  </button>
                  <button
                    className={surfacePanelView === 'feed' ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active' : 'pane-section__toggle workbench-mobile-actions__button'}
                    onClick={() => {
                      handleCloseWorkbenchOverlay()
                      handleOpenSurfacePanel('feed')
                    }}
                    type="button"
                  >
                    Feed
                  </button>
                  <button
                    className={surfacePanelView === 'approvals' ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active' : 'pane-section__toggle workbench-mobile-actions__button'}
                    onClick={() => {
                      handleCloseWorkbenchOverlay()
                      handleOpenSurfacePanel('approvals')
                    }}
                    type="button"
                  >
                    Approvals
                  </button>
                </div>
              </div>
            ) : null}

            <div className="pane-section">
              <div className="section-header section-header--inline">
                <div>
                  <h2>Thread Tools</h2>
                  <p>Low-frequency thread management stays folded unless you need it.</p>
                </div>
                <button
                  className="pane-section__toggle"
                  onClick={() => setIsThreadToolsExpanded((current) => !current)}
                  type="button"
                >
                  {isThreadToolsExpanded ? 'Hide' : 'Show'}
                </button>
              </div>
              {isThreadToolsExpanded ? (
                <>
                  <form className="form-stack" onSubmit={handleCreateThread}>
                    <label className="field">
                      <span>New Thread</span>
                      <input onChange={(event) => setNewThreadName(event.target.value)} value={newThreadName} />
                    </label>
                    <button className="ide-button" disabled={!newThreadName.trim()} type="submit">
                      {createThreadMutation.isPending ? 'Creating…' : 'Create Thread'}
                    </button>
                  </form>

                  {selectedThread ? (
                    <>
                      <div className="header-actions">
                        <button
                          className="ide-button ide-button--secondary"
                          onClick={() => {
                            setEditingThreadId(selectedThread.id)
                            setEditingThreadName(selectedThread.name)
                          }}
                          type="button"
                        >
                          Rename
                        </button>
                        <button
                          className="ide-button ide-button--secondary"
                          onClick={() =>
                            selectedThread.archived
                              ? unarchiveThreadMutation.mutate(selectedThread.id)
                              : archiveThreadMutation.mutate(selectedThread.id)
                          }
                          type="button"
                        >
                          {selectedThread.archived ? 'Unarchive' : 'Archive'}
                        </button>
                      </div>

                      {editingThreadId === selectedThread.id ? (
                        <form className="form-stack" onSubmit={(event) => {
                          event.preventDefault()
                          if (!editingThreadName.trim()) {
                            return
                          }
                          renameThreadMutation.mutate({
                            threadId: selectedThread.id,
                            name: editingThreadName.trim(),
                          })
                        }}>
                          <label className="field">
                            <span>Rename Thread</span>
                            <input onChange={(event) => setEditingThreadName(event.target.value)} value={editingThreadName} />
                          </label>
                          <div className="header-actions">
                            <button className="ide-button" disabled={!editingThreadName.trim()} type="submit">
                              Save
                            </button>
                            <button className="ide-button ide-button--secondary" onClick={() => setEditingThreadId(undefined)} type="button">
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </>
                  ) : null}
                </>
              ) : null}
            </div>

            <div className="pane-section">
              <div className="section-header">
                <div>
                  <h2>Workspace Context</h2>
                  <p>Persistent context stays in the rail. Feed and approvals open as lighter in-surface panels.</p>
                </div>
              </div>
              <div className="detail-list">
                <div className="detail-row">
                  <span>Workspace</span>
                  <strong>{workspaceQuery.data?.name ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>Stream</span>
                  <strong>{streamState}</strong>
                </div>
                <div className="detail-row">
                  <span>Threads</span>
                  <strong>{threadsQuery.data?.length ?? 0}</strong>
                </div>
                <div className="detail-row">
                  <span>Root Path</span>
                  <strong>{workspaceQuery.data?.rootPath ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>Selected Thread</span>
                  <strong>{selectedThread?.name ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>CWD</span>
                  <strong>{threadDetailQuery.data?.cwd ?? '—'}</strong>
                </div>
                <div className="detail-row">
                  <span>Turns</span>
                  <strong>{turnCount}</strong>
                </div>
                <div className="detail-row">
                  <span>Timeline Items</span>
                  <strong>{timelineItemCount}</strong>
                </div>
                <div className="detail-row">
                  <span>Pending Approvals</span>
                  <strong>{approvalsQuery.data?.length ?? 0}</strong>
                </div>
                <div className="detail-row">
                  <span>Activity</span>
                  <strong>{lastTimelineEventTs ? formatRelativeTimeShort(lastTimelineEventTs) : 'idle'}</strong>
                </div>
                <div className="detail-row">
                  <span>Commands</span>
                  <strong>{commandSessions.length}</strong>
                </div>
              </div>
            </div>

            <div className="pane-section pane-section--command">
              <div className="section-header section-header--inline">
                <div>
                  <h2>Workbench Tools</h2>
                  <p>Global shortcuts and ad-hoc commands stay collapsed by default.</p>
                </div>
                <button
                  className="pane-section__toggle"
                  onClick={() => setIsWorkbenchToolsExpanded((current) => !current)}
                  type="button"
                >
                  {isWorkbenchToolsExpanded ? 'Hide' : 'Show'}
                </button>
              </div>
              {isWorkbenchToolsExpanded ? (
                <>
                  <div className="pane-link-grid">
                    <Link className="ide-button ide-button--secondary" to="/automations">
                      Automations
                    </Link>
                    <Link className="ide-button ide-button--secondary" to="/skills">
                      Skills
                    </Link>
                    <Link className="ide-button ide-button--secondary" to="/runtime">
                      Runtime
                    </Link>
                  </div>
                  <form className="form-stack" onSubmit={handleStartCommand}>
                    <label className="field">
                      <span>Run Command</span>
                      <input
                        onChange={(event) => setCommand(event.target.value)}
                        placeholder="pnpm test --filter frontend"
                        value={command}
                      />
                    </label>
                    <button className="ide-button" disabled={!command.trim()} type="submit">
                      {startCommandMutation.isPending ? 'Starting…' : 'Run Command'}
                    </button>
                  </form>
                </>
              ) : null}
            </div>

          </aside>
        ) : !isMobileViewport ? (
          <aside className="workbench-pane workbench-pane--collapsed">
            <div className="workbench-pane__collapsed">
              <RailIconButton
                aria-label="Open side rail"
                className="workbench-pane__mini-button"
                onClick={handleOpenInspector}
                primary
                title="Open side rail"
              >
                <PanelOpenIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open workspace context"
                className="workbench-pane__mini-button"
                onClick={handleOpenInspector}
                title="Context"
              >
                <ContextIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open live feed panel"
                className="workbench-pane__mini-button"
                onClick={() => handleOpenSurfacePanel('feed')}
                title="Feed"
              >
                <FeedIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open approvals panel"
                className="workbench-pane__mini-button"
                onClick={() => handleOpenSurfacePanel('approvals')}
                title="Approvals"
              >
                <ApprovalIcon />
              </RailIconButton>
              <RailIconButton
                aria-label="Open workbench tools"
                className="workbench-pane__mini-button"
                onClick={handleOpenInspector}
                title="Tools"
              >
                <ToolsIcon />
              </RailIconButton>
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  )
}
