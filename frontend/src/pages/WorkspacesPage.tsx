import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { InlineNotice } from "../components/ui/InlineNotice";
import { SelectControl } from "../components/ui/SelectControl";
import { StatusPill } from "../components/ui/StatusPill";
import { CreateWorkspaceDialog } from "../components/workspace/CreateWorkspaceDialog";
import type { PendingApproval, Workspace } from "../types/api";
import { formatRelativeTimeShort } from "../components/workspace/timeline-utils";
import { getErrorMessage } from "../lib/error-utils";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
  restartWorkspace,
} from "../features/workspaces/api";
import { formatLocaleNumber } from "../i18n/format";
import { i18n } from "../i18n/runtime";
import { WorkspaceTurnPolicyOverviewSection } from "./workspaces/WorkspaceTurnPolicyOverviewSection";
import { WorkspaceTurnPolicyRecentDecisionsSection } from "./workspaces/WorkspaceTurnPolicyRecentDecisionsSection";
import { WorkspaceHookRunsSection } from "./workspaces/WorkspaceHookRunsSection";
import { useWorkspaceTurnPolicyOverview } from "./workspaces/useWorkspaceTurnPolicyOverview";
import { ThreadWorkbenchRailHookConfigurationSection } from "./thread-page/ThreadWorkbenchRailHookConfigurationSection";
import {
  useWorkspaceTurnPolicyRecentDecisions,
  type WorkspaceTurnPolicyDecisionFilters,
} from "./workspaces/useWorkspaceTurnPolicyRecentDecisions";
import {
  useWorkspaceHookRuns,
  type WorkspaceHookRunFilters,
} from "./workspaces/useWorkspaceHookRuns";
import { useSessionStore } from "../stores/session-store";
import { useUIStore } from "../stores/ui-store";
import {
  buildWorkspaceTurnPolicyCompareRoute,
  buildWorkspaceTurnPolicyHistoryRoute,
} from "../lib/thread-routes";

const EMPTY_TURN_POLICY_DECISION_FILTERS: WorkspaceTurnPolicyDecisionFilters = {
  threadId: "",
  policyName: "",
  action: "",
  actionStatus: "",
  source: "",
  reason: "",
};

const EMPTY_WORKSPACE_HOOK_RUN_FILTERS: WorkspaceHookRunFilters = {
  threadId: "",
  eventName: "",
  status: "",
  handlerKey: "",
  hookRunId: "",
};

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

function normalizeRouteTurnPolicyMetricsSource(search: string) {
  return new URLSearchParams(search).get("metricsSource")?.trim() ?? "";
}

function normalizeRouteHookRunFilters(search: string): WorkspaceHookRunFilters {
  const searchParams = new URLSearchParams(search);
  return {
    threadId: searchParams.get("hookRunsThreadId")?.trim() ?? "",
    eventName: searchParams.get("hookEventName")?.trim() ?? "",
    status: searchParams.get("hookStatus")?.trim() ?? "",
    handlerKey: searchParams.get("hookHandlerKey")?.trim() ?? "",
    hookRunId: searchParams.get("hookRunId")?.trim() ?? "",
  };
}

