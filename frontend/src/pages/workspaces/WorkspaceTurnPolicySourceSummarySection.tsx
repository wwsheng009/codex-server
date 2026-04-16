import { Link } from "react-router-dom";

import { DetailGroup } from "../../components/ui/DetailGroup";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { LoadingState } from "../../components/ui/LoadingState";
import { i18n } from "../../i18n/runtime";
import {
  formatTurnPolicyAlertAcknowledgementNote,
  formatTurnPolicyAlertCode,
  formatTurnPolicyAlertGovernanceAction,
  formatTurnPolicyAlertSuppressionNote,
  formatTurnPolicyAlertSnoozeNote,
  formatTurnPolicyAlertTitle,
  formatTurnPolicyCoverageDefinition,
  formatTurnPolicyDecisionSource,
  formatTurnPolicyMetricActivityMeta,
  formatTurnPolicyMetricLatencyRange,
  formatTurnPolicyMetricPostStopLatencyFooter,
  formatTurnPolicyMetricRate,
  formatTurnPolicyMetricSuccessValue,
  getTurnPolicyMetricAlerts,
  getTurnPolicyAlertAcknowledgementSummary,
  getTurnPolicyAlertSnoozeSummary,
  getTurnPolicyAlertSuppressionSummary,
  isTurnPolicyAlertAcknowledged,
  type TurnPolicyAlertSnoozeSummary as AlertSnoozeSummary,
} from "../../lib/turn-policy-display";
import type {
  TurnPolicyMetricAlert,
  TurnPolicyMetricsSummary,
  Workspace,
} from "../../types/api";
import type { WorkspaceTurnPolicyDecisionFilters } from "./useWorkspaceTurnPolicyRecentDecisions";
import { useTurnPolicyAlertGovernanceActions } from "./useTurnPolicyAlertGovernanceActions";

type SourceType = "automation" | "bot";

export type WorkspaceTurnPolicySourceSummarySectionProps = {
  source: SourceType;
  selectedWorkspace?: Workspace | null;
  turnPolicyMetrics?: TurnPolicyMetricsSummary | null;
  turnPolicyMetricsError?: string | null;
  turnPolicyMetricsLoading: boolean;
  onDrillDown?: (filters: WorkspaceTurnPolicyDecisionFilters) => void;
  ctaTo?: string;
  ctaLabel?: string;
};

type DrillDownFilters = Pick<
  WorkspaceTurnPolicyDecisionFilters,
  "action" | "actionStatus" | "policyName" | "reason" | "source"
>;

type RecentWindowSummary = {
  key: string;
  label: string;
  actionAttempts: number;
  actionSucceeded: number;
  actionSuccessRate: number;
  alerts: number;
  total: number;
  postToolUseP95Ms: number;
  skipped: number;
  stopDecisionP95Ms: number;
};

type TurnPolicyMetricsWithRecentWindows = TurnPolicyMetricsSummary & {
  recentWindows?: {
    lastHour?: unknown;
    last24Hours?: unknown;
    windows?: unknown[];
  } | null;
  alertPolicy?: {
    acknowledgedCodes?: unknown;
    acknowledgedCount?: unknown;
    suppressedCodes?: unknown;
    suppressedCount?: unknown;
    snoozedCodes?: unknown;
    snoozedCount?: unknown;
    snoozeUntil?: unknown;
  } | null;
};

