import { Link, useLocation } from "react-router-dom";

import { DetailGroup } from "../../components/ui/DetailGroup";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { LoadingState } from "../../components/ui/LoadingState";
import {
  formatLocalizedDateTime,
  formatLocalizedNumber,
} from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import {
  activateGovernanceSettingsTab,
  GOVERNANCE_SETTINGS_PATH,
} from "../../features/settings/governanceNavigation";
import {
  formatTurnPolicyAlertAcknowledgementNote,
  formatTurnPolicyAlertCode,
  formatTurnPolicyAlertGovernanceAction,
  formatTurnPolicyAlertSnoozeNote,
  formatTurnPolicyAlertSuppressionNote,
  formatTurnPolicyAlertTitle,
  formatTurnPolicyDecisionAction,
  formatTurnPolicyInterruptNoActiveTurnBehavior,
  formatTurnPolicyMetricAlertCount,
  formatTurnPolicyMetricHealthMeta,
  formatTurnPolicyMetricCoverageLatencyFooter,
  formatTurnPolicyMetricDecisionCount,
  formatTurnPolicyMetricDecisionSummary,
  formatTurnPolicyMetricLatencyRange,
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

export type WorkspaceTurnPolicyOverviewSectionProps = {
  metricsSourceScope?: string;
  onDrillDown?: (filters: WorkspaceTurnPolicyDecisionFilters) => void;
  selectedWorkspace?: Workspace | null;
  turnPolicyMetrics?: TurnPolicyMetricsSummary | null;
  turnPolicyMetricsError?: string | null;
  turnPolicyMetricsLoading: boolean;
  turnPolicySourceHealth?: {
    automation?: TurnPolicyMetricsSummary;
    bot?: TurnPolicyMetricsSummary;
    loading: boolean;
    error: string | null;
  };
};

type DrillDownFilters = Pick<
  WorkspaceTurnPolicyDecisionFilters,
  "action" | "actionStatus" | "policyName" | "reason" | "source"
>;

type SourceMetricsKey = keyof TurnPolicyMetricsSummary["sources"];
type SourceMetricsSummary = TurnPolicyMetricsSummary["sources"]["interactive"];
type TurnPolicyMetricsWithAlerts = TurnPolicyMetricsSummary & {
  alerts?: TurnPolicyMetricAlert[] | null;
  config?: Record<string, unknown> | null;
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

const EMPTY_SOURCE_METRICS: SourceMetricsSummary = {
  total: 0,
  actionAttempts: 0,
  actionSucceeded: 0,
  actionSuccessRate: 0,
  skipped: 0,
};

function formatSourceDecisionSummary(summary: SourceMetricsSummary) {
  return formatTurnPolicyMetricDecisionSummary(
    summary.total,
    summary.actionSuccessRate,
    summary.actionAttempts,
    summary.skipped,
    { zeroOnly: true },
  );
}

function formatSourceFocusDecisionCount(summary: SourceMetricsSummary) {
  return formatTurnPolicyMetricDecisionCount(summary.total);
}

function formatSourceFocusSuccess(summary: SourceMetricsSummary) {
  return formatTurnPolicyMetricSuccessValue(
    summary.actionSuccessRate,
    summary.actionSucceeded,
    summary.actionAttempts,
    { includeSuccessLabel: true },
  );
}

function formatSourceHealthValue(summary: TurnPolicyMetricsSummary) {
  return formatTurnPolicyMetricSuccessValue(
    summary.decisions.actionSuccessRate,
    summary.decisions.actionSucceeded,
    summary.decisions.actionAttempts,
    {
      includeSuccessLabel: true,
      noActionAttemptsLabel: true,
    },
  );
}

function formatSourceHealthMeta(summary: TurnPolicyMetricsSummary) {
  return formatTurnPolicyMetricHealthMeta({
    total: summary.decisions.total,
    skipped: summary.decisions.actionStatusCounts.skipped,
    alerts: getTurnPolicyMetricAlerts(summary).length,
  });
}

function formatSourceHealthFooter(summary: TurnPolicyMetricsSummary) {
  return formatTurnPolicyMetricCoverageLatencyFooter(
    summary.audit.coverageRate,
    summary.audit.eligibleTurns,
    {
      postLatencyMs: summary.timings.postToolUseDecisionLatency.p95Ms,
      stopLatencyMs: summary.timings.stopDecisionLatency.p95Ms,
      omitEmptyLatencies: true,
    },
  );
}

type TurnPolicyRuntimeConfig = {
  followUpCooldownMs?: number;
  postToolUseFollowUpCooldownMs?: number;
  postToolUseEnabled?: boolean;
  postToolUsePrimaryAction?: string;
  postToolUseInterruptNoActiveTurnBehavior?: string;
  stopMissingSuccessfulVerificationFollowUpCooldownMs?: number;
  stopMissingVerificationEnabled?: boolean;
  stopMissingVerificationPrimaryAction?: string;
  stopMissingVerificationInterruptNoActiveTurnBehavior?: string;
};

function readBooleanConfigValue(value: unknown) {
  return typeof value === "boolean" ? value : undefined;
}

function readNumberConfigValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readPrimaryActionConfigValue(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (
    normalized === "steer" ||
    normalized === "followUp" ||
    normalized === "interrupt"
  ) {
    return normalized;
  }
  return undefined;
}

function readInterruptNoActiveTurnBehaviorConfigValue(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (normalized === "skip" || normalized === "followUp") {
    return normalized;
  }
  return undefined;
}

function getTurnPolicyRuntimeConfig(
  turnPolicyMetrics?: TurnPolicyMetricsSummary | null,
): TurnPolicyRuntimeConfig | null {
  const rawConfig = (
    turnPolicyMetrics as TurnPolicyMetricsWithAlerts | null | undefined
  )?.config;
  if (!rawConfig || typeof rawConfig !== "object") {
    return null;
  }

  const config = rawConfig as Record<string, unknown>;
  const normalized: TurnPolicyRuntimeConfig = {
    postToolUseEnabled:
      readBooleanConfigValue(config.postToolUsePolicyEnabled) ??
      readBooleanConfigValue(config.postToolUseFailedValidationPolicyEnabled) ??
      readBooleanConfigValue(config.postToolUseEnabled),
    postToolUsePrimaryAction:
      readPrimaryActionConfigValue(config.postToolUsePrimaryAction) ??
      readPrimaryActionConfigValue(
        config.postToolUseFailedValidationPrimaryAction,
      ),
    postToolUseInterruptNoActiveTurnBehavior:
      readInterruptNoActiveTurnBehaviorConfigValue(
        config.postToolUseInterruptNoActiveTurnBehavior,
      ) ??
      readInterruptNoActiveTurnBehaviorConfigValue(
        config.postToolUseInterruptNoActiveTurnAction,
      ),
    stopMissingVerificationEnabled:
      readBooleanConfigValue(config.stopMissingVerificationPolicyEnabled) ??
      readBooleanConfigValue(
        config.stopMissingSuccessfulVerificationPolicyEnabled,
      ) ??
      readBooleanConfigValue(config.stopMissingVerificationEnabled),
    stopMissingVerificationPrimaryAction:
      readPrimaryActionConfigValue(
        config.stopMissingVerificationPrimaryAction,
      ) ??
      readPrimaryActionConfigValue(
        config.stopMissingSuccessfulVerificationPrimaryAction,
      ),
    stopMissingVerificationInterruptNoActiveTurnBehavior:
      readInterruptNoActiveTurnBehaviorConfigValue(
        config.stopMissingVerificationInterruptNoActiveTurnBehavior,
      ) ??
      readInterruptNoActiveTurnBehaviorConfigValue(
        config.stopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior,
      ),
    postToolUseFollowUpCooldownMs:
      readNumberConfigValue(config.postToolUseFollowUpCooldownMs) ??
      readNumberConfigValue(
        config.postToolUseFailedValidationFollowUpCooldownMs,
      ),
    stopMissingSuccessfulVerificationFollowUpCooldownMs:
      readNumberConfigValue(
        config.stopMissingSuccessfulVerificationFollowUpCooldownMs,
      ) ??
      readNumberConfigValue(config.stopMissingVerificationFollowUpCooldownMs),
    followUpCooldownMs:
      readNumberConfigValue(config.followUpCooldownMs) ??
      readNumberConfigValue(config.followUpCooldownMilliseconds),
  };

  if (
    typeof normalized.postToolUseEnabled !== "boolean" &&
    typeof normalized.stopMissingVerificationEnabled !== "boolean" &&
    typeof normalized.followUpCooldownMs !== "number" &&
    typeof normalized.postToolUseFollowUpCooldownMs !== "number" &&
    typeof normalized.postToolUsePrimaryAction !== "string" &&
    typeof normalized.postToolUseInterruptNoActiveTurnBehavior !== "string" &&
    typeof normalized.stopMissingSuccessfulVerificationFollowUpCooldownMs !==
      "number" &&
    typeof normalized.stopMissingVerificationPrimaryAction !== "string" &&
    typeof normalized.stopMissingVerificationInterruptNoActiveTurnBehavior !==
      "string"
  ) {
    return null;
  }

  return normalized;
}

function formatPolicyToggleLabel(enabled: boolean | undefined) {
  if (typeof enabled !== "boolean") {
    return "—";
  }

  return enabled
    ? i18n._({
        id: "Enabled",
        message: "Enabled",
      })
    : i18n._({
        id: "Disabled",
        message: "Disabled",
      });
}

function formatCooldownValue(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return "—";
  }

  if (value >= 60_000 && value % 60_000 === 0) {
    const minutes = value / 60_000;
    return i18n._({
      id: "{minutes} min",
      message: "{minutes} min",
      values: { minutes: formatLocalizedNumber(minutes, "0") },
    });
  }

  if (value >= 1_000 && value % 1_000 === 0) {
    const seconds = value / 1_000;
    return i18n._({
      id: "{seconds} s",
      message: "{seconds} s",
      values: { seconds: formatLocalizedNumber(seconds, "0") },
    });
  }

  return `${formatLocalizedNumber(Math.round(value), "0")} ms`;
}

function getSourceMetrics(
  turnPolicyMetrics: TurnPolicyMetricsSummary,
  source: SourceMetricsKey,
) {
  return turnPolicyMetrics.sources[source] ?? EMPTY_SOURCE_METRICS;
}

function formatSourceScopeLabel(source: string) {
  switch (source.trim()) {
    case "interactive":
      return i18n._({
        id: "interactive",
        message: "interactive",
      });
    case "automation":
      return i18n._({
        id: "automation",
        message: "automation",
      });
    case "bot":
      return i18n._({
        id: "bot",
        message: "bot",
      });
    default:
      return source.trim();
  }
}

function isSnoozedAlert(
  alert: TurnPolicyMetricAlert,
  alertSnoozeSummary: AlertSnoozeSummary | null,
) {
  if (!alertSnoozeSummary) {
    return false;
  }

  return alertSnoozeSummary.snoozedCodes.includes(alert.code);
}

function getSourceAlertCount(
  turnPolicyMetrics: TurnPolicyMetricsSummary | null | undefined,
  source: "automation" | "bot",
) {
  return getTurnPolicyMetricAlerts(turnPolicyMetrics).filter(
    (alert) => alert.source?.trim() === source,
  ).length;
}

function hasAlertDrillDown(alert: TurnPolicyMetricAlert) {
  return Boolean(
    alert.source?.trim() || alert.actionStatus?.trim() || alert.reason?.trim(),
  );
}

function StatCard({
  drillDownAriaLabel,
  footer,
  label,
  meta,
  onDrillDown,
  value,
}: {
  drillDownAriaLabel?: string;
  footer?: string;
  label: string;
  meta?: string;
  onDrillDown?: () => void;
  value: string | number;
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
          aria-label={i18n._({
            id: "Inspect alert {title}",
            message: "Inspect alert {title}",
            values: { title: alert.title },
          })}
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

function DetailRow({
  drillDownAriaLabel,
  label,
  onDrillDown,
  value,
}: {
  drillDownAriaLabel?: string;
  label: string;
  onDrillDown?: () => void;
  value: string | number;
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

function ExecutionControlStatus({
  enabled,
}: {
  enabled: boolean | undefined;
}) {
  const label = formatPolicyToggleLabel(enabled);
  const toneClassName =
    typeof enabled !== "boolean"
      ? ""
      : enabled
        ? " workspace-execution-controls__pill--enabled"
        : " workspace-execution-controls__pill--disabled";

  return (
    <span
      className={`workspace-execution-controls__pill${toneClassName}`}
      title={label}
    >
      {label}
    </span>
  );
}

function ExecutionControlsPanel({
  runtimeConfig,
}: {
  runtimeConfig: TurnPolicyRuntimeConfig;
}) {
  const sharedSettings = [
    {
      label: i18n._({
        id: "Default follow-up cooldown",
        message: "Default follow-up cooldown",
      }),
      value: formatCooldownValue(runtimeConfig.followUpCooldownMs),
      meta: i18n._({
        id: "Used when a policy does not set its own cooldown.",
        message: "Used when a policy does not set its own cooldown.",
      }),
    },
  ];

  const policyRows = [
    {
      label: i18n._({
        id: "Policy state",
        message: "Policy state",
      }),
      postToolUse: (
        <ExecutionControlStatus enabled={runtimeConfig.postToolUseEnabled} />
      ),
      missingVerify: (
        <ExecutionControlStatus
          enabled={runtimeConfig.stopMissingVerificationEnabled}
        />
      ),
    },
    {
      label: i18n._({
        id: "Primary action",
        message: "Primary action",
      }),
      postToolUse: formatTurnPolicyDecisionAction(
        runtimeConfig.postToolUsePrimaryAction,
      ),
      missingVerify: formatTurnPolicyDecisionAction(
        runtimeConfig.stopMissingVerificationPrimaryAction,
      ),
    },
    {
      label: i18n._({
        id: "Follow-up cooldown",
        message: "Follow-up cooldown",
      }),
      postToolUse: formatCooldownValue(
        runtimeConfig.postToolUseFollowUpCooldownMs,
      ),
      missingVerify: formatCooldownValue(
        runtimeConfig.stopMissingSuccessfulVerificationFollowUpCooldownMs,
      ),
    },
    {
      label: i18n._({
        id: "Interrupt fallback",
        message: "Interrupt fallback",
      }),
      postToolUse: formatTurnPolicyInterruptNoActiveTurnBehavior(
        runtimeConfig.postToolUseInterruptNoActiveTurnBehavior,
      ),
      missingVerify: formatTurnPolicyInterruptNoActiveTurnBehavior(
        runtimeConfig.stopMissingVerificationInterruptNoActiveTurnBehavior,
      ),
    },
  ];

  return (
    <section
      aria-label={i18n._({
        id: "Execution Controls",
        message: "Execution Controls",
      })}
      className="workspace-execution-controls"
    >
      <div className="workspace-execution-controls__summary">
        {sharedSettings.map((item) => (
          <article
            className="workspace-execution-controls__setting-card"
            key={item.label}
          >
            <span className="workspace-execution-controls__setting-label">
              {item.label}
            </span>
            <strong className="workspace-execution-controls__setting-value">
              {item.value}
            </strong>
            <span className="workspace-execution-controls__setting-meta">
              {item.meta}
            </span>
          </article>
        ))}
      </div>

      <div className="workspace-execution-controls__table-viewport">
        <table className="workspace-execution-controls__table">
          <thead>
            <tr>
              <th
                className="workspace-execution-controls__header"
                scope="col"
              >
                {i18n._({
                  id: "Setting",
                  message: "Setting",
                })}
              </th>
              <th
                className="workspace-execution-controls__header"
                scope="col"
              >
                {i18n._({
                  id: "Post-tool-use",
                  message: "Post-tool-use",
                })}
              </th>
              <th
                className="workspace-execution-controls__header"
                scope="col"
              >
                {i18n._({
                  id: "Missing verify",
                  message: "Missing verify",
                })}
              </th>
            </tr>
          </thead>
          <tbody>
            {policyRows.map((row) => (
              <tr className="workspace-execution-controls__row" key={row.label}>
                <th
                  className="workspace-execution-controls__cell workspace-execution-controls__cell--label"
                  scope="row"
                >
                  {row.label}
                </th>
                <td className="workspace-execution-controls__cell">
                  {row.postToolUse}
                </td>
                <td className="workspace-execution-controls__cell">
                  {row.missingVerify}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WorkspaceTurnPolicyOverviewSection({
  metricsSourceScope,
  onDrillDown,
  selectedWorkspace,
  turnPolicyMetrics,
  turnPolicyMetricsError,
  turnPolicyMetricsLoading,
  turnPolicySourceHealth,
}: WorkspaceTurnPolicyOverviewSectionProps) {
  const location = useLocation();
  function handleDrillDown(filters: DrillDownFilters) {
    onDrillDown?.({
      action: "",
      actionStatus: "",
      policyName: "",
      reason: "",
      source: "",
      ...filters,
    });
  }

  const interactiveSourceMetrics = turnPolicyMetrics
    ? getSourceMetrics(turnPolicyMetrics, "interactive")
    : EMPTY_SOURCE_METRICS;
  const automationSourceMetrics = turnPolicyMetrics
    ? getSourceMetrics(turnPolicyMetrics, "automation")
    : EMPTY_SOURCE_METRICS;
  const botSourceMetrics = turnPolicyMetrics
    ? getSourceMetrics(turnPolicyMetrics, "bot")
    : EMPTY_SOURCE_METRICS;
  const otherSourceMetrics = turnPolicyMetrics
    ? getSourceMetrics(turnPolicyMetrics, "other")
    : EMPTY_SOURCE_METRICS;
  const alerts = getTurnPolicyMetricAlerts(turnPolicyMetrics, { limit: 4 });
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
    source: "workspace-overview",
  });
  const automationAlertCount = getSourceAlertCount(
    turnPolicyMetrics,
    "automation",
  );
  const botAlertCount = getSourceAlertCount(turnPolicyMetrics, "bot");
  const runtimeConfig = getTurnPolicyRuntimeConfig(turnPolicyMetrics);
  const automationSourceHealth = turnPolicySourceHealth?.automation;
  const botSourceHealth = turnPolicySourceHealth?.bot;
  const showSourceHealthPanel =
    !metricsSourceScope?.trim() && Boolean(turnPolicySourceHealth);
  const showGovernanceLink = !location.pathname.startsWith(
    GOVERNANCE_SETTINGS_PATH,
  );

  return (
    <DetailGroup
      title={i18n._({
        id: "Workspace Turn Policy Overview",
        message: "Workspace Turn Policy Overview",
      })}
    >
      {showGovernanceLink ? (
        <div className="pane-section-content" style={{ paddingBottom: 12 }}>
          <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
            {i18n._({
              id: "Need the full governance view? Open the dedicated governance activity workspace to compare alerts, hook runs, and effective configuration in one place.",
              message:
                "Need the full governance view? Open the dedicated governance activity workspace to compare alerts, hook runs, and effective configuration in one place.",
            })}
          </p>
          <Link
            className="ide-button ide-button--secondary ide-button--sm"
            onClick={() => activateGovernanceSettingsTab("activity")}
            to={GOVERNANCE_SETTINGS_PATH}
          >
            {i18n._({
              id: "Open governance activity",
              message: "Open governance activity",
            })}
          </Link>
        </div>
      ) : null}
      {turnPolicyMetricsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: "Loading workspace turn policy metrics…",
              message: "Loading workspace turn policy metrics…",
            })}
          />
        </div>
      ) : turnPolicyMetricsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`workspace-turn-policy-metrics-${turnPolicyMetricsError}`}
            title={i18n._({
              id: "Workspace turn policy metrics unavailable",
              message: "Workspace turn policy metrics unavailable",
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
              id: "Select a workspace to inspect turn policy metrics.",
              message: "Select a workspace to inspect turn policy metrics.",
            })}
          </p>
        </div>
      ) : !turnPolicyMetrics ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "No workspace turn policy metrics are available yet.",
              message: "No workspace turn policy metrics are available yet.",
            })}
          </p>
          <Link
            className="ide-button ide-button--secondary ide-button--sm"
            to={`/workspaces/${selectedWorkspace.id}`}
          >
            {i18n._({
              id: "Open workspace",
              message: "Open workspace",
            })}
          </Link>
        </div>
      ) : (
        <>
          {metricsSourceScope?.trim() ? (
            <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
              {i18n._({
                id: "Viewing {source} source metrics only.",
                message: "Viewing {source} source metrics only.",
                values: {
                  source: formatSourceScopeLabel(metricsSourceScope),
                },
              })}
            </p>
          ) : null}
          {alerts.length ? (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {i18n._({
                  id: "Attention Needed",
                  message: "Attention Needed",
                })}
              </p>
              {governancePending ? (
                <InlineNotice
                  noticeKey="workspace-turn-policy-alert-governance-pending"
                  title={i18n._({
                    id: "Applying alert governance…",
                    message: "Applying alert governance…",
                  })}
                  tone="info"
                >
                  {i18n._({
                    id: "Updating turn policy alert governance for this workspace view.",
                    message:
                      "Updating turn policy alert governance for this workspace view.",
                  })}
                </InlineNotice>
              ) : null}
              {governanceError ? (
                <InlineNotice
                  noticeKey={`workspace-turn-policy-alert-governance-error-${governanceError}`}
                  title={i18n._({
                    id: "Alert governance update failed",
                    message: "Alert governance update failed",
                  })}
                  tone="error"
                >
                  {governanceError}
                </InlineNotice>
              ) : null}
              {alerts.map((alert) => (
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
                            source: alert.source?.trim() ?? "",
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
          <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
            {i18n._({
              id: "Source Focus",
              message: "Source Focus",
            })}
          </p>
          <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
            <StatCard
              drillDownAriaLabel="Inspect Automation source focus decisions"
              footer={formatTurnPolicyMetricAlertCount(automationAlertCount)}
              label={i18n._({
                id: "Automation focus",
                message: "Automation focus",
              })}
              meta={formatSourceFocusDecisionCount(automationSourceMetrics)}
              onDrillDown={() =>
                handleDrillDown({
                  source: "automation",
                })
              }
              value={formatSourceFocusSuccess(automationSourceMetrics)}
            />
            <StatCard
              drillDownAriaLabel="Inspect Bot source focus decisions"
              footer={formatTurnPolicyMetricAlertCount(botAlertCount)}
              label={i18n._({
                id: "Bot focus",
                message: "Bot focus",
              })}
              meta={formatSourceFocusDecisionCount(botSourceMetrics)}
              onDrillDown={() =>
                handleDrillDown({
                  source: "bot",
                })
              }
              value={formatSourceFocusSuccess(botSourceMetrics)}
            />
          </div>
          {showSourceHealthPanel ? (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 12px" }}>
                {i18n._({
                  id: "Automation & Bot Health",
                  message: "Automation & Bot Health",
                })}
              </p>
              {turnPolicySourceHealth?.loading ? (
                <p
                  className="config-inline-note"
                  style={{ margin: "0 0 12px" }}
                >
                  {i18n._({
                    id: "Loading automation and bot source summaries…",
                    message: "Loading automation and bot source summaries…",
                  })}
                </p>
              ) : null}
              {turnPolicySourceHealth?.error ? (
                <InlineNotice
                  noticeKey={`workspace-turn-policy-source-health-${turnPolicySourceHealth.error}`}
                  title={i18n._({
                    id: "Automation and bot source health unavailable",
                    message: "Automation and bot source health unavailable",
                  })}
                  tone="error"
                >
                  {turnPolicySourceHealth.error}
                </InlineNotice>
              ) : null}
              {!turnPolicySourceHealth?.loading &&
              !turnPolicySourceHealth?.error &&
              (automationSourceHealth || botSourceHealth) ? (
                <div className="detail-stat-grid" style={{ marginBottom: 12 }}>
                  {automationSourceHealth ? (
                    <StatCard
                      drillDownAriaLabel="Inspect Automation health overview"
                      footer={formatSourceHealthFooter(automationSourceHealth)}
                      label={i18n._({
                        id: "Automation health",
                        message: "Automation health",
                      })}
                      meta={formatSourceHealthMeta(automationSourceHealth)}
                      onDrillDown={() =>
                        handleDrillDown({
                          source: "automation",
                        })
                      }
                      value={formatSourceHealthValue(automationSourceHealth)}
                    />
                  ) : null}
                  {botSourceHealth ? (
                    <StatCard
                      drillDownAriaLabel="Inspect Bot health overview"
                      footer={formatSourceHealthFooter(botSourceHealth)}
                      label={i18n._({
                        id: "Bot health",
                        message: "Bot health",
                      })}
                      meta={formatSourceHealthMeta(botSourceHealth)}
                      onDrillDown={() =>
                        handleDrillDown({
                          source: "bot",
                        })
                      }
                      value={formatSourceHealthValue(botSourceHealth)}
                    />
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
          <div className="detail-stat-grid">
            <StatCard
              label={i18n._({
                id: "Decisions",
                message: "Decisions",
              })}
              meta={i18n._({
                id: "Recorded audits",
                message: "Recorded audits",
              })}
              value={turnPolicyMetrics.decisions.total}
            />
            <StatCard
              label={i18n._({
                id: "Audit Coverage",
                message: "Audit Coverage",
              })}
              footer={`${turnPolicyMetrics.audit.coveredTurns} / ${turnPolicyMetrics.audit.eligibleTurns}`}
              meta={i18n._({
                id: "Eligible turns",
                message: "Eligible turns",
              })}
              value={formatTurnPolicyMetricRate(
                turnPolicyMetrics.audit.coverageRate,
                turnPolicyMetrics.audit.eligibleTurns,
              )}
            />
            <StatCard
              drillDownAriaLabel="Inspect Validation Rescue decisions"
              label={i18n._({
                id: "Validation Rescue",
                message: "Validation Rescue",
              })}
              footer={`${turnPolicyMetrics.turns.failedValidationWithPolicyAction} / ${turnPolicyMetrics.turns.failedValidationCommand}`}
              meta={i18n._({
                id: "Failed validations remediated",
                message: "Failed validations remediated",
              })}
              onDrillDown={() =>
                handleDrillDown({
                  policyName: "posttooluse/failed-validation-command",
                  actionStatus: "succeeded",
                })
              }
              value={formatTurnPolicyMetricRate(
                turnPolicyMetrics.turns.failedValidationWithPolicyActionRate,
                turnPolicyMetrics.turns.failedValidationCommand,
              )}
            />
            <StatCard
              drillDownAriaLabel="Inspect Missing Verify decisions"
              label={i18n._({
                id: "Missing Verify",
                message: "Missing Verify",
              })}
              footer={`${turnPolicyMetrics.turns.missingSuccessfulVerification} / ${turnPolicyMetrics.turns.completedWithFileChange}`}
              meta={i18n._({
                id: "Completed file-change turns",
                message: "Completed file-change turns",
              })}
              onDrillDown={() =>
                handleDrillDown({
                  policyName: "stop/missing-successful-verification",
                })
              }
              value={formatTurnPolicyMetricRate(
                turnPolicyMetrics.turns.missingSuccessfulVerificationRate,
                turnPolicyMetrics.turns.completedWithFileChange,
              )}
            />
          </div>

          {runtimeConfig ? (
            <>
              <p
                className="config-inline-note"
                style={{ margin: "12px 0 8px" }}
              >
                {i18n._({
                  id: "Execution Controls",
                  message: "Execution Controls",
                })}
              </p>
              <ExecutionControlsPanel runtimeConfig={runtimeConfig} />
            </>
          ) : null}

          <DetailRow
            drillDownAriaLabel="Inspect Steer actions decisions"
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
            drillDownAriaLabel="Inspect Follow-up actions decisions"
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
            drillDownAriaLabel="Inspect Interrupt actions decisions"
            label={i18n._({
              id: "Interrupt actions",
              message: "Interrupt actions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                action: "interrupt",
              })
            }
            value={
              (
                turnPolicyMetrics.decisions.actionCounts as {
                  interrupt?: number;
                }
              ).interrupt ?? 0
            }
          />
          <DetailRow
            drillDownAriaLabel="Inspect Action success decisions"
            label={i18n._({
              id: "Action success",
              message: "Action success",
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
          <DetailRow
            drillDownAriaLabel="Inspect Interactive decisions"
            label={i18n._({
              id: "Interactive decisions",
              message: "Interactive decisions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                source: "interactive",
              })
            }
            value={formatSourceDecisionSummary(interactiveSourceMetrics)}
          />
          <DetailRow
            drillDownAriaLabel="Inspect Automation decisions"
            label={i18n._({
              id: "Automation decisions",
              message: "Automation decisions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                source: "automation",
              })
            }
            value={formatSourceDecisionSummary(automationSourceMetrics)}
          />
          <DetailRow
            drillDownAriaLabel="Inspect Bot decisions"
            label={i18n._({
              id: "Bot decisions",
              message: "Bot decisions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                source: "bot",
              })
            }
            value={formatSourceDecisionSummary(botSourceMetrics)}
          />
          {otherSourceMetrics.total > 0 ? (
            <DetailRow
              label={i18n._({
                id: "Other-source decisions",
                message: "Other-source decisions",
              })}
              value={formatSourceDecisionSummary(otherSourceMetrics)}
            />
          ) : null}
          <DetailRow
            drillDownAriaLabel="Inspect Skipped decisions"
            label={i18n._({
              id: "Skipped decisions",
              message: "Skipped decisions",
            })}
            onDrillDown={() =>
              handleDrillDown({
                actionStatus: "skipped",
              })
            }
            value={turnPolicyMetrics.decisions.actionStatusCounts.skipped}
          />
          <DetailRow
            drillDownAriaLabel="Inspect Duplicate skips decisions"
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
            drillDownAriaLabel="Inspect Cooldown skips decisions"
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
            drillDownAriaLabel="Inspect Interrupt skips decisions"
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

          <div className="pane-section-content" style={{ padding: "12px 0 0" }}>
            <Link
              className="ide-button ide-button--secondary ide-button--sm"
              to={`/workspaces/${selectedWorkspace.id}`}
            >
              {i18n._({
                id: "Open workspace",
                message: "Open workspace",
              })}
            </Link>
          </div>

          {turnPolicyMetrics.generatedAt ? (
            <p className="config-inline-note" style={{ margin: "12px 0 0" }}>
              {i18n._({
                id: "Metrics generated at {generatedAt}.",
                message: "Metrics generated at {generatedAt}.",
                values: {
                  generatedAt: formatLocalizedDateTime(
                    turnPolicyMetrics.generatedAt,
                    "—",
                  ),
                },
              })}
            </p>
          ) : null}

          {turnPolicyMetrics.audit.coverageDefinition ? (
            <p className="config-inline-note" style={{ margin: "8px 0 0" }}>
              {turnPolicyMetrics.audit.coverageDefinition}
            </p>
          ) : null}
        </>
      )}
    </DetailGroup>
  );
}
