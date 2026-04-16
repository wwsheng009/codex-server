import {
  formatLocalizedDateTime,
  formatLocalizedNumber,
  humanizeDisplayValue,
} from "../i18n/display";
import { i18n } from "../i18n/runtime";
import type { TurnPolicyMetricAlert } from "../types/api";
import { formatHookRunTriggerMethodLabel } from "./hook-run-display";

function trimTurnPolicyValue(value?: string | null) {
  return String(value ?? "").trim();
}

function normalizeTurnPolicyValue(value?: string | null) {
  return trimTurnPolicyValue(value)
    .toLowerCase()
    .replace(/[\s_/-]+/g, "");
}

function formatTurnPolicyCodeFallback(value?: string | null, fallback = "—") {
  const raw = trimTurnPolicyValue(value);
  if (!raw) {
    return fallback;
  }

  const looksLikeCode =
    /[_/-]/.test(raw) || /[a-z][A-Z]/.test(raw) || !/\s/.test(raw);

  if (!looksLikeCode) {
    return raw;
  }

  return humanizeDisplayValue(raw.replaceAll("/", " / "), fallback);
}

export function formatTurnPolicyCoverageDefinition(
  key?: string | null,
  fallback?: string | null,
) {
  switch (trimTurnPolicyValue(key).toLowerCase()) {
    case "turn-policy.metrics.coverage-definition":
      return i18n._({
        id: "Coverage is measured only for turns that currently match implemented policy predicates: a failed validation command or a completed turn with file changes but no later successful validation command. A turn is covered when at least one persisted turn policy decision exists for that turn.",
        message:
          "Coverage is measured only for turns that currently match implemented policy predicates: a failed validation command or a completed turn with file changes but no later successful validation command. A turn is covered when at least one persisted turn policy decision exists for that turn.",
      });
    default:
      return trimTurnPolicyValue(fallback);
  }
}

