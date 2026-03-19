import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useParams } from 'react-router-dom'

import { McpElicitationForm } from '../components/approvals/McpElicitationForm'
import { HistoryItemCard } from '../components/thread/HistoryItemCard'
import { LiveEventCard } from '../components/thread/LiveEventCard'
import { buildLiveTimelineEntries } from '../components/thread/liveTimeline'
import { StatusBadge } from '../components/ui/StatusBadge'
import { listPendingApprovals, respondServerRequestWithDetails } from '../features/approvals/api'
import { startCommand, terminateCommand, writeCommand } from '../features/commands/api'
import { archiveThread, createThread, getThread, listThreads, renameThread, unarchiveThread } from '../features/threads/api'
import { interruptTurn, startTurn } from '../features/turns/api'
import { getWorkspace } from '../features/workspaces/api'
import { useWorkspaceStream } from '../hooks/useWorkspaceStream'
import { useSessionStore } from '../stores/session-store'
import type { CommandRuntimeSession } from '../stores/session-store'
import { useUIStore } from '../stores/ui-store'
import type {
  ApprovalDetails,
  ApprovalQuestion,
  PendingApproval,
  ServerEvent,
  Thread,
} from '../types/api'

const threadFilterOptions = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'idle', label: 'Idle' },
  { value: 'archived', label: 'Archived' },
] as const

const recentThreadStoragePrefix = 'codex-server:recent-threads:'
const threadSidebarPrefsStoragePrefix = 'codex-server:thread-sidebar:'
const EMPTY_EVENTS: ServerEvent[] = []
const EMPTY_COMMAND_SESSIONS: Record<string, CommandRuntimeSession> = {}
type UtilityPanelTab = 'details' | 'terminal' | 'approvals'

