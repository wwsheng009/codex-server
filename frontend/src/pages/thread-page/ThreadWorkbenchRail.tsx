import {
  ApprovalIcon,
  ContextIcon,
  FolderOpenIcon,
  ResizeHandle,
  ToolsIcon,
} from "../../components/ui/RailControls";
import { Tabs } from "../../components/ui/Tabs";
import {
  buildWorkspaceTurnPolicyCompareRoute,
  buildWorkspaceTurnPolicyHistoryRoute,
  buildWorkspaceTurnPolicyRoute,
  buildWorkspaceTurnPolicySourceOverviewRoute,
} from "../../lib/thread-routes";
import { i18n } from "../../i18n/runtime";
import { ThreadWorkbenchRailCollapsed } from "./ThreadWorkbenchRailCollapsed";
import { ThreadWorkbenchRailHookConfigurationSection } from "./ThreadWorkbenchRailHookConfigurationSection";
import { ThreadWorkbenchRailHookRunsSection } from "./ThreadWorkbenchRailHookRunsSection";
import { ThreadWorkbenchRailMobileQuickActions } from "./ThreadWorkbenchRailMobileQuickActions";
import { ThreadWorkbenchRailTurnPolicyDecisionsSection } from "./ThreadWorkbenchRailTurnPolicyDecisionsSection";
import { ThreadWorkbenchRailTurnPolicyMetricsSection } from "./ThreadWorkbenchRailTurnPolicyMetricsSection";
import { ThreadWorkbenchRailThreadToolsSection } from "./ThreadWorkbenchRailThreadToolsSection";
import { ThreadWorkbenchRailWorkbenchToolsSection } from "./ThreadWorkbenchRailWorkbenchToolsSection";
import { ThreadWorkbenchRailWorkspaceContextSection } from "./ThreadWorkbenchRailWorkspaceContextSection";
import {
  THREAD_WORKBENCH_RAIL_PANEL_IDS,
  THREAD_WORKBENCH_RAIL_PANEL_STORAGE_KEY,
} from "./threadWorkbenchRailPanelState";
import type { ThreadWorkbenchRailProps } from "./threadWorkbenchRailTypes";

