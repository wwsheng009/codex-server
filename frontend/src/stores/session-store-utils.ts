export type ThreadSelectionSnapshot = {
  selectedWorkspaceId?: string
  selectedThreadId?: string
  selectedThreadIdByWorkspace?: Record<string, string>
}

const SESSION_STORE_STORAGE_KEY = 'codex-server-session-store'

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
