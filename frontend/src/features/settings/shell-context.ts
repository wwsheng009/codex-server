import { useOutletContext } from 'react-router-dom'

import type { Workspace } from '../../types/api'

export type SettingsShellContext = {
  workspaceId?: string
  workspaceName: string
  workspaces: Workspace[]
  workspacesLoading: boolean
  workspacesError: string | null
  setSelectedWorkspaceId: (workspaceId: string) => void
}

export function useSettingsShellContext() {
  return useOutletContext<SettingsShellContext>()
}
