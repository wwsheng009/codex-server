import type {
  FormEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { Link } from 'react-router-dom'

import {
  ApprovalIcon,
  ContextIcon,
  FeedIcon,
  PanelOpenIcon,
  RailIconButton,
  ResizeHandle,
  ToolsIcon,
} from '../../components/ui/RailControls'
import { formatRelativeTimeShort } from '../../components/workspace/timeline-utils'
import type { SurfacePanelView } from '../../lib/layout-config'
import type { Thread } from '../../types/api'

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

type ThreadWorkbenchRailProps = {
  command: string
  commandCount: number
  deletePending: boolean
  deletingThreadId?: string
  editingThreadId?: string
  editingThreadName: string
  isExpanded: boolean
  isMobileViewport: boolean
  isResizing: boolean
  isThreadToolsExpanded: boolean
  isWorkbenchToolsExpanded: boolean
  lastTimelineEventTs?: string
  liveThreadCwd?: string
  pendingApprovalsCount: number
  rootPath?: string
  selectedThread?: Thread
  startCommandPending: boolean
  streamState: string
  surfacePanelView: SurfacePanelView | null
  threadCount: number
  timelineItemCount: number
  turnCount: number
  workspaceName?: string
  onArchiveToggle: () => void
  onBeginRenameThread: () => void
  onCancelRenameThread: () => void
  onChangeCommand: (value: string) => void
  onChangeEditingThreadName: (value: string) => void
  onCloseWorkbenchOverlay: () => void
  onDeleteThread: () => void
  onHideSurfacePanel: () => void
  onInspectorResizeStart: (event: ReactPointerEvent<HTMLButtonElement>) => void
  onOpenInspector: () => void
  onOpenSurfacePanel: (view: SurfacePanelView) => void
  onResetInspectorWidth: () => void
  onSubmitRenameThread: (event: FormEvent<HTMLFormElement>) => void
  onStartCommand: (event: FormEvent<HTMLFormElement>) => void
  onToggleThreadToolsExpanded: () => void
  onToggleWorkbenchToolsExpanded: () => void
}

export function ThreadWorkbenchRail({
  command,
  commandCount,
  deletePending,
  deletingThreadId,
  editingThreadId,
  editingThreadName,
  isExpanded,
  isMobileViewport,
  isResizing,
  isThreadToolsExpanded,
  isWorkbenchToolsExpanded,
  lastTimelineEventTs,
  liveThreadCwd,
  pendingApprovalsCount,
  rootPath,
  selectedThread,
  startCommandPending,
  streamState,
  surfacePanelView,
  threadCount,
  timelineItemCount,
  turnCount,
  workspaceName,
  onArchiveToggle,
  onBeginRenameThread,
  onCancelRenameThread,
  onChangeCommand,
  onChangeEditingThreadName,
  onCloseWorkbenchOverlay,
  onDeleteThread,
  onHideSurfacePanel,
  onInspectorResizeStart,
  onOpenInspector,
  onOpenSurfacePanel,
  onResetInspectorWidth,
  onSubmitRenameThread,
  onStartCommand,
  onToggleThreadToolsExpanded,
  onToggleWorkbenchToolsExpanded,
}: ThreadWorkbenchRailProps) {
  if (!isExpanded) {
    if (isMobileViewport) {
      return null
    }

    return (
      <aside className="workbench-pane workbench-pane--collapsed">
        <div className="workbench-pane__collapsed">
          <RailIconButton
            aria-label="Open side rail"
            className="workbench-pane__mini-button"
            onClick={onOpenInspector}
            primary
            title="Open side rail"
          >
            <PanelOpenIcon />
          </RailIconButton>
          <RailIconButton
            aria-label="Open workspace context"
            className="workbench-pane__mini-button"
            onClick={onOpenInspector}
            title="Context"
          >
            <ContextIcon />
          </RailIconButton>
          <RailIconButton
            aria-label="Open live feed panel"
            className="workbench-pane__mini-button"
            onClick={() => onOpenSurfacePanel('feed')}
            title="Feed"
          >
            <FeedIcon />
          </RailIconButton>
          <RailIconButton
            aria-label="Open approvals panel"
            className="workbench-pane__mini-button"
            onClick={() => onOpenSurfacePanel('approvals')}
            title="Approvals"
          >
            <ApprovalIcon />
          </RailIconButton>
          <RailIconButton
            aria-label="Open workbench tools"
            className="workbench-pane__mini-button"
            onClick={onOpenInspector}
            title="Tools"
          >
            <ToolsIcon />
          </RailIconButton>
        </div>
      </aside>
    )
  }

  const isEditingSelectedThread = Boolean(selectedThread && editingThreadId === selectedThread.id)

  return (
    <aside
      className={
        isMobileViewport
          ? 'workbench-pane workbench-pane--expanded workbench-pane--mobile'
          : isResizing
            ? 'workbench-pane workbench-pane--expanded workbench-pane--resizing'
            : 'workbench-pane workbench-pane--expanded'
      }
    >
      {!isMobileViewport ? (
        <ResizeHandle
          aria-label="Resize side rail"
          axis="horizontal"
          className="workbench-pane__resize-handle"
          onPointerDown={onInspectorResizeStart}
        />
      ) : null}
      <div className="workbench-pane__topbar">
        <span className="meta-pill">{isMobileViewport ? 'workbench' : 'side rail'}</span>
        <div className="workbench-pane__topbar-actions">
          {!isMobileViewport ? (
            <button className="pane-section__toggle" onClick={onResetInspectorWidth} type="button">
              Reset Width
            </button>
          ) : null}
          <button
            className="pane-section__toggle"
            onClick={onCloseWorkbenchOverlay}
            type="button"
          >
            {isMobileViewport ? 'Close' : 'Hide Rail'}
          </button>
        </div>
      </div>

      {isMobileViewport ? (
        <div className="pane-section">
          <div className="section-header section-header--inline">
            <div>
              <h2>Quick Actions</h2>
              <p>Only open side panels when you need them.</p>
            </div>
          </div>
          <div className="workbench-mobile-actions">
            <button
              className={
                surfacePanelView === 'feed'
                  ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active'
                  : 'pane-section__toggle workbench-mobile-actions__button'
              }
              onClick={() => onOpenSurfacePanel('feed')}
              type="button"
            >
              Feed
            </button>
            <button
              className={
                surfacePanelView === 'approvals'
                  ? 'pane-section__toggle workbench-mobile-actions__button workbench-mobile-actions__button--active'
                  : 'pane-section__toggle workbench-mobile-actions__button'
              }
              onClick={() => onOpenSurfacePanel('approvals')}
              type="button"
            >
              Approvals
            </button>
          </div>
        </div>
      ) : null}

      <div className="pane-section">
        <div className="section-header section-header--inline">
          <div>
            <h2>Thread Tools</h2>
            <p>Low-frequency thread management stays folded unless you need it.</p>
          </div>
          <button className="pane-section__toggle" onClick={onToggleThreadToolsExpanded} type="button">
            {isThreadToolsExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
        {isThreadToolsExpanded && selectedThread ? (
          <>
            <div className="header-actions">
              <button
                className="ide-button ide-button--secondary"
                onClick={onBeginRenameThread}
                type="button"
              >
                Rename
              </button>
              <button
                className="ide-button ide-button--secondary"
                onClick={onArchiveToggle}
                type="button"
              >
                {selectedThread.archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                className="ide-button ide-button--danger"
                disabled={deletePending}
                onClick={onDeleteThread}
                type="button"
              >
                {deletePending && deletingThreadId === selectedThread.id ? 'Deleting…' : 'Delete'}
              </button>
            </div>
            {isEditingSelectedThread ? (
              <form className="form-stack" onSubmit={onSubmitRenameThread}>
                <label className="field">
                  <span>Rename Thread</span>
                  <input
                    onChange={(event) => onChangeEditingThreadName(event.target.value)}
                    value={editingThreadName}
                  />
                </label>
                <div className="header-actions">
                  <button className="ide-button" disabled={!editingThreadName.trim()} type="submit">
                    Save
                  </button>
                  <button
                    className="ide-button ide-button--secondary"
                    onClick={onCancelRenameThread}
                    type="button"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="pane-section">
        <div className="section-header section-header--inline">
          <div>
            <h2>Workspace Context</h2>
            <p>Persistent context stays in the rail. Feed and approvals open as lighter in-surface panels.</p>
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
              Feed
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
              Approvals
            </button>
          </div>
        </div>
        <div className="detail-list">
          <DetailRow label="Workspace" value={workspaceName ?? '—'} />
          <DetailRow label="Stream" value={streamState} />
          <DetailRow label="Threads" value={threadCount} />
          <DetailRow label="Root Path" value={rootPath ?? '—'} />
          <DetailRow label="Selected Thread" value={selectedThread?.name ?? '—'} />
          <DetailRow label="CWD" value={liveThreadCwd ?? '—'} />
          <DetailRow label="Turns" value={turnCount} />
          <DetailRow label="Timeline Items" value={timelineItemCount} />
          <DetailRow label="Pending Approvals" value={pendingApprovalsCount} />
          <DetailRow
            label="Activity"
            value={lastTimelineEventTs ? formatRelativeTimeShort(lastTimelineEventTs) : 'idle'}
          />
          <DetailRow label="Commands" value={commandCount} />
        </div>
      </div>

      <div className="pane-section pane-section--command">
        <div className="section-header section-header--inline">
          <div>
            <h2>Workbench Tools</h2>
            <p>Global shortcuts and ad-hoc commands stay collapsed by default.</p>
          </div>
          <button
            className="pane-section__toggle"
            onClick={onToggleWorkbenchToolsExpanded}
            type="button"
          >
            {isWorkbenchToolsExpanded ? 'Hide' : 'Show'}
          </button>
        </div>
        {isWorkbenchToolsExpanded ? (
          <>
            <div className="pane-link-grid">
              <Link className="ide-button ide-button--secondary" to="/automations">
                Automations
              </Link>
              <Link className="ide-button ide-button--secondary" to="/skills">
                Skills
              </Link>
              <Link className="ide-button ide-button--secondary" to="/runtime">
                Runtime
              </Link>
            </div>
            <form className="form-stack" onSubmit={onStartCommand}>
              <label className="field">
                <span>Run Command</span>
                <input
                  onChange={(event) => onChangeCommand(event.target.value)}
                  placeholder="pnpm test --filter frontend"
                  value={command}
                />
              </label>
              <button className="ide-button" disabled={!command.trim()} type="submit">
                {startCommandPending ? 'Starting…' : 'Run Command'}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </aside>
  )
}
