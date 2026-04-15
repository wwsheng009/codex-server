// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";
import { WorkspaceHookRunsSection } from "./WorkspaceHookRunsSection";

describe("WorkspaceHookRunsSection", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders loading state", () => {
    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          hookRunsLoading
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Loading workspace hook runs…")).toBeTruthy();
  });

  it("renders the empty workspace selection state", () => {
    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          hookRunsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Select a workspace to inspect governance hook runs."),
    ).toBeTruthy();
  });

  it("renders hook run details and thread CTA", () => {
    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          hasAnyHookRuns
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          hookRuns={[
            {
              id: "hook-1",
              workspaceId: "ws-1",
              threadId: "thread-1",
              eventName: "PreToolUse",
              handlerKey: "builtin.pretooluse.block-dangerous-command",
              triggerMethod: "command/exec",
              status: "completed",
              decision: "block",
              toolName: "command/exec",
              reason: "dangerous_command_blocked",
              additionalContext: "rm -rf /",
              entries: [
                { kind: "feedback", text: "matched policy: broad-recursive-delete" },
              ],
              startedAt: "2026-04-08T12:00:00.000Z",
              completedAt: "2026-04-08T12:00:00.100Z",
              durationMs: 100,
            },
          ]}
          hookRunsError={null}
          hookRunsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Workspace Hook Runs")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open governance activity" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Showing recent governance hook runs across all threads in this workspace.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Hook Run" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Summary" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Outcome" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Details" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
    expect(screen.getByText("hook-1")).toBeTruthy();
    expect(screen.getByText("Pre-Tool Use")).toBeTruthy();
    expect(screen.getByText("Dangerous Command Guard")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getAllByTitle("command/exec").map((node) => node.textContent)).toEqual([
      "Command Execution",
      "Command Execution",
    ]);
    expect(screen.getByText("thread-1")).toBeTruthy();
    expect(screen.getAllByText("Command Execution")).toHaveLength(2);
    expect(screen.getByText("Dangerous command blocked")).toBeTruthy();
    expect(screen.getByText("Matched Policy: broad-recursive-delete")).toBeTruthy();
    expect(screen.getByText("rm -rf /")).toBeTruthy();

    const threadCta = screen.getByRole("link", { name: "Open thread" });
    expect(threadCta.getAttribute("href")).toBe("/workspaces/ws-1/threads/thread-1");

    const workspaceCta = screen.getByRole("link", { name: "Open workspace" });
    expect(workspaceCta.getAttribute("href")).toBe("/workspaces/ws-1");

    fireEvent.click(
      screen.getByRole("link", { name: "Open governance activity" }),
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "activity",
    );
  });

  it("renders dedicated thread entry event labels with readable reasons", () => {
    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          hasAnyHookRuns
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          hookRuns={[
            {
              id: "hook-2",
              workspaceId: "ws-1",
              threadId: "thread-2",
              eventName: "TurnStart",
              handlerKey: "builtin.turnstart.audit-thread-turn-start",
              triggerMethod: "turn/start",
              status: "completed",
              decision: "continue",
              toolName: "turn/start",
              reason: "turn_start_audited",
              startedAt: "2026-04-08T12:05:00.000Z",
              completedAt: "2026-04-08T12:05:00.030Z",
              durationMs: 30,
            },
          ]}
          hookRunsError={null}
          hookRunsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTitle("TurnStart").textContent).toBe("Turn Start");
    expect(screen.getAllByTitle("turn/start").map((node) => node.textContent)).toEqual([
      "Turn Start",
      "Turn Start",
    ]);
    expect(screen.getByText("Thread Turn Start Audit")).toBeTruthy();
    expect(screen.getByText("Turn start audited")).toBeTruthy();
  });

  it("renders session start source when the hook run records it", () => {
    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          hasAnyHookRuns
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          hookRuns={[
            {
              id: "hook-3",
              workspaceId: "ws-1",
              threadId: "thread-2",
              eventName: "SessionStart",
              handlerKey: "builtin.sessionstart.inject-project-context",
              triggerMethod: "turn/start",
              status: "completed",
              decision: "continue",
              toolName: "turn/start",
              reason: "project_context_injected",
              sessionStartSource: "resume",
              startedAt: "2026-04-08T12:06:00.000Z",
              completedAt: "2026-04-08T12:06:00.030Z",
              durationMs: 30,
            },
          ]}
          hookRunsError={null}
          hookRunsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Session Start")).toBeTruthy();
    expect(screen.getByText("Project Context Injection")).toBeTruthy();
    expect(screen.getByText("Session Start Source")).toBeTruthy();
    expect(screen.getByText("Resume")).toBeTruthy();
  });

  it("renders a filtered empty state when no hook runs match the current filters", () => {
    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "thread-1",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          hasAnyHookRuns
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          hookRuns={[]}
          hookRunsError={null}
          hookRunsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No hook runs match the current filters."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
  });

  it("updates text filters through the provided change callback", () => {
    const onChangeFilters = vi.fn();

    render(
      <MemoryRouter>
        <WorkspaceHookRunsSection
          filters={{
            threadId: "",
            eventName: "",
            status: "",
            handlerKey: "",
            hookRunId: "",
          }}
          hasAnyHookRuns
          onChangeFilters={onChangeFilters}
          onResetFilters={() => {}}
          selectedWorkspace={{
            id: "ws-1",
            name: "Alpha Workspace",
            rootPath: "E:/projects/alpha",
            runtimeStatus: "ready",
            createdAt: "2026-04-08T00:00:00.000Z",
            updatedAt: "2026-04-08T00:00:00.000Z",
          }}
          hookRuns={[]}
          hookRunsError={null}
          hookRunsLoading={false}
        />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByPlaceholderText("Filter by hook run ID"), {
      target: { value: "hook-9" },
    });
    fireEvent.change(screen.getByPlaceholderText("Filter by thread ID"), {
      target: { value: "thread-9" },
    });

    expect(onChangeFilters).toHaveBeenNthCalledWith(1, {
      threadId: "",
      eventName: "",
      status: "",
      handlerKey: "",
      hookRunId: "hook-9",
    });
    expect(onChangeFilters).toHaveBeenNthCalledWith(2, {
      threadId: "thread-9",
      eventName: "",
      status: "",
      handlerKey: "",
      hookRunId: "",
    });
  });
});
