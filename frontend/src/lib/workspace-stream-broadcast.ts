export const workspaceStreamLeaderHeartbeatIntervalMs = 1_000
export const workspaceStreamLeaderStaleAfterMs = 3_500
const workspaceStreamChannelPrefix = 'codex-server:workspace-stream:'

export type WorkspaceStreamConnectionState =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error'

export type WorkspaceStreamBroadcastMessage =
  | {
      type: 'presence'
      workspaceId: string
      instanceId: string
      ts: number
    }
  | {
      type: 'heartbeat'
      workspaceId: string
      instanceId: string
      ts: number
      connectionState: WorkspaceStreamConnectionState
    }
  | {
      type: 'release'
      workspaceId: string
      instanceId: string
      ts: number
    }
  | {
      type: 'event'
      workspaceId: string
      instanceId: string
      event: unknown
    }

let workspaceStreamInstanceId: string | undefined

export function isWorkspaceStreamBroadcastSupported() {
  return typeof window !== 'undefined' && typeof window.BroadcastChannel !== 'undefined'
}

export function createWorkspaceStreamBroadcastChannel(workspaceId: string) {
  if (!isWorkspaceStreamBroadcastSupported()) {
    return null
  }

  return new window.BroadcastChannel(getWorkspaceStreamBroadcastChannelName(workspaceId))
}

export function getWorkspaceStreamBroadcastChannelName(workspaceId: string) {
  return `${workspaceStreamChannelPrefix}${workspaceId}`
}

export function getWorkspaceStreamInstanceId() {
  if (workspaceStreamInstanceId) {
    return workspaceStreamInstanceId
  }

  workspaceStreamInstanceId = `tab-${Math.random().toString(36).slice(2, 10)}`
  return workspaceStreamInstanceId
}

export function selectWorkspaceStreamLeaderCandidate(
  selfInstanceId: string,
  peerSeenAt: Record<string, number>,
  now: number,
  staleAfterMs: number = workspaceStreamLeaderStaleAfterMs,
) {
  const activeInstanceIds = [selfInstanceId]

  for (const [instanceId, seenAt] of Object.entries(peerSeenAt)) {
    if (now-seenAt > staleAfterMs) {
      continue
    }

    activeInstanceIds.push(instanceId)
  }

  activeInstanceIds.sort()
  return activeInstanceIds[0] ?? selfInstanceId
}

export function shouldYieldWorkspaceStreamLeadership(
  currentInstanceId: string,
  incomingInstanceId: string,
) {
  if (!incomingInstanceId || incomingInstanceId === currentInstanceId) {
    return false
  }

  return incomingInstanceId < currentInstanceId
}