export function WorkspacesPage() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false);
  const [confirmingWorkspaceDelete, setConfirmingWorkspaceDelete] =
    useState<Workspace | null>(null);
  const [turnPolicyDecisionFilters, setTurnPolicyDecisionFilters] =
    useState<WorkspaceTurnPolicyDecisionFilters>(() =>
      normalizeRouteTurnPolicyDecisionFilters(location.search),
    );
  const [hookRunFilters, setHookRunFilters] = useState<WorkspaceHookRunFilters>(
    () => normalizeRouteHookRunFilters(location.search),
  );
  const [turnPolicyMetricsSource, setTurnPolicyMetricsSource] = useState(() =>
    normalizeRouteTurnPolicyMetricsSource(location.search),
  );
  const removeWorkspaceFromSession = useSessionStore(
    (state) => state.removeWorkspace,
  );
  const workspaceRestartStateById = useUIStore(
    (state) => state.workspaceRestartStateById,
  );
  const markWorkspaceRestarting = useUIStore(
    (state) => state.markWorkspaceRestarting,
  );
  const markWorkspaceRestarted = useUIStore(
    (state) => state.markWorkspaceRestarted,
  );
  const clearWorkspaceRestartState = useUIStore(
    (state) => state.clearWorkspaceRestartState,
  );
  const pushToast = useUIStore((state) => state.pushToast);

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
  const workspacesError = workspacesQuery.error
    ? getErrorMessage(workspacesQuery.error)
    : null;
  const healthyWorkspaces = workspaces.filter((workspace) =>
    ["ready", "active", "connected"].includes(workspace.runtimeStatus),
  ).length;
  const distinctRoots = new Set(
    workspaces.map((workspace) => workspace.rootPath),
  ).size;
  const {
    selectedWorkspace,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    turnPolicyMetrics,
    turnPolicyMetricsLoading,
    turnPolicyMetricsError,
    hookConfiguration,
    hookConfigurationLoading,
    hookConfigurationError,
    turnPolicySourceHealth,
  } = useWorkspaceTurnPolicyOverview({
    workspaces,
    sourceScope: turnPolicyMetricsSource,
  });
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const routeTurnPolicyDecisionFilters = useMemo(
    () => normalizeRouteTurnPolicyDecisionFilters(location.search),
    [location.search],
  );
  const routeTurnPolicyMetricsSource = useMemo(
    () => normalizeRouteTurnPolicyMetricsSource(location.search),
    [location.search],
  );
  const routeHookRunFilters = useMemo(
    () => normalizeRouteHookRunFilters(location.search),
    [location.search],
  );
  const routeSelectedWorkspaceId =
    searchParams.get("selectedWorkspaceId")?.trim() ?? "";
  const {
    turnPolicyDecisions,
    hasAnyDecisions,
    turnPolicyDecisionsLoading,
    turnPolicyDecisionsError,
  } = useWorkspaceTurnPolicyRecentDecisions({
    selectedWorkspaceId,
    filters: turnPolicyDecisionFilters,
    limit: 5,
  });
  const {
    hookRuns,
    hasAnyHookRuns,
    hookRunsLoading,
    hookRunsError,
  } = useWorkspaceHookRuns({
    selectedWorkspaceId,
    filters: hookRunFilters,
    limit: 5,
  });
  const isWorkspaceOverviewBootstrapping =
    workspaces.length > 0 && !selectedWorkspaceId && !selectedWorkspace;

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
      if (
        currentFilters.threadId === routeTurnPolicyDecisionFilters.threadId &&
        currentFilters.policyName ===
          routeTurnPolicyDecisionFilters.policyName &&
        currentFilters.action === routeTurnPolicyDecisionFilters.action &&
        currentFilters.actionStatus ===
          routeTurnPolicyDecisionFilters.actionStatus &&
        currentFilters.source === routeTurnPolicyDecisionFilters.source &&
        currentFilters.reason === routeTurnPolicyDecisionFilters.reason
      ) {
        return currentFilters;
      }

      return routeTurnPolicyDecisionFilters;
    });
  }, [routeTurnPolicyDecisionFilters]);

  useEffect(() => {
    setHookRunFilters((currentFilters) => {
      if (
        currentFilters.threadId === routeHookRunFilters.threadId &&
        currentFilters.eventName === routeHookRunFilters.eventName &&
        currentFilters.status === routeHookRunFilters.status &&
        currentFilters.handlerKey === routeHookRunFilters.handlerKey &&
        currentFilters.hookRunId === routeHookRunFilters.hookRunId
      ) {
        return currentFilters;
      }

      return routeHookRunFilters;
    });
  }, [routeHookRunFilters]);

  useEffect(() => {
    setTurnPolicyMetricsSource((currentSource) => {
      if (currentSource === routeTurnPolicyMetricsSource) {
        return currentSource;
      }

      return routeTurnPolicyMetricsSource;
    });
  }, [routeTurnPolicyMetricsSource]);

  const routeWorkspaceSelectionPending = Boolean(
    routeSelectedWorkspaceId &&
    routeSelectedWorkspaceId !== selectedWorkspaceId &&
    workspaces.some((workspace) => workspace.id === routeSelectedWorkspaceId),
  );

  useEffect(() => {
    if (workspacesQuery.isLoading || routeWorkspaceSelectionPending) {
      return;
    }

    const nextSearch = new URLSearchParams();
    if (selectedWorkspaceId) {
      nextSearch.set("selectedWorkspaceId", selectedWorkspaceId);
    }
    if (turnPolicyMetricsSource) {
      nextSearch.set("metricsSource", turnPolicyMetricsSource);
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
    if (turnPolicyDecisionFilters.source) {
      nextSearch.set("source", turnPolicyDecisionFilters.source);
    }
    if (turnPolicyDecisionFilters.reason) {
      nextSearch.set("reason", turnPolicyDecisionFilters.reason);
    }
    if (hookRunFilters.threadId) {
      nextSearch.set("hookRunsThreadId", hookRunFilters.threadId);
    }
    if (hookRunFilters.eventName) {
      nextSearch.set("hookEventName", hookRunFilters.eventName);
    }
    if (hookRunFilters.status) {
      nextSearch.set("hookStatus", hookRunFilters.status);
    }
    if (hookRunFilters.handlerKey) {
      nextSearch.set("hookHandlerKey", hookRunFilters.handlerKey);
    }
    if (hookRunFilters.hookRunId) {
      nextSearch.set("hookRunId", hookRunFilters.hookRunId);
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
    routeWorkspaceSelectionPending,
    selectedWorkspaceId,
    hookRunFilters.eventName,
    hookRunFilters.handlerKey,
    hookRunFilters.hookRunId,
    hookRunFilters.status,
    hookRunFilters.threadId,
    turnPolicyDecisionFilters.action,
    turnPolicyDecisionFilters.actionStatus,
    turnPolicyDecisionFilters.policyName,
    turnPolicyDecisionFilters.reason,
    turnPolicyDecisionFilters.source,
    turnPolicyDecisionFilters.threadId,
    turnPolicyMetricsSource,
    workspacesQuery.isLoading,
  ]);

  const createWorkspaceMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: async (workspace) => {
      setName("");
      setRootPath("");
      setIsCreatingWorkspace(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["shell-workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["shell-threads"] }),
      ]);
      pushToast({
        title: i18n._({
          id: "Workspace registered",
          message: "Workspace registered",
        }),
        message: i18n._({
          id: "Workspace {name} is now available in the registry.",
          message: "Workspace {name} is now available in the registry.",
          values: { name: workspace.name },
        }),
        tone: "success",
      });
    },
    onError: (error) => {
      pushToast({
        title: i18n._({
          id: "Workspace registration failed",
          message: "Workspace registration failed",
        }),
        message: getErrorMessage(error),
        tone: "error",
      });
    },
  });
  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => deleteWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      removeWorkspaceFromSession(workspaceId);
      setConfirmingWorkspaceDelete(null);
      deleteWorkspaceMutation.reset();
      queryClient.removeQueries({ queryKey: ["workspace", workspaceId] });
      queryClient.removeQueries({ queryKey: ["threads", workspaceId] });
      queryClient.removeQueries({ queryKey: ["thread-detail", workspaceId] });
      queryClient.removeQueries({ queryKey: ["approvals", workspaceId] });
      queryClient.removeQueries({ queryKey: ["models", workspaceId] });
      queryClient.removeQueries({ queryKey: ["shell-threads", workspaceId] });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["shell-workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["shell-threads"] }),
      ]);
    },
  });
  const restartWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => restartWorkspace(workspaceId),
    onMutate: (workspaceId) => {
      markWorkspaceRestarting(workspaceId);
    },
    onSuccess: (workspace) => {
      markWorkspaceRestarted(workspace.id);
      queryClient.setQueryData<PendingApproval[]>(
        ["approvals", workspace.id],
        [],
      );
    },
    onError: (_, workspaceId) => {
      clearWorkspaceRestartState(workspaceId);
    },
    onSettled: async (_, __, workspaceId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["workspace", workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["shell-workspaces"] }),
        queryClient.invalidateQueries({ queryKey: ["threads", workspaceId] }),
        queryClient.invalidateQueries({
          queryKey: ["shell-threads", workspaceId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["thread-detail", workspaceId],
        }),
      ]);
    },
  });

  function handleCreateWorkspace() {
    if (!name.trim() || !rootPath.trim()) {
      return;
    }

    createWorkspaceMutation.mutate({
      name: name.trim(),
      rootPath: rootPath.trim(),
    });
  }

  function handleDeleteWorkspace(workspace: Workspace) {
    if (
      deleteWorkspaceMutation.isPending ||
      restartWorkspaceMutation.isPending
    ) {
      return;
    }

    deleteWorkspaceMutation.reset();
    setConfirmingWorkspaceDelete(workspace);
  }

  function handleCloseDeleteWorkspaceDialog() {
    if (deleteWorkspaceMutation.isPending) {
      return;
    }

    setConfirmingWorkspaceDelete(null);
    deleteWorkspaceMutation.reset();
  }

  function handleConfirmDeleteWorkspaceDialog() {
    if (!confirmingWorkspaceDelete || deleteWorkspaceMutation.isPending) {
      return;
    }

    deleteWorkspaceMutation.mutate(confirmingWorkspaceDelete.id);
  }

  function handleChangeTurnPolicyDecisionFilters(
    filters: WorkspaceTurnPolicyDecisionFilters,
  ) {
    setTurnPolicyDecisionFilters(filters);
    if (filters.source !== turnPolicyDecisionFilters.source) {
      setTurnPolicyMetricsSource(filters.source ?? "");
    }
  }

  function handleResetTurnPolicyDecisionFilters() {
    setTurnPolicyDecisionFilters(EMPTY_TURN_POLICY_DECISION_FILTERS);
    setTurnPolicyMetricsSource("");
  }

  function handleDrillDownTurnPolicyDecisionFilters(
    filters: WorkspaceTurnPolicyDecisionFilters,
  ) {
    if (filters.source) {
      setTurnPolicyMetricsSource(filters.source);
    }
    setTurnPolicyDecisionFilters((currentFilters) => ({
      ...EMPTY_TURN_POLICY_DECISION_FILTERS,
      threadId: currentFilters.threadId ?? "",
      ...filters,
    }));
  }

  function handleChangeHookRunFilters(filters: WorkspaceHookRunFilters) {
    setHookRunFilters(filters);
  }

  function handleResetHookRunFilters() {
    setHookRunFilters(EMPTY_WORKSPACE_HOOK_RUN_FILTERS);
  }

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">
            {i18n._({ id: "Workspace", message: "Workspace" })}
          </div>
          <div className="mode-strip__title-row">
            <strong>{i18n._({ id: "Workbench", message: "Workbench" })}</strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: "Register runtime roots, inspect workspace health, and manage your local development environments.",
              message:
                "Register runtime roots, inspect workspace health, and manage your local development environments.",
            })}
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
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
          <Button onClick={() => setIsCreatingWorkspace(true)}>
            {i18n._({ id: "New Workspace", message: "New Workspace" })}
          </Button>
        </div>
      </header>

      <div className="stack-screen">
        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>
                {i18n._({
                  id: "Workspace Registry",
                  message: "Workspace Registry",
                })}
              </h2>
            </div>
            <div className="section-header__meta">
              {formatLocaleNumber(workspaces.length)}
            </div>
          </div>

          {workspacesQuery.isLoading ? (
            <div className="notice">
              {i18n._({
                id: "Loading registry…",
                message: "Loading registry…",
              })}
            </div>
          ) : null}

          {workspacesError ? (
            <InlineNotice
              dismissible
              noticeKey={`workspaces-load-${workspacesError}`}
              onRetry={() => void workspacesQuery.refetch()}
              title={i18n._({
                id: "Failed To Load Workspace Registry",
                message: "Failed To Load Workspace Registry",
              })}
              tone="error"
            >
              {workspacesError}
            </InlineNotice>
          ) : null}

          {!workspacesQuery.isLoading &&
          !workspacesError &&
          !workspaces.length ? (
            <div className="empty-state">
              <div className="form-stack">
                <p>
                  {i18n._({
                    id: "No workspaces registered yet.",
                    message: "No workspaces registered yet.",
                  })}
                </p>
                <Button onClick={() => setIsCreatingWorkspace(true)}>
                  {i18n._({
                    id: "Create Your First Workspace",
                    message: "Create Your First Workspace",
                  })}
                </Button>
              </div>
            </div>
          ) : null}

          {workspaces.length ? (
            <div className="workspace-compact-list">
              {workspaces.map((workspace) => {
                const restartPhase = workspaceRestartStateById[workspace.id];
                const visualStatus =
                  restartPhase === "restarting"
                    ? "restarting"
                    : workspace.runtimeStatus;

                return (
                  <div className="workspace-compact-row" key={workspace.id}>
                    <Link
                      className="workspace-compact-row__main"
                      to={`/workspaces/${workspace.id}`}
                    >
                      <div className="workspace-compact-row__title">
                        <strong dir="auto">{workspace.name}</strong>
                        <span className="meta-label">
                          {i18n._({
                            id: "ID: {id}",
                            message: "ID: {id}",
                            values: { id: workspace.id.slice(0, 8) },
                          })}
                        </span>
                      </div>
                      <p>{workspace.rootPath}</p>
                    </Link>
                    <div className="workspace-compact-row__actions">
                      <StatusPill status={visualStatus} />
                      <div className="divider-v" />
                      <Button
                        aria-pressed={selectedWorkspaceId === workspace.id}
                        intent={
                          selectedWorkspaceId === workspace.id
                            ? "secondary"
                            : "ghost"
                        }
                        onClick={() => setSelectedWorkspaceId(workspace.id)}
                        size="sm"
                      >
                        {i18n._({ id: "Inspect", message: "Inspect" })}
                      </Button>
                      <Button
                        intent="ghost"
                        isLoading={restartPhase === "restarting"}
                        size="sm"
                        onClick={() =>
                          restartWorkspaceMutation.mutate(workspace.id)
                        }
                      >
                        {i18n._({ id: "Restart", message: "Restart" })}
                      </Button>
                      <Button
                        intent="ghost"
                        className="ide-button--ghost-danger"
                        size="sm"
                        onClick={() => handleDeleteWorkspace(workspace)}
                      >
                        {i18n._({ id: "Remove", message: "Remove" })}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </section>

        {workspacesQuery.isLoading || workspaces.length ? (
          <section className="content-section">
            <div className="section-header">
              <div>
                <h2>
                  {i18n._({
                    id: "Turn Policy Overview",
                    message: "Turn Policy Overview",
                  })}
                </h2>
                <p>
                  {i18n._({
                    id: "Inspect workspace-level automatic correction coverage before drilling into a thread.",
                    message:
                      "Inspect workspace-level automatic correction coverage before drilling into a thread.",
                  })}
                </p>
              </div>
              <div className="section-header__meta">
                {selectedWorkspace?.name ?? "—"}
              </div>
            </div>

            {workspaces.length ? (
              <>
                <label className="field">
                  <span>
                    {i18n._({ id: "Workspace", message: "Workspace" })}
                  </span>
                  <SelectControl
                    ariaLabel={i18n._({
                      id: "Select workspace turn policy overview target",
                      message: "Select workspace turn policy overview target",
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
                {selectedWorkspaceId ? (
                  <div
                    className="pane-section-content"
                    style={{ padding: "0 0 12px" }}
                  >
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <Link
                        className="ide-button ide-button--secondary ide-button--sm"
                        to={buildWorkspaceTurnPolicyCompareRoute(
                          selectedWorkspaceId,
                          {
                            turnPolicyThreadId:
                              turnPolicyDecisionFilters.threadId ?? "",
                          },
                        )}
                      >
                        {i18n._({
                          id: "Compare sources",
                          message: "Compare sources",
                        })}
                      </Link>
                      <Link
                        className="ide-button ide-button--secondary ide-button--sm"
                        to={buildWorkspaceTurnPolicyHistoryRoute(
                          selectedWorkspaceId,
                          {
                            turnPolicyThreadId:
                              turnPolicyDecisionFilters.threadId ?? "",
                            historyRange: "90d",
                            historyGranularity: "week",
                            metricsSource: turnPolicyMetricsSource,
                          },
                        )}
                      >
                        {i18n._({
                          id: "View alert history",
                          message: "View alert history",
                        })}
                      </Link>
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}

            <WorkspaceTurnPolicyOverviewSection
              metricsSourceScope={turnPolicyMetricsSource}
              onDrillDown={handleDrillDownTurnPolicyDecisionFilters}
              selectedWorkspace={selectedWorkspace}
              turnPolicyMetrics={turnPolicyMetrics}
              turnPolicyMetricsError={turnPolicyMetricsError}
              turnPolicyMetricsLoading={
                (workspacesQuery.isLoading ||
                  isWorkspaceOverviewBootstrapping) &&
                !selectedWorkspace
                  ? true
                  : turnPolicyMetricsLoading
              }
              turnPolicySourceHealth={turnPolicySourceHealth}
            />

            <ThreadWorkbenchRailHookConfigurationSection
              governanceTab="workspace"
              hookConfiguration={hookConfiguration}
              hookConfigurationError={hookConfigurationError}
              hookConfigurationLoading={
                (workspacesQuery.isLoading || isWorkspaceOverviewBootstrapping) &&
                !selectedWorkspace
                  ? true
                  : hookConfigurationLoading
              }
            />

            <WorkspaceTurnPolicyRecentDecisionsSection
              filters={turnPolicyDecisionFilters}
              hasAnyDecisions={hasAnyDecisions}
              onChangeFilters={handleChangeTurnPolicyDecisionFilters}
              onResetFilters={handleResetTurnPolicyDecisionFilters}
              selectedWorkspace={selectedWorkspace}
              threadScopeId={turnPolicyDecisionFilters.threadId}
              turnPolicyDecisions={turnPolicyDecisions}
              turnPolicyDecisionsError={turnPolicyDecisionsError}
              turnPolicyDecisionsLoading={
                (workspacesQuery.isLoading ||
                  isWorkspaceOverviewBootstrapping) &&
                !selectedWorkspace
                  ? true
                  : turnPolicyDecisionsLoading
              }
            />

            <WorkspaceHookRunsSection
              filters={hookRunFilters}
              hasAnyHookRuns={hasAnyHookRuns}
              hookRuns={hookRuns}
              hookRunsError={hookRunsError}
              hookRunsLoading={
                (workspacesQuery.isLoading ||
                  isWorkspaceOverviewBootstrapping) &&
                !selectedWorkspace
                  ? true
                  : hookRunsLoading
              }
              onChangeFilters={handleChangeHookRunFilters}
              onResetFilters={handleResetHookRunFilters}
              selectedWorkspace={selectedWorkspace}
            />
          </section>
        ) : null}
      </div>

      {isCreatingWorkspace && (
        <CreateWorkspaceDialog
          error={
            createWorkspaceMutation.error
              ? getErrorMessage(createWorkspaceMutation.error)
              : null
          }
          isPending={createWorkspaceMutation.isPending}
          name={name}
          onClose={() => {
            setIsCreatingWorkspace(false);
            createWorkspaceMutation.reset();
          }}
          onNameChange={setName}
          onRootPathChange={setRootPath}
          onSubmit={handleCreateWorkspace}
          rootPath={rootPath}
        />
      )}

      {confirmingWorkspaceDelete ? (
        <ConfirmDialog
          confirmLabel={i18n._({
            id: "Remove Workspace",
            message: "Remove Workspace",
          })}
          description={i18n._({
            id: "This removes the workspace from the registry and clears its loaded thread list from the UI.",
            message:
              "This removes the workspace from the registry and clears its loaded thread list from the UI.",
          })}
          error={
            deleteWorkspaceMutation.error
              ? getErrorMessage(deleteWorkspaceMutation.error)
              : null
          }
          isPending={deleteWorkspaceMutation.isPending}
          onClose={handleCloseDeleteWorkspaceDialog}
          onConfirm={handleConfirmDeleteWorkspaceDialog}
          subject={confirmingWorkspaceDelete.name}
          title={i18n._({
            id: "Remove Workspace?",
            message: "Remove Workspace?",
          })}
        />
      ) : null}
    </section>
  );
}
