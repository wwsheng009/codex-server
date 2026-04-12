// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

import { i18n } from "../../i18n/runtime";
import type {
  RuntimePreferencesResult,
  TurnPolicyMetricsSummary,
  Workspace,
  WorkspaceHookConfigurationResult,
} from "../../types/api";

const settingsApiState = vi.hoisted(() => ({
  readRuntimePreferences: vi.fn(),
  writeRuntimePreferences: vi.fn(),
}));

const threadsApiState = vi.hoisted(() => ({
  getTurnPolicyMetrics: vi.fn(),
}));

const workspacesApiState = vi.hoisted(() => ({
  getWorkspaceHookConfiguration: vi.fn(),
  writeWorkspaceHookConfiguration: vi.fn(),
}));

const shellContextState = vi.hoisted(() => ({
  useSettingsShellContext: vi.fn(),
}));

const workspaceHooksState = vi.hoisted(() => ({
  useWorkspaceHookRuns: vi.fn(),
  useWorkspaceTurnPolicyRecentDecisions: vi.fn(),
}));

vi.mock("../../features/settings/api", async () => {
  const actual = await vi.importActual("../../features/settings/api");
  return {
    ...actual,
    readRuntimePreferences: settingsApiState.readRuntimePreferences,
    writeRuntimePreferences: settingsApiState.writeRuntimePreferences,
  };
});

vi.mock("../../features/threads/api", async () => {
  const actual = await vi.importActual("../../features/threads/api");
  return {
    ...actual,
    getTurnPolicyMetrics: threadsApiState.getTurnPolicyMetrics,
  };
});

vi.mock("../../features/workspaces/api", async () => {
  const actual = await vi.importActual("../../features/workspaces/api");
  return {
    ...actual,
    getWorkspaceHookConfiguration: workspacesApiState.getWorkspaceHookConfiguration,
    writeWorkspaceHookConfiguration:
      workspacesApiState.writeWorkspaceHookConfiguration,
  };
});

vi.mock("../../features/settings/shell-context", () => ({
  useSettingsShellContext: shellContextState.useSettingsShellContext,
}));

vi.mock("../workspaces/useWorkspaceHookRuns", () => ({
  useWorkspaceHookRuns: workspaceHooksState.useWorkspaceHookRuns,
}));

vi.mock("../workspaces/useWorkspaceTurnPolicyRecentDecisions", () => ({
  useWorkspaceTurnPolicyRecentDecisions:
    workspaceHooksState.useWorkspaceTurnPolicyRecentDecisions,
}));

vi.mock("../thread-page/ThreadWorkbenchRailHookConfigurationSection", () => ({
  ThreadWorkbenchRailHookConfigurationSection: () => (
    <div>Hook configuration summary</div>
  ),
}));

vi.mock("../workspaces/WorkspaceHookConfigurationEditorSection", () => ({
  WorkspaceHookConfigurationEditorSection: () => (
    <div>Workspace hook baseline editor</div>
  ),
}));

vi.mock("../workspaces/WorkspaceTurnPolicyOverviewSection", () => ({
  WorkspaceTurnPolicyOverviewSection: () => <div>Policy overview section</div>,
}));

vi.mock("../workspaces/WorkspaceTurnPolicyRecentDecisionsSection", () => ({
  WorkspaceTurnPolicyRecentDecisionsSection: () => (
    <div>Recent policy decisions section</div>
  ),
}));

vi.mock("../workspaces/WorkspaceHookRunsSection", () => ({
  WorkspaceHookRunsSection: () => <div>Hook runs section</div>,
}));

let GovernanceSettingsPageComponent: Awaited<
  typeof import("./GovernanceSettingsPage")
