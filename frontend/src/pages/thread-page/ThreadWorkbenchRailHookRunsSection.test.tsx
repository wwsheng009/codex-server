// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchRailHookRunsSection } from './ThreadWorkbenchRailHookRunsSection'

describe('ThreadWorkbenchRailHookRunsSection', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('renders recent governance hook runs for the selected thread', () => {
    render(
      <ThreadWorkbenchRailHookRunsSection
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Release Thread',
          status: 'idle',
          archived: false,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z',
        }}
        hookRuns={[
          {
            id: 'hook-1',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            turnId: 'turn-1',
            itemId: 'cmd-1',
            eventName: 'PostToolUse',
            handlerKey: 'builtin.posttooluse.failed-validation-rescue',
            triggerMethod: 'item/completed',
            toolName: 'commandExecution',
            status: 'completed',
            decision: 'continueTurn',
            reason: 'validation_command_failed',
            entries: [
              {
                kind: 'feedback',
                text: 'command=go test ./...; status=failed; exitCode=1',
              },
            ],
            startedAt: '2026-04-08T12:00:00.000Z',
            completedAt: '2026-04-08T12:00:00.182Z',
            durationMs: 182,
          },
        ]}
        hookRunsError={null}
        hookRunsLoading={false}
      />,
    )

    expect(screen.getByText('Recent Hook Runs')).toBeTruthy()
    expect(screen.getByText('Post-Tool Use')).toBeTruthy()
    expect(screen.getByText('Failed Validation Rescue')).toBeTruthy()
    expect(screen.getByText('Completed')).toBeTruthy()
    expect(screen.getByTitle('item/completed').textContent).toBe('Item Completed')
    expect(screen.getByText('Command Execution')).toBeTruthy()
    expect(screen.getByText('182 ms')).toBeTruthy()
    expect(screen.getByText('Validation command failed')).toBeTruthy()
    expect(screen.getByText('Command: go test ./...; status=failed; exitCode=1')).toBeTruthy()
  })

  it('renders dedicated entry hook labels with readable event and reason text', () => {
    render(
      <ThreadWorkbenchRailHookRunsSection
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Release Thread',
          status: 'idle',
          archived: false,
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z',
        }}
        hookRuns={[
          {
            id: 'hook-2',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            turnId: 'turn-2',
            itemId: 'req-2',
            eventName: 'TurnSteer',
            handlerKey: 'builtin.turnsteer.audit-thread-turn-steer',
            triggerMethod: 'turn/steer',
            toolName: 'turn/steer',
            status: 'failed',
            decision: 'continue',
            reason: 'steer_no_active_turn',
            startedAt: '2026-04-08T12:10:00.000Z',
            completedAt: '2026-04-08T12:10:00.040Z',
            durationMs: 40,
          },
        ]}
        hookRunsError={null}
        hookRunsLoading={false}
      />,
    )

    expect(screen.getByTitle('TurnSteer').textContent).toBe('Turn Steer')
    expect(screen.getAllByTitle('turn/steer').map((node) => node.textContent)).toEqual([
      'Turn Steer',
      'Turn Steer',
    ])
    expect(screen.getByText('Thread Turn Steer Audit')).toBeTruthy()
    expect(screen.getByText('Steer requested without an active turn')).toBeTruthy()
  })

  it('renders session start source when the hook run records it', () => {
    render(
      <ThreadWorkbenchRailHookRunsSection
        selectedThread={{
          id: 'thread-1',
          workspaceId: 'ws-1',
          name: 'Release Thread',
          status: 'idle',
          archived: false,
          sessionStartSource: 'clear',
          createdAt: '2026-04-08T00:00:00.000Z',
          updatedAt: '2026-04-08T00:00:00.000Z',
        }}
        hookRuns={[
          {
            id: 'hook-3',
            workspaceId: 'ws-1',
            threadId: 'thread-1',
            eventName: 'SessionStart',
            handlerKey: 'builtin.sessionstart.inject-project-context',
            triggerMethod: 'turn/start',
            status: 'completed',
            decision: 'continue',
            reason: 'project_context_injected',
            sessionStartSource: 'clear',
            startedAt: '2026-04-08T12:15:00.000Z',
            completedAt: '2026-04-08T12:15:00.050Z',
            durationMs: 50,
          },
        ]}
        hookRunsError={null}
        hookRunsLoading={false}
      />,
    )

    expect(screen.getByText('Session Start')).toBeTruthy()
    expect(screen.getByText('Project Context Injection')).toBeTruthy()
    expect(screen.getByTitle('turn/start').textContent).toBe('Turn Start')
    expect(screen.getAllByText('Session Start Source')).toHaveLength(1)
    expect(screen.getByText('Clear')).toBeTruthy()
  })
})
