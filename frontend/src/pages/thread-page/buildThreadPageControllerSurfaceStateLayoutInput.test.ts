import { describe, expect, it, vi } from 'vitest'

import { buildThreadPageControllerSurfaceStateLayoutInput } from './buildThreadPageControllerSurfaceStateLayoutInput'

describe('buildThreadPageControllerSurfaceStateLayoutInput', () => {
  it('enables stop only for active command sessions', () => {
    const runningResult = buildThreadPageControllerSurfaceStateLayoutInput({
      controllerState: {
        activePendingTurn: null,
        approvalAnswers: {},
        approvalErrors: {},
        hasMoreHistoricalTurnsBefore: null,
        isLoadingOlderTurns: false,
        isMobileViewport: false,
        isSurfacePanelResizing: false,
        isTerminalDockVisible: true,
        isTerminalDockExpanded: true,
        isTerminalWindowMaximized: false,
        queryClient: {},
        selectedThreadId: 'thread-1',
        setIsTerminalDockExpanded: vi.fn(),
        setIsTerminalDockVisible: vi.fn(),
        setSurfacePanelSides: vi.fn(),
        surfacePanelView: null,
        syncClock: Date.now(),
        terminalDockPlacement: 'bottom',
        terminalWindowBounds: { height: 300, width: 600, x: 0, y: 0 },
        threadViewportRef: { current: null },
      },
      dataState: {
        approvalsQuery: { data: [], dataUpdatedAt: 0, isFetching: false },
        commandSessions: [],
        threadProjection: undefined,
        resolvedSelectedThreadId: 'thread-1',
        selectedThread: undefined,
        threadDetailQuery: { error: null, isLoading: false },
        threadsQuery: { data: [], isLoading: false, isSuccess: true },
        workspaceRuntimeStateQuery: { data: null },
        workspaceQuery: { data: { name: 'workspace', rootPath: 'E:/workspace' } },
      },
      displayState: {
        displayedTurns: [],
        liveTimelineEntries: [],
        selectedCommandSession: { id: 'proc_1', status: 'running' },
      },
      mutationState: {
        createThreadMutation: { error: null, isPending: false },
        respondApprovalMutation: { isPending: false },
        restartRuntimeMutation: { isPending: false },
        startCommandMutation: { isPending: false },
        terminateCommandMutation: { isPending: false },
      },
      statusState: {
        activeCommandCount: 1,
        isThreadProcessing: false,
        isWaitingForThreadData: false,
        terminalDockClassName: 'terminal-dock',
        threadRuntimeNotice: '',
      },
      viewportState: {
        isThreadPinnedToLatest: true,
        isThreadViewportInteracting: false,
        threadLogStyle: 'conversation',
        threadViewportRef: { current: null },
      },
    } as any)

    const completedResult = buildThreadPageControllerSurfaceStateLayoutInput({
      controllerState: {
        activePendingTurn: null,
        approvalAnswers: {},
        approvalErrors: {},
        hasMoreHistoricalTurnsBefore: null,
        isLoadingOlderTurns: false,
        isMobileViewport: false,
        isSurfacePanelResizing: false,
        isTerminalDockVisible: true,
        isTerminalDockExpanded: true,
        isTerminalWindowMaximized: false,
        queryClient: {},
        selectedThreadId: 'thread-1',
        setIsTerminalDockExpanded: vi.fn(),
        setIsTerminalDockVisible: vi.fn(),
        setSurfacePanelSides: vi.fn(),
        surfacePanelView: null,
        syncClock: Date.now(),
        terminalDockPlacement: 'bottom',
        terminalWindowBounds: { height: 300, width: 600, x: 0, y: 0 },
        threadViewportRef: { current: null },
      },
      dataState: {
        approvalsQuery: { data: [], dataUpdatedAt: 0, isFetching: false },
        commandSessions: [],
        threadProjection: undefined,
        resolvedSelectedThreadId: 'thread-1',
        selectedThread: undefined,
        threadDetailQuery: { error: null, isLoading: false },
        threadsQuery: { data: [], isLoading: false, isSuccess: true },
        workspaceRuntimeStateQuery: { data: null },
        workspaceQuery: { data: { name: 'workspace', rootPath: 'E:/workspace' } },
      },
      displayState: {
        displayedTurns: [],
        liveTimelineEntries: [],
        selectedCommandSession: { id: 'proc_1', status: 'completed' },
      },
      mutationState: {
        createThreadMutation: { error: null, isPending: false },
        respondApprovalMutation: { isPending: false },
        restartRuntimeMutation: { isPending: false },
        startCommandMutation: { isPending: false },
        terminateCommandMutation: { isPending: false },
      },
      statusState: {
        activeCommandCount: 0,
        isThreadProcessing: false,
        isWaitingForThreadData: false,
        terminalDockClassName: 'terminal-dock',
        threadRuntimeNotice: '',
      },
      viewportState: {
        isThreadPinnedToLatest: true,
        isThreadViewportInteracting: false,
        threadLogStyle: 'conversation',
        threadViewportRef: { current: null },
      },
    } as any)

    expect(runningResult.terminateDisabled).toBe(false)
    expect(completedResult.terminateDisabled).toBe(true)
  })

  it('disables stop while terminate request is pending', () => {
    const result = buildThreadPageControllerSurfaceStateLayoutInput({
      controllerState: {
        activePendingTurn: null,
        approvalAnswers: {},
        approvalErrors: {},
        hasMoreHistoricalTurnsBefore: null,
        isLoadingOlderTurns: false,
        isMobileViewport: false,
        isSurfacePanelResizing: false,
        isTerminalDockVisible: true,
        isTerminalDockExpanded: true,
        isTerminalWindowMaximized: false,
        queryClient: {},
        selectedThreadId: 'thread-1',
        setIsTerminalDockExpanded: vi.fn(),
        setIsTerminalDockVisible: vi.fn(),
        setSurfacePanelSides: vi.fn(),
        surfacePanelView: null,
        syncClock: Date.now(),
        terminalDockPlacement: 'bottom',
        terminalWindowBounds: { height: 300, width: 600, x: 0, y: 0 },
        threadViewportRef: { current: null },
      },
      dataState: {
        approvalsQuery: { data: [], dataUpdatedAt: 0, isFetching: false },
        commandSessions: [],
        threadProjection: undefined,
        resolvedSelectedThreadId: 'thread-1',
        selectedThread: undefined,
        threadDetailQuery: { error: null, isLoading: false },
        threadsQuery: { data: [], isLoading: false, isSuccess: true },
        workspaceRuntimeStateQuery: { data: null },
        workspaceQuery: { data: { name: 'workspace', rootPath: 'E:/workspace' } },
      },
      displayState: {
        displayedTurns: [],
        liveTimelineEntries: [],
        selectedCommandSession: { id: 'proc_1', status: 'running' },
      },
      mutationState: {
        createThreadMutation: { error: null, isPending: false },
        respondApprovalMutation: { isPending: false },
        restartRuntimeMutation: { isPending: false },
        startCommandMutation: { isPending: false },
        terminateCommandMutation: { isPending: true },
      },
      statusState: {
        activeCommandCount: 1,
        isThreadProcessing: false,
        isWaitingForThreadData: false,
        terminalDockClassName: 'terminal-dock',
        threadRuntimeNotice: '',
      },
      viewportState: {
        isThreadPinnedToLatest: true,
        isThreadViewportInteracting: false,
        threadLogStyle: 'conversation',
        threadViewportRef: { current: null },
      },
    } as any)

    expect(result.terminateDisabled).toBe(true)
  })
})
