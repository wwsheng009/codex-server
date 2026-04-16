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
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../i18n/runtime";
import {
  buildWorkspaceHookRunsRoute,
  buildWorkspaceTurnPolicyHistoryRoute,
} from "../lib/thread-routes";

const workspacesApiState = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  restartWorkspace: vi.fn(),
}));

const turnPolicyHookState = vi.hoisted(() => ({
  useWorkspaceTurnPolicyOverview: vi.fn(),
  useWorkspaceTurnPolicyRecentDecisions: vi.fn(),
  useWorkspaceHookRuns: vi.fn(),
}));

vi.mock("../features/workspaces/api", () => ({
  listWorkspaces: workspacesApiState.listWorkspaces,
  createWorkspace: workspacesApiState.createWorkspace,
  deleteWorkspace: workspacesApiState.deleteWorkspace,
  restartWorkspace: workspacesApiState.restartWorkspace,
}));

vi.mock("./workspaces/useWorkspaceTurnPolicyOverview", () => ({
  useWorkspaceTurnPolicyOverview:
    turnPolicyHookState.useWorkspaceTurnPolicyOverview,
}));

vi.mock("./workspaces/useWorkspaceTurnPolicyRecentDecisions", () => ({
  useWorkspaceTurnPolicyRecentDecisions:
    turnPolicyHookState.useWorkspaceTurnPolicyRecentDecisions,
}));

vi.mock("./workspaces/useWorkspaceHookRuns", () => ({
  useWorkspaceHookRuns: turnPolicyHookState.useWorkspaceHookRuns,
}));