export function ThreadWorkbenchRail({
  botSendBinding,
  botSendBindingPending,
  botSendBots,
  botSendDeliveryTargets,
  botSendErrorMessage,
  botSendLoading,
  botSendPending,
  botSendSelectedBotId,
  botSendSelectedDeliveryTargetId,
  botSendText,
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
  latestTurnStatus,
  lastTimelineEventTs,
  loadedAssistantMessageCount,
  contextUsagePercent,
  contextWindow,
  loadedMessageCount,
  loadedTurnCount,
  liveThreadCwd,
  loadedUserMessageCount,
  pendingApprovalsCount,
  rootPath,
  runtimeConfigChangedAt,
  runtimeConfigLoadStatus,
  hookConfiguration,
  hookConfigurationError,
  hookConfigurationLoading,
  runtimeRestartRequired,
  runtimeStartedAt,
  runtimeUpdatedAt,
  selectedThread,
  shellEnvironmentInfo,
  shellEnvironmentSummary,
  shellEnvironmentWarning,
  startCommandModeDisabled,
  startCommandPending,
  streamState,
  surfacePanelView,
  hookRuns,
  hookRunsError,
  hookRunsLoading,
  turnPolicyDecisions,
  turnPolicyDecisionsError,
  turnPolicyDecisionsLoading,
  turnPolicyMetrics,
  turnPolicyMetricsError,
  turnPolicyMetricsLoading,
  totalTokens,
  totalMessageCount,
  totalTurnCount,
  threadCount,
  timelineItemCount,
  turnCount,
  workspaceName,
  onArchiveToggle,
  onBeginRenameThread,
  onBindThreadBotChannel,
  onCancelRenameThread,
  onChangeBotSendSelectedBotId,
  onChangeBotSendSelectedDeliveryTargetId,
  onChangeBotSendText,
  onChangeCommand,
  onChangeCommandRunMode,
  onChangeEditingThreadName,
  onCloseWorkbenchOverlay,
  onDeleteThread,
  onDeleteThreadBotBinding,
  onHideSurfacePanel,
  onInspectorResizeStart,
  onOpenInspector,
  onOpenSurfacePanel,
  onResetInspectorWidth,
  onSendBotMessage,
  onSubmitRenameThread,
  onStartCommand,
  onToggleThreadToolsExpanded,
  onToggleWorkbenchToolsExpanded,
}: ThreadWorkbenchRailProps) {
  const workspaceTurnPolicyRoutes = selectedThread
    ? {
        validationRescue: buildWorkspaceTurnPolicyRoute(
          selectedThread.workspaceId,
          {
            turnPolicyThreadId: selectedThread.id,
            policyName: "posttooluse/failed-validation-command",
            actionStatus: "succeeded",
          },
        ),
        missingVerify: buildWorkspaceTurnPolicyRoute(
          selectedThread.workspaceId,
          {
            turnPolicyThreadId: selectedThread.id,
            policyName: "stop/missing-successful-verification",
          },
        ),
        skippedDecisions: buildWorkspaceTurnPolicyRoute(
          selectedThread.workspaceId,
          {
            turnPolicyThreadId: selectedThread.id,
            actionStatus: "skipped",
          },
        ),
        automationSource: buildWorkspaceTurnPolicySourceOverviewRoute(
          selectedThread.workspaceId,
          "automation",
          {
            turnPolicyThreadId: selectedThread.id,
            metricsSource: "automation",
            source: "automation",
          },
        ),
        botSource: buildWorkspaceTurnPolicySourceOverviewRoute(
          selectedThread.workspaceId,
          "bot",
          {
            turnPolicyThreadId: selectedThread.id,
            metricsSource: "bot",
            source: "bot",
          },
        ),
        sourceComparison: buildWorkspaceTurnPolicyCompareRoute(
          selectedThread.workspaceId,
          {
            turnPolicyThreadId: selectedThread.id,
          },
        ),
        alertHistory: buildWorkspaceTurnPolicyHistoryRoute(
          selectedThread.workspaceId,
          {
            historyRange: "90d",
            historyGranularity: "week",
            turnPolicyThreadId: selectedThread.id,
          },
        ),
        automationHistory: buildWorkspaceTurnPolicyHistoryRoute(
          selectedThread.workspaceId,
          {
            historyRange: "90d",
            historyGranularity: "week",
            turnPolicyThreadId: selectedThread.id,
            metricsSource: "automation",
          },
        ),
        botHistory: buildWorkspaceTurnPolicyHistoryRoute(
          selectedThread.workspaceId,
          {
            historyRange: "90d",
            historyGranularity: "week",
            turnPolicyThreadId: selectedThread.id,
            metricsSource: "bot",
          },
        ),
      }
    : undefined;

  if (!isExpanded) {
    if (isMobileViewport) {
      return null;
    }

    return (
      <ThreadWorkbenchRailCollapsed
        onOpenInspector={onOpenInspector}
        onOpenSurfacePanel={onOpenSurfacePanel}
      />
    );
  }

  const railPanelItems = [
    {
      content: (
        <ThreadWorkbenchRailWorkspaceContextSection
          commandCount={commandCount}
          contextUsagePercent={contextUsagePercent}
          contextWindow={contextWindow}
          isMobileViewport={isMobileViewport}
          lastTimelineEventTs={lastTimelineEventTs}
          latestTurnStatus={latestTurnStatus}
          loadedAssistantMessageCount={loadedAssistantMessageCount}
          loadedMessageCount={loadedMessageCount}
          loadedTurnCount={loadedTurnCount}
          liveThreadCwd={liveThreadCwd}
          loadedUserMessageCount={loadedUserMessageCount}
          onHideSurfacePanel={onHideSurfacePanel}
          onOpenSurfacePanel={onOpenSurfacePanel}
          pendingApprovalsCount={pendingApprovalsCount}
          rootPath={rootPath}
          runtimeConfigChangedAt={runtimeConfigChangedAt}
          runtimeConfigLoadStatus={runtimeConfigLoadStatus}
          runtimeRestartRequired={runtimeRestartRequired}
          runtimeStartedAt={runtimeStartedAt}
          runtimeUpdatedAt={runtimeUpdatedAt}
          selectedThread={selectedThread}
          shellEnvironmentInfo={shellEnvironmentInfo}
          shellEnvironmentSummary={shellEnvironmentSummary}
          shellEnvironmentWarning={shellEnvironmentWarning}
          streamState={streamState}
          surfacePanelView={surfacePanelView}
          totalTokens={totalTokens}
          totalMessageCount={totalMessageCount}
          totalTurnCount={totalTurnCount}
          threadCount={threadCount}
          timelineItemCount={timelineItemCount}
          turnCount={turnCount}
          workspaceName={workspaceName}
        />
      ),
      icon: <ContextIcon />,
      id: THREAD_WORKBENCH_RAIL_PANEL_IDS.overview,
      label: i18n._({
        id: "Overview",
        message: "Overview",
      }),
    },
    {
      content: (
        <>
          <ThreadWorkbenchRailHookConfigurationSection
            hookConfiguration={hookConfiguration}
            hookConfigurationError={hookConfigurationError}
            hookConfigurationLoading={hookConfigurationLoading}
          />

          <ThreadWorkbenchRailHookRunsSection
            hookRuns={hookRuns}
            hookRunsError={hookRunsError}
            hookRunsLoading={hookRunsLoading}
            selectedThread={selectedThread}
          />

          <ThreadWorkbenchRailTurnPolicyDecisionsSection
            selectedThread={selectedThread}
            turnPolicyDecisions={turnPolicyDecisions}
            turnPolicyDecisionsError={turnPolicyDecisionsError}
            turnPolicyDecisionsLoading={turnPolicyDecisionsLoading}
          />

          <ThreadWorkbenchRailTurnPolicyMetricsSection
            selectedThread={selectedThread}
            turnPolicyMetrics={turnPolicyMetrics}
            turnPolicyMetricsError={turnPolicyMetricsError}
            turnPolicyMetricsLoading={turnPolicyMetricsLoading}
            workspaceTurnPolicyRoutes={workspaceTurnPolicyRoutes}
          />
        </>
      ),
      icon: <ApprovalIcon />,
      id: THREAD_WORKBENCH_RAIL_PANEL_IDS.governance,
      label: i18n._({
        id: "Governance",
        message: "Governance",
      }),
    },
    {
      content: (
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
      ),
      icon: <FolderOpenIcon />,
      id: THREAD_WORKBENCH_RAIL_PANEL_IDS.thread,
      label: i18n._({
        id: "Thread",
        message: "Thread",
      }),
    },
    {
      content: (
        <ThreadWorkbenchRailWorkbenchToolsSection
          botSendBinding={botSendBinding}
          botSendBindingPending={botSendBindingPending}
          botSendBots={botSendBots}
          botSendDeliveryTargets={botSendDeliveryTargets}
          botSendErrorMessage={botSendErrorMessage}
          botSendLoading={botSendLoading}
          botSendPending={botSendPending}
          botSendSelectedBotId={botSendSelectedBotId}
          botSendSelectedDeliveryTargetId={botSendSelectedDeliveryTargetId}
          botSendText={botSendText}
          command={command}
          commandRunMode={commandRunMode}
          isWorkbenchToolsExpanded={isWorkbenchToolsExpanded}
          onBindThreadBotChannel={onBindThreadBotChannel}
          onChangeBotSendSelectedBotId={onChangeBotSendSelectedBotId}
          onChangeBotSendSelectedDeliveryTargetId={
            onChangeBotSendSelectedDeliveryTargetId
          }
          onChangeBotSendText={onChangeBotSendText}
          onChangeCommand={onChangeCommand}
          onChangeCommandRunMode={onChangeCommandRunMode}
          onDeleteThreadBotBinding={onDeleteThreadBotBinding}
          onSendBotMessage={onSendBotMessage}
          onStartCommand={onStartCommand}
          onToggleWorkbenchToolsExpanded={onToggleWorkbenchToolsExpanded}
          selectedThread={selectedThread}
          startCommandModeDisabled={startCommandModeDisabled}
          startCommandPending={startCommandPending}
        />
      ),
      icon: <ToolsIcon />,
      id: THREAD_WORKBENCH_RAIL_PANEL_IDS.tools,
      label: i18n._({
        id: "Tools",
        message: "Tools",
      }),
    },
  ];

  return (
    <aside
      className={
        isMobileViewport
          ? "workbench-pane workbench-pane--expanded workbench-pane--mobile"
          : isResizing
            ? "workbench-pane workbench-pane--expanded workbench-pane--resizing"
            : "workbench-pane workbench-pane--expanded"
      }
    >
      {!isMobileViewport ? (
        <ResizeHandle
          aria-label={i18n._({
            id: "Resize side rail",
            message: "Resize side rail",
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
                id: "Workbench",
                message: "Workbench",
              })
            : i18n._({
                id: "Side rail",
                message: "Side rail",
              })}
        </span>
        <div className="workbench-pane__topbar-actions">
          {!isMobileViewport ? (
            <button
              className="pane-section__toggle"
              onClick={onResetInspectorWidth}
              type="button"
            >
              {i18n._({
                id: "Reset width",
                message: "Reset width",
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
                  id: "Close",
                  message: "Close",
                })
              : i18n._({
                  id: "Hide rail",
                  message: "Hide rail",
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

      <Tabs
        ariaLabel={i18n._({
          id: "Side rail",
          message: "Side rail",
        })}
        className="workbench-rail-tabs"
        defaultValue={THREAD_WORKBENCH_RAIL_PANEL_IDS.overview}
        items={railPanelItems}
        storageKey={THREAD_WORKBENCH_RAIL_PANEL_STORAGE_KEY}
      />
    </aside>
  );
}
