import { describe, expect, it } from 'vitest'

import type { ServerEvent } from '../types/api'
import { computeContextUsage, readThreadTokenUsageFromEvent } from './thread-token-usage'

describe('thread-token-usage', () => {
  it('reads token usage from thread/tokenUsage/updated events', () => {
    const event: ServerEvent = {
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      turnId: 'turn-1',
      method: 'thread/tokenUsage/updated',
      payload: {
        threadId: 'thread-1',
        tokenUsage: {
          last: {
            cachedInputTokens: 10,
            inputTokens: 100,
            outputTokens: 40,
            reasoningOutputTokens: 5,
            totalTokens: 145,
          },
          total: {
            cachedInputTokens: 12,
            inputTokens: 1200,
            outputTokens: 340,
            reasoningOutputTokens: 50,
            totalTokens: 1590,
          },
          modelContextWindow: 8000,
        },
      },
      ts: '2026-03-20T12:00:00.000Z',
    }

    const parsed = readThreadTokenUsageFromEvent(event)

    expect(parsed).toEqual({
      threadId: 'thread-1',
      usage: {
        last: {
          cachedInputTokens: 10,
          inputTokens: 100,
          outputTokens: 40,
          reasoningOutputTokens: 5,
          totalTokens: 145,
        },
        total: {
          cachedInputTokens: 12,
          inputTokens: 1200,
          outputTokens: 340,
          reasoningOutputTokens: 50,
          totalTokens: 1590,
        },
        modelContextWindow: 8000,
      },
    })
  })

  it('computes usage percentage from token usage snapshots', () => {
    const usage = {
      last: {
        cachedInputTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 145,
      },
      total: {
        cachedInputTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 2000,
      },
      modelContextWindow: 8000,
    }

    expect(computeContextUsage(usage)).toEqual({
      contextWindow: 8000,
      percent: 2,
      totalTokens: 145,
    })
  })
})
