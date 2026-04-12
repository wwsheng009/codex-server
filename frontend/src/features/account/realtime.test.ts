import type { Account } from '../../types/api'
import type { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { RateLimit } from '../../types/api'
import {
  applyAccountUpdatedEventToCache,
  applyRateLimitUpdatedEventToCache,
  mergeAccountUpdatedEvent,
  mergeRateLimitSnapshot,
  parseAccountUpdatedEventPayload,
  parseRateLimitUpdatedEventPayload,
  syncAccountQueriesFromEvent,
} from './realtime'

describe('account rate-limit realtime sync', () => {
  it('parses account updated payload and merges into account cache shape', () => {
    expect(
      parseAccountUpdatedEventPayload({
        authMode: 'chatgpt',
        planType: 'plus',
      }),
    ).toEqual({
      authMode: 'chatgpt',
      planType: 'plus',
    })

    expect(
      mergeAccountUpdatedEvent(
        {
          id: 'acct_runtime',
          email: 'user@example.com',
          status: 'connected',
          authMode: 'chatgpt',
          planType: 'free',
          lastSyncedAt: '2025-01-01T00:00:00.000Z',
        },
        {
          authMode: 'chatgpt',
          planType: 'plus',
        },
      ),
    ).toMatchObject({
      id: 'acct_runtime',
      email: 'user@example.com',
      status: 'connected',
      authMode: 'chatgpt',
      planType: 'plus',
    } satisfies Partial<Account>)
  })

  it('parses updated event payload into snapshot model', () => {
    expect(
      parseRateLimitUpdatedEventPayload({
        rateLimits: {
          limitId: 'codex',
          limitName: 'Codex',
          primary: {
            usedPercent: 42,
            windowDurationMins: 60,
            resetsAt: 1_735_693_200,
          },
          credits: {
            hasCredits: true,
            unlimited: false,
            balance: '17.5',
          },
          planType: 'pro',
        },
      }),
    ).toEqual({
      limitId: 'codex',
      limitName: 'Codex',
      primary: {
        usedPercent: 42,
        windowDurationMins: 60,
        resetsAt: '2025-01-01T01:00:00.000Z',
      },
      secondary: null,
      credits: {
        hasCredits: true,
        unlimited: false,
        balance: '17.5',
      },
      planType: 'pro',
    } satisfies RateLimit)
  })

  it('merges updated snapshots into existing buckets by identity', () => {
    const current: RateLimit[] = [
      {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 10,
          windowDurationMins: 60,
          resetsAt: '2025-01-01T00:00:00.000Z',
        },
        secondary: null,
        credits: null,
        planType: 'free',
      },
      {
        limitId: 'codex_other',
        limitName: 'Codex Other',
        primary: {
          usedPercent: 77,
          windowDurationMins: 30,
          resetsAt: '2025-01-01T02:00:00.000Z',
        },
      },
    ]

    expect(
      mergeRateLimitSnapshot(current, {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 42,
          windowDurationMins: 60,
          resetsAt: '2025-01-01T01:00:00.000Z',
        },
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: '12.5',
        },
        planType: 'pro',
      }),
    ).toEqual([
      {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 42,
          windowDurationMins: 60,
          resetsAt: '2025-01-01T01:00:00.000Z',
        },
        secondary: null,
        credits: {
          hasCredits: true,
          unlimited: false,
          balance: '12.5',
        },
        planType: 'pro',
      },
      current[1],
    ])
  })

  it('writes updated snapshots into query cache and reports success', () => {
    let nextValue: RateLimit[] | undefined
    const queryClient = {
      setQueryData: ((_queryKey: unknown, updater: unknown) => {
        if (typeof updater !== 'function') {
          return undefined
        }

        nextValue = (
          updater as (current: RateLimit[] | undefined) => RateLimit[] | undefined
        )([
          {
            limitId: 'codex',
            limitName: 'Codex',
            primary: {
              usedPercent: 20,
              windowDurationMins: 60,
              resetsAt: '2025-01-01T00:00:00.000Z',
            },
          },
        ])
        return nextValue
      }) as QueryClient['setQueryData'],
    } satisfies Pick<QueryClient, 'setQueryData'>

    expect(
      applyRateLimitUpdatedEventToCache(queryClient, 'ws-1', {
        method: 'account/rateLimits/updated',
        payload: {
          rateLimits: {
            limitId: 'codex',
            primary: {
              usedPercent: 55,
              windowDurationMins: 60,
              resetsAt: 1_735_693_200,
            },
          },
        },
      }),
    ).toBe(true)

    expect(nextValue).toEqual([
      {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 55,
          windowDurationMins: 60,
          resetsAt: '2025-01-01T01:00:00.000Z',
        },
        secondary: null,
        credits: null,
        planType: null,
      },
    ])
  })

  it('syncs account and rate-limit queries from workspace events', async () => {
    const invalidatedQueryKeys: unknown[] = []
    let nextAccountValue: Account | undefined
    let nextValue: RateLimit[] | undefined
    const queryClient = {
      invalidateQueries: ((filters?: { queryKey?: unknown }) => {
        invalidatedQueryKeys.push(filters?.queryKey)
        return Promise.resolve()
      }) as QueryClient['invalidateQueries'],
      setQueryData: ((_queryKey: unknown, updater: unknown) => {
        if (typeof updater !== 'function') {
          return undefined
        }

        if (Array.isArray(_queryKey) && _queryKey[0] === 'account') {
          nextAccountValue = (
            updater as (current: Account | undefined) => Account | undefined
          )({
            id: 'acct_runtime',
            email: 'user@example.com',
            status: 'connected',
            authMode: 'chatgpt',
            planType: 'free',
            lastSyncedAt: '2025-01-01T00:00:00.000Z',
          })
          return nextAccountValue
        }

        nextValue = (
          updater as (current: RateLimit[] | undefined) => RateLimit[] | undefined
        )([])
        return nextValue
      }) as QueryClient['setQueryData'],
    } satisfies Pick<QueryClient, 'invalidateQueries' | 'setQueryData'>

    await syncAccountQueriesFromEvent(queryClient, 'ws-1', {
      method: 'account/updated',
      payload: {
        authMode: 'chatgpt',
        planType: 'plus',
      },
    })
    await syncAccountQueriesFromEvent(queryClient, 'ws-1', {
      method: 'account/rateLimits/updated',
      payload: {
        rateLimits: {
          limitId: 'codex',
          primary: {
            usedPercent: 61,
            windowDurationMins: 60,
            resetsAt: 1_735_693_200,
          },
        },
      },
    })

    expect(invalidatedQueryKeys).toEqual([
      ['account', 'ws-1'],
      ['rate-limits', 'ws-1'],
    ])
    expect(nextAccountValue).toEqual({
      id: 'acct_runtime',
      email: 'user@example.com',
      status: 'connected',
      authMode: 'chatgpt',
      planType: 'plus',
      lastSyncedAt: expect.any(String),
    })
    expect(nextValue).toEqual([
      {
        limitId: 'codex',
        limitName: null,
        primary: {
          usedPercent: 61,
          windowDurationMins: 60,
          resetsAt: '2025-01-01T01:00:00.000Z',
        },
        secondary: null,
        credits: null,
        planType: null,
      },
    ])
  })

  it('writes account-updated payloads into query cache and reports success', () => {
    let nextValue: Account | undefined
    const queryClient = {
      setQueryData: ((_queryKey: unknown, updater: unknown) => {
        if (typeof updater !== 'function') {
          return undefined
        }

        nextValue = (
          updater as (current: Account | undefined) => Account | undefined
        )({
          id: 'acct_runtime',
          email: 'not-connected',
          status: 'disconnected',
          authMode: null,
          planType: null,
          lastSyncedAt: '2025-01-01T00:00:00.000Z',
        })
        return nextValue
      }) as QueryClient['setQueryData'],
    } satisfies Pick<QueryClient, 'setQueryData'>

    expect(
      applyAccountUpdatedEventToCache(queryClient, 'ws-1', {
        method: 'account/updated',
        payload: {
          authMode: 'apiKey',
          planType: null,
        },
      }),
    ).toBe(true)

    expect(nextValue).toEqual({
      id: 'acct_runtime',
      email: 'apiKey',
      status: 'connected',
      authMode: 'apiKey',
      planType: null,
      lastSyncedAt: expect.any(String),
    })
  })
})
