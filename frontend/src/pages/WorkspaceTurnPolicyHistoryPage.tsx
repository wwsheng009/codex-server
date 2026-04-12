import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { DetailGroup } from "../components/ui/DetailGroup";
import { InlineNotice } from "../components/ui/InlineNotice";
import { LoadingState } from "../components/ui/LoadingState";
import { SelectControl } from "../components/ui/SelectControl";
import { formatRelativeTimeShort } from "../components/workspace/timeline-utils";
import { listWorkspaces } from "../features/workspaces/api";
import {
  formatLocalizedDateTime,
  formatLocalizedNumber,
} from "../i18n/display";
import { formatLocaleNumber } from "../i18n/format";
import { i18n } from "../i18n/runtime";
import {
  buildWorkspaceRoute,
  buildWorkspaceTurnPolicyCompareRoute,
  buildWorkspaceTurnPolicyRoute,
} from "../lib/thread-routes";
import type {
  TurnPolicyMetricsHistoryBucket,
  TurnPolicyMetricsSummary,
  Workspace,
} from "../types/api";
import { ThreadWorkbenchRailHookConfigurationSection } from "./thread-page/ThreadWorkbenchRailHookConfigurationSection";
import { useWorkspaceTurnPolicyOverview } from "./workspaces/useWorkspaceTurnPolicyOverview";
import { useWorkspaceTurnPolicySourceComparison } from "./workspaces/useWorkspaceTurnPolicySourceComparison";

type TurnPolicyHistorySource = "" | "interactive" | "automation" | "bot";
type TurnPolicyHistoryRange = "7d" | "30d" | "90d";
type TurnPolicyHistoryGranularity = "day" | "week";

function normalizeHistorySource(value: string | null | undefined) {
  const normalized = (value ?? "").trim();
  if (
    normalized === "interactive" ||
    normalized === "automation" ||
    normalized === "bot"
  ) {
    return normalized;
  }
  return "";
}

function normalizeHistoryRange(
  value: string | null | undefined,
): TurnPolicyHistoryRange {
  if (value === "30d" || value === "90d") {
    return value;
  }
  return "7d";
}

function normalizeHistoryGranularity(
  value: string | null | undefined,
): TurnPolicyHistoryGranularity {
  return value === "week" ? "week" : "day";
}

function resolveHistoryGranularity(
  historyRange: TurnPolicyHistoryRange,
  historyGranularity: TurnPolicyHistoryGranularity,
): TurnPolicyHistoryGranularity {
  if (historyRange !== "90d") {
    return "day";
  }

  return historyGranularity;
}

function formatRate(value: number, denominator: number) {
  if (denominator <= 0) {
    return "—";
  }

  const percent = Math.round(value * 1000) / 10;
  return `${formatLocalizedNumber(percent, "0")}%`;
}

function formatLatencyMs(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    return "—";
  }

  return `${formatLocalizedNumber(Math.round(value), "0")} ms`;
}

function formatSourceLabel(source: TurnPolicyHistorySource) {
  switch (source) {
    case "interactive":
      return i18n._({
        id: "Interactive",
        message: "Interactive",
      });
    case "automation":
      return i18n._({
        id: "Automation",
        message: "Automation",
      });
    case "bot":
      return i18n._({
        id: "Bot",
        message: "Bot",
      });
    default:
      return i18n._({
        id: "All sources",
        message: "All sources",
      });
  }
}

function formatHistoryRangeLabel(historyRange: TurnPolicyHistoryRange) {
  switch (historyRange) {
    case "30d":
      return i18n._({
        id: "last 30 days",
        message: "last 30 days",
      });
    case "90d":
      return i18n._({
        id: "last 90 days",
        message: "last 90 days",
      });
    default:
      return i18n._({
        id: "last 7 days",
        message: "last 7 days",
      });
  }
}

function formatHistoryGranularityLabel(
  historyGranularity: TurnPolicyHistoryGranularity,
) {
  return historyGranularity === "week"
    ? i18n._({
        id: "weekly",
        message: "weekly",
      })
    : i18n._({
        id: "daily",
        message: "daily",
      });
}

function getHistoryBucketsForSelection(
  summary: TurnPolicyMetricsSummary | undefined,
  historyRange: TurnPolicyHistoryRange,
  historyGranularity: TurnPolicyHistoryGranularity,
) {
  if (historyRange === "90d") {
    if (historyGranularity === "week") {
      return summary?.history?.weeklyLast12Weeks ?? [];
    }

    return summary?.history?.dailyLast90Days ?? [];
  }

  if (historyRange === "30d") {
    return summary?.history?.dailyLast30Days ?? [];
  }

  return summary?.history?.dailyLast7Days ?? [];
}

