// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import { useWorkspaceTurnPolicyRecentDecisions } from './useWorkspaceTurnPolicyRecentDecisions'

const threadsApiState = vi.hoisted(() => ({
  listTurnPolicyDecisions: vi.fn(),
}))

vi.mock('../../features/threads/api', () => ({
  listTurnPolicyDecisions: threadsApiState.listTurnPolicyDecisions,
}))

describe('useWorkspaceTurnPolicyRecentDecisions', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('does not query until a workspace is selected', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () => useWorkspaceTurnPolicyRecentDecisions({ selectedWorkspaceId: '' }),
      { wrapper },
    )

    expect(threadsApiState.listTurnPolicyDecisions).not.toHaveBeenCalled()
    expect(result.current.turnPolicyDecisions).toEqual([])
    expect(result.current.hasAnyDecisions).toBe(false)
    expect(result.current.turnPolicyDecisionsLoading).toBe(false)
    expect(result.current.turnPolicyDecisionsError).toBeNull()
  })

  it('loads workspace recent turn policy decisions with filters and the configured limit', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    threadsApiState.listTurnPolicyDecisions.mockResolvedValueOnce([
      {
        id: 'decision-1',
        workspaceId: 'ws-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'item-1',
        triggerMethod: 'background_audit',
        policyName: 'missing_successful_verification',
        fingerprint: 'fp-1',
        verdict: 'flagged',
        action: 'follow_up',
        actionStatus: 'succeeded',
        actionTurnId: 'turn-2',
        reason: 'Verification command was not run successfully.',
        evidenceSummary: 'No successful verify output detected.',
        source: 'workspace',
        error: undefined,
        evaluationStartedAt: '2026-04-08T10:00:00.000Z',
        decisionAt: '2026-04-08T10:00:05.000Z',
        completedAt: '2026-04-08T10:00:06.000Z',
      },
    ])
    threadsApiState.listTurnPolicyDecisions.mockResolvedValueOnce([
      {
        id: 'decision-any',
        workspaceId: 'ws-1',
        threadId: 'thread-9',
        triggerMethod: 'item/completed',
        policyName: 'posttooluse/failed-validation-command',
        fingerprint: 'fp-any',
        verdict: 'steer',
        action: 'steer',
        actionStatus: 'succeeded',
        reason: 'validation_command_failed',
        evaluationStartedAt: '2026-04-08T10:01:00.000Z',
        decisionAt: '2026-04-08T10:01:01.000Z',
        completedAt: '2026-04-08T10:01:02.000Z',
      },
    ])

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useWorkspaceTurnPolicyRecentDecisions({
          selectedWorkspaceId: 'ws-1',
          filters: {
            policyName: 'stop/missing-successful-verification',
            action: 'followUp',
            actionStatus: 'succeeded',
            source: 'automation',
            reason: 'follow_up_cooldown_active',
          },
          limit: 3,
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.turnPolicyDecisionsLoading).toBe(false)
    })

    expect(threadsApiState.listTurnPolicyDecisions).toHaveBeenNthCalledWith(1, 'ws-1', {
      policyName: 'stop/missing-successful-verification',
      action: 'followUp',
      actionStatus: 'succeeded',
      source: 'automation',
      reason: 'follow_up_cooldown_active',
      threadId: '',
      limit: 3,
    })
    expect(threadsApiState.listTurnPolicyDecisions).toHaveBeenNthCalledWith(2, 'ws-1', {
      limit: 1,
    })
    expect(result.current.turnPolicyDecisions).toHaveLength(1)
    expect(result.current.hasAnyDecisions).toBe(true)
    expect(result.current.turnPolicyDecisionsError).toBeNull()
  })

  it('returns stringified query errors', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    })

    threadsApiState.listTurnPolicyDecisions.mockRejectedValueOnce(new Error('Decision load failed'))

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useWorkspaceTurnPolicyRecentDecisions({
          selectedWorkspaceId: 'ws-1',
        }),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.turnPolicyDecisionsError).toBe('Decision load failed')
    })

    expect(result.current.turnPolicyDecisions).toEqual([])
    expect(result.current.hasAnyDecisions).toBe(false)
    expect(result.current.turnPolicyDecisionsLoading).toBe(false)
  })
})
