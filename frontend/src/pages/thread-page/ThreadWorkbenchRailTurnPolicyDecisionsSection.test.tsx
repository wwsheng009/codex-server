// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchRailTurnPolicyDecisionsSection } from './ThreadWorkbenchRailTurnPolicyDecisionsSection'

describe('ThreadWorkbenchRailTurnPolicyDecisionsSection', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('renders recent turn policy decisions for the selected thread', () => {
    render(
      <MemoryRouter>
        <ThreadWorkbenchRailTurnPolicyDecisionsSection
          selectedThread={{
            id: 'thread-1',
            workspaceId: 'ws-1',
            name: 'Release Thread',
            status: 'idle',
            archived: false,
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z',
          }}
          turnPolicyDecisions={[
            {
              id: 'decision-1',
              workspaceId: 'ws-1',
              threadId: 'thread-1',
              turnId: 'turn-1',
              itemId: 'cmd-1',
              triggerMethod: 'item/completed',
              policyName: 'posttooluse/failed-validation-command',
              fingerprint: 'fp-1',
              verdict: 'steer',
              action: 'steer',
              actionStatus: 'succeeded',
              governanceLayer: 'turnPolicyFallback',
              actionTurnId: 'turn-2',
              reason: 'validation_command_failed',
              evidenceSummary: 'command=go test ./...; status=failed; exitCode=1',
              source: 'interactive',
              error: '',
              evaluationStartedAt: '2026-04-08T12:00:00.000Z',
              decisionAt: '2026-04-08T12:00:01.000Z',
              completedAt: '2026-04-08T12:00:02.000Z',
            },
          ]}
          turnPolicyDecisionsError={null}
          turnPolicyDecisionsLoading={false}
        />
      </MemoryRouter>,
    )

    expect(screen.getByText('Recent Policy Decisions')).toBeTruthy()
    expect(screen.getByText('Failed validation command')).toBeTruthy()
    expect(screen.getByText('Steer')).toBeTruthy()
    expect(screen.getByText('Succeeded')).toBeTruthy()
    expect(screen.getByText('Interactive')).toBeTruthy()
    expect(screen.getByText('Turn policy fallback')).toBeTruthy()
    expect(screen.getByTitle('item/completed').textContent).toBe('Item Completed')
    expect(screen.getByText('turn-2')).toBeTruthy()
    expect(screen.getByText('Validation command failed')).toBeTruthy()
    expect(screen.getByText('command=go test ./...; status=failed; exitCode=1')).toBeTruthy()
    const cta = screen.getByRole('link', { name: 'Open workspace turn policy' })
    expect(cta.getAttribute('href')).toBe('/workspaces?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1')
  })
})
