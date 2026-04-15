// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { i18n } from '../../i18n/runtime'
import type { WorkspaceRuntimeRecoverySummary } from '../../features/workspaces/runtimeRecovery'

let ThreadWorkbenchRail: (typeof import('./ThreadWorkbenchRail'))['ThreadWorkbenchRail']

function renderRail(options?: {
  currentThreadStatus?: string
  isTerminalDockVisible?: boolean
  onShowTerminalDock?: () => void
  runtimeRecoveryExecutionNotice?: {
    actionKind: 'retry' | 'restart-and-retry'
    attemptCount: number
    attemptedAt: string
    details: string
    noticeKey: string
    summary: string
    title: string
    tone: 'info' | 'error'
  } | null
  runtimeRecoverySummary?: WorkspaceRuntimeRecoverySummary | null
  onRestartRuntime?: () => void
  onRetryRuntimeOperation?: () => void
}) {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ThreadWorkbenchRail
          botSendBinding={null}
          botSendBindingPending={false}
          botSendBots={[]}
          botSendDeliveryTargets={[]}
          botSendErrorMessage={null}
          botSendLoading={false}
          botSendPending={false}
          botSendSelectedBotId=""
          botSendSelectedDeliveryTargetId=""
          botSendText=""
          command="pnpm test"
          commandCount={2}
          commandRunMode="command-exec"
          cumulativeTokens={2048}
          contextUsagePercent={42}
          contextWindow={128000}
          currentInputTokens={256}
          currentOutputTokens={512}
          currentReasoningTokens={128}
          currentThreadStatus={options?.currentThreadStatus ?? 'idle'}
          deletePending={false}
          deletingThreadId={undefined}
          editingThreadId={undefined}
          editingThreadName=""
          hookConfiguration={null}
          hookConfigurationError={null}
          hookConfigurationLoading={false}
          hookRuns={[]}
          hookRunsError={null}
          hookRunsLoading={false}
          isExpanded
          isMobileViewport={false}
          isResizing={false}
          isTerminalDockVisible={options?.isTerminalDockVisible ?? true}
          isThreadToolsExpanded
          isWorkbenchToolsExpanded
          lastTimelineEventTs="2026-04-12T06:00:00.000Z"
          latestTurnStatus="idle"
          liveThreadCwd="E:/projects/ai/codex-server"
          loadedAssistantMessageCount={3}
          loadedMessageCount={5}
          loadedTurnCount={2}
          loadedUserMessageCount={2}
          onArchiveToggle={() => undefined}
          onBeginRenameThread={() => undefined}
          onBindThreadBotChannel={() => undefined}
          onCancelRenameThread={() => undefined}
          onChangeBotSendSelectedBotId={() => undefined}
          onChangeBotSendSelectedDeliveryTargetId={() => undefined}
          onChangeBotSendText={() => undefined}
          onChangeCommand={() => undefined}
          onChangeCommandRunMode={() => undefined}
          onChangeEditingThreadName={() => undefined}
          onCloseWorkbenchOverlay={() => undefined}
          onDeleteThread={() => undefined}
          onDeleteThreadBotBinding={() => undefined}
          onHideSurfacePanel={() => undefined}
          onInspectorResizeStart={() => undefined}
          onOpenInspector={() => undefined}
          onOpenSurfacePanel={() => undefined}
          onRetryRuntimeOperation={options?.onRetryRuntimeOperation}
          onRestartRuntime={options?.onRestartRuntime}
          onResetInspectorWidth={() => undefined}
          onSendBotMessage={(event) => {
            event.preventDefault()
          }}
          onShowTerminalDock={options?.onShowTerminalDock ?? (() => undefined)}
          onStartCommand={(event) => {
            event.preventDefault()
          }}
          onSubmitRenameThread={(event) => {
            event.preventDefault()
          }}
          onToggleThreadToolsExpanded={() => undefined}
          onToggleWorkbenchToolsExpanded={() => undefined}
          pendingApprovalsCount={1}
          rootPath="E:/projects/ai/codex-server"
          runtimeRecoveryExecutionNotice={options?.runtimeRecoveryExecutionNotice}
          runtimeRecoverySummary={options?.runtimeRecoverySummary}
          runtimeConfigChangedAt="2026-04-12T05:00:00.000Z"
          runtimeConfigLoadStatus="loaded"
          runtimeRestartRequired={false}
          runtimeStartedAt="2026-04-12T04:00:00.000Z"
          runtimeUpdatedAt="2026-04-12T05:30:00.000Z"
          selectedThread={{
            archived: false,
            createdAt: '2026-04-10T00:00:00.000Z',
            id: 'thread-1',
            name: 'Release Thread',
            status: 'idle',
            updatedAt: '2026-04-12T06:00:00.000Z',
            workspaceId: 'ws-1',
          }}
          shellEnvironmentInfo="Shell inherits the expected environment."
          shellEnvironmentSummary={{
            explicitSetCount: 0,
            explicitSetKeys: [],
            hasComSpec: true,
            hasPATHEXT: true,
            hasSystemRoot: true,
            inherit: 'inherit',
            missingWindowsVars: [],
            windowsCommandResolution: 'normal',
          }}
          shellEnvironmentWarning={undefined}
          startCommandModeDisabled={false}
          startCommandPending={false}
          streamState="idle"
          surfacePanelView={null}
          threadCount={4}
          timelineItemCount={8}
          totalMessageCount={5}
          totalTokens={2048}
          totalTurnCount={2}
          turnCount={2}
          turnPolicyDecisions={[]}
          turnPolicyDecisionsError={null}
          turnPolicyDecisionsLoading={false}
          turnPolicyMetrics={null}
          turnPolicyMetricsError={null}
          turnPolicyMetricsLoading={false}
          workspaceName="codex-server"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ThreadWorkbenchRail', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  beforeAll(async () => {
    ;({ ThreadWorkbenchRail } = await import('./ThreadWorkbenchRail'))
  })

  afterEach(() => {
    cleanup()
  })

  it('switches between overview, governance, thread, and tools panels', async () => {
    renderRail()

    expect(screen.getByText('Persistent context')).toBeTruthy()
    expect(screen.queryByText('Thread tools')).toBeNull()

    fireEvent.click(screen.getByRole('tab', { name: 'Governance' }))
    expect(screen.getByText('Hook Configuration')).toBeTruthy()
    expect(screen.getByText('Recent Hook Runs')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Thread' }))
    expect(screen.getByText('Thread tools')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }))
    expect(screen.getByText('Workbench tools')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Run command' })).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(screen.getByText('Persistent context')).toBeTruthy()
  })

  it('shows runtime recovery guidance in the overview rail and exposes restart action', () => {
    const onRestartRuntime = () => undefined

    renderRail({
      onRestartRuntime,
      runtimeRecoverySummary: {
        title: 'Runtime Recovery Guidance',
        tone: 'error',
        actionKind: 'restart-and-retry',
        actionTitle: 'Restart runtime before retrying',
        actionSummary: 'Recycle the workspace runtime, then rerun the failed operation after the runtime is back.',
        categoryLabel: 'Runtime process exit',
        recoveryActionLabel: 'Restart runtime, then retry',
        retryable: true,
        retryableLabel: 'Yes',
        requiresRecycle: true,
        recycleLabel: 'Yes',
        description: 'Last error: runtime exited unexpectedly. Category: Runtime process exit.',
        details: 'Recent stderr:\n- runtime exited unexpectedly',
      },
    })

    expect(screen.getByText('Runtime Recovery Guidance')).toBeTruthy()
    expect(screen.getByText('Restart runtime before retrying')).toBeTruthy()
    expect(screen.getByText(/runtime exited unexpectedly/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Restart Runtime' })).toBeTruthy()
  })

  it('shows a config settings shortcut when recovery says launch config must be fixed', () => {
    renderRail({
      runtimeRecoverySummary: {
        title: 'Runtime Recovery Guidance',
        tone: 'error',
        actionKind: 'fix-config',
        actionTitle: 'Review launch configuration before restarting',
        actionSummary:
          'Fix the workspace launch settings first, then restart the runtime so the next boot uses the corrected config.',
        categoryLabel: 'Launch configuration',
        recoveryActionLabel: 'Fix launch config',
        retryable: false,
        retryableLabel: 'No',
        requiresRecycle: false,
        recycleLabel: 'No',
        description: 'Last error: invalid runtime launch config. Category: Launch configuration.',
        details: 'Recent stderr:\n- invalid runtime launch config',
      },
    })

    expect(screen.getByText('Review launch configuration before restarting')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open Config Settings' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restart Runtime' })).toBeNull()
  })

  it('shows a retry shortcut when recovery says the failed operation can be retried directly', () => {
    renderRail({
      onRetryRuntimeOperation: () => undefined,
      runtimeRecoverySummary: {
        title: 'Runtime Recovery Guidance',
        tone: 'error',
        actionKind: 'retry',
        actionTitle: 'Retry the failed operation',
        actionSummary:
          'The runtime looks recoverable enough to retry without forcing a full recycle first.',
        categoryLabel: 'Bridge / transport',
        recoveryActionLabel: 'Retry request',
        retryable: true,
        retryableLabel: 'Yes',
        requiresRecycle: false,
        recycleLabel: 'No',
        description: 'Last error: temporary transport interruption. Category: Bridge / transport.',
        details: 'Recent stderr:\n- temporary transport interruption',
      },
    })

    expect(screen.getByText('Retry the failed operation')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Restart Runtime' })).toBeNull()
  })

  it('shows the latest recovery execution summary in the overview rail', () => {
    renderRail({
      runtimeRecoveryExecutionNotice: {
        actionKind: 'retry',
        attemptCount: 2,
        attemptedAt: '2026-04-14T01:23:45.000Z',
        details:
          'Action: Retry\n\nStatus: Succeeded\n\nAttempt Count: 2\n\nSummary: The failed terminal operation was started again without restarting the runtime.',
        noticeKey: 'runtime-recovery-attempt-retry-success-2',
        summary:
          'The failed terminal operation was started again without restarting the runtime. Action: Retry. Attempt 2 at Apr 14, 2026, 9:23 AM.',
        title: 'Latest Recovery Attempt Succeeded',
        tone: 'info',
      },
    })

    expect(screen.getByText('Latest Recovery Attempt Succeeded')).toBeTruthy()
    expect(
      screen.getByText(
        /The failed terminal operation was started again without restarting the runtime\./i,
      ),
    ).toBeTruthy()
  })

  it('shows live current thread status instead of a stale thread list status', () => {
    renderRail({
      currentThreadStatus: 'completed',
    })

    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0)
  })

  it('shows a terminal icon button in the rail when the terminal dock is hidden', () => {
    let called = 0

    renderRail({
      isTerminalDockVisible: false,
      onShowTerminalDock: () => {
        called += 1
      },
    })

    fireEvent.click(screen.getByRole('button', { name: 'Show terminal' }))

    expect(called).toBe(1)
  })
})
