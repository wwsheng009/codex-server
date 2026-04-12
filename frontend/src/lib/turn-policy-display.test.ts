import { beforeAll, describe, expect, it } from "vitest";

import { formatLocalizedDateTime } from "../i18n/display";
import { i18n } from "../i18n/runtime";
import {
  formatTurnPolicyAlertAcknowledgementNote,
  formatTurnPolicyAlertCode,
  formatTurnPolicyAlertGovernanceAction,
  formatTurnPolicyNoActiveAlertsLabel,
  formatTurnPolicyAlertSeverity,
  formatTurnPolicyAlertSnoozeNote,
  formatTurnPolicyAlertSuppressionNote,
  formatTurnPolicyAlertTitle,
  formatTurnPolicyDecisionAction,
  formatTurnPolicyDecisionPolicyName,
  formatTurnPolicyDecisionReason,
  formatTurnPolicyDecisionSource,
  formatTurnPolicyDecisionTriggerMethod,
  formatTurnPolicyInterruptNoActiveTurnBehavior,
  formatTurnPolicyMetricAlertCount,
  formatTurnPolicyMetricActivityMeta,
  formatTurnPolicyMetricCoverageAlertsFooter,
  formatTurnPolicyMetricCoverageLatencyFooter,
  formatTurnPolicyMetricDecisionCount,
  formatTurnPolicyMetricDecisionSuccessSummary,
  formatTurnPolicyMetricDecisionSummary,
  formatTurnPolicyMetricHealthMeta,
  formatTurnPolicyMetricLatencyRange,
  formatTurnPolicyMetricPostStopLatencyFooter,
  formatTurnPolicyMetricRate,
  formatTurnPolicyMetricSuccessValue,
  formatTurnPolicyMetricTopAlertMeta,
  getTopTurnPolicyMetricAlert,
  getTurnPolicyAlertAcknowledgementSummary,
  getTurnPolicyMetricAlerts,
  getTurnPolicyAlertSnoozeSummary,
  getTurnPolicyAlertSuppressionSummary,
} from "./turn-policy-display";

