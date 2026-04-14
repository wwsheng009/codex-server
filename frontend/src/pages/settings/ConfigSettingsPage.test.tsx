// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";
import type {
  ConfigReadResult,
  ConfigRequirementsResult,
  RuntimePreferencesResult,
  WorkspaceRuntimeState,
} from "../../types/api";

const settingsApiState = vi.hoisted(() => ({
  batchWriteConfig: vi.fn(),
  detectExternalAgentConfig: vi.fn(),
  importExternalAgentConfig: vi.fn(),
  importRuntimeModelCatalogTemplate: vi.fn(),
  logoutAccess: vi.fn(),
  readConfig: vi.fn(),
  readConfigRequirements: vi.fn(),
  readRuntimePreferences: vi.fn(),
  writeConfigValue: vi.fn(),
  writeRuntimePreferences: vi.fn(),
}));

const workspaceApiState = vi.hoisted(() => ({
  getWorkspaceRuntimeState: vi.fn(),
  restartWorkspace: vi.fn(),
}));

const shellContextState = vi.hoisted(() => ({
  useSettingsShellContext: vi.fn(),
}));

const notificationDiagnosticsState = vi.hoisted(() => ({
  useNotificationRealtimeDiagnostics: vi.fn(),
}));

vi.mock("../../features/settings/api", () => ({
  batchWriteConfig: settingsApiState.batchWriteConfig,
  detectExternalAgentConfig: settingsApiState.detectExternalAgentConfig,
  importExternalAgentConfig: settingsApiState.importExternalAgentConfig,
  importRuntimeModelCatalogTemplate:
    settingsApiState.importRuntimeModelCatalogTemplate,
  logoutAccess: settingsApiState.logoutAccess,
  readConfig: settingsApiState.readConfig,
  readConfigRequirements: settingsApiState.readConfigRequirements,
  readRuntimePreferences: settingsApiState.readRuntimePreferences,
  writeConfigValue: settingsApiState.writeConfigValue,
  writeRuntimePreferences: settingsApiState.writeRuntimePreferences,
}));

vi.mock("../../features/workspaces/api", () => ({
  getWorkspaceRuntimeState: workspaceApiState.getWorkspaceRuntimeState,
  restartWorkspace: workspaceApiState.restartWorkspace,
}));

vi.mock("../../features/settings/shell-context", () => ({
  useSettingsShellContext: shellContextState.useSettingsShellContext,
}));

vi.mock("../../features/notifications/useNotificationRealtimeDiagnostics", () => ({
  useNotificationRealtimeDiagnostics:
    notificationDiagnosticsState.useNotificationRealtimeDiagnostics,
}));

let ConfigSettingsPageComponent: Awaited<
  typeof import("./ConfigSettingsPage")
>["ConfigSettingsPage"];

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: {
        retry: false,
      },
      queries: {
        retry: false,
      },
    },
  });
}

function createConfigReadResult(
  overrides: Partial<ConfigReadResult> = {},
): ConfigReadResult {
  return {
    config: {},
    origins: {},
    layers: [],
    ...overrides,
  };
}

function createConfigRequirementsResult(
  overrides: Partial<ConfigRequirementsResult> = {},
): ConfigRequirementsResult {
  return {
    requirements: null,
    ...overrides,
  };
}

function createWorkspaceRuntimeState(
  overrides: Partial<WorkspaceRuntimeState> = {},
): WorkspaceRuntimeState {
  return {
    workspaceId: "ws-1",
    status: "running",
    command: "codex-server",
    rootPath: "E:/projects/ai/codex-server",
    lastErrorRetryable: false,
    lastErrorRequiresRuntimeRecycle: false,
    updatedAt: "2026-04-10T00:00:00.000Z",
    configLoadStatus: "loaded",
    restartRequired: false,
    ...overrides,
  };
}

