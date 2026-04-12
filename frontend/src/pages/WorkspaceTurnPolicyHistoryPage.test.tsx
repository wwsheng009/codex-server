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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { i18n } from "../i18n/runtime";
import { WorkspaceTurnPolicyHistoryPage } from "./WorkspaceTurnPolicyHistoryPage";

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}));

const turnPolicyHookState = vi.hoisted(() => ({
  useWorkspaceTurnPolicyOverview: vi.fn(),
  useWorkspaceTurnPolicySourceComparison: vi.fn(),
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

function buildHistoryBucket(input: {
  alertsCount: number;
  day: string;
  postP95Ms: number;
  stopP95Ms: number;
  successRate: number;
  succeeded: number;
  attempts: number;
  skipped: number;
  total: number;
}) {
  return {
    since: `${input.day}T00:00:00.000Z`,
    until: `${input.day}T23:59:59.000Z`,
    alertsCount: input.alertsCount,
    decisions: {
      total: input.total,
      actionAttempts: input.attempts,
      actionSucceeded: input.succeeded,
      actionSuccessRate: input.successRate,
      skipped: input.skipped,
    },
    timings: {
      postToolUseDecisionLatency: {
        p50Ms: Math.max(input.postP95Ms - 100, 0),
        p95Ms: input.postP95Ms,
      },
      stopDecisionLatency: {
        p50Ms: Math.max(input.stopP95Ms - 100, 0),
        p95Ms: input.stopP95Ms,
      },
    },
  };
}

function buildMetricsSummary(
  source: "" | "interactive" | "automation" | "bot",
) {
  const dailyLast7Days =
    source === "automation"
      ? [
          buildHistoryBucket({
            day: "2026-04-03",
            alertsCount: 4,
            total: 5,
            attempts: 4,
            succeeded: 3,
            successRate: 0.75,
            skipped: 1,
            postP95Ms: 380,
            stopP95Ms: 260,
          }),
          buildHistoryBucket({
            day: "2026-04-04",
            alertsCount: 8,
            total: 8,
            attempts: 6,
            succeeded: 4,
            successRate: 0.6667,
            skipped: 2,
            postP95Ms: 510,
            stopP95Ms: 340,
          }),
        ]
      : source === "bot"
        ? [
            buildHistoryBucket({
              day: "2026-04-03",
              alertsCount: 2,
              total: 4,
              attempts: 3,
              succeeded: 3,
              successRate: 1,
              skipped: 1,
              postP95Ms: 260,
              stopP95Ms: 200,
            }),
            buildHistoryBucket({
              day: "2026-04-04",
              alertsCount: 4,
              total: 6,
              attempts: 5,
              succeeded: 4,
              successRate: 0.8,
              skipped: 1,
              postP95Ms: 320,
              stopP95Ms: 250,
            }),
          ]
        : source === "interactive"
          ? [
              buildHistoryBucket({
                day: "2026-04-03",
                alertsCount: 1,
                total: 3,
                attempts: 2,
                succeeded: 2,
                successRate: 1,
                skipped: 1,
                postP95Ms: 180,
                stopP95Ms: 160,
              }),
              buildHistoryBucket({
                day: "2026-04-04",
                alertsCount: 2,
                total: 5,
                attempts: 4,
                succeeded: 3,
                successRate: 0.75,
                skipped: 1,
                postP95Ms: 240,
                stopP95Ms: 220,
              }),
            ]
          : [
              buildHistoryBucket({
                day: "2026-04-03",
                alertsCount: 7,
                total: 10,
                attempts: 8,
                succeeded: 6,
                successRate: 0.75,
                skipped: 2,
                postP95Ms: 420,
                stopP95Ms: 290,
              }),
              buildHistoryBucket({
                day: "2026-04-04",
                alertsCount: 9,
                total: 12,
                attempts: 10,
                succeeded: 8,
                successRate: 0.8,
                skipped: 2,
                postP95Ms: 560,
                stopP95Ms: 330,
              }),
            ];
  const dailyLast30Days =
    source === "automation"
      ? [
          buildHistoryBucket({
            day: "2026-03-10",
            alertsCount: 6,
            total: 7,
            attempts: 5,
            succeeded: 4,
            successRate: 0.8,
            skipped: 1,
            postP95Ms: 930,
            stopP95Ms: 610,
          }),
          buildHistoryBucket({
            day: "2026-03-11",
            alertsCount: 10,
            total: 9,
            attempts: 8,
            succeeded: 6,
            successRate: 0.75,
            skipped: 2,
            postP95Ms: 870,
            stopP95Ms: 520,
          }),
          buildHistoryBucket({
            day: "2026-03-12",
            alertsCount: 12,
            total: 11,
            attempts: 9,
            succeeded: 7,
            successRate: 0.7778,
            skipped: 2,
            postP95Ms: 790,
            stopP95Ms: 480,
          }),
        ]
      : source === "bot"
        ? [
            buildHistoryBucket({
              day: "2026-03-10",
              alertsCount: 3,
              total: 5,
              attempts: 4,
              succeeded: 4,
              successRate: 1,
              skipped: 1,
              postP95Ms: 540,
              stopP95Ms: 360,
            }),
            buildHistoryBucket({
              day: "2026-03-11",
              alertsCount: 5,
              total: 7,
              attempts: 6,
              succeeded: 5,
              successRate: 0.8333,
              skipped: 1,
              postP95Ms: 510,
              stopP95Ms: 330,
            }),
            buildHistoryBucket({
              day: "2026-03-12",
              alertsCount: 4,
              total: 6,
              attempts: 5,
              succeeded: 4,
              successRate: 0.8,
              skipped: 1,
              postP95Ms: 470,
              stopP95Ms: 300,
            }),
          ]
        : source === "interactive"
          ? [
              buildHistoryBucket({
                day: "2026-03-10",
                alertsCount: 2,
                total: 4,
                attempts: 3,
                succeeded: 3,
                successRate: 1,
                skipped: 1,
                postP95Ms: 410,
                stopP95Ms: 260,
              }),
              buildHistoryBucket({
                day: "2026-03-11",
                alertsCount: 3,
                total: 5,
                attempts: 4,
                succeeded: 3,
                successRate: 0.75,
                skipped: 1,
                postP95Ms: 430,
                stopP95Ms: 280,
              }),
              buildHistoryBucket({
                day: "2026-03-12",
                alertsCount: 1,
                total: 4,
                attempts: 3,
                succeeded: 3,
                successRate: 1,
                skipped: 1,
                postP95Ms: 390,
                stopP95Ms: 250,
              }),
            ]
          : [
              buildHistoryBucket({
                day: "2026-03-10",
                alertsCount: 14,
                total: 16,
                attempts: 13,
                succeeded: 10,
                successRate: 0.7692,
                skipped: 3,
                postP95Ms: 980,
                stopP95Ms: 640,
              }),
              buildHistoryBucket({
                day: "2026-03-11",
                alertsCount: 11,
                total: 14,
                attempts: 12,
                succeeded: 9,
                successRate: 0.75,
                skipped: 2,
                postP95Ms: 910,
                stopP95Ms: 590,
              }),
              buildHistoryBucket({
                day: "2026-03-12",
                alertsCount: 9,
                total: 13,
                attempts: 11,
                succeeded: 9,
                successRate: 0.8182,
                skipped: 2,
                postP95Ms: 840,
                stopP95Ms: 520,
              }),
          ];
  const dailyLast90Days =
    source === "automation"
      ? [
          buildHistoryBucket({
            day: "2026-01-10",
            alertsCount: 18,
            total: 14,
            attempts: 12,
            succeeded: 8,
            successRate: 0.6667,
            skipped: 4,
            postP95Ms: 1180,
            stopP95Ms: 790,
          }),
          buildHistoryBucket({
            day: "2026-01-11",
            alertsCount: 16,
            total: 13,
            attempts: 11,
            succeeded: 8,
            successRate: 0.7273,
            skipped: 3,
            postP95Ms: 1120,
            stopP95Ms: 740,
          }),
        ]
      : source === "bot"
        ? [
            buildHistoryBucket({
              day: "2026-01-10",
              alertsCount: 9,
              total: 8,
              attempts: 7,
              succeeded: 6,
              successRate: 0.8571,
              skipped: 1,
              postP95Ms: 760,
              stopP95Ms: 500,
            }),
            buildHistoryBucket({
              day: "2026-01-11",
              alertsCount: 7,
              total: 7,
              attempts: 6,
              succeeded: 5,
              successRate: 0.8333,
              skipped: 1,
              postP95Ms: 710,
              stopP95Ms: 470,
            }),
          ]
        : source === "interactive"
          ? [
              buildHistoryBucket({
                day: "2026-01-10",
                alertsCount: 5,
                total: 6,
                attempts: 5,
                succeeded: 5,
                successRate: 1,
                skipped: 1,
                postP95Ms: 620,
                stopP95Ms: 390,
              }),
              buildHistoryBucket({
                day: "2026-01-11",
                alertsCount: 4,
                total: 5,
                attempts: 4,
                succeeded: 3,
                successRate: 0.75,
                skipped: 1,
                postP95Ms: 590,
                stopP95Ms: 360,
              }),
            ]
          : [
              buildHistoryBucket({
                day: "2026-01-10",
                alertsCount: 24,
                total: 20,
                attempts: 17,
                succeeded: 13,
                successRate: 0.7647,
                skipped: 4,
                postP95Ms: 1260,
                stopP95Ms: 840,
              }),
              buildHistoryBucket({
                day: "2026-01-11",
                alertsCount: 21,
                total: 18,
                attempts: 15,
                succeeded: 12,
                successRate: 0.8,
                skipped: 3,
                postP95Ms: 1190,
                stopP95Ms: 790,
              }),
            ];
  const weeklyLast12Weeks =
    source === "automation"
      ? [
          buildHistoryBucket({
            day: "2026-01-05",
            alertsCount: 31,
            total: 28,
            attempts: 24,
            succeeded: 17,
            successRate: 0.7083,
            skipped: 7,
            postP95Ms: 1480,
            stopP95Ms: 930,
          }),
          buildHistoryBucket({
            day: "2026-01-12",
            alertsCount: 29,
            total: 26,
            attempts: 22,
            succeeded: 16,
            successRate: 0.7273,
            skipped: 6,
            postP95Ms: 1390,
            stopP95Ms: 880,
          }),
        ].map((bucket, index) => ({
          ...bucket,
          until: `2026-01-${index === 0 ? "11" : "18"}T23:59:59.000Z`,
        }))
      : source === "bot"
        ? [
            buildHistoryBucket({
              day: "2026-01-05",
              alertsCount: 12,
              total: 15,
              attempts: 13,
              succeeded: 11,
              successRate: 0.8462,
              skipped: 2,
              postP95Ms: 880,
              stopP95Ms: 560,
            }),
            buildHistoryBucket({
              day: "2026-01-12",
              alertsCount: 10,
              total: 13,
              attempts: 11,
              succeeded: 9,
              successRate: 0.8182,
              skipped: 2,
              postP95Ms: 830,
              stopP95Ms: 520,
            }),
          ].map((bucket, index) => ({
            ...bucket,
            until: `2026-01-${index === 0 ? "11" : "18"}T23:59:59.000Z`,
          }))
        : source === "interactive"
          ? [
              buildHistoryBucket({
                day: "2026-01-05",
                alertsCount: 8,
                total: 11,
                attempts: 9,
                succeeded: 8,
                successRate: 0.8889,
                skipped: 2,
                postP95Ms: 710,
                stopP95Ms: 430,
              }),
              buildHistoryBucket({
                day: "2026-01-12",
                alertsCount: 7,
                total: 10,
                attempts: 8,
                succeeded: 7,
                successRate: 0.875,
                skipped: 2,
                postP95Ms: 670,
                stopP95Ms: 410,
              }),
            ].map((bucket, index) => ({
              ...bucket,
              until: `2026-01-${index === 0 ? "11" : "18"}T23:59:59.000Z`,
            }))
          : [
              buildHistoryBucket({
                day: "2026-01-05",
                alertsCount: 43,
                total: 41,
                attempts: 34,
                succeeded: 26,
                successRate: 0.7647,
                skipped: 8,
                postP95Ms: 1560,
                stopP95Ms: 980,
              }),
              buildHistoryBucket({
                day: "2026-01-12",
                alertsCount: 39,
                total: 37,
                attempts: 31,
                succeeded: 24,
                successRate: 0.7742,
                skipped: 7,
                postP95Ms: 1490,
                stopP95Ms: 930,
              }),
            ].map((bucket, index) => ({
              ...bucket,
              until: `2026-01-${index === 0 ? "11" : "18"}T23:59:59.000Z`,
            }));

  return {
    workspaceId: "ws-1",
    threadId: "thread-77",
    source: source || undefined,
    generatedAt: "2026-04-09T10:30:00.000Z",
    decisions: {
      total: 12,
      actionAttempts: 10,
      actionSucceeded: 8,
      actionSuccessRate: 0.8,
      actionStatusCounts: {
        succeeded: 8,
        failed: 1,
        skipped: 3,
        other: 0,
      },
      actionCounts: {
        steer: 4,
        followUp: 4,
        none: 4,
        other: 0,
      },
      policyCounts: {
        failedValidationCommand: 6,
        missingSuccessfulVerification: 6,
        other: 0,
      },
      skipReasonCounts: {
        total: 3,
        duplicateFingerprint: 2,
        followUpCooldownActive: 1,
        other: 0,
      },
    },
    sources: {
      interactive: {
        total: source === "interactive" ? 8 : 3,
        actionAttempts: source === "interactive" ? 6 : 2,
        actionSucceeded: source === "interactive" ? 5 : 2,
        actionSuccessRate: source === "interactive" ? 0.8333 : 1,
        skipped: source === "interactive" ? 2 : 1,
      },
      automation: {
        total: source === "automation" ? 13 : 12,
        actionAttempts: source === "automation" ? 10 : 10,
        actionSucceeded: source === "automation" ? 7 : 8,
        actionSuccessRate: source === "automation" ? 0.7 : 0.8,
        skipped: source === "automation" ? 3 : 2,
      },
      bot: {
        total: source === "bot" ? 10 : 6,
        actionAttempts: source === "bot" ? 8 : 5,
        actionSucceeded: source === "bot" ? 7 : 4,
        actionSuccessRate: source === "bot" ? 0.875 : 0.8,
        skipped: source === "bot" ? 2 : 1,
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
      completedWithFileChange: 5,
      missingSuccessfulVerification: 2,
      missingSuccessfulVerificationRate: 0.4,
      failedValidationCommand: 4,
      failedValidationWithPolicyAction: 3,
      failedValidationWithPolicyActionRate: 0.75,
    },
    audit: {
      coveredTurns: 8,
      eligibleTurns: 10,
      coverageRate: 0.8,
      coverageDefinition: "Coverage only counts eligible turns.",
    },
    timings: {
      postToolUseDecisionLatency: {
        p50Ms: 210,
        p95Ms: 420,
      },
      stopDecisionLatency: {
        p50Ms: 140,
        p95Ms: 290,
      },
    },
    history: {
      dailyLast7Days,
      dailyLast30Days,
      dailyLast90Days,
      weeklyLast12Weeks,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-search">{location.search}</div>;
}

function renderHistoryPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/workspaces/turn-policy/history"
            element={
              <>
                <WorkspaceTurnPolicyHistoryPage />
                <LocationProbe />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspaceTurnPolicyHistoryPage", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    workspacesApiState.listWorkspaces.mockResolvedValue([
      {
        id: "ws-1",
        name: "Alpha Workspace",
        rootPath: "E:/projects/alpha",
        runtimeStatus: "ready",
        createdAt: "2026-04-01T00:00:00.000Z",
        updatedAt: "2026-04-09T09:15:00.000Z",
      },
      {
        id: "ws-2",
        name: "Beta Workspace",
        rootPath: "E:/projects/beta",
        runtimeStatus: "active",
        createdAt: "2026-04-02T00:00:00.000Z",
        updatedAt: "2026-04-09T08:15:00.000Z",
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("reads route query and renders source-scoped 90-day weekly history", async () => {
    turnPolicyHookState.useWorkspaceTurnPolicyOverview.mockReturnValue({
      selectedWorkspace: {
        id: "ws-1",
        name: "Alpha Workspace",
      },
      selectedWorkspaceId: "ws-1",
      setSelectedWorkspaceId: vi.fn(),
      turnPolicyMetrics: buildMetricsSummary("automation"),
      turnPolicyMetricsLoading: false,
      turnPolicyMetricsError: null,
    });
    turnPolicyHookState.useWorkspaceTurnPolicySourceComparison.mockReturnValue({
      interactiveMetrics: undefined,
      automationMetrics: undefined,
      botMetrics: undefined,
      sourceComparisonLoading: false,
      sourceComparisonError: null,
    });

    renderHistoryPage(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-9&metricsSource=automation&historyRange=90d&historyGranularity=week",
    );

    await waitFor(() => {
      expect(
        turnPolicyHookState.useWorkspaceTurnPolicyOverview,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sourceScope: "automation",
          workspaces: expect.any(Array),
        }),
      );
    });

    expect(
      turnPolicyHookState.useWorkspaceTurnPolicySourceComparison,
    ).toHaveBeenLastCalledWith({
      selectedWorkspaceId: "",
      threadId: "thread-9",
    });
    expect(screen.getByText("Alert History")).toBeTruthy();
    expect(screen.getByText("Weekly history (last 90 days)")).toBeTruthy();
    expect(
      screen.getAllByText(
        "Showing automation alert history for Alpha Workspace scoped to thread thread-9.",
      ),
    ).toHaveLength(2);
    expect(screen.getByText("1,480 ms")).toBeTruthy();
    expect(screen.getByText("930 ms")).toBeTruthy();
    expect(screen.getByTestId("location-search").textContent).toContain(
      "historyGranularity=week",
    );
  });

  it("writes historyRange back to the URL when the range changes", async () => {
    turnPolicyHookState.useWorkspaceTurnPolicyOverview.mockReturnValue({
      selectedWorkspace: {
        id: "ws-1",
        name: "Alpha Workspace",
      },
      selectedWorkspaceId: "ws-1",
      setSelectedWorkspaceId: vi.fn(),
      turnPolicyMetrics: buildMetricsSummary(""),
      turnPolicyMetricsLoading: false,
      turnPolicyMetricsError: null,
    });
    turnPolicyHookState.useWorkspaceTurnPolicySourceComparison.mockReturnValue({
      interactiveMetrics: buildMetricsSummary("interactive"),
      automationMetrics: buildMetricsSummary("automation"),
      botMetrics: buildMetricsSummary("bot"),
      sourceComparisonLoading: false,
      sourceComparisonError: null,
    });

    renderHistoryPage(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-77",
    );

    fireEvent.click(screen.getByLabelText("Select turn policy history range"));
    fireEvent.click(screen.getByRole("option", { name: "Last 90 days" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toContain(
        "historyRange=90d",
      );
    });

    await waitFor(() => {
      expect(screen.getByLabelText("Select turn policy history granularity"))
        .toBeTruthy();
    });

    fireEvent.click(
      screen.getByLabelText("Select turn policy history granularity"),
    );
    fireEvent.click(screen.getByRole("option", { name: "Weekly buckets" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-search").textContent).toContain(
        "historyGranularity=week",
      );
    });

    expect(screen.getByText("Weekly history (last 90 days)")).toBeTruthy();
    expect(screen.getByText("1,560 ms")).toBeTruthy();
  });

  it("renders 90-day daily source comparison history summaries when requested", async () => {
    turnPolicyHookState.useWorkspaceTurnPolicyOverview.mockReturnValue({
      selectedWorkspace: {
        id: "ws-1",
        name: "Alpha Workspace",
      },
      selectedWorkspaceId: "ws-1",
      setSelectedWorkspaceId: vi.fn(),
      turnPolicyMetrics: buildMetricsSummary(""),
      turnPolicyMetricsLoading: false,
      turnPolicyMetricsError: null,
    });
    turnPolicyHookState.useWorkspaceTurnPolicySourceComparison.mockReturnValue({
      interactiveMetrics: buildMetricsSummary("interactive"),
      automationMetrics: buildMetricsSummary("automation"),
      botMetrics: buildMetricsSummary("bot"),
      sourceComparisonLoading: false,
      sourceComparisonError: null,
    });

    renderHistoryPage(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-77&historyRange=90d&historyGranularity=day",
    );

    await waitFor(() => {
      expect(
        turnPolicyHookState.useWorkspaceTurnPolicyOverview,
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sourceScope: "",
        }),
      );
    });

    expect(
      turnPolicyHookState.useWorkspaceTurnPolicySourceComparison,
    ).toHaveBeenLastCalledWith({
      selectedWorkspaceId: "ws-1",
      threadId: "thread-77",
    });
    expect(screen.getByText("Source histories (last 90 days)")).toBeTruthy();
    expect(screen.getByText("Interactive last 90 days")).toBeTruthy();
    expect(screen.getByText("Automation last 90 days")).toBeTruthy();
    expect(screen.getByText("Bot last 90 days")).toBeTruthy();
    expect(screen.getByText("9 alerts")).toBeTruthy();
    expect(screen.getByText("34 alerts")).toBeTruthy();
    expect(
      screen.getByText(
        "Use these summaries to spot which source has been noisier or slower over the same last 90 days window.",
      ),
    ).toBeTruthy();
  });
});
