import { renderToStaticMarkup } from 'react-dom/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import type { ThreadTurn } from '../../types/api'
import {
  areTurnTimelinePropsEqual,
  nextStreamingRevealLength,
  shouldVirtualizeTurnTimeline,
  TurnTimeline,
} from './renderers'

describe('TurnTimeline', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('only enables virtualization for timelines that exceed the threshold with a viewport ref', () => {
    expect(
      shouldVirtualizeTurnTimeline({
        entryCount: 10,
        hasScrollViewportRef: true,
        timelineIdentity: 'thread-1',
      }),
    ).toBe(false)

    expect(
      shouldVirtualizeTurnTimeline({
        entryCount: 80,
        hasScrollViewportRef: true,
        timelineIdentity: 'thread-1',
      }),
    ).toBe(true)

    expect(
      shouldVirtualizeTurnTimeline({
        entryCount: 120,
        disableVirtualization: true,
        hasScrollViewportRef: true,
        timelineIdentity: 'thread-1',
      }),
    ).toBe(false)

    expect(
      shouldVirtualizeTurnTimeline({
        entryCount: 120,
        hasScrollViewportRef: false,
        timelineIdentity: 'thread-1',
      }),
    ).toBe(false)
  })

  it('invalidates the memoized timeline when virtualization control props change', () => {
    const turns: ThreadTurn[] = []
    const viewportRef = { current: null }
    const previous = {
      freezeVirtualization: false,
      scrollViewportRef: viewportRef,
      timelineIdentity: 'thread-1',
      turns,
    }

    expect(
      areTurnTimelinePropsEqual(previous, {
        ...previous,
        freezeVirtualization: true,
      }),
    ).toBe(false)

    expect(
      areTurnTimelinePropsEqual(previous, {
        ...previous,
        disableVirtualization: true,
      }),
    ).toBe(false)
  })

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
            summary: [],
            content: [],
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

  it('renders turn plan updates with step statuses as a dedicated plan card', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-plan-status',
        status: 'inProgress',
        items: [
          {
            id: 'turn-plan-turn-plan-status',
            type: 'turnPlan',
            explanation: 'Stabilize the thread plan event pipeline.',
            status: 'inProgress',
            steps: [
              {
                step: 'Project runtime events',
                status: 'completed',
              },
              {
                step: 'Render status badges',
                status: 'inProgress',
              },
              {
                step: 'Verify regressions',
                status: 'pending',
              },
            ],
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Plan')
    expect(html).toContain('Stabilize the thread plan event pipeline.')
    expect(html).toContain('Project runtime events')
    expect(html).toContain('Render status badges')
    expect(html).toContain('Verify regressions')
    expect(html).toContain('Completed')
    expect(html).toContain('In progress')
    expect(html).toContain('Pending')
  })

  it('renders web search actions as compact system cards', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-web-search',
        status: 'completed',
        items: [
          {
            type: 'webSearch',
            query: 'site:platform.openai.com/docs realtime websocket',
            action: {
              type: 'search',
              queries: [
                'site:platform.openai.com/docs realtime websocket',
                'site:platform.openai.com/docs realtime webrtc',
              ],
            },
          },
          {
            type: 'webSearch',
            query: 'https://platform.openai.com/docs/guides/realtime',
            action: {
              type: 'openPage',
              url: 'https://platform.openai.com/docs/guides/realtime',
            },
          },
          {
            type: 'webSearch',
            query: '\'Realtime API\' in https://platform.openai.com/docs/guides/realtime',
            action: {
              type: 'findInPage',
              pattern: 'Realtime API',
              url: 'https://platform.openai.com/docs/guides/realtime',
            },
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Web Search')
    expect(html).toContain('Search')
    expect(html).toContain('Open Page')
    expect(html).toContain('Find In Page')
    expect(html).toContain('site:platform.openai.com/docs realtime websocket')
    expect(html).toContain('Realtime API')
    expect(html).toContain('href="https://platform.openai.com/docs/guides/realtime"')
  })

  it('renders reasoning items when they include summary or content', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-reasoning',
        status: 'completed',
        items: [
          {
            type: 'reasoning',
            summary: ['Checked the latest snapshot.'],
            content: ['Compared websocket events with rendered entries.'],
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Reasoning')
    expect(html).toContain('Checked the latest snapshot.')
    expect(html).toContain('Compared websocket events with rendered entries.')
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

  it('renders the live cursor only for the latest streaming agent message', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-3d-old',
        status: 'inProgress',
        items: [
          {
            id: 'item-old',
            type: 'agentMessage',
            text: 'Older streaming reply',
            phase: 'streaming',
          },
        ],
      },
      {
        id: 'turn-3d-new',
        status: 'inProgress',
        items: [
          {
            id: 'item-new',
            type: 'agentMessage',
            text: 'Newest streaming reply',
            phase: 'streaming',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)
    const cursorMatches = html.match(/conversation-bubble__cursor/g) ?? []

    expect(cursorMatches).toHaveLength(1)
    expect(html.indexOf('Older streaming reply')).toBeLessThan(
      html.indexOf('Newest streaming reply'),
    )
    expect(html.lastIndexOf('conversation-bubble__cursor')).toBeGreaterThan(
      html.indexOf('Newest streaming reply'),
    )
  })

  it('does not leave the live cursor on the previous reply when the newest streaming message is still empty', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-3e-old',
        status: 'inProgress',
        items: [
          {
            id: 'item-old',
            type: 'agentMessage',
            text: 'Previous reply',
            phase: 'streaming',
          },
        ],
      },
      {
        id: 'turn-3e-new',
        status: 'inProgress',
        items: [
          {
            id: 'item-new',
            type: 'agentMessage',
            text: '',
            phase: 'streaming',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Previous reply')
    expect(html).not.toContain('conversation-bubble__cursor')
  })

  it('uses the typewriter renderer for completed-only assistant messages flagged by the client', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-3b',
        status: 'completed',
        items: [
          {
            id: 'item-1',
            type: 'agentMessage',
            text: 'Completed reply',
            clientRenderMode: 'animate-once',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('conversation-bubble--streaming')
    expect(html).toContain('Completed reply')
    expect(html).not.toContain('conversation-bubble__cursor')
  })

  it('does not render an empty assistant bubble before the first text chunk arrives', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-3c',
        status: 'inProgress',
        items: [
          {
            id: 'item-1',
            type: 'agentMessage',
            text: '',
            phase: 'streaming',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).not.toContain('conversation-row--assistant')
    expect(html).not.toContain('conversation-bubble--streaming')
  })

  it('reveals streaming agent text progressively when a large delta arrives', () => {
    expect(nextStreamingRevealLength(12, 12, 16)).toBe(12)
    expect(nextStreamingRevealLength(0, 40, 16)).toBeLessThan(40)
    expect(nextStreamingRevealLength(0, 40, 16)).toBeGreaterThan(0)
    expect(nextStreamingRevealLength(10, 240, 16)).toBeLessThan(240)
    expect(nextStreamingRevealLength(10, 240, 16)).toBeGreaterThan(10)
    expect(nextStreamingRevealLength(220, 240, 16)).toBe(222)
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
    expect(html).not.toContain('thread-code-block--terminal')
    expect(html).not.toContain('working tree clean')
    expect(html).toContain('1 line')
  })

  it('uses summarized command line-count metadata when the output preview is condensed', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-command-summary',
        status: 'completed',
        items: [
          {
            id: 'cmd-summary',
            type: 'commandExecution',
            command: 'npm test',
            aggregatedOutput: 'line 1\n…\nline 1200',
            outputLineCount: 1200,
            summaryTruncated: true,
            status: 'completed',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('1200 lines')
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
    expect(html).not.toContain('Arguments')
    expect(html).not.toContain('Result')
    expect(html).not.toContain('Output')
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

    expect(html).toContain('exec_command')
    expect(html).not.toContain('Stdout')
    expect(html).not.toContain('On branch main')
    expect(html).not.toContain('thread-code-block--terminal')
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
    expect(html).not.toContain('runtime connection was closed')
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

    expect(html).not.toContain('Retry In Composer')
  })

  it('renders hook runs in the timeline using the system card fallback', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-hook',
        status: 'completed',
        items: [
          {
            id: 'hook-run-hook-1',
            type: 'hookRun',
            eventName: 'PostToolUse',
            handlerKey: 'builtin.posttooluse.failed-validation-rescue',
            status: 'completed',
            decision: 'continueTurn',
            reason: 'validation_command_failed',
            message:
              'Event: Post-Tool Use\nHandler: Failed Validation Rescue\nStatus: Completed\nDecision: Continue Turn\nReason: Validation command failed',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('Hook Run')
    expect(html).toContain('Post-Tool Use')
    expect(html).toContain('Failed Validation Rescue')
    expect(html).toContain('Continue Turn')
    expect(html).toContain('Validation command failed')
  })

  it('renders streaming markdown as plain text until the message settles', () => {
    const turns: ThreadTurn[] = [
      {
        id: 'turn-streaming-markdown',
        status: 'inProgress',
        items: [
          {
            id: 'agent-streaming-markdown',
            type: 'agentMessage',
            text: '**alpha**\n- beta',
            phase: 'streaming',
          },
        ],
      },
    ]

    const html = renderToStaticMarkup(<TurnTimeline turns={turns} />)

    expect(html).toContain('**alpha**')
    expect(html).not.toContain('<strong>alpha</strong>')
    expect(html).not.toContain('<li>beta</li>')
  })

  it('reuses cached conversation entries across new turn arrays that share turn refs', () => {
    let itemsAccessCount = 0
    const item = {
      id: 'agent-1',
      type: 'agentMessage',
      text: 'Stable reply',
    }
    const items = {
      get length() {
        itemsAccessCount += 1
        return 1
      },
      get 0() {
        itemsAccessCount += 1
        return item
      },
    } as unknown as ThreadTurn['items']
    const sharedTurn = {
      id: 'turn-cached',
      status: 'completed',
      items,
    } as ThreadTurn

    renderToStaticMarkup(<TurnTimeline turns={[sharedTurn]} />)
    const accessesAfterFirstRender = itemsAccessCount
    renderToStaticMarkup(<TurnTimeline turns={[sharedTurn]} />)

    expect(itemsAccessCount).toBe(accessesAfterFirstRender)
  })
})