function isSnoozedAlert(
  alert: TurnPolicyMetricAlert,
  alertSnoozeSummary: AlertSnoozeSummary | null,
) {
  if (!alertSnoozeSummary) {
    return false;
  }

  return alertSnoozeSummary.snoozedCodes.includes(alert.code);
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readRecentWindowSummary(
  rawWindow: unknown,
  key: string,
  label: string,
): RecentWindowSummary | null {
  if (!rawWindow || typeof rawWindow !== "object") {
    return null;
  }

  const windowRecord = rawWindow as Record<string, unknown>;
  const decisions =
    typeof windowRecord.decisions === "object" && windowRecord.decisions
      ? (windowRecord.decisions as Record<string, unknown>)
      : {};
  const timings =
    typeof windowRecord.timings === "object" && windowRecord.timings
      ? (windowRecord.timings as Record<string, unknown>)
      : {};
  const postToolUseDecisionLatency =
    typeof timings.postToolUseDecisionLatency === "object" &&
    timings.postToolUseDecisionLatency
      ? (timings.postToolUseDecisionLatency as Record<string, unknown>)
      : {};
  const stopDecisionLatency =
    typeof timings.stopDecisionLatency === "object" &&
    timings.stopDecisionLatency
      ? (timings.stopDecisionLatency as Record<string, unknown>)
      : {};

  const total = readNumber(decisions.total ?? windowRecord.total);
  const actionAttempts = readNumber(
    decisions.actionAttempts ?? windowRecord.actionAttempts,
  );
  const actionSucceeded = readNumber(
    decisions.actionSucceeded ?? windowRecord.actionSucceeded,
  );
  const actionSuccessRate = readNumber(
    decisions.actionSuccessRate ?? windowRecord.actionSuccessRate,
  );
  const skipped = readNumber(
    decisions.actionStatusCounts &&
      typeof decisions.actionStatusCounts === "object"
      ? (decisions.actionStatusCounts as Record<string, unknown>).skipped
      : windowRecord.skipped,
  );
  const alerts = readNumber(
    windowRecord.alertCount ?? windowRecord.alertsCount ?? windowRecord.alerts,
  );

  return {
    key,
    label,
    actionAttempts,
    actionSucceeded,
    actionSuccessRate,
    alerts,
    total,
    postToolUseP95Ms: readNumber(
      postToolUseDecisionLatency.p95Ms ?? windowRecord.postToolUseLatencyP95Ms,
    ),
    skipped,
    stopDecisionP95Ms: readNumber(
      stopDecisionLatency.p95Ms ?? windowRecord.stopDecisionLatencyP95Ms,
    ),
  };
}

function getRecentWindows(
  turnPolicyMetrics?: TurnPolicyMetricsSummary | null,
): RecentWindowSummary[] {
  const recentWindows = (
    turnPolicyMetrics as TurnPolicyMetricsWithRecentWindows | null | undefined
  )?.recentWindows;
  if (!recentWindows || typeof recentWindows !== "object") {
    return [];
  }

  const windows: RecentWindowSummary[] = [];
  const recentWindowsRecord = recentWindows as Record<string, unknown>;
  const lastHour = readRecentWindowSummary(
    recentWindowsRecord.lastHour,
    "lastHour",
    i18n._({
      id: "Last hour",
      message: "Last hour",
    }),
  );
  const last24Hours = readRecentWindowSummary(
    recentWindowsRecord.last24Hours,
    "last24Hours",
    i18n._({
      id: "Last 24 hours",
      message: "Last 24 hours",
    }),
  );
  if (lastHour) {
    windows.push(lastHour);
  }
  if (last24Hours) {
    windows.push(last24Hours);
  }

  return windows;
}

function hasAlertDrillDown(alert: TurnPolicyMetricAlert) {
  return Boolean(
    alert.source?.trim() || alert.actionStatus?.trim() || alert.reason?.trim(),
  );
}

function StatCard({
  label,
  value,
  meta,
  footer,
  onDrillDown,
  drillDownAriaLabel,
}: {
  label: string;
  value: string | number;
  meta?: string;
  footer?: string;
  onDrillDown?: () => void;
  drillDownAriaLabel?: string;
}) {
  const content = (
    <>
      <span className="detail-stat__label">{label}</span>
      <strong className="detail-stat__value">{value}</strong>
      {meta ? <span className="detail-stat__meta">{meta}</span> : null}
      {footer ? <span className="detail-stat__footer">{footer}</span> : null}
    </>
  );

  if (!onDrillDown) {
    return <article className="detail-stat">{content}</article>;
  }

  return (
    <button
      aria-label={drillDownAriaLabel}
      className="detail-stat"
      onClick={onDrillDown}
      style={{
        background: "transparent",
        border: "none",
        color: "inherit",
        cursor: "pointer",
        padding: 0,
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      {content}
    </button>
  );
}

function DetailRow({
  label,
  value,
  onDrillDown,
  drillDownAriaLabel,
}: {
  label: string;
  value: string | number;
  onDrillDown?: () => void;
  drillDownAriaLabel?: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
    </>
  );

  if (!onDrillDown) {
    return <div className="detail-row">{content}</div>;
  }

  return (
    <button
      aria-label={drillDownAriaLabel}
      className="detail-row"
      onClick={onDrillDown}
      style={{
        background: "transparent",
        border: "none",
        color: "inherit",
        cursor: "pointer",
        padding: 0,
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      {content}
    </button>
  );
}

function AlertRow({
  alert,
  alertSnoozeSummary,
  governancePending,
  onDrillDown,
  onGovernanceAction,
}: {
  alert: TurnPolicyMetricAlert;
  alertSnoozeSummary: AlertSnoozeSummary | null;
  governancePending: boolean;
  onDrillDown?: () => void;
  onGovernanceAction: (
    type: "acknowledge" | "clearAcknowledgement" | "snooze24h" | "clearSnooze",
    code: string,
  ) => void;
}) {
  const acknowledged = isTurnPolicyAlertAcknowledged(alert);
  const snoozed = isSnoozedAlert(alert, alertSnoozeSummary);
  const acknowledgementAction = acknowledged
    ? "clearAcknowledgement"
    : "acknowledge";
  const snoozeAction = snoozed ? "clearSnooze" : "snooze24h";
  const content = (
    <div
      style={{
        alignItems: "flex-start",
        display: "grid",
        gap: 4,
        justifyItems: "flex-start",
        width: "100%",
      }}
    >
      <strong>{formatTurnPolicyAlertTitle(alert)}</strong>
      <span className="config-inline-note" style={{ margin: 0 }}>
        {alert.message}
      </span>
      <span className="config-inline-note" style={{ margin: 0 }}>
        <span title={alert.code}>{formatTurnPolicyAlertCode(alert.code)}</span>
      </span>
    </div>
  );

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
      {onDrillDown ? (
        <button
          aria-label={`Inspect source alert ${alert.title}`}
          onClick={onDrillDown}
          style={{
            background: "transparent",
            border: "none",
            color: "inherit",
            cursor: "pointer",
            padding: 0,
            textAlign: "left",
            width: "100%",
          }}
          type="button"
        >
          {content}
        </button>
      ) : (
        content
      )}
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
          disabled={governancePending}
          onClick={() => onGovernanceAction(acknowledgementAction, alert.code)}
          type="button"
        >
          {formatTurnPolicyAlertGovernanceAction(acknowledgementAction)}
        </button>
        <button
          disabled={governancePending}
          onClick={() => onGovernanceAction(snoozeAction, alert.code)}
          type="button"
        >
          {formatTurnPolicyAlertGovernanceAction(snoozeAction)}
        </button>
      </div>
    </div>
  );
}

export function WorkspaceTurnPolicySourceSummarySection({
  source,
  selectedWorkspace,
  turnPolicyMetrics,
  turnPolicyMetricsError,
  turnPolicyMetricsLoading,
  onDrillDown,
  ctaTo,
  ctaLabel,
}: WorkspaceTurnPolicySourceSummarySectionProps) {
  const sourceLabel = formatTurnPolicyDecisionSource(source);
  const alerts = getTurnPolicyMetricAlerts(turnPolicyMetrics, { limit: 4 });
  const topAlert = alerts[0];
  const remainingAlerts = topAlert ? alerts.slice(1) : alerts;
  const recentWindows = getRecentWindows(turnPolicyMetrics);
  const alertAcknowledgementSummary =
    getTurnPolicyAlertAcknowledgementSummary(turnPolicyMetrics);
  const alertAcknowledgementNote = formatTurnPolicyAlertAcknowledgementNote(
    alertAcknowledgementSummary,
  );
  const alertSuppressionSummary =
    getTurnPolicyAlertSuppressionSummary(turnPolicyMetrics);
  const alertSuppressionNote = formatTurnPolicyAlertSuppressionNote(
    alertSuppressionSummary,
  );
  const alertSnoozeSummary = getTurnPolicyAlertSnoozeSummary(turnPolicyMetrics);
  const alertSnoozeNote = formatTurnPolicyAlertSnoozeNote(alertSnoozeSummary);
  const {
    applyAlertGovernanceAction,
    error: governanceError,
    isPending: governancePending,
  } = useTurnPolicyAlertGovernanceActions({
    source: "workspace-source-summary",
  });

  function handleDrillDown(filters: DrillDownFilters) {
    onDrillDown?.({
      action: "",
      actionStatus: "",
      policyName: "",
      reason: "",
      source,
      ...filters,
    });
  }

  return (
    <DetailGroup
      title={i18n._({
        id: "{source} Turn Policy Summary",
        message: "{source} Turn Policy Summary",
        values: {
          source: sourceLabel,
        },
      })}
    >
      {turnPolicyMetricsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: "Loading {source} turn policy metrics…",
              message: "Loading {source} turn policy metrics…",
              values: {
                source: sourceLabel.toLowerCase(),
              },
            })}
          />
        </div>
      ) : turnPolicyMetricsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`workspace-turn-policy-source-metrics-${source}-${turnPolicyMetricsError}`}
            title={i18n._({
              id: "{source} turn policy metrics unavailable",
              message: "{source} turn policy metrics unavailable",
              values: {
                source: sourceLabel,
              },
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
              id: "Select a workspace to inspect source-scoped turn policy metrics.",
              message:
                "Select a workspace to inspect source-scoped turn policy metrics.",
            })}
          </p>
        </div>
      ) : !turnPolicyMetrics ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "No source-scoped turn policy metrics are available yet.",
              message:
                "No source-scoped turn policy metrics are available yet.",
            })}
          </p>
        </div>
      ) : (
        <>
          <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
            {i18n._({
              id: "Focused on {source} decisions for {workspace}.",
              message: "Focused on {source} decisions for {workspace}.",
              values: {
                source: sourceLabel.toLowerCase(),
                workspace: selectedWorkspace.name,
              },
            })}
          </p>
          {topAlert ? (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {i18n._({
                  id: "Top Alert",
                  message: "Top Alert",
                })}
              </p>
              {governancePending ? (
                <InlineNotice
                  noticeKey={`workspace-turn-policy-source-alert-governance-pending-${source}`}
                  title={i18n._({
                    id: "Applying alert governance…",
                    message: "Applying alert governance…",
                  })}
                  tone="info"
                >
                  {i18n._({
                    id: "Updating turn policy alert governance for this source view.",
                    message:
                      "Updating turn policy alert governance for this source view.",
                  })}
                </InlineNotice>
              ) : null}
              {governanceError ? (
                <InlineNotice
                  noticeKey={`workspace-turn-policy-source-alert-governance-error-${source}-${governanceError}`}
                  title={i18n._({
                    id: "Alert governance update failed",
                    message: "Alert governance update failed",
                  })}
                  tone="error"
                >
                  {governanceError}
                </InlineNotice>
              ) : null}
              <AlertRow
                alert={topAlert}
                alertSnoozeSummary={alertSnoozeSummary}
                governancePending={governancePending}
                onDrillDown={
                  hasAlertDrillDown(topAlert)
                    ? () =>
                        handleDrillDown({
                          actionStatus: topAlert.actionStatus?.trim() ?? "",
                          reason: topAlert.reason?.trim() ?? "",
                          source,
                        })
                    : undefined
                }
                onGovernanceAction={(type, code) =>
                  applyAlertGovernanceAction({ type, code })
                }
              />
            </>
          ) : null}
          {alertSuppressionNote ? (
            <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
              {alertSuppressionNote}
            </p>
          ) : null}
          {alertAcknowledgementNote ? (
            <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
              {alertAcknowledgementNote}
            </p>
          ) : null}
          {alertSnoozeNote ? (
            <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
              {alertSnoozeNote}
            </p>
          ) : null}
          {remainingAlerts.length ? (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {i18n._({
                  id: "Attention Needed",
                  message: "Attention Needed",
                })}
              </p>
              {remainingAlerts.map((alert) => (
                <AlertRow
                  alert={alert}
                  alertSnoozeSummary={alertSnoozeSummary}
                  governancePending={governancePending}
                  key={alert.code}
                  onDrillDown={
                    hasAlertDrillDown(alert)
                      ? () =>
                          handleDrillDown({
                            actionStatus: alert.actionStatus?.trim() ?? "",
                            reason: alert.reason?.trim() ?? "",
                            source: source,
                          })
                      : undefined
                  }
                  onGovernanceAction={(type, code) =>
                    applyAlertGovernanceAction({ type, code })
                  }
                />
              ))}
            </>
          ) : null}
          {recentWindows.length ? (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {i18n._({
                  id: "Recent Windows",
                  message: "Recent Windows",
                })}
              </p>
              <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
                {recentWindows.map((window) => (
                  <StatCard
                    footer={formatTurnPolicyMetricPostStopLatencyFooter(
                      window.postToolUseP95Ms,
                      window.stopDecisionP95Ms,
                    )}
                    key={window.key}
                    label={window.label}
                    meta={formatTurnPolicyMetricActivityMeta({
                      total: window.total,
                      alerts: window.alerts,
                      skipped: window.skipped,
                    })}
                    value={formatTurnPolicyMetricSuccessValue(
                      window.actionSuccessRate,
                      window.actionSucceeded,
                      window.actionAttempts,
                      { includeSuccessLabel: true },
                    )}
                  />
                ))}
              </div>
            </>
          ) : null}
          <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
            <StatCard
              label={i18n._({
                id: "Decisions",
                message: "Decisions",
              })}
              meta={i18n._({
                id: "Recorded source audits",
                message: "Recorded source audits",
              })}
              value={turnPolicyMetrics.decisions.total}
            />
            <StatCard
              drillDownAriaLabel={`Inspect ${source} action success decisions`}
              label={i18n._({
                id: "Action success",
                message: "Action success",
              })}
              meta={i18n._({
                id: "Successful actions",
                message: "Successful actions",
              })}
              onDrillDown={() =>
                handleDrillDown({
                  actionStatus: "succeeded",
                })
              }
              value={formatTurnPolicyMetricSuccessValue(
                turnPolicyMetrics.decisions.actionSuccessRate,
                turnPolicyMetrics.decisions.actionSucceeded,
                turnPolicyMetrics.decisions.actionAttempts,
              )}
            />
            <StatCard
              label={i18n._({
                id: "Audit Coverage",
                message: "Audit Coverage",
              })}
              meta={i18n._({
                id: "Eligible turns",
                message: "Eligible turns",
              })}
              footer={`${turnPolicyMetrics.audit.coveredTurns} / ${turnPolicyMetrics.audit.eligibleTurns}`}
              value={formatTurnPolicyMetricRate(
                turnPolicyMetrics.audit.coverageRate,
                turnPolicyMetrics.audit.eligibleTurns,
              )}
            />
            <StatCard
              drillDownAriaLabel={`Inspect ${source} skipped decisions`}
              label={i18n._({
                id: "Skipped decisions",
                message: "Skipped decisions",
              })}
              meta={i18n._({
                id: "Action status: skipped",
                message: "Action status: skipped",
              })}
              onDrillDown={() =>
                handleDrillDown({
                  actionStatus: "skipped",
                })
              }
              value={turnPolicyMetrics.decisions.actionStatusCounts.skipped}
            />
          </div>
          <DetailRow
            drillDownAriaLabel={`Inspect ${source} steer actions`}
            label={i18n._({
              id: "Steer actions",
              message: "Steer actions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                action: "steer",
              })
            }
            value={turnPolicyMetrics.decisions.actionCounts.steer}
          />
          <DetailRow
            drillDownAriaLabel={`Inspect ${source} follow-up actions`}
            label={i18n._({
              id: "Follow-up actions",
              message: "Follow-up actions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                action: "followUp",
              })
            }
            value={turnPolicyMetrics.decisions.actionCounts.followUp}
          />
          <DetailRow
            drillDownAriaLabel={`Inspect ${source} duplicate skips`}
            label={i18n._({
              id: "Duplicate skips",
              message: "Duplicate skips",
            })}
            onDrillDown={() =>
              handleDrillDown({
                actionStatus: "skipped",
                reason: "duplicate_fingerprint",
              })
            }
            value={
              turnPolicyMetrics.decisions.skipReasonCounts.duplicateFingerprint
            }
          />
          <DetailRow
            drillDownAriaLabel={`Inspect ${source} cooldown skips`}
            label={i18n._({
              id: "Cooldown skips",
              message: "Cooldown skips",
            })}
            onDrillDown={() =>
              handleDrillDown({
                actionStatus: "skipped",
                reason: "follow_up_cooldown_active",
              })
            }
            value={
              turnPolicyMetrics.decisions.skipReasonCounts
                .followUpCooldownActive
            }
          />
          <DetailRow
            drillDownAriaLabel={`Inspect ${source} interrupt skips`}
            label={i18n._({
              id: "Interrupt skips",
              message: "Interrupt skips",
            })}
            onDrillDown={() =>
              handleDrillDown({
                actionStatus: "skipped",
                reason: "interrupt_no_active_turn",
              })
            }
            value={
              (
                turnPolicyMetrics.decisions.skipReasonCounts as {
                  interruptNoActiveTurn?: number;
                }
              ).interruptNoActiveTurn ?? 0
            }
          />
          <DetailRow
            label={i18n._({
              id: "Post-tool-use latency",
              message: "Post-tool-use latency",
            })}
            value={formatTurnPolicyMetricLatencyRange(
              turnPolicyMetrics.timings.postToolUseDecisionLatency.p50Ms,
              turnPolicyMetrics.timings.postToolUseDecisionLatency.p95Ms,
            )}
          />
          <DetailRow
            label={i18n._({
              id: "Stop decision latency",
              message: "Stop decision latency",
            })}
            value={formatTurnPolicyMetricLatencyRange(
              turnPolicyMetrics.timings.stopDecisionLatency.p50Ms,
              turnPolicyMetrics.timings.stopDecisionLatency.p95Ms,
            )}
          />
          {ctaTo ? (
            <div
              className="pane-section-content"
              style={{ padding: "12px 0 0" }}
            >
              <Link
                className="ide-button ide-button--secondary ide-button--sm"
                to={ctaTo}
              >
                {ctaLabel ??
                  i18n._({
                    id: "Open source decisions",
                    message: "Open source decisions",
                  })}
              </Link>
            </div>
          ) : null}
          {turnPolicyMetrics.audit.coverageDefinitionKey ||
          turnPolicyMetrics.audit.coverageDefinition ? (
            <p className="config-inline-note" style={{ margin: "12px 0 0" }}>
              {formatTurnPolicyCoverageDefinition(
                turnPolicyMetrics.audit.coverageDefinitionKey,
                turnPolicyMetrics.audit.coverageDefinition,
              )}
            </p>
          ) : null}
        </>
      )}
    </DetailGroup>
  );
}
