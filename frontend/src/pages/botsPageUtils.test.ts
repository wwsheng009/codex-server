import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../i18n/runtime'
import {
  BOT_COMMAND_OUTPUT_MODE_BRIEF,
  BOT_COMMAND_OUTPUT_MODE_FULL,
  BOT_COMMAND_OUTPUT_MODE_NONE,
  BOT_COMMAND_OUTPUT_MODE_SETTING,
  BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE,
  buildBotConnectionUpdateInput,
  buildBotsPageDraftFromConnection,
  buildBotConnectionCreateInput,
  countWeChatConnectionsForAccount,
  EMPTY_BOTS_PAGE_DRAFT,
  formatBotCommandOutputModeLabel,
  formatBotConversationTitle,
  formatBotWorkspacePermissionPresetLabel,
  formatWeChatAccountLabel,
  findWeChatAccountForConnection,
  isBotWorkspacePermissionPresetFullAccess,
  isWeChatConnectionForAccount,
  listWeChatConnectionsForAccount,
  matchesBotConnectionSearch,
  matchesWeChatAccountSearch,
  resolveBotConnectionPublicBaseUrl,
  resolveBotCommandOutputMode,
  resolveWeChatChannelTimingEnabled,
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
      workspacePermissionPreset: ' full-access ',
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
        permission_preset: 'full-access',
        reasoning_effort: 'high',
        collaboration_mode: 'plan',
      },
      settings: {
        command_output_mode: 'brief',
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
        command_output_mode: 'brief',
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
        permission_preset: 'default',
        reasoning_effort: 'medium',
        collaboration_mode: 'default',
      },
      settings: {
        command_output_mode: 'brief',
        runtime_mode: 'normal',
        telegram_delivery_mode: 'polling',
      },
      secrets: {
        bot_token: 'token-3',
      },
    })
  })

  it('builds a wechat polling payload with provider-specific settings', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      provider: 'wechat',
      wechatChannelTimingEnabled: true,
      wechatCredentialSource: 'qr',
      wechatLoginSessionId: 'login-123',
      wechatLoginStatus: 'confirmed',
      wechatQrCodeContent: 'weixin://qr/abc',
      name: ' WeChat Support ',
      publicBaseUrl: ' https://ignored.example.com ',
      wechatBaseUrl: ' https://wechat.example.com ',
      wechatAccountId: ' account-7 ',
      wechatUserId: ' owner-9 ',
      wechatBotToken: ' wechat-token-3 ',
    })

    expect(input).toEqual({
      provider: 'wechat',
      name: 'WeChat Support',
      publicBaseUrl: undefined,
      aiBackend: 'workspace_thread',
      aiConfig: {
        model: 'gpt-5.4',
        permission_preset: 'default',
        reasoning_effort: 'medium',
        collaboration_mode: 'default',
      },
      settings: {
        command_output_mode: 'brief',
        runtime_mode: 'normal',
        wechat_delivery_mode: 'polling',
        wechat_base_url: 'https://wechat.example.com',
        wechat_channel_timing: 'enabled',
        wechat_login_session_id: 'login-123',
      },
      secrets: undefined,
    })
  })

  it('builds a wechat qr payload from a confirmed login session without copying credentials into the form', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      provider: 'wechat',
      wechatCredentialSource: 'qr',
      wechatLoginSessionId: 'login-confirmed-7',
      wechatLoginStatus: 'confirmed',
      wechatBaseUrl: ' https://wechat.example.com ',
    })

    expect(input).toEqual({
      provider: 'wechat',
      name: '',
      publicBaseUrl: undefined,
      aiBackend: 'workspace_thread',
      aiConfig: {
        model: 'gpt-5.4',
        permission_preset: 'default',
        reasoning_effort: 'medium',
        collaboration_mode: 'default',
      },
      settings: {
        command_output_mode: 'brief',
        runtime_mode: 'normal',
        wechat_delivery_mode: 'polling',
        wechat_base_url: 'https://wechat.example.com',
        wechat_channel_timing: 'disabled',
        wechat_login_session_id: 'login-confirmed-7',
      },
      secrets: undefined,
    })
  })

  it('builds a wechat payload from a saved account selection', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      provider: 'wechat',
      wechatCredentialSource: 'saved',
      wechatSavedAccountId: 'wca_000123',
      wechatBaseUrl: ' https://wechat.example.com ',
      wechatRouteTag: ' route-1 ',
    })

    expect(input).toEqual({
      provider: 'wechat',
      name: '',
      publicBaseUrl: undefined,
      aiBackend: 'workspace_thread',
      aiConfig: {
        model: 'gpt-5.4',
        permission_preset: 'default',
        reasoning_effort: 'medium',
        collaboration_mode: 'default',
      },
      settings: {
        command_output_mode: 'brief',
        runtime_mode: 'normal',
        wechat_delivery_mode: 'polling',
        wechat_base_url: 'https://wechat.example.com',
        wechat_channel_timing: 'disabled',
        wechat_route_tag: 'route-1',
        wechat_saved_account_id: 'wca_000123',
      },
      secrets: undefined,
    })
  })

  it('builds an update payload with the same structure as create input', () => {
    const input = buildBotConnectionUpdateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      name: '  Support Bot v2  ',
      telegramBotToken: ' token-4 ',
      workspaceModel: ' gpt-5.4-mini ',
    })

    expect(input).toEqual({
      provider: 'telegram',
      name: 'Support Bot v2',
      publicBaseUrl: undefined,
      aiBackend: 'workspace_thread',
      aiConfig: {
        model: 'gpt-5.4-mini',
        permission_preset: 'default',
        reasoning_effort: 'medium',
        collaboration_mode: 'default',
      },
      settings: {
        command_output_mode: 'brief',
        runtime_mode: 'normal',
        telegram_delivery_mode: 'webhook',
      },
      secrets: {
        bot_token: 'token-4',
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
      command_output_mode: 'brief',
      runtime_mode: 'debug',
      telegram_delivery_mode: 'webhook',
    })
  })

  it('writes the configured command output mode into bot settings', () => {
    const input = buildBotConnectionCreateInput({
      ...EMPTY_BOTS_PAGE_DRAFT,
      commandOutputMode: BOT_COMMAND_OUTPUT_MODE_NONE,
      telegramBotToken: 'token-brief',
    })

    expect(input.settings?.[BOT_COMMAND_OUTPUT_MODE_SETTING]).toBe(BOT_COMMAND_OUTPUT_MODE_NONE)
  })

  it('resolves and formats bot command output modes with a brief default', () => {
    expect(resolveBotCommandOutputMode(undefined)).toBe(BOT_COMMAND_OUTPUT_MODE_BRIEF)
    expect(resolveBotCommandOutputMode('unknown')).toBe(BOT_COMMAND_OUTPUT_MODE_BRIEF)
    expect(resolveBotCommandOutputMode(BOT_COMMAND_OUTPUT_MODE_NONE)).toBe(BOT_COMMAND_OUTPUT_MODE_NONE)
    expect(resolveBotCommandOutputMode(BOT_COMMAND_OUTPUT_MODE_FULL)).toBe(BOT_COMMAND_OUTPUT_MODE_FULL)

    expect(formatBotCommandOutputModeLabel(BOT_COMMAND_OUTPUT_MODE_NONE)).toBe('No Command Output')
    expect(formatBotCommandOutputModeLabel(BOT_COMMAND_OUTPUT_MODE_SINGLE_LINE)).toBe('Single Line')
    expect(formatBotCommandOutputModeLabel(BOT_COMMAND_OUTPUT_MODE_BRIEF)).toBe('Brief (3-5 lines)')
    expect(formatBotCommandOutputModeLabel(BOT_COMMAND_OUTPUT_MODE_FULL)).toBe('Full Output')
  })

  it('formats workspace thread permission presets with a safe default', () => {
    expect(isBotWorkspacePermissionPresetFullAccess(undefined)).toBe(false)
    expect(isBotWorkspacePermissionPresetFullAccess('default')).toBe(false)
    expect(isBotWorkspacePermissionPresetFullAccess(' full-access ')).toBe(true)
    expect(formatBotWorkspacePermissionPresetLabel(undefined)).toBe('Default permission')
    expect(formatBotWorkspacePermissionPresetLabel('default')).toBe('Default permission')
    expect(formatBotWorkspacePermissionPresetLabel(' full-access ')).toBe('Full access')
  })

  it('resolves wechat channel timing from explicit settings before runtime mode fallback', () => {
    expect(resolveWeChatChannelTimingEnabled({ wechat_channel_timing: 'enabled' }, 'normal')).toBe(true)
    expect(resolveWeChatChannelTimingEnabled({ wechat_channel_timing: 'disabled' }, 'debug')).toBe(false)
    expect(resolveWeChatChannelTimingEnabled({}, 'debug')).toBe(true)
    expect(resolveWeChatChannelTimingEnabled(undefined, 'normal')).toBe(false)
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

    expect(
      formatBotConversationTitle({
        id: 'bcn_3',
        workspaceId: 'ws_1',
        connectionId: 'bot_2',
        provider: 'wechat',
        externalChatId: 'chat_3',
        externalThreadId: 'topic-like-value',
        externalUserId: 'user_3',
        externalTitle: 'Charlie',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
      }),
    ).toBe('Charlie')
  })

  it('formats and filters saved wechat account labels', () => {
    const account = {
      alias: 'Support Queue',
      note: 'Primary handoff account',
      baseUrl: 'https://wechat.example.com',
      accountId: 'acct_1',
      userId: 'user_1',
    }

    expect(formatWeChatAccountLabel(account)).toBe('Support Queue · acct_1 · user_1')
    expect(formatWeChatAccountLabel({ ...account, alias: '   ' })).toBe('acct_1 · user_1')
    expect(matchesWeChatAccountSearch(account, 'support')).toBe(true)
    expect(matchesWeChatAccountSearch(account, 'handoff')).toBe(true)
    expect(matchesWeChatAccountSearch(account, 'wechat.example')).toBe(true)
    expect(matchesWeChatAccountSearch(account, 'missing')).toBe(false)
  })

  it('matches connection search against linked wechat account metadata', () => {
    const linkedAccount = {
      alias: 'Support Queue',
      note: 'Primary handoff account',
      accountId: 'acct_1',
      userId: 'user_1',
    }

    expect(
      matchesBotConnectionSearch(
        {
          name: 'WeChat Support',
          provider: 'wechat',
          status: 'active',
          aiBackend: 'workspace_thread',
        },
        'support queue',
        linkedAccount,
      ),
    ).toBe(true)
    expect(
      matchesBotConnectionSearch(
        {
          name: 'Telegram Sales',
          provider: 'telegram',
          status: 'paused',
          aiBackend: 'openai_responses',
        },
        'paused',
        null,
      ),
    ).toBe(true)
    expect(
      matchesBotConnectionSearch(
        {
          name: 'Telegram Sales',
          provider: 'telegram',
          status: 'paused',
          aiBackend: 'openai_responses',
        },
        'handoff',
        null,
      ),
    ).toBe(false)
  })

  it('matches saved wechat accounts to connections and counts reuse per workspace', () => {
    const account = {
      id: 'wca_1',
      workspaceId: 'ws_1',
      baseUrl: 'https://wechat.example.com',
      accountId: 'acct_1',
      userId: 'user_1',
      lastConfirmedAt: '2026-04-06T00:00:00.000Z',
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
    }

    const matchingConnection = {
      id: 'bot_1',
      workspaceId: 'ws_1',
      provider: 'wechat',
      name: 'WeChat Support',
      aiBackend: 'workspace_thread',
      settings: {
        wechat_base_url: 'https://wechat.example.com',
        wechat_account_id: 'acct_1',
        wechat_owner_user_id: 'user_1',
      },
      status: 'active',
      createdAt: '2026-04-06T00:00:00.000Z',
      updatedAt: '2026-04-06T00:00:00.000Z',
      secretKeys: [],
    }

    expect(isWeChatConnectionForAccount(matchingConnection, account)).toBe(true)
    expect(
      isWeChatConnectionForAccount(
        {
          ...matchingConnection,
          settings: {
            ...matchingConnection.settings,
            wechat_base_url: 'https://wechat-alt.example.com',
          },
        },
        account,
      ),
    ).toBe(false)

    expect(
      countWeChatConnectionsForAccount(
        [
          matchingConnection,
          {
            ...matchingConnection,
            id: 'bot_2',
            settings: {
              ...matchingConnection.settings,
              extra: 'value',
            },
          },
          {
            ...matchingConnection,
            id: 'bot_3',
            provider: 'telegram',
          },
          {
            ...matchingConnection,
            id: 'bot_4',
            settings: {
              ...matchingConnection.settings,
              wechat_owner_user_id: 'user_2',
            },
          },
        ],
        account,
      ),
    ).toBe(2)

    expect(
      listWeChatConnectionsForAccount(
        [
          matchingConnection,
          {
            ...matchingConnection,
            id: 'bot_2',
            name: 'WeChat Sales',
          },
          {
            ...matchingConnection,
            id: 'bot_3',
            provider: 'telegram',
          },
        ],
        account,
      ).map((connection) => connection.id),
    ).toEqual(['bot_1', 'bot_2'])

    expect(
      findWeChatAccountForConnection(
        [
          account,
          {
            ...account,
            id: 'wca_2',
            accountId: 'acct_2',
          },
        ],
        matchingConnection,
      )?.id,
    ).toBe('wca_1')
  })

  it('builds an edit draft from an existing telegram connection', () => {
    const draft = buildBotsPageDraftFromConnection({
      id: 'bot_123',
      workspaceId: 'ws_1',
      provider: 'telegram',
      name: 'Support Bot',
      status: 'active',
      aiBackend: 'openai_responses',
      aiConfig: {
        model: 'gpt-5.4-mini',
        instructions: 'Keep replies short.',
        reasoning_effort: 'high',
        store: 'false',
      },
      settings: {
        telegram_delivery_mode: 'webhook',
        webhook_url: 'https://bots.example.com/hooks/bots/bot_123',
        command_output_mode: 'full',
        runtime_mode: 'debug',
        openai_base_url: 'https://api.openai.com/v1/responses',
      },
      secretKeys: ['bot_token', 'openai_api_key'],
      createdAt: '2026-04-06T00:00:00Z',
      updatedAt: '2026-04-06T00:00:00Z',
    })

    expect(draft).toMatchObject({
      workspaceId: 'ws_1',
      provider: 'telegram',
      name: 'Support Bot',
      runtimeMode: 'debug',
      commandOutputMode: 'full',
      telegramDeliveryMode: 'webhook',
      publicBaseUrl: 'https://bots.example.com',
      aiBackend: 'openai_responses',
      openAIBaseUrl: 'https://api.openai.com/v1/responses',
      openAIModel: 'gpt-5.4-mini',
      openAIInstructions: 'Keep replies short.',
      openAIReasoning: 'high',
      openAIStore: false,
      telegramBotToken: '',
    })
  })

  it('prefers a saved wechat account when building an edit draft', () => {
    const account = {
      id: 'wca_1',
      workspaceId: 'ws_1',
      baseUrl: 'https://wechat.example.com',
      accountId: 'account-1',
      userId: 'owner-1',
      lastConfirmedAt: '2026-04-06T00:00:00Z',
      createdAt: '2026-04-06T00:00:00Z',
      updatedAt: '2026-04-06T00:00:00Z',
    }

    const draft = buildBotsPageDraftFromConnection(
      {
        id: 'bot_456',
        workspaceId: 'ws_1',
        provider: 'wechat',
        name: 'WeChat Bot',
        status: 'active',
        aiBackend: 'workspace_thread',
        aiConfig: {
          model: 'gpt-5.4',
          permission_preset: 'full-access',
          reasoning_effort: 'medium',
          collaboration_mode: 'plan',
        },
        settings: {
          wechat_base_url: 'https://wechat.example.com',
          wechat_account_id: 'account-1',
          wechat_owner_user_id: 'owner-1',
          wechat_route_tag: 'route-1',
          wechat_channel_timing: 'enabled',
          command_output_mode: 'single_line',
          runtime_mode: 'normal',
        },
        secretKeys: ['bot_token'],
        createdAt: '2026-04-06T00:00:00Z',
        updatedAt: '2026-04-06T00:00:00Z',
      },
      [account],
    )

    expect(draft).toMatchObject({
      provider: 'wechat',
      wechatCredentialSource: 'saved',
      wechatSavedAccountId: 'wca_1',
      wechatBaseUrl: 'https://wechat.example.com',
      wechatRouteTag: 'route-1',
      wechatChannelTimingEnabled: true,
      workspacePermissionPreset: 'full-access',
      workspaceCollaborationMode: 'plan',
      wechatBotToken: '',
    })
  })

  it('extracts telegram public base url from the stored webhook url', () => {
    expect(
      resolveBotConnectionPublicBaseUrl({
        id: 'bot_789',
        provider: 'telegram',
        settings: {
          webhook_url: 'https://bots.example.com/hooks/bots/bot_789',
        },
      }),
    ).toBe('https://bots.example.com')
  })
})
