import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { getTurnPolicyMetrics } from "../../features/threads/api";
import { getWorkspaceHookConfiguration } from "../../features/workspaces/api";
import { getErrorMessage } from "../../lib/error-utils";
import type {
  TurnPolicyMetricsSummary,
  Workspace,
  WorkspaceHookConfigurationResult,
} from "../../types/api";

type UseWorkspaceTurnPolicyOverviewInput = {
  workspaces: Workspace[];
  sourceScope?: string;
};

type UseWorkspaceTurnPolicyOverviewResult = {
  selectedWorkspace?: Workspace;
  selectedWorkspaceId: string;
  setSelectedWorkspaceId: (workspaceId: string) => void;
  turnPolicyMetrics?: TurnPolicyMetricsSummary;
  turnPolicyMetricsLoading: boolean;
  turnPolicyMetricsError: string | null;
  hookConfiguration?: WorkspaceHookConfigurationResult;
  hookConfigurationLoading: boolean;
  hookConfigurationError: string | null;
  turnPolicySourceHealth?: {
    automation?: TurnPolicyMetricsSummary;
    bot?: TurnPolicyMetricsSummary;
    loading: boolean;
    error: string | null;
  };
};

export function useWorkspaceTurnPolicyOverview({
  workspaces,
  sourceScope,
}: UseWorkspaceTurnPolicyOverviewInput): UseWorkspaceTurnPolicyOverviewResult {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");

  useEffect(() => {
    if (!workspaces.length) {
      setSelectedWorkspaceId((currentWorkspaceId) =>
        currentWorkspaceId ? "" : currentWorkspaceId,
      );
      return;
    }

    setSelectedWorkspaceId((currentWorkspaceId) => {
      if (!currentWorkspaceId) {
        return workspaces[0]?.id ?? "";
      }

      const hasSelectedWorkspace = workspaces.some(
        (workspace) => workspace.id === currentWorkspaceId,
      );

      if (hasSelectedWorkspace) {
        return currentWorkspaceId;
      }

      return workspaces[0]?.id ?? "";
    });
  }, [workspaces]);

  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId),
    [selectedWorkspaceId, workspaces],
  );
  const normalizedSourceScope = sourceScope?.trim() ?? "";
  const sourceHealthEnabled =
    Boolean(selectedWorkspaceId) && !normalizedSourceScope;

  const hookConfigurationQuery = useQuery({
    queryKey: ["workspace-hook-configuration", selectedWorkspaceId],
    queryFn: () => getWorkspaceHookConfiguration(selectedWorkspaceId),
    enabled: Boolean(selectedWorkspaceId),
    staleTime: 30_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const turnPolicyMetricsQuery = useQuery({
    queryKey: [
      "turn-policy-metrics",
      selectedWorkspaceId,
      normalizedSourceScope,
      "workspace-overview",
    ],
    queryFn: () =>
      getTurnPolicyMetrics(selectedWorkspaceId, {
        source: normalizedSourceScope,
      }),
    enabled: Boolean(selectedWorkspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const automationSourceMetricsQuery = useQuery({
    queryKey: [
      "turn-policy-metrics",
      selectedWorkspaceId,
      "automation",
      "workspace-source-health",
    ],
    queryFn: () =>
      getTurnPolicyMetrics(selectedWorkspaceId, {
        source: "automation",
      }),
    enabled: sourceHealthEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const botSourceMetricsQuery = useQuery({
    queryKey: [
      "turn-policy-metrics",
      selectedWorkspaceId,
      "bot",
      "workspace-source-health",
    ],
    queryFn: () =>
      getTurnPolicyMetrics(selectedWorkspaceId, {
        source: "bot",
      }),
    enabled: sourceHealthEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const turnPolicySourceHealth = sourceHealthEnabled
    ? {
        automation: automationSourceMetricsQuery.data,
        bot: botSourceMetricsQuery.data,
        loading:
          automationSourceMetricsQuery.isLoading ||
          botSourceMetricsQuery.isLoading,
        error: automationSourceMetricsQuery.error
          ? getErrorMessage(automationSourceMetricsQuery.error)
          : botSourceMetricsQuery.error
            ? getErrorMessage(botSourceMetricsQuery.error)
            : null,
      }
    : undefined;

  return {
    selectedWorkspace,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    turnPolicyMetrics: turnPolicyMetricsQuery.data,
    turnPolicyMetricsLoading: turnPolicyMetricsQuery.isLoading,
    turnPolicyMetricsError: turnPolicyMetricsQuery.error
      ? getErrorMessage(turnPolicyMetricsQuery.error)
      : null,
    hookConfiguration: hookConfigurationQuery.data,
    hookConfigurationLoading: hookConfigurationQuery.isLoading,
    hookConfigurationError: hookConfigurationQuery.error
      ? getErrorMessage(hookConfigurationQuery.error)
      : null,
    turnPolicySourceHealth,
  };
}
