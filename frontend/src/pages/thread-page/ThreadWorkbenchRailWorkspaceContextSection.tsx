import { Link } from 'react-router-dom'

import { InlineNotice } from '../../components/ui/InlineNotice'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import { i18n } from '../../i18n/runtime'
import type { ThreadWorkbenchRailProps } from './threadWorkbenchRailTypes'

function DetailRow({
  label,
  value,
}: {
  label: string
  value: string | number
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export function ThreadWorkbenchRailWorkspaceContextSection({
  commandCount,
  lastTimelineEventTs,
  liveThreadCwd,
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
  threadCount,
  timelineItemCount,
  turnCount,
  workspaceName,
}: Pick<
  ThreadWorkbenchRailProps,
  | 'commandCount'
  | 'lastTimelineEventTs'
  | 'liveThreadCwd'
  | 'onHideSurfacePanel'
  | 'onOpenSurfacePanel'
  | 'pendingApprovalsCount'
  | 'rootPath'
  | 'runtimeConfigChangedAt'
  | 'runtimeConfigLoadStatus'
  | 'runtimeRestartRequired'
  | 'runtimeStartedAt'
  | 'runtimeUpdatedAt'
  | 'selectedThread'
  | 'shellEnvironmentInfo'
  | 'shellEnvironmentSummary'
  | 'shellEnvironmentWarning'
  | 'streamState'
  | 'surfacePanelView'
  | 'threadCount'
  | 'timelineItemCount'
  | 'turnCount'
  | 'workspaceName'
>) {
  const effectiveShellEnvironmentSummary = shellEnvironmentSummary ?? {
    inherit: 'inherit',
    windowsCommandResolution: 'unknown',
    missingWindowsVars: [],
  }

  return (
    <div className="pane-section">
      <div className="section-header section-header--inline">
        <div>
          <h2>
            {i18n._({
              id: 'Workspace context',
              message: 'Workspace context',
            })}
          </h2>
          <p>
            {i18n._({
              id: 'Persistent context stays in the rail. Feed and approvals open as lighter in-surface panels.',
              message:
                'Persistent context stays in the rail. Feed and approvals open as lighter in-surface panels.',
            })}
          </p>
        </div>
        <div className="header-actions workbench-pane__panel-actions">
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
          </button>
        </div>
      </div>
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
      <div className="detail-list">
        <DetailRow label={i18n._({ id: 'Workspace', message: 'Workspace' })} value={workspaceName ?? '—'} />
        <DetailRow label={i18n._({ id: 'Stream', message: 'Stream' })} value={streamState} />
        <DetailRow label={i18n._({ id: 'Threads', message: 'Threads' })} value={threadCount} />
        <DetailRow label={i18n._({ id: 'Root path', message: 'Root path' })} value={rootPath ?? '—'} />
        <DetailRow
          label={i18n._({ id: 'Selected thread', message: 'Selected thread' })}
          value={selectedThread?.name ?? '—'}
        />
        <DetailRow label={i18n._({ id: 'CWD', message: 'CWD' })} value={liveThreadCwd ?? '—'} />
        <DetailRow label={i18n._({ id: 'Turns', message: 'Turns' })} value={turnCount} />
        <DetailRow
          label={i18n._({ id: 'Timeline items', message: 'Timeline items' })}
          value={timelineItemCount}
        />
        <DetailRow
          label={i18n._({ id: 'Pending approvals', message: 'Pending approvals' })}
          value={pendingApprovalsCount}
        />
        <DetailRow
          label={i18n._({ id: 'Activity', message: 'Activity' })}
          value={
            lastTimelineEventTs
              ? formatRelativeTimeShort(lastTimelineEventTs)
              : i18n._({
                  id: 'Idle',
                  message: 'Idle',
                })
          }
        />
        <DetailRow label={i18n._({ id: 'Commands', message: 'Commands' })} value={commandCount} />
        <DetailRow
          label={i18n._({ id: 'Runtime started', message: 'Runtime started' })}
          value={
            runtimeStartedAt
              ? formatRelativeTimeShort(runtimeStartedAt)
              : i18n._({ id: 'Not started', message: 'Not started' })
          }
        />
        <DetailRow
          label={i18n._({ id: 'Runtime updated', message: 'Runtime updated' })}
          value={
            runtimeUpdatedAt
              ? formatRelativeTimeShort(runtimeUpdatedAt)
              : i18n._({ id: 'Unknown', message: 'Unknown' })
          }
        />
        <DetailRow
          label={i18n._({ id: 'Config changed', message: 'Config changed' })}
          value={
            runtimeConfigChangedAt
              ? formatRelativeTimeShort(runtimeConfigChangedAt)
              : i18n._({ id: 'Not tracked', message: 'Not tracked' })
          }
        />
        <DetailRow
          label={i18n._({ id: 'Config load', message: 'Config load' })}
          value={runtimeConfigLoadStatus}
        />
        <DetailRow
          label={i18n._({ id: 'Env inherit', message: 'Env inherit' })}
          value={effectiveShellEnvironmentSummary.inherit}
        />
        <DetailRow
          label={i18n._({ id: 'Cmd resolution', message: 'Cmd resolution' })}
          value={effectiveShellEnvironmentSummary.windowsCommandResolution}
        />
        <DetailRow
          label={i18n._({ id: 'Missing vars', message: 'Missing vars' })}
          value={effectiveShellEnvironmentSummary.missingWindowsVars.join(', ') || '—'}
        />
      </div>
      <div className="header-actions" style={{ marginTop: 12 }}>
        <Link className="ide-button ide-button--secondary" to="/settings/environment">
          {i18n._({ id: 'Open Runtime Inspection', message: 'Open Runtime Inspection' })}
        </Link>
      </div>
    </div>
  )
}
