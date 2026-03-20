import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { ThreadTurn } from '../../types/api'
import { TurnTimeline } from './renderers'

describe('TurnTimeline', () => {
  it('renders a chat-style stream without the old helper labels', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-1',
        status: 'completed',
        items: [
          {
            type: 'userMessage',
            content: [{ type: 'inputText', text: 'Inspect the thread UI.' }],
          },
          {
            type: 'agentMessage',
            text: 'The thread UI now renders as a chat stream.',
          },
          {
            type: 'reasoning',
            summary: ['internal summary'],
            content: ['internal detail'],
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('conversation-row--user')
    expect(html).toContain('conversation-row--assistant')
    expect(html).toContain('Inspect the thread UI.')
    expect(html).toContain('The thread UI now renders as a chat stream.')
    expect(html).not.toContain('You')
    expect(html).not.toContain('Codex')
    expect(html).not.toContain('Assistant Output')
    expect(html).not.toContain('Prompt')
    expect(html).not.toContain('internal summary')
    expect(html).not.toContain('internal detail')
  })

  it('keeps plan, command, and file changes as compact system cards', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-2',
        status: 'completed',
        items: [
          {
            type: 'plan',
            text: '1. Flatten turns\n2. Show chat bubbles',
          },
          {
            type: 'commandExecution',
            command: 'git status',
            aggregatedOutput: 'working tree clean',
            status: 'completed',
          },
          {
            type: 'fileChange',
            changes: [
              {
                path: 'frontend/src/components/workspace/renderers.tsx',
                kind: { type: 'update' },
              },
            ],
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Plan')
    expect(html).toContain('Flatten turns')
    expect(html).toContain('Command')
    expect(html).toContain('git status')
    expect(html).toContain('Changed Files')
    expect(html).toContain('frontend/src/components/workspace/renderers.tsx')
    expect(html).toContain('Update')
  })

  it('renders a live cursor for streaming agent messages', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-3',
        status: 'inProgress',
        items: [
          {
            id: 'item-1',
            type: 'agentMessage',
            text: 'Streaming reply',
            phase: 'streaming',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('conversation-bubble--streaming')
    expect(html).toContain('conversation-bubble__cursor')
    expect(html).toContain('Streaming reply')
  })
})