describe("turn-policy-display", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  it("formats known policy names and reasons with readable labels", () => {
    expect(
      formatTurnPolicyDecisionPolicyName(
        "posttooluse/failed-validation-command",
      ),
    ).toBe("Failed validation command");
    expect(
      formatTurnPolicyDecisionPolicyName("missing_successful_verification"),
    ).toBe("Missing successful verification");
    expect(formatTurnPolicyDecisionReason("validation_command_failed")).toBe(
      "Validation command failed",
    );
    expect(formatTurnPolicyDecisionReason("interrupt_no_active_turn")).toBe(
      "Interrupt found no active turn",
    );
    expect(formatTurnPolicyDecisionTriggerMethod("item/completed")).toBe(
      "Item Completed",
    );
    expect(formatTurnPolicyDecisionTriggerMethod("turn/completed")).toBe(
      "Turn Completed",
    );
    expect(formatTurnPolicyDecisionTriggerMethod("background_audit")).toBe(
      "Background Audit",
    );
    expect(formatTurnPolicyDecisionTriggerMethod("post_turn")).toBe(
      "Post-turn",
    );
    expect(formatTurnPolicyDecisionAction("follow_up")).toBe("Follow Up");
    expect(formatTurnPolicyDecisionAction("interrupt")).toBe("Interrupt");
    expect(formatTurnPolicyDecisionAction("none")).toBe("None");
    expect(formatTurnPolicyDecisionSource("interactive")).toBe("Interactive");
    expect(formatTurnPolicyDecisionSource("automation")).toBe("Automation");
    expect(formatTurnPolicyDecisionSource("automatic")).toBe("Automation");
    expect(formatTurnPolicyDecisionSource("workspace")).toBe("Workspace");
    expect(formatTurnPolicyInterruptNoActiveTurnBehavior("skip")).toBe("Skip");
    expect(formatTurnPolicyInterruptNoActiveTurnBehavior("followUp")).toBe(
      "Follow Up",
    );
    expect(
      formatTurnPolicyAlertGovernanceAction("clearAcknowledgement"),
    ).toBe("Clear acknowledgement");
    expect(formatTurnPolicyAlertGovernanceAction("snooze24h")).toBe(
      "Snooze 24h",
    );
    expect(formatTurnPolicyAlertSeverity("warning")).toBe("Warning");
    expect(
      formatTurnPolicyAlertTitle({
        acknowledged: true,
        severity: "warning",
        title: "Automation actions are failing",
      }),
    ).toBe("[Warning] Automation actions are failing [Acknowledged]");
    expect(
      formatTurnPolicyAlertTitle(
        {
          acknowledged: true,
          severity: "warning",
          title: "Automation actions are failing",
        },
        { style: "inline" },
      ),
    ).toBe("Warning: Automation actions are failing (Acknowledged)");
    expect(formatTurnPolicyAlertCode("duplicate_skips_detected")).toBe(
      "Duplicate skips detected",
    );
    expect(formatTurnPolicyAlertCode("post_tool_use_latency_high")).toBe(
      "Post-tool-use latency high",
    );
    expect(
      formatTurnPolicyAlertCode("automation_action_success_below_target"),
    ).toBe("Automation action success below target");
  });

  it("formats alert policy notes with and without source prefixes", () => {
    const metrics = {
      alertPolicy: {
        acknowledgedCodes: [
          "automation_action_success_below_target",
          "duplicate_skips_detected",
          "post_tool_use_latency_high",
        ],
        acknowledgedCount: 3,
        suppressedCodes: ["duplicate_skips_detected"],
        suppressedCount: 1,
        snoozedCodes: [
          "automation_action_success_below_target",
          "duplicate_skips_detected",
          "post_tool_use_latency_high",
        ],
        snoozedCount: 3,
        snoozeUntil: "2026-04-10T06:45:00.000Z",
      },
    };

    expect(
      formatTurnPolicyAlertAcknowledgementNote(
        getTurnPolicyAlertAcknowledgementSummary(metrics),
      ),
    ).toBe(
      "3 alerts acknowledged as known issues in settings (Automation action success below target, Duplicate skips detected, +1 more).",
    );
    expect(
      formatTurnPolicyAlertSuppressionNote(
        getTurnPolicyAlertSuppressionSummary(metrics),
        { labelPrefix: "Automation" },
      ),
    ).toBe(
      "Automation: 1 alert suppressed by settings (Duplicate skips detected).",
    );
    expect(
      formatTurnPolicyAlertSnoozeNote(getTurnPolicyAlertSnoozeSummary(metrics), {
        labelPrefix: "Automation",
      }),
    ).toBe(
      `Automation: 3 alerts temporarily snoozed until ${formatLocalizedDateTime("2026-04-10T06:45:00.000Z")} (Automation action success below target, Duplicate skips detected, +1 more).`,
    );
  });

  it("sorts metric alerts consistently and exposes top-alert helpers", () => {
    const metrics = {
      alerts: [
        {
          code: "z_info",
          severity: "info",
          title: "Info alert",
        },
        {
          code: "a_warning",
          severity: "warning",
          title: "Warning alert",
        },
        {
          code: "ranked_alert",
          rank: 1,
          severity: "info",
          title: "Ranked alert",
        },
      ],
    };

    expect(getTurnPolicyMetricAlerts(metrics).map((alert) => alert.code)).toEqual(
      ["ranked_alert", "a_warning", "z_info"],
    );
    expect(getTopTurnPolicyMetricAlert(metrics)?.code).toBe("ranked_alert");
    expect(formatTurnPolicyNoActiveAlertsLabel()).toBe("No active alerts");
  });

  it("formats shared metric summaries consistently", () => {
    expect(formatTurnPolicyMetricRate(0.8333, 6)).toBe("83.3%");
    expect(
      formatTurnPolicyMetricSuccessValue(0.8333, 5, 6, {
        includeSuccessLabel: true,
      }),
    ).toBe("83.3% success (5 / 6)");
    expect(formatTurnPolicyMetricSuccessValue(0.8333, 5, 6)).toBe(
      "83.3% (5 / 6)",
    );
    expect(
      formatTurnPolicyMetricSuccessValue(0, 0, 0, {
        includeSuccessLabel: true,
        noActionAttemptsLabel: true,
      }),
    ).toBe("No action attempts");
    expect(formatTurnPolicyMetricDecisionSuccessSummary(3, 1, 2)).toBe(
      "3 decisions, 100% success",
    );
    expect(formatTurnPolicyMetricDecisionCount(1)).toBe("1 decision");
    expect(formatTurnPolicyMetricAlertCount(1)).toBe("1 alert");
    expect(formatTurnPolicyMetricAlertCount(2)).toBe("2 alerts");
    expect(formatTurnPolicyMetricDecisionSummary(3, 1, 2, 1)).toBe(
      "3 decisions, 100% success, 1 skipped",
    );
    expect(
      formatTurnPolicyMetricDecisionSummary(0, 0, 0, 0, {
        zeroOnly: true,
      }),
    ).toBe("0 decisions");
    expect(
      formatTurnPolicyMetricActivityMeta({
        total: 1,
        alerts: 1,
        skipped: 1,
      }),
    ).toBe("1 decision, 1 alert, 1 skipped");
    expect(
      formatTurnPolicyMetricHealthMeta({
        total: 1,
        skipped: 1,
        alerts: 1,
      }),
    ).toBe("1 decision, 1 skipped, 1 alert");
    expect(formatTurnPolicyMetricLatencyRange(510, 1280)).toBe(
      "P50 510 ms, P95 1,280 ms",
    );
    expect(formatTurnPolicyMetricPostStopLatencyFooter(700, 320)).toBe(
      "Post P95 700 ms, Stop P95 320 ms",
    );
    expect(
      formatTurnPolicyMetricCoverageAlertsFooter(0.75, 4, {
        alertCount: 2,
        postLatencyMs: 700,
        stopLatencyMs: 320,
      }),
    ).toBe("Coverage 75%, Alerts 2, Post P95 700 ms, Stop P95 320 ms");
    expect(
      formatTurnPolicyMetricCoverageLatencyFooter(0.75, 4, {
        postLatencyMs: 700,
        stopLatencyMs: 320,
        omitEmptyLatencies: true,
      }),
    ).toBe("Coverage 75%, Post P95 700 ms, Stop P95 320 ms");
    expect(
      formatTurnPolicyMetricTopAlertMeta({
        rank: 1,
        message: "Needs review",
      }),
    ).toBe("Rank 1: Needs review");
  });

  it("preserves freeform decision reasons instead of title-casing sentences", () => {
    expect(
      formatTurnPolicyDecisionReason(
        "The turn changed files without a successful verify step.",
      ),
    ).toBe("The turn changed files without a successful verify step.");
  });
});
