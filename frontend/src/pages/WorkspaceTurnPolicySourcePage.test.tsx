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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { i18n } from "../i18n/runtime";
import { WorkspaceTurnPolicySourcePage } from "./WorkspaceTurnPolicySourcePage";

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
}));

const turnPolicyHookState = vi.hoisted(() => ({
  useWorkspaceTurnPolicyOverview: vi.fn(),
  useWorkspaceTurnPolicyRecentDecisions: vi.fn(),
}));

vi.mock("../features/workspaces/api", () => ({
  listWorkspaces: workspacesApiState.listWorkspaces,
}));

vi.mock("./workspaces/useWorkspaceTurnPolicyOverview", () => ({
  useWorkspaceTurnPolicyOverview:
    turnPolicyHookState.useWorkspaceTurnPolicyOverview,
}));

vi.mock("./workspaces/useWorkspaceTurnPolicyRecentDecisions", () => ({
  useWorkspaceTurnPolicyRecentDecisions:
    turnPolicyHookState.useWorkspaceTurnPolicyRecentDecisions,
}));

describe("WorkspaceTurnPolicySourcePage", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders an automation source review and keeps source filters pinned", async () => {
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
      turnPolicyMetrics: {
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
            source: "automation",
            actionStatus: "failed",
            rank: 1,
          },
        ],
      },
      turnPolicyMetricsLoading: false,
      turnPolicyMetricsError: null,
    });
    turnPolicyHookState.useWorkspaceTurnPolicyRecentDecisions.mockReturnValue({
      turnPolicyDecisions: [],
      hasAnyDecisions: true,
      turnPolicyDecisionsLoading: false,
      turnPolicyDecisionsError: null,
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter
        initialEntries={[
          "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&actionStatus=skipped&reason=duplicate_fingerprint",
        ]}
      >
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route element={children} path="/workspaces/turn-policy/:source" />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );

    render(<WorkspaceTurnPolicySourcePage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByText("Automation Review")).toBeTruthy();
    });

    expect(screen.getByText("Automation Turn Policy Overview")).toBeTruthy();
    expect(screen.getByText("Automation Turn Policy Summary")).toBeTruthy();
    expect(screen.getByText("Recent Windows")).toBeTruthy();
    expect(screen.getByText("Last hour")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Inspect source alert Automation failure needs review",
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Compare sources" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/compare?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1",
    );
    expect(
      screen
        .getByRole("link", { name: "View source history" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&historyRange=90d&historyGranularity=week",
    );
    expect(
      screen.getByRole("link", { name: "Return to workspace overview" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Filter workspace decisions by source",
      }),
    ).toBeTruthy();
    await waitFor(() => {
      expect(
        turnPolicyHookState.useWorkspaceTurnPolicyOverview,
      ).toHaveBeenCalledWith({
        workspaces: [selectedWorkspace],
        sourceScope: "automation",
      });
    });
    expect(
      turnPolicyHookState.useWorkspaceTurnPolicyRecentDecisions,
    ).toHaveBeenCalledWith({
      selectedWorkspaceId: "ws-1",
      filters: {
        threadId: "thread-1",
        policyName: "",
        action: "",
        actionStatus: "skipped",
        source: "automation",
        reason: "duplicate_fingerprint",
      },
      limit: 10,
    });
  });
});