>["GovernanceSettingsPage"];

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function createWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "Alpha Workspace",
    rootPath: "E:/projects/alpha",
    runtimeStatus: "ready",
    createdAt: "2026-04-10T00:00:00.000Z",
    updatedAt: "2026-04-10T12:00:00.000Z",
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
    supportedTerminalShells: ["powershell"],
    configuredModelShellTypeOverrides: {},
    configuredOutboundProxyUrl: "",
    configuredHookSessionStartEnabled: true,
    configuredHookSessionStartContextPaths: [".codex/SESSION_START.md"],
    configuredHookSessionStartMaxChars: 1600,
    configuredHookUserPromptSubmitBlockSecretPasteEnabled: true,
    configuredHookPreToolUseBlockDangerousCommandEnabled: true,
    configuredHookPreToolUseAdditionalProtectedGovernancePaths: [
      "docs/governance.md",
    ],
    configuredTurnPolicyPostToolUseFailedValidationEnabled: true,
    configuredTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
    configuredTurnPolicyFollowUpCooldownMs: 60000,
    configuredTurnPolicyPostToolUseFollowUpCooldownMs: 120000,
    configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
      180000,
    configuredTurnPolicyPostToolUsePrimaryAction: "steer",
    configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      "followUp",
    configuredTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
    configuredTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "followUp",
    configuredTurnPolicyValidationCommandPrefixes: ["npm test"],
    configuredTurnPolicyAlertCoverageThresholdPercent: 80,
    configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: 4500,
    configuredTurnPolicyAlertStopLatencyP95ThresholdMs: 3500,
    configuredTurnPolicyAlertSourceActionSuccessThresholdPercent: 75,
    configuredTurnPolicyAlertSuppressedCodes: ["coverage_low"],
    configuredTurnPolicyAlertAcknowledgedCodes: ["stop_latency_high"],
    configuredTurnPolicyAlertSnoozedCodes: ["bot_action_success_low"],
    configuredTurnPolicyAlertSnoozeUntil: "2026-04-13T00:00:00.000Z",
    configuredTurnPolicyAlertSnoozeActive: true,
    configuredTurnPolicyAlertSnoozeExpired: false,
    turnPolicyAlertGovernanceHistory: [],
    configuredDefaultTurnApprovalPolicy: "",
    configuredDefaultTurnSandboxPolicy: null,
    configuredDefaultCommandSandboxPolicy: null,
    configuredAllowRemoteAccess: false,
    configuredAllowLocalhostWithoutAccessToken: false,
    configuredAccessTokens: [],
    configuredBackendThreadTraceEnabled: false,
    configuredBackendThreadTraceWorkspaceId: "",
    configuredBackendThreadTraceThreadId: "",
    defaultModelCatalogPath: "",
    defaultDefaultShellType: "",
    defaultDefaultTerminalShell: "",
    defaultModelShellTypeOverrides: {},
    defaultOutboundProxyUrl: "",
    defaultHookSessionStartEnabled: true,
    defaultHookSessionStartContextPaths: [".codex/SESSION_START.md"],
    defaultHookSessionStartMaxChars: 1600,
    defaultHookUserPromptSubmitBlockSecretPasteEnabled: true,
    defaultHookPreToolUseBlockDangerousCommandEnabled: true,
    defaultHookPreToolUseProtectedGovernancePaths: [".codex/hooks.json"],
    defaultTurnPolicyPostToolUseFailedValidationEnabled: true,
    defaultTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
    defaultTurnPolicyFollowUpCooldownMs: 60000,
    defaultTurnPolicyPostToolUseFollowUpCooldownMs: 120000,
    defaultTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
      180000,
    defaultTurnPolicyPostToolUsePrimaryAction: "steer",
    defaultTurnPolicyStopMissingSuccessfulVerificationPrimaryAction: "followUp",
    defaultTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
    defaultTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "followUp",
    defaultTurnPolicyValidationCommandPrefixes: ["npm test"],
    defaultTurnPolicyAlertCoverageThresholdPercent: 80,
    defaultTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: 4500,
    defaultTurnPolicyAlertStopLatencyP95ThresholdMs: 3500,
    defaultTurnPolicyAlertSourceActionSuccessThresholdPercent: 75,
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
    effectiveHookSessionStartEnabled: true,
    effectiveHookSessionStartContextPaths: [".codex/SESSION_START.md"],
    effectiveHookSessionStartMaxChars: 1600,
    effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
    effectiveHookPreToolUseBlockDangerousCommandEnabled: true,
    effectiveHookPreToolUseProtectedGovernancePaths: [".codex/hooks.json"],
    effectiveTurnPolicyPostToolUseFailedValidationEnabled: true,
    effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
    effectiveTurnPolicyFollowUpCooldownMs: 60000,
    effectiveTurnPolicyPostToolUseFollowUpCooldownMs: 120000,
    effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs:
      180000,
    effectiveTurnPolicyPostToolUsePrimaryAction: "steer",
    effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      "followUp",
    effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
    effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "followUp",
    effectiveTurnPolicyValidationCommandPrefixes: ["npm test"],
    effectiveTurnPolicyAlertCoverageThresholdPercent: 80,
    effectiveTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: 4500,
    effectiveTurnPolicyAlertStopLatencyP95ThresholdMs: 3500,
    effectiveTurnPolicyAlertSourceActionSuccessThresholdPercent: 75,
    effectiveTurnPolicyAlertSuppressedCodes: ["coverage_low"],
    effectiveTurnPolicyAlertAcknowledgedCodes: ["stop_latency_high"],
    effectiveTurnPolicyAlertSnoozedCodes: ["bot_action_success_low"],
    effectiveTurnPolicyAlertSnoozeUntil: "2026-04-13T00:00:00.000Z",
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

