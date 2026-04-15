// @vitest-environment jsdom

import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { formatLocalizedDateTime } from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import type { TurnPolicyMetricsSummary } from "../../types/api";
import { WorkspaceTurnPolicyOverviewSection } from "./WorkspaceTurnPolicyOverviewSection";

const governanceHookState = vi.hoisted(() => ({
  useTurnPolicyAlertGovernanceActions: vi.fn(),
}));

vi.mock("./useTurnPolicyAlertGovernanceActions", () => ({
  useTurnPolicyAlertGovernanceActions:
    governanceHookState.useTurnPolicyAlertGovernanceActions,
}));

describe("WorkspaceTurnPolicyOverviewSection", () => {
  let zhMessages: Record<string, string>;

  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeAll(async () => {
    zhMessages = (
      await import("../../locales/zh-CN/messages.po")
    ).messages as Record<string, string>;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    governanceHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction: vi.fn(),
      applyAlertGovernanceActionAsync: vi.fn(),
      error: null,
      isPending: false,
      pendingAction: undefined,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders loading state", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection turnPolicyMetricsLoading />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Loading workspace turn policy metrics…"),
    ).toBeTruthy();
  });

  it("renders the empty workspace selection state", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection turnPolicyMetricsLoading={false} />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Select a workspace to inspect turn policy metrics."),
    ).toBeTruthy();
  });

  it("renders core metrics and workspace CTA", () => {
    const onDrillDown = vi.fn();
    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      generatedAt: "2026-04-08T12:00:00.000Z",
      decisions: {
        total: 8,
        actionAttempts: 6,
        actionSucceeded: 5,
        actionSuccessRate: 0.8333,
        actionStatusCounts: {
          succeeded: 5,
          failed: 1,
          skipped: 2,
          other: 0,
        },
        actionCounts: {
          steer: 3,
          followUp: 2,
          interrupt: 1,
          none: 3,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 3,
          missingSuccessfulVerification: 5,
          other: 0,
        },
        skipReasonCounts: {
          total: 2,
          duplicateFingerprint: 1,
          followUpCooldownActive: 1,
          interruptNoActiveTurn: 0,
          other: 0,
        },
      },
      sources: {
        interactive: {
          total: 3,
          actionAttempts: 2,
          actionSucceeded: 1,
          actionSuccessRate: 0.5,
          skipped: 1,
        },
        automation: {
          total: 3,
          actionAttempts: 2,
          actionSucceeded: 2,
          actionSuccessRate: 1,
          skipped: 1,
        },
        bot: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
        other: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
      },
      turns: {
        completedWithFileChange: 5,
        missingSuccessfulVerification: 2,
        missingSuccessfulVerificationRate: 0.4,
        failedValidationCommand: 4,
        failedValidationWithPolicyAction: 3,
        failedValidationWithPolicyActionRate: 0.75,
      },
      audit: {
        coveredTurns: 9,
        eligibleTurns: 12,
        coverageRate: 0.75,
        coverageDefinition: "Coverage only counts eligible workspace turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 510,
          p95Ms: 1280,
        },
        stopDecisionLatency: {
          p50Ms: 150,
          p95Ms: 330,
        },
      },
      alerts: [
        {
          code: "automation_action_failures",
          severity: "warning",
          title: "Automation actions are failing",
          message: "Automation action success is below target.",
          acknowledged: true,
          source: "automation",
          actionStatus: "failed",
        },
        {
          code: "automation_duplicate_skips",
          severity: "info",
          title: "Automation duplicate skips are accumulating",
          message: "Automation duplicate fingerprint skips need review.",
          source: "automation",
          actionStatus: "skipped",
          reason: "duplicate_fingerprint",
        },
        {
          code: "bot_action_failures",
          severity: "warning",
          title: "Bot actions are failing",
          message: "Bot action success is below target.",
          source: "bot",
          actionStatus: "failed",
        },
      ],
      alertPolicy: {
        acknowledgedCodes: [
          "automation_action_failures",
          "bot_action_failures",
          "missing_verify_rate_high",
        ],
        acknowledgedCount: 3,
        suppressedCodes: [
          "duplicate_skips_detected",
          "cooldown_skips_detected",
          "post_tool_use_latency_high",
        ],
        suppressedCount: 3,
        snoozedCodes: [
          "automation_action_failures",
          "bot_action_failures",
          "stop_decision_latency_high",
        ],
        snoozedCount: 3,
        snoozeUntil: "2026-04-10T04:30:00.000Z",
      },
      config: {
        postToolUseFailedValidationPolicyEnabled: true,
        postToolUsePrimaryAction: "interrupt",
        postToolUseFollowUpCooldownMs: 30000,
        stopMissingSuccessfulVerificationPolicyEnabled: false,
        stopMissingSuccessfulVerificationPrimaryAction: "followUp",
        stopMissingSuccessfulVerificationFollowUpCooldownMs: 180000,
        followUpCooldownMs: 120000,
      },
    } as TurnPolicyMetricsSummary & {
      config: {
        followUpCooldownMs: number;
        postToolUseFollowUpCooldownMs: number;
        postToolUsePrimaryAction: string;
        postToolUseFailedValidationPolicyEnabled: boolean;
        stopMissingSuccessfulVerificationFollowUpCooldownMs: number;
        stopMissingSuccessfulVerificationPrimaryAction: string;
        stopMissingSuccessfulVerificationPolicyEnabled: boolean;
      };
    };

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          metricsSourceScope="automation"
          onDrillDown={onDrillDown}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsError={null}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Open governance activity" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("link", { name: "Open governance activity" }),
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "activity",
    );

    expect(screen.getByText("Workspace Turn Policy Overview")).toBeTruthy();
    expect(
      screen.getByText("Viewing automation source metrics only."),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "3 alerts suppressed by settings (Duplicate skips detected, Cooldown skips detected, +1 more).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "3 alerts acknowledged as known issues in settings (Automation action failures, Bot action failures, +1 more).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `3 alerts temporarily snoozed until ${formatLocalizedDateTime("2026-04-10T04:30:00.000Z")} (Automation action failures, Bot action failures, +1 more).`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "[Warning] Automation actions are failing [Acknowledged]",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Source Focus")).toBeTruthy();
    expect(screen.getByText("Automation focus")).toBeTruthy();
    expect(screen.getByText("Bot focus")).toBeTruthy();
    expect(screen.getByText("3 decisions")).toBeTruthy();
    expect(screen.getByText("100% success (2 / 2)")).toBeTruthy();
    expect(screen.getByText("2 alerts")).toBeTruthy();
    expect(screen.getByText("1 decision")).toBeTruthy();
    expect(screen.getAllByText("100% success (1 / 1)").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("1 alert")).toBeTruthy();
    expect(screen.getByText("Decisions")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("Audit Coverage")).toBeTruthy();
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
    expect(screen.getByText("Validation Rescue")).toBeTruthy();
    expect(screen.getByText("Missing Verify")).toBeTruthy();
    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText("Execution Controls")).toBeTruthy();
    expect(screen.getByText("Default follow-up cooldown")).toBeTruthy();
    expect(
      screen.getByText("Used when a policy does not set its own cooldown."),
    ).toBeTruthy();
    expect(screen.getByText("Setting")).toBeTruthy();
    expect(screen.getByText("Post-tool-use")).toBeTruthy();
    expect(screen.getByText("Missing verify")).toBeTruthy();
    expect(screen.getByText("Policy state")).toBeTruthy();
    expect(screen.getByText("Primary action")).toBeTruthy();
    expect(screen.getByText("Interrupt fallback")).toBeTruthy();
    expect(screen.getAllByText("Follow-up cooldown").length).toBeGreaterThan(0);
    expect(screen.getByText("Enabled")).toBeTruthy();
    expect(screen.getByText("Disabled")).toBeTruthy();
    expect(screen.getAllByText("Interrupt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Follow Up").length).toBeGreaterThan(0);
    expect(screen.getByText("2 min")).toBeTruthy();
    expect(screen.getByText("30 s")).toBeTruthy();
    expect(screen.getByText("3 min")).toBeTruthy();
    expect(screen.getByText("Interrupt actions")).toBeTruthy();
    expect(
      screen.getByText("Interrupt actions").closest(".detail-row")?.textContent,
    ).toContain("1");
    expect(screen.getByText("Action success")).toBeTruthy();
    expect(screen.getByText("83.3% (5 / 6)")).toBeTruthy();
    expect(screen.getByText("Interactive decisions")).toBeTruthy();
    expect(
      screen.getByText("3 decisions, 50% success, 1 skipped"),
    ).toBeTruthy();
    expect(screen.getByText("Automation decisions")).toBeTruthy();
    expect(
      screen.getByText("3 decisions, 100% success, 1 skipped"),
    ).toBeTruthy();
    expect(screen.getByText("Bot decisions")).toBeTruthy();
    expect(
      screen.getAllByText("1 decision, 100% success, 0 skipped").length,
    ).toBe(2);
    expect(screen.getByText("Other-source decisions")).toBeTruthy();
    expect(screen.getByText("Post-tool-use latency")).toBeTruthy();
    expect(screen.getByText("P50 510 ms, P95 1,280 ms")).toBeTruthy();
    expect(screen.getByText("Stop decision latency")).toBeTruthy();
    expect(screen.getByText("P50 150 ms, P95 330 ms")).toBeTruthy();
    expect(
      screen.getByText("Coverage only counts eligible workspace turns."),
    ).toBeTruthy();

    const cta = screen.getByRole("link", { name: "Open workspace" });
    expect(cta.getAttribute("href")).toBe("/workspaces/ws-1");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect Validation Rescue decisions",
      }),
    );
    expect(onDrillDown).toHaveBeenCalledWith({
      action: "",
      actionStatus: "succeeded",
      policyName: "posttooluse/failed-validation-command",
      reason: "",
      source: "",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Steer actions decisions" }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "steer",
      actionStatus: "",
      policyName: "",
      reason: "",
      source: "",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect Automation source focus decisions",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "",
      policyName: "",
      reason: "",
      source: "automation",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect Interrupt actions decisions",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "interrupt",
      actionStatus: "",
      policyName: "",
      reason: "",
      source: "",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Automation decisions" }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "",
      policyName: "",
      reason: "",
      source: "automation",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Duplicate skips decisions" }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "skipped",
      policyName: "",
      reason: "duplicate_fingerprint",
      source: "",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Inspect Interrupt skips decisions" }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "skipped",
      policyName: "",
      reason: "interrupt_no_active_turn",
      source: "",
    });
  });

  it("renders dedicated automation and bot health summaries when unscoped", () => {
    const onDrillDown = vi.fn();
    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      generatedAt: "2026-04-08T12:00:00.000Z",
      decisions: {
        total: 5,
        actionAttempts: 4,
        actionSucceeded: 3,
        actionSuccessRate: 0.75,
        actionStatusCounts: {
          succeeded: 3,
          failed: 1,
          skipped: 1,
          other: 0,
        },
        actionCounts: {
          steer: 2,
          followUp: 2,
          interrupt: 0,
          none: 1,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 2,
          missingSuccessfulVerification: 3,
          other: 0,
        },
        skipReasonCounts: {
          total: 1,
          duplicateFingerprint: 1,
          followUpCooldownActive: 0,
          interruptNoActiveTurn: 0,
          other: 0,
        },
      },
      sources: {
        interactive: {
          total: 2,
          actionAttempts: 2,
          actionSucceeded: 2,
          actionSuccessRate: 1,
          skipped: 0,
        },
        automation: {
          total: 2,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 1,
        },
        bot: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
        other: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
      },
      turns: {
        completedWithFileChange: 3,
        missingSuccessfulVerification: 1,
        missingSuccessfulVerificationRate: 0.3333,
        failedValidationCommand: 2,
        failedValidationWithPolicyAction: 1,
        failedValidationWithPolicyActionRate: 0.5,
      },
      audit: {
        coveredTurns: 3,
        eligibleTurns: 3,
        coverageRate: 1,
        coverageDefinition: "Coverage only counts eligible workspace turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 120,
          p95Ms: 320,
        },
        stopDecisionLatency: {
          p50Ms: 80,
          p95Ms: 180,
        },
      },
      alerts: [],
    } as TurnPolicyMetricsSummary;
    const automationSourceHealth = {
      ...turnPolicyMetrics,
      source: "automation",
      decisions: {
        ...turnPolicyMetrics.decisions,
        total: 3,
        actionAttempts: 3,
        actionSucceeded: 2,
        actionSuccessRate: 0.6667,
        actionStatusCounts: {
          succeeded: 2,
          failed: 0,
          skipped: 1,
          other: 0,
        },
      },
      audit: {
        coveredTurns: 2,
        eligibleTurns: 2,
        coverageRate: 1,
        coverageDefinition: "Coverage only counts eligible automation turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 180,
          p95Ms: 420,
        },
        stopDecisionLatency: {
          p50Ms: 110,
          p95Ms: 210,
        },
      },
      alerts: [
        {
          code: "automation_action_failures",
          severity: "warning",
          title: "Automation actions are failing",
          message: "Automation action success is below target.",
          source: "automation",
        },
      ],
    } as TurnPolicyMetricsSummary;
    const botSourceHealth = {
      ...turnPolicyMetrics,
      source: "bot",
      decisions: {
        ...turnPolicyMetrics.decisions,
        total: 2,
        actionAttempts: 1,
        actionSucceeded: 1,
        actionSuccessRate: 1,
        actionStatusCounts: {
          succeeded: 1,
          failed: 0,
          skipped: 1,
          other: 0,
        },
      },
      audit: {
        coveredTurns: 1,
        eligibleTurns: 2,
        coverageRate: 0.5,
        coverageDefinition: "Coverage only counts eligible bot turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 90,
          p95Ms: 140,
        },
        stopDecisionLatency: {
          p50Ms: 70,
          p95Ms: 160,
        },
      },
      alerts: [],
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          onDrillDown={onDrillDown}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsError={null}
          turnPolicyMetricsLoading={false}
          turnPolicySourceHealth={{
            automation: automationSourceHealth,
            bot: botSourceHealth,
            loading: false,
            error: null,
          }}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Automation & Bot Health")).toBeTruthy();
    expect(screen.getByText("Automation health")).toBeTruthy();
    expect(screen.getByText("Bot health")).toBeTruthy();
    expect(screen.getByText("66.7% success (2 / 3)")).toBeTruthy();
    expect(screen.getAllByText("100% success (1 / 1)").length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("3 decisions, 1 skipped, 1 alert")).toBeTruthy();
    expect(screen.getByText("2 decisions, 1 skipped, 0 alerts")).toBeTruthy();
    expect(
      screen.getByText("Coverage 100%, Post P95 420 ms, Stop P95 210 ms"),
    ).toBeTruthy();
    expect(
      screen.getByText("Coverage 50%, Post P95 140 ms, Stop P95 160 ms"),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect Automation health overview",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "",
      policyName: "",
      reason: "",
      source: "automation",
    });
  });

  it("renders alerts and drills down for filterable entries", () => {
    const onDrillDown = vi.fn();
    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      decisions: {
        total: 4,
        actionAttempts: 3,
        actionSucceeded: 2,
        actionSuccessRate: 0.6667,
        actionStatusCounts: {
          succeeded: 2,
          failed: 1,
          skipped: 1,
          other: 0,
        },
        actionCounts: {
          steer: 1,
          followUp: 2,
          interrupt: 0,
          none: 1,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 2,
          missingSuccessfulVerification: 2,
          other: 0,
        },
        skipReasonCounts: {
          total: 1,
          duplicateFingerprint: 1,
          followUpCooldownActive: 0,
          interruptNoActiveTurn: 0,
          other: 0,
        },
      },
      sources: {
        interactive: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
        automation: {
          total: 2,
          actionAttempts: 2,
          actionSucceeded: 1,
          actionSuccessRate: 0.5,
          skipped: 0,
        },
        bot: {
          total: 1,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 1,
        },
        other: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
      },
      turns: {
        completedWithFileChange: 2,
        missingSuccessfulVerification: 1,
        missingSuccessfulVerificationRate: 0.5,
        failedValidationCommand: 2,
        failedValidationWithPolicyAction: 1,
        failedValidationWithPolicyActionRate: 0.5,
      },
      audit: {
        coveredTurns: 1,
        eligibleTurns: 2,
        coverageRate: 0.5,
        coverageDefinition: "Coverage only counts eligible workspace turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 400,
          p95Ms: 1200,
        },
        stopDecisionLatency: {
          p50Ms: 300,
          p95Ms: 1300,
        },
      },
      alerts: [
        {
          code: "automation_action_failures",
          severity: "warning",
          title: "Automation actions are failing",
          message: "Automation action success is below target.",
          source: "automation",
          actionStatus: "failed",
        },
        {
          code: "duplicate_skips",
          severity: "info",
          title: "Duplicate skips are accumulating",
          message: "Duplicate fingerprint skips need review.",
          actionStatus: "skipped",
          reason: "duplicate_fingerprint",
        },
        {
          code: "slow_post_tool_use",
          severity: "warning",
          title: "Post-tool-use decisions are slow",
          message: "P95 latency is above 1,000 ms.",
        },
        {
          code: "incomplete_audit_coverage",
          severity: "warning",
          title: "Audit coverage is incomplete",
          message: "Not all eligible turns have policy decisions.",
        },
        {
          code: "hidden_fifth_alert",
          severity: "info",
          title: "Hidden fifth alert",
          message: "This one should not render.",
        },
      ],
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          onDrillDown={onDrillDown}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Attention Needed")).toBeTruthy();
    expect(
      screen.getByText("[Warning] Automation actions are failing"),
    ).toBeTruthy();
    expect(
      screen.getByText("Automation action success is below target."),
    ).toBeTruthy();
    expect(
      screen.getByText("[Info] Duplicate skips are accumulating"),
    ).toBeTruthy();
    expect(
      screen.getByText("[Warning] Post-tool-use decisions are slow"),
    ).toBeTruthy();
    expect(
      screen.getByText("[Warning] Audit coverage is incomplete"),
    ).toBeTruthy();
    expect(screen.queryByText("[Info] Hidden fifth alert")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect alert Automation actions are failing",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "failed",
      policyName: "",
      reason: "",
      source: "automation",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect alert Duplicate skips are accumulating",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "skipped",
      policyName: "",
      reason: "duplicate_fingerprint",
      source: "",
    });

    expect(
      screen.queryByRole("button", {
        name: "Inspect alert Post-tool-use decisions are slow",
      }),
    ).toBeNull();
  });

  it("renders alert quick actions and feedback", () => {
    const applyAlertGovernanceAction = vi.fn();
    governanceHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction,
      applyAlertGovernanceActionAsync: vi.fn(),
      error: "update failed",
      isPending: true,
      pendingAction: { type: "snooze24h", code: "automation_action_failures" },
    });

    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      decisions: {
        total: 2,
        actionAttempts: 2,
        actionSucceeded: 1,
        actionSuccessRate: 0.5,
        actionStatusCounts: {
          succeeded: 1,
          failed: 1,
          skipped: 0,
          other: 0,
        },
        actionCounts: {
          steer: 1,
          followUp: 1,
          interrupt: 0,
          none: 0,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 1,
          missingSuccessfulVerification: 1,
          other: 0,
        },
        skipReasonCounts: {
          total: 0,
          duplicateFingerprint: 0,
          followUpCooldownActive: 0,
          interruptNoActiveTurn: 0,
          other: 0,
        },
      },
      sources: {
        interactive: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
        automation: {
          total: 2,
          actionAttempts: 2,
          actionSucceeded: 1,
          actionSuccessRate: 0.5,
          skipped: 0,
        },
        bot: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
        other: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
      },
      turns: {
        completedWithFileChange: 1,
        missingSuccessfulVerification: 0,
        missingSuccessfulVerificationRate: 0,
        failedValidationCommand: 1,
        failedValidationWithPolicyAction: 1,
        failedValidationWithPolicyActionRate: 1,
      },
      audit: {
        coveredTurns: 2,
        eligibleTurns: 2,
        coverageRate: 1,
        coverageDefinition: "Coverage only counts eligible workspace turns.",
      },
      timings: {
        postToolUseDecisionLatency: { p50Ms: 100, p95Ms: 200 },
        stopDecisionLatency: { p50Ms: 50, p95Ms: 100 },
      },
      alerts: [
        {
          code: "automation_action_failures",
          severity: "warning",
          title: "Automation actions are failing",
          message: "Automation action success is below target.",
          acknowledged: true,
          source: "automation",
          actionStatus: "failed",
        },
        {
          code: "bot_action_failures",
          severity: "warning",
          title: "Bot actions are failing",
          message: "Bot action success is below target.",
          source: "bot",
          actionStatus: "failed",
        },
      ],
      alertPolicy: {
        acknowledgedCodes: ["automation_action_failures"],
        acknowledgedCount: 1,
        snoozedCodes: ["automation_action_failures"],
        snoozedCount: 1,
        snoozeUntil: "2026-04-10T03:20:00.000Z",
      },
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          onDrillDown={vi.fn()}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Applying alert governance…")).toBeTruthy();
    expect(screen.getByText("Alert governance update failed")).toBeTruthy();
    expect(screen.getByText("update failed")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Clear acknowledgement" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Clear snooze" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Acknowledge" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen
        .getByRole("button", { name: "Snooze 24h" })
        .hasAttribute("disabled"),
    ).toBe(true);

    governanceHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction,
      applyAlertGovernanceActionAsync: vi.fn(),
      error: null,
      isPending: false,
      pendingAction: undefined,
    });
  });

  it("applies alert quick actions from overview rows", () => {
    const applyAlertGovernanceAction = vi.fn();
    governanceHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction,
      applyAlertGovernanceActionAsync: vi.fn(),
      error: null,
      isPending: false,
      pendingAction: undefined,
    });

    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      decisions: {
        total: 2,
        actionAttempts: 2,
        actionSucceeded: 2,
        actionSuccessRate: 1,
        actionStatusCounts: { succeeded: 2, failed: 0, skipped: 0, other: 0 },
        actionCounts: {
          steer: 1,
          followUp: 1,
          interrupt: 0,
          none: 0,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 1,
          missingSuccessfulVerification: 1,
          other: 0,
        },
        skipReasonCounts: {
          total: 0,
          duplicateFingerprint: 0,
          followUpCooldownActive: 0,
          interruptNoActiveTurn: 0,
          other: 0,
        },
      },
      sources: {
        interactive: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
        automation: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
        bot: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
        other: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
      },
      turns: {
        completedWithFileChange: 2,
        missingSuccessfulVerification: 0,
        missingSuccessfulVerificationRate: 0,
        failedValidationCommand: 1,
        failedValidationWithPolicyAction: 1,
        failedValidationWithPolicyActionRate: 1,
      },
      audit: {
        coveredTurns: 2,
        eligibleTurns: 2,
        coverageRate: 1,
        coverageDefinition: "Coverage only counts eligible workspace turns.",
      },
      timings: {
        postToolUseDecisionLatency: { p50Ms: 100, p95Ms: 100 },
        stopDecisionLatency: { p50Ms: 50, p95Ms: 50 },
      },
      alerts: [
        {
          code: "automation_action_failures",
          severity: "warning",
          title: "Automation actions are failing",
          message: "Automation action success is below target.",
          acknowledged: true,
          source: "automation",
          actionStatus: "failed",
        },
        {
          code: "bot_action_failures",
          severity: "warning",
          title: "Bot actions are failing",
          message: "Bot action success is below target.",
          source: "bot",
          actionStatus: "failed",
        },
      ],
      alertPolicy: {
        acknowledgedCodes: ["automation_action_failures"],
        acknowledgedCount: 1,
        snoozedCodes: ["automation_action_failures"],
        snoozedCount: 1,
        snoozeUntil: "2026-04-10T03:20:00.000Z",
      },
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Clear acknowledgement" }),
    );
    expect(applyAlertGovernanceAction).toHaveBeenCalledWith({
      type: "clearAcknowledgement",
      code: "automation_action_failures",
    });

    fireEvent.click(screen.getByRole("button", { name: "Snooze 24h" }));
    expect(applyAlertGovernanceAction).toHaveBeenCalledWith({
      type: "snooze24h",
      code: "bot_action_failures",
    });
  });

  it("hides execution controls when metrics config is unavailable", () => {
    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      decisions: {
        total: 1,
        actionAttempts: 1,
        actionSucceeded: 1,
        actionSuccessRate: 1,
        actionStatusCounts: {
          succeeded: 1,
          failed: 0,
          skipped: 0,
          other: 0,
        },
        actionCounts: {
          steer: 1,
          followUp: 0,
          interrupt: 0,
          none: 0,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 1,
          missingSuccessfulVerification: 0,
          other: 0,
        },
        skipReasonCounts: {
          total: 0,
          duplicateFingerprint: 0,
          followUpCooldownActive: 0,
          interruptNoActiveTurn: 0,
          other: 0,
        },
      },
      sources: {
        interactive: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
        automation: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
        bot: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
        other: {
          total: 0,
          actionAttempts: 0,
          actionSucceeded: 0,
          actionSuccessRate: 0,
          skipped: 0,
        },
      },
      turns: {
        completedWithFileChange: 1,
        missingSuccessfulVerification: 0,
        missingSuccessfulVerificationRate: 0,
        failedValidationCommand: 1,
        failedValidationWithPolicyAction: 1,
        failedValidationWithPolicyActionRate: 1,
      },
      audit: {
        coveredTurns: 1,
        eligibleTurns: 1,
        coverageRate: 1,
        coverageDefinition: "Coverage only counts eligible workspace turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 20,
          p95Ms: 30,
        },
        stopDecisionLatency: {
          p50Ms: 10,
          p95Ms: 15,
        },
      },
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Execution Controls")).toBeNull();
  });

  it("localizes alert drill-down aria labels in Chinese", () => {
    i18n.loadAndActivate({ locale: "zh-CN", messages: zhMessages });

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyOverviewSection
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          turnPolicyMetrics={{
            workspaceId: "ws-1",
            generatedAt: "2026-04-08T12:00:00.000Z",
            decisions: {
              total: 1,
              actionAttempts: 1,
              actionSucceeded: 0,
              actionSuccessRate: 0,
              actionStatusCounts: {
                succeeded: 0,
                failed: 1,
                skipped: 0,
                other: 0,
              },
              actionCounts: {
                steer: 0,
                followUp: 0,
                interrupt: 1,
                none: 0,
                other: 0,
              },
              policyCounts: {
                failedValidationCommand: 1,
                missingSuccessfulVerification: 0,
                other: 0,
              },
              skipReasonCounts: {
                total: 0,
                duplicateFingerprint: 0,
                followUpCooldownActive: 0,
                interruptNoActiveTurn: 0,
                other: 0,
              },
            },
            sources: {
              interactive: {
                total: 1,
                actionAttempts: 1,
                actionSucceeded: 0,
                actionSuccessRate: 0,
                skipped: 0,
              },
              automation: {
                total: 0,
                actionAttempts: 0,
                actionSucceeded: 0,
                actionSuccessRate: 0,
                skipped: 0,
              },
              bot: {
                total: 0,
                actionAttempts: 0,
                actionSucceeded: 0,
                actionSuccessRate: 0,
                skipped: 0,
              },
              other: {
                total: 0,
                actionAttempts: 0,
                actionSucceeded: 0,
                actionSuccessRate: 0,
                skipped: 0,
              },
            },
            turns: {
              completedWithFileChange: 1,
              missingSuccessfulVerification: 0,
              missingSuccessfulVerificationRate: 0,
              failedValidationCommand: 1,
              failedValidationWithPolicyAction: 1,
              failedValidationWithPolicyActionRate: 1,
            },
            audit: {
              coveredTurns: 1,
              eligibleTurns: 1,
              coverageRate: 1,
              coverageDefinition: "Coverage only counts eligible workspace turns.",
            },
            timings: {
              postToolUseDecisionLatency: {
                p50Ms: 120,
                p95Ms: 180,
              },
              stopDecisionLatency: {
                p50Ms: 90,
                p95Ms: 140,
              },
            },
            alerts: [
              {
                code: "post_tool_use_latency_high",
                severity: "warning",
                title: "Post-tool-use decisions are slow",
                message: "Review the slow decision path.",
                source: "automation",
                actionStatus: "failed",
              },
            ],
            alertPolicy: {
              acknowledgedCodes: [],
              acknowledgedCount: 0,
              suppressedCodes: [],
              suppressedCount: 0,
              snoozedCodes: [],
              snoozedCount: 0,
              snoozeUntil: undefined,
            },
            config: {
              postToolUseFailedValidationPolicyEnabled: true,
              stopMissingSuccessfulVerificationPolicyEnabled: true,
              postToolUsePrimaryAction: "interrupt",
              stopMissingSuccessfulVerificationPrimaryAction: "followUp",
              postToolUseInterruptNoActiveTurnBehavior: "skip",
              stopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
                "followUp",
              validationCommandPrefixes: ["npm test"],
              followUpCooldownMs: 60000,
              postToolUseFollowUpCooldownMs: 120000,
              stopMissingSuccessfulVerificationFollowUpCooldownMs: 180000,
            },
          } as TurnPolicyMetricsSummary}
          turnPolicyMetricsError={null}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", {
        name: "检查告警 Post-tool-use decisions are slow",
      }),
    ).toBeTruthy();
  });
});
