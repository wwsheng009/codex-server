// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimePreferencesResult } from "../../types/api";
import { useTurnPolicyAlertGovernanceActions } from "./useTurnPolicyAlertGovernanceActions";

const settingsApiState = vi.hoisted(() => ({
  readRuntimePreferences: vi.fn(),
  writeRuntimePreferences: vi.fn(),
}));

vi.mock("../../features/settings/api", () => ({
  readRuntimePreferences: settingsApiState.readRuntimePreferences,
  writeRuntimePreferences: settingsApiState.writeRuntimePreferences,
}));

function createRuntimePreferencesResult(
  overrides: Partial<RuntimePreferencesResult> = {},
): RuntimePreferencesResult {
  return {
    configuredModelCatalogPath: "",
    configuredDefaultShellType: "",
    configuredDefaultTerminalShell: "",
    supportedTerminalShells: [],
    configuredModelShellTypeOverrides: {},
    configuredOutboundProxyUrl: "",
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
    effectiveTurnPolicyPostToolUseFailedValidationEnabled: true,
    effectiveTurnPolicyStopMissingSuccessfulVerificationEnabled: true,
    effectiveTurnPolicyFollowUpCooldownMs: 120000,
    effectiveTurnPolicyPostToolUseFollowUpCooldownMs: 120000,
    effectiveTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: 120000,
    effectiveTurnPolicyPostToolUsePrimaryAction: "steer",
    effectiveTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
      "followUp",
    effectiveTurnPolicyPostToolUseInterruptNoActiveTurnBehavior: "skip",
    effectiveTurnPolicyStopMissingSuccessfulVerificationInterruptNoActiveTurnBehavior:
      "skip",
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

describe("useTurnPolicyAlertGovernanceActions", () => {
  beforeEach(() => {
    settingsApiState.readRuntimePreferences.mockReset();
    settingsApiState.writeRuntimePreferences.mockReset();
  });

  it("writes governance updates from cached runtime preferences and preserves configured tokens", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");
    const currentPrefs = createRuntimePreferencesResult({
      configuredTurnPolicyAlertAcknowledgedCodes: ["duplicate_skips_detected"],
      configuredAccessTokens: [
        {
          id: "atk-1",
          label: "Ops token",
          tokenPreview: "sk-***",
          permanent: true,
          status: "active",
          createdAt: "2026-04-01T00:00:00.000Z",
          updatedAt: "2026-04-01T00:00:00.000Z",
        },
      ],
    });
    const writtenPrefs = createRuntimePreferencesResult({
      configuredTurnPolicyAlertAcknowledgedCodes: [
        "duplicate_skips_detected",
        "cooldown_skips_detected",
      ],
    });

    queryClient.setQueryData(["settings-runtime-preferences"], currentPrefs);
    settingsApiState.writeRuntimePreferences.mockResolvedValue(writtenPrefs);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useTurnPolicyAlertGovernanceActions({ source: "workspace-overview" }),
      { wrapper },
    );

    await act(async () => {
      await result.current.applyAlertGovernanceActionAsync({
        type: "acknowledge",
        code: "cooldown_skips_detected",
      });
    });

    expect(settingsApiState.readRuntimePreferences).not.toHaveBeenCalled();
    expect(settingsApiState.writeRuntimePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        turnPolicyAlertAcknowledgedCodes: [
          "duplicate_skips_detected",
          "cooldown_skips_detected",
        ],
        turnPolicyAlertGovernanceEvent: {
          action: "acknowledge",
          source: "workspace-overview",
          codes: ["cooldown_skips_detected"],
        },
        accessTokens: [
          {
            id: "atk-1",
            label: "Ops token",
            permanent: true,
          },
        ],
      }),
    );
    expect(queryClient.getQueryData(["settings-runtime-preferences"])).toEqual(
      writtenPrefs,
    );
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["settings-runtime-preferences"],
    });
    expect(invalidateQueriesSpy).toHaveBeenCalledWith({
      queryKey: ["turn-policy-metrics"],
    });
  });

  it("loads runtime preferences on demand and snoozes alerts for 24 hours", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    });
    const currentPrefs = createRuntimePreferencesResult({
      configuredTurnPolicyAlertSnoozedCodes: ["duplicate_skips_detected"],
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-09T12:00:00.000Z",
    });
    const writtenPrefs = createRuntimePreferencesResult({
      configuredTurnPolicyAlertSnoozedCodes: [
        "duplicate_skips_detected",
        "failed_actions_detected",
      ],
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-10T08:00:00.000Z",
    });

    settingsApiState.readRuntimePreferences.mockResolvedValue(currentPrefs);
    settingsApiState.writeRuntimePreferences.mockResolvedValue(writtenPrefs);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useTurnPolicyAlertGovernanceActions({ source: "workspace-overview" }),
      { wrapper },
    );

    const beforeMutation = Date.now();
    await act(async () => {
      await result.current.applyAlertGovernanceActionAsync({
        type: "snooze24h",
        code: "failed_actions_detected",
      });
    });
    const afterMutation = Date.now();

    expect(settingsApiState.readRuntimePreferences).toHaveBeenCalledTimes(1);
    const writePayload =
      settingsApiState.writeRuntimePreferences.mock.calls[0]?.[0];
    const snoozeUntil =
      writePayload &&
      typeof writePayload.turnPolicyAlertSnoozeUntil === "string"
        ? new Date(writePayload.turnPolicyAlertSnoozeUntil).getTime()
        : Number.NaN;

    expect(settingsApiState.writeRuntimePreferences).toHaveBeenCalledWith(
      expect.objectContaining({
        turnPolicyAlertSnoozedCodes: [
          "duplicate_skips_detected",
          "failed_actions_detected",
        ],
        turnPolicyAlertGovernanceEvent: expect.objectContaining({
          action: "snooze_24h",
          source: "workspace-overview",
          codes: ["failed_actions_detected"],
        }),
      }),
    );
    expect(Number.isNaN(snoozeUntil)).toBe(false);
    expect(snoozeUntil).toBeGreaterThanOrEqual(
      beforeMutation + 24 * 60 * 60 * 1000,
    );
    expect(snoozeUntil).toBeLessThanOrEqual(
      afterMutation + 24 * 60 * 60 * 1000,
    );

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.isPending).toBe(false);
    });
  });
});
