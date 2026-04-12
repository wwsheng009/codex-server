// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";

import { i18n } from "../../i18n/runtime";
import { useWorkspaceHookRuns } from "./useWorkspaceHookRuns";

const threadsApiState = vi.hoisted(() => ({
  listHookRuns: vi.fn(),
}));

vi.mock("../../features/threads/api", () => ({
  listHookRuns: threadsApiState.listHookRuns,
}));

describe("useWorkspaceHookRuns", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    threadsApiState.listHookRuns.mockReset();
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
      () => useWorkspaceHookRuns({ selectedWorkspaceId: "" }),
      { wrapper },
    );

    expect(threadsApiState.listHookRuns).not.toHaveBeenCalled();
    expect(result.current.hookRuns).toEqual([]);
    expect(result.current.hasAnyHookRuns).toBe(false);
    expect(result.current.hookRunsLoading).toBe(false);
    expect(result.current.hookRunsError).toBeNull();
  });

  it("loads workspace hook runs with filters and the configured limit", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    threadsApiState.listHookRuns.mockResolvedValueOnce([
      {
        id: "hook-1",
        workspaceId: "ws-1",
        threadId: "thread-1",
        turnId: "turn-1",
        eventName: "PreToolUse",
        handlerKey: "builtin.pretooluse.block-dangerous-command",
        status: "completed",
        decision: "block",
        reason: "dangerous_command_blocked",
        startedAt: "2026-04-08T10:00:00.000Z",
        completedAt: "2026-04-08T10:00:01.000Z",
        durationMs: 22,
      },
    ]);
    threadsApiState.listHookRuns.mockResolvedValueOnce([
      {
        id: "hook-any",
        workspaceId: "ws-1",
        eventName: "UserPromptSubmit",
        handlerKey: "builtin.userpromptsubmit.block-secret-paste",
        status: "completed",
        startedAt: "2026-04-08T10:01:00.000Z",
      },
    ]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useWorkspaceHookRuns({
          selectedWorkspaceId: "ws-1",
          filters: {
            threadId: "thread-1",
            eventName: "PreToolUse",
            status: "completed",
            handlerKey: "builtin.pretooluse.block-dangerous-command",
            hookRunId: "hook-1",
          },
          limit: 3,
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.hookRunsLoading).toBe(false);
    });

    expect(threadsApiState.listHookRuns).toHaveBeenNthCalledWith(1, "ws-1", {
      threadId: "thread-1",
      eventName: "PreToolUse",
      status: "completed",
      handlerKey: "builtin.pretooluse.block-dangerous-command",
      runId: "hook-1",
      limit: 3,
    });
    expect(threadsApiState.listHookRuns).toHaveBeenNthCalledWith(2, "ws-1", {
      limit: 1,
    });
    expect(result.current.hookRuns).toHaveLength(1);
    expect(result.current.hasAnyHookRuns).toBe(true);
    expect(result.current.hookRunsError).toBeNull();
  });

  it("returns stringified query errors", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    threadsApiState.listHookRuns.mockRejectedValueOnce(
      new Error("Hook run load failed"),
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useWorkspaceHookRuns({
          selectedWorkspaceId: "ws-1",
        }),
      { wrapper },
    );

    await waitFor(() => {
      expect(result.current.hookRunsError).toBe("Hook run load failed");
    });

    expect(result.current.hookRuns).toEqual([]);
    expect(result.current.hasAnyHookRuns).toBe(false);
    expect(result.current.hookRunsLoading).toBe(false);
  });
});
