import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { DetailGroup } from "../../components/ui/DetailGroup";
import { InlineNotice } from "../../components/ui/InlineNotice";
import { LoadingState } from "../../components/ui/LoadingState";
import {
  readRuntimePreferences,
  writeRuntimePreferences,
} from "../../features/settings/api";
import {
  activateGovernanceSettingsTab,
  GOVERNANCE_SETTINGS_PATH,
} from "../../features/settings/governanceNavigation";
import {
  formatLocalizedDateTime,
  formatLocalizedNumber,
} from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import { getErrorMessage } from "../../lib/error-utils";
import {
  formatTurnPolicyAlertAcknowledgementNote,
  formatTurnPolicyAlertGovernanceAction,
  formatTurnPolicyAlertSnoozeNote,
  formatTurnPolicyAlertSuppressionNote,
  formatTurnPolicyAlertTitle,
  formatTurnPolicyCoverageDefinition,
  formatTurnPolicyDecisionAction,
  formatTurnPolicyInterruptNoActiveTurnBehavior,
  formatTurnPolicyMetricDecisionSummary,
  formatTurnPolicyMetricLatencyRange,
  formatTurnPolicyMetricRate,
  formatTurnPolicyMetricSuccessValue,
  getTurnPolicyAlertAcknowledgementSummary,
  getTurnPolicyAlertSnoozeSummary,
  getTurnPolicyAlertSuppressionSummary,
  isTurnPolicyAlertAcknowledged,
} from "../../lib/turn-policy-display";
import { buildTurnPolicyAlertGovernancePayload } from "../settings/configSettingsPageRuntimePreferences";
import type {
  RuntimePreferencesResult,
  TurnPolicyMetricAlert,
} from "../../types/api";
import type { ThreadWorkbenchRailTurnPolicyMetricsSectionProps } from "./threadWorkbenchRailTypes";

