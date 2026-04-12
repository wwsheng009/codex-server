// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchRail } from './ThreadWorkbenchRail'

function renderRail() {
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
          contextUsagePercent={42}
          contextWindow={128000}
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
          onResetInspectorWidth={() => undefined}
          onSendBotMessage={(event) => {
            event.preventDefault()
          }}
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
})
