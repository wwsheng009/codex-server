export function buildWorkspaceRoute(workspaceId: string) {
  return `/workspaces/${encodeURIComponent(workspaceId)}`
}

export function buildWorkspaceThreadRoute(workspaceId: string, threadId?: string) {
  const workspaceRoute = buildWorkspaceRoute(workspaceId)
  if (!threadId) {
    return workspaceRoute
  }

  return `${workspaceRoute}/threads/${encodeURIComponent(threadId)}`
}

export function parseWorkspaceThreadRoute(pathname: string): {
  workspaceId?: string
  threadId?: string
} {
  const match = pathname.match(/^\/workspaces\/([^/]+)(?:\/threads\/([^/]+))?\/?$/)
  if (!match) {
    return {}
  }

  return {
    workspaceId: decodeURIComponent(match[1]),
    threadId: match[2] ? decodeURIComponent(match[2]) : undefined,
  }
}
