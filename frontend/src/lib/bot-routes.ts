export function buildBotConnectionDetailRoute(workspaceId: string, connectionId: string) {
  return `/bots/${encodeURIComponent(workspaceId)}/${encodeURIComponent(connectionId)}`
}

export function buildBotConnectionLogsRoute(workspaceId: string, connectionId: string) {
  return `/bots/${encodeURIComponent(workspaceId)}/${encodeURIComponent(connectionId)}/logs`
}

export function buildBotEndpointsRoute(workspaceId: string, botId: string, connectionId?: string) {
  const params = new URLSearchParams()
  if (workspaceId.trim()) {
    params.set('workspaceId', workspaceId.trim())
  }
  if (botId.trim()) {
    params.set('botId', botId.trim())
  }
  if (connectionId?.trim()) {
    params.set('connectionId', connectionId.trim())
  }
  const query = params.toString()
  return query ? `/bots/endpoints?${query}` : '/bots/endpoints'
}
