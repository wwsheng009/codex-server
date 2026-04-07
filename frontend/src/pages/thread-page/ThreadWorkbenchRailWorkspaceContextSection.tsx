import { Link } from 'react-router-dom'

import { DetailGroup } from '../../components/ui/DetailGroup'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { Tooltip } from '../../components/ui/Tooltip'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import {
  formatLocalizedStatusLabel,
  formatShellEnvironmentInheritLabel,
  formatWindowsCommandResolutionLabel,
} from '../../i18n/display'
import { ConversationRenderProfilerRailToggle } from '../../components/workspace/threadConversationProfiler'
import { i18n } from '../../i18n/runtime'
import type { ThreadWorkbenchRailWorkspaceContextSectionProps } from './threadWorkbenchRailTypes'
import type {
  CoverageMeterProps,
  DetailProgressStyle,
  DetailRowProps,
  InfoLabelProps,
  PendingApprovalsBadgeProps,
  ProgressMeterProps,
  ProgressTone,
  StatusBadgeProps,
  SummaryStatProps,
} from './threadWorkbenchRailWorkspaceContextTypes'

function DetailRow({
  emphasis = false,
  label,
  value,
}: DetailRowProps) {
  return (
    <div className={emphasis ? 'detail-row detail-row--emphasis' : 'detail-row'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  meta,
  footer,
  tone = 'default',
}: SummaryStatProps) {
  return (
    <article
      className={
        tone === 'success'
          ? 'detail-stat detail-stat--success'
          : tone === 'warning'
            ? 'detail-stat detail-stat--warning'
            : 'detail-stat'
      }
    >
      <span className="detail-stat__label">{label}</span>
      <strong className="detail-stat__value">{value}</strong>
      {meta ? <span className="detail-stat__meta">{meta}</span> : null}
      {footer ? <span className="detail-stat__footer">{footer}</span> : null}
    </article>
  )
}

function StatusBadge({ value }: StatusBadgeProps) {
  return (
    <span className={`detail-badge detail-badge--${statusTone(value)}`}>
      {formatStatusLabel(value)}
    </span>
  )
}

function PendingApprovalsBadge({
  count,
  compact = false,
}: PendingApprovalsBadgeProps) {
  if (compact) {
    return (
      <span
        className={
          count > 0
            ? 'pane-section__toggle-badge pane-section__toggle-badge--warning'
            : 'pane-section__toggle-badge'
        }
      >
        {count}
      </span>
    )
  }

  return (
    <span className={count > 0 ? 'detail-badge detail-badge--warning' : 'detail-badge detail-badge--success'}>
      {count > 0
        ? i18n._({
            id: '{count} pending',
            message: '{count} pending',
            values: { count },
          })
        : i18n._({
            id: 'Clear',
            message: 'Clear',
          })}
    </span>
  )
}

function ProgressMeter({
  ariaLabel,
  layout = 'inline',
  metaLabel,
  percent,
  showSummary = true,
  tone = 'accent',
  width = 'default',
}: ProgressMeterProps) {
  const safePercent = percent === null ? null : Math.max(0, Math.min(100, percent))
  const valueLabel = safePercent === null ? '—' : `${safePercent}%`

  const containerClasses = [
    layout === 'block' ? 'detail-progress detail-progress--block' : 'detail-progress',
    width === 'full' ? 'detail-progress--full' : '',
  ].filter(Boolean).join(' ')

  return (
    <span className={containerClasses}>
      {showSummary ? (
        <span className="detail-progress__summary">
          <span className="detail-progress__value">{valueLabel}</span>
          {metaLabel ? <span className="detail-progress__meta">{metaLabel}</span> : null}
        </span>
      ) : null}
      <span
        aria-label={ariaLabel}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={safePercent ?? undefined}
        aria-valuetext={
          safePercent === null
            ? metaLabel ?? valueLabel
            : metaLabel
              ? `${valueLabel} (${metaLabel})`
              : valueLabel
        }
        className={
          safePercent === null
            ? 'detail-progress__track detail-progress__track--empty'
            : 'detail-progress__track'
        }
        role="progressbar"
      >
        <span
          className={`detail-progress__fill detail-progress__fill--${tone}`}
          style={{ '--detail-progress-value': `${safePercent ?? 0}%` } as DetailProgressStyle}
        />
      </span>
    </span>
  )
}

function CoverageMeter({
  ariaLabel,
  current,
  layout = 'inline',
  total,
}: CoverageMeterProps) {
  const safeCurrent = Math.max(0, total > 0 ? Math.min(current, total) : current)
  const percent = total > 0 ? Math.round((safeCurrent / total) * 100) : null
  const countsLabel = `${safeCurrent} / ${total}`

  return (
    <ProgressMeter
      ariaLabel={ariaLabel}
      layout={layout}
      metaLabel={countsLabel}
      percent={percent}
    />
  )
}

function InfoLabel({
  help,
  label,
}: InfoLabelProps) {
  if (!help) {
    return <span className="info-label">{label}</span>
  }

  return (
    <span className="info-label">
      <span>{label}</span>
      <Tooltip
        content={help}
        position="left"
        triggerLabel={i18n._({
          id: '{label} help',
          message: '{label} help',
          values: { label },
        })}
      >
        <span aria-hidden="true" className="info-label__help">
          ?
        </span>
      </Tooltip>
    </span>
  )
}

function formatStatusLabel(value?: string | null) {
  return formatLocalizedStatusLabel(value, '—')
}

function statusTone(value?: string | null) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')

  if (['ready', 'active', 'connected', 'completed', 'success', 'resolved', 'open'].includes(normalized)) {
    return 'success'
  }

  if (['running', 'inprogress', 'processing', 'sending', 'waiting', 'starting', 'streaming'].includes(normalized)) {
    return 'info'
  }

  if (['paused', 'idle', 'closed', 'archived', 'notloaded', 'unknown', 'nottracked'].includes(normalized)) {
    return 'warning'
  }

  if (['error', 'failed', 'expired', 'rejected', 'denied'].includes(normalized)) {
    return 'danger'
  }

  return 'neutral'
}

