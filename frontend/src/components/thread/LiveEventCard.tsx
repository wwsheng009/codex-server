import { HistoryItemCard } from './HistoryItemCard'
import type { LiveTimelineEntry } from './liveTimeline'
import {
  decodeBase64,
  itemPreview,
  itemTypeLabel,
  numberField,
  stringField,
} from './threadRender'

type LiveEventCardProps = {
  entry: LiveTimelineEntry
}

export function LiveEventCard({ entry }: LiveEventCardProps) {
  if (entry.kind === 'delta') {
    return (
      <article className="live-card live-card--delta">
        <LiveHeader title={entry.title} ts={entry.endedTs} subtitle={entry.subtitle} />
        <div className="live-card__meta">
          <span>{entry.count} chunk(s)</span>
          {entry.startedTs !== entry.endedTs ? (
            <span>
              {new Date(entry.startedTs).toLocaleTimeString()} -{' '}
              {new Date(entry.endedTs).toLocaleTimeString()}
            </span>
          ) : null}
        </div>
        <pre className="history-output">{entry.text || '—'}</pre>
      </article>
    )
  }

  const { event } = entry
  const payload = asObject(event.payload)

  if ((event.method === 'item/started' || event.method === 'item/completed') && asObject(payload.item)) {
    const item = asObject(payload.item)
    return (
      <article className="live-card live-card--item">
        <LiveHeader
          title={
            event.method === 'item/started'
              ? `${itemTypeLabel(stringField(item.type))} Started`
              : `${itemTypeLabel(stringField(item.type))} Completed`
          }
          ts={event.ts}
        />
        <HistoryItemCard item={item} />
      </article>
    )
  }

  if (event.method === 'item/agentMessage/delta') {
    return renderDeltaCard('Agent Message Delta', stringField(payload.delta), event.ts)
  }

  if (event.method === 'item/reasoning/summaryTextDelta' || event.method === 'item/reasoning/textDelta') {
    return renderDeltaCard('Reasoning Delta', stringField(payload.delta), event.ts)
  }

  if (event.method === 'command/exec/outputDelta') {
    return renderDeltaCard(
      `Command ${stringField(payload.stream) || 'output'} Delta`,
      decodeBase64(stringField(payload.deltaBase64)),
      event.ts,
    )
  }

  if (event.method === 'workspace/connected') {
    return (
      <article className="live-card live-card--status">
        <LiveHeader title="Workspace Connected" ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Workspace</span>
            <code>{event.workspaceId}</code>
            <span>Status</span>
            <span>{stringField(payload.status) || 'connected'}</span>
          </div>
        </div>
      </article>
    )
  }

  if (event.method === 'command/exec/started') {
    return (
      <article className="live-card live-card--command">
        <LiveHeader title="Command Started" ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Process</span>
            <code>{stringField(payload.id) || '—'}</code>
            <span>Command</span>
            <code>{stringField(payload.command) || '—'}</code>
            <span>Status</span>
            <span>{stringField(payload.status) || 'running'}</span>
          </div>
        </div>
      </article>
    )
  }

  if (event.method === 'command/exec/completed') {
    return (
      <article className="live-card live-card--command">
        <LiveHeader title="Command Completed" ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Process</span>
            <code>{stringField(payload.processId) || '—'}</code>
            <span>Status</span>
            <span>{stringField(payload.status) || 'completed'}</span>
            <span>Exit Code</span>
            <span>{numberField(payload.exitCode) ?? '—'}</span>
          </div>
          {stringField(payload.error) ? (
            <pre className="history-output">{stringField(payload.error)}</pre>
          ) : null}
        </div>
      </article>
    )
  }

  if (event.method === 'thread/status/changed') {
    const status = asObject(payload.status)
    return (
      <article className="live-card live-card--status">
        <LiveHeader title="Thread Status Changed" ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Thread</span>
            <code>{stringField(payload.threadId) || event.threadId || '—'}</code>
            <span>Status</span>
            <span>{stringField(status.type) || '—'}</span>
            <span>Flags</span>
            <span>{Array.isArray(status.activeFlags) ? status.activeFlags.join(', ') || 'none' : 'none'}</span>
          </div>
        </div>
      </article>
    )
  }

  if (event.method === 'turn/started' || event.method === 'turn/completed') {
    const turn = asObject(payload.turn)
    return (
      <article className="live-card live-card--status">
        <LiveHeader title={event.method === 'turn/started' ? 'Turn Started' : 'Turn Completed'} ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Turn</span>
            <code>{stringField(turn.id) || event.turnId || '—'}</code>
            <span>Status</span>
            <span>{stringField(turn.status) || '—'}</span>
          </div>
        </div>
      </article>
    )
  }

  if (event.method === 'thread/tokenUsage/updated') {
    const tokenUsage = asObject(payload.tokenUsage)
    const total = asObject(tokenUsage.total)
    return (
      <article className="live-card live-card--status">
        <LiveHeader title="Token Usage Updated" ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Total Tokens</span>
            <span>{numberField(total.totalTokens) ?? '—'}</span>
            <span>Input</span>
            <span>{numberField(total.inputTokens) ?? '—'}</span>
            <span>Output</span>
            <span>{numberField(total.outputTokens) ?? '—'}</span>
            <span>Reasoning</span>
            <span>{numberField(total.reasoningOutputTokens) ?? '—'}</span>
          </div>
        </div>
      </article>
    )
  }

  if (isApprovalEvent(event.method)) {
    return (
      <article className="live-card live-card--approval">
        <LiveHeader title={approvalTitle(event.method)} ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Thread</span>
            <code>{event.threadId ?? '—'}</code>
            <span>Turn</span>
            <code>{event.turnId ?? '—'}</code>
            <span>Request</span>
            <code>{event.serverRequestId ?? '—'}</code>
          </div>
          <pre className="history-output">{approvalPreview(payload)}</pre>
        </div>
      </article>
    )
  }

  if (event.method === 'server/request/resolved') {
    return (
      <article className="live-card live-card--approval">
        <LiveHeader title="Server Request Resolved" ts={event.ts} />
        <div className="live-card__body">
          <div className="history-meta-grid">
            <span>Request</span>
            <code>{event.serverRequestId ?? '—'}</code>
            <span>Method</span>
            <code>{stringField(payload.method) || '—'}</code>
          </div>
        </div>
      </article>
    )
  }

  if (event.method === 'account/rateLimits/updated') {
    return (
      <article className="live-card live-card--status">
        <LiveHeader title="Rate Limits Updated" ts={event.ts} />
        <div className="live-card__body">
          <pre className="history-output">{JSON.stringify(event.payload, null, 2)}</pre>
        </div>
      </article>
    )
  }

  if (event.method.startsWith('item/')) {
    const item = asObject(payload.item)
    return (
      <article className="live-card">
        <LiveHeader title={event.method} ts={event.ts} />
        <div className="live-card__body">
          <pre className="history-output">
            {Object.keys(item).length ? itemPreview(item) : JSON.stringify(event.payload, null, 2)}
          </pre>
        </div>
      </article>
    )
  }

  return (
    <article className="live-card">
      <LiveHeader title={event.method} ts={event.ts} />
      <div className="live-card__body">
        <pre className="history-output">{JSON.stringify(event.payload, null, 2)}</pre>
      </div>
    </article>
  )
}

