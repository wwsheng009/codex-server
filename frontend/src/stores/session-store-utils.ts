export type ThreadSelectionSnapshot = {
  selectedWorkspaceId?: string
  selectedThreadId?: string
  selectedThreadIdByWorkspace?: Record<string, string>
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
