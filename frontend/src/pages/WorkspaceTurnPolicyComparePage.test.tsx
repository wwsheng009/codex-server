// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { formatLocalizedDateTime } from "../i18n/display";
import { i18n } from "../i18n/runtime";
import { WorkspaceTurnPolicyComparePage } from "./WorkspaceTurnPolicyComparePage";

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}));

const turnPolicyHookState = vi.hoisted(() => ({
  useWorkspaceTurnPolicyOverview: vi.fn(),
  useWorkspaceTurnPolicySourceComparison: vi.fn(),
  useTurnPolicyAlertGovernanceActions: vi.fn(),
}));

vi.mock("../features/workspaces/api", () => ({
  listWorkspaces: workspacesApiState.listWorkspaces,
}));

vi.mock("./workspaces/useWorkspaceTurnPolicyOverview", () => ({
  useWorkspaceTurnPolicyOverview:
    turnPolicyHookState.useWorkspaceTurnPolicyOverview,
}));

vi.mock("./workspaces/useWorkspaceTurnPolicySourceComparison", () => ({
  useWorkspaceTurnPolicySourceComparison:
    turnPolicyHookState.useWorkspaceTurnPolicySourceComparison,
}));

vi.mock("./workspaces/useTurnPolicyAlertGovernanceActions", () => ({
  useTurnPolicyAlertGovernanceActions:
    turnPolicyHookState.useTurnPolicyAlertGovernanceActions,
}));

