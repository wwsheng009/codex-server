import type { ThreadTerminalWorkspaceInput } from './threadTerminalDockTypes'
import { ThreadTerminalDockWorkspace } from './ThreadTerminalDockWorkspace'
import { useThreadTerminalWorkspaceState } from './useThreadTerminalWorkspaceState'

export function ThreadTerminalDockWorkspaceContainer(
  props: ThreadTerminalWorkspaceInput,
) {
  const workspace = useThreadTerminalWorkspaceState(props)

  return <ThreadTerminalDockWorkspace {...workspace} />
}