function createRuntimePreferencesResult(
  overrides: Partial<RuntimePreferencesResult> = {},
): RuntimePreferencesResult {
  return {
    configuredModelCatalogPath: "",
    configuredDefaultShellType: "",
    configuredDefaultTerminalShell: "",
    supportedTerminalShells: ["powershell", "bash"],
    configuredModelShellTypeOverrides: {},
    configuredOutboundProxyUrl: "",
    configuredHookSessionStartEnabled: false,
    configuredHookSessionStartContextPaths: [
      ".codex/SESSION_START.md",
      "README.md",
    ],
    configuredHookSessionStartMaxChars: 1200,
    configuredHookUserPromptSubmitBlockSecretPasteEnabled: false,
    configuredHookPreToolUseBlockDangerousCommandEnabled: true,
    configuredHookPreToolUseAdditionalProtectedGovernancePaths: [
      "ops/governance.md",
    ],
    configuredTurnPolicyPostToolUseFailedValidationEnabled: null,
    configuredTurnPolicyStopMissingSuccessfulVerificationEnabled: null,
    configuredTurnPolicyFollowUpCooldownMs: null,
    configuredTurnPolicyPostToolUseFollowUpCooldownMs: null,
    configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
      null,
    configuredTurnPolicyPostToolUsePrimaryAction: "",
    configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction: "",
    configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "",
    configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "",
    configuredTurnPolicyValidationCommandPrefixes: [],
    configuredTurnPolicyAlertCoverageThresholdPercent: null,
    configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: null,
    configuredTurnPolicyAlertStopLatencyP95ThresholdMs: null,
    configuredTurnPolicyAlertSourceActionSuccessThresholdPercent: null,
    configuredTurnPolicyAlertSuppressedCodes: [],
    configuredTurnPolicyAlertAcknowledgedCodes: [],
    configuredTurnPolicyAlertSnoozedCodes: [],
    configuredTurnPolicyAlertSnoozeUntil: null,
    configuredTurnPolicyAlertSnoozeActive: false,
    configuredTurnPolicyAlertSnoozeExpired: false,
    turnPolicyAlertGovernanceHistory: [],
    configuredDefaultTurnApprovalPolicy: "",
    configuredDefaultTurnSandboxPolicy: null,
    configuredDefaultCommandSandboxPolicy: null,
    configuredAllowRemoteAccess: null,
    configuredAllowLocalhostWithoutAccessToken: null,
    configuredAccessTokens: [],
    configuredBackendThreadTraceEnabled: null,
    configuredBackendThreadTraceWorkspaceId: "",
    configuredBackendThreadTraceThreadId: "",
    defaultModelCatalogPath: "",
    defaultDefaultShellType: "",
    defaultDefaultTerminalShell: "",
    defaultModelShellTypeOverrides: {},
    defaultOutboundProxyUrl: "",
    defaultHookSessionStartEnabled: true,
    defaultHookSessionStartContextPaths: [
      ".codex/SESSION_START.md",
      "AGENTS.md",
      "README.md",
    ],
    defaultHookSessionStartMaxChars: 4000,
    defaultHookUserPromptSubmitBlockSecretPasteEnabled: true,
    defaultHookPreToolUseBlockDangerousCommandEnabled: true,
    defaultHookPreToolUseProtectedGovernancePaths: [
      ".codex/hooks.json",
      "hooks.json",
      ".codex/SESSION_START.md",
      ".codex/session-start.md",
      "AGENTS.md",
      "CLAUDE.md",
    ],
    defaultTurnPolicyPostToolUseFailedValidationEnabled: true,
    defaultTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
    defaultTurnPolicyFollowUpCooldownMs: 120000,
    defaultTurnPolicyPostToolUseFollowUpCooldownMs: 120000,
    defaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: 120000,
    defaultTurnPolicyPostToolUsePrimaryAction: "steer",
    defaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction: "followUp",
    defaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
    defaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "skip",
    defaultTurnPolicyValidationCommandPrefixes: [],
    defaultTurnPolicyAlertCoverageThresholdPercent: 100,
    defaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: 1000,
    defaultTurnPolicyAlertStopLatencyP95ThresholdMs: 1000,
    defaultTurnPolicyAlertSourceActionSuccessThresholdPercent: 100,
    defaultTurnPolicyAlertSuppressedCodes: [],
    defaultTurnPolicyAlertAcknowledgedCodes: [],
    defaultTurnPolicyAlertSnoozedCodes: [],
    defaultTurnPolicyAlertSnoozeUntil: null,
    defaultDefaultTurnApprovalPolicy: "",
    defaultDefaultTurnSandboxPolicy: null,
    defaultDefaultCommandSandboxPolicy: null,
    defaultAllowRemoteAccess: false,
    defaultAllowLocalhostWithoutAccessToken: false,
    defaultBackendThreadTraceEnabled: false,
    defaultBackendThreadTraceWorkspaceId: "",
    defaultBackendThreadTraceThreadId: "",
    effectiveModelCatalogPath: "",
    effectiveDefaultShellType: "",
    effectiveDefaultTerminalShell: "",
    effectiveModelShellTypeOverrides: {},
    effectiveOutboundProxyUrl: "",
    effectiveHookSessionStartEnabled: false,
    effectiveHookSessionStartContextPaths: [
      ".codex/SESSION_START.md",
      "README.md",
    ],
    effectiveHookSessionStartMaxChars: 1200,
    effectiveHookUserPromptSubmitBlockSecretPasteEnabled: false,
    effectiveHookPreToolUseBlockDangerousCommandEnabled: true,
    effectiveHookPreToolUseProtectedGovernancePaths: [
      ".codex/hooks.json",
      "hooks.json",
      ".codex/SESSION_START.md",
      ".codex/session-start.md",
      "AGENTS.md",
      "CLAUDE.md",
      "ops/governance.md",
    ],
    effectiveTurnPolicyPostToolUseFailedValidationEnabled: true,
    effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
    effectiveTurnPolicyFollowUpCooldownMs: 120000,
    effectiveTurnPolicyPostToolUseFollowUpCooldownMs: 120000,
    effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
      120000,
    effectiveTurnPolicyPostToolUsePrimaryAction: "steer",
    effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      "followUp",
    effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
    effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "skip",
    effectiveTurnPolicyValidationCommandPrefixes: [],
    effectiveTurnPolicyAlertCoverageThresholdPercent: 100,
    effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: 1000,
    effectiveTurnPolicyAlertStopLatencyP95ThresholdMs: 1000,
    effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent: 100,
    effectiveTurnPolicyAlertSuppressedCodes: [],
    effectiveTurnPolicyAlertAcknowledgedCodes: [],
    effectiveTurnPolicyAlertSnoozedCodes: [],
    effectiveTurnPolicyAlertSnoozeUntil: null,
    effectiveDefaultTurnApprovalPolicy: "",
    effectiveDefaultTurnSandboxPolicy: null,
    effectiveDefaultCommandSandboxPolicy: null,
    effectiveAllowRemoteAccess: false,
    effectiveAllowLocalhostWithoutAccessToken: false,
    effectiveBackendThreadTraceEnabled: false,
    effectiveBackendThreadTraceWorkspaceId: "",
    effectiveBackendThreadTraceThreadId: "",
    effectiveCommand: "codex",
    ...overrides,
  };
}