function formatHistoryBucketLabel(bucket: TurnPolicyMetricsHistoryBucket) {
  const since = new Date(bucket.since);
  const until = new Date(bucket.until);
  if (Number.isNaN(since.getTime()) || Number.isNaN(until.getTime())) {
    return "—";
  }

  const formatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
  });
  const sinceLabel = formatter.format(since);
  const daySpan = Math.round(
    (until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (daySpan <= 1) {
    return sinceLabel;
  }

  return `${sinceLabel} - ${formatter.format(until)}`;
}

function sumHistoryBuckets(
  history: TurnPolicyMetricsHistoryBucket[] | undefined,
) {
  return (history ?? []).reduce(
    (accumulator, bucket) => {
      accumulator.alertsCount += bucket.alertsCount;
      accumulator.total += bucket.decisions.total;
      accumulator.actionAttempts += bucket.decisions.actionAttempts;
      accumulator.actionSucceeded += bucket.decisions.actionSucceeded;
      accumulator.skipped += bucket.decisions.skipped;
      return accumulator;
    },
    {
      alertsCount: 0,
      total: 0,
      actionAttempts: 0,
      actionSucceeded: 0,
      skipped: 0,
    },
  );
}

function SourceHistoryCard({
  historyRange,
  historyGranularity,
  label,
  summary,
}: {
  historyRange: TurnPolicyHistoryRange;
  historyGranularity: TurnPolicyHistoryGranularity;
  label: string;
  summary?: TurnPolicyMetricsSummary;
}) {
  const history = getHistoryBucketsForSelection(
    summary,
    historyRange,
    historyGranularity,
  );
  const totals = sumHistoryBuckets(history);
  const latestBucket = history[history.length - 1];

  return (
    <article className="detail-stat">
      <span className="detail-stat__label">{label}</span>
      <strong className="detail-stat__value">
        {history.length
          ? `${formatLocalizedNumber(totals.alertsCount, "0")} alerts`
          : "—"}
      </strong>
      <span className="detail-stat__meta">
        {history.length
          ? `${formatLocalizedNumber(totals.total, "0")} decisions, ${formatRate(
              totals.actionSucceeded / Math.max(totals.actionAttempts, 1),
              totals.actionAttempts,
            )} success`
          : i18n._({
              id: "No history available yet",
              message: "No history available yet",
            })}
      </span>
      <span className="detail-stat__footer">
        {latestBucket
          ? i18n._({
              id: "Latest {day}: {alerts} alerts, {postLatency} post P95, {stopLatency} stop P95",
              message:
                "Latest {day}: {alerts} alerts, {postLatency} post P95, {stopLatency} stop P95",
              values: {
                day: formatHistoryBucketLabel(latestBucket),
                alerts: formatLocalizedNumber(latestBucket.alertsCount, "0"),
                postLatency: formatLatencyMs(
                  latestBucket.timings.postToolUseDecisionLatency.p95Ms,
                ),
                stopLatency: formatLatencyMs(
                  latestBucket.timings.stopDecisionLatency.p95Ms,
                ),
              },
            })
          : "—"}
      </span>
    </article>
  );
}

function HistoryTable({
  buckets,
}: {
  buckets: TurnPolicyMetricsHistoryBucket[];
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <div
        style={{
          display: "grid",
          gap: 8,
          minWidth: 880,
        }}
      >
        <div
          className="detail-row"
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns:
              "minmax(120px, 1.2fr) repeat(5, minmax(100px, 1fr))",
          }}
        >
          <span>{i18n._({ id: "Day", message: "Day" })}</span>
          <strong>{i18n._({ id: "Alerts", message: "Alerts" })}</strong>
          <strong>{i18n._({ id: "Success", message: "Success" })}</strong>
          <strong>{i18n._({ id: "Skipped", message: "Skipped" })}</strong>
          <strong>{i18n._({ id: "Post P95", message: "Post P95" })}</strong>
          <strong>{i18n._({ id: "Stop P95", message: "Stop P95" })}</strong>
        </div>
        {buckets.map((bucket) => (
          <div
            className="detail-row"
            key={`${bucket.since}-${bucket.until}`}
            style={{
              display: "grid",
              gap: 12,
              gridTemplateColumns:
                "minmax(120px, 1.2fr) repeat(5, minmax(100px, 1fr))",
            }}
          >
            <span>{formatHistoryBucketLabel(bucket)}</span>
            <strong>{formatLocalizedNumber(bucket.alertsCount, "0")}</strong>
            <strong>
              {`${formatRate(
                bucket.decisions.actionSuccessRate,
                bucket.decisions.actionAttempts,
              )} (${bucket.decisions.actionSucceeded} / ${bucket.decisions.actionAttempts})`}
            </strong>
            <strong>
              {formatLocalizedNumber(bucket.decisions.skipped, "0")}
            </strong>
            <strong>
              {formatLatencyMs(
                bucket.timings.postToolUseDecisionLatency.p95Ms,
              )}
            </strong>
            <strong>
              {formatLatencyMs(bucket.timings.stopDecisionLatency.p95Ms)}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScopeSummaryText(input: {
  selectedWorkspace?: Workspace;
  source: TurnPolicyHistorySource;
  threadScopeId: string;
}) {
  const scopeLabel = formatSourceLabel(input.source);
  const workspaceName = input.selectedWorkspace?.name ?? "—";

  if (input.threadScopeId) {
    return i18n._({
      id: "Showing {scope} alert history for {workspace} scoped to thread {threadId}.",
      message:
        "Showing {scope} alert history for {workspace} scoped to thread {threadId}.",
      values: {
        scope: scopeLabel.toLowerCase(),
        workspace: workspaceName,
        threadId: input.threadScopeId,
      },
    });
  }

  return i18n._({
    id: "Showing {scope} alert history for {workspace}.",
    message: "Showing {scope} alert history for {workspace}.",
    values: {
      scope: scopeLabel.toLowerCase(),
      workspace: workspaceName,
    },
  });
}

export function WorkspaceTurnPolicyHistoryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const routeSelectedWorkspaceId =
    searchParams.get("selectedWorkspaceId")?.trim() ?? "";
  const threadScopeId = searchParams.get("turnPolicyThreadId")?.trim() ?? "";
  const metricsSource = normalizeHistorySource(searchParams.get("metricsSource"));
  const historyRange = normalizeHistoryRange(searchParams.get("historyRange"));
  const historyGranularity = resolveHistoryGranularity(
    historyRange,
    normalizeHistoryGranularity(searchParams.get("historyGranularity")),
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

  const {
    selectedWorkspace,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    hookConfiguration,
    hookConfigurationError,
    hookConfigurationLoading,
    turnPolicyMetrics,
    turnPolicyMetricsError,
    turnPolicyMetricsLoading,
  } = useWorkspaceTurnPolicyOverview({
    workspaces,
    sourceScope: metricsSource,
  });
  const {
    interactiveMetrics,
    automationMetrics,
    botMetrics,
    sourceComparisonLoading,
    sourceComparisonError,
  } = useWorkspaceTurnPolicySourceComparison({
    selectedWorkspaceId: metricsSource ? "" : selectedWorkspaceId,
    threadId: threadScopeId,
  });

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
    if (workspacesQuery.isLoading || !selectedWorkspaceId) {
      return;
    }

    const nextSearch = new URLSearchParams();
    nextSearch.set("selectedWorkspaceId", selectedWorkspaceId);
    if (threadScopeId) {
      nextSearch.set("turnPolicyThreadId", threadScopeId);
    }
    if (metricsSource) {
      nextSearch.set("metricsSource", metricsSource);
    }
    nextSearch.set("historyRange", historyRange);
    if (historyRange === "90d") {
      nextSearch.set("historyGranularity", historyGranularity);
    } else {
      nextSearch.delete("historyGranularity");
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
    metricsSource,
    navigate,
    selectedWorkspaceId,
    historyGranularity,
    historyRange,
    threadScopeId,
    workspacesQuery.isLoading,
  ]);

  const historyBuckets = getHistoryBucketsForSelection(
    turnPolicyMetrics,
    historyRange,
    historyGranularity,
  );
  const scopeLabel = formatSourceLabel(metricsSource);
  const historyRangeLabel = formatHistoryRangeLabel(historyRange);
  const historyGranularityLabel =
    formatHistoryGranularityLabel(historyGranularity);
  const overviewRoute = buildWorkspaceTurnPolicyRoute(selectedWorkspaceId, {
    turnPolicyThreadId: threadScopeId,
    metricsSource: metricsSource || undefined,
    source: metricsSource || undefined,
  });

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
                id: "Alert History",
                message: "Alert History",
              })}
            </strong>
          </div>
          <div className="mode-strip__description">
            <ScopeSummaryText
              selectedWorkspace={selectedWorkspace}
              source={metricsSource}
              threadScopeId={threadScopeId}
            />
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>{i18n._({ id: "Scope", message: "Scope" })}</span>
              <strong>{scopeLabel}</strong>
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
                turnPolicyThreadId: threadScopeId,
              })}
            >
              {i18n._({
                id: "Compare sources",
                message: "Compare sources",
              })}
            </Link>
            <Link className="ide-button ide-button--secondary" to={overviewRoute}>
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
                  id: "{scope} alert history",
                  message: "{scope} alert history",
                  values: {
                    scope: scopeLabel,
                  },
                })}
              </h2>
              <p>
                {i18n._({
                  id: "Review the daily turn policy alert, action outcome, and decision latency buckets for the selected time range before drilling into current decisions.",
                  message:
                    "Review the daily turn policy alert, action outcome, and decision latency buckets for the selected time range before drilling into current decisions.",
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
                  id: "Select turn policy history workspace",
                  message: "Select turn policy history workspace",
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

          <ThreadWorkbenchRailHookConfigurationSection
            hookConfiguration={hookConfiguration}
            hookConfigurationError={hookConfigurationError}
            hookConfigurationLoading={hookConfigurationLoading}
          />

          <label className="field">
            <span>
              {i18n._({
                id: "History range",
                message: "History range",
              })}
            </span>
            <SelectControl
              ariaLabel={i18n._({
                id: "Select turn policy history range",
                message: "Select turn policy history range",
              })}
              fullWidth
              onChange={(value) =>
                navigate(
                  {
                    pathname: location.pathname,
                    search: (() => {
                      const nextSearch = new URLSearchParams(location.search);
                      const nextRange = normalizeHistoryRange(value);
                      nextSearch.set("historyRange", nextRange);
                      if (nextRange !== "90d") {
                        nextSearch.delete("historyGranularity");
                      } else if (
                        !["day", "week"].includes(
                          nextSearch.get("historyGranularity") ?? "",
                        )
                      ) {
                        nextSearch.set("historyGranularity", "day");
                      }
                      return `?${nextSearch.toString()}`;
                    })(),
                  },
                  { replace: true },
                )
              }
              options={[
                {
                  value: "7d",
                  label: i18n._({
                    id: "Last 7 days",
                    message: "Last 7 days",
                  }),
                },
                {
                  value: "30d",
                  label: i18n._({
                    id: "Last 30 days",
                    message: "Last 30 days",
                  }),
                },
                {
                  value: "90d",
                  label: i18n._({
                    id: "Last 90 days",
                    message: "Last 90 days",
                  }),
                },
              ]}
              value={historyRange}
            />
          </label>

          {historyRange === "90d" ? (
            <label className="field">
              <span>
                {i18n._({
                  id: "History granularity",
                  message: "History granularity",
                })}
              </span>
              <SelectControl
                ariaLabel={i18n._({
                  id: "Select turn policy history granularity",
                  message: "Select turn policy history granularity",
                })}
                fullWidth
                onChange={(value) =>
                  navigate(
                    {
                      pathname: location.pathname,
                      search: (() => {
                        const nextSearch = new URLSearchParams(location.search);
                        nextSearch.set("historyRange", "90d");
                        nextSearch.set(
                          "historyGranularity",
                          normalizeHistoryGranularity(value),
                        );
                        return `?${nextSearch.toString()}`;
                      })(),
                    },
                    { replace: true },
                  )
                }
                options={[
                  {
                    value: "day",
                    label: i18n._({
                      id: "Daily buckets",
                      message: "Daily buckets",
                    }),
                  },
                  {
                    value: "week",
                    label: i18n._({
                      id: "Weekly buckets",
                      message: "Weekly buckets",
                    }),
                  },
                ]}
                value={historyGranularity}
              />
            </label>
          ) : null}

          <DetailGroup
            title={i18n._({
              id: "{granularity} history ({range})",
              message: "{granularity} history ({range})",
              values: {
                granularity:
                  historyGranularityLabel.charAt(0).toUpperCase() +
                  historyGranularityLabel.slice(1),
                range: historyRangeLabel,
              },
            })}
          >
            {turnPolicyMetricsLoading ? (
              <div className="pane-section-content">
                <LoadingState
                  fill={false}
                  message={i18n._({
                    id: "Loading turn policy history…",
                    message: "Loading turn policy history…",
                  })}
                />
              </div>
            ) : turnPolicyMetricsError ? (
              <div className="pane-section-content">
                <InlineNotice
                  noticeKey={`turn-policy-history-${turnPolicyMetricsError}`}
                  title={i18n._({
                    id: "Turn policy history unavailable",
                    message: "Turn policy history unavailable",
                  })}
                  tone="error"
                >
                  {turnPolicyMetricsError}
                </InlineNotice>
              </div>
            ) : !selectedWorkspace ? (
              <div className="pane-section-content">
                <p className="config-inline-note" style={{ margin: 0 }}>
                  {i18n._({
                    id: "Select a workspace to inspect turn policy alert history.",
                    message:
                      "Select a workspace to inspect turn policy alert history.",
                  })}
                </p>
              </div>
            ) : historyBuckets.length ? (
              <div className="pane-section-content">
                <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                  <ScopeSummaryText
                    selectedWorkspace={selectedWorkspace}
                    source={metricsSource}
                    threadScopeId={threadScopeId}
                  />
                </p>
                <HistoryTable buckets={historyBuckets} />
                <p className="config-inline-note" style={{ margin: "12px 0 0" }}>
                  {i18n._({
                    id: "Generated {generatedAt}",
                    message: "Generated {generatedAt}",
                    values: {
                      generatedAt: formatLocalizedDateTime(
                        turnPolicyMetrics?.generatedAt ?? "",
                        "—",
                      ),
                    },
                  })}
                </p>
              </div>
            ) : (
              <div className="pane-section-content">
                <p className="config-inline-note" style={{ margin: 0 }}>
                  {i18n._({
                    id: "No turn policy history buckets are available yet for this {range} scope.",
                    message:
                      "No turn policy history buckets are available yet for this {range} scope.",
                    values: {
                      range: historyRangeLabel,
                    },
                  })}
                </p>
              </div>
            )}
          </DetailGroup>

          {!metricsSource ? (
            <DetailGroup
              title={i18n._({
                id: "Source histories ({range})",
                message: "Source histories ({range})",
                values: {
                  range: historyRangeLabel,
                },
              })}
            >
              {sourceComparisonLoading ? (
                <div className="pane-section-content">
                  <LoadingState
                    fill={false}
                    message={i18n._({
                      id: "Loading source history summaries…",
                      message: "Loading source history summaries…",
                    })}
                  />
                </div>
              ) : sourceComparisonError ? (
                <div className="pane-section-content">
                  <InlineNotice
                    noticeKey={`turn-policy-source-history-${sourceComparisonError}`}
                    title={i18n._({
                      id: "Source history summaries unavailable",
                      message: "Source history summaries unavailable",
                    })}
                    tone="error"
                  >
                    {sourceComparisonError}
                  </InlineNotice>
                </div>
              ) : (
                <div className="pane-section-content">
                  <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                    {i18n._({
                      id: "Use these summaries to spot which source has been noisier or slower over the same {range} window.",
                      message:
                        "Use these summaries to spot which source has been noisier or slower over the same {range} window.",
                      values: {
                        range: historyRangeLabel,
                      },
                    })}
                  </p>
                  <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
                    <SourceHistoryCard
                      historyRange={historyRange}
                      historyGranularity={historyGranularity}
                      label={i18n._({
                        id: "Interactive {range}",
                        message: "Interactive {range}",
                        values: {
                          range: historyRangeLabel,
                        },
                      })}
                      summary={interactiveMetrics}
                    />
                    <SourceHistoryCard
                      historyRange={historyRange}
                      historyGranularity={historyGranularity}
                      label={i18n._({
                        id: "Automation {range}",
                        message: "Automation {range}",
                        values: {
                          range: historyRangeLabel,
                        },
                      })}
                      summary={automationMetrics}
                    />
                    <SourceHistoryCard
                      historyRange={historyRange}
                      historyGranularity={historyGranularity}
                      label={i18n._({
                        id: "Bot {range}",
                        message: "Bot {range}",
                        values: {
                          range: historyRangeLabel,
                        },
                      })}
                      summary={botMetrics}
                    />
                  </div>
                </div>
              )}
            </DetailGroup>
          ) : null}
        </section>
      </div>
    </section>
  );
}
