import { useQuery } from "@tanstack/react-query";

import { getTurnPolicyMetrics } from "../../features/threads/api";
import { getErrorMessage } from "../../lib/error-utils";
import type { TurnPolicyMetricsSummary } from "../../types/api";

type TurnPolicySourceComparisonInput = {
  selectedWorkspaceId: string;
  threadId?: string;
};

type TurnPolicySourceComparisonResult = {
  interactiveMetrics?: TurnPolicyMetricsSummary;
  automationMetrics?: TurnPolicyMetricsSummary;
  botMetrics?: TurnPolicyMetricsSummary;
  sourceComparisonLoading: boolean;
  sourceComparisonError: string | null;
};

export function useWorkspaceTurnPolicySourceComparison({
  selectedWorkspaceId,
  threadId,
}: TurnPolicySourceComparisonInput): TurnPolicySourceComparisonResult {
  const normalizedThreadId = threadId?.trim() ?? "";
  const queryEnabled = Boolean(selectedWorkspaceId);

  const interactiveMetricsQuery = useQuery({
    queryKey: [
      "turn-policy-metrics",
      selectedWorkspaceId,
      normalizedThreadId,
      "interactive",
      "source-comparison",
    ],
    queryFn: () =>
      getTurnPolicyMetrics(selectedWorkspaceId, {
        threadId: normalizedThreadId,
        source: "interactive",
      }),
    enabled: queryEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const automationMetricsQuery = useQuery({
    queryKey: [
      "turn-policy-metrics",
      selectedWorkspaceId,
      normalizedThreadId,
      "automation",
      "source-comparison",
    ],
    queryFn: () =>
      getTurnPolicyMetrics(selectedWorkspaceId, {
        threadId: normalizedThreadId,
        source: "automation",
      }),
    enabled: queryEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const botMetricsQuery = useQuery({
    queryKey: [
      "turn-policy-metrics",
      selectedWorkspaceId,
      normalizedThreadId,
      "bot",
      "source-comparison",
    ],
    queryFn: () =>
      getTurnPolicyMetrics(selectedWorkspaceId, {
        threadId: normalizedThreadId,
        source: "bot",
      }),
    enabled: queryEnabled,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  return {
    interactiveMetrics: interactiveMetricsQuery.data,
    automationMetrics: automationMetricsQuery.data,
    botMetrics: botMetricsQuery.data,
    sourceComparisonLoading:
      interactiveMetricsQuery.isLoading ||
      automationMetricsQuery.isLoading ||
      botMetricsQuery.isLoading,
    sourceComparisonError: interactiveMetricsQuery.error
      ? getErrorMessage(interactiveMetricsQuery.error)
      : automationMetricsQuery.error
        ? getErrorMessage(automationMetricsQuery.error)
        : botMetricsQuery.error
          ? getErrorMessage(botMetricsQuery.error)
          : null,
  };
}
