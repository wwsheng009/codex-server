// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";

import {
  readRuntimePreferences,
  writeRuntimePreferences,
} from "../../features/settings/api";
import { formatLocalizedDateTime } from "../../i18n/display";
import { i18n } from "../../i18n/runtime";
import type {
  RuntimePreferencesResult,
  TurnPolicyMetricsSummary,
} from "../../types/api";

vi.mock("../../features/settings/api", () => ({
  readRuntimePreferences: vi.fn(),
  writeRuntimePreferences: vi.fn(),
}));

import { ThreadWorkbenchRailTurnPolicyMetricsSection } from "./ThreadWorkbenchRailTurnPolicyMetricsSection";

describe("ThreadWorkbenchRailTurnPolicyMetricsSection", () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: "en", messages: {} });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

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

  function renderWithProviders(node: ReactNode) {
    const queryClient = createQueryClient();

    return render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{node}</MemoryRouter>
      </QueryClientProvider>,
    );
  }

  function buildRuntimePreferencesResult(
    overrides?: Partial<RuntimePreferencesResult>,
  ) {
    return {
      configuredAccessTokens: [],
      configuredAllowLocalhostWithoutAccessToken: null,
      configuredAllowRemoteAccess: null,
      configuredBackendThreadTraceEnabled: null,
      configuredBackendThreadTraceThreadId: "",
      configuredBackendThreadTraceWorkspaceId: "",
      configuredDefaultCommandSandboxPolicy: undefined,
      configuredDefaultShellType: "",
      configuredDefaultTerminalShell: "",
      configuredDefaultTurnApprovalPolicy: "",
      configuredDefaultTurnSandboxPolicy: undefined,
      configuredModelCatalogPath: "",
      configuredModelShellTypeOverrides: {},
      configuredOutboundProxyUrl: "",
      configuredTurnPolicyAlertAcknowledgedCodes: [
        "automation_action_failures",
        "duplicate_skips_detected",
        "bot_action_failures",
      ],
      configuredTurnPolicyAlertCoverageThresholdPercent: null,
      configuredTurnPolicyAlertPostToolUseLatencyP95ThresholdMs: null,
      configuredTurnPolicyAlertSnoozedCodes: [
        "automation_action_failures",
        "bot_action_failures",
        "stop_decision_latency_high",
      ],
      configuredTurnPolicyAlertSnoozeActive: true,
      configuredTurnPolicyAlertSnoozeExpired: false,
      configuredTurnPolicyAlertSnoozeUntil: "2026-04-10T05:10:00.000Z",
      configuredTurnPolicyAlertSourceActionSuccessThresholdPercent: null,
      configuredTurnPolicyAlertStopLatencyP95ThresholdMs: null,
      configuredTurnPolicyAlertSuppressedCodes: [
        "cooldown_skips_detected",
        "post_tool_use_latency_high",
      ],
      configuredTurnPolicyFollowUpCooldownMs: 45000,
      configuredTurnPolicyPostToolUseFailedValidationEnabled: true,
      configuredTurnPolicyPostToolUseFollowUpCooldownMs: 15000,
      configuredTurnPolicyPostToolUsePrimaryAction: "interrupt",
      configuredTurnPolicyStopMissingSuccessfulVerificationEnabled: false,
      configuredTurnPolicyStopMissingSuccessfulVerificationFollowUpCooldownMs: 120000,
      configuredTurnPolicyStopMissingSuccessfulVerificationPrimaryAction:
        "followUp",
      ...overrides,
    } as RuntimePreferencesResult;
  }

  it("renders turn policy metrics for the selected thread", () => {
    renderWithProviders(
      <ThreadWorkbenchRailTurnPolicyMetricsSection
        selectedThread={{
          id: "thread-1",
          workspaceId: "ws-1",
          name: "Release Thread",
          status: "idle",
          archived: false,
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        turnPolicyMetrics={
          {
            workspaceId: "ws-1",
            threadId: "thread-1",
            generatedAt: "2026-04-08T12:00:00.000Z",
            config: {
              postToolUsePolicyEnabled: true,
              postToolUsePrimaryAction: "interrupt",
              postToolUseFollowUpCooldownMs: 15000,
              stopMissingVerificationPolicyEnabled: false,
              stopMissingSuccessfulVerificationPrimaryAction: "followUp",
              stopMissingSuccessfulVerificationFollowUpCooldownMs: 120000,
              followUpCooldownMs: 45000,
            },
            alerts: [
              {
                code: "automation_action_failures",
                severity: "warning",
                title: "Automation actions are failing",
                message: "Automation source actions have not all succeeded.",
                acknowledged: true,
                source: "automation",
                actionStatus: "failed",
              },
              {
                code: "duplicate_skips_detected",
                severity: "info",
                title: "Duplicate skips are accumulating",
                message:
                  "Duplicate fingerprint skips were recorded for this thread.",
                actionStatus: "skipped",
                reason: "duplicate_fingerprint",
              },
              {
                code: "bot_action_failures",
                severity: "warning",
                title: "Bot actions are failing",
                message: "Bot source actions have not all succeeded.",
                source: "bot",
                actionStatus: "failed",
              },
              {
                code: "slow_stop_decisions",
                severity: "warning",
                title: "Stop decisions are slow",
                message: "P95 stop decision latency is above threshold.",
              },
            ],
            alertPolicy: {
              acknowledgedCodes: [
                "automation_action_failures",
                "duplicate_skips_detected",
                "bot_action_failures",
              ],
              acknowledgedCount: 3,
              suppressedCodes: [
                "cooldown_skips_detected",
                "post_tool_use_latency_high",
              ],
              suppressedCount: 2,
              snoozedCodes: [
                "automation_action_failures",
                "bot_action_failures",
                "stop_decision_latency_high",
              ],
              snoozedCount: 3,
              snoozeUntil: "2026-04-10T05:10:00.000Z",
            },
            decisions: {
              total: 6,
              actionAttempts: 4,
              actionSucceeded: 3,
              actionSuccessRate: 0.75,
              actionStatusCounts: {
                succeeded: 3,
                failed: 1,
                skipped: 2,
                other: 0,
              },
              actionCounts: {
                steer: 1,
                followUp: 2,
                interrupt: 1,
                none: 2,
                other: 0,
              },
              policyCounts: {
                failedValidationCommand: 2,
                missingSuccessfulVerification: 3,
                other: 0,
              },
              skipReasonCounts: {
                total: 2,
                duplicateFingerprint: 1,
                followUpCooldownActive: 0,
                interruptNoActiveTurn: 1,
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
              completedWithFileChange: 3,
              missingSuccessfulVerification: 2,
              missingSuccessfulVerificationRate: 0.6667,
              failedValidationCommand: 2,
              failedValidationWithPolicyAction: 1,
              failedValidationWithPolicyActionRate: 0.5,
            },
            audit: {
              coveredTurns: 3,
              eligibleTurns: 4,
              coverageRate: 0.75,
              coverageDefinition: "Coverage only counts eligible turns.",
            },
            timings: {
              postToolUseDecisionLatency: {
                p50Ms: 420,
                p95Ms: 980,
              },
              stopDecisionLatency: {
                p50Ms: 110,
                p95Ms: 260,
              },
            },
          } as TurnPolicyMetricsSummary & {
            config: {
              followUpCooldownMs: number;
              postToolUseFollowUpCooldownMs: number;
              postToolUsePrimaryAction: string;
              postToolUsePolicyEnabled: boolean;
              stopMissingSuccessfulVerificationFollowUpCooldownMs: number;
              stopMissingSuccessfulVerificationPrimaryAction: string;
              stopMissingVerificationPolicyEnabled: boolean;
            };
          }
        }
        turnPolicyMetricsError={null}
        turnPolicyMetricsLoading={false}
        workspaceTurnPolicyRoutes={{
          validationRescue:
            "/workspaces?selectedWorkspaceId=ws-1&policyName=posttooluse%2Ffailed-validation-command&actionStatus=succeeded&turnPolicyThreadId=thread-1",
          missingVerify:
            "/workspaces?selectedWorkspaceId=ws-1&policyName=stop%2Fmissing-successful-verification&turnPolicyThreadId=thread-1",
          skippedDecisions:
            "/workspaces?selectedWorkspaceId=ws-1&actionStatus=skipped&turnPolicyThreadId=thread-1",
          automationSource:
            "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&source=automation",
          botSource:
            "/workspaces/turn-policy/bot?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&source=bot",
          sourceComparison:
            "/workspaces/turn-policy/compare?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1",
          alertHistory:
            "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&historyRange=90d&historyGranularity=week",
          automationHistory:
            "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&historyRange=90d&historyGranularity=week",
          botHistory:
            "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&historyRange=90d&historyGranularity=week",
        }}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Open governance activity" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("link", { name: "Open governance activity" }),
    );
    expect(window.localStorage.getItem("settings-governance-tab")).toBe(
      "activity",
    );

    expect(screen.getByText("Turn Policy Metrics")).toBeTruthy();
    expect(screen.getByText("Audit Coverage")).toBeTruthy();
    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("Validation Rescue")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.getByText("Missing Verify")).toBeTruthy();
    expect(screen.getByText("66.7%")).toBeTruthy();
    expect(screen.getByText("Attention Needed")).toBeTruthy();
    expect(
      screen.getByText(
        "2 alerts suppressed by settings (Cooldown skips detected, Post-tool-use latency high).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "3 alerts acknowledged as known issues in settings (Automation action failures, Duplicate skips detected, +1 more).",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `3 alerts temporarily snoozed until ${formatLocalizedDateTime("2026-04-10T05:10:00.000Z")} (Automation action failures, Bot action failures, +1 more).`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Warning: Automation actions are failing (Acknowledged)",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText("Automation source actions have not all succeeded."),
    ).toBeTruthy();
    expect(
      screen.getByText("Info: Duplicate skips are accumulating"),
    ).toBeTruthy();
    expect(screen.getByText("Warning: Bot actions are failing")).toBeTruthy();
    expect(screen.queryByText("Warning: Stop decisions are slow")).toBeNull();
    expect(screen.getByText("Execution Controls")).toBeTruthy();
    expect(screen.getByText("Post-tool-use policy")).toBeTruthy();
    expect(screen.getByText("Missing verify policy")).toBeTruthy();
    expect(screen.getByText("Follow-up cooldown")).toBeTruthy();
    expect(screen.getByText("Post-tool-use follow-up cooldown")).toBeTruthy();
    expect(screen.getByText("Post-tool-use action")).toBeTruthy();
    expect(screen.getByText("Missing verify follow-up cooldown")).toBeTruthy();
    expect(screen.getByText("Missing verify action")).toBeTruthy();
    expect(screen.getByText("Post-tool-use interrupt fallback")).toBeTruthy();
    expect(screen.getByText("Missing verify interrupt fallback")).toBeTruthy();
    expect(screen.getAllByText("Interrupt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Follow Up").length).toBeGreaterThan(0);
    expect(screen.getByText("45 s")).toBeTruthy();
    expect(screen.getByText("15 s")).toBeTruthy();
    expect(screen.getByText("2 min")).toBeTruthy();
    expect(screen.getByText("Interrupt actions")).toBeTruthy();
    expect(screen.getByText("Action success")).toBeTruthy();
    expect(screen.getByText("75% (3 / 4)")).toBeTruthy();
    expect(screen.getByText("Automation decisions")).toBeTruthy();
    expect(screen.getByText("1 decision, 0% success, 0 skipped")).toBeTruthy();
    expect(screen.getByText("Bot decisions")).toBeTruthy();
    expect(
      screen.getByText("1 decision, 100% success, 0 skipped"),
    ).toBeTruthy();
    expect(screen.getByText("Source comparison")).toBeTruthy();
    expect(
      screen.getByText("Compare interactive, automation, and bot health"),
    ).toBeTruthy();
    expect(screen.getByText("Alert history")).toBeTruthy();
    expect(screen.getByText("Automation history")).toBeTruthy();
    expect(screen.getByText("Bot history")).toBeTruthy();
    expect(screen.getByText("Post-tool-use latency")).toBeTruthy();
    expect(screen.getByText("P50 420 ms, P95 980 ms")).toBeTruthy();
    expect(screen.getByText("Stop decision latency")).toBeTruthy();
    expect(screen.getByText("P50 110 ms, P95 260 ms")).toBeTruthy();
    expect(screen.getByText("Cooldown skips")).toBeTruthy();
    expect(screen.getByText("Interrupt skips")).toBeTruthy();
    expect(
      screen.getByText("Interrupt skips").closest(".detail-row")?.textContent,
    ).toContain("1");
    expect(
      screen.getByText("Coverage only counts eligible turns."),
    ).toBeTruthy();

    const rescueCta = screen.getByRole("link", {
      name: "View rescued decisions",
    });
    expect(rescueCta.getAttribute("href")).toBe(
      "/workspaces?selectedWorkspaceId=ws-1&policyName=posttooluse%2Ffailed-validation-command&actionStatus=succeeded&turnPolicyThreadId=thread-1",
    );
    expect(
      screen.getByRole("link", { name: "View missing verify decisions" }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: "Open automation overview" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&source=automation",
    );
    expect(
      screen
        .getByRole("link", { name: "Review automation alert" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&source=automation",
    );
    expect(
      screen
        .getByRole("link", { name: "Open bot overview" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/bot?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&source=bot",
    );
    expect(
      screen
        .getByRole("link", { name: "Open source comparison" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/compare?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1",
    );
    expect(
      screen
        .getByRole("link", { name: "Open alert history" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&historyRange=90d&historyGranularity=week",
    );
    expect(
      screen
        .getByRole("link", { name: "Open automation history" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&historyRange=90d&historyGranularity=week",
    );
    expect(
      screen
        .getByRole("link", { name: "Open bot history" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/history?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&historyRange=90d&historyGranularity=week",
    );
    expect(
      screen
        .getByRole("link", { name: "Review bot alert" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/bot?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&source=bot",
    );
    expect(
      screen.getByRole("link", { name: "View skipped decisions" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Clear acknowledgement for alert Automation actions are failing",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Clear snooze for alert Automation actions are failing",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Snooze 24h for alert Duplicate skips are accumulating",
      }),
    ).toBeTruthy();
  });

  it("runs thread alert governance actions without removing review links", async () => {
    vi.mocked(readRuntimePreferences).mockResolvedValue(
      buildRuntimePreferencesResult(),
    );
    vi.mocked(writeRuntimePreferences).mockResolvedValue(
      buildRuntimePreferencesResult(),
    );

    renderWithProviders(
      <ThreadWorkbenchRailTurnPolicyMetricsSection
        selectedThread={{
          id: "thread-1",
          workspaceId: "ws-1",
          name: "Release Thread",
          status: "idle",
          archived: false,
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        turnPolicyMetrics={
          {
            workspaceId: "ws-1",
            threadId: "thread-1",
            alerts: [
              {
                code: "automation_action_failures",
                severity: "warning",
                title: "Automation actions are failing",
                message: "Automation source actions have not all succeeded.",
                acknowledged: true,
                source: "automation",
              },
              {
                code: "duplicate_skips_detected",
                severity: "info",
                title: "Duplicate skips are accumulating",
                message:
                  "Duplicate fingerprint skips were recorded for this thread.",
              },
            ],
            alertPolicy: {
              acknowledgedCodes: ["automation_action_failures"],
              acknowledgedCount: 1,
              snoozedCodes: [
                "automation_action_failures",
                "bot_action_failures",
                "stop_decision_latency_high",
              ],
              snoozedCount: 3,
              snoozeUntil: "2026-04-10T05:10:00.000Z",
            },
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
                total: 1,
                actionAttempts: 1,
                actionSucceeded: 1,
                actionSuccessRate: 1,
                skipped: 0,
              },
              automation: {
                total: 1,
                actionAttempts: 0,
                actionSucceeded: 0,
                actionSuccessRate: 0,
                skipped: 1,
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
                p50Ms: 10,
                p95Ms: 20,
              },
              stopDecisionLatency: {
                p50Ms: 10,
                p95Ms: 20,
              },
            },
          } as TurnPolicyMetricsSummary
        }
        turnPolicyMetricsError={null}
        turnPolicyMetricsLoading={false}
        workspaceTurnPolicyRoutes={{
          automationSource:
            "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&source=automation",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear snooze for alert Automation actions are failing",
      }),
    );

    await waitFor(() => {
      expect(writeRuntimePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          turnPolicyAlertSnoozeUntil: "2026-04-10T05:10:00.000Z",
          turnPolicyAlertSnoozedCodes: [
            "bot_action_failures",
            "stop_decision_latency_high",
          ],
          turnPolicyAlertGovernanceEvent: {
            action: "clear_snooze",
            source: "thread-metrics",
            codes: ["automation_action_failures"],
            snoozeUntil: null,
          },
        }),
      );
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Snooze 24h for alert Duplicate skips are accumulating",
      }),
    );

    await waitFor(() => {
      expect(writeRuntimePreferences).toHaveBeenLastCalledWith(
        expect.objectContaining({
          turnPolicyAlertSnoozedCodes: [
            "automation_action_failures",
            "bot_action_failures",
            "stop_decision_latency_high",
            "duplicate_skips_detected",
          ],
          turnPolicyAlertGovernanceEvent: expect.objectContaining({
            action: "snooze_24h",
            source: "thread-metrics",
            codes: ["duplicate_skips_detected"],
          }),
        }),
      );
    });

    expect(
      screen
        .getByRole("link", { name: "Review automation alert" })
        .getAttribute("href"),
    ).toBe(
      "/workspaces/turn-policy/automation?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=automation&source=automation",
    );
  });

  it("shows alert governance errors when thread quick actions fail", async () => {
    vi.mocked(readRuntimePreferences).mockResolvedValue(
      buildRuntimePreferencesResult({
        configuredTurnPolicyAlertAcknowledgedCodes: [],
      }),
    );
    vi.mocked(writeRuntimePreferences).mockRejectedValue(
      new Error("write failed"),
    );

    renderWithProviders(
      <ThreadWorkbenchRailTurnPolicyMetricsSection
        selectedThread={{
          id: "thread-1",
          workspaceId: "ws-1",
          name: "Release Thread",
          status: "idle",
          archived: false,
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        turnPolicyMetrics={
          {
            workspaceId: "ws-1",
            threadId: "thread-1",
            alerts: [
              {
                code: "bot_action_failures",
                severity: "warning",
                title: "Bot actions are failing",
                message: "Bot source actions have not all succeeded.",
                source: "bot",
              },
            ],
            alertPolicy: {
              acknowledgedCodes: [],
              acknowledgedCount: 0,
              snoozedCodes: [],
              snoozedCount: 0,
            },
            decisions: {
              total: 1,
              actionAttempts: 1,
              actionSucceeded: 0,
              actionSuccessRate: 0,
              actionStatusCounts: {
                succeeded: 0,
                failed: 1,
                skipped: 0,
                other: 0,
              },
              actionCounts: {
                steer: 0,
                followUp: 1,
                interrupt: 0,
                none: 0,
                other: 0,
              },
              policyCounts: {
                failedValidationCommand: 0,
                missingSuccessfulVerification: 1,
                other: 0,
              },
              skipReasonCounts: {
                total: 0,
                duplicateFingerprint: 0,
                followUpCooldownActive: 0,
                interruptNoActiveTurn: 0,
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
                total: 1,
                actionAttempts: 1,
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
              completedWithFileChange: 1,
              missingSuccessfulVerification: 1,
              missingSuccessfulVerificationRate: 1,
              failedValidationCommand: 0,
              failedValidationWithPolicyAction: 0,
              failedValidationWithPolicyActionRate: 0,
            },
            audit: {
              coveredTurns: 1,
              eligibleTurns: 1,
              coverageRate: 1,
              coverageDefinition: "Coverage only counts eligible turns.",
            },
            timings: {
              postToolUseDecisionLatency: {
                p50Ms: 10,
                p95Ms: 20,
              },
              stopDecisionLatency: {
                p50Ms: 10,
                p95Ms: 20,
              },
            },
          } as TurnPolicyMetricsSummary
        }
        turnPolicyMetricsError={null}
        turnPolicyMetricsLoading={false}
        workspaceTurnPolicyRoutes={{
          botSource:
            "/workspaces/turn-policy/bot?selectedWorkspaceId=ws-1&turnPolicyThreadId=thread-1&metricsSource=bot&source=bot",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Acknowledge for alert Bot actions are failing",
      }),
    );

    await waitFor(() => {
      expect(screen.getByText("Alert governance update failed")).toBeTruthy();
      expect(screen.getAllByText("write failed")).toHaveLength(2);
    });
  });

  it("keeps execution controls hidden when config is absent", () => {
    renderWithProviders(
      <ThreadWorkbenchRailTurnPolicyMetricsSection
        selectedThread={{
          id: "thread-1",
          workspaceId: "ws-1",
          name: "Release Thread",
          status: "idle",
          archived: false,
          createdAt: "2026-04-08T00:00:00.000Z",
          updatedAt: "2026-04-08T00:00:00.000Z",
        }}
        turnPolicyMetrics={{
          workspaceId: "ws-1",
          threadId: "thread-1",
          decisions: {
            total: 1,
            actionAttempts: 1,
            actionSucceeded: 1,
            actionSuccessRate: 1,
            actionStatusCounts: {
              succeeded: 1,
              failed: 0,
              skipped: 0,
              other: 0,
            },
            actionCounts: {
              steer: 1,
              followUp: 0,
              interrupt: 0,
              none: 0,
              other: 0,
            },
            policyCounts: {
              failedValidationCommand: 1,
              missingSuccessfulVerification: 0,
              other: 0,
            },
            skipReasonCounts: {
              total: 0,
              duplicateFingerprint: 0,
              followUpCooldownActive: 0,
              interruptNoActiveTurn: 0,
              other: 0,
            },
          },
          sources: {
            interactive: {
              total: 1,
              actionAttempts: 1,
              actionSucceeded: 1,
              actionSuccessRate: 1,
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
            completedWithFileChange: 1,
            missingSuccessfulVerification: 0,
            missingSuccessfulVerificationRate: 0,
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
              p50Ms: 10,
              p95Ms: 20,
            },
            stopDecisionLatency: {
              p50Ms: 10,
              p95Ms: 20,
            },
          },
        }}
        turnPolicyMetricsLoading={false}
      />,
    );

    expect(screen.queryByText("Execution Controls")).toBeNull();
  });
});