function createHookConfigurationResult(
  overrides: Partial<WorkspaceHookConfigurationResult> = {},
): WorkspaceHookConfigurationResult {
  return {
    workspaceId: "ws-1",
    workspaceRootPath: "E:/projects/alpha",
    loadStatus: "loaded",
    loadedFromPath: "E:/projects/alpha/.codex/hooks.json",
    searchedPaths: [
      "E:/projects/alpha/.codex/hooks.json",
      "E:/projects/alpha/hooks.json",
    ],
    baselineHookSessionStartEnabled: true,
    baselineHookSessionStartContextPaths: [".codex/SESSION_START.md"],
    baselineHookSessionStartMaxChars: 1600,
    baselineHookUserPromptSubmitBlockSecretPasteEnabled: true,
    baselineHookPreToolUseBlockDangerousCommandEnabled: true,
    baselineHookPreToolUseAdditionalProtectedGovernancePaths: [
      "docs/governance.md",
    ],
    configuredHookSessionStartEnabled: true,
    configuredHookSessionStartContextPaths: [".codex/SESSION_START.md"],
    configuredHookSessionStartMaxChars: 1600,
    configuredHookUserPromptSubmitBlockSecretPasteEnabled: true,
    configuredHookPreToolUseBlockDangerousCommandEnabled: true,
    configuredHookPreToolUseAdditionalProtectedGovernancePaths: [
      "docs/governance.md",
    ],
    effectiveHookSessionStartEnabled: true,
    effectiveHookSessionStartContextPaths: [".codex/SESSION_START.md"],
    effectiveHookSessionStartMaxChars: 1600,
    effectiveHookUserPromptSubmitBlockSecretPasteEnabled: true,
    effectiveHookPreToolUseBlockDangerousCommandEnabled: true,
    effectiveHookPreToolUseProtectedGovernancePaths: [".codex/hooks.json"],
    effectiveHookSessionStartEnabledSource: "runtime",
    effectiveHookSessionStartContextPathsSource: "runtime",
    effectiveHookSessionStartMaxCharsSource: "runtime",
    effectiveHookUserPromptSubmitBlockSecretPasteSource: "runtime",
    effectiveHookPreToolUseDangerousCommandBlockSource: "runtime",
    effectiveHookPreToolUseProtectedGovernancePathsSource: "runtime",
    ...overrides,
  };
}

