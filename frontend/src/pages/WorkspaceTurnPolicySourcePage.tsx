import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";

import { SelectControl } from "../components/ui/SelectControl";
import { formatRelativeTimeShort } from "../components/workspace/timeline-utils";
import { listWorkspaces } from "../features/workspaces/api";
import { formatLocaleNumber } from "../i18n/format";
import { i18n } from "../i18n/runtime";
import {
  buildWorkspaceTurnPolicyCompareRoute,
  buildWorkspaceTurnPolicyHistoryRoute,
  buildWorkspaceRoute,
  buildWorkspaceTurnPolicyRoute,
} from "../lib/thread-routes";
import { useWorkspaceTurnPolicyOverview } from "./workspaces/useWorkspaceTurnPolicyOverview";
import {
  type WorkspaceTurnPolicyDecisionFilters,
  useWorkspaceTurnPolicyRecentDecisions,
} from "./workspaces/useWorkspaceTurnPolicyRecentDecisions";
import { ThreadWorkbenchRailHookConfigurationSection } from "./thread-page/ThreadWorkbenchRailHookConfigurationSection";
import { WorkspaceTurnPolicyRecentDecisionsSection } from "./workspaces/WorkspaceTurnPolicyRecentDecisionsSection";
import { WorkspaceTurnPolicySourceSummarySection } from "./workspaces/WorkspaceTurnPolicySourceSummarySection";

type TurnPolicySource = "automation" | "bot";

const EMPTY_TURN_POLICY_DECISION_FILTERS: WorkspaceTurnPolicyDecisionFilters = {
  threadId: "",
  policyName: "",
  action: "",
  actionStatus: "",
  source: "",
  reason: "",
};

function isTurnPolicySource(
  value: string | undefined,
): value is TurnPolicySource {
  return value === "automation" || value === "bot";
}

function normalizeRouteTurnPolicyDecisionFilters(
  search: string,
): WorkspaceTurnPolicyDecisionFilters {
  const searchParams = new URLSearchParams(search);
  return {
    threadId: searchParams.get("turnPolicyThreadId")?.trim() ?? "",
    policyName: searchParams.get("policyName")?.trim() ?? "",
    action: searchParams.get("action")?.trim() ?? "",
    actionStatus: searchParams.get("actionStatus")?.trim() ?? "",
    source: searchParams.get("source")?.trim() ?? "",
    reason: searchParams.get("reason")?.trim() ?? "",
  };
}

function formatSourceLabel(source: TurnPolicySource) {
  return source === "automation"
    ? i18n._({
        id: "Automation",
        message: "Automation",
      })
    : i18n._({
        id: "Bot",
        message: "Bot",
      });
}

