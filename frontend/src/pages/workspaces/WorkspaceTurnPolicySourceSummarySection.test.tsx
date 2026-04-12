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
import type { TurnPolicyMetricsSummary } from "../../types/api";
import { i18n } from "../../i18n/runtime";
import { WorkspaceTurnPolicySourceSummarySection } from "./WorkspaceTurnPolicySourceSummarySection";

const governanceHookState = vi.hoisted(() => ({
  useTurnPolicyAlertGovernanceActions: vi.fn(),
}));

vi.mock("./useTurnPolicyAlertGovernanceActions", () => ({
  useTurnPolicyAlertGovernanceActions:
    governanceHookState.useTurnPolicyAlertGovernanceActions,
}));

describe("WorkspaceTurnPolicySourceSummarySection", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
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
        <WorkspaceTurnPolicySourceSummarySection
          source="automation"
          turnPolicyMetricsLoading
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Loading automation turn policy metrics…"),
    ).toBeTruthy();
  });

  it("renders error state", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicySourceSummarySection
          source="bot"
          turnPolicyMetricsError="request failed"
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Bot turn policy metrics unavailable"),
    ).toBeTruthy();
    expect(screen.getByText("request failed")).toBeTruthy();
  });

  it("renders a source-scoped summary and drills down with the source preserved", () => {
    const onDrillDown = vi.fn();
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
      source: "automation",
      decisions: {
        total: 4,
        actionAttempts: 3,
        actionSucceeded: 2,
        actionSuccessRate: 0.6667,
        actionStatusCounts: {
          succeeded: 2,
          failed: 0,
          skipped: 2,
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
          total: 2,
          duplicateFingerprint: 1,
          followUpCooldownActive: 1,
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
          total: 4,
          actionAttempts: 3,
          actionSucceeded: 2,
          actionSuccessRate: 0.6667,
          skipped: 2,
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
        completedWithFileChange: 2,
        missingSuccessfulVerification: 1,
        missingSuccessfulVerificationRate: 0.5,
        failedValidationCommand: 2,
        failedValidationWithPolicyAction: 1,
        failedValidationWithPolicyActionRate: 0.5,
      },
      audit: {
        coveredTurns: 3,
        eligibleTurns: 4,
        coverageRate: 0.75,
        coverageDefinition: "Coverage only counts eligible automation turns.",
      },
      timings: {
        postToolUseDecisionLatency: {
          p50Ms: 240,
          p95Ms: 620,
        },
        stopDecisionLatency: {
          p50Ms: 130,
          p95Ms: 280,
        },
      },
      recentWindows: {
        lastHour: {
          label: "Last hour",
          decisions: {
            total: 2,
            actionAttempts: 2,
            actionSucceeded: 1,
            actionSuccessRate: 0.5,
            skipped: 1,
          },
          alerts: {
            total: 1,
          },
          timings: {
            postToolUseDecisionLatency: {
              p95Ms: 700,
            },
            stopDecisionLatency: {
              p95Ms: 320,
            },
          },
        },
        last24Hours: {
          label: "Last 24 hours",
          decisions: {
            total: 4,
            actionAttempts: 3,
            actionSucceeded: 2,
            actionSuccessRate: 0.6667,
            skipped: 2,
          },
          alerts: {
            total: 2,
          },
          timings: {
            postToolUseDecisionLatency: {
              p95Ms: 620,
            },
            stopDecisionLatency: {
              p95Ms: 280,
            },
          },
        },
      },
      alerts: [
        {
          code: "automation_failure",
          severity: "warning",
          title: "Automation failure needs review",
          message: "Action failures are still present in the latest hour.",
          acknowledged: true,
          source: "automation",
          actionStatus: "failed",
          rank: 1,
        },
        {
          code: "automation_skips",
          severity: "warning",
          title: "Automation skips need review",
          message: "Skipped automation actions are rising.",
          source: "automation",
          actionStatus: "skipped",
          reason: "duplicate_fingerprint",
          rank: 2,
        },
      ],
      alertPolicy: {
        acknowledgedCodes: [
          "automation_failure",
          "automation_skips",
          "post_tool_use_latency_high",
        ],
        acknowledgedCount: 3,
        suppressedCodes: ["duplicate_skips_detected"],
        suppressedCount: 1,
        snoozedCodes: [
          "automation_action_failures",
          "duplicate_skips_detected",
          "cooldown_skips_detected",
        ],
        snoozedCount: 3,
        snoozeUntil: "2026-04-10T03:20:00.000Z",
      },
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicySourceSummarySection
          ctaLabel="Open automation review"
          ctaTo="/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1"
          onDrillDown={onDrillDown}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          source="automation"
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Automation Turn Policy Summary")).toBeTruthy();
    expect(
      screen.getByText("Focused on automation decisions for Alpha Workspace."),
    ).toBeTruthy();
    expect(screen.getByText("Top Alert")).toBeTruthy();
    expect(
      screen.getByText(
        "1 alert suppressed by settings (Duplicate skips detected).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "3 alerts acknowledged as known issues in settings (Automation Failure, Automation Skips, +1 more).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `3 alerts temporarily snoozed until ${formatLocalizedDateTime("2026-04-10T03:20:00.000Z")} (Automation action failures, Duplicate skips detected, +1 more).`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "[Warning] Automation failure needs review [Acknowledged]",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Inspect source alert Automation failure needs review",
      }),
    ).toBeTruthy();
    expect(screen.getByText("Attention Needed")).toBeTruthy();
    expect(screen.getByText("Recent Windows")).toBeTruthy();
    expect(screen.getByText("Last hour")).toBeTruthy();
    expect(screen.getByText("Last 24 hours")).toBeTruthy();
    expect(screen.getByText("50% success (1 / 2)")).toBeTruthy();
    expect(screen.getByText("66.7% success (2 / 3)")).toBeTruthy();
    expect(screen.getByText("Post P95 700 ms, Stop P95 320 ms")).toBeTruthy();
    expect(screen.getByText("Action success")).toBeTruthy();
    expect(screen.getByText("66.7% (2 / 3)")).toBeTruthy();
    expect(screen.getByText("Audit Coverage")).toBeTruthy();
    expect(screen.getAllByText("75%").length).toBeGreaterThan(0);
    expect(screen.getByText("Skipped decisions")).toBeTruthy();
    expect(screen.getByText("Duplicate skips")).toBeTruthy();
    expect(screen.getByText("Cooldown skips")).toBeTruthy();
    expect(screen.getByText("Interrupt skips")).toBeTruthy();
    expect(screen.getByText("P50 240 ms, P95 620 ms")).toBeTruthy();
    expect(
      screen.getByText("Coverage only counts eligible automation turns."),
    ).toBeTruthy();

    const cta = screen.getByRole("link", { name: "Open automation review" });
    expect(cta.getAttribute("href")).toBe(
      "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1",
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect automation action success decisions",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "succeeded",
      policyName: "",
      reason: "",
      source: "automation",
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Inspect source alert Automation failure needs review",
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
        name: "Inspect automation interrupt skips",
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      action: "",
      actionStatus: "skipped",
      policyName: "",
      reason: "interrupt_no_active_turn",
      source: "automation",
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Clear acknowledgement" }),
    );
    expect(applyAlertGovernanceAction).toHaveBeenCalledWith({
      type: "clearAcknowledgement",
      code: "automation_failure",
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Snooze 24h" })[1]);
    expect(applyAlertGovernanceAction).toHaveBeenCalledWith({
      type: "snooze24h",
      code: "automation_skips",
    });
  });

  it("renders source alert governance feedback", () => {
    governanceHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction: vi.fn(),
      applyAlertGovernanceActionAsync: vi.fn(),
      error: "request failed",
      isPending: true,
      pendingAction: { type: "snooze24h", code: "automation_failure" },
    });

    const turnPolicyMetrics = {
      workspaceId: "ws-1",
      source: "automation",
      decisions: {
        total: 1,
        actionAttempts: 1,
        actionSucceeded: 1,
        actionSuccessRate: 1,
        actionStatusCounts: { succeeded: 1, failed: 0, skipped: 0, other: 0 },
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
        coverageDefinition: "Coverage only counts eligible automation turns.",
      },
      timings: {
        postToolUseDecisionLatency: { p50Ms: 100, p95Ms: 100 },
        stopDecisionLatency: { p50Ms: 50, p95Ms: 50 },
      },
      alerts: [
        {
          code: "automation_failure",
          severity: "warning",
          title: "Automation failure needs review",
          message: "Action failures are still present in the latest hour.",
          source: "automation",
          actionStatus: "failed",
        },
      ],
    } as TurnPolicyMetricsSummary;

    render(
      <MemoryRouter>
        <WorkspaceTurnPolicySourceSummarySection
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          source="automation"
          turnPolicyMetrics={turnPolicyMetrics}
          turnPolicyMetricsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Applying alert governance…")).toBeTruthy();
    expect(screen.getByText("Alert governance update failed")).toBeTruthy();
    expect(screen.getByText("request failed")).toBeTruthy();
  });
});