function buildMetricsSummary(source: "interactive" | "automation" | "bot") {
  return {
    workspaceId: "ws-1",
    source,
    decisions: {
      total: 4,
      actionAttempts: 3,
      actionSucceeded: source === "bot" ? 3 : 2,
      actionSuccessRate: source === "bot" ? 1 : 0.6667,
      actionStatusCounts: {
        succeeded: source === "bot" ? 3 : 2,
        failed: 0,
        skipped: 1,
        other: 0,
      },
      actionCounts: {
        steer: 1,
        followUp: source === "interactive" ? 1 : 2,
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
        duplicateFingerprint: source === "automation" ? 1 : 0,
        followUpCooldownActive: 0,
        interruptNoActiveTurn: 0,
        other: 0,
      },
    },
    sources: {
      interactive: {
        total: source === "interactive" ? 4 : 0,
        actionAttempts: source === "interactive" ? 3 : 0,
        actionSucceeded: source === "interactive" ? 2 : 0,
        actionSuccessRate: source === "interactive" ? 0.6667 : 0,
        skipped: source === "interactive" ? 1 : 0,
      },
      automation: {
        total: source === "automation" ? 4 : 0,
        actionAttempts: source === "automation" ? 3 : 0,
        actionSucceeded: source === "automation" ? 2 : 0,
        actionSuccessRate: source === "automation" ? 0.6667 : 0,
        skipped: source === "automation" ? 1 : 0,
      },
      bot: {
        total: source === "bot" ? 4 : 0,
        actionAttempts: source === "bot" ? 3 : 0,
        actionSucceeded: source === "bot" ? 3 : 0,
        actionSuccessRate: source === "bot" ? 1 : 0,
        skipped: source === "bot" ? 1 : 0,
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
      coverageDefinition: "Coverage only counts eligible turns.",
    },
    timings: {
      postToolUseDecisionLatency: {
        p50Ms: 120,
        p95Ms: source === "bot" ? 220 : 420,
      },
      stopDecisionLatency: {
        p50Ms: 80,
        p95Ms: source === "interactive" ? 310 : 210,
      },
    },
    recentWindows: {
      lastHour: {
        label: "Last hour",
        decisions: {
          total: source === "interactive" ? 2 : 1,
          actionAttempts: 1,
          actionSucceeded: source === "bot" ? 1 : 0,
          actionSuccessRate: source === "bot" ? 1 : 0,
          skipped: source === "automation" ? 1 : 0,
        },
        alerts: {
          total: source === "automation" ? 1 : 0,
        },
        timings: {
          postToolUseDecisionLatency: {
            p95Ms: source === "interactive" ? 180 : 240,
          },
          stopDecisionLatency: {
            p95Ms: source === "bot" ? 190 : 260,
          },
        },
      },
      last24Hours: {
        label: "Last 24 hours",
        decisions: {
          total: 4,
          actionAttempts: 3,
          actionSucceeded: source === "bot" ? 3 : 2,
          actionSuccessRate: source === "bot" ? 1 : 0.6667,
          skipped: 1,
        },
        alerts: {
          total: source === "automation" ? 1 : 0,
        },
        timings: {
          postToolUseDecisionLatency: {
            p95Ms: source === "bot" ? 220 : 420,
          },
          stopDecisionLatency: {
            p95Ms: source === "interactive" ? 310 : 210,
          },
        },
      },
    },
    alerts:
      source === "automation"
        ? [
            {
              code: "a1",
              rank: 1,
              severity: "warning",
              title: "Alert",
              message: "Needs review",
              acknowledged: true,
            },
          ]
        : source === "bot"
          ? [
              {
                code: "b1",
                rank: 2,
                severity: "info",
                title: "Bot alert",
                message: "Investigate bot decisions",
              },
            ]
          : [],
    alertPolicy:
      source === "automation"
        ? {
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
          }
        : source === "bot"
          ? {
              acknowledgedCodes: [
                "bot_action_success_below_target",
                "cooldown_skips_detected",
              ],
              acknowledgedCount: 2,
              suppressedCodes: [
                "bot_action_success_below_target",
                "cooldown_skips_detected",
              ],
              suppressedCount: 2,
              snoozedCodes: ["bot_action_success_below_target"],
              snoozedCount: 1,
              snoozeUntil: "2026-04-10T08:15:00.000Z",
            }
          : undefined,
  };
}

describe("WorkspaceTurnPolicyComparePage", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    turnPolicyHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
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

  it("renders source comparison cards and preserves thread scope", async () => {
    const applyAlertGovernanceAction = vi.fn();
    turnPolicyHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction,
      applyAlertGovernanceActionAsync: vi.fn(),
      error: null,
      isPending: false,
      pendingAction: undefined,
    });
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const selectedWorkspace = {
      id: "ws-1",
      name: "Alpha Workspace",
      rootPath: "E:/projects/alpha",
      runtimeStatus: "ready",
      createdAt: "2026-04-08T00:00:00.000Z",
      updatedAt: "2026-04-08T12:00:00.000Z",
    };

    workspacesApiState.listWorkspaces.mockResolvedValueOnce([
      selectedWorkspace,
    ]);
    turnPolicyHookState.useWorkspaceTurnPolicyOverview.mockReturnValue({
      selectedWorkspace,
      selectedWorkspaceId: "ws-1",
      setSelectedWorkspaceId: vi.fn(),
    });
    turnPolicyHookState.useWorkspaceTurnPolicySourceComparison.mockReturnValue({
      interactiveMetrics: buildMetricsSummary("interactive"),
      automationMetrics: buildMetricsSummary("automation"),
      botMetrics: buildMetricsSummary("bot"),
      sourceComparisonLoading: false,
      sourceComparisonError: null,
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter
        initialEntries={[
          "/workspaces/turn-policy/compare?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1",
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route element={children} path="/workspaces/turn-policy/compare" />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );

    render(<WorkspaceTurnPolicyComparePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Source Comparison")).toBeTruthy();
    });

    expect(screen.getByText("Turn Policy Source Comparison")).toBeTruthy();
    expect(screen.getByText("Source Health")).toBeTruthy();
    expect(screen.getByText("Recent Windows")).toBeTruthy();
    expect(screen.getByText("Top Alerts by Source")).toBeTruthy();
    expect(
      screen.getByText(
        "Automation: 1 alert suppressed by settings (Duplicate skips detected).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Bot: 2 alerts suppressed by settings (Bot action success below target, Cooldown skips detected).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Automation: 3 alerts acknowledged as known issues in settings (Automation action success below target, Duplicate skips detected, +1 more).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Bot: 2 alerts acknowledged as known issues in settings (Bot action success below target, Cooldown skips detected).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Automation: 3 alerts temporarily snoozed until ${formatLocalizedDateTime("2026-04-10T06:45:00.000Z")} (Automation action success below target, Duplicate skips detected, +1 more).`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Bot: 1 alert temporarily snoozed until ${formatLocalizedDateTime("2026-04-10T08:15:00.000Z")} (Bot action success below target).`,
      ),
    ).toBeTruthy();
    expect(screen.getAllByText("Interactive").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Automation").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Bot").length).toBeGreaterThan(0);
    expect(screen.getByText("Interactive last hour")).toBeTruthy();
    expect(
      screen.getByText(
        "Compare the last hour against the last 24 hours before drilling into a single source review.",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByText("[Warning] Alert [Acknowledged]").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Rank 1: Needs review").length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getByText(
        "Quick actions target the current top alert for each source.",
      ),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Clear acknowledgement" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Snooze 24h" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Scoped to thread thread-1.")).toBeTruthy();
    expect(
      turnPolicyHookState.useWorkspaceTurnPolicySourceComparison,
    ).toHaveBeenCalledWith({
      selectedWorkspaceId: "ws-1",
      threadId: "thread-1",
    });
    expect(
      screen
        .getByRole("link", { name: "Open interactive overview" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=interactive&source=interactive",
    );
    expect(
      screen
        .getByRole("link", { name: "Open automation review" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&source=automation",
    );
    expect(
      screen
        .getByRole("link", { name: "Open bot review" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/bot?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&source=bot",
    );
    expect(
      screen.getByRole("link", { name: "Open history" }).getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&historyRange=90d&historyGranularity=week",
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Clear acknowledgement" })[0],
    );
    expect(applyAlertGovernanceAction).toHaveBeenCalledWith({
      type: "clearAcknowledgement",
      code: "a1",
    });

    fireEvent.click(screen.getAllByRole("button", { name: "Snooze 24h" })[0]);
    expect(applyAlertGovernanceAction).toHaveBeenCalledWith({
      type: "snooze24h",
      code: "a1",
    });
  });

  it("renders compare-page alert governance feedback", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    workspacesApiState.listWorkspaces.mockResolvedValueOnce([
      {
        id: "ws-1",
        name: "Alpha Workspace",
        rootPath: "E:/projects/alpha",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
      },
    ]);
    turnPolicyHookState.useWorkspaceTurnPolicyOverview.mockReturnValue({
      selectedWorkspace: {
        id: "ws-1",
        name: "Alpha Workspace",
        rootPath: "E:/projects/alpha",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
      },
      selectedWorkspaceId: "ws-1",
      setSelectedWorkspaceId: vi.fn(),
    });
    turnPolicyHookState.useWorkspaceTurnPolicySourceComparison.mockReturnValue({
      interactiveMetrics: buildMetricsSummary("interactive"),
      automationMetrics: buildMetricsSummary("automation"),
      botMetrics: buildMetricsSummary("bot"),
      sourceComparisonLoading: false,
      sourceComparisonError: null,
    });
    turnPolicyHookState.useTurnPolicyAlertGovernanceActions.mockReturnValue({
      applyAlertGovernanceAction: vi.fn(),
      applyAlertGovernanceActionAsync: vi.fn(),
      error: "request failed",
      isPending: true,
      pendingAction: { type: "snooze24h", code: "a1" },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter
        initialEntries={[
          "/workspaces/turn-policy/compare?selectedWorkspaceId=ws-1",
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route element={children} path="/workspaces/turn-policy/compare" />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );

    render(<WorkspaceTurnPolicyComparePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Applying alert governance…")).toBeTruthy();
    });

    expect(screen.getByText("Alert governance update failed")).toBeTruthy();
    expect(screen.getByText("request failed")).toBeTruthy();
  });
});