export function WorkspaceTurnPolicySourcePage() {
  const { source: sourceParam = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const source = isTurnPolicySource(sourceParam) ? sourceParam : undefined;
  const [turnPolicyDecisionFilters, setTurnPolicyDecisionFilters] =
    useState<WorkspaceTurnPolicyDecisionFilters>(() =>
      normalizeRouteTurnPolicyDecisionFilters(location.search),
    );

  const workspacesQuery = useQuery({
    queryKey: ["workspaces"],
    queryFn: listWorkspaces,
  });
  const workspaces = useMemo(
    () =>
      [...(workspacesQuery.data ?? [])].sort(
        (left, right) =>
          new Date(right.updatedAt).getTime() -
          new Date(left.updatedAt).getTime(),
      ),
    [workspacesQuery.data],
  );
  const healthyWorkspaces = workspaces.filter((workspace) =>
    ["ready", "active", "connected"].includes(workspace.runtimeStatus),
  ).length;
  const distinctRoots = new Set(
    workspaces.map((workspace) => workspace.rootPath),
  ).size;
  const routeTurnPolicyDecisionFilters = useMemo(
    () => normalizeRouteTurnPolicyDecisionFilters(location.search),
    [location.search],
  );
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const routeSelectedWorkspaceId =
    searchParams.get("selectedWorkspaceId")?.trim() ?? "";

  const {
    selectedWorkspace,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    turnPolicyMetrics,
    turnPolicyMetricsError,
    turnPolicyMetricsLoading,
    hookConfiguration,
    hookConfigurationError,
    hookConfigurationLoading,
  } = useWorkspaceTurnPolicyOverview({
    workspaces,
    sourceScope: source ?? "",
  });

  const pinnedSourceFilters = useMemo(
    () => ({
      ...turnPolicyDecisionFilters,
      source: source ?? "",
    }),
    [source, turnPolicyDecisionFilters],
  );
  const {
    turnPolicyDecisions,
    hasAnyDecisions,
    turnPolicyDecisionsError,
    turnPolicyDecisionsLoading,
  } = useWorkspaceTurnPolicyRecentDecisions({
    selectedWorkspaceId,
    filters: pinnedSourceFilters,
    limit: 10,
  });

  useEffect(() => {
    if (!source) {
      navigate("/workspaces", { replace: true });
    }
  }, [navigate, source]);

  useEffect(() => {
    if (!routeSelectedWorkspaceId || !workspaces.length) {
      return;
    }

    if (
      routeSelectedWorkspaceId !== selectedWorkspaceId &&
      workspaces.some((workspace) => workspace.id === routeSelectedWorkspaceId)
    ) {
      setSelectedWorkspaceId(routeSelectedWorkspaceId);
    }
  }, [
    routeSelectedWorkspaceId,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    workspaces,
  ]);

  useEffect(() => {
    setTurnPolicyDecisionFilters((currentFilters) => {
      const nextFilters = {
        ...routeTurnPolicyDecisionFilters,
        source: source ?? "",
      };
      if (
        currentFilters.threadId === nextFilters.threadId &&
        currentFilters.policyName === nextFilters.policyName &&
        currentFilters.action === nextFilters.action &&
        currentFilters.actionStatus === nextFilters.actionStatus &&
        currentFilters.source === nextFilters.source &&
        currentFilters.reason === nextFilters.reason
      ) {
        return currentFilters;
      }

      return nextFilters;
    });
  }, [routeTurnPolicyDecisionFilters, source]);

  useEffect(() => {
    if (!source || workspacesQuery.isLoading) {
      return;
    }

    const nextSearch = new URLSearchParams();
    nextSearch.set("metricsSource", source);
    nextSearch.set("source", source);
    if (selectedWorkspaceId) {
      nextSearch.set("selectedWorkspaceId", selectedWorkspaceId);
    }
    if (turnPolicyDecisionFilters.threadId) {
      nextSearch.set("turnPolicyThreadId", turnPolicyDecisionFilters.threadId);
    }
    if (turnPolicyDecisionFilters.policyName) {
      nextSearch.set("policyName", turnPolicyDecisionFilters.policyName);
    }
    if (turnPolicyDecisionFilters.action) {
      nextSearch.set("action", turnPolicyDecisionFilters.action);
    }
    if (turnPolicyDecisionFilters.actionStatus) {
      nextSearch.set("actionStatus", turnPolicyDecisionFilters.actionStatus);
    }
    if (turnPolicyDecisionFilters.reason) {
      nextSearch.set("reason", turnPolicyDecisionFilters.reason);
    }

    const nextSearchString = nextSearch.toString();
    const currentSearchString = location.search.startsWith("?")
      ? location.search.slice(1)
      : location.search;
    if (nextSearchString === currentSearchString) {
      return;
    }

    navigate(
      {
        pathname: location.pathname,
        search: nextSearchString ? `?${nextSearchString}` : "",
      },
      { replace: true },
    );
  }, [
    location.pathname,
    location.search,
    navigate,
    selectedWorkspaceId,
    source,
    turnPolicyDecisionFilters.action,
    turnPolicyDecisionFilters.actionStatus,
    turnPolicyDecisionFilters.policyName,
    turnPolicyDecisionFilters.reason,
    turnPolicyDecisionFilters.threadId,
    workspacesQuery.isLoading,
  ]);

  function handleChangeTurnPolicyDecisionFilters(
    filters: WorkspaceTurnPolicyDecisionFilters,
  ) {
    setTurnPolicyDecisionFilters({
      ...filters,
      source: source ?? "",
    });
  }

  function handleResetTurnPolicyDecisionFilters() {
    setTurnPolicyDecisionFilters({
      ...EMPTY_TURN_POLICY_DECISION_FILTERS,
      source: source ?? "",
    });
  }

  function handleDrillDownTurnPolicyDecisionFilters(
    filters: WorkspaceTurnPolicyDecisionFilters,
  ) {
    setTurnPolicyDecisionFilters((currentFilters) => ({
      ...EMPTY_TURN_POLICY_DECISION_FILTERS,
      threadId: currentFilters.threadId ?? "",
      ...filters,
      source: source ?? "",
    }));
  }

  if (!source) {
    return null;
  }

  const sourceLabel = formatSourceLabel(source);
  const sourceLabelLowercase = sourceLabel.toLowerCase();
  const sourceOverviewRoute = buildWorkspaceTurnPolicyRoute(
    selectedWorkspaceId,
    {
      turnPolicyThreadId: turnPolicyDecisionFilters.threadId,
      metricsSource: source,
      policyName: turnPolicyDecisionFilters.policyName,
      action: turnPolicyDecisionFilters.action,
      actionStatus: turnPolicyDecisionFilters.actionStatus,
      source,
      reason: turnPolicyDecisionFilters.reason,
    },
  );

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">
            {i18n._({ id: "Turn Policy", message: "Turn Policy" })}
          </div>
          <div className="mode-strip__title-row">
            <strong>
              {i18n._({
                id: "{source} Review",
                message: "{source} Review",
                values: {
                  source: sourceLabel,
                },
              })}
            </strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: "Inspect source-specific turn policy execution health, audit coverage, alerts, and recent decisions before drilling back into individual threads.",
              message:
                "Inspect source-specific turn policy execution health, audit coverage, alerts, and recent decisions before drilling back into individual threads.",
            })}
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>{i18n._({ id: "Source", message: "Source" })}</span>
              <strong>{sourceLabel}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: "Total", message: "Total" })}</span>
              <strong>{formatLocaleNumber(workspaces.length)}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: "Healthy", message: "Healthy" })}</span>
              <strong>{formatLocaleNumber(healthyWorkspaces)}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: "Roots", message: "Roots" })}</span>
              <strong>{formatLocaleNumber(distinctRoots)}</strong>
            </div>
            <div className="mode-metric">
              <span>{i18n._({ id: "Activity", message: "Activity" })}</span>
              <strong>
                {workspaces[0]?.updatedAt
                  ? formatRelativeTimeShort(workspaces[0].updatedAt)
                  : "—"}
              </strong>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <Link
              className="ide-button ide-button--secondary"
              to={buildWorkspaceTurnPolicyCompareRoute(selectedWorkspaceId, {
                turnPolicyThreadId: turnPolicyDecisionFilters.threadId,
              })}
            >
              {i18n._({
                id: "Compare sources",
                message: "Compare sources",
              })}
            </Link>
            <Link
              className="ide-button ide-button--secondary"
              to={buildWorkspaceTurnPolicyHistoryRoute(selectedWorkspaceId, {
                historyRange: "90d",
                historyGranularity: "week",
                turnPolicyThreadId: turnPolicyDecisionFilters.threadId,
                metricsSource: source,
              })}
            >
              {i18n._({
                id: "View source history",
                message: "View source history",
              })}
            </Link>
            <Link
              className="ide-button ide-button--secondary"
              to={sourceOverviewRoute}
            >
              {i18n._({
                id: "Return to workspace overview",
                message: "Return to workspace overview",
              })}
            </Link>
            {selectedWorkspace ? (
              <Link
                className="ide-button ide-button--secondary"
                to={buildWorkspaceRoute(selectedWorkspace.id)}
              >
                {i18n._({
                  id: "Open workspace",
                  message: "Open workspace",
                })}
              </Link>
            ) : null}
          </div>
        </div>
      </header>

      <div className="stack-screen">
        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>
                {i18n._({
                  id: "{source} Turn Policy Overview",
                  message: "{source} Turn Policy Overview",
                  values: {
                    source: sourceLabel,
                  },
                })}
              </h2>
              <p>
                {i18n._({
                  id: "Keep this page scoped to {source} decisions while you inspect coverage, alerts, timings, and policy actions across the selected workspace.",
                  message:
                    "Keep this page scoped to {source} decisions while you inspect coverage, alerts, timings, and policy actions across the selected workspace.",
                  values: {
                    source: sourceLabelLowercase,
                  },
                })}
              </p>
            </div>
            <div className="section-header__meta">
              {selectedWorkspace?.name ?? "—"}
            </div>
          </div>

          {workspaces.length ? (
            <label className="field">
              <span>{i18n._({ id: "Workspace", message: "Workspace" })}</span>
              <SelectControl
                ariaLabel={i18n._({
                  id: "Select turn policy source review workspace",
                  message: "Select turn policy source review workspace",
                })}
                fullWidth
                onChange={setSelectedWorkspaceId}
                options={workspaces.map((workspace) => ({
                  value: workspace.id,
                  label: workspace.name,
                }))}
                value={selectedWorkspaceId}
              />
            </label>
          ) : null}

          <WorkspaceTurnPolicySourceSummarySection
            selectedWorkspace={selectedWorkspace}
            source={source}
            turnPolicyMetrics={turnPolicyMetrics}
            turnPolicyMetricsError={turnPolicyMetricsError}
            turnPolicyMetricsLoading={turnPolicyMetricsLoading}
            onDrillDown={handleDrillDownTurnPolicyDecisionFilters}
          />

          <ThreadWorkbenchRailHookConfigurationSection
            hookConfiguration={hookConfiguration}
            hookConfigurationError={hookConfigurationError}
            hookConfigurationLoading={hookConfigurationLoading}
          />

          <WorkspaceTurnPolicyRecentDecisionsSection
            filters={pinnedSourceFilters}
            hasAnyDecisions={hasAnyDecisions}
            onChangeFilters={handleChangeTurnPolicyDecisionFilters}
            onResetFilters={handleResetTurnPolicyDecisionFilters}
            selectedWorkspace={selectedWorkspace}
            threadScopeId={turnPolicyDecisionFilters.threadId}
            turnPolicyDecisions={turnPolicyDecisions}
            turnPolicyDecisionsError={turnPolicyDecisionsError}
            turnPolicyDecisionsLoading={turnPolicyDecisionsLoading}
          />
        </section>
      </div>
    </section>
  );
}
