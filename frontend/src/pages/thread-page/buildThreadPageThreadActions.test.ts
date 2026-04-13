import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildThreadPageThreadActions } from './buildThreadPageThreadActions'

describe('buildThreadPageThreadActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function createInput(overrides: Record<string, unknown> = {}) {
    const queryClient = new QueryClient()

    return {
      archiveThreadMutation: { mutate: vi.fn() },
      closeDeleteThreadDialog: vi.fn(),
      compactDisabledReason: null,
      compactThreadMutation: { isPending: false, mutate: vi.fn() },
      composerPreferences: {
        collaborationMode: 'default',
        model: '',
        permissionPreset: 'default',
        reasoningEffort: 'medium',
      },
      confirmingThreadDelete: null,
      deleteThreadMutation: { isPending: false, mutate: vi.fn(), reset: vi.fn() },
      editingThreadName: '',
      fullTurnItemContentOverridesById: {},
      fullTurnItemOverridesById: {},
      fullTurnItemRetainCountById: {},
      fullTurnOverridesById: {},
      fullTurnRetainCountById: {},
      historicalTurns: [],
      interruptTurnMutation: { isPending: false, mutate: vi.fn() },
      invalidateThreadQueries: vi.fn().mockResolvedValue(undefined),
      isInterruptMode: false,
      isLoadingOlderTurns: false,
      message: 'hello runtime',
      oldestDisplayedTurnId: undefined,
      queryClient,
      recoverableSendInput: null,
      renameThreadMutation: { mutate: vi.fn() },
      requestDeleteSelectedThread: vi.fn(),
      restartRuntimeMutation: {
        isPending: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue({}),
      },
      respondApprovalMutation: { mutate: vi.fn() },
      scrollThreadToLatest: vi.fn(),
      selectedThread: {
        archived: false,
        id: 'thread-1',
      },
      selectedThreadId: 'thread-1',
      setActiveComposerPanel: vi.fn(),
      setApprovalAnswers: vi.fn(),
      setAuthRecoveryRequestedAt: vi.fn(),
      setComposerCaret: vi.fn(),
      setComposerCommandMenu: vi.fn(),
      setDismissedComposerAutocompleteKey: vi.fn(),
      setFullTurnItemContentOverridesById: vi.fn(),
      setFullTurnItemOverridesById: vi.fn(),
      setFullTurnItemRetainCountById: vi.fn(),
      setFullTurnOverridesById: vi.fn(),
      setFullTurnRetainCountById: vi.fn(),
      setHasMoreHistoricalTurnsBefore: vi.fn(),
      setHistoricalTurns: vi.fn(),
      setIsLoadingOlderTurns: vi.fn(),
      setIsRestartAndRetryPending: vi.fn(),
      setMessage: vi.fn(),
      setRecoverableSendInput: vi.fn(),
      setSendError: vi.fn(),
      setThreadTurnWindowSize: vi.fn(),
      startTurnMutation: {
        mutateAsync: vi.fn().mockResolvedValue({ turnId: 'turn-1' }),
      },
      threadDetail: undefined,
      threadShellCommandMutation: {
        isPending: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue({ status: 'ok' }),
      },
      unarchiveThreadMutation: { mutate: vi.fn() },
      updatePendingTurn: vi.fn(),
      workspaceId: 'ws-1',
      workspaceRuntimeState: null,
      ...overrides,
    } as any
  }

  it('restarts the runtime and resubmits the recoverable input', async () => {
    const input = createInput({
      recoverableSendInput: 'hello runtime',
    })
    const actions = buildThreadPageThreadActions(input)

    await actions.handleRestartAndRetrySend()

    expect(input.restartRuntimeMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(input.startTurnMutation.mutateAsync).toHaveBeenCalledWith({
      threadId: 'thread-1',
      input: 'hello runtime',
      model: undefined,
      reasoningEffort: 'medium',
      permissionPreset: 'default',
      collaborationMode: undefined,
    })
    expect(input.setIsRestartAndRetryPending).toHaveBeenNthCalledWith(1, true)
    expect(input.setIsRestartAndRetryPending).toHaveBeenLastCalledWith(false)
  })

  it('captures a restart-and-retry recovery marker after send failure', async () => {
    const runtimeState = {
      workspaceId: 'ws-1',
      status: 'error',
      command: 'codex',
      rootPath: 'E:/workspace',
      lastError: 'runtime exited unexpectedly',
      lastErrorCategory: 'process_exit',
      lastErrorRecoveryAction: 'retry-after-restart',
      lastErrorRetryable: true,
      lastErrorRequiresRuntimeRecycle: false,
      recentStderr: ['boom'],
      updatedAt: '2026-04-13T00:00:00.000Z',
      configLoadStatus: 'loaded',
      restartRequired: false,
    }
    const queryClient = {
      fetchQuery: vi.fn().mockResolvedValue(runtimeState),
      getQueryData: vi.fn().mockReturnValue(runtimeState),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
      setQueryData: vi.fn(),
      setQueriesData: vi.fn(),
    }
    const input = createInput({
      queryClient,
      startTurnMutation: {
        mutateAsync: vi.fn().mockRejectedValue(new Error('runtime exited unexpectedly')),
      },
    })
    const actions = buildThreadPageThreadActions(input)

    await actions.handleSendMessage({
      preventDefault: vi.fn(),
    } as any)

    expect(input.setRecoverableSendInput).toHaveBeenCalledWith('hello runtime')
    expect(input.setSendError).toHaveBeenLastCalledWith('runtime exited unexpectedly')
    expect(queryClient.fetchQuery).toHaveBeenCalledTimes(1)
  })
})
