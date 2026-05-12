import { parseWorkspaceThreadRoute } from '../lib/thread-routes'

export type ThreadSelectionSnapshot = {
  selectedWorkspaceId?: string
  selectedThreadId?: string
  selectedThreadIdByWorkspace?: Record<string, string>
}

const SESSION_STORE_STORAGE_KEY = 'codex-server-session-store'
const THREAD_STORE_KEY_SEPARATOR = '\u001f'

export function buildThreadStoreKey(workspaceId: string, threadId: string) {
  return `${workspaceId}${THREAD_STORE_KEY_SEPARATOR}${threadId}`
}

export function isCompositeThreadStoreKey(key: string) {
  return key.includes(THREAD_STORE_KEY_SEPARATOR)
}

export function isThreadStoreKeyForWorkspace(key: string, workspaceId: string) {
  return key.startsWith(`${workspaceId}${THREAD_STORE_KEY_SEPARATOR}`)
}

export function getSelectedThreadIdForWorkspace(
  state: ThreadSelectionSnapshot,
  workspaceId?: string,
) {
  if (!workspaceId) {
    return undefined
  }

  return (
    state.selectedThreadIdByWorkspace?.[workspaceId] ??
    (state.selectedWorkspaceId === workspaceId ? state.selectedThreadId : undefined)
  )
}

export function readPersistedThreadSelectionSnapshot(): ThreadSelectionSnapshot {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(SESSION_STORE_STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as {
      state?: ThreadSelectionSnapshot
    }

    return parsed.state ?? {}
  } catch {
    return {}
  }
}

export function resolveMissingWorkspaceReferences(input: {
  pathname: string
  selectedWorkspaceId?: string
  workspaceIds: string[]
}) {
  const workspaceIdSet = new Set(
    input.workspaceIds
      .map((workspaceId) => workspaceId.trim())
      .filter((workspaceId) => workspaceId.length > 0),
  )
  const route = parseWorkspaceThreadRoute(input.pathname)

  const missingSelectedWorkspaceId =
    input.selectedWorkspaceId && !workspaceIdSet.has(input.selectedWorkspaceId)
      ? input.selectedWorkspaceId
      : undefined
  const missingRouteWorkspaceId =
    route.workspaceId && !workspaceIdSet.has(route.workspaceId)
      ? route.workspaceId
      : undefined

  return {
    missingRouteWorkspaceId,
    missingSelectedWorkspaceId,
    shouldRedirectToWorkspaceList: Boolean(missingRouteWorkspaceId),
  }
}
