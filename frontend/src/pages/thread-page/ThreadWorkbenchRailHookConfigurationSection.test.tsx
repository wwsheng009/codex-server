// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";
import type { WorkspaceHookConfigurationResult } from "../../types/api";
import { ThreadWorkbenchRailHookConfigurationSection } from "./ThreadWorkbenchRailHookConfigurationSection";

describe("ThreadWorkbenchRailHookConfigurationSection", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  it("renders effective workspace hook configuration with baseline and override summary", () => {
    render(
      <MemoryRouter>
        <ThreadWorkbenchRailHookConfigurationSection
          hookConfiguration={
            {
              workspaceId: "ws-1",
              workspaceRootPath: "E:/projects/ai/codex-server",
              loadStatus: "loaded",
              loadedFromPath:
                "E:/projects/ai/codex-server/.codex/hooks.json",
              searchedPaths: [
                "E:/projects/ai/codex-server/.codex/hooks.json",
                "E:/projects/ai/codex-server/hooks.json",
                "C:/Users/vince/.codex/hooks.json",
              ],
              baselineHookSessionStartContextPaths: [
                ".codex/SESSION_START.md",
                "README.md",
              ],
              baselineHookPreToolUseAdditionalProtectedGovernancePaths: [
                "docs/governance.md",
              ],
              configuredHookSessionStartEnabled: false,
              configuredHookSessionStartMaxChars: 1200,
              configuredHookUserPromptSubmitBlockSecretPasteEnabled: true,
              configuredHookPreToolUseBlockDangerousCommandEnabled: null,
              configuredHookPreToolUseAdditionalProtectedGovernancePaths: [
                "runtime/governance.md",
              ],
              effectiveHookSessionStartEnabled: false,
              effectiveHookSessionStartContextPaths: [
                ".codex/SESSION_START.md",
                "README.md",
              ],
              effectiveHookSessionStartMaxChars: 1200,
              effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
              effectiveHookPreToolUseBlockDangerousCommandEnabled: true,
              effectiveHookPreToolUseProtectedGovernancePaths: [
                ".codex/hooks.json",
                "hooks.json",
                ".codex/SESSION_START.md",
                ".codex/session-start.md",
                "AGENTS.md",
                "CLAUDE.md",
                "docs/governance.md",
                "runtime/governance.md",
              ],
              effectiveHookSessionStartEnabledSource: "runtime",
              effectiveHookSessionStartContextPathsSource: "workspace",
              effectiveHookSessionStartMaxCharsSource: "runtime",
              effectiveHookUserPromptSubmitBlockSecretPasteSource: "runtime",
              effectiveHookPreToolUseDangerousCommandBlockSource: "default",
              effectiveHookPreToolUseProtectedGovernancePathsSource: "runtime",
            } as WorkspaceHookConfigurationResult
          }
          hookConfigurationError={null}
          hookConfigurationLoading={false}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Hook Configuration")).toBeTruthy();
    expect(
      screen.getByText(
        "Hook baseline loads workspace hooks.json first, falls back to CODEX_HOME/hooks.json when needed, runtime overrides come from Settings, and the rows below show the final effective result used by the hook engine.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Each effective row includes a source label so you can tell whether that value currently comes from the built-in default, the hook baseline layer, or a runtime override.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Runtime overrides currently change effective hook behavior",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "4 runtime override values are active. Editing workspace hooks.json alone will not remove them.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Loaded · .codex/hooks.json"),
    ).toBeTruthy();
    expect(screen.getByText("2 active")).toBeTruthy();
    expect(screen.getByText("4 active")).toBeTruthy();
    expect(screen.getByText("Disabled · Runtime override")).toBeTruthy();
    expect(
      screen.getByText(
        "2 paths · .codex/SESSION_START.md, README.md · Workspace baseline",
      ),
    ).toBeTruthy();
    expect(screen.getByText("1,200 chars · Runtime override")).toBeTruthy();
    expect(screen.getByText("Enabled · Built-in default")).toBeTruthy();
    expect(
      screen.getByText(
        "8 paths · .codex/hooks.json, hooks.json, +6 more · Runtime override",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open governance settings" })
        .getAttribute("href"),
    ).toBe("/settings/governance");
    fireEvent.click(
      screen.getByRole("link", { name: "Open governance settings" }),
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "overview",
    );
  });

  it("can direct the governance link to the workspace baseline tab", () => {
    render(
      <MemoryRouter>
        <ThreadWorkbenchRailHookConfigurationSection
          governanceTab="workspace"
          hookConfiguration={
            {
              workspaceId: "ws-1",
              workspaceRootPath: "E:/projects/ai/codex-server",
              loadStatus: "loaded",
              loadedFromPath:
                "E:/projects/ai/codex-server/.codex/hooks.json",
              effectiveHookSessionStartEnabled: true,
              effectiveHookSessionStartContextPaths: [],
              effectiveHookSessionStartMaxChars: 1200,
              effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
              effectiveHookPreToolUseBlockDangerousCommandEnabled: true,
              effectiveHookPreToolUseProtectedGovernancePaths: [],
            } as WorkspaceHookConfigurationResult
          }
          hookConfigurationError={null}
          hookConfigurationLoading={false}
        />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getAllByRole("link", { name: "Open governance settings" }).at(-1)!,
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "workspace",
    );
  });
});
