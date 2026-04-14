import { QueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { buildThreadPageCommandActions } from './buildThreadPageCommandActions'

describe('buildThreadPageCommandActions', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  function createInput(overrides: Record<string, unknown> = {}) {
    const queryClient = new QueryClient()

    return {
      clearCompletedCommandSessions: vi.fn(),
      command: 'npm test',
      commandRunMode: 'command-exec',
      commandSessions: [],
      queryClient,
      recoverableCommandOperation: null,
      removeCommandSession: vi.fn(),
      restartRuntimeMutation: {
        isPending: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue({}),
      },
      selectedCommandSession: undefined,
      selectedProcessId: undefined,
      selectedThreadId: 'thread-1',
      setCommandRunMode: vi.fn(),
      setIsRestartAndRetryPending: vi.fn(),
      setRecoverableCommandOperation: vi.fn(),
      setRecoverableSendInput: vi.fn(),
      setRuntimeRecoveryExecutionNotice: vi.fn(),
      setIsTerminalDockExpanded: vi.fn(),
      setSelectedProcessId: vi.fn(),
      setSendError: vi.fn(),
      startCommandMutation: {
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue({ id: 'proc-1' }),
      },
      stdinValue: '',
      terminateCommandMutation: {
        mutate: vi.fn(),
      },
      threadShellCommandMutation: {
        isPending: false,
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockResolvedValue({ status: 'ok' }),
      },
      updateCommandSession: vi.fn(),
      workspaceId: 'ws-1',
      workspaceRuntimeState: null,
      writeCommandMutation: {
        mutate: vi.fn(),
      },
      ...overrides,
    } as any
  }

  it('captures a recoverable command retry marker when command session start fails', async () => {
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
      updatedAt: '2026-04-14T00:00:00.000Z',
      configLoadStatus: 'loaded',
      restartRequired: false,
    }
    const queryClient = {
      fetchQuery: vi.fn().mockResolvedValue(runtimeState),
      getQueryData: vi.fn().mockReturnValue(runtimeState),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }
    const input = createInput({
      queryClient,
      startCommandMutation: {
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockRejectedValue(new Error('runtime exited unexpectedly')),
      },
    })
    const actions = buildThreadPageCommandActions(input)

    await actions.handleStartCommand({
      preventDefault: vi.fn(),
    } as any)

    expect(input.setRecoverableCommandOperation).toHaveBeenCalledWith({
      kind: 'start-command',
      input: {
        command: 'npm test',
        mode: 'command',
      },
    })
    expect(input.setSendError).toHaveBeenLastCalledWith('runtime exited unexpectedly')
  })

  it('captures a plain retry marker when command start fails and runtime says retry', async () => {
    const runtimeState = {
      workspaceId: 'ws-1',
      status: 'error',
      command: 'codex',
      rootPath: 'E:/workspace',
      lastError: 'temporary transport interruption',
      lastErrorCategory: 'transport',
      lastErrorRecoveryAction: 'retry',
      lastErrorRetryable: true,
      lastErrorRequiresRuntimeRecycle: false,
      recentStderr: ['socket reset'],
      updatedAt: '2026-04-14T00:00:00.000Z',
      configLoadStatus: 'loaded',
      restartRequired: false,
    }
    const queryClient = {
      fetchQuery: vi.fn().mockResolvedValue(runtimeState),
      getQueryData: vi.fn().mockReturnValue(runtimeState),
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }
    const input = createInput({
      queryClient,
      startCommandMutation: {
        mutate: vi.fn(),
        mutateAsync: vi.fn().mockRejectedValue(new Error('temporary transport interruption')),
      },
    })
    const actions = buildThreadPageCommandActions(input)

    await actions.handleStartCommand({
      preventDefault: vi.fn(),
    } as any)

    expect(input.setRecoverableCommandOperation).toHaveBeenCalledWith({
      kind: 'start-command',
      input: {
        command: 'npm test',
        mode: 'command',
      },
    })
    expect(input.setSendError).toHaveBeenLastCalledWith('temporary transport interruption')
  })

  it('restarts the runtime and retries the captured command operation', async () => {
    const input = createInput({
      recoverableCommandOperation: {
        kind: 'start-command',
        input: {
          command: 'npm test',
          mode: 'command',
        },
      },
    })
    const actions = buildThreadPageCommandActions(input)

    await actions.handleRestartAndRetryCommandOperation()

    expect(input.restartRuntimeMutation.mutateAsync).toHaveBeenCalledTimes(1)
    expect(input.startCommandMutation.mutateAsync).toHaveBeenCalledWith({
      command: 'npm test',
      mode: 'command',
    })
    expect(input.setIsRestartAndRetryPending).toHaveBeenNthCalledWith(1, true)
    expect(input.setIsRestartAndRetryPending).toHaveBeenLastCalledWith(false)
    expect(input.setRuntimeRecoveryExecutionNotice).toHaveBeenCalledTimes(1)
  })

  it('retries the captured command operation without restarting when requested', async () => {
    const input = createInput({
      recoverableCommandOperation: {
        kind: 'start-command',
        input: {
          command: 'npm test',
          mode: 'command',
        },
      },
    })
    const actions = buildThreadPageCommandActions(input)

    await actions.handleRetryCommandOperation()

    expect(input.restartRuntimeMutation.mutateAsync).not.toHaveBeenCalled()
    expect(input.startCommandMutation.mutateAsync).toHaveBeenCalledWith({
      command: 'npm test',
      mode: 'command',
    })
    expect(input.setSendError).toHaveBeenCalledWith(null)
    expect(input.setRuntimeRecoveryExecutionNotice).toHaveBeenCalledTimes(1)
  })
})