export function ThreadPage() {
  const { workspaceId = '' } = useParams()
  const queryClient = useQueryClient()
  const threadSearchRef = useRef<HTMLInputElement | null>(null)
  const [threadName, setThreadName] = useState('New Thread')
  const [threadSearch, setThreadSearch] = useState('')
  const [threadFilter, setThreadFilter] = useState<'all' | 'active' | 'idle' | 'archived'>('all')
  const [editingThreadId, setEditingThreadId] = useState<string>()
  const [editingThreadName, setEditingThreadName] = useState('')
  const [recentThreadAccess, setRecentThreadAccess] = useState<Record<string, string>>({})
  const [message, setMessage] = useState('')
  const [command, setCommand] = useState('git status')
  const [stdinValue, setStdinValue] = useState('')
  const [selectedProcessId, setSelectedProcessId] = useState<string>()
  const [utilityPanelTab, setUtilityPanelTab] = useState<UtilityPanelTab>('details')
  const [approvalAnswers, setApprovalAnswers] = useState<Record<string, Record<string, string>>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  const utilityPanelOpen = useUIStore((state) => state.utilityPanelOpen)
  const setUtilityPanelOpen = useUIStore((state) => state.setUtilityPanelOpen)
  const selectedThreadId = useSessionStore((state) => state.selectedThreadId)
  const setSelectedWorkspace = useSessionStore((state) => state.setSelectedWorkspace)
  const setSelectedThread = useSessionStore((state) => state.setSelectedThread)
  const streamState = useWorkspaceStream(workspaceId)
  const deferredThreadSearch = useDeferredValue(threadSearch)

  const workspaceQuery = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const threadsQuery = useQuery({
    queryKey: ['threads', workspaceId],
    queryFn: () => listThreads(workspaceId),
    enabled: Boolean(workspaceId),
  })

  const threadDetailQuery = useQuery({
    queryKey: ['thread-detail', workspaceId, selectedThreadId],
    queryFn: () => getThread(workspaceId, selectedThreadId ?? ''),
    enabled: Boolean(workspaceId && selectedThreadId),
    refetchInterval: selectedThreadId ? 5_000 : false,
  })

  const approvalsQuery = useQuery({
    queryKey: ['approvals', workspaceId],
    queryFn: () => listPendingApprovals(workspaceId),
    enabled: Boolean(workspaceId),
    refetchInterval: utilityPanelOpen && utilityPanelTab === 'approvals' ? 3_000 : false,
  })

  const createThreadMutation = useMutation({
    mutationFn: (input: { name: string }) => createThread(workspaceId, input),
    onSuccess: (thread) => {
      setThreadName('New Thread')
      setSelectedThread(workspaceId, thread.id)
      void queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] })
    },
  })

  const startTurnMutation = useMutation({
    mutationFn: (input: { input: string }) => startTurn(workspaceId, selectedThreadId ?? '', input),
    onSuccess: () => {
      setMessage('')
    },
  })

  const interruptTurnMutation = useMutation({
    mutationFn: () => interruptTurn(workspaceId, selectedThreadId ?? ''),
  })

  const archiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => archiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] })
    },
  })

  const unarchiveThreadMutation = useMutation({
    mutationFn: (threadId: string) => unarchiveThread(workspaceId, threadId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] })
    },
  })

  const renameThreadMutation = useMutation({
    mutationFn: ({ threadId, name }: { threadId: string; name: string }) =>
      renameThread(workspaceId, threadId, { name }),
    onSuccess: async (_, variables) => {
      setEditingThreadId(undefined)
      setEditingThreadName('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, variables.threadId] }),
      ])
    },
  })

  const respondApprovalMutation = useMutation({
    mutationFn: ({
      requestId,
      action,
      answers,
      content,
    }: {
      requestId: string
      action: string
      answers?: Record<string, string[]>
      content?: unknown
    }) => respondServerRequestWithDetails(requestId, { action, answers, content }),
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

  const selectedThreadEvents = useSessionStore((state) =>
    selectedThreadId ? state.eventsByThread[selectedThreadId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceEvents = useSessionStore((state) =>
    workspaceId ? state.workspaceEventsByWorkspace[workspaceId] ?? EMPTY_EVENTS : EMPTY_EVENTS,
  )
  const workspaceCommandSessions = useSessionStore((state) =>
    workspaceId
      ? state.commandSessionsByWorkspace[workspaceId] ?? EMPTY_COMMAND_SESSIONS
      : EMPTY_COMMAND_SESSIONS,
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
    if (!workspaceId) {
      setRecentThreadAccess({})
      return
    }

    try {
      const raw = window.localStorage.getItem(`${recentThreadStoragePrefix}${workspaceId}`)
      setRecentThreadAccess(raw ? (JSON.parse(raw) as Record<string, string>) : {})
    } catch {
      setRecentThreadAccess({})
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      setThreadSearch('')
      setThreadFilter('all')
      return
    }

    try {
      const raw = window.localStorage.getItem(`${threadSidebarPrefsStoragePrefix}${workspaceId}`)
      if (!raw) {
        setThreadSearch('')
        setThreadFilter('all')
        return
      }

      const parsed = JSON.parse(raw) as {
        search?: string
        filter?: 'all' | 'active' | 'idle' | 'archived'
      }

      setThreadSearch(parsed.search ?? '')
      setThreadFilter(parsed.filter ?? 'all')
    } catch {
      setThreadSearch('')
      setThreadFilter('all')
    }
  }, [workspaceId])

  useEffect(() => {
    const firstThread = threadsQuery.data?.[0]
    const hasSelectedThread = threadsQuery.data?.some((thread) => thread.id === selectedThreadId)

    if (firstThread && !hasSelectedThread) {
      setSelectedThread(workspaceId, firstThread.id)
    }
  }, [selectedThreadId, setSelectedThread, threadsQuery.data, workspaceId])

  useEffect(() => {
    if (!workspaceId || !selectedThreadId) {
      return
    }

    setRecentThreadAccess((current) => {
      const next = {
        ...current,
        [selectedThreadId]: new Date().toISOString(),
      }

      try {
        window.localStorage.setItem(`${recentThreadStoragePrefix}${workspaceId}`, JSON.stringify(next))
      } catch {
        // Ignore storage failures in the browser.
      }

      return next
    })
  }, [selectedThreadId, workspaceId])

  useEffect(() => {
    if (!workspaceId) {
      return
    }

    try {
      window.localStorage.setItem(
        `${threadSidebarPrefsStoragePrefix}${workspaceId}`,
        JSON.stringify({
          search: threadSearch,
          filter: threadFilter,
        }),
      )
    } catch {
      // Ignore storage failures in the browser.
    }
  }, [threadFilter, threadSearch, workspaceId])

  const selectedThread = useMemo(
    () => threadsQuery.data?.find((thread) => thread.id === selectedThreadId),
    [selectedThreadId, threadsQuery.data],
  )
  const filteredThreads = useMemo(() => {
    const normalizedSearch = deferredThreadSearch.trim().toLowerCase()

    return (threadsQuery.data ?? []).filter((thread) => {
      const matchesSearch =
        normalizedSearch === '' ||
        thread.name.toLowerCase().includes(normalizedSearch) ||
        thread.id.toLowerCase().includes(normalizedSearch)

      if (!matchesSearch) {
        return false
      }

      switch (threadFilter) {
        case 'active':
          return !thread.archived && thread.status === 'active'
        case 'idle':
          return !thread.archived && thread.status === 'idle'
        case 'archived':
          return thread.archived
        default:
          return true
      }
    })
  }, [deferredThreadSearch, threadFilter, threadsQuery.data])
  const groupedThreads = useMemo(
    () => ({
      active: sortThreads(
        filteredThreads.filter((thread) => !thread.archived),
        recentThreadAccess,
      ),
      archived: sortThreads(
        filteredThreads.filter((thread) => thread.archived),
        recentThreadAccess,
      ),
    }),
    [filteredThreads, recentThreadAccess],
  )
  const allVisibleThreads = useMemo(
    () => [...groupedThreads.active, ...groupedThreads.archived],
    [groupedThreads],
  )
  const threadCounts = useMemo(
    () => ({
      all: threadsQuery.data?.length ?? 0,
      active: threadsQuery.data?.filter((thread) => !thread.archived && thread.status === 'active').length ?? 0,
      idle: threadsQuery.data?.filter((thread) => !thread.archived && thread.status === 'idle').length ?? 0,
      archived: threadsQuery.data?.filter((thread) => thread.archived).length ?? 0,
    }),
    [threadsQuery.data],
  )
  const selectedThreadDetail = threadDetailQuery.data
  const liveEvents = useMemo(
    () =>
      [...workspaceEvents, ...selectedThreadEvents].sort(
        (left, right) => new Date(left.ts).getTime() - new Date(right.ts).getTime(),
      ),
    [selectedThreadEvents, workspaceEvents],
  )
  const liveTimelineEntries = useMemo(() => buildLiveTimelineEntries(liveEvents), [liveEvents])
  const selectedCommandSession = useMemo(
    () => commandSessions.find((session) => session.id === selectedProcessId) ?? commandSessions[0],
    [commandSessions, selectedProcessId],
  )
  const pendingApprovalCount = approvalsQuery.data?.length ?? 0
  const selectedThreadTurnCount = selectedThreadDetail?.turns?.length ?? 0

  useEffect(() => {
    if (selectedCommandSession && selectedCommandSession.id !== selectedProcessId) {
      setSelectedProcessId(selectedCommandSession.id)
    }
  }, [selectedCommandSession, selectedProcessId])

  useEffect(() => {
    const latestEvent = selectedThreadEvents[selectedThreadEvents.length - 1]
    if (latestEvent?.method === 'turn/completed' && selectedThreadId) {
      void queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId, selectedThreadId] })
    }
  }, [queryClient, selectedThreadEvents, selectedThreadId, workspaceId])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault()
        threadSearchRef.current?.focus()
        threadSearchRef.current?.select()
        return
      }

      if (event.key === 'Escape') {
        if (editingThreadId) {
          event.preventDefault()
          setEditingThreadId(undefined)
          setEditingThreadName('')
          return
        }

        if (document.activeElement === threadSearchRef.current) {
          event.preventDefault()
          threadSearchRef.current?.blur()
        }
        return
      }

      if (isEditableTarget(event.target) || allVisibleThreads.length === 0) {
        return
      }

      const currentIndex = allVisibleThreads.findIndex((thread) => thread.id === selectedThreadId)
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        const nextIndex = currentIndex >= 0 ? Math.min(allVisibleThreads.length - 1, currentIndex + 1) : 0
        setSelectedThread(workspaceId, allVisibleThreads[nextIndex].id)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        const nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : 0
        setSelectedThread(workspaceId, allVisibleThreads[nextIndex].id)
        return
      }

      if (event.key === 'Enter' && !selectedThreadId && allVisibleThreads[0]) {
        event.preventDefault()
        setSelectedThread(workspaceId, allVisibleThreads[0].id)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [allVisibleThreads, editingThreadId, selectedThreadId, setSelectedThread, workspaceId])

  function handleCreateThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createThreadMutation.mutate({ name: threadName })
  }

  function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedThreadId) {
      return
    }
    startTurnMutation.mutate({ input: message })
  }

  function beginRenameThread(thread: Thread) {
    setEditingThreadId(thread.id)
    setEditingThreadName(thread.name)
  }

  function handleRenameThread(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editingThreadId || !editingThreadName.trim()) {
      return
    }

    renameThreadMutation.mutate({
      threadId: editingThreadId,
      name: editingThreadName.trim(),
    })
  }

  const startCommandMutation = useMutation({
    mutationFn: (input: { command: string }) => startCommand(workspaceId, input),
    onSuccess: (session) => {
      useSessionStore.getState().upsertCommandSession(session)
      setSelectedProcessId(session.id)
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

  function handleStartCommand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!command.trim()) {
      return
    }

    startCommandMutation.mutate({ command })
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

  function updateApprovalAnswer(requestId: string, questionId: string, value: string) {
    setApprovalAnswers((current) => ({
      ...current,
      [requestId]: {
        ...(current[requestId] ?? {}),
        [questionId]: value,
      },
    }))
    setApprovalErrors((current) => ({
      ...current,
      [requestId]: '',
    }))
  }

  function submitQuestionApproval(approval: PendingApproval) {
    const questions = getApprovalQuestions(approval)
    const values = approvalAnswers[approval.id] ?? {}
    const missing = questions.find((question) => !values[question.id]?.trim())

    if (missing) {
      setApprovalErrors((current) => ({
        ...current,
        [approval.id]: `Please answer ${missing.header || missing.id} before submitting.`,
      }))
      return
    }

    const answers = Object.fromEntries(
      questions.map((question) => [question.id, [values[question.id].trim()]]),
    )

    respondApprovalMutation.mutate({
      requestId: approval.id,
      action: 'accept',
      answers,
    })
  }

  function toggleUtilityPanel(tab: UtilityPanelTab) {
    if (utilityPanelOpen && utilityPanelTab === tab) {
      setUtilityPanelOpen(false)
      return
    }

    setUtilityPanelTab(tab)
    setUtilityPanelOpen(true)
  }

  return (
    <section className="page">
      <header className="page__header">
        <div>
          <p className="eyebrow">Workspace Session</p>
          <h1>{workspaceQuery.data?.name ?? 'Workspace'}</h1>
          <p className="page__description">{workspaceQuery.data?.rootPath ?? 'Loading workspace details...'}</p>
          <div className="page__meta-row">
            <span className="stat-pill">{threadsQuery.data?.length ?? 0} threads</span>
            <span className="stat-pill">{selectedThreadTurnCount} turns</span>
            <span className="stat-pill">{liveTimelineEntries.length} live events</span>
            <span className="stat-pill">{commandSessions.length} commands</span>
            <span className="stat-pill">{pendingApprovalCount} approvals</span>
          </div>
        </div>
        <div className="page__actions thread-page__actions">
          <StatusBadge status={streamState} />
          <div className="thread-utility-toggles">
            <button
              className={utilityPanelButtonClassName(utilityPanelOpen, utilityPanelTab, 'details')}
              onClick={() => toggleUtilityPanel('details')}
              type="button"
            >
              <span>Details</span>
            </button>
            <button
              className={utilityPanelButtonClassName(utilityPanelOpen, utilityPanelTab, 'terminal')}
              onClick={() => toggleUtilityPanel('terminal')}
              type="button"
            >
              <span>Terminal</span>
              <small>{commandSessions.length}</small>
            </button>
            <button
              className={utilityPanelButtonClassName(utilityPanelOpen, utilityPanelTab, 'approvals')}
              onClick={() => toggleUtilityPanel('approvals')}
              type="button"
            >
              <span>Approvals</span>
              <small>{pendingApprovalCount}</small>
            </button>
          </div>
        </div>
      </header>

      {utilityPanelOpen ? (
        <button
          aria-label="Close utility panel"
          className="thread-panel-backdrop"
          onClick={() => setUtilityPanelOpen(false)}
          type="button"
        />
      ) : null}

      <div className={utilityPanelOpen ? 'thread-layout thread-layout--panel-open' : 'thread-layout'}>
        <aside className="card thread-sidebar">
          <div className="card__header">
            <h2>Threads</h2>
            <span>{threadsQuery.data?.length ?? 0}</span>
          </div>

          <form className="stack" onSubmit={handleCreateThread}>
            <label className="field">
              <span>Name</span>
              <input value={threadName} onChange={(event) => setThreadName(event.target.value)} />
            </label>
            <button className="button" disabled={createThreadMutation.isPending} type="submit">
              {createThreadMutation.isPending ? 'Creating...' : 'Create Thread'}
            </button>
          </form>

          <div className="thread-toolbar">
            <input
              className="thread-search"
              ref={threadSearchRef}
              onChange={(event) => setThreadSearch(event.target.value)}
              placeholder="Search threads"
              value={threadSearch}
            />
            <div className="thread-filters">
              {threadFilterOptions.map((option) => (
                <button
                  className={
                    threadFilter === option.value
                      ? 'thread-filter thread-filter--active'
                      : 'thread-filter'
                  }
                  key={option.value}
                  onClick={() => setThreadFilter(option.value)}
                  type="button"
                >
                  <span>{option.label}</span>
                  <small>{threadCounts[option.value]}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="thread-list">
            {groupedThreads.active.length ? (
              <section className="thread-group">
                <div className="thread-group__header">
                  <span>Recent & Active</span>
                  <small>{groupedThreads.active.length}</small>
                </div>
                {groupedThreads.active.map((thread) => (
                  <article className="thread-row" key={thread.id}>
                    {editingThreadId === thread.id ? (
                      <form className="thread-rename" onSubmit={handleRenameThread}>
                        <input
                          autoFocus
                          onChange={(event) => setEditingThreadName(event.target.value)}
                          value={editingThreadName}
                        />
                        <div className="thread-item__actions">
                          <button className="button button--tiny" disabled={renameThreadMutation.isPending} type="submit">
                            Save
                          </button>
                          <button
                            className="button button--tiny button--secondary"
                            onClick={() => {
                              setEditingThreadId(undefined)
                              setEditingThreadName('')
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          className={thread.id === selectedThreadId ? 'thread-item thread-item--active' : 'thread-item'}
                          onClick={() => setSelectedThread(workspaceId, thread.id)}
                          type="button"
                        >
                          <div>
                            <strong>{thread.name}</strong>
                            <p>
                              {thread.status}
                              {' · '}
                              {formatRelativeTime(recentThreadAccess[thread.id] ?? thread.updatedAt)}
                            </p>
                          </div>
                        </button>
                        <div className="thread-item__actions">
                          <button
                            className="button button--tiny button--secondary"
                            onClick={() => beginRenameThread(thread)}
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            className="button button--tiny button--secondary"
                            onClick={() => archiveThreadMutation.mutate(thread.id)}
                            type="button"
                          >
                            Archive
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </section>
            ) : null}

            {groupedThreads.archived.length ? (
              <section className="thread-group">
                <div className="thread-group__header">
                  <span>Archived</span>
                  <small>{groupedThreads.archived.length}</small>
                </div>
                {groupedThreads.archived.map((thread) => (
                  <article className="thread-row" key={thread.id}>
                    {editingThreadId === thread.id ? (
                      <form className="thread-rename" onSubmit={handleRenameThread}>
                        <input
                          autoFocus
                          onChange={(event) => setEditingThreadName(event.target.value)}
                          value={editingThreadName}
                        />
                        <div className="thread-item__actions">
                          <button className="button button--tiny" disabled={renameThreadMutation.isPending} type="submit">
                            Save
                          </button>
                          <button
                            className="button button--tiny button--secondary"
                            onClick={() => {
                              setEditingThreadId(undefined)
                              setEditingThreadName('')
                            }}
                            type="button"
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    ) : (
                      <>
                        <button
                          className={thread.id === selectedThreadId ? 'thread-item thread-item--active' : 'thread-item'}
                          onClick={() => setSelectedThread(workspaceId, thread.id)}
                          type="button"
                        >
                          <div>
                            <strong>{thread.name}</strong>
                            <p>
                              Archived
                              {' · '}
                              {formatRelativeTime(recentThreadAccess[thread.id] ?? thread.updatedAt)}
                            </p>
                          </div>
                        </button>
                        <div className="thread-item__actions">
                          <button
                            className="button button--tiny button--secondary"
                            onClick={() => beginRenameThread(thread)}
                            type="button"
                          >
                            Rename
                          </button>
                          <button
                            className="button button--tiny button--secondary"
                            onClick={() => unarchiveThreadMutation.mutate(thread.id)}
                            type="button"
                          >
                            Unarchive
                          </button>
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </section>
            ) : null}

            {groupedThreads.active.length === 0 && groupedThreads.archived.length === 0 ? (
              <div className="empty-state empty-state--compact">No threads match the current filter.</div>
            ) : null}
          </div>
        </aside>

        <section className="card thread-main">
          <div className="card__header thread-main__header">
            <div>
              <h2>{selectedThread?.name ?? 'Select a thread'}</h2>
              <p>{selectedThread ? `Status: ${selectedThread.status}` : 'Create or select a thread to start chatting.'}</p>
            </div>
            <div className="thread-main__header-meta">
              {selectedThreadDetail?.cwd ? <code>{selectedThreadDetail.cwd}</code> : null}
              {selectedThread ? <StatusBadge status={selectedThread.archived ? 'archived' : selectedThread.status} /> : null}
            </div>
          </div>

          <div className="timeline">
            {selectedThreadDetail?.turns?.length ? (
              <div className="timeline-section">
                <div className="timeline-section__title">History</div>
                {selectedThreadDetail.turns.map((turn) => (
                  <article className="history-turn" key={turn.id}>
                    <div className="event-card__meta">
                      <strong>Turn {turn.id}</strong>
                      <span>{turn.status}</span>
                    </div>
                    <div className="history-items">
                      {turn.items.map((item, index) => (
                        <HistoryItemCard item={item} key={`${turn.id}-${index}`} />
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}

            {liveTimelineEntries.length === 0 && !selectedThreadDetail?.turns?.length ? (
              <div className="empty-state">Send a message to see streamed event items here.</div>
            ) : (
              liveTimelineEntries.length > 0 ? (
                <div className="timeline-section">
                  <div className="timeline-section__title">Live Events</div>
                  {liveTimelineEntries.map((entry) => (
                    <LiveEventCard entry={entry} key={entry.key} />
                  ))}
                </div>
              ) : null
            )}
          </div>

          <form className="composer" onSubmit={handleSendMessage}>
            <textarea
              disabled={!selectedThreadId || startTurnMutation.isPending}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Ask Codex to inspect the repo, plan work, or run a command..."
              rows={4}
              value={message}
            />
            <div className="composer__actions">
              <button className="button" disabled={!selectedThreadId || startTurnMutation.isPending} type="submit">
                {startTurnMutation.isPending ? 'Sending...' : 'Start Turn'}
              </button>
              <button
                className="button button--secondary"
                disabled={!selectedThreadId || interruptTurnMutation.isPending}
                onClick={() => interruptTurnMutation.mutate()}
                type="button"
              >
                Interrupt
              </button>
            </div>
          </form>
        </section>

        {approvalsOpen ? (
          <aside className="card approvals-panel">
            <div className="card__header">
              <h2>Approvals</h2>
              <span>{approvalsQuery.data?.length ?? 0}</span>
            </div>

            <div className="stack">
              {approvalsQuery.data?.map((approval) => {
                const questions = getApprovalQuestions(approval)
                const details = (approval.details ?? {}) as ApprovalDetails
                const formApproval = isMcpFormApproval(approval)

                return (
                  <article className="approval-card" key={approval.id}>
                    <div className="stack stack--tight">
                      <div>
                        <strong>{approval.kind}</strong>
                        <p>{approval.summary}</p>
                      </div>

                      {!formApproval && 'message' in details && typeof details.message === 'string' ? (
                        <p className="muted-text">{details.message}</p>
                      ) : null}

                      {details.mode === 'url' && typeof details.url === 'string' ? (
                        <a className="inline-link" href={details.url} rel="noreferrer" target="_blank">
                          Open requested URL
                        </a>
                      ) : null}

                      {formApproval ? (
                        <McpElicitationForm
                          approval={approval}
                          disabled={respondApprovalMutation.isPending}
                          onRespond={(input) =>
                            respondApprovalMutation.mutate({
                              requestId: approval.id,
                              action: input.action,
                              content: input.content,
                            })
                          }
                        />
                      ) : questions.length > 0 ? (
                        <form
                          className="stack stack--tight"
                          onSubmit={(event) => {
                            event.preventDefault()
                            submitQuestionApproval(approval)
                          }}
                        >
                          {questions.map((question) => {
                            const value = approvalAnswers[approval.id]?.[question.id] ?? ''

                            return (
                              <label className="field approval-question" key={question.id}>
                                <span>{question.header}</span>
                                <small>{question.question}</small>
                                {question.options?.length ? (
                                  <select
                                    onChange={(event) =>
                                      updateApprovalAnswer(approval.id, question.id, event.target.value)
                                    }
                                    value={value}
                                  >
                                    <option value="">Choose an option</option>
                                    {question.options.map((option) => (
                                      <option key={option.label} value={option.label}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    onChange={(event) =>
                                      updateApprovalAnswer(approval.id, question.id, event.target.value)
                                    }
                                    type={question.isSecret ? 'password' : 'text'}
                                    value={value}
                                  />
                                )}
                              </label>
                            )
                          })}

                          {approvalErrors[approval.id] ? (
                            <p className="error-text">{approvalErrors[approval.id]}</p>
                          ) : null}

                          <div className="approval-card__actions">
                            <button className="button button--tiny" disabled={respondApprovalMutation.isPending} type="submit">
                              Submit
                            </button>
                            {approval.actions.includes('decline') ? (
                              <button
                                className="button button--tiny button--secondary"
                                disabled={respondApprovalMutation.isPending}
                                onClick={() =>
                                  respondApprovalMutation.mutate({ requestId: approval.id, action: 'decline' })
                                }
                                type="button"
                              >
                                Decline
                              </button>
                            ) : null}
                            {approval.actions.includes('cancel') ? (
                              <button
                                className="button button--tiny button--secondary"
                                disabled={respondApprovalMutation.isPending}
                                onClick={() =>
                                  respondApprovalMutation.mutate({ requestId: approval.id, action: 'cancel' })
                                }
                                type="button"
                              >
                                Cancel
                              </button>
                            ) : null}
                          </div>
                        </form>
                      ) : (
                        <div className="approval-card__actions">
                          {approval.actions.map((action) => (
                            <button
                              className={approvalButtonClassName(action)}
                              disabled={respondApprovalMutation.isPending}
                              key={action}
                              onClick={() =>
                                respondApprovalMutation.mutate({ requestId: approval.id, action })
                              }
                              type="button"
                            >
                              {approvalActionLabel(action)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                )
              })}

              {approvalsQuery.data?.length === 0 ? (
                <div className="empty-state">No pending approvals in this workspace.</div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>
    </section>
  )
}

function getApprovalQuestions(approval: PendingApproval): ApprovalQuestion[] {
  const details = approval.details as ApprovalDetails | null | undefined
  return Array.isArray(details?.questions) ? details.questions : []
}

function approvalActionLabel(action: string) {
  switch (action) {
    case 'accept':
      return 'Accept'
    case 'accept_for_session':
      return 'Accept Session'
    case 'decline':
      return 'Decline'
    case 'cancel':
      return 'Cancel'
    default:
      return action
  }
}

function approvalButtonClassName(action: string) {
  return action === 'accept' ? 'button button--tiny' : 'button button--tiny button--secondary'
}

function isMcpFormApproval(approval: PendingApproval) {
  const details = approval.details as ApprovalDetails | null | undefined
  return approval.kind === 'mcpServer/elicitation/request' && details?.mode === 'form'
}

function sortThreads(threads: Thread[], recentThreadAccess: Record<string, string>) {
  return [...threads].sort((left, right) => {
    const leftRecent = recentTimestamp(recentThreadAccess[left.id], left.updatedAt)
    const rightRecent = recentTimestamp(recentThreadAccess[right.id], right.updatedAt)
    if (leftRecent !== rightRecent) {
      return rightRecent - leftRecent
    }

    return left.name.localeCompare(right.name)
  })
}

function formatRelativeTime(value: string) {
  const target = new Date(value).getTime()
  if (Number.isNaN(target)) {
    return 'unknown'
  }

  const diffSeconds = Math.max(0, Math.round((Date.now() - target) / 1000))
  if (diffSeconds < 60) {
    return 'just now'
  }

  const diffMinutes = Math.round(diffSeconds / 60)
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h ago`
  }

  const diffDays = Math.round(diffHours / 24)
  return `${diffDays}d ago`
}

function recentTimestamp(primary?: string, fallback?: string) {
  const primaryValue = primary ? new Date(primary).getTime() : Number.NaN
  if (!Number.isNaN(primaryValue)) {
    return primaryValue
  }

  const fallbackValue = fallback ? new Date(fallback).getTime() : Number.NaN
  return Number.isNaN(fallbackValue) ? 0 : fallbackValue
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null
  if (!element) {
    return false
  }

  const tagName = element.tagName
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    element.isContentEditable
  )
}