type LiveHeaderProps = {
  title: string
  ts: string
  subtitle?: string
}

function LiveHeader({ title, ts, subtitle }: LiveHeaderProps) {
  return (
    <div className="live-card__header">
      <div className="live-card__title">
        <strong>{title}</strong>
        {subtitle ? <small>{subtitle}</small> : null}
      </div>
      <span>{new Date(ts).toLocaleTimeString()}</span>
    </div>
  )
}

function renderDeltaCard(title: string, text: string, ts: string) {
  return (
    <article className="live-card live-card--delta">
      <LiveHeader title={title} ts={ts} />
      <pre className="history-output">{text || '—'}</pre>
    </article>
  )
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function isApprovalEvent(method: string) {
  return [
    'item/tool/requestUserInput',
    'mcpServer/elicitation/request',
    'item/permissions/requestApproval',
    'item/fileChange/requestApproval',
    'item/commandExecution/requestApproval',
    'applyPatchApproval',
    'execCommandApproval',
  ].includes(method)
}

function approvalTitle(method: string) {
  switch (method) {
    case 'item/tool/requestUserInput':
      return 'User Input Requested'
    case 'mcpServer/elicitation/request':
      return 'MCP Elicitation Requested'
    case 'item/permissions/requestApproval':
      return 'Permissions Approval Requested'
    case 'item/fileChange/requestApproval':
    case 'applyPatchApproval':
      return 'File Change Approval Requested'
    case 'item/commandExecution/requestApproval':
    case 'execCommandApproval':
      return 'Command Approval Requested'
    default:
      return method
  }
}

function approvalPreview(payload: Record<string, unknown>) {
  if (typeof payload.message === 'string') {
    return payload.message
  }
  if (typeof payload.reason === 'string') {
    return payload.reason
  }
  if (typeof payload.command === 'string') {
    return payload.command
  }
  if (Array.isArray(payload.questions)) {
    return `${payload.questions.length} question(s)`
  }
  if (Array.isArray(payload.changes)) {
    return `${payload.changes.length} file change(s)`
  }

  return JSON.stringify(payload, null, 2)
}
