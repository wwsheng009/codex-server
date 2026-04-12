// @vitest-environment jsdom

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";
import { WorkspaceTurnPolicyRecentDecisionsSection } from "./WorkspaceTurnPolicyRecentDecisionsSection";

describe("WorkspaceTurnPolicyRecentDecisionsSection", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  afterEach(() => {
    cleanup();
  });

  it("renders loading state", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyRecentDecisionsSection
          filters={{
            policyName: "",
            action: "",
            actionStatus: "",
            source: "",
            reason: "",
          }}
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          turnPolicyDecisionsLoading
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Loading workspace policy decisions…"),
    ).toBeTruthy();
  });

  it("renders the empty workspace selection state", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyRecentDecisionsSection
          filters={{
            policyName: "",
            action: "",
            actionStatus: "",
            source: "",
            reason: "",
          }}
          onChangeFilters={() => {}}
          onResetFilters={() => {}}
          turnPolicyDecisionsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText(
        "Select a workspace to inspect recent automatic policy decisions.",
      ),
    ).toBeTruthy();
  });

  it("renders thread details and both workspace and thread CTAs", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyRecentDecisionsSection
          filters={{
            policyName: "",
            action: "",
            actionStatus: "",
            source: "",
            reason: "",
          }}
          hasAnyDecisions
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
          turnPolicyDecisions={[
            {
              id: "decision-1",
              workspaceId: "ws-1",
              threadId: "thread-1",
              turnId: "turn-1",
              itemId: "item-1",
              triggerMethod: "post_turn",
              policyName: "missing_successful_verification",
              fingerprint: "fp-1",
              verdict: "actionable",
              action: "follow_up",
              actionStatus: "succeeded",
              governanceLayer: "hook",
              actionTurnId: "turn-2",
              reason:
                "The turn changed files without a successful verify step.",
              evidenceSummary:
                "Modified src/app.tsx and frontend tests without verification output.",
              source: "automatic",
              error: "",
              evaluationStartedAt: "2026-04-08T12:00:00.000Z",
              decisionAt: "2026-04-08T12:00:05.000Z",
              completedAt: "2026-04-08T12:00:06.000Z",
            },
          ]}
          turnPolicyDecisionsError={null}
          turnPolicyDecisionsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Workspace Recent Policy Decisions")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open governance activity" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Showing recent policy decisions across all threads in this workspace.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Missing successful verification")).toBeTruthy();
    expect(screen.getByText("Follow Up")).toBeTruthy();
    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Thread")).toBeTruthy();
    expect(screen.getByText("thread-1")).toBeTruthy();
    expect(screen.getByTitle("automatic").textContent).toBe("Automation");
    expect(screen.getByText("Hook")).toBeTruthy();
    expect(screen.getByTitle("post_turn").textContent).toBe("Post-turn");
    expect(
      screen.getByText(
        "The turn changed files without a successful verify step.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Modified src/app.tsx and frontend tests without verification output.",
      ),
    ).toBeTruthy();

    const threadCta = screen.getByRole("link", { name: "Open thread" });
    expect(threadCta.getAttribute("href")).toBe(
      "/workspaces/ws-1/threads/thread-1",
    );

    const workspaceCta = screen.getByRole("link", { name: "Open workspace" });
    expect(workspaceCta.getAttribute("href")).toBe("/workspaces/ws-1");

    fireEvent.click(
      screen.getByRole("link", { name: "Open governance activity" }),
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "activity",
    );
  });

  it("renders a filtered empty state when no decisions match the current filters", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyRecentDecisionsSection
          filters={{
            policyName: "stop/missing-successful-verification",
            action: "",
            actionStatus: "",
            source: "",
            reason: "",
          }}
          hasAnyDecisions
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
          turnPolicyDecisions={[]}
          turnPolicyDecisionsError={null}
          turnPolicyDecisionsLoading={false}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByText("No policy decisions match the current filters."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reset filters" })).toBeTruthy();
  });

  it("renders interrupt action and no-active-turn reason filter options", () => {
    render(
      <MemoryRouter>
        <WorkspaceTurnPolicyRecentDecisionsSection
          filters={{
            policyName: "",
            action: "",
            actionStatus: "",
            source: "",
            reason: "",
          }}
          hasAnyDecisions
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
          turnPolicyDecisions={[]}
          turnPolicyDecisionsError={null}
          turnPolicyDecisionsLoading={false}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter workspace decisions by action",
      }),
    );
    expect(screen.getByRole("option", { name: "Interrupt" })).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Filter workspace decisions by reason",
      }),
    );
    expect(
      screen.getByRole("option", { name: "Interrupt found no active turn" }),
    ).toBeTruthy();
  });
});
