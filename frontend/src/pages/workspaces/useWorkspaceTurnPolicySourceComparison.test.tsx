// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import { i18n } from "../../i18n/runtime";
import { useWorkspaceTurnPolicySourceComparison } from "./useWorkspaceTurnPolicySourceComparison";

const threadsApiState = vi.hoisted(() => ({
  getTurnPolicyMetrics: vi.fn(),
}));

vi.mock("../../features/threads/api", () => ({
  getTurnPolicyMetrics: threadsApiState.getTurnPolicyMetrics,
}));

function buildMetricsSummary(source: "interactive" | "automation" | "bot") {
  return {
    workspaceId: "ws-1",
    source,
    decisions: {
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
      actionCounts: {
        steer: 1,
        followUp: 0,
        interrupt: 0,
        none: 1,
        other: 0,
      },
      policyCounts: {
        failedValidationCommand: 1,
        missingSuccessfulVerification: 1,
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
        total: source === "interactive" ? 2 : 0,
        actionAttempts: source === "interactive" ? 1 : 0,
        actionSucceeded: source === "interactive" ? 1 : 0,
        actionSuccessRate: source === "interactive" ? 1 : 0,
        skipped: source === "interactive" ? 1 : 0,
      },
      automation: {
        total: source === "automation" ? 2 : 0,
        actionAttempts: source === "automation" ? 1 : 0,
        actionSucceeded: source === "automation" ? 1 : 0,
        actionSuccessRate: source === "automation" ? 1 : 0,
        skipped: source === "automation" ? 1 : 0,
      },
      bot: {
        total: source === "bot" ? 2 : 0,
        actionAttempts: source === "bot" ? 1 : 0,
        actionSucceeded: source === "bot" ? 1 : 0,
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
      completedWithFileChange: 1,
      missingSuccessfulVerification: 1,
      missingSuccessfulVerificationRate: 1,
      failedValidationCommand: 1,
      failedValidationWithPolicyAction: 1,
      failedValidationWithPolicyActionRate: 1,
    },
    audit: {
      coveredTurns: 1,
      eligibleTurns: 1,
      coverageRate: 1,
      coverageDefinition: "Coverage only counts eligible turns.",
    },
    timings: {
      postToolUseDecisionLatency: {
        p50Ms: 120,
        p95Ms: 320,
      },
      stopDecisionLatency: {
        p50Ms: 90,
        p95Ms: 210,
      },
    },
    recentWindows: {
      lastHour: {
        label: "Last hour",
        decisions: {
          total: 1,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 0,
        },
        alerts: {
          total: 0,
        },
        timings: {
          postToolUseDecisionLatency: {
            p95Ms: 180,
          },
          stopDecisionLatency: {
            p95Ms: 140,
          },
        },
      },
      last24Hours: {
        label: "Last 24 hours",
        decisions: {
          total: 2,
          actionAttempts: 1,
          actionSucceeded: 1,
          actionSuccessRate: 1,
          skipped: 1,
        },
        alerts: {
          total: 0,
        },
        timings: {
          postToolUseDecisionLatency: {
            p95Ms: 320,
          },
          stopDecisionLatency: {
            p95Ms: 210,
          },
        },
      },
    },
    alerts: [
      {
        code: `${source}-a1`,
        rank: 1,
        severity: "info",
        title: `${source} alert`,
        message: "recent window loaded",
      },
    ],
  };
}

describe("useWorkspaceTurnPolicySourceComparison", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not query until a workspace is selected", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useWorkspaceTurnPolicySourceComparison({
          selectedWorkspaceId: "",
        }),
      {
        wrapper,
      },
    );

    expect(threadsApiState.getTurnPolicyMetrics).not.toHaveBeenCalled();
    expect(result.current.interactiveMetrics).toBeUndefined();
    expect(result.current.automationMetrics).toBeUndefined();
    expect(result.current.botMetrics).toBeUndefined();
    expect(result.current.sourceComparisonLoading).toBe(false);
    expect(result.current.sourceComparisonError).toBeNull();
  });

  it("loads interactive, automation, and bot metrics for the selected scope", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    threadsApiState.getTurnPolicyMetrics
      .mockResolvedValueOnce(buildMetricsSummary("interactive"))
      .mockResolvedValueOnce(buildMetricsSummary("automation"))
      .mockResolvedValueOnce(buildMetricsSummary("bot"));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useWorkspaceTurnPolicySourceComparison({
          selectedWorkspaceId: "ws-1",
          threadId: "thread-1",
        }),
      {
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.sourceComparisonLoading).toBe(false);
    });

    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      { threadId: "thread-1", source: "interactive" },
    );
    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      { threadId: "thread-1", source: "automation" },
    );
    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenNthCalledWith(
      3,
      "ws-1",
      { threadId: "thread-1", source: "bot" },
    );
    expect(result.current.interactiveMetrics?.source).toBe("interactive");
    expect(result.current.automationMetrics?.source).toBe("automation");
    expect(result.current.botMetrics?.source).toBe("bot");
    expect(
      result.current.automationMetrics?.recentWindows?.lastHour?.label,
    ).toBe("Last hour");
    expect(result.current.botMetrics?.alerts?.[0]?.rank).toBe(1);
    expect(result.current.sourceComparisonError).toBeNull();
  });
});
