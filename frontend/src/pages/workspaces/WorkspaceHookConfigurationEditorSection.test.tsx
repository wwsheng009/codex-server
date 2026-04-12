// @vitest-environment jsdom

import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";
import { WorkspaceHookConfigurationEditorSection } from "./WorkspaceHookConfigurationEditorSection";

const workspacesApiState = vi.hoisted(() => ({
  writeWorkspaceHookConfiguration: vi.fn(),
}));

vi.mock("../../features/workspaces/api", () => ({
  writeWorkspaceHookConfiguration:
    workspacesApiState.writeWorkspaceHookConfiguration,
}));

function renderWithClient(children: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("WorkspaceHookConfigurationEditorSection", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    workspacesApiState.writeWorkspaceHookConfiguration.mockResolvedValue({
      status: "written",
      filePath: "E:/projects/ai/codex-server/.codex/hooks.json",
      configuration: {
        workspaceId: "ws-1",
        workspaceRootPath: "E:/projects/ai/codex-server",
        loadStatus: "loaded",
        loadedFromPath: "E:/projects/ai/codex-server/.codex/hooks.json",
        baselineHookSessionStartEnabled: false,
        baselineHookSessionStartContextPaths: [
          "docs/session-start.md",
          "README.md",
        ],
        baselineHookSessionStartMaxChars: 720,
        baselineHookUserPromptSubmitBlockSecretPasteEnabled: true,
        baselineHookPreToolUseBlockDangerousCommandEnabled: false,
        baselineHookPreToolUseAdditionalProtectedGovernancePaths: [
          "docs/governance.md",
        ],
        configuredHookSessionStartContextPaths: [],
        effectiveHookSessionStartEnabled: false,
        effectiveHookSessionStartContextPaths: [
          "docs/session-start.md",
          "README.md",
        ],
        effectiveHookSessionStartMaxChars: 720,
        effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
        effectiveHookPreToolUseBlockDangerousCommandEnabled: false,
        effectiveHookPreToolUseProtectedGovernancePaths: [
          ".codex/hooks.json",
          "hooks.json",
          ".codex/SESSION_START.md",
          ".codex/session-start.md",
          "AGENTS.md",
          "CLAUDE.md",
          "docs/governance.md",
        ],
        effectiveHookSessionStartEnabledSource: "workspace",
        effectiveHookSessionStartContextPathsSource: "workspace",
        effectiveHookSessionStartMaxCharsSource: "workspace",
        effectiveHookUserPromptSubmitBlockSecretPasteSource: "workspace",
        effectiveHookPreToolUseDangerousCommandBlockSource: "workspace",
        effectiveHookPreToolUseProtectedGovernancePathsSource: "workspace",
      },
    });
  });

  it("saves normalized workspace hook baseline values", async () => {
    renderWithClient(
      <WorkspaceHookConfigurationEditorSection
        hookConfiguration={{
          workspaceId: "ws-1",
          workspaceRootPath: "E:/projects/ai/codex-server",
          loadStatus: "loaded",
          loadedFromPath: "E:/projects/ai/codex-server/.codex/hooks.json",
          baselineHookSessionStartEnabled: false,
          baselineHookSessionStartContextPaths: ["docs/session-start.md"],
          baselineHookSessionStartMaxChars: 480,
          baselineHookUserPromptSubmitBlockSecretPasteEnabled: true,
          baselineHookPreToolUseBlockDangerousCommandEnabled: false,
          baselineHookPreToolUseAdditionalProtectedGovernancePaths: [
            "docs/governance.md",
          ],
          configuredHookSessionStartEnabled: true,
          configuredHookSessionStartContextPaths: [],
          configuredHookSessionStartMaxChars: 1200,
          effectiveHookSessionStartEnabled: false,
          effectiveHookSessionStartContextPaths: ["docs/session-start.md"],
          effectiveHookSessionStartMaxChars: 480,
          effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
          effectiveHookPreToolUseBlockDangerousCommandEnabled: false,
          effectiveHookPreToolUseProtectedGovernancePaths: [
            ".codex/hooks.json",
            "hooks.json",
            ".codex/SESSION_START.md",
            ".codex/session-start.md",
            "AGENTS.md",
            "CLAUDE.md",
            "docs/governance.md",
          ],
        }}
        selectedWorkspace={{
          id: "ws-1",
          name: "Workspace A",
          rootPath: "E:/projects/ai/codex-server",
          runtimeStatus: "ready",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }}
      />,
    );

    expect(
      screen.getByText(
        "This editor writes only the workspace baseline stored in .codex/hooks.json.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Runtime preferences are separate global overrides. Effective hook behavior is resolved from built-in defaults, this workspace baseline, and any saved runtime overrides.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Runtime overrides are active")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open governance workspace" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "2 runtime override values are currently configured. Saving this form updates only the workspace baseline and does not clear those overrides.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("2 active")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("link", { name: "Open governance workspace" }),
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "workspace",
    );

    fireEvent.change(screen.getByLabelText("SessionStart context paths"), {
      target: {
        value: " docs\\\\session-start.md \nREADME.md\nREADME.md",
      },
    });
    fireEvent.change(screen.getByLabelText("SessionStart max chars"), {
      target: {
        value: "720",
      },
    });
    fireEvent.change(
      screen.getByLabelText("Additional protected governance paths"),
      {
        target: {
          value:
            " docs\\\\governance.md \nops/release-policy.md\nops/release-policy.md",
        },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save Workspace Baseline" }),
    );

    await waitFor(() => {
      expect(
        workspacesApiState.writeWorkspaceHookConfiguration,
      ).toHaveBeenCalledTimes(1);
    });

    expect(workspacesApiState.writeWorkspaceHookConfiguration).toHaveBeenCalledWith(
      "ws-1",
      {
        hookSessionStartEnabled: false,
        hookSessionStartContextPaths: [
          "docs/session-start.md",
          "README.md",
        ],
        hookSessionStartMaxChars: 720,
        hookUserPromptSubmitBlockSecretPasteEnabled: true,
        hookPreToolUseBlockDangerousCommandEnabled: false,
        hookPreToolUseAdditionalProtectedGovernancePaths: [
          "docs/governance.md",
          "ops/release-policy.md",
        ],
      },
    );
  });

  it("resets workspace baseline by sending an empty payload", async () => {
    renderWithClient(
      <WorkspaceHookConfigurationEditorSection
        hookConfiguration={{
          workspaceId: "ws-1",
          workspaceRootPath: "E:/projects/ai/codex-server",
          loadStatus: "loaded",
          loadedFromPath: "E:/projects/ai/codex-server/.codex/hooks.json",
        }}
        selectedWorkspace={{
          id: "ws-1",
          name: "Workspace A",
          rootPath: "E:/projects/ai/codex-server",
          runtimeStatus: "ready",
          createdAt: "2026-04-10T00:00:00.000Z",
          updatedAt: "2026-04-10T00:00:00.000Z",
        }}
      />,
    );

    fireEvent.click(
      screen.getAllByRole("button", { name: "Reset Workspace Baseline" })[0]!,
    );

    await waitFor(() => {
      expect(
        workspacesApiState.writeWorkspaceHookConfiguration,
      ).toHaveBeenCalledTimes(1);
    });

    expect(workspacesApiState.writeWorkspaceHookConfiguration).toHaveBeenCalledWith(
      "ws-1",
      {},
    );
  });
});