type TurnPolicyMetricsWithConfig =
  ThreadWorkbenchRailTurnPolicyMetricsSectionProps["turnPolicyMetrics"] & {
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

type ThreadWorkbenchRailTurnPolicyMetricDrillDownRoutes = {
  validationRescue?: string;
  missingVerify?: string;
  skippedDecisions?: string;
  automationSource?: string;
  botSource?: string;
  sourceComparison?: string;
  alertHistory?: string;
  automationHistory?: string;
  botHistory?: string;
};

type AlertGovernanceAction =
  | "acknowledge"
  | "clearAcknowledgement"
  | "snooze24h"
  | "clearSnooze";

type ThreadWorkbenchRailTurnPolicyMetricsSectionComponentProps =
  ThreadWorkbenchRailTurnPolicyMetricsSectionProps & {
    workspaceTurnPolicyRoutes?: ThreadWorkbenchRailTurnPolicyMetricDrillDownRoutes;
  };

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
  turnPolicyMetrics?: ThreadWorkbenchRailTurnPolicyMetricsSectionProps["turnPolicyMetrics"],
): TurnPolicyRuntimeConfig | null {
  const rawConfig = (turnPolicyMetrics as TurnPolicyMetricsWithConfig | null)
    ?.config;
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
    ? i18n._({ id: "Enabled", message: "Enabled" })
    : i18n._({ id: "Disabled", message: "Disabled" });
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

function getAlertCta(
  alert: TurnPolicyMetricAlert,
  routes?: ThreadWorkbenchRailTurnPolicyMetricDrillDownRoutes,
) {
  switch (alert.source?.trim()) {
    case "automation":
      return {
        ctaLabel: i18n._({
          id: "Review automation alert",
          message: "Review automation alert",
        }),
        ctaTo: routes?.automationSource,
      };
    case "bot":
      return {
        ctaLabel: i18n._({
          id: "Review bot alert",
          message: "Review bot alert",
        }),
        ctaTo: routes?.botSource,
      };
    default:
      return {};
  }
}

function StatCard({
  ctaLabel,
  ctaTo,
  footer,
  label,
  meta,
  value,
}: {
  ctaLabel?: string;
  ctaTo?: string;
  footer?: string;
  label: string;
  meta?: string;
  value: string | number;
}) {
  return (
    <article className="detail-stat">
      <span className="detail-stat__label">{label}</span>
      <strong className="detail-stat__value">{value}</strong>
      {meta ? <span className="detail-stat__meta">{meta}</span> : null}
      {footer ? <span className="detail-stat__footer">{footer}</span> : null}
      {ctaTo ? (
        <Link
          className="ide-button ide-button--secondary ide-button--sm"
          to={ctaTo}
        >
          {ctaLabel}
        </Link>
      ) : null}
    </article>
  );
}

function DetailRow({
  ctaLabel,
  ctaTo,
  label,
  value,
}: {
  ctaLabel?: string;
  ctaTo?: string;
  label: string;
  value: string | number;
}) {
  return (
    <div className="detail-row">
      <span>{label}</span>
      <strong style={{ alignItems: "center", display: "inline-flex", gap: 8 }}>
        <span>{value}</span>
        {ctaTo ? (
          <Link
            className="ide-button ide-button--secondary ide-button--sm"
            to={ctaTo}
          >
            {ctaLabel}
          </Link>
        ) : null}
      </strong>
    </div>
  );
}

function AlertGovernanceButtons({
  alert,
  error,
  isAcknowledged,
  isSnoozed,
  onRunAction,
  pendingAction,
  pendingCode,
}: {
  alert: TurnPolicyMetricAlert;
  error: string | null;
  isAcknowledged: boolean;
  isSnoozed: boolean;
  onRunAction: (input: { action: AlertGovernanceAction; code: string }) => void;
  pendingAction?: AlertGovernanceAction;
  pendingCode?: string;
}) {
  const code = alert.code?.trim() ?? "";
  const isPending = Boolean(code) && pendingCode === code;
  const acknowledgeAction: AlertGovernanceAction = isAcknowledged
    ? "clearAcknowledgement"
    : "acknowledge";
  const snoozeAction: AlertGovernanceAction = isSnoozed
    ? "clearSnooze"
    : "snooze24h";

  return (
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
        aria-label={`${formatTurnPolicyAlertGovernanceAction(acknowledgeAction)} for alert ${alert.title}`}
        className="ide-button ide-button--secondary ide-button--sm"
        disabled={isPending || !code}
        onClick={() =>
          onRunAction({
            action: acknowledgeAction,
            code,
          })
        }
        type="button"
      >
        {isPending && pendingAction === acknowledgeAction
          ? i18n._({ id: "Saving…", message: "Saving…" })
          : formatTurnPolicyAlertGovernanceAction(acknowledgeAction)}
      </button>
      <button
        aria-label={`${formatTurnPolicyAlertGovernanceAction(snoozeAction)} for alert ${alert.title}`}
        className="ide-button ide-button--secondary ide-button--sm"
        disabled={isPending || !code}
        onClick={() =>
          onRunAction({
            action: snoozeAction,
            code,
          })
        }
        type="button"
      >
        {isPending && pendingAction === snoozeAction
          ? i18n._({ id: "Saving…", message: "Saving…" })
          : formatTurnPolicyAlertGovernanceAction(snoozeAction)}
      </button>
      {error ? (
        <span className="config-inline-note" style={{ margin: 0 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

function AlertRow({
  alert,
  ctaLabel,
  ctaTo,
  error,
  isAcknowledged,
  isSnoozed,
  onRunAction,
  pendingAction,
  pendingCode,
}: {
  alert: TurnPolicyMetricAlert;
  ctaLabel?: string;
  ctaTo?: string;
  error: string | null;
  isAcknowledged: boolean;
  isSnoozed: boolean;
  onRunAction: (input: { action: AlertGovernanceAction; code: string }) => void;
  pendingAction?: AlertGovernanceAction;
  pendingCode?: string;
}) {
  return (
    <div className="detail-row" style={{ alignItems: "flex-start" }}>
      <div
        style={{
          display: "grid",
          gap: 4,
          justifyItems: "flex-start",
          width: "100%",
        }}
      >
        <strong>{formatTurnPolicyAlertTitle(alert, { style: "inline" })}</strong>
        <span className="config-inline-note" style={{ margin: 0 }}>
          {alert.message}
        </span>
      </div>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexShrink: 0,
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "flex-end",
          marginLeft: 12,
        }}
      >
        {ctaTo ? (
          <Link
            className="ide-button ide-button--secondary ide-button--sm"
            to={ctaTo}
          >
            {ctaLabel}
          </Link>
        ) : null}
        <AlertGovernanceButtons
          alert={alert}
          error={error}
          isAcknowledged={isAcknowledged}
          isSnoozed={isSnoozed}
          onRunAction={onRunAction}
          pendingAction={pendingAction}
          pendingCode={pendingCode}
        />
      </div>
    </div>
  );
}

export function ThreadWorkbenchRailTurnPolicyMetricsSection({
  selectedThread,
  turnPolicyMetrics,
  turnPolicyMetricsError,
  turnPolicyMetricsLoading,
  workspaceTurnPolicyRoutes,
}: ThreadWorkbenchRailTurnPolicyMetricsSectionComponentProps) {
  const alerts = Array.isArray(
    (turnPolicyMetrics as { alerts?: TurnPolicyMetricAlert[] } | null)?.alerts,
  )
    ? ((turnPolicyMetrics as { alerts?: TurnPolicyMetricAlert[] }).alerts ?? [])
    : [];
  const runtimeConfig = getTurnPolicyRuntimeConfig(turnPolicyMetrics);
  const alertSuppressionSummary =
    getTurnPolicyAlertSuppressionSummary(turnPolicyMetrics);
  const alertSuppressionNote = formatTurnPolicyAlertSuppressionNote(
    alertSuppressionSummary,
  );
  const alertAcknowledgementSummary =
    getTurnPolicyAlertAcknowledgementSummary(turnPolicyMetrics);
  const alertAcknowledgementNote = formatTurnPolicyAlertAcknowledgementNote(
    alertAcknowledgementSummary,
  );
  const alertSnoozeSummary = getTurnPolicyAlertSnoozeSummary(turnPolicyMetrics);
  const alertSnoozeNote = formatTurnPolicyAlertSnoozeNote(alertSnoozeSummary);
  const acknowledgedAlertCodes = new Set(
    alertAcknowledgementSummary?.acknowledgedCodes ?? [],
  );
  const snoozedAlertCodes = new Set(alertSnoozeSummary?.snoozedCodes ?? []);
  const queryClient = useQueryClient();
  const governanceMutation = useMutation({
    mutationFn: async (input: {
      action: AlertGovernanceAction;
      code: string;
      now?: Date;
    }) => {
      const cached = queryClient.getQueryData([
        "settings-runtime-preferences",
      ]) as RuntimePreferencesResult | undefined;
      const currentPreferences = cached ?? (await readRuntimePreferences());

      return writeRuntimePreferences(
        buildTurnPolicyAlertGovernancePayload(
          currentPreferences,
          {
            type: input.action,
            code: input.code,
            source: "thread-metrics",
          },
          input.now,
        ),
      );
    },
    onSuccess: async (result) => {
      queryClient.setQueryData(["settings-runtime-preferences"], result);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["settings-runtime-preferences"],
        }),
        queryClient.invalidateQueries({
          queryKey: ["turn-policy-metrics"],
        }),
      ]);
    },
  });
  const governanceError = governanceMutation.error
    ? getErrorMessage(governanceMutation.error)
    : null;
  const pendingAction = governanceMutation.variables?.action;
  const pendingCode = governanceMutation.variables?.code;

  return (
    <DetailGroup
      title={i18n._({
        id: "Turn Policy Metrics",
        message: "Turn Policy Metrics",
      })}
    >
      <div className="pane-section-content" style={{ paddingBottom: 8 }}>
        <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
          {i18n._({
            id: "Open the governance activity workspace to review thread alerts next to workspace hook runs and saved turn-policy overrides.",
            message:
              "Open the governance activity workspace to review thread alerts next to workspace hook runs and saved turn-policy overrides.",
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
      {turnPolicyMetricsLoading ? (
        <div className="pane-section-content">
          <LoadingState
            fill={false}
            message={i18n._({
              id: "Loading turn policy metrics…",
              message: "Loading turn policy metrics…",
            })}
          />
        </div>
      ) : turnPolicyMetricsError ? (
        <div className="pane-section-content">
          <InlineNotice
            noticeKey={`turn-policy-metrics-${turnPolicyMetricsError}`}
            title={i18n._({
              id: "Turn policy metrics unavailable",
              message: "Turn policy metrics unavailable",
            })}
            tone="error"
          >
            {turnPolicyMetricsError}
          </InlineNotice>
        </div>
      ) : !selectedThread ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "Select a thread to inspect turn policy metrics.",
              message: "Select a thread to inspect turn policy metrics.",
            })}
          </p>
        </div>
      ) : !turnPolicyMetrics ? (
        <div className="pane-section-content">
          <p className="config-inline-note" style={{ margin: 0 }}>
            {i18n._({
              id: "No turn policy metrics are available for this thread yet.",
              message:
                "No turn policy metrics are available for this thread yet.",
            })}
          </p>
        </div>
      ) : (
        <>
          {alerts.length ? (
            <>
              <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
                {i18n._({
                  id: "Attention Needed",
                  message: "Attention Needed",
                })}
              </p>
              {alerts.slice(0, 3).map((alert) => {
                const { ctaLabel, ctaTo } = getAlertCta(
                  alert,
                  workspaceTurnPolicyRoutes,
                );

                return (
                  <AlertRow
                    alert={alert}
                    ctaLabel={ctaLabel}
                    ctaTo={ctaTo}
                    error={governanceError}
                    isAcknowledged={
                      isTurnPolicyAlertAcknowledged(alert) ||
                      acknowledgedAlertCodes.has(alert.code?.trim() ?? "")
                    }
                    isSnoozed={snoozedAlertCodes.has(alert.code?.trim() ?? "")}
                    key={alert.code}
                    onRunAction={(input) => {
                      governanceMutation.mutate(input);
                    }}
                    pendingAction={pendingAction}
                    pendingCode={pendingCode}
                  />
                );
              })}
            </>
          ) : null}
          {governanceError ? (
            <InlineNotice
              noticeKey={`turn-policy-alert-governance-${governanceError}`}
              title={i18n._({
                id: "Alert governance update failed",
                message: "Alert governance update failed",
              })}
              tone="error"
            >
              {governanceError}
            </InlineNotice>
          ) : null}
          {alertSuppressionNote ? (
            <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
              {alertSuppressionNote}
            </p>
          ) : null}
          {alertAcknowledgementNote ? (
            <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
              {alertAcknowledgementNote}
            </p>
          ) : null}
          {alertSnoozeNote ? (
            <p className="config-inline-note" style={{ margin: "0 0 8px" }}>
              {alertSnoozeNote}
            </p>
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
              ctaLabel={i18n._({
                id: "View rescued decisions",
                message: "View rescued decisions",
              })}
              ctaTo={workspaceTurnPolicyRoutes?.validationRescue}
              label={i18n._({
                id: "Validation Rescue",
                message: "Validation Rescue",
              })}
              footer={`${turnPolicyMetrics.turns.failedValidationWithPolicyAction} / ${turnPolicyMetrics.turns.failedValidationCommand}`}
              meta={i18n._({
                id: "Failed validations remediated",
                message: "Failed validations remediated",
              })}
              value={formatTurnPolicyMetricRate(
                turnPolicyMetrics.turns.failedValidationWithPolicyActionRate,
                turnPolicyMetrics.turns.failedValidationCommand,
              )}
            />
            <StatCard
              ctaLabel={i18n._({
                id: "View missing verify decisions",
                message: "View missing verify decisions",
              })}
              ctaTo={workspaceTurnPolicyRoutes?.missingVerify}
              label={i18n._({
                id: "Missing Verify",
                message: "Missing Verify",
              })}
              footer={`${turnPolicyMetrics.turns.missingSuccessfulVerification} / ${turnPolicyMetrics.turns.completedWithFileChange}`}
              meta={i18n._({
                id: "Completed file-change turns",
                message: "Completed file-change turns",
              })}
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
              <DetailRow
                label={i18n._({
                  id: "Post-tool-use policy",
                  message: "Post-tool-use policy",
                })}
                value={formatPolicyToggleLabel(
                  runtimeConfig.postToolUseEnabled,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Missing verify policy",
                  message: "Missing verify policy",
                })}
                value={formatPolicyToggleLabel(
                  runtimeConfig.stopMissingVerificationEnabled,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Follow-up cooldown",
                  message: "Follow-up cooldown",
                })}
                value={formatCooldownValue(runtimeConfig.followUpCooldownMs)}
              />
              <DetailRow
                label={i18n._({
                  id: "Post-tool-use follow-up cooldown",
                  message: "Post-tool-use follow-up cooldown",
                })}
                value={formatCooldownValue(
                  runtimeConfig.postToolUseFollowUpCooldownMs,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Missing verify follow-up cooldown",
                  message: "Missing verify follow-up cooldown",
                })}
                value={formatCooldownValue(
                  runtimeConfig.stopMissingSuccessfulVerificationFollowUpCooldownMs,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Post-tool-use action",
                  message: "Post-tool-use action",
                })}
                value={formatTurnPolicyDecisionAction(
                  runtimeConfig.postToolUsePrimaryAction,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Missing verify action",
                  message: "Missing verify action",
                })}
                value={formatTurnPolicyDecisionAction(
                  runtimeConfig.stopMissingVerificationPrimaryAction,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Post-tool-use interrupt fallback",
                  message: "Post-tool-use interrupt fallback",
                })}
                value={formatTurnPolicyInterruptNoActiveTurnBehavior(
                  runtimeConfig.postToolUseInterruptNoActiveTurnBehavior,
                )}
              />
              <DetailRow
                label={i18n._({
                  id: "Missing verify interrupt fallback",
                  message: "Missing verify interrupt fallback",
                })}
                value={formatTurnPolicyInterruptNoActiveTurnBehavior(
                  runtimeConfig.stopMissingVerificationInterruptNoActiveTurnBehavior,
                )}
              />
            </>
          ) : null}

          <DetailRow
            label={i18n._({
              id: "Steer actions",
              message: "Steer actions",
            })}
            value={turnPolicyMetrics.decisions.actionCounts.steer}
          />
          <DetailRow
            label={i18n._({
              id: "Follow-up actions",
              message: "Follow-up actions",
            })}
            value={turnPolicyMetrics.decisions.actionCounts.followUp}
          />
          <DetailRow
            label={i18n._({
              id: "Interrupt actions",
              message: "Interrupt actions",
            })}
            value={
              (
                turnPolicyMetrics.decisions.actionCounts as {
                  interrupt?: number;
                }
              ).interrupt ?? 0
            }
          />
          <DetailRow
            label={i18n._({
              id: "Action success",
              message: "Action success",
            })}
            value={formatTurnPolicyMetricSuccessValue(
              turnPolicyMetrics.decisions.actionSuccessRate,
              turnPolicyMetrics.decisions.actionSucceeded,
              turnPolicyMetrics.decisions.actionAttempts,
            )}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "Open automation overview",
              message: "Open automation overview",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.automationSource}
            label={i18n._({
              id: "Automation decisions",
              message: "Automation decisions",
            })}
            value={formatTurnPolicyMetricDecisionSummary(
              turnPolicyMetrics.sources.automation.total,
              turnPolicyMetrics.sources.automation.actionSuccessRate,
              turnPolicyMetrics.sources.automation.actionAttempts,
              turnPolicyMetrics.sources.automation.skipped,
            )}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "Open bot overview",
              message: "Open bot overview",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.botSource}
            label={i18n._({
              id: "Bot decisions",
              message: "Bot decisions",
            })}
            value={formatTurnPolicyMetricDecisionSummary(
              turnPolicyMetrics.sources.bot.total,
              turnPolicyMetrics.sources.bot.actionSuccessRate,
              turnPolicyMetrics.sources.bot.actionAttempts,
              turnPolicyMetrics.sources.bot.skipped,
            )}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "Open source comparison",
              message: "Open source comparison",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.sourceComparison}
            label={i18n._({
              id: "Source comparison",
              message: "Source comparison",
            })}
            value={i18n._({
              id: "Compare interactive, automation, and bot health",
              message: "Compare interactive, automation, and bot health",
            })}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "Open alert history",
              message: "Open alert history",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.alertHistory}
            label={i18n._({
              id: "Alert history",
              message: "Alert history",
            })}
            value={i18n._({
              id: "Review the recent thread alert timeline",
              message: "Review the recent thread alert timeline",
            })}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "Open automation history",
              message: "Open automation history",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.automationHistory}
            label={i18n._({
              id: "Automation history",
              message: "Automation history",
            })}
            value={i18n._({
              id: "Review the automation alert timeline",
              message: "Review the automation alert timeline",
            })}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "Open bot history",
              message: "Open bot history",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.botHistory}
            label={i18n._({
              id: "Bot history",
              message: "Bot history",
            })}
            value={i18n._({
              id: "Review the bot alert timeline",
              message: "Review the bot alert timeline",
            })}
          />
          <DetailRow
            ctaLabel={i18n._({
              id: "View skipped decisions",
              message: "View skipped decisions",
            })}
            ctaTo={workspaceTurnPolicyRoutes?.skippedDecisions}
            label={i18n._({
              id: "Skipped decisions",
              message: "Skipped decisions",
            })}
            value={turnPolicyMetrics.decisions.actionStatusCounts.skipped}
          />
          <DetailRow
            label={i18n._({
              id: "Duplicate skips",
              message: "Duplicate skips",
            })}
            value={
              turnPolicyMetrics.decisions.skipReasonCounts.duplicateFingerprint
            }
          />
          <DetailRow
            label={i18n._({
              id: "Cooldown skips",
              message: "Cooldown skips",
            })}
            value={
              turnPolicyMetrics.decisions.skipReasonCounts
                .followUpCooldownActive
            }
          />
          <DetailRow
            label={i18n._({
              id: "Interrupt skips",
              message: "Interrupt skips",
            })}
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

          {turnPolicyMetrics.audit.coverageDefinitionKey ||
          turnPolicyMetrics.audit.coverageDefinition ? (
            <p className="config-inline-note" style={{ margin: "8px 0 0" }}>
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
