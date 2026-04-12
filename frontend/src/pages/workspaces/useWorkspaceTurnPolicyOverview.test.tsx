// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import { i18n } from "../../i18n/runtime";
import { useWorkspaceTurnPolicyOverview } from "./useWorkspaceTurnPolicyOverview";

const workspacesApiState = vi.hoisted(() => ({
  getWorkspaceHookConfiguration: vi.fn(),
}));

const threadsApiState = vi.hoisted(() => ({
  getTurnPolicyMetrics: vi.fn(),
}));

vi.mock("../../features/workspaces/api", () => ({
  getWorkspaceHookConfiguration: workspacesApiState.getWorkspaceHookConfiguration,
}));

vi.mock("../../features/threads/api", () => ({
  getTurnPolicyMetrics: threadsApiState.getTurnPolicyMetrics,
}));

function buildMetricsSummary(workspaceId: string, source = "") {
  return {
    workspaceId,
    source,
    generatedAt: "2026-04-08T12:00:00.000Z",
    decisions: {
      total: 3,
      actionAttempts: 2,
      actionSucceeded: 2,
      actionSuccessRate: 1,
      actionStatusCounts: {
        succeeded: 2,
        failed: 0,
        skipped: 1,
        other: 0,
      },
      actionCounts: {
        steer: 1,
        followUp: 1,
        interrupt: 0,
        none: 1,
        other: 0,
      },
      policyCounts: {
        failedValidationCommand: 1,
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
        total: 2,
        actionAttempts: 1,
        actionSucceeded: 1,
        actionSuccessRate: 1,
        skipped: 1,
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
      completedWithFileChange: 2,
      missingSuccessfulVerification: 1,
      missingSuccessfulVerificationRate: 0.5,
      failedValidationCommand: 1,
      failedValidationWithPolicyAction: 1,
      failedValidationWithPolicyActionRate: 1,
    },
    audit: {
      coveredTurns: 2,
      eligibleTurns: 2,
      coverageRate: 1,
      coverageDefinition: "Coverage only counts eligible turns.",
    },
    timings: {
      postToolUseDecisionLatency: {
        p50Ms: 120,
        p95Ms: 280,
      },
      stopDecisionLatency: {
        p50Ms: 90,
        p95Ms: 240,
      },
    },
    alerts: [],
  };
}

describe("useWorkspaceTurnPolicyOverview", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    workspacesApiState.getWorkspaceHookConfiguration.mockResolvedValue({
      workspaceId: "ws-1",
      workspaceRootPath: "E:/projects/alpha",
      loadStatus: "loaded",
      loadedFromPath: "E:/projects/alpha/.codex/hooks.json",
      searchedPaths: [
        "E:/projects/alpha/.codex/hooks.json",
        "E:/projects/alpha/hooks.json",
      ],
      baselineHookPreToolUseBlockDangerousCommandEnabled: null,
      baselineHookSessionStartContextPaths: ["README.md"],
      baselineHookSessionStartEnabled: null,
      baselineHookSessionStartMaxChars: null,
      baselineHookUserPromptSubmitBlockSecretPasteEnabled: null,
      configuredHookPreToolUseBlockDangerousCommandEnabled: null,
      configuredHookSessionStartContextPaths: [],
      configuredHookSessionStartEnabled: null,
      configuredHookSessionStartMaxChars: null,
      configuredHookUserPromptSubmitBlockSecretPasteEnabled: null,
      effectiveHookPreToolUseBlockDangerousCommandEnabled: true,
      effectiveHookSessionStartContextPaths: [],
      effectiveHookSessionStartEnabled: true,
      effectiveHookSessionStartMaxChars: 4000,
      effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
      effectiveHookPreToolUseDangerousCommandBlockSource: "default",
      effectiveHookSessionStartContextPathsSource: "default",
      effectiveHookSessionStartEnabledSource: "default",
      effectiveHookSessionStartMaxCharsSource: "default",
      effectiveHookUserPromptSubmitBlockSecretPasteSource: "default",
    });
  });

  it("does not query until a workspace is available", () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () => useWorkspaceTurnPolicyOverview({ workspaces: [] }),
      {
        wrapper,
      },
    );

    expect(threadsApiState.getTurnPolicyMetrics).not.toHaveBeenCalled();
    expect(result.current.selectedWorkspaceId).toBe("");
    expect(result.current.selectedWorkspace).toBeUndefined();
    expect(result.current.turnPolicyMetrics).toBeUndefined();
    expect(result.current.turnPolicyMetricsLoading).toBe(false);
    expect(result.current.turnPolicyMetricsError).toBeNull();
    expect(result.current.hookConfiguration).toBeUndefined();
    expect(result.current.hookConfigurationLoading).toBe(false);
    expect(result.current.hookConfigurationError).toBeNull();
  });

  it("defaults to the first workspace and loads workspace metrics", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    threadsApiState.getTurnPolicyMetrics.mockResolvedValueOnce(
      buildMetricsSummary("ws-1", "automation"),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const workspaces = [
      {
        id: "ws-1",
        name: "Alpha Workspace",
        rootPath: "E:/projects/alpha",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
      },
      {
        id: "ws-2",
        name: "Beta Workspace",
        rootPath: "E:/projects/beta",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T11:00:00.000Z",
      },
    ];

    const { result } = renderHook(
      () =>
        useWorkspaceTurnPolicyOverview({
          workspaces,
          sourceScope: "automation",
        }),
      {
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.turnPolicyMetricsLoading).toBe(false);
      expect(result.current.hookConfigurationLoading).toBe(false);
    });

    expect(result.current.selectedWorkspaceId).toBe("ws-1");
    expect(result.current.selectedWorkspace?.name).toBe("Alpha Workspace");
    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenCalledWith("ws-1", {
      source: "automation",
    });
    expect(workspacesApiState.getWorkspaceHookConfiguration).toHaveBeenCalledTimes(1);
    expect(result.current.turnPolicyMetrics?.workspaceId).toBe("ws-1");
    expect(result.current.hookConfiguration?.effectiveHookSessionStartEnabled).toBe(
      true,
    );
  });

  it("loads dedicated automation and bot source health when the overview is unscoped", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    threadsApiState.getTurnPolicyMetrics
      .mockResolvedValueOnce(buildMetricsSummary("ws-1"))
      .mockResolvedValueOnce(buildMetricsSummary("ws-1", "automation"))
      .mockResolvedValueOnce(buildMetricsSummary("ws-1", "bot"));

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const workspaces = [
      {
        id: "ws-1",
        name: "Alpha Workspace",
        rootPath: "E:/projects/alpha",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
      },
    ];

    const { result } = renderHook(
      () =>
        useWorkspaceTurnPolicyOverview({
          workspaces,
        }),
      {
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.turnPolicyMetricsLoading).toBe(false);
      expect(result.current.turnPolicySourceHealth?.loading).toBe(false);
    });

    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenNthCalledWith(
      1,
      "ws-1",
      { source: "" },
    );
    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenNthCalledWith(
      2,
      "ws-1",
      { source: "automation" },
    );
    expect(threadsApiState.getTurnPolicyMetrics).toHaveBeenNthCalledWith(
      3,
      "ws-1",
      { source: "bot" },
    );
    expect(result.current.turnPolicySourceHealth?.automation?.source).toBe(
      "automation",
    );
    expect(result.current.turnPolicySourceHealth?.bot?.source).toBe("bot");
    expect(result.current.turnPolicySourceHealth?.error).toBeNull();
  });

  it("preserves the current selection and falls back when it disappears", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    threadsApiState.getTurnPolicyMetrics.mockResolvedValue({
      workspaceId: "ws-2",
      generatedAt: "2026-04-08T12:00:00.000Z",
      decisions: {
        total: 0,
        actionAttempts: 0,
        actionSucceeded: 0,
        actionSuccessRate: 0,
        actionStatusCounts: {
          succeeded: 0,
          failed: 0,
          skipped: 0,
          other: 0,
        },
        actionCounts: {
          steer: 0,
          followUp: 0,
          none: 0,
          other: 0,
        },
        policyCounts: {
          failedValidationCommand: 0,
          missingSuccessfulVerification: 0,
          other: 0,
        },
        skipReasonCounts: {
          total: 0,
          duplicateFingerprint: 0,
          followUpCooldownActive: 0,
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
        completedWithFileChange: 0,
        missingSuccessfulVerification: 0,
        missingSuccessfulVerificationRate: 0,
        failedValidationCommand: 0,
        failedValidationWithPolicyAction: 0,
        failedValidationWithPolicyActionRate: 0,
      },
      audit: {
        coveredTurns: 0,
        eligibleTurns: 0,
        coverageRate: 0,
        coverageDefinition: "Coverage only counts eligible turns.",
      },
    });

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const initialWorkspaces = [
      {
        id: "ws-1",
        name: "Alpha Workspace",
        rootPath: "E:/projects/alpha",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T12:00:00.000Z",
      },
      {
        id: "ws-2",
        name: "Beta Workspace",
        rootPath: "E:/projects/beta",
        runtimeStatus: "ready",
        createdAt: "2026-04-08T00:00:00.000Z",
        updatedAt: "2026-04-08T11:00:00.000Z",
      },
    ];

    const { result, rerender } = renderHook(
      ({ workspaces }) => useWorkspaceTurnPolicyOverview({ workspaces }),
      {
        initialProps: { workspaces: initialWorkspaces },
        wrapper,
      },
    );

    await waitFor(() => {
      expect(result.current.selectedWorkspaceId).toBe("ws-1");
    });

    act(() => {
      result.current.setSelectedWorkspaceId("ws-2");
    });

    rerender({ workspaces: initialWorkspaces });

    await waitFor(() => {
      expect(result.current.selectedWorkspaceId).toBe("ws-2");
    });

    rerender({ workspaces: [initialWorkspaces[0]] });

    await waitFor(() => {
      expect(result.current.selectedWorkspaceId).toBe("ws-1");
    });
  });
});
