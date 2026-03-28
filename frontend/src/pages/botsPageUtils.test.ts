import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../i18n/runtime'
import {
  buildBotConnectionCreateInput,
  EMPTY_BOTS_PAGE_DRAFT,
  formatBotConversationTitle,
  summarizeBotMap,
} from './botsPageUtils'

describe('botsPageUtils', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('builds a workspace-thread connection payload with trimmed values', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      name: '  Support Bot  ',
      publicBaseUrl: ' https://bots.example.com ',
      telegramBotToken: ' token-1 ',
      workspaceModel: ' gpt-5.4 ',
      workspaceReasoning: ' high ',
      workspaceCollaborationMode: ' plan ',
    })

    expect(input).toEqual({
      provider: 'telegram',
      name: 'Support Bot',
      publicBaseUrl: 'https://bots.example.com',
      aiBackend: 'workspace_thread',
      aiConfig: {
        model: 'gpt-5.4',
        reasoning_effort: 'high',
        collaboration_mode: 'plan',
      },
      settings: {
        runtime_mode: 'normal',
        telegram_delivery_mode: 'webhook',
      },
      secrets: {
        bot_token: 'token-1',
      },
    })
  })

  it('builds an openai responses payload with api settings and store flag', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      name: 'Responder',
      aiBackend: 'openai_responses',
      telegramBotToken: 'token-2',
      openAIApiKey: 'sk-test',
      openAIBaseUrl: ' https://api.openai.com/v1/responses ',
      openAIModel: ' gpt-5.4-mini ',
      openAIInstructions: ' Keep answers short. ',
      openAIReasoning: ' medium ',
      openAIStore: false,
    })

    expect(input).toEqual({
      provider: 'telegram',
      name: 'Responder',
      publicBaseUrl: undefined,
      aiBackend: 'openai_responses',
      aiConfig: {
        model: 'gpt-5.4-mini',
        instructions: 'Keep answers short.',
        reasoning_effort: 'medium',
        store: 'false',
      },
      settings: {
        runtime_mode: 'normal',
        telegram_delivery_mode: 'webhook',
        openai_base_url: 'https://api.openai.com/v1/responses',
      },
      secrets: {
        bot_token: 'token-2',
        openai_api_key: 'sk-test',
      },
    })
  })

  it('omits public base url for telegram polling mode', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      telegramDeliveryMode: 'polling',
      publicBaseUrl: ' https://bots.example.com ',
      telegramBotToken: ' token-3 ',
    })

    expect(input).toEqual({
      provider: 'telegram',
      name: '',
      publicBaseUrl: undefined,
      aiBackend: 'workspace_thread',
      aiConfig: {
        model: 'gpt-5.4',
        reasoning_effort: 'medium',
        collaboration_mode: 'default',
      },
      settings: {
        runtime_mode: 'normal',
        telegram_delivery_mode: 'polling',
      },
      secrets: {
        bot_token: 'token-3',
      },
    })
  })

  it('writes debug runtime mode into bot settings', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      runtimeMode: 'debug',
      telegramBotToken: 'token-debug',
    })

    expect(input.settings).toEqual({
      runtime_mode: 'debug',
      telegram_delivery_mode: 'webhook',
    })
  })

  it('summarizes maps in stable key order and formats conversation titles by precedence', () => {
    expect(summarizeBotMap({ zeta: '3', alpha: '1', beta: '2' })).toBe('alpha=1, beta=2, zeta=3')
    expect(summarizeBotMap(undefined)).toBe('none')

    expect(
      formatBotConversationTitle({
        id: 'bcn_1',
        workspaceId: 'ws_1',
        connectionId: 'bot_1',
        provider: 'telegram',
        externalChatId: 'chat_1',
        externalThreadId: '77',
        externalUserId: 'user_1',
        externalUsername: 'alice',
        externalTitle: 'Alice A.',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      }),
    ).toBe('Alice A. (topic 77)')

    expect(
      formatBotConversationTitle({
        id: 'bcn_2',
        workspaceId: 'ws_1',
        connectionId: 'bot_1',
        provider: 'telegram',
        externalChatId: 'chat_2',
        externalUserId: 'user_2',
        externalUsername: 'bob',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      }),
    ).toBe('bob')
  })
})