export function formatTurnPolicyDecisionPolicyName(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "posttoolusefailedvalidationcommand":
      return i18n._({
        id: "Failed validation command",
        message: "Failed validation command",
      });
    case "stopmissingsuccessfulverification":
    case "missingsuccessfulverification":
      return i18n._({
        id: "Missing successful verification",
        message: "Missing successful verification",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyDecisionReason(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "validationcommandfailed":
      return i18n._({
        id: "Validation command failed",
        message: "Validation command failed",
      });
    case "filechangesmissingsuccessfulverification":
      return i18n._({
        id: "File changes missing successful verification",
        message: "File changes missing successful verification",
      });
    case "duplicatefingerprint":
      return i18n._({
        id: "Duplicate fingerprint",
        message: "Duplicate fingerprint",
      });
    case "followupcooldownactive":
      return i18n._({
        id: "Follow-up cooldown active",
        message: "Follow-up cooldown active",
      });
    case "interruptnoactiveturn":
      return i18n._({
        id: "Interrupt found no active turn",
        message: "Interrupt found no active turn",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyGovernanceLayer(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "hook":
      return i18n._({
        id: "Hook",
        message: "Hook",
      });
    case "turnpolicyfallback":
      return i18n._({
        id: "Turn policy fallback",
        message: "Turn policy fallback",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyDecisionAction(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "steer":
      return i18n._({
        id: "Steer",
        message: "Steer",
      });
    case "followup":
      return i18n._({
        id: "Follow Up",
        message: "Follow Up",
      });
    case "interrupt":
      return i18n._({
        id: "Interrupt",
        message: "Interrupt",
      });
    case "none":
      return i18n._({
        id: "None",
        message: "None",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyDecisionSource(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "interactive":
      return i18n._({
        id: "Interactive",
        message: "Interactive",
      });
    case "automation":
    case "automatic":
      return i18n._({
        id: "Automation",
        message: "Automation",
      });
    case "bot":
      return i18n._({
        id: "Bot",
        message: "Bot",
      });
    case "workspace":
      return i18n._({
        id: "Workspace",
        message: "Workspace",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyDecisionTriggerMethod(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "backgroundaudit":
      return i18n._({
        id: "Background Audit",
        message: "Background Audit",
      });
    case "postturn":
      return i18n._({
        id: "Post-turn",
        message: "Post-turn",
      });
    default: {
      const raw = trimTurnPolicyValue(value);
      if (!raw) {
        return fallback;
      }
      return formatHookRunTriggerMethodLabel(raw);
    }
  }
}

export function formatTurnPolicyInterruptNoActiveTurnBehavior(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "skip":
      return i18n._({
        id: "Skip",
        message: "Skip",
      });
    case "followup":
      return i18n._({
        id: "Follow Up",
        message: "Follow Up",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyAlertGovernanceAction(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "acknowledge":
      return i18n._({
        id: "Acknowledge",
        message: "Acknowledge",
      });
    case "clearacknowledgement":
      return i18n._({
        id: "Clear acknowledgement",
        message: "Clear acknowledgement",
      });
    case "snooze24h":
      return i18n._({
        id: "Snooze 24h",
        message: "Snooze 24h",
      });
    case "clearsnooze":
      return i18n._({
        id: "Clear snooze",
        message: "Clear snooze",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}

export function formatTurnPolicyAlertSeverity(
  value?: string | null,
  fallback = "Info",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "warning":
      return i18n._({
        id: "Warning",
        message: "Warning",
      });
    case "info":
      return i18n._({
        id: "Info",
        message: "Info",
      });
    default: {
      const raw = trimTurnPolicyValue(value);
      return raw || fallback;
    }
  }
}

export function isTurnPolicyAlertAcknowledged(
  alert?: { acknowledged?: unknown } | null,
) {
  return alert?.acknowledged === true;
}

export function formatTurnPolicyAlertTitle(
  alert?:
    | Pick<TurnPolicyMetricAlert, "severity" | "title" | "acknowledged">
    | ({ acknowledged?: unknown } & {
        severity?: string | null;
        title?: string | null;
      })
    | null,
  options?: {
    fallback?: string;
    style?: "bracket" | "inline";
  },
) {
  const fallback = options?.fallback ?? "—";
  if (!alert) {
    return fallback;
  }

  const severity = formatTurnPolicyAlertSeverity(alert.severity, "Info");
  const title = trimTurnPolicyValue(alert.title);
  if (!title) {
    return fallback;
  }

  const style = options?.style ?? "bracket";
  const baseTitle =
    style === "inline"
      ? `${severity}: ${title}`
      : `[${severity}] ${title}`;

  if (!isTurnPolicyAlertAcknowledged(alert)) {
    return baseTitle;
  }

  return style === "inline"
    ? `${baseTitle} (Acknowledged)`
    : `${baseTitle} [Acknowledged]`;
}

function compareTurnPolicyMetricAlerts(
  left: Pick<TurnPolicyMetricAlert, "code" | "rank" | "severity">,
  right: Pick<TurnPolicyMetricAlert, "code" | "rank" | "severity">,
) {
  const leftRank = Number.isFinite(left.rank) ? Number(left.rank) : 99_999;
  const rightRank = Number.isFinite(right.rank) ? Number(right.rank) : 99_999;
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftSeverity = left.severity === "warning" ? 0 : 1;
  const rightSeverity = right.severity === "warning" ? 0 : 1;
  if (leftSeverity !== rightSeverity) {
    return leftSeverity - rightSeverity;
  }

  return left.code.localeCompare(right.code);
}

export function getTurnPolicyMetricAlerts(
  value?: { alerts?: unknown } | null,
  options?: { limit?: number },
) {
  const alerts = Array.isArray(value?.alerts)
    ? (value.alerts as TurnPolicyMetricAlert[])
        .filter((alert) => alert && typeof alert.title === "string")
        .sort(compareTurnPolicyMetricAlerts)
    : [];

  if (typeof options?.limit === "number" && options.limit >= 0) {
    return alerts.slice(0, options.limit);
  }

  return alerts;
}

export function getTopTurnPolicyMetricAlert(value?: { alerts?: unknown } | null) {
  return getTurnPolicyMetricAlerts(value, { limit: 1 })[0];
}

export function formatTurnPolicyNoActiveAlertsLabel() {
  return i18n._({
    id: "No active alerts",
    message: "No active alerts",
  });
}

export function formatTurnPolicyMetricRate(
  value?: number,
  denominator?: number,
  fallback = "—",
) {
  if (
    typeof denominator !== "number" ||
    !Number.isFinite(denominator) ||
    denominator <= 0
  ) {
    return fallback;
  }

  const safeValue =
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  const percent = Math.round(safeValue * 1000) / 10;
  return `${formatLocalizedNumber(percent, "0")}%`;
}

export function formatTurnPolicyMetricLatencyMs(
  value?: number,
  fallback = "—",
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return fallback;
  }

  return `${formatLocalizedNumber(Math.round(value), "0")} ms`;
}

export function formatTurnPolicyMetricLatencyRange(
  p50Ms?: number,
  p95Ms?: number,
) {
  return `P50 ${formatTurnPolicyMetricLatencyMs(p50Ms)}, P95 ${formatTurnPolicyMetricLatencyMs(p95Ms)}`;
}

export function formatTurnPolicyMetricSuccessValue(
  actionSuccessRate?: number,
  actionSucceeded?: number,
  actionAttempts?: number,
  options?: {
    fallback?: string;
    includeSuccessLabel?: boolean;
    noActionAttemptsLabel?: boolean;
  },
) {
  const fallback = options?.fallback ?? "—";
  const attempts =
    typeof actionAttempts === "number" && Number.isFinite(actionAttempts)
      ? actionAttempts
      : 0;
  const succeeded =
    typeof actionSucceeded === "number" && Number.isFinite(actionSucceeded)
      ? actionSucceeded
      : 0;

  if (attempts <= 0 && options?.noActionAttemptsLabel) {
    return i18n._({
      id: "No action attempts",
      message: "No action attempts",
    });
  }

  const rate = formatTurnPolicyMetricRate(
    actionSuccessRate,
    attempts,
    fallback,
  );
  const counts = `${formatLocalizedNumber(succeeded, "0")} / ${formatLocalizedNumber(attempts, "0")}`;

  return options?.includeSuccessLabel
    ? `${rate} success (${counts})`
    : `${rate} (${counts})`;
}

export function formatTurnPolicyMetricDecisionSuccessSummary(
  total?: number,
  actionSuccessRate?: number,
  actionAttempts?: number,
  fallback = "—",
) {
  if (typeof total !== "number" || !Number.isFinite(total)) {
    return fallback;
  }

  const decisionLabel = total === 1 ? "decision" : "decisions";
  return `${formatLocalizedNumber(total, "0")} ${decisionLabel}, ${formatTurnPolicyMetricRate(actionSuccessRate, actionAttempts, fallback)} success`;
}

export function formatTurnPolicyMetricDecisionCount(
  total?: number,
  fallback = "—",
) {
  if (typeof total !== "number" || !Number.isFinite(total)) {
    return fallback;
  }

  const decisionLabel = total === 1 ? "decision" : "decisions";
  return `${formatLocalizedNumber(total, "0")} ${decisionLabel}`;
}

export function formatTurnPolicyMetricAlertCount(
  alerts?: number,
  fallback = "—",
) {
  if (typeof alerts !== "number" || !Number.isFinite(alerts)) {
    return fallback;
  }

  const alertLabel = alerts === 1 ? "alert" : "alerts";
  return `${formatLocalizedNumber(alerts, "0")} ${alertLabel}`;
}

export function formatTurnPolicyMetricDecisionSummary(
  total?: number,
  actionSuccessRate?: number,
  actionAttempts?: number,
  skipped?: number,
  options?: {
    fallback?: string;
    zeroOnly?: boolean;
  },
) {
  const safeTotal =
    typeof total === "number" && Number.isFinite(total) ? total : 0;
  const safeSkipped =
    typeof skipped === "number" && Number.isFinite(skipped) ? skipped : 0;
  const decisionLabel = safeTotal === 1 ? "decision" : "decisions";

  if (safeTotal <= 0 && options?.zeroOnly) {
    return i18n._({
      id: "0 {decisionLabel}",
      message: "0 {decisionLabel}",
      values: {
        decisionLabel,
      },
    });
  }

  return i18n._({
    id: "{total} {decisionLabel}, {success} success, {skipped} skipped",
    message: "{total} {decisionLabel}, {success} success, {skipped} skipped",
    values: {
      total: formatLocalizedNumber(safeTotal, "0"),
      decisionLabel,
      success: formatTurnPolicyMetricRate(
        actionSuccessRate,
        actionAttempts,
        options?.fallback ?? "—",
      ),
      skipped: formatLocalizedNumber(safeSkipped, "0"),
    },
  });
}

export function formatTurnPolicyMetricActivityMeta(options?: {
  total?: number;
  alerts?: number;
  skipped?: number;
  fallback?: string;
}) {
  const fallback = options?.fallback ?? "—";
  const parts: string[] = [];

  if (typeof options?.total === "number" && Number.isFinite(options.total)) {
    parts.push(formatTurnPolicyMetricDecisionCount(options.total, fallback));
  }

  if (typeof options?.alerts === "number" && Number.isFinite(options.alerts)) {
    parts.push(formatTurnPolicyMetricAlertCount(options.alerts, fallback));
  }

  if (
    typeof options?.skipped === "number" &&
    Number.isFinite(options.skipped)
  ) {
    parts.push(`${formatLocalizedNumber(options.skipped, "0")} skipped`);
  }

  return parts.length ? parts.join(", ") : fallback;
}

export function formatTurnPolicyMetricHealthMeta(options?: {
  total?: number;
  skipped?: number;
  alerts?: number;
  fallback?: string;
}) {
  const fallback = options?.fallback ?? "—";
  const parts: string[] = [];

  if (typeof options?.total === "number" && Number.isFinite(options.total)) {
    parts.push(formatTurnPolicyMetricDecisionCount(options.total, fallback));
  }

  if (
    typeof options?.skipped === "number" &&
    Number.isFinite(options.skipped)
  ) {
    parts.push(`${formatLocalizedNumber(options.skipped, "0")} skipped`);
  }

  if (typeof options?.alerts === "number" && Number.isFinite(options.alerts)) {
    parts.push(formatTurnPolicyMetricAlertCount(options.alerts, fallback));
  }

  return parts.length ? parts.join(", ") : fallback;
}

export function formatTurnPolicyMetricPostStopLatencyFooter(
  postLatencyMs?: number,
  stopLatencyMs?: number,
) {
  return i18n._({
    id: "Post P95 {postLatency}, Stop P95 {stopLatency}",
    message: "Post P95 {postLatency}, Stop P95 {stopLatency}",
    values: {
      postLatency: formatTurnPolicyMetricLatencyMs(postLatencyMs),
      stopLatency: formatTurnPolicyMetricLatencyMs(stopLatencyMs),
    },
  });
}

export function formatTurnPolicyMetricCoverageAlertsFooter(
  coverageRate?: number,
  eligibleTurns?: number,
  options?: {
    alertCount?: number;
    postLatencyMs?: number;
    stopLatencyMs?: number;
    fallback?: string;
  },
) {
  const fallback = options?.fallback ?? "—";
  return i18n._({
    id: "Coverage {coverage}, Alerts {alerts}, Post P95 {postLatency}, Stop P95 {stopLatency}",
    message:
      "Coverage {coverage}, Alerts {alerts}, Post P95 {postLatency}, Stop P95 {stopLatency}",
    values: {
      coverage: formatTurnPolicyMetricRate(coverageRate, eligibleTurns, fallback),
      alerts: formatLocalizedNumber(
        typeof options?.alertCount === "number" &&
          Number.isFinite(options.alertCount)
          ? options.alertCount
          : 0,
        "0",
      ),
      postLatency: formatTurnPolicyMetricLatencyMs(
        options?.postLatencyMs,
        fallback,
      ),
      stopLatency: formatTurnPolicyMetricLatencyMs(
        options?.stopLatencyMs,
        fallback,
      ),
    },
  });
}

export function formatTurnPolicyMetricCoverageLatencyFooter(
  coverageRate?: number,
  eligibleTurns?: number,
  options?: {
    postLatencyMs?: number;
    stopLatencyMs?: number;
    fallback?: string;
    omitEmptyLatencies?: boolean;
  },
) {
  const fallback = options?.fallback ?? "—";
  const parts = [
    i18n._({
      id: "Coverage {coverage}",
      message: "Coverage {coverage}",
      values: {
        coverage: formatTurnPolicyMetricRate(
          coverageRate,
          eligibleTurns,
          fallback,
        ),
      },
    }),
  ];

  const postLatency =
    typeof options?.postLatencyMs === "number" &&
    Number.isFinite(options.postLatencyMs) &&
    options.postLatencyMs > 0
      ? i18n._({
          id: "Post P95 {latency}",
          message: "Post P95 {latency}",
          values: {
            latency: formatTurnPolicyMetricLatencyMs(
              options.postLatencyMs,
              fallback,
            ),
          },
        })
      : null;
  const stopLatency =
    typeof options?.stopLatencyMs === "number" &&
    Number.isFinite(options.stopLatencyMs) &&
    options.stopLatencyMs > 0
      ? i18n._({
          id: "Stop P95 {latency}",
          message: "Stop P95 {latency}",
          values: {
            latency: formatTurnPolicyMetricLatencyMs(
              options.stopLatencyMs,
              fallback,
            ),
          },
        })
      : null;

  if (options?.omitEmptyLatencies) {
    if (postLatency) {
      parts.push(postLatency);
    }
    if (stopLatency) {
      parts.push(stopLatency);
    }
    return parts.join(", ");
  }

  parts.push(
    postLatency ??
      i18n._({
        id: "Post P95 {latency}",
        message: "Post P95 {latency}",
        values: {
          latency: formatTurnPolicyMetricLatencyMs(undefined, fallback),
        },
      }),
  );
  parts.push(
    stopLatency ??
      i18n._({
        id: "Stop P95 {latency}",
        message: "Stop P95 {latency}",
        values: {
          latency: formatTurnPolicyMetricLatencyMs(undefined, fallback),
        },
      }),
  );
  return parts.join(", ");
}

export function formatTurnPolicyMetricTopAlertMeta(
  alert?: Pick<TurnPolicyMetricAlert, "rank" | "message"> | null,
  fallback = "—",
) {
  const message = trimTurnPolicyValue(alert?.message);
  if (!message) {
    return fallback;
  }

  if (typeof alert?.rank === "number" && Number.isFinite(alert.rank)) {
    return i18n._({
      id: "Rank {rank}: {message}",
      message: "Rank {rank}: {message}",
      values: {
        rank: formatLocalizedNumber(alert.rank, "0"),
        message,
      },
    });
  }

  return message;
}

export type TurnPolicyAlertAcknowledgementSummary = {
  acknowledgedCodes: string[];
  acknowledgedCount: number;
};

export type TurnPolicyAlertSuppressionSummary = {
  suppressedCodes: string[];
  suppressedCount: number;
};

export type TurnPolicyAlertSnoozeSummary = {
  snoozedCodes: string[];
  snoozedCount: number;
  snoozeUntil: string | null;
};

function getTurnPolicyAlertPolicy(
  value?: { alertPolicy?: unknown } | null,
): Record<string, unknown> | null {
  const alertPolicy = value?.alertPolicy;
  return alertPolicy && typeof alertPolicy === "object"
    ? (alertPolicy as Record<string, unknown>)
    : null;
}

function readTurnPolicyAlertCodes(value: unknown) {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter((item) => item.length > 0)
    : [];
}

function readTurnPolicyAlertCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : 0;
}

function formatTurnPolicyAlertPreview(codes: string[]) {
  const previewCodes = codes.slice(0, 2);
  const overflowCount = codes.length - previewCodes.length;
  const preview = previewCodes
    .map((code) => formatTurnPolicyAlertCode(code))
    .join(", ");

  if (overflowCount <= 0) {
    return preview;
  }

  return `${preview}, +${formatLocalizedNumber(overflowCount, "0")} more`;
}

function formatTurnPolicyAlertNotePrefix(labelPrefix?: string | null) {
  const raw = trimTurnPolicyValue(labelPrefix);
  return raw ? `${raw}: ` : "";
}

export function getTurnPolicyAlertAcknowledgementSummary(
  value?: { alertPolicy?: unknown } | null,
): TurnPolicyAlertAcknowledgementSummary | null {
  const alertPolicy = getTurnPolicyAlertPolicy(value);
  if (!alertPolicy) {
    return null;
  }

  const acknowledgedCodes = readTurnPolicyAlertCodes(
    alertPolicy.acknowledgedCodes,
  );
  const acknowledgedCount = readTurnPolicyAlertCount(
    alertPolicy.acknowledgedCount,
  );

  if (acknowledgedCount <= 0) {
    return null;
  }

  return {
    acknowledgedCodes,
    acknowledgedCount,
  };
}

export function formatTurnPolicyAlertAcknowledgementNote(
  summary: TurnPolicyAlertAcknowledgementSummary | null,
  options?: { labelPrefix?: string | null },
) {
  if (!summary) {
    return null;
  }

  const alertLabel = summary.acknowledgedCount === 1 ? "alert" : "alerts";
  const prefix = formatTurnPolicyAlertNotePrefix(options?.labelPrefix);

  if (!summary.acknowledgedCodes.length) {
    return `${prefix}${formatLocalizedNumber(summary.acknowledgedCount, "0")} ${alertLabel} acknowledged as known issues in settings.`;
  }

  return `${prefix}${formatLocalizedNumber(summary.acknowledgedCount, "0")} ${alertLabel} acknowledged as known issues in settings (${formatTurnPolicyAlertPreview(summary.acknowledgedCodes)}).`;
}

export function getTurnPolicyAlertSuppressionSummary(
  value?: { alertPolicy?: unknown } | null,
): TurnPolicyAlertSuppressionSummary | null {
  const alertPolicy = getTurnPolicyAlertPolicy(value);
  if (!alertPolicy) {
    return null;
  }

  const suppressedCodes = readTurnPolicyAlertCodes(alertPolicy.suppressedCodes);
  const suppressedCount = readTurnPolicyAlertCount(
    alertPolicy.suppressedCount,
  );

  if (suppressedCount <= 0) {
    return null;
  }

  return {
    suppressedCodes,
    suppressedCount,
  };
}

export function formatTurnPolicyAlertSuppressionNote(
  summary: TurnPolicyAlertSuppressionSummary | null,
  options?: { labelPrefix?: string | null },
) {
  if (!summary) {
    return null;
  }

  const alertLabel = summary.suppressedCount === 1 ? "alert" : "alerts";
  const prefix = formatTurnPolicyAlertNotePrefix(options?.labelPrefix);

  if (!summary.suppressedCodes.length) {
    return `${prefix}${formatLocalizedNumber(summary.suppressedCount, "0")} ${alertLabel} suppressed by settings.`;
  }

  return `${prefix}${formatLocalizedNumber(summary.suppressedCount, "0")} ${alertLabel} suppressed by settings (${formatTurnPolicyAlertPreview(summary.suppressedCodes)}).`;
}

export function getTurnPolicyAlertSnoozeSummary(
  value?: { alertPolicy?: unknown } | null,
): TurnPolicyAlertSnoozeSummary | null {
  const alertPolicy = getTurnPolicyAlertPolicy(value);
  if (!alertPolicy) {
    return null;
  }

  const snoozedCodes = readTurnPolicyAlertCodes(alertPolicy.snoozedCodes);
  const snoozedCount = readTurnPolicyAlertCount(alertPolicy.snoozedCount);
  const snoozeUntil =
    typeof alertPolicy.snoozeUntil === "string" &&
    alertPolicy.snoozeUntil.trim().length > 0
      ? alertPolicy.snoozeUntil.trim()
      : null;

  if (snoozedCount <= 0) {
    return null;
  }

  return {
    snoozedCodes,
    snoozedCount,
    snoozeUntil,
  };
}

export function formatTurnPolicyAlertSnoozeNote(
  summary: TurnPolicyAlertSnoozeSummary | null,
  options?: { labelPrefix?: string | null },
) {
  if (!summary) {
    return null;
  }

  const alertLabel = summary.snoozedCount === 1 ? "alert" : "alerts";
  const prefix = formatTurnPolicyAlertNotePrefix(options?.labelPrefix);
  const untilLabel = summary.snoozeUntil
    ? ` until ${formatLocalizedDateTime(summary.snoozeUntil, "—")}`
    : "";

  if (!summary.snoozedCodes.length) {
    return `${prefix}${formatLocalizedNumber(summary.snoozedCount, "0")} ${alertLabel} temporarily snoozed${untilLabel}.`;
  }

  return `${prefix}${formatLocalizedNumber(summary.snoozedCount, "0")} ${alertLabel} temporarily snoozed${untilLabel} (${formatTurnPolicyAlertPreview(summary.snoozedCodes)}).`;
}

export function formatTurnPolicyAlertCode(
  value?: string | null,
  fallback = "—",
) {
  switch (normalizeTurnPolicyValue(value)) {
    case "auditcoverageincomplete":
      return i18n._({
        id: "Audit coverage incomplete",
        message: "Audit coverage incomplete",
      });
    case "failedactionsdetected":
      return i18n._({
        id: "Failed actions detected",
        message: "Failed actions detected",
      });
    case "duplicateskipsdetected":
      return i18n._({
        id: "Duplicate skips detected",
        message: "Duplicate skips detected",
      });
    case "cooldownskipsdetected":
      return i18n._({
        id: "Cooldown skips detected",
        message: "Cooldown skips detected",
      });
    case "posttooluselatencyhigh":
      return i18n._({
        id: "Post-tool-use latency high",
        message: "Post-tool-use latency high",
      });
    case "stoplatencyhigh":
    case "stopdecisionlatencyhigh":
      return i18n._({
        id: "Stop decision latency high",
        message: "Stop decision latency high",
      });
    case "automationactionsuccessbelowtarget":
      return i18n._({
        id: "Automation action success below target",
        message: "Automation action success below target",
      });
    case "botactionsuccessbelowtarget":
      return i18n._({
        id: "Bot action success below target",
        message: "Bot action success below target",
      });
    case "automationactionfailures":
      return i18n._({
        id: "Automation action failures",
        message: "Automation action failures",
      });
    case "botactionfailures":
      return i18n._({
        id: "Bot action failures",
        message: "Bot action failures",
      });
    case "automationduplicateskips":
      return i18n._({
        id: "Automation duplicate skips",
        message: "Automation duplicate skips",
      });
    case "slowposttooluse":
      return i18n._({
        id: "Slow post-tool-use decisions",
        message: "Slow post-tool-use decisions",
      });
    case "slowstopdecisions":
      return i18n._({
        id: "Slow stop decisions",
        message: "Slow stop decisions",
      });
    default:
      return formatTurnPolicyCodeFallback(value, fallback);
  }
}
