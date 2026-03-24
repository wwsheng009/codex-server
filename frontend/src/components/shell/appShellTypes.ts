import type { Thread, Workspace } from '../../types/api'

export type SidebarMenuState =
  | {
      kind: 'workspace'
      workspaceId: string
    }
  | {
      kind: 'thread'
      workspaceId: string
      threadId: string
    }
  | null

export type RenameTarget =
  | {
      kind: 'workspace'
      workspace: Workspace
    }
  | {
      kind: 'thread'
      workspaceId: string
      thread: Thread
    }
  | null

export type DeleteTarget =
  | {
      kind: 'workspace'
      workspace: Workspace
    }
  | {
      kind: 'thread'
      workspaceId: string
      thread: Thread
    }
  | null

export type RenameWorkspaceMutationInput = {
  workspaceId: string
  name: string
}

export type CreateThreadMutationInput = {
  workspaceId: string
}

export type RenameThreadMutationInput = {
  workspaceId: string
  threadId: string
  name: string
}

export type DeleteThreadMutationInput = {
  workspaceId: string
  threadId: string
}
