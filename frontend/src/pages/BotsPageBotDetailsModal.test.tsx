// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../i18n/runtime'
import { BotsPageBotDetailsModal } from './BotsPageBotDetailsModal'

describe('BotsPageBotDetailsModal', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the bot summary and its primary endpoint snapshot', () => {
    render(
      <MemoryRouter>
        <BotsPageBotDetailsModal
          bot={{
            id: 'bot-1',
            workspaceId: 'ws-1',
            scope: 'workspace',
            sharingMode: 'owner_only',
            sharedWorkspaceIds: [],
            name: 'Solo Bot',
            description: 'Bot with one endpoint',
            status: 'active',
            defaultBindingId: null,
            defaultBindingMode: null,
            defaultTargetWorkspaceId: null,
            defaultTargetThreadId: null,
            endpointCount: 1,
            conversationCount: 0,
            createdAt: '2026-04-23T00:00:00.000Z',
            updatedAt: '2026-04-23T00:00:00.000Z',
          }}
          connections={[
            {
              id: 'conn-1',
              botId: 'bot-1',
              workspaceId: 'ws-1',
              provider: 'telegram',
              name: 'Telegram Endpoint',
              status: 'active',
              aiBackend: 'workspace_thread',
              aiConfig: {
                permission_preset: 'default',
              },
              settings: {
                telegram_delivery_mode: 'webhook',
                runtime_mode: 'normal',
                command_output_mode: 'brief',
              },
              capabilities: ['supportsTextOutbound', 'supportsSessionlessPush'],
              secretKeys: ['telegram_bot_token'],
              lastPollAt: null,
              lastPollStatus: null,
              lastPollMessage: null,
              lastPollMessageKey: null,
              lastPollMessageParams: null,
              createdAt: '2026-04-23T00:00:00.000Z',
              updatedAt: '2026-04-23T00:00:00.000Z',
            },
          ]}
          onClose={() => undefined}
          workspaceById={
            new Map([
              [
                'ws-1',
                {
                  id: 'ws-1',
                  name: 'Alpha Workspace',
                  rootPath: 'E:/alpha',
                  runtimeStatus: 'ready',
                  createdAt: '2026-04-23T00:00:00.000Z',
                  updatedAt: '2026-04-23T00:00:00.000Z',
                },
              ],
            ])
          }
        />
      </MemoryRouter>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Bot Details' })
    expect(within(dialog).getByText('Bot Summary')).toBeInTheDocument()
    expect(within(dialog).getByText('Bot ID')).toBeInTheDocument()
    expect(within(dialog).getAllByText('Alpha Workspace').length).toBeGreaterThan(0)
    expect(within(dialog).getByText('Primary Endpoint')).toBeInTheDocument()
    expect(within(dialog).getByText('Telegram Endpoint')).toBeInTheDocument()
    expect(within(dialog).getByText('Provider')).toBeInTheDocument()
    expect(within(dialog).getByText('Backend')).toBeInTheDocument()
  })
})
