import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { SelectControl } from "../components/ui/SelectControl";
import { DetailGroup } from "../components/ui/DetailGroup";
import { InlineNotice } from "../components/ui/InlineNotice";
import { formatRelativeTimeShort } from "../components/workspace/timeline-utils";
import { listWorkspaces } from "../features/workspaces/api";
import {
  formatLocalizedNumber,
} from "../i18n/display";
import { formatLocaleNumber } from "../i18n/format";
import { i18n } from "../i18n/runtime";
import {
  buildWorkspaceTurnPolicyCompareRoute,
  buildWorkspaceTurnPolicyHistoryRoute,
  buildWorkspaceTurnPolicyRoute,
  buildWorkspaceTurnPolicySourceOverviewRoute,
} from "../lib/thread-routes";
import {
  formatTurnPolicyAlertAcknowledgementNote,
  formatTurnPolicyAlertGovernanceAction,
  formatTurnPolicyNoActiveAlertsLabel,
  formatTurnPolicyAlertSnoozeNote,
  formatTurnPolicyAlertSuppressionNote,
  formatTurnPolicyAlertTitle,
  formatTurnPolicyDecisionSource,
  formatTurnPolicyMetricActivityMeta,
  formatTurnPolicyMetricCoverageAlertsFooter,
  formatTurnPolicyMetricDecisionSuccessSummary,
  formatTurnPolicyMetricLatencyMs,
  formatTurnPolicyMetricPostStopLatencyFooter,
  formatTurnPolicyMetricTopAlertMeta,
  getTopTurnPolicyMetricAlert,
  getTurnPolicyAlertAcknowledgementSummary,
  getTurnPolicyAlertSnoozeSummary,
  getTurnPolicyAlertSuppressionSummary,
  isTurnPolicyAlertAcknowledged,
} from "../lib/turn-policy-display";
import type {
  TurnPolicyMetricAlert,
  TurnPolicyMetricsSummary,
} from "../types/api";
import { useTurnPolicyAlertGovernanceActions } from "./workspaces/useTurnPolicyAlertGovernanceActions";
import { useWorkspaceTurnPolicyOverview } from "./workspaces/useWorkspaceTurnPolicyOverview";
import { useWorkspaceTurnPolicySourceComparison } from "./workspaces/useWorkspaceTurnPolicySourceComparison";
import { ThreadWorkbenchRailHookConfigurationSection } from "./thread-page/ThreadWorkbenchRailHookConfigurationSection";

function formatTopAlert(summary?: TurnPolicyMetricsSummary) {
  const alert = getTopTurnPolicyMetricAlert(summary);
  if (!alert) {
    return formatTurnPolicyNoActiveAlertsLabel();
  }

  return formatTurnPolicyAlertTitle(alert);
}

function formatTopAlertMeta(summary?: TurnPolicyMetricsSummary) {
  return formatTurnPolicyMetricTopAlertMeta(getTopTurnPolicyMetricAlert(summary));
}

function isSnoozedAlert(
  alert: TurnPolicyMetricAlert | undefined,
  summary?: TurnPolicyMetricsSummary,
) {
  if (!alert) {
    return false;
  }

  return (
    getTurnPolicyAlertSnoozeSummary(summary)?.snoozedCodes.includes(alert.code) ??
    false
  );
}

function formatAlertAcknowledgementNote(
  label: string,
  summary?: TurnPolicyMetricsSummary,
) {
  return formatTurnPolicyAlertAcknowledgementNote(
    getTurnPolicyAlertAcknowledgementSummary(summary as {
      alertPolicy?: unknown;
    } | null),
    { labelPrefix: label },
  );
}

function formatAlertSuppressionNote(
  label: string,
  summary?: TurnPolicyMetricsSummary,
) {
  return formatTurnPolicyAlertSuppressionNote(
    getTurnPolicyAlertSuppressionSummary(summary as {
      alertPolicy?: unknown;
    } | null),
    { labelPrefix: label },
  );
}