function renderWithProviders(node: ReactNode) {
  const queryClient = createQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ConfigSettingsPage hook runtime preferences", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  beforeAll(async () => {
    ConfigSettingsPageComponent = (
      await import("./ConfigSettingsPage")
    ).ConfigSettingsPage;
  });

  beforeEach(() => {
    cleanup();
    localStorage.clear();
    settingsApiState.batchWriteConfig.mockReset();
    settingsApiState.detectExternalAgentConfig.mockReset();
    settingsApiState.importExternalAgentConfig.mockReset();
    settingsApiState.importRuntimeModelCatalogTemplate.mockReset();
    settingsApiState.logoutAccess.mockReset();
    settingsApiState.readConfig.mockReset();
    settingsApiState.readConfigRequirements.mockReset();
    settingsApiState.readRuntimePreferences.mockReset();
    settingsApiState.writeConfigValue.mockReset();
    settingsApiState.writeRuntimePreferences.mockReset();
    workspaceApiState.getWorkspaceRuntimeState.mockReset();
    workspaceApiState.restartWorkspace.mockReset();

    shellContextState.useSettingsShellContext.mockReturnValue({
      workspaceId: "ws-1",
      workspaceName: "Codex Server",
      workspaces: [],
      workspacesLoading: false,
      workspacesError: null,
      setSelectedWorkspaceId: vi.fn(),
    });
    notificationDiagnosticsState.useNotificationRealtimeDiagnostics.mockReturnValue(
      {
        activeWorkspaceId: "ws-1",
        diagnosticsHistory: [],
        diagnosticsLastChangedAt: "",
        liveWorkspaceDiagnostics: [],
        notificationsQuery: {
          data: [],
          error: null,
          isLoading: false,
        },
        workspaceNameById: {},
      },
    );

    settingsApiState.readConfig.mockResolvedValue(createConfigReadResult());
    settingsApiState.readConfigRequirements.mockResolvedValue(
      createConfigRequirementsResult(),
    );
    settingsApiState.readRuntimePreferences.mockResolvedValue(
      createRuntimePreferencesResult(),
    );
    settingsApiState.writeRuntimePreferences.mockResolvedValue(
      createRuntimePreferencesResult(),
    );
    settingsApiState.batchWriteConfig.mockResolvedValue({
      filePath: "E:/projects/ai/codex-server/config.json",
      status: "ok",
      version: "1",
    });
    settingsApiState.writeConfigValue.mockResolvedValue({
      filePath: "E:/projects/ai/codex-server/config.json",
      status: "ok",
      version: "1",
    });
    settingsApiState.importRuntimeModelCatalogTemplate.mockResolvedValue(
      createRuntimePreferencesResult(),
    );
    settingsApiState.detectExternalAgentConfig.mockResolvedValue({ items: [] });
    settingsApiState.importExternalAgentConfig.mockResolvedValue({
      status: "ok",
    });
    settingsApiState.logoutAccess.mockResolvedValue({ status: "ok" });
    workspaceApiState.getWorkspaceRuntimeState.mockResolvedValue(
      createWorkspaceRuntimeState(),
    );
    workspaceApiState.restartWorkspace.mockResolvedValue({
      id: "ws-1",
      name: "Codex Server",
      rootPath: "E:/projects/ai/codex-server",
      runtimeStatus: "running",
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not surface legacy governance migration or duplicate governance editors", async () => {
    renderWithProviders(<ConfigSettingsPageComponent />);

    await waitFor(() => {
      expect(settingsApiState.readRuntimePreferences).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Governance Settings Moved")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Governance Overview" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Open Runtime Governance" }),
    ).toBeNull();
    expect(screen.queryByText("Legacy Inline Governance Controls")).toBeNull();
    expect(screen.queryByText("Hook SessionStart Context")).toBeNull();
    expect(screen.queryByText("Hook Input And Tool Guards")).toBeNull();
    expect(screen.queryByText("Turn Policy Execution Controls")).toBeNull();
  }, 15000);

  it("surfaces runtime recovery guidance when the workspace runtime reports a classified failure", async () => {
    localStorage.setItem("settings-config-runtime-side-tabs", "runtime-state");
    workspaceApiState.getWorkspaceRuntimeState.mockResolvedValue(
      createWorkspaceRuntimeState({
        status: "error",
        lastError: "runtime exited unexpectedly",
        lastErrorCategory: "process_exit",
        lastErrorRecoveryAction: "retry-after-restart",
        lastErrorRetryable: true,
        lastErrorRequiresRuntimeRecycle: true,
        recentStderr: ["runtime exited unexpectedly", "exit status 23"],
      }),
    );

    renderWithProviders(<ConfigSettingsPageComponent />);

    await waitFor(() => {
      expect(settingsApiState.readRuntimePreferences).toHaveBeenCalledTimes(1);
    });

    expect(await screen.findByText("Runtime Recovery Guidance")).toBeTruthy();
    expect(
      screen.getByText(/Last error: runtime exited unexpectedly/i),
    ).toBeTruthy();
    expect(
      screen.getAllByText("Restart runtime before retrying").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Runtime process exit").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Restart runtime, then retry").length).toBeGreaterThan(0);
  });

  it("shows a direct config action and richer next-step copy for fix-launch-config recovery", async () => {
    localStorage.setItem("settings-config-runtime-side-tabs", "runtime-state");
    workspaceApiState.getWorkspaceRuntimeState.mockResolvedValue(
      createWorkspaceRuntimeState({
        status: "error",
        lastError: "invalid runtime launch config",
        lastErrorCategory: "configuration",
        lastErrorRecoveryAction: "fix-launch-config",
        lastErrorRetryable: false,
        lastErrorRequiresRuntimeRecycle: false,
        recentStderr: ["invalid shell_environment_policy"],
      }),
    );

    renderWithProviders(<ConfigSettingsPageComponent />);

    await waitFor(() => {
      expect(settingsApiState.readRuntimePreferences).toHaveBeenCalledTimes(1);
    });

    expect(
      await screen.findByText("Review launch configuration before restarting"),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Open Config Settings" }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(
        /Fix the workspace launch settings first, then restart the runtime/i,
      ),
    ).toHaveLength(2);
    expect(screen.getAllByText("Launch configuration").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Fix launch config").length).toBeGreaterThan(0);
  });
});
