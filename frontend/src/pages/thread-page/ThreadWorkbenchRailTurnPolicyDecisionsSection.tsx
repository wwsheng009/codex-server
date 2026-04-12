import { Link } from 'react-router-dom'

import { DetailGroup } from '../../components/ui/DetailGroup'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { LoadingState } from '../../components/ui/LoadingState'
import { formatLocalizedDateTime, formatLocalizedStatusLabel } from '../../i18n/display'
import { i18n } from '../../i18n/runtime'
import {
  formatTurnPolicyDecisionAction,
  formatTurnPolicyGovernanceLayer,
  formatTurnPolicyDecisionPolicyName,
  formatTurnPolicyDecisionReason,
  formatTurnPolicyDecisionSource,
  formatTurnPolicyDecisionTriggerMethod,
} from '../../lib/turn-policy-display'
import { buildWorkspaceHookRunsRoute, buildWorkspaceTurnPolicyRoute } from '../../lib/thread-routes'
import type { TurnPolicyDecision } from '../../types/api'
import type { ThreadWorkbenchRailTurnPolicyDecisionsSectionProps } from './threadWorkbenchRailTypes'

function formatDecisionCreatedAt(decision: TurnPolicyDecision) {
  return decision.completedAt || decision.decisionAt || decision.evaluationStartedAt || ''
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

function DecisionStatusBadge({ value }: { value?: string | null }) {
  return (
    <span className={`detail-badge detail-badge--${statusTone(value)}`}>
      {formatLocalizedStatusLabel(value, '—')}
    </span>
  )
}

export function ThreadWorkbenchRailTurnPolicyDecisionsSection({
  selectedThread,
  turnPolicyDecisions,
  turnPolicyDecisionsError,
  turnPolicyDecisionsLoading,
}: ThreadWorkbenchRailTurnPolicyDecisionsSectionProps) {
  const workspaceTurnPolicyRoute = selectedThread
    ? buildWorkspaceTurnPolicyRoute(selectedThread.workspaceId, {
        turnPolicyThreadId: selectedThread.id,
      })
    : ''

  return (
    <DetailGroup
      title={i18n._({
        id: 'Recent Policy Decisions',
        message: 'Recent Policy Decisions',
      })}
    >
      {turnPolicyDecisionsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: 'Loading recent policy decisions…',
              message: 'Loading recent policy decisions…',
            })}
          />
        </div>
      ) : turnPolicyDecisionsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`thread-policy-decisions-${turnPolicyDecisionsError}`}
            title={i18n._({
              id: 'Policy decisions unavailable',
              message: 'Policy decisions unavailable',
            })}
            tone="error"
          >
            {turnPolicyDecisionsError}
          </InlineNotice>
        </div>
      ) : !selectedThread ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: 'Select a thread to inspect recent automatic policy decisions.',
              message: 'Select a thread to inspect recent automatic policy decisions.',
            })}
          </p>
        </div>
      ) : !turnPolicyDecisions.length ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: 'No automatic policy decisions recorded for this thread yet.',
              message: 'No automatic policy decisions recorded for this thread yet.',
            })}
          </p>
          <div style={{ paddingTop: 12 }}>
            <Link className="ide-button ide-button--secondary ide-button--sm" to={workspaceTurnPolicyRoute}>
              {i18n._({
                id: 'Open workspace turn policy',
                message: 'Open workspace turn policy',
              })}
            </Link>
          </div>
        </div>
      ) : (
        <>
          {turnPolicyDecisions.map((decision, index) => (
            <div
              key={decision.id}
              style={{
                borderTop: index > 0 ? '1px solid var(--border-subtle)' : 'none',
                paddingTop: index > 0 ? 12 : 0,
              }}
            >
              <div className="detail-row detail-row--emphasis">
                <span>
                  {i18n._({
                    id: 'Policy',
                    message: 'Policy',
                  })}
                </span>
                <strong title={decision.policyName}>
                  {formatTurnPolicyDecisionPolicyName(decision.policyName)}
                </strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Action',
                    message: 'Action',
                  })}
                </span>
                <strong title={decision.action}>{formatTurnPolicyDecisionAction(decision.action)}</strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Status',
                    message: 'Status',
                  })}
                </span>
                <strong>
                  <DecisionStatusBadge value={decision.actionStatus} />
                </strong>
              </div>
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Source',
                    message: 'Source',
                  })}
                </span>
                <strong title={decision.source}>{formatTurnPolicyDecisionSource(decision.source)}</strong>
              </div>
              {decision.governanceLayer?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Origin',
                      message: 'Origin',
                    })}
                  </span>
                  <strong>{formatTurnPolicyGovernanceLayer(decision.governanceLayer)}</strong>
                </div>
              ) : null}
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Trigger',
                    message: 'Trigger',
                  })}
                </span>
                <strong title={decision.triggerMethod}>
                  {formatTurnPolicyDecisionTriggerMethod(decision.triggerMethod)}
                </strong>
              </div>
              {decision.actionTurnId?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Action Turn',
                      message: 'Action Turn',
                    })}
                  </span>
                  <strong>{decision.actionTurnId.trim()}</strong>
                </div>
              ) : null}
              {decision.hookRunId?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Hook Run',
                      message: 'Hook Run',
                    })}
                  </span>
                  <strong title={decision.hookRunId.trim()}>{decision.hookRunId.trim()}</strong>
                </div>
              ) : null}
              <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Created',
                    message: 'Created',
                  })}
                </span>
                <strong>{formatLocalizedDateTime(formatDecisionCreatedAt(decision), '—')}</strong>
              </div>
              {decision.reason?.trim() ? (
                <div className="detail-row">
                <span>
                  {i18n._({
                    id: 'Reason',
                    message: 'Reason',
                  })}
                </span>
                  <strong title={decision.reason.trim()}>
                    {formatTurnPolicyDecisionReason(decision.reason)}
                  </strong>
                </div>
              ) : null}
              {decision.evidenceSummary?.trim() ? (
                <div className="detail-row">
                  <span>
                    {i18n._({
                      id: 'Evidence',
                      message: 'Evidence',
                    })}
                  </span>
                  <strong>{decision.evidenceSummary.trim()}</strong>
                </div>
              ) : null}
              {decision.hookRunId?.trim() ? (
                <div style={{ paddingTop: 8 }}>
                  <Link
                    className="ide-button ide-button--secondary ide-button--sm"
                    to={buildWorkspaceHookRunsRoute(selectedThread.workspaceId, {
                      hookRunId: decision.hookRunId.trim(),
                      hookRunsThreadId: decision.threadId?.trim() || selectedThread.id,
                    })}
                  >
                    {i18n._({
                      id: 'View linked hook run',
                      message: 'View linked hook run',
                    })}
                  </Link>
                </div>
              ) : null}
            </div>
          ))}

          <div className="pane-section-content" style={{ padding: '12px 0 0' }}>
            <Link className="ide-button ide-button--secondary ide-button--sm" to={workspaceTurnPolicyRoute}>
              {i18n._({
                id: 'Open workspace turn policy',
                message: 'Open workspace turn policy',
              })}
            </Link>
          </div>
        </>
      )}
    </DetailGroup>
  )
}
