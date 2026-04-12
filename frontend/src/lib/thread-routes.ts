export function buildWorkspaceRoute(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}`;
}

export function buildWorkspaceTurnPolicyRoute(
  workspaceId: string,
  input: {
    turnPolicyThreadId?: string;
    metricsSource?: string;
    policyName?: string;
    action?: string;
    actionStatus?: string;
    source?: string;
    reason?: string;
  } = {},
) {
  const workspaceRoute = "/workspaces";
  const query = new URLSearchParams();

  if (workspaceId) {
    query.set("selectedWorkspaceId", workspaceId);
  }

  if (input.turnPolicyThreadId) {
    query.set("turnPolicyThreadId", input.turnPolicyThreadId);
  }
  if (input.metricsSource) {
    query.set("metricsSource", input.metricsSource);
  }
  if (input.policyName) {
    query.set("policyName", input.policyName);
  }
  if (input.action) {
    query.set("action", input.action);
  }
  if (input.actionStatus) {
    query.set("actionStatus", input.actionStatus);
  }
  if (input.source) {
    query.set("source", input.source);
  }
  if (input.reason) {
    query.set("reason", input.reason);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return `${workspaceRoute}${suffix}`;
}

export function buildWorkspaceHookRunsRoute(
  workspaceId: string,
  input: {
    hookRunId?: string;
    hookRunsThreadId?: string;
    hookEventName?: string;
    hookStatus?: string;
    hookHandlerKey?: string;
  } = {},
) {
  const workspaceRoute = "/workspaces";
  const query = new URLSearchParams();

  if (workspaceId) {
    query.set("selectedWorkspaceId", workspaceId);
  }
  if (input.hookRunId) {
    query.set("hookRunId", input.hookRunId);
  }
  if (input.hookRunsThreadId) {
    query.set("hookRunsThreadId", input.hookRunsThreadId);
  }
  if (input.hookEventName) {
    query.set("hookEventName", input.hookEventName);
  }
  if (input.hookStatus) {
    query.set("hookStatus", input.hookStatus);
  }
  if (input.hookHandlerKey) {
    query.set("hookHandlerKey", input.hookHandlerKey);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return `${workspaceRoute}${suffix}`;
}

export function buildWorkspaceTurnPolicySourceOverviewRoute(
  workspaceId: string,
  source: "automation" | "bot",
  input: {
    turnPolicyThreadId?: string;
    metricsSource?: string;
    policyName?: string;
    action?: string;
    actionStatus?: string;
    source?: string;
    reason?: string;
  } = {},
) {
  const sourceRoute = `/workspaces/turn-policy/${encodeURIComponent(source)}`;
  const query = new URLSearchParams();

  if (workspaceId) {
    query.set("selectedWorkspaceId", workspaceId);
  }

  if (input.turnPolicyThreadId) {
    query.set("turnPolicyThreadId", input.turnPolicyThreadId);
  }
  query.set("metricsSource", input.metricsSource || source);
  query.set("source", input.source || source);
  if (input.policyName) {
    query.set("policyName", input.policyName);
  }
  if (input.action) {
    query.set("action", input.action);
  }
  if (input.actionStatus) {
    query.set("actionStatus", input.actionStatus);
  }
  if (input.reason) {
    query.set("reason", input.reason);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return `${sourceRoute}${suffix}`;
}

export function buildWorkspaceTurnPolicyCompareRoute(
  workspaceId: string,
  input: {
    turnPolicyThreadId?: string;
  } = {},
) {
  const compareRoute = "/workspaces/turn-policy/compare";
  const query = new URLSearchParams();

  if (workspaceId) {
    query.set("selectedWorkspaceId", workspaceId);
  }
  if (input.turnPolicyThreadId) {
    query.set("turnPolicyThreadId", input.turnPolicyThreadId);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return `${compareRoute}${suffix}`;
}

export function buildWorkspaceTurnPolicyHistoryRoute(
  workspaceId: string,
  input: {
    turnPolicyThreadId?: string;
    metricsSource?: string;
    historyRange?: "7d" | "30d" | "90d";
    historyGranularity?: "day" | "week";
  } = {},
) {
  const historyRoute = "/workspaces/turn-policy/history";
  const query = new URLSearchParams();

  if (workspaceId) {
    query.set("selectedWorkspaceId", workspaceId);
  }
  if (input.turnPolicyThreadId) {
    query.set("turnPolicyThreadId", input.turnPolicyThreadId);
  }
  if (input.metricsSource) {
    query.set("metricsSource", input.metricsSource);
  }
  if (input.historyRange) {
    query.set("historyRange", input.historyRange);
  }
  if (input.historyGranularity) {
    query.set("historyGranularity", input.historyGranularity);
  }

  const suffix = query.size ? `?${query.toString()}` : "";
  return `${historyRoute}${suffix}`;
}

export function buildWorkspaceThreadRoute(
  workspaceId: string,
  threadId?: string,
) {
  const workspaceRoute = buildWorkspaceRoute(workspaceId);
  if (!threadId) {
    return workspaceRoute;
  }

  return `${workspaceRoute}/threads/${encodeURIComponent(threadId)}`;
}

export function parseWorkspaceThreadRoute(pathname: string): {
  workspaceId?: string;
  threadId?: string;
} {
  const match = pathname.match(
    /^\/workspaces\/([^/]+)(?:\/threads\/([^/]+))?\/?$/,
  );
  if (!match) {
    return {};
  }

  return {
    workspaceId: decodeURIComponent(match[1]),
    threadId: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}
