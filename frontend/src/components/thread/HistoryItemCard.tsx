import {
  fileChanges,
  formatDuration,
  itemTypeLabel,
  numberField,
  planSteps,
  reasoningContent,
  reasoningSummary,
  stringField,
  userMessageText,
} from './threadRender'

type HistoryItemCardProps = {
  item: Record<string, unknown>
}

export function HistoryItemCard({ item }: HistoryItemCardProps) {
  const itemType = stringField(item.type) || 'item'

  switch (itemType) {
    case 'userMessage':
      return (
        <article className="history-card history-card--user">
          <HistoryHeader title={itemTypeLabel(itemType)} subtitle={itemType} />
          <div className="history-card__body history-card__markdown">
            <p>{userMessageText(item) || '—'}</p>
          </div>
        </article>
      )
    case 'agentMessage':
      return (
        <article className="history-card history-card--agent">
          <HistoryHeader title={itemTypeLabel(itemType)} subtitle={stringField(item.phase) || itemType} />
          <div className="history-card__body history-card__markdown">
            <p>{stringField(item.text) || '—'}</p>
          </div>
        </article>
      )
    case 'plan':
      return (
        <article className="history-card history-card--plan">
          <HistoryHeader title={itemTypeLabel(itemType)} subtitle={itemType} />
          <div className="history-card__body">
            <ol className="history-list">
              {planSteps(item).map((step, index) => (
                <li key={`${item.id ?? 'plan'}-${index}`}>{step}</li>
              ))}
            </ol>
          </div>
        </article>
      )
    case 'reasoning':
      return (
        <article className="history-card history-card--reasoning">
          <HistoryHeader title={itemTypeLabel(itemType)} subtitle={itemType} />
          <div className="history-card__body">
            {reasoningSummary(item).length ? (
              <>
                <div className="history-section-label">Summary</div>
                <ul className="history-list">
                  {reasoningSummary(item).map((entry, index) => (
                    <li key={`${item.id ?? 'reasoning'}-summary-${index}`}>{entry}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {reasoningContent(item).length ? (
              <>
                <div className="history-section-label">Content</div>
                <ul className="history-list">
                  {reasoningContent(item).map((entry, index) => (
                    <li key={`${item.id ?? 'reasoning'}-content-${index}`}>{entry}</li>
                  ))}
                </ul>
              </>
            ) : (
              !reasoningSummary(item).length ? <p>Reasoning recorded without summary text.</p> : null
            )}
          </div>
        </article>
      )
    case 'commandExecution':
      return (
        <article className="history-card history-card--command">
          <HistoryHeader title={itemTypeLabel(itemType)} subtitle={stringField(item.status) || itemType} />
          <div className="history-card__body">
            <div className="history-meta-grid">
              <span>Command</span>
              <code>{stringField(item.command) || '—'}</code>
              <span>Cwd</span>
              <code>{stringField(item.cwd) || '—'}</code>
              <span>Exit Code</span>
              <span>{numberField(item.exitCode) ?? '—'}</span>
              <span>Duration</span>
              <span>{formatDuration(numberField(item.durationMs))}</span>
            </div>
            {stringField(item.aggregatedOutput) ? (
              <pre className="history-output">{stringField(item.aggregatedOutput)}</pre>
            ) : null}
          </div>
        </article>
      )
    case 'fileChange':
      return (
        <article className="history-card history-card--file">
          <HistoryHeader title={itemTypeLabel(itemType)} subtitle={stringField(item.status) || itemType} />
          <div className="history-card__body">
            <div className="history-change-list">
              {fileChanges(item).map((change, index) => (
                <article className="history-change" key={`${item.id ?? 'file'}-${index}`}>
                  <div className="history-change__meta">
                    <strong>{change.path || 'unknown file'}</strong>
                    <span>{change.kind}</span>
                  </div>
                  <pre className="history-output">{change.diff || 'No diff available.'}</pre>
                </article>
              ))}
            </div>
          </div>
        </article>
      )
    default:
      return (
        <article className="history-card">
          <HistoryHeader title={itemType} subtitle={stringField(item.status) || stringField(item.phase)} />
          <div className="history-card__body">
            <pre className="history-output">{JSON.stringify(item, null, 2)}</pre>
          </div>
        </article>
      )
  }
}

type HistoryHeaderProps = {
  title: string
  subtitle?: string
}

function HistoryHeader({ title, subtitle }: HistoryHeaderProps) {
  return (
    <div className="history-card__header">
      <strong>{title}</strong>
      {subtitle ? <span>{subtitle}</span> : null}
    </div>
  )
}
