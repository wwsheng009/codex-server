import { DetailGroup } from '../../components/ui/DetailGroup'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { LoadingState } from '../../components/ui/LoadingState'
import {
  formatLocalizedDateTime,
  formatLocalizedStatusLabel,
  humanizeDisplayValue,
} from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import {
  formatHookRunHandlerLabel,
  formatHookRunFeedbackEntries,
  formatHookRunEventName,
  formatHookRunReason,
  formatHookRunTriggerMethodLabel,
  formatHookRunToolLabel,
  formatSessionStartSource,
} from '../../lib/hook-run-display'
import type { ThreadWorkbenchRailHookRunsSectionProps } from './threadWorkbenchRailTypes'

function formatHookFacet(value?: string | null) {
  return humanizeDisplayValue(value?.replaceAll('/', ' / '), '—')
}

function statusTone(value?: string | null) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

  if (['ready', 'active', 'connected', 'completed', 'success', 'resolved', 'succeeded'].includes(normalized)) {
    return 'success'
  }

  if (['running', 'inprogress', 'processing', 'sending', 'waiting', 'starting', 'streaming'].includes(normalized)) {
    return 'info'
  }

  if (['paused', 'idle', 'closed', 'archived', 'notloaded', 'unknown', 'nottracked', 'skipped'].includes(normalized)) {
    return 'warning'
  }

  if (['error', 'failed', 'expired', 'rejected', 'denied'].includes(normalized)) {
    return 'danger'
  }

  return 'neutral'
}

function HookStatusBadge({ value }: { value?: string | null }) {
  return (
    <span className={`detail-badge detail-badge--${statusTone(value)}`}>
      {formatLocalizedStatusLabel(value, '—')}
    </span>
  )
}

function formatDuration(durationMs?: number | null) {
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return '—'
  }

  return `${Math.round(durationMs)} ms`
}

export function ThreadWorkbenchRailHookRunsSection({
  selectedThread,
  hookRuns,
  hookRunsError,
  hookRunsLoading,
}: ThreadWorkbenchRailHookRunsSectionProps) {
  return (
    <DetailGroup
      title={i18n._({
        id: 'Recent Hook Runs',
        message: 'Recent Hook Runs',
      })}
    >
      {hookRunsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: 'Loading recent hook runs…',
              message: 'Loading recent hook runs…',
            })}
          />
        </div>
      ) : hookRunsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`thread-hook-runs-${hookRunsError}`}
            title={i18n._({
              id: 'Hook runs unavailable',
              message: 'Hook runs unavailable',
            })}
            tone="error"
          >
            {hookRunsError}
          </InlineNotice>
        </div>
      ) : !selectedThread ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: 'Select a thread to inspect recent governance hook runs.',
              message: 'Select a thread to inspect recent governance hook runs.',
            })}
          </p>
        </div>
      ) : !hookRuns.length ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: 'No governance hook runs recorded for this thread yet.',
              message: 'No governance hook runs recorded for this thread yet.',
            })}
          </p>
        </div>
      ) : (
        hookRuns.map((run, index) => {
          const feedback = formatHookRunFeedbackEntries(run.entries)
          const toolLabel = formatHookRunToolLabel(run.toolName, run.toolKind)

          return (
            <div
              key={run.id}
              style={{
                borderTop: index > 0 ? '1px solid var(--border-subtle)' : 'none',
                paddingTop: index > 0 ? 12 : 0,
              }}
            >
              <div className="detail-row detail-row--emphasis">
                <span>
                  {i18n._({
                    id: 'Event',
                    message: 'Event',
                  })}
                </span>
                <strong title={run.eventName}>{formatHookRunEventName(run.eventName)}</strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Handler',
                    message: 'Handler',
                  })}
                </span>
                <strong title={run.handlerKey}>
                  {formatHookRunHandlerLabel(run.handlerKey) || '—'}
                </strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Status',
                    message: 'Status',
                  })}
                </span>
                <strong>
                  <HookStatusBadge value={run.status} />
                </strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Decision',
                    message: 'Decision',
                  })}
                </span>
                <strong>{formatHookFacet(run.decision)}</strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Trigger',
                    message: 'Trigger',
                  })}
                </span>
                <strong title={run.triggerMethod}>
                  {formatHookRunTriggerMethodLabel(run.triggerMethod) || '—'}
                </strong>
              </div>
              {run.sessionStartSource?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Session Start Source',
                      message: 'Session Start Source',
                    })}
                  </span>
                  <strong>{formatSessionStartSource(run.sessionStartSource)}</strong>
                </div>
              ) : null}
              {toolLabel ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Tool',
                      message: 'Tool',
                    })}
                  </span>
                  <strong title={run.toolName?.trim() || run.toolKind?.trim() || toolLabel}>
                    {toolLabel}
                  </strong>
                </div>
              ) : null}
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Started',
                    message: 'Started',
                  })}
                </span>
                <strong>{formatLocalizedDateTime(run.startedAt, '—')}</strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Duration',
                    message: 'Duration',
                  })}
                </span>
                <strong>{formatDuration(run.durationMs)}</strong>
              </div>
              {run.reason?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Reason',
                      message: 'Reason',
                    })}
                  </span>
                  <strong title={run.reason}>{formatHookRunReason(run.reason)}</strong>
                </div>
              ) : null}
              {feedback ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Feedback',
                      message: 'Feedback',
                    })}
                  </span>
                  <strong title={feedback}>{feedback}</strong>
                </div>
              ) : null}
              {run.error?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Error',
                      message: 'Error',
                    })}
                  </span>
                  <strong>{run.error.trim()}</strong>
                </div>
              ) : null}
            </div>
          )
        })
      )}
    </DetailGroup>
  )
}
