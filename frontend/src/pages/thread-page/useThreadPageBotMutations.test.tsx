// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'

import { i18n } from '../../i18n/runtime'
import { useThreadPageBotMutations } from './useThreadPageBotMutations'

const botApiState = vi.hoisted(() => ({
  deleteThreadBotBinding: vi.fn(),
  sendBotDeliveryTargetOutboundMessages: vi.fn(),
  upsertThreadBotBinding: vi.fn(),
}))

vi.mock('../../features/bots/api', () => ({
  deleteThreadBotBinding: botApiState.deleteThreadBotBinding,
  sendBotDeliveryTargetOutboundMessages: botApiState.sendBotDeliveryTargetOutboundMessages,
  upsertThreadBotBinding: botApiState.upsertThreadBotBinding,
}))

describe('useThreadPageBotMutations', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('passes thread origin metadata into the bot outbound API', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const setBotSendText = vi.fn()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_710_000_000_000)

    botApiState.sendBotDeliveryTargetOutboundMessages.mockResolvedValue({
      id: 'delivery-1',
      botId: 'bot-1',
      endpointId: 'endpoint-1',
      sourceType: 'manual',
      status: 'queued',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useThreadPageBotMutations({
          queryClient,
          setBotSendText,
          threadWorkspaceId: 'ws-thread',
          workspaceId: 'ws-1',
        }),
      { wrapper },
    )

    await act(async () => {
        await result.current.sendBotDeliveryTargetOutboundMessageMutation.mutateAsync({
          botWorkspaceId: 'ws-bot',
          botId: 'bot-1',
          deliveryTargetId: 'target-1',
          text: 'Ship the status update',
        threadId: 'thread-1',
        threadWorkspaceId: 'ws-thread',
      })
    })

    expect(botApiState.sendBotDeliveryTargetOutboundMessages).toHaveBeenCalledWith(
      'ws-bot',
      'bot-1',
      'target-1',
      expect.objectContaining({
        idempotencyKey: 'thread-bot-send:ws-thread:thread-1:1710000000000',
        messages: [{ text: 'Ship the status update' }],
        originThreadId: 'thread-1',
        originWorkspaceId: 'ws-thread',
        sourceRefId: 'thread-1',
        sourceRefType: 'thread',
        sourceType: 'manual',
      }),
    )
    expect(setBotSendText).toHaveBeenCalledWith('')

    nowSpy.mockRestore()
  })

  it('binds the selected delivery target to the current thread', async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })

    botApiState.upsertThreadBotBinding.mockResolvedValue({
      id: 'binding-1',
      workspaceId: 'ws-1',
      threadId: 'thread-1',
      botId: 'bot-1',
      botName: 'Ops Bot',
      deliveryTargetId: 'target-1',
      endpointId: 'endpoint-1',
      provider: 'telegram',
      status: 'active',
      createdAt: '2026-04-08T00:00:00.000Z',
      updatedAt: '2026-04-08T00:00:00.000Z',
    })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(
      () =>
        useThreadPageBotMutations({
          queryClient,
          setBotSendText: vi.fn(),
          threadWorkspaceId: 'ws-thread',
          workspaceId: 'ws-1',
        }),
      { wrapper },
    )

    await act(async () => {
      await result.current.bindThreadBotChannelMutation.mutateAsync({
        botWorkspaceId: 'ws-bot',
        botId: 'bot-1',
        deliveryTargetId: 'target-1',
        threadId: 'thread-1',
      })
    })

    expect(botApiState.upsertThreadBotBinding).toHaveBeenCalledWith('ws-1', 'thread-1', {
      botWorkspaceId: 'ws-bot',
      botId: 'bot-1',
      deliveryTargetId: 'target-1',
    })
  })
})
