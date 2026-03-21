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
    expect(html).toContain('conversation-copyable')
    expect(html).toContain('aria-label="Copy source message"')
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
    expect(html).toContain('Files')
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

  it('renders markdown formatting inside chat bubbles', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-markdown',
        status: 'completed',
        items: [
          {
            type: 'userMessage',
            content: [{ type: 'inputText', text: 'Use `pnpm test`\n\n- alpha\n- beta' }],
          },
          {
            type: 'agentMessage',
            text: '**Done** with [docs](https://example.com/docs).',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('<code>pnpm test</code>')
    expect(html).toContain('<li>alpha</li>')
    expect(html).toContain('<strong>Done</strong>')
    expect(html).toContain('href="https://example.com/docs"')
    expect(html).toContain('target="_blank"')
  })

  it('renders ANSI command output with terminal styling', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-ansi',
        status: 'completed',
        items: [
          {
            type: 'commandExecution',
            command: 'git status --short',
            aggregatedOutput: '\u001b[32mworking tree clean\u001b[39m',
            status: 'completed',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('thread-code-block--terminal')
    expect(html).toContain('working tree clean')
    expect(html).toContain('style="color:')
    expect(html).toContain('1 line')
  })

  it('renders tool calls as collapsed detail cards in the chat timeline', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-4',
        status: 'completed',
        items: [
          {
            id: 'mcp-1',
            type: 'mcpToolCall',
            tool: 'read_file',
            server: 'filesystem',
            status: 'completed',
            arguments: { path: 'README.md' },
            result: { content: 'ok' },
            durationMs: 42,
          },
          {
            id: 'dynamic-1',
            type: 'dynamicToolCall',
            tool: 'search_query',
            status: 'completed',
            success: true,
            arguments: { q: 'codex server' },
            contentItems: [{ type: 'text', text: 'result' }],
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('conversation-card--tool')
    expect(html).toContain('<details')
    expect(html).not.toContain('<details open')
    expect(html).toContain('MCP Tool Call')
    expect(html).toContain('Tool Call')
    expect(html).toContain('read_file')
    expect(html).toContain('search_query')
    expect(html).toContain('Arguments')
    expect(html).toContain('Result')
    expect(html).toContain('Output')
  })

  it('formats structured tool results with terminal output sections', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-structured-tool',
        status: 'completed',
        items: [
          {
            id: 'mcp-ansi',
            type: 'mcpToolCall',
            tool: 'exec_command',
            status: 'completed',
            arguments: { command: 'git status' },
            result: {
              stdout: '\u001b[32mOn branch main\u001b[39m',
              stderr: '',
              exitCode: 0,
            },
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Stdout')
    expect(html).toContain('On branch main')
    expect(html).toContain('thread-code-block--terminal')
    expect(html).toContain('&quot;exitCode&quot;: 0')
  })

  it('renders server requests as collapsed request cards in the timeline', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-5',
        status: 'inProgress',
        items: [
          {
            id: 'server-request-req-1',
            type: 'serverRequest',
            requestId: 'req-1',
            requestKind: 'item/commandExecution/requestApproval',
            status: 'pending',
            details: {
              command: 'rm -rf build',
            },
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('conversation-card--request')
    expect(html).toContain('Command Approval')
    expect(html).toContain('rm -rf build')
    expect(html).toContain('conversation-card__status--running')
    expect(html).not.toContain('<details open')
  })

  it('renders expired server requests with a clear expired state', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-6',
        status: 'completed',
        items: [
          {
            id: 'server-request-req-2',
            type: 'serverRequest',
            requestId: 'req-2',
            requestKind: 'item/tool/requestUserInput',
            status: 'expired',
            expireReason: 'runtime_closed',
            details: {
              questions: [],
            },
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('conversation-card__status--error')
    expect(html).toContain('runtime connection was closed')
  })

  it('shows a retry action for expired server requests when a retry handler is available', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-7',
        status: 'completed',
        items: [
          {
            id: 'server-request-req-3',
            type: 'serverRequest',
            requestId: 'req-3',
            requestKind: 'item/fileChange/requestApproval',
            status: 'expired',
            expireReason: 'request_unavailable',
            details: {
              path: 'src/app.ts',
            },
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(
      <TurnTimeline onRetryServerRequest={() => undefined} turns={turns} />,
    )

    expect(html).toContain('Retry In Composer')
  })
})
