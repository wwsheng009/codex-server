import { ResizeHandle } from '../../components/ui/RailControls'
import { i18n } from '../../i18n/runtime'
import { ThreadWorkbenchRailCollapsed } from './ThreadWorkbenchRailCollapsed'
import { ThreadWorkbenchRailMobileQuickActions } from './ThreadWorkbenchRailMobileQuickActions'
import { ThreadWorkbenchRailThreadToolsSection } from './ThreadWorkbenchRailThreadToolsSection'
import { ThreadWorkbenchRailWorkbenchToolsSection } from './ThreadWorkbenchRailWorkbenchToolsSection'
import { ThreadWorkbenchRailWorkspaceContextSection } from './ThreadWorkbenchRailWorkspaceContextSection'
import type { ThreadWorkbenchRailProps } from './threadWorkbenchRailTypes'

export function ThreadWorkbenchRail({
  command,
  commandRunMode,
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
  shellEnvironmentInfo,
  shellEnvironmentSummary,
  shellEnvironmentWarning,
  startCommandModeDisabled,
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
  onChangeCommandRunMode,
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
      <ThreadWorkbenchRailCollapsed
        onOpenInspector={onOpenInspector}
        onOpenSurfacePanel={onOpenSurfacePanel}
      />
    )
  }

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
          aria-label={i18n._({
            id: 'Resize side rail',
            message: 'Resize side rail',
          })}
          axis="horizontal"
          className="workbench-pane__resize-handle"
          onPointerDown={onInspectorResizeStart}
        />
      ) : null}
      <div className="workbench-pane__topbar">
        <span className="meta-pill">
          {isMobileViewport
            ? i18n._({
                id: 'Workbench',
                message: 'Workbench',
              })
            : i18n._({
                id: 'Side rail',
                message: 'Side rail',
              })}
        </span>
        <div className="workbench-pane__topbar-actions">
          {!isMobileViewport ? (
            <button className="pane-section__toggle" onClick={onResetInspectorWidth} type="button">
              {i18n._({
                id: 'Reset width',
                message: 'Reset width',
              })}
            </button>
          ) : null}
          <button
            className="pane-section__toggle"
            onClick={onCloseWorkbenchOverlay}
            type="button"
          >
            {isMobileViewport
              ? i18n._({
                  id: 'Close',
                  message: 'Close',
                })
              : i18n._({
                  id: 'Hide rail',
                  message: 'Hide rail',
                })}
          </button>
        </div>
      </div>

      {isMobileViewport ? (
        <ThreadWorkbenchRailMobileQuickActions
          onOpenSurfacePanel={onOpenSurfacePanel}
          surfacePanelView={surfacePanelView}
        />
      ) : null}

      <ThreadWorkbenchRailThreadToolsSection
        deletePending={deletePending}
        deletingThreadId={deletingThreadId}
        editingThreadId={editingThreadId}
        editingThreadName={editingThreadName}
        isThreadToolsExpanded={isThreadToolsExpanded}
        onArchiveToggle={onArchiveToggle}
        onBeginRenameThread={onBeginRenameThread}
        onCancelRenameThread={onCancelRenameThread}
        onChangeEditingThreadName={onChangeEditingThreadName}
        onDeleteThread={onDeleteThread}
        onSubmitRenameThread={onSubmitRenameThread}
        onToggleThreadToolsExpanded={onToggleThreadToolsExpanded}
        selectedThread={selectedThread}
      />

      <ThreadWorkbenchRailWorkspaceContextSection
        commandCount={commandCount}
        lastTimelineEventTs={lastTimelineEventTs}
        liveThreadCwd={liveThreadCwd}
        onHideSurfacePanel={onHideSurfacePanel}
        onOpenSurfacePanel={onOpenSurfacePanel}
        pendingApprovalsCount={pendingApprovalsCount}
        rootPath={rootPath}
        selectedThread={selectedThread}
        shellEnvironmentInfo={shellEnvironmentInfo}
        shellEnvironmentSummary={shellEnvironmentSummary}
        shellEnvironmentWarning={shellEnvironmentWarning}
        streamState={streamState}
        surfacePanelView={surfacePanelView}
        threadCount={threadCount}
        timelineItemCount={timelineItemCount}
        turnCount={turnCount}
        workspaceName={workspaceName}
      />

      <ThreadWorkbenchRailWorkbenchToolsSection
        command={command}
        commandRunMode={commandRunMode}
        isWorkbenchToolsExpanded={isWorkbenchToolsExpanded}
        onChangeCommand={onChangeCommand}
        onChangeCommandRunMode={onChangeCommandRunMode}
        onStartCommand={onStartCommand}
        onToggleWorkbenchToolsExpanded={onToggleWorkbenchToolsExpanded}
        selectedThread={selectedThread}
        startCommandModeDisabled={startCommandModeDisabled}
        startCommandPending={startCommandPending}
      />
    </aside>
  )
}