describe("WorkspacesPage", () => {
  let WorkspacesPageComponent: Awaited<
    typeof import("./WorkspacesPage")
  >["WorkspacesPage"];

  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeAll(async () => {
    ({ WorkspacesPage: WorkspacesPageComponent } = await import(
      "./WorkspacesPage"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("builds a workspace turn policy history route with preserved query scope", () => {
    expect(
      buildWorkspaceTurnPolicyHistoryRoute("ws-1", {
        historyRange: "90d",
        historyGranularity: "week",
        turnPolicyThreadId: "thread-1",
        metricsSource: "automation",
      }),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&historyRange=90d&historyGranularity=week",
    );
  });

  it("builds a workspace hook runs route with preserved drill-down filters", () => {
    expect(
      buildWorkspaceHookRunsRoute("ws-1", {
        hookRunId: "hook-1",
        hookRunsThreadId: "thread-1",
        hookEventName: "HttpMutation",
        hookStatus: "completed",
        hookHandlerKey: "builtin.httpmutation.audit-workspace-mutation",
      }),
    ).toBe(
      "/workspaces?selectedWorkspaceId=ws-1&hookRunId=hook-1&hookRunsThreadId=thread-1&hookEventName=HttpMutation&hookStatus=completed&hookHandlerKey=builtin.httpmutation.audit-workspace-mutation",
    );
  });

  it("renders workspace turn policy overview and recent decisions sections", async () => {
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
        generatedAt: "2026-04-08T12:00:00.000Z",
        config: {
          postToolUsePolicyEnabled: true,
          stopMissingVerificationPolicyEnabled: false,
          followUpCooldownMs: 120000,
        },
        decisions: {
          total: 4,
          actionAttempts: 3,
          actionSucceeded: 3,
          actionSuccessRate: 1,
          actionStatusCounts: {
            succeeded: 3,
            failed: 0,
            skipped: 1,
            other: 0,
          },
          actionCounts: {
            steer: 2,
            followUp: 1,
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
            total: 1,
            actionAttempts: 1,
            actionSucceeded: 1,
            actionSuccessRate: 1,
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
          coveredTurns: 2,
          eligibleTurns: 2,
          coverageRate: 1,
          coverageDefinition: "Coverage only counts eligible workspace turns.",
        },
        timings: {
          postToolUseDecisionLatency: {
            p50Ms: 120,
            p95Ms: 280,
          },
          stopDecisionLatency: {
            p50Ms: 300,
            p95Ms: 540,
          },
        },
      },
      turnPolicyMetricsLoading: false,
      turnPolicyMetricsError: null,
    });
    turnPolicyHookState.useWorkspaceTurnPolicyRecentDecisions.mockReturnValue({
      turnPolicyDecisions: [
        {
          id: "decision-1",
          workspaceId: "ws-1",
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "cmd-1",
          triggerMethod: "item/completed",
          policyName: "posttooluse/failed-validation-command",
          fingerprint: "fp-1",
          verdict: "steer",
          action: "steer",
          actionStatus: "succeeded",
          actionTurnId: "",
          reason: "validation_command_failed",
          evidenceSummary: "command=go test ./...",
          source: "interactive",
          error: "",
          evaluationStartedAt: "2026-04-08T12:00:00.000Z",
          decisionAt: "2026-04-08T12:00:01.000Z",
          completedAt: "2026-04-08T12:00:02.000Z",
        },
      ],
      hasAnyDecisions: true,
      turnPolicyDecisionsLoading: false,
      turnPolicyDecisionsError: null,
    });
    turnPolicyHookState.useWorkspaceHookRuns.mockReturnValue({
      hookRuns: [
        {
          id: "hook-1",
          workspaceId: "ws-1",
          threadId: "thread-1",
          eventName: "HttpMutation",
          handlerKey: "builtin.httpmutation.audit-workspace-mutation",
          status: "completed",
          decision: "continue",
          reason: "review_start_audited",
          startedAt: "2026-04-08T12:00:03.000Z",
          completedAt: "2026-04-08T12:00:04.000Z",
          durationMs: 40,
        },
      ],
      hasAnyHookRuns: true,
      hookRunsLoading: false,
      hookRunsError: null,
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <MemoryRouter
        initialEntries={[
          "/workspaces?selectedWorkspaceId=ws-1&metricsSource=automation&turnPolicyThreadId=thread-1&policyName=stop%2Fmissing-successful-verification&actionStatus=skipped&reason=duplicate_fingerprint&hookRunId=hook-1&hookRunsThreadId=thread-1&hookEventName=HttpMutation&hookStatus=completed&hookHandlerKey=builtin.httpmutation.audit-workspace-mutation",
        ]}
      >
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MemoryRouter>
    );

    render(<WorkspacesPageComponent />, { wrapper });

    await waitFor(() => {
      expect(
        screen.getByRole("link", { name: "Compare sources" }),
      ).toBeTruthy();
    });

    expect(screen.getByText("Turn Policy Overview")).toBeTruthy();
    expect(screen.getByText("Workspace Scope")).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Overview/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Configuration/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Activity/ })).toBeTruthy();
    expect(screen.getAllByText("Alpha Workspace").length).toBeGreaterThan(0);
    expect(
      screen.getByText("Coverage only counts eligible workspace turns."),
    ).toBeTruthy();
    expect(screen.getByText("Execution Controls")).toBeTruthy();
    expect(screen.getByText("2 min")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Configuration/ }));
    expect(screen.getByText("Hook Configuration")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Activity/ }));
    expect(screen.getByText("Workspace Recent Policy Decisions")).toBeTruthy();
    expect(screen.getByText("Failed validation command")).toBeTruthy();
    expect(screen.getByText("Validation command failed")).toBeTruthy();
    expect(screen.getByText("Scoped to thread thread-1.")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: "Reset filters" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", {
        name: "Filter workspace decisions by policy",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Filter workspace decisions by reason",
      }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: /Hook Runs/ }));
    expect(screen.getByText("Workspace Hook Runs")).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Compare sources" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/compare?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1",
    );
    expect(
      screen
        .getByRole("link", { name: "View alert history" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&historyRange=90d&historyGranularity=week",
    );
    expect(
      turnPolicyHookState.useWorkspaceTurnPolicyOverview,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceScope: "automation",
      }),
    );
    expect(
      turnPolicyHookState.useWorkspaceTurnPolicyRecentDecisions,
    ).toHaveBeenCalledWith({
      selectedWorkspaceId: "ws-1",
      filters: {
        policyName: "stop/missing-successful-verification",
        action: "",
        actionStatus: "skipped",
        source: "",
        reason: "duplicate_fingerprint",
        threadId: "thread-1",
      },
      limit: 5,
    });
    expect(turnPolicyHookState.useWorkspaceHookRuns).toHaveBeenCalledWith({
      selectedWorkspaceId: "ws-1",
      filters: {
        threadId: "thread-1",
        eventName: "HttpMutation",
        status: "completed",
        handlerKey: "builtin.httpmutation.audit-workspace-mutation",
        hookRunId: "hook-1",
      },
      limit: 5,
    });
  });
});
