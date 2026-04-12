import { useQuery } from "@tanstack/react-query";

import { listHookRuns } from "../../features/threads/api";
import { getErrorMessage } from "../../lib/error-utils";
import type { HookRun } from "../../types/api";

export type WorkspaceHookRunFilters = {
  threadId?: string;
  eventName?: string;
  status?: string;
  handlerKey?: string;
  hookRunId?: string;
};

type UseWorkspaceHookRunsInput = {
  selectedWorkspaceId: string;
  filters?: WorkspaceHookRunFilters;
  limit?: number;
};

type UseWorkspaceHookRunsResult = {
  hookRuns: HookRun[];
  hasAnyHookRuns: boolean;
  hookRunsLoading: boolean;
  hookRunsError: string | null;
};

function normalizeFilters(
  filters: WorkspaceHookRunFilters = {},
): WorkspaceHookRunFilters {
  return {
    threadId: filters.threadId?.trim() ?? "",
    eventName: filters.eventName?.trim() ?? "",
    status: filters.status?.trim() ?? "",
    handlerKey: filters.handlerKey?.trim() ?? "",
    hookRunId: filters.hookRunId?.trim() ?? "",
  };
}

function hasActiveFilters(filters: WorkspaceHookRunFilters) {
  return Boolean(
    filters.threadId ||
      filters.eventName ||
      filters.status ||
      filters.handlerKey ||
      filters.hookRunId,
  );
}

export function useWorkspaceHookRuns({
  selectedWorkspaceId,
  filters,
  limit = 10,
}: UseWorkspaceHookRunsInput): UseWorkspaceHookRunsResult {
  const normalizedFilters = normalizeFilters(filters);
  const filteredView = hasActiveFilters(normalizedFilters);

  const hookRunsQuery = useQuery({
    queryKey: [
      "hook-runs",
      selectedWorkspaceId,
      "workspace-recent",
      normalizedFilters.threadId,
      normalizedFilters.eventName,
      normalizedFilters.status,
      normalizedFilters.handlerKey,
      normalizedFilters.hookRunId,
      limit,
    ],
    queryFn: () => {
      const request = {
        threadId: normalizedFilters.threadId,
        eventName: normalizedFilters.eventName,
        status: normalizedFilters.status,
        handlerKey: normalizedFilters.handlerKey,
        limit,
      } as Parameters<typeof listHookRuns>[1] & {
        runId?: string;
      };
      if (normalizedFilters.hookRunId) {
        request.runId = normalizedFilters.hookRunId;
      }
      return listHookRuns(selectedWorkspaceId, request);
    },
    enabled: Boolean(selectedWorkspaceId),
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  const workspaceHookRunExistenceQuery = useQuery({
    queryKey: ["hook-runs", selectedWorkspaceId, "workspace-any"],
    queryFn: () =>
      listHookRuns(selectedWorkspaceId, {
        limit: 1,
      }),
    enabled: Boolean(selectedWorkspaceId) && filteredView,
    staleTime: 15_000,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

  return {
    hookRuns: hookRunsQuery.data ?? [],
    hasAnyHookRuns: filteredView
      ? (workspaceHookRunExistenceQuery.data?.length ?? 0) > 0
      : (hookRunsQuery.data?.length ?? 0) > 0,
    hookRunsLoading: hookRunsQuery.isLoading,
    hookRunsError: hookRunsQuery.error
      ? getErrorMessage(hookRunsQuery.error)
      : null,
  };
}
