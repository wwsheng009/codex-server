import type { RefObject } from 'react'

import type { Thread } from '../../types/api'

export type WorkspaceTreeThreadRowProps = {
  activeThreadId?: string
  deleteInProgress: boolean
  isMenuOpen: boolean
  isRenameOrDeletePending: boolean
  isSelectedWorkspaceRoute: boolean
  menuRef?: RefObject<HTMLDivElement | null>
  onDeleteThread: () => void
  onOpenThread: () => void
  onRenameThread: () => void
  onToggleMenu: () => void
  thread: Thread
}
