// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchRailWorkbenchToolsSection } from './ThreadWorkbenchRailWorkbenchToolsSection'

describe('ThreadWorkbenchRailWorkbenchToolsSection', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('renders the send-to-bot form for a selected thread and disables send when no target exists', () => {
    render(
      <MemoryRouter>
        <ThreadWorkbenchRailWorkbenchToolsSection
          botSendBinding={null}
          botSendBindingPending={false}
          botSendBots={[
            {
              id: 'bot-1',
              workspaceId: 'ws-1',
              name: 'Ops Bot',
              status: 'active',
              endpointCount: 1,
              conversationCount: 0,
              createdAt: '2026-04-08T00:00:00.000Z',
              updatedAt: '2026-04-08T00:00:00.000Z',
            },
          ]}
          botSendDeliveryTargets={[]}
          botSendLoading={false}
          botSendPending={false}
          botSendSelectedBotId="bot-1"
          botSendSelectedDeliveryTargetId=""
          botSendText="Deploy update"
          command="git status"
          commandRunMode="command-exec"
          isWorkbenchToolsExpanded
          onBindThreadBotChannel={() => undefined}
          onChangeBotSendSelectedBotId={() => undefined}
          onChangeBotSendSelectedDeliveryTargetId={() => undefined}
          onChangeBotSendText={() => undefined}
          onChangeCommand={() => undefined}
          onChangeCommandRunMode={() => undefined}
          onDeleteThreadBotBinding={() => undefined}
          onSendBotMessage={() => undefined}
          onStartCommand={() => undefined}
          onToggleWorkbenchToolsExpanded={() => undefined}
          selectedThread={{
            id: 'thread-1',
            workspaceId: 'ws-1',
            name: 'Release Thread',
            status: 'idle',
            archived: false,
            createdAt: '2026-04-08T00:00:00.000Z',
            updatedAt: '2026-04-08T00:00:00.000Z',
          }}
          startCommandModeDisabled={false}
          startCommandPending={false}
        />
      </MemoryRouter>,
    )

    expect(screen.getByLabelText('Bot')).toBeTruthy()
    expect(screen.getByLabelText('Delivery target')).toBeTruthy()
    expect(screen.getByLabelText('Message')).toBeTruthy()
    expect(
      screen.getByText(
        'No bot channel is bound to Release Thread yet. Pick an existing delivery target to enable automatic outbound sync for new turns, or use the manual send box below.',
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bind Channel' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Send Override' }).hasAttribute('disabled')).toBe(true)
  })
})