function formatAlertSnoozeNote(
  label: string,
  summary?: TurnPolicyMetricsSummary,
) {
  return formatTurnPolicyAlertSnoozeNote(
    getTurnPolicyAlertSnoozeSummary(summary as {
      alertPolicy?: unknown;
    } | null),
    { labelPrefix: label },
  );
}

function getRecentWindow(
  summary: TurnPolicyMetricsSummary | undefined,
  windowKey: "lastHour" | "last24Hours",
) {
  return summary?.recentWindows?.[windowKey];
}

function ComparisonCard({
  ctaLabel,
  ctaTo,
  label,
  summary,
}: {
  ctaLabel: string;
  ctaTo: string;
  label: string;
  summary?: TurnPolicyMetricsSummary;
}) {
  const value = summary
    ? formatTurnPolicyMetricDecisionSuccessSummary(
        summary.decisions.total,
        summary.decisions.actionSuccessRate,
        summary.decisions.actionAttempts,
      )
    : "—";
  const meta = summary
    ? formatTurnPolicyMetricActivityMeta({
        total: summary.decisions.total,
        skipped: summary.decisions.actionStatusCounts.skipped,
      })
    : "—";
  const footer = summary
    ? formatTurnPolicyMetricCoverageAlertsFooter(
        summary.audit.coverageRate,
        summary.audit.eligibleTurns,
        {
          alertCount: summary.alerts?.length ?? 0,
          postLatencyMs: summary.timings.postToolUseDecisionLatency.p95Ms,
          stopLatencyMs: summary.timings.stopDecisionLatency.p95Ms,
        },
      )
    : "—";

  return (
    <article className="detail-stat">
      <span className="detail-stat__label">{label}</span>
      <strong className="detail-stat__value">{value}</strong>
      <span className="detail-stat__meta">{meta}</span>
      <span className="detail-stat__footer">{footer}</span>
      <Link
        className="ide-button ide-button--secondary ide-button--sm"
        to={ctaTo}
      >
        {ctaLabel}
      </Link>
    </article>
  );
}

function SignalCard({
  footer,
  label,
  meta,
  value,
}: {
  footer?: string;
  label: string;
  meta?: string;
  value: string;
}) {
  return (
    <article className="detail-stat">
      <span className="detail-stat__label">{label}</span>
      <strong className="detail-stat__value">{value}</strong>
      <span className="detail-stat__meta">{meta ?? "—"}</span>
      <span className="detail-stat__footer">{footer ?? "—"}</span>
    </article>
  );
}

function ComparisonDetailRow({
  interactive,
  automation,
  bot,
  label,
}: {
  interactive: string | number;
  automation: string | number;
  bot: string | number;
  label: string;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
          width: "min(560px, 100%)",
        }}
      >
        <span>{interactive}</span>
        <span>{automation}</span>
        <span>{bot}</span>
      </strong>
    </div>
  );
}

function TopAlertGovernanceRow({
  alert,
  isPending,
  onGovernanceAction,
  sourceLabel,
  summary,
}: {
  alert?: TurnPolicyMetricAlert;
  isPending: boolean;
  onGovernanceAction: (
    type: "acknowledge" | "clearAcknowledgement" | "snooze24h" | "clearSnooze",
    code: string,
  ) => void;
  sourceLabel: string;
  summary?: TurnPolicyMetricsSummary;
}) {
  if (!alert) {
    return (
      <div className="detail-row">
        <span>{sourceLabel}</span>
        <span className="config-inline-note">
          {formatTurnPolicyNoActiveAlertsLabel()}
        </span>
      </div>
    );
  }

  const acknowledgementAction = isTurnPolicyAlertAcknowledged(alert)
    ? "clearAcknowledgement"
    : "acknowledge";
  const snoozeAction = isSnoozedAlert(alert, summary)
    ? "clearSnooze"
    : "snooze24h";

  return (
    <div
      className="detail-row"
      style={{
        alignItems: "stretch",
        display: "grid",
        gap: 12,
        gridTemplateColumns: "minmax(0, 1fr) auto",
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          display: "grid",
          gap: 4,
          justifyItems: "flex-start",
        }}
      >
        <span>{sourceLabel}</span>
        <strong>{formatTurnPolicyAlertTitle(alert)}</strong>
        <span className="config-inline-note">
          {formatTopAlertMeta(summary)}
        </span>
      </div>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "flex-end",
        }}
      >
        <button
          disabled={isPending}
          onClick={() => onGovernanceAction(acknowledgementAction, alert.code)}
          type="button"
        >
          {formatTurnPolicyAlertGovernanceAction(acknowledgementAction)}
        </button>
        <button
          disabled={isPending}
          onClick={() => onGovernanceAction(snoozeAction, alert.code)}
          type="button"
        >
          {formatTurnPolicyAlertGovernanceAction(snoozeAction)}
        </button>
      </div>
    </div>
  );
}

export function WorkspaceTurnPolicyComparePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const searchParams = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const routeSelectedWorkspaceId =
    searchParams.get("selectedWorkspaceId")?.trim() ?? "";
  const threadScopeId = searchParams.get("turnPolicyThreadId")?.trim() ?? "";

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
  } = useWorkspaceTurnPolicyOverview({
    workspaces,
  });
  const {
    interactiveMetrics,
    automationMetrics,
    botMetrics,
    sourceComparisonLoading,
    sourceComparisonError,
  } = useWorkspaceTurnPolicySourceComparison({
    selectedWorkspaceId,
    threadId: threadScopeId,
  });
  const {
    applyAlertGovernanceAction,
    error: governanceError,
    isPending: governancePending,
  } = useTurnPolicyAlertGovernanceActions({
    source: "workspace-compare",
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
    if (workspacesQuery.isLoading) {
      return;
    }

    const nextRoute = buildWorkspaceTurnPolicyCompareRoute(
      selectedWorkspaceId,
      {
        turnPolicyThreadId: threadScopeId,
      },
    );
    if (
      `${location.pathname}${location.search}` === nextRoute ||
      !selectedWorkspaceId
    ) {
      return;
    }

    navigate(nextRoute, { replace: true });
  }, [
    location.pathname,
    location.search,
    navigate,
    selectedWorkspaceId,
    threadScopeId,
    workspacesQuery.isLoading,
  ]);

  const interactiveOverviewRoute = buildWorkspaceTurnPolicyRoute(
    selectedWorkspaceId,
    {
      turnPolicyThreadId: threadScopeId,
      metricsSource: "interactive",
      source: "interactive",
    },
  );
  const automationOverviewRoute = buildWorkspaceTurnPolicySourceOverviewRoute(
    selectedWorkspaceId,
    "automation",
    {
      turnPolicyThreadId: threadScopeId,
    },
  );
  const botOverviewRoute = buildWorkspaceTurnPolicySourceOverviewRoute(
    selectedWorkspaceId,
    "bot",
    {
      turnPolicyThreadId: threadScopeId,
    },
  );
  const suppressionNotes = [
    formatAlertSuppressionNote("Interactive", interactiveMetrics),
    formatAlertSuppressionNote("Automation", automationMetrics),
    formatAlertSuppressionNote("Bot", botMetrics),
  ].filter((value): value is string => Boolean(value));
  const acknowledgementNotes = [
    formatAlertAcknowledgementNote("Interactive", interactiveMetrics),
    formatAlertAcknowledgementNote("Automation", automationMetrics),
    formatAlertAcknowledgementNote("Bot", botMetrics),
  ].filter((value): value is string => Boolean(value));
  const snoozeNotes = [
    formatAlertSnoozeNote("Interactive", interactiveMetrics),
    formatAlertSnoozeNote("Automation", automationMetrics),
    formatAlertSnoozeNote("Bot", botMetrics),
  ].filter((value): value is string => Boolean(value));
  const interactiveTopAlert = getTopTurnPolicyMetricAlert(interactiveMetrics);
  const automationTopAlert = getTopTurnPolicyMetricAlert(automationMetrics);
  const botTopAlert = getTopTurnPolicyMetricAlert(botMetrics);
  const interactiveLastHour = getRecentWindow(interactiveMetrics, "lastHour");
  const automationLastHour = getRecentWindow(automationMetrics, "lastHour");
  const botLastHour = getRecentWindow(botMetrics, "lastHour");
  const interactiveLast24Hours = getRecentWindow(
    interactiveMetrics,
    "last24Hours",
  );
  const automationLast24Hours = getRecentWindow(
    automationMetrics,
    "last24Hours",
  );
  const botLast24Hours = getRecentWindow(botMetrics, "last24Hours");

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
                id: "Source Comparison",
                message: "Source Comparison",
              })}
            </strong>
          </div>
          <div className="mode-strip__description">
            {i18n._({
              id: "Compare interactive, automation, and bot turn policy health side by side before drilling into a single source review.",
              message:
                "Compare interactive, automation, and bot turn policy health side by side before drilling into a single source review.",
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
          <Link className="ide-button ide-button--secondary" to="/workspaces">
            {i18n._({
              id: "Return to workspace overview",
              message: "Return to workspace overview",
            })}
          </Link>
          {selectedWorkspaceId ? (
            <Link
              className="ide-button ide-button--secondary"
              to={buildWorkspaceTurnPolicyHistoryRoute(selectedWorkspaceId, {
                historyRange: "90d",
                historyGranularity: "week",
                turnPolicyThreadId: threadScopeId,
              })}
            >
              {i18n._({
                id: "Open history",
                message: "Open history",
              })}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="stack-screen">
        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>
                {i18n._({
                  id: "Turn Policy Source Comparison",
                  message: "Turn Policy Source Comparison",
                })}
              </h2>
              <p>
                {i18n._({
                  id: "Use this view to compare source-specific success rates, audit coverage, alert load, and decision latency before opening an individual source review.",
                  message:
                    "Use this view to compare source-specific success rates, audit coverage, alert load, and decision latency before opening an individual source review.",
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
                  id: "Select turn policy comparison workspace",
                  message: "Select turn policy comparison workspace",
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

          {threadScopeId ? (
            <p className="config-inline-note" style={{ margin: "12px 0 0" }}>
              {i18n._({
                id: "Scoped to thread {threadId}.",
                message: "Scoped to thread {threadId}.",
                values: {
                  threadId: threadScopeId,
                },
              })}
            </p>
          ) : null}

          <ThreadWorkbenchRailHookConfigurationSection
            hookConfiguration={hookConfiguration}
            hookConfigurationError={hookConfigurationError}
            hookConfigurationLoading={hookConfigurationLoading}
          />

          <DetailGroup
            title={i18n._({
              id: "Source Health",
              message: "Source Health",
            })}
          >
            {sourceComparisonLoading ? (
              <p className="config-inline-note" style={{ margin: 0 }}>
                {i18n._({
                  id: "Loading source comparison…",
                  message: "Loading source comparison…",
                })}
              </p>
            ) : sourceComparisonError ? (
              <p className="config-inline-note" style={{ margin: 0 }}>
                {sourceComparisonError}
              </p>
            ) : (
              <>
                {suppressionNotes.length ? (
                  <div style={{ marginBottom: 12 }}>
                    {suppressionNotes.map((note) => (
                      <p
                        className="config-inline-note"
                        key={note}
                        style={{ margin: "0 0 8px" }}
                      >
                        {note}
                      </p>
                    ))}
                  </div>
                ) : null}
                {acknowledgementNotes.length ? (
                  <div style={{ marginBottom: 12 }}>
                    {acknowledgementNotes.map((note) => (
                      <p
                        className="config-inline-note"
                        key={note}
                        style={{ margin: "0 0 8px" }}
                      >
                        {note}
                      </p>
                    ))}
                  </div>
                ) : null}
                {snoozeNotes.length ? (
                  <div style={{ marginBottom: 12 }}>
                    {snoozeNotes.map((note) => (
                      <p
                        className="config-inline-note"
                        key={note}
                        style={{ margin: "0 0 8px" }}
                      >
                        {note}
                      </p>
                    ))}
                  </div>
                ) : null}
                <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
                  <ComparisonCard
                    ctaLabel={i18n._({
                      id: "Open interactive overview",
                      message: "Open interactive overview",
                    })}
                    ctaTo={interactiveOverviewRoute}
                    label={formatTurnPolicyDecisionSource("interactive")}
                    summary={interactiveMetrics}
                  />
                  <ComparisonCard
                    ctaLabel={i18n._({
                      id: "Open automation review",
                      message: "Open automation review",
                    })}
                    ctaTo={automationOverviewRoute}
                    label={formatTurnPolicyDecisionSource("automation")}
                    summary={automationMetrics}
                  />
                  <ComparisonCard
                    ctaLabel={i18n._({
                      id: "Open bot review",
                      message: "Open bot review",
                    })}
                    ctaTo={botOverviewRoute}
                    label={formatTurnPolicyDecisionSource("bot")}
                    summary={botMetrics}
                  />
                </div>

                <ComparisonDetailRow
                  automation={formatLocalizedNumber(
                    automationMetrics?.decisions.actionCounts.followUp ?? 0,
                    "0",
                  )}
                  bot={formatLocalizedNumber(
                    botMetrics?.decisions.actionCounts.followUp ?? 0,
                    "0",
                  )}
                  interactive={formatLocalizedNumber(
                    interactiveMetrics?.decisions.actionCounts.followUp ?? 0,
                    "0",
                  )}
                  label={i18n._({
                    id: "Follow-up actions",
                    message: "Follow-up actions",
                  })}
                />
                <ComparisonDetailRow
                  automation={formatLocalizedNumber(
                    automationMetrics?.decisions.skipReasonCounts
                      .duplicateFingerprint ?? 0,
                    "0",
                  )}
                  bot={formatLocalizedNumber(
                    botMetrics?.decisions.skipReasonCounts
                      .duplicateFingerprint ?? 0,
                    "0",
                  )}
                  interactive={formatLocalizedNumber(
                    interactiveMetrics?.decisions.skipReasonCounts
                      .duplicateFingerprint ?? 0,
                    "0",
                  )}
                  label={i18n._({
                    id: "Duplicate skips",
                    message: "Duplicate skips",
                  })}
                />
                <ComparisonDetailRow
                  automation={formatTurnPolicyMetricLatencyMs(
                    automationMetrics?.timings.stopDecisionLatency.p95Ms ?? -1,
                  )}
                  bot={formatTurnPolicyMetricLatencyMs(
                    botMetrics?.timings.stopDecisionLatency.p95Ms ?? -1,
                  )}
                  interactive={formatTurnPolicyMetricLatencyMs(
                    interactiveMetrics?.timings.stopDecisionLatency.p95Ms ?? -1,
                  )}
                  label={i18n._({
                    id: "Stop P95 latency",
                    message: "Stop P95 latency",
                  })}
                />
              </>
            )}
          </DetailGroup>

          <DetailGroup
            title={i18n._({
              id: "Recent Windows",
              message: "Recent Windows",
            })}
          >
            {sourceComparisonLoading ? (
              <p className="config-inline-note" style={{ margin: 0 }}>
                {i18n._({
                  id: "Waiting for recent window comparison…",
                  message: "Waiting for recent window comparison…",
                })}
              </p>
            ) : (
              <>
                <p
                  className="config-inline-note"
                  style={{ margin: "0 0 12px" }}
                >
                  {i18n._({
                    id: "Compare the last hour against the last 24 hours before drilling into a single source review.",
                    message:
                      "Compare the last hour against the last 24 hours before drilling into a single source review.",
                  })}
                </p>
                <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
                  <SignalCard
                    footer={
                      interactiveLastHour
                        ? formatTurnPolicyMetricPostStopLatencyFooter(
                            interactiveLastHour.timings
                              .postToolUseDecisionLatency.p95Ms,
                            interactiveLastHour.timings.stopDecisionLatency
                              .p95Ms,
                          )
                        : "—"
                    }
                    label={i18n._({
                      id: "Interactive last hour",
                      message: "Interactive last hour",
                    })}
                    meta={
                      interactiveLastHour
                        ? formatTurnPolicyMetricActivityMeta({
                            alerts: interactiveLastHour.alerts.total,
                            skipped: interactiveLastHour.decisions.skipped,
                          })
                        : "—"
                    }
                    value={
                      interactiveLastHour
                        ? formatTurnPolicyMetricDecisionSuccessSummary(
                            interactiveLastHour.decisions.total,
                            interactiveLastHour.decisions.actionSuccessRate,
                            interactiveLastHour.decisions.actionAttempts,
                          )
                        : "—"
                    }
                  />
                  <SignalCard
                    footer={
                      automationLastHour
                        ? formatTurnPolicyMetricPostStopLatencyFooter(
                            automationLastHour.timings
                              .postToolUseDecisionLatency.p95Ms,
                            automationLastHour.timings.stopDecisionLatency
                              .p95Ms,
                          )
                        : "—"
                    }
                    label={i18n._({
                      id: "Automation last hour",
                      message: "Automation last hour",
                    })}
                    meta={
                      automationLastHour
                        ? formatTurnPolicyMetricActivityMeta({
                            alerts: automationLastHour.alerts.total,
                            skipped: automationLastHour.decisions.skipped,
                          })
                        : "—"
                    }
                    value={
                      automationLastHour
                        ? formatTurnPolicyMetricDecisionSuccessSummary(
                            automationLastHour.decisions.total,
                            automationLastHour.decisions.actionSuccessRate,
                            automationLastHour.decisions.actionAttempts,
                          )
                        : "—"
                    }
                  />
                  <SignalCard
                    footer={
                      botLastHour
                        ? formatTurnPolicyMetricPostStopLatencyFooter(
                            botLastHour.timings.postToolUseDecisionLatency
                              .p95Ms,
                            botLastHour.timings.stopDecisionLatency.p95Ms,
                          )
                        : "—"
                    }
                    label={i18n._({
                      id: "Bot last hour",
                      message: "Bot last hour",
                    })}
                    meta={
                      botLastHour
                        ? formatTurnPolicyMetricActivityMeta({
                            alerts: botLastHour.alerts.total,
                            skipped: botLastHour.decisions.skipped,
                          })
                        : "—"
                    }
                    value={
                      botLastHour
                        ? formatTurnPolicyMetricDecisionSuccessSummary(
                            botLastHour.decisions.total,
                            botLastHour.decisions.actionSuccessRate,
                            botLastHour.decisions.actionAttempts,
                          )
                        : "—"
                    }
                  />
                </div>

                <ComparisonDetailRow
                  automation={
                    automationLast24Hours
                      ? formatTurnPolicyMetricDecisionSuccessSummary(
                          automationLast24Hours.decisions.total,
                          automationLast24Hours.decisions.actionSuccessRate,
                          automationLast24Hours.decisions.actionAttempts,
                        )
                      : "—"
                  }
                  bot={
                    botLast24Hours
                      ? formatTurnPolicyMetricDecisionSuccessSummary(
                          botLast24Hours.decisions.total,
                          botLast24Hours.decisions.actionSuccessRate,
                          botLast24Hours.decisions.actionAttempts,
                        )
                      : "—"
                  }
                  interactive={
                    interactiveLast24Hours
                      ? formatTurnPolicyMetricDecisionSuccessSummary(
                          interactiveLast24Hours.decisions.total,
                          interactiveLast24Hours.decisions.actionSuccessRate,
                          interactiveLast24Hours.decisions.actionAttempts,
                        )
                      : "—"
                  }
                  label={i18n._({
                    id: "Last 24 hours",
                    message: "Last 24 hours",
                  })}
                />
                <ComparisonDetailRow
                  automation={
                    automationLast24Hours
                      ? formatTurnPolicyMetricPostStopLatencyFooter(
                          automationLast24Hours.timings
                            .postToolUseDecisionLatency.p95Ms,
                          automationLast24Hours.timings.stopDecisionLatency
                            .p95Ms,
                        )
                      : "—"
                  }
                  bot={
                    botLast24Hours
                      ? formatTurnPolicyMetricPostStopLatencyFooter(
                          botLast24Hours.timings.postToolUseDecisionLatency
                            .p95Ms,
                          botLast24Hours.timings.stopDecisionLatency.p95Ms,
                        )
                      : "—"
                  }
                  interactive={
                    interactiveLast24Hours
                      ? formatTurnPolicyMetricPostStopLatencyFooter(
                          interactiveLast24Hours.timings
                            .postToolUseDecisionLatency.p95Ms,
                          interactiveLast24Hours.timings.stopDecisionLatency
                            .p95Ms,
                        )
                      : "—"
                  }
                  label={i18n._({
                    id: "Last 24h latency",
                    message: "Last 24h latency",
                  })}
                />
              </>
            )}
          </DetailGroup>

          <DetailGroup
            title={i18n._({
              id: "Top Alerts by Source",
              message: "Top Alerts by Source",
            })}
          >
            {sourceComparisonLoading ? (
              <p className="config-inline-note" style={{ margin: 0 }}>
                {i18n._({
                  id: "Waiting for source alert ranking…",
                  message: "Waiting for source alert ranking…",
                })}
              </p>
            ) : (
              <>
                {governancePending ? (
                  <InlineNotice
                    noticeKey="workspace-turn-policy-compare-alert-governance-pending"
                    title={i18n._({
                      id: "Applying alert governance…",
                      message: "Applying alert governance…",
                    })}
                    tone="info"
                  >
                    {i18n._({
                      id: "Updating turn policy alert governance for source comparison.",
                      message:
                        "Updating turn policy alert governance for source comparison.",
                    })}
                  </InlineNotice>
                ) : null}
                {governanceError ? (
                  <InlineNotice
                    noticeKey={`workspace-turn-policy-compare-alert-governance-error-${governanceError}`}
                    title={i18n._({
                      id: "Alert governance update failed",
                      message: "Alert governance update failed",
                    })}
                    tone="error"
                  >
                    {governanceError}
                  </InlineNotice>
                ) : null}
                <ComparisonDetailRow
                  automation={formatTopAlert(automationMetrics)}
                  bot={formatTopAlert(botMetrics)}
                  interactive={formatTopAlert(interactiveMetrics)}
                  label={i18n._({
                    id: "Highest-priority alert",
                    message: "Highest-priority alert",
                  })}
                />
                <ComparisonDetailRow
                  automation={formatTopAlertMeta(automationMetrics)}
                  bot={formatTopAlertMeta(botMetrics)}
                  interactive={formatTopAlertMeta(interactiveMetrics)}
                  label={i18n._({
                    id: "Alert detail",
                    message: "Alert detail",
                  })}
                />
                <p className="config-inline-note" style={{ margin: "12px 0" }}>
                  {i18n._({
                    id: "Quick actions target the current top alert for each source.",
                    message:
                      "Quick actions target the current top alert for each source.",
                  })}
                </p>
                <TopAlertGovernanceRow
                  alert={interactiveTopAlert}
                  isPending={governancePending}
                  onGovernanceAction={(type, code) =>
                    applyAlertGovernanceAction({ type, code })
                  }
                  sourceLabel={formatTurnPolicyDecisionSource("interactive")}
                  summary={interactiveMetrics}
                />
                <TopAlertGovernanceRow
                  alert={automationTopAlert}
                  isPending={governancePending}
                  onGovernanceAction={(type, code) =>
                    applyAlertGovernanceAction({ type, code })
                  }
                  sourceLabel={formatTurnPolicyDecisionSource("automation")}
                  summary={automationMetrics}
                />
                <TopAlertGovernanceRow
                  alert={botTopAlert}
                  isPending={governancePending}
                  onGovernanceAction={(type, code) =>
                    applyAlertGovernanceAction({ type, code })
                  }
                  sourceLabel={formatTurnPolicyDecisionSource("bot")}
                  summary={botMetrics}
                />
              </>
            )}
          </DetailGroup>
        </section>
      </div>
    </section>
  );
}