function contextUsageTone(percent: number | null): ProgressTone {
  if (percent === null) {
    return 'neutral'
  }

  if (percent >= 85) {
    return 'danger'
  }

  if (percent >= 65) {
    return 'warning'
  }

  return 'accent'
}

export function ThreadWorkbenchRailWorkspaceContextSection({
  commandCount,
  contextUsagePercent,
  contextWindow,
  isMobileViewport,
  lastTimelineEventTs,
  latestTurnStatus,
  loadedAssistantMessageCount,
  loadedMessageCount,
  loadedTurnCount,
  liveThreadCwd,
  loadedUserMessageCount,
  onHideSurfacePanel,
  onOpenSurfacePanel,
  pendingApprovalsCount,
  rootPath,
  runtimeConfigChangedAt,
  runtimeConfigLoadStatus,
  runtimeRestartRequired,
  runtimeStartedAt,
  runtimeUpdatedAt,
  selectedThread,
  shellEnvironmentInfo,
  shellEnvironmentSummary,
  shellEnvironmentWarning,
  streamState,
  surfacePanelView,
  totalTokens,
  totalMessageCount,
  totalTurnCount,
  threadCount,
  timelineItemCount,
  turnCount,
  workspaceName,
}: ThreadWorkbenchRailWorkspaceContextSectionProps) {
  const effectiveShellEnvironmentSummary = shellEnvironmentSummary ?? {
    inherit: 'inherit',
    windowsCommandResolution: 'unknown',
    missingWindowsVars: [],
  }
  const effectiveLoadedTurnCount = Math.max(loadedTurnCount, turnCount)
  const effectiveTotalTurnCount = Math.max(totalTurnCount, effectiveLoadedTurnCount)
  const effectiveTotalMessageCount = Math.max(totalMessageCount, loadedMessageCount)
  const averageMessagesPerTurn =
    effectiveTotalTurnCount > 0
      ? (effectiveTotalMessageCount / effectiveTotalTurnCount).toFixed(
          effectiveTotalMessageCount % effectiveTotalTurnCount === 0 ? 0 : 1,
        )
      : '—'
  const loadedMessageCoveragePercent =
    effectiveTotalMessageCount > 0
      ? Math.round((loadedMessageCount / effectiveTotalMessageCount) * 100)
      : null
  const loadedMessageCoverageCounts = `${loadedMessageCount} / ${effectiveTotalMessageCount}`
  const loadedCoverage = `${effectiveLoadedTurnCount} / ${effectiveTotalTurnCount}`
  const averageTimelineItemsPerTurn =
    effectiveLoadedTurnCount > 0
      ? (timelineItemCount / effectiveLoadedTurnCount).toFixed(
          timelineItemCount % effectiveLoadedTurnCount === 0 ? 0 : 1,
        )
      : '—'
  const userAssistantRatio =
    loadedAssistantMessageCount > 0
      ? `${loadedUserMessageCount}:${loadedAssistantMessageCount}`
      : loadedUserMessageCount > 0
        ? `${loadedUserMessageCount}:0`
        : '—'
  const contextUsageValue = contextUsagePercent === null ? '—' : `${contextUsagePercent}%`
  const contextUsageMeta =
    contextWindow > 0
      ? `${totalTokens} / ${contextWindow}`
      : totalTokens > 0
        ? String(totalTokens)
        : undefined
  const turnsHelp = i18n._({
    id: 'Total thread turns currently known for the selected thread. Loaded coverage shows how much of that history is present in the active viewport window.',
    message:
      'Total thread turns currently known for the selected thread. Loaded coverage shows how much of that history is present in the active viewport window.',
  })
  const messagesHelp = i18n._({
    id: 'Messages count only user and assistant messages. Tool calls, approvals, and other system items are excluded.',
    message:
      'Messages count only user and assistant messages. Tool calls, approvals, and other system items are excluded.',
  })
  const contextHelp = i18n._({
    id: 'Context shows total tokens currently tracked for the thread against the model context window when available.',
    message:
      'Context shows total tokens currently tracked for the thread against the model context window when available.',
  })
  const latestTurnHelp = i18n._({
    id: 'Latest turn is the status of the newest loaded turn in the selected thread window.',
    message:
      'Latest turn is the status of the newest loaded turn in the selected thread window.',
  })
  const loadedCoverageHelp = i18n._({
    id: 'Loaded coverage compares turns currently rendered in the page against the total turns known for the selected thread.',
    message:
      'Loaded coverage compares turns currently rendered in the page against the total turns known for the selected thread.',
  })
  const messageCoverageHelp = i18n._({
    id: 'Message coverage compares loaded user and assistant messages against the total user and assistant messages known for the selected thread.',
    message:
      'Message coverage compares loaded user and assistant messages against the total user and assistant messages known for the selected thread.',
  })
  const userAssistantHelp = i18n._({
    id: 'User/assistant ratio is based on loaded messages only, shown as user messages to assistant messages.',
    message:
      'User/assistant ratio is based on loaded messages only, shown as user messages to assistant messages.',
  })
  const timelineItemsHelp = i18n._({
    id: 'Timeline items count every loaded item in the conversation stream, including tools, approvals, and system cards.',
    message:
      'Timeline items count every loaded item in the conversation stream, including tools, approvals, and system cards.',
  })
  const itemsPerTurnHelp = i18n._({
    id: 'Items per loaded turn is the average number of loaded timeline items inside each currently loaded turn.',
    message:
      'Items per loaded turn is the average number of loaded timeline items inside each currently loaded turn.',
  })

  return (
    <div className="pane-section">
      <div className="section-header section-header--inline">
        <div>
          <h2>
            {i18n._({
              id: 'Persistent context',
              message: 'Persistent context',
            })}
          </h2>
        </div>
        <div className="header-actions workbench-pane__panel-actions">
          {selectedThread ? <ConversationRenderProfilerRailToggle /> : null}
          <button
            className={
              surfacePanelView === 'feed'
                ? 'pane-section__toggle workbench-pane__panel-toggle workbench-pane__panel-toggle--active'
                : 'pane-section__toggle workbench-pane__panel-toggle'
            }
            onClick={() =>
              surfacePanelView === 'feed' ? onHideSurfacePanel() : onOpenSurfacePanel('feed')
            }
            type="button"
          >
            {i18n._({
              id: 'Feed',
              message: 'Feed',
            })}
          </button>
          <button
            className={
              surfacePanelView === 'approvals'
                ? 'pane-section__toggle workbench-pane__panel-toggle workbench-pane__panel-toggle--active'
                : 'pane-section__toggle workbench-pane__panel-toggle'
            }
            onClick={() =>
              surfacePanelView === 'approvals'
                ? onHideSurfacePanel()
                : onOpenSurfacePanel('approvals')
            }
            type="button"
          >
            {i18n._({
              id: 'Approvals',
              message: 'Approvals',
            })}
            <PendingApprovalsBadge compact count={pendingApprovalsCount} />
          </button>
        </div>
      </div>
      <DetailGroup
        collapsible
        defaultOpen={false}
        tone={shellEnvironmentWarning ? 'danger' : 'default'}
        title={
          shellEnvironmentWarning
            ? i18n._({ id: 'Shell Environment Risk', message: 'Shell Environment Risk' })
            : i18n._({ id: 'Shell Environment', message: 'Shell Environment' })
        }
      >
        <div className="pane-section-content">
          {shellEnvironmentWarning ? (
            <InlineNotice
              noticeKey={`thread-shell-environment-warning-${effectiveShellEnvironmentSummary.inherit}`}
              title={i18n._({ id: 'Shell Environment Risk', message: 'Shell Environment Risk' })}
              tone="error"
            >
              {shellEnvironmentWarning}
            </InlineNotice>
          ) : (
            <InlineNotice
              noticeKey={`thread-shell-environment-info-${effectiveShellEnvironmentSummary.inherit}`}
              title={i18n._({ id: 'Shell Environment', message: 'Shell Environment' })}
            >
              {shellEnvironmentInfo}
            </InlineNotice>
          )}
        </div>
      </DetailGroup>

      <DetailGroup
        collapsible
        defaultOpen={false}
        tone={runtimeRestartRequired ? 'warning' : 'default'}
        title={i18n._({ id: 'Runtime Config Status', message: 'Runtime Config Status' })}
      >
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`thread-runtime-load-status-${runtimeConfigLoadStatus}`}
            title={i18n._({ id: 'Runtime Config Status', message: 'Runtime Config Status' })}
            tone={runtimeRestartRequired ? 'error' : 'info'}
          >
            {runtimeRestartRequired
              ? i18n._({
                  id: 'Restart required: the tracked runtime-affecting config changed after this runtime started.',
                  message:
                    'Restart required: the tracked runtime-affecting config changed after this runtime started.',
                })
              : i18n._({
                  id: 'Runtime is aligned with the last tracked runtime-affecting config change, or no tracked change exists.',
                  message:
                    'Runtime is aligned with the last tracked runtime-affecting config change, or no tracked change exists.',
                })}
          </InlineNotice>
        </div>
      </DetailGroup>
      <div className="detail-stat-grid">
        <SummaryStat
          label={<InfoLabel label={i18n._({ id: 'Stream', message: 'Stream' })} />}
          meta={workspaceName ? <span dir="auto">{workspaceName}</span> : undefined}
          value={<StatusBadge value={streamState} />}
        />
        <SummaryStat
          label={<InfoLabel label={i18n._({ id: 'Threads', message: 'Threads' })} />}
          meta={i18n._({ id: 'Workspace total', message: 'Workspace total' })}
          value={threadCount}
        />
        <SummaryStat
          label={
            <InfoLabel
              help={turnsHelp}
              label={i18n._({ id: 'Turns', message: 'Turns' })}
            />
          }
          footer={
            <ProgressMeter
              ariaLabel={i18n._({ id: 'Loaded coverage', message: 'Loaded coverage' })}
              metaLabel={loadedCoverage}
              percent={
                effectiveTotalTurnCount > 0
                  ? Math.round((effectiveLoadedTurnCount / effectiveTotalTurnCount) * 100)
                  : null
              }
              showSummary={false}
              width="full"
            />
          }
          meta={loadedCoverage}
          value={effectiveTotalTurnCount}
        />
        <SummaryStat
          label={
            <InfoLabel
              help={messagesHelp}
              label={i18n._({ id: 'Messages', message: 'Messages' })}
            />
          }
          footer={
            <ProgressMeter
              ariaLabel={i18n._({ id: 'Msg coverage', message: 'Msg coverage' })}
              metaLabel={loadedMessageCoverageCounts}
              percent={loadedMessageCoveragePercent}
              showSummary={false}
              width="full"
            />
          }
          meta={loadedMessageCoverageCounts}
          value={effectiveTotalMessageCount}
        />
        <SummaryStat
          label={
            <InfoLabel
              help={contextHelp}
              label={i18n._({ id: 'Context', message: 'Context' })}
            />
          }
          footer={
            <ProgressMeter
              ariaLabel={i18n._({ id: 'Context', message: 'Context' })}
              metaLabel={contextUsageMeta}
              percent={contextUsagePercent}
              showSummary={false}
              tone={contextUsageTone(contextUsagePercent)}
              width="full"
            />
          }
          meta={contextUsageMeta}
          value={contextUsageValue}
        />
        <SummaryStat
          label={<InfoLabel label={i18n._({ id: 'Approvals', message: 'Approvals' })} />}
          meta={
            pendingApprovalsCount > 0
              ? i18n._({ id: 'Needs review', message: 'Needs review' })
              : i18n._({ id: 'Clear', message: 'Clear' })
          }
          tone={pendingApprovalsCount > 0 ? 'warning' : 'success'}
          value={<PendingApprovalsBadge count={pendingApprovalsCount} />}
        />
        <SummaryStat
          label={<InfoLabel label={i18n._({ id: 'Commands', message: 'Commands' })} />}
          meta={i18n._({ id: 'Tracked', message: 'Tracked' })}
          value={commandCount}
        />
      </div>
      <DetailGroup
        collapsible={isMobileViewport}
        defaultOpen
        tone="default"
        title={i18n._({ id: 'Workspace Stats', message: 'Workspace Stats' })}
      >
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Workspace', message: 'Workspace' })} />}
          value={workspaceName ? <span dir="auto">{workspaceName}</span> : '—'}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Stream', message: 'Stream' })} />}
          value={<StatusBadge value={streamState} />}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Threads', message: 'Threads' })} />}
          value={threadCount}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Pending approvals', message: 'Pending approvals' })} />}
          value={<PendingApprovalsBadge count={pendingApprovalsCount} />}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Commands', message: 'Commands' })} />}
          value={commandCount}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Activity', message: 'Activity' })} />}
          value={
            lastTimelineEventTs
              ? formatRelativeTimeShort(lastTimelineEventTs)
              : i18n._({
                  id: 'Idle',
                  message: 'Idle',
                })
          }
        />
      </DetailGroup>
      <DetailGroup
        collapsible={isMobileViewport}
        defaultOpen
        tone="primary"
        title={i18n._({ id: 'Current Thread', message: 'Current Thread' })}
      >
        <DetailRow
          emphasis
          label={<InfoLabel label={i18n._({ id: 'Thread', message: 'Thread' })} />}
          value={selectedThread?.name ? <span dir="auto">{selectedThread.name}</span> : '—'}
        />
        <DetailRow
          emphasis
          label={<InfoLabel label={i18n._({ id: 'Status', message: 'Status' })} />}
          value={<StatusBadge value={selectedThread?.status} />}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Thread ID', message: 'Thread ID' })} />}
          value={
            selectedThread?.id ? (
              <code title={selectedThread.id}>{selectedThread.id}</code>
            ) : (
              '—'
            )
          }
        />
        <DetailRow
          emphasis
          label={
            <InfoLabel
              help={latestTurnHelp}
              label={i18n._({ id: 'Latest turn', message: 'Latest turn' })}
            />
          }
          value={<StatusBadge value={latestTurnStatus} />}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'CWD', message: 'CWD' })} />}
          value={liveThreadCwd ?? '—'}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Loaded turns', message: 'Loaded turns' })} />}
          value={effectiveLoadedTurnCount}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Total turns', message: 'Total turns' })} />}
          value={effectiveTotalTurnCount}
        />
        <DetailRow
          label={
            <InfoLabel
              help={loadedCoverageHelp}
              label={i18n._({ id: 'Loaded coverage', message: 'Loaded coverage' })}
            />
          }
          value={
            <CoverageMeter
              ariaLabel={i18n._({ id: 'Loaded coverage', message: 'Loaded coverage' })}
              current={effectiveLoadedTurnCount}
              layout="block"
              total={effectiveTotalTurnCount}
            />
          }
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Loaded messages', message: 'Loaded messages' })} />}
          value={loadedMessageCount}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Total messages', message: 'Total messages' })} />}
          value={effectiveTotalMessageCount}
        />
        <DetailRow
          label={
            <InfoLabel
              help={messageCoverageHelp}
              label={i18n._({ id: 'Msg coverage', message: 'Msg coverage' })}
            />
          }
          value={
            <CoverageMeter
              ariaLabel={i18n._({ id: 'Msg coverage', message: 'Msg coverage' })}
              current={loadedMessageCount}
              layout="block"
              total={effectiveTotalMessageCount}
            />
          }
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Avg msgs/turn', message: 'Avg msgs/turn' })} />}
          value={averageMessagesPerTurn}
        />
        <DetailRow
          label={
            <InfoLabel
              help={userAssistantHelp}
              label={i18n._({ id: 'User/assistant', message: 'User/assistant' })}
            />
          }
          value={userAssistantRatio}
        />
        <DetailRow
          label={
            <InfoLabel
              help={timelineItemsHelp}
              label={i18n._({ id: 'Timeline items', message: 'Timeline items' })}
            />
          }
          value={timelineItemCount}
        />
        <DetailRow
          label={
            <InfoLabel
              help={itemsPerTurnHelp}
              label={i18n._({ id: 'Items/loaded turn', message: 'Items/loaded turn' })}
            />
          }
          value={averageTimelineItemsPerTurn}
        />
      </DetailGroup>
      <DetailGroup
        collapsible={isMobileViewport}
        defaultOpen={false}
        tone="secondary"
        title={i18n._({ id: 'Runtime Stats', message: 'Runtime Stats' })}
      >
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Root path', message: 'Root path' })} />}
          value={rootPath ?? '—'}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Runtime started', message: 'Runtime started' })} />}
          value={
            runtimeStartedAt
              ? formatRelativeTimeShort(runtimeStartedAt)
              : i18n._({ id: 'Not started', message: 'Not started' })
          }
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Runtime updated', message: 'Runtime updated' })} />}
          value={
            runtimeUpdatedAt
              ? formatRelativeTimeShort(runtimeUpdatedAt)
              : i18n._({ id: 'Unknown', message: 'Unknown' })
          }
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Config changed', message: 'Config changed' })} />}
          value={
            runtimeConfigChangedAt
              ? formatRelativeTimeShort(runtimeConfigChangedAt)
              : i18n._({ id: 'Not tracked', message: 'Not tracked' })
          }
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Config load', message: 'Config load' })} />}
          value={<StatusBadge value={runtimeConfigLoadStatus} />}
        />
      </DetailGroup>
      <DetailGroup
        collapsible={isMobileViewport}
        defaultOpen={false}
        tone="secondary"
        title={i18n._({ id: 'Shell Stats', message: 'Shell Stats' })}
      >
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Env inherit', message: 'Env inherit' })} />}
          value={formatShellEnvironmentInheritLabel(
            effectiveShellEnvironmentSummary.inherit,
            '—',
          )}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Cmd resolution', message: 'Cmd resolution' })} />}
          value={formatWindowsCommandResolutionLabel(
            effectiveShellEnvironmentSummary.windowsCommandResolution,
            '—',
          )}
        />
        <DetailRow
          label={<InfoLabel label={i18n._({ id: 'Missing vars', message: 'Missing vars' })} />}
          value={effectiveShellEnvironmentSummary.missingWindowsVars.join(', ') || '—'}
        />
      </DetailGroup>
      <div className="header-actions" style={{ marginTop: 12 }}>
        <Link className="ide-button ide-button--secondary" to="/settings/environment">
          {i18n._({ id: 'Open Runtime Inspection', message: 'Open Runtime Inspection' })}
        </Link>
      </div>
    </div>
  )
}