function createTurnPolicyMetricsSummary(
  overrides: Partial<TurnPolicyMetricsSummary> = {},
): TurnPolicyMetricsSummary {
  return {
    workspaceId: "ws-1",
    generatedAt: "2026-04-12T00:00:00.000Z",
    config: {
      postToolUseFailedValidationPolicyEnabled: true,
      stopMissingSuccessfulVerificationPolicyEnabled: true,
      postToolUsePrimaryAction: "steer",
      stopMissingSuccessfulVerificationPrimaryAction: "followUp",
      postToolUseInterruptNoActiveTurnBehavior: "skip",
      stopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
        "followUp",
      validationCommandPrefixes: ["npm test"],
      followUpCooldownMs: 60000,
      postToolUseFollowUpCooldownMs: 120000,
      stopMissingSuccessfulVerificationFollowUpCooldownMs: 180000,
    },
    alerts: [
      {
        code: "coverage_low",
        severity: "warning",
        title: "Coverage below threshold",
        message: "Coverage is below threshold.",
      },
    ],
    alertPolicy: {
      suppressedCodes: ["coverage_low"],
      suppressedCount: 1,
      acknowledgedCodes: ["stop_latency_high"],
      acknowledgedCount: 1,
      snoozedCodes: ["bot_action_success_low"],
      snoozedCount: 1,
      snoozeUntil: "2026-04-13T00:00:00.000Z",
    },
    recentWindows: undefined,
    history: undefined,
    decisions: {
      total: 5,
      actionAttempts: 4,
      actionSucceeded: 3,
      actionSuccessRate: 0.75,
      actionStatusCounts: {
        succeeded: 3,
        failed: 1,
        skipped: 1,
        other: 0,
      },
      actionCounts: {
        steer: 2,
        followUp: 1,
        interrupt: 1,
        none: 1,
        other: 0,
      },
      policyCounts: {
        failedValidationCommand: 3,
        missingSuccessfulVerification: 2,
        other: 0,
      },
      skipReasonCounts: {
        total: 1,
        duplicateFingerprint: 0,
        followUpCooldownActive: 1,
        interruptNoActiveTurn: 0,
        other: 0,
      },
    },
    sources: {
      interactive: {
        total: 3,
        actionAttempts: 2,
        actionSucceeded: 2,
        actionSuccessRate: 1,
        skipped: 1,
      },
      automation: {
        total: 1,
        actionAttempts: 1,
        actionSucceeded: 0,
        actionSuccessRate: 0,
        skipped: 0,
      },
      bot: {
        total: 1,
        actionAttempts: 1,
        actionSucceeded: 1,
        actionSuccessRate: 1,
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
      completedWithFileChange: 4,
      missingSuccessfulVerification: 1,
      missingSuccessfulVerificationRate: 0.25,
      failedValidationCommand: 2,
      failedValidationWithPolicyAction: 1,
      failedValidationWithPolicyActionRate: 0.5,
    },
    audit: {
      coveredTurns: 4,
      eligibleTurns: 5,
      coverageRate: 0.8,
      coverageDefinition: "eligible turns with audit coverage",
    },
    timings: {
      postToolUseDecisionLatency: {
        p50Ms: 120,
        p95Ms: 420,
      },
      stopDecisionLatency: {
        p50Ms: 140,
        p95Ms: 510,
      },
    },
    ...overrides,
  };
}

describe("GovernanceSettingsPage", () => {
  beforeAll(async () => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
    GovernanceSettingsPageComponent = (
      await import("./GovernanceSettingsPage")
    ).GovernanceSettingsPage;
  });

  beforeEach(() => {
    vi.clearAllMocks();

    shellContextState.useSettingsShellContext.mockReturnValue({
      workspaceId: "ws-1",
      workspaceName: "Alpha Workspace",
      workspaces: [createWorkspace()],
      workspacesLoading: false,
      workspacesError: null,
      setSelectedWorkspaceId: vi.fn(),
    });

    settingsApiState.readRuntimePreferences.mockResolvedValue(
      createRuntimePreferencesResult(),
    );
    settingsApiState.writeRuntimePreferences.mockResolvedValue(
      createRuntimePreferencesResult(),
    );
    workspacesApiState.getWorkspaceHookConfiguration.mockResolvedValue(
      createHookConfigurationResult(),
    );
    workspacesApiState.writeWorkspaceHookConfiguration.mockResolvedValue({
      status: "saved",
      filePath: "E:/projects/alpha/.codex/hooks.json",
      configuration: createHookConfigurationResult(),
    });
    threadsApiState.getTurnPolicyMetrics.mockResolvedValue(
      createTurnPolicyMetricsSummary(),
    );
    workspaceHooksState.useWorkspaceHookRuns.mockReturnValue({
      hookRuns: [],
      hasAnyHookRuns: false,
      hookRunsLoading: false,
      hookRunsError: null,
    });
    workspaceHooksState.useWorkspaceTurnPolicyRecentDecisions.mockReturnValue({
      turnPolicyDecisions: [],
      hasAnyDecisions: false,
      turnPolicyDecisionsLoading: false,
      turnPolicyDecisionsError: null,
    });
  });

  it("renders the unified governance entry with tabs and quick navigation", async () => {
    const queryClient = createQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <GovernanceSettingsPageComponent />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("heading", { name: "Governance" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Governance Scope" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Quick Navigation"),
    ).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Overview" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Runtime Controls" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Workspace Baseline" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Activity" })).toBeTruthy();
      expect(screen.getByText("Hook configuration summary")).toBeTruthy();
    });

    expect(screen.getByText("Open workspace")).toBeTruthy();
    expect(screen.getByText("Metrics history")).toBeTruthy();
    expect(screen.getByText("Compare sources")).toBeTruthy();
  });
});
