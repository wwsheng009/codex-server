import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { StatusPill } from '../components/ui/StatusPill'
import { CreateWorkspaceDialog } from '../components/workspace/CreateWorkspaceDialog'
import { formatRelativeTimeShort } from '../components/workspace/timeline-utils'
import { getErrorMessage } from '../lib/error-utils'
import { createWorkspace, deleteWorkspace, listWorkspaces, restartWorkspace } from '../features/workspaces/api'
import { useSessionStore } from '../stores/session-store'
import { useUIStore } from '../stores/ui-store'
import type { Workspace } from '../types/api'

export function WorkspacesPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('')
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)
  const [confirmingWorkspaceDelete, setConfirmingWorkspaceDelete] = useState<Workspace | null>(null)
  const removeWorkspaceFromSession = useSessionStore((state) => state.removeWorkspace)
  const workspaceRestartStateById = useUIStore((state) => state.workspaceRestartStateById)
  const markWorkspaceRestarting = useUIStore((state) => state.markWorkspaceRestarting)
  const markWorkspaceRestarted = useUIStore((state) => state.markWorkspaceRestarted)
  const clearWorkspaceRestartState = useUIStore((state) => state.clearWorkspaceRestartState)

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })
  const workspaces = useMemo(
    () =>
      [...(workspacesQuery.data ?? [])].sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      ),
    [workspacesQuery.data],
  )
  const healthyWorkspaces = workspaces.filter((workspace) =>
    ['ready', 'active', 'connected'].includes(workspace.runtimeStatus),
  ).length
  const distinctRoots = new Set(workspaces.map((workspace) => workspace.rootPath)).size

  const createWorkspaceMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: async () => {
      setName('')
      setRootPath('')
      setIsCreatingWorkspace(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads'] }),
      ])
    },
  })
  const deleteWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => deleteWorkspace(workspaceId),
    onSuccess: async (_, workspaceId) => {
      removeWorkspaceFromSession(workspaceId)
      setConfirmingWorkspaceDelete(null)
      deleteWorkspaceMutation.reset()
      queryClient.removeQueries({ queryKey: ['workspace', workspaceId] })
      queryClient.removeQueries({ queryKey: ['threads', workspaceId] })
      queryClient.removeQueries({ queryKey: ['thread-detail', workspaceId] })
      queryClient.removeQueries({ queryKey: ['approvals', workspaceId] })
      queryClient.removeQueries({ queryKey: ['models', workspaceId] })
      queryClient.removeQueries({ queryKey: ['shell-threads', workspaceId] })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads'] }),
      ])
    },
  })
  const restartWorkspaceMutation = useMutation({
    mutationFn: (workspaceId: string) => restartWorkspace(workspaceId),
    onMutate: (workspaceId) => {
      markWorkspaceRestarting(workspaceId)
    },
    onSuccess: (workspace) => {
      markWorkspaceRestarted(workspace.id)
    },
    onError: (_, workspaceId) => {
      clearWorkspaceRestartState(workspaceId)
    },
    onSettled: async (_, __, workspaceId) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['shell-threads', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['thread-detail', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['approvals', workspaceId] }),
      ])
    },
  })

  function handleCreateWorkspace() {
    if (!name.trim() || !rootPath.trim()) {
      return
    }

    createWorkspaceMutation.mutate({
      name: name.trim(),
      rootPath: rootPath.trim(),
    })
  }

  function handleDeleteWorkspace(workspace: Workspace) {
    if (deleteWorkspaceMutation.isPending || restartWorkspaceMutation.isPending) {
      return
    }

    deleteWorkspaceMutation.reset()
    setConfirmingWorkspaceDelete(workspace)
  }

  function handleCloseDeleteWorkspaceDialog() {
    if (deleteWorkspaceMutation.isPending) {
      return
    }

    setConfirmingWorkspaceDelete(null)
    deleteWorkspaceMutation.reset()
  }

  function handleConfirmDeleteWorkspaceDialog() {
    if (!confirmingWorkspaceDelete || deleteWorkspaceMutation.isPending) {
      return
    }

    deleteWorkspaceMutation.mutate(confirmingWorkspaceDelete.id)
  }

  return (
    <section className="screen">
      <header className="mode-strip">
        <div className="mode-strip__copy">
          <div className="mode-strip__eyebrow">Workspace</div>
          <div className="mode-strip__title-row">
            <strong>Workbench</strong>
          </div>
          <div className="mode-strip__description">
            Register runtime roots, inspect workspace health, and manage your local development environments.
          </div>
        </div>
        <div className="mode-strip__actions">
          <div className="mode-metrics">
            <div className="mode-metric">
              <span>Total</span>
              <strong>{workspaces.length}</strong>
            </div>
            <div className="mode-metric">
              <span>Healthy</span>
              <strong>{healthyWorkspaces}</strong>
            </div>
            <div className="mode-metric">
              <span>Roots</span>
              <strong>{distinctRoots}</strong>
            </div>
            <div className="mode-metric">
              <span>Activity</span>
              <strong>{workspaces[0]?.updatedAt ? formatRelativeTimeShort(workspaces[0].updatedAt) : '—'}</strong>
            </div>
          </div>
          <Button onClick={() => setIsCreatingWorkspace(true)}>
            New Workspace
          </Button>
        </div>
      </header>

      <div className="stack-screen">
        <section className="content-section">
          <div className="section-header">
            <div>
              <h2>Workspace Registry</h2>
            </div>
            <div className="section-header__meta">{workspaces.length}</div>
          </div>

          {workspacesQuery.isLoading ? <div className="notice">Loading registry…</div> : null}
          
          <div className="workspace-compact-list">
            {workspaces.map((workspace) => {
              const restartPhase = workspaceRestartStateById[workspace.id]
              const visualStatus = restartPhase === 'restarting' ? 'restarting' : workspace.runtimeStatus

              return (
                <div className="workspace-compact-row" key={workspace.id}>
                  <Link className="workspace-compact-row__main" to={`/workspaces/${workspace.id}`}>
                    <div className="workspace-compact-row__title">
                      <strong>{workspace.name}</strong>
                      <span className="meta-label">ID: {workspace.id.slice(0, 8)}</span>
                    </div>
                    <p>{workspace.rootPath}</p>
                  </Link>
                  <div className="workspace-compact-row__actions">
                    <StatusPill status={visualStatus} />
                    <div className="divider-v" />
                    <Button
                      intent="ghost"
                      isLoading={restartPhase === 'restarting'}
                      onClick={() => restartWorkspaceMutation.mutate(workspace.id)}
                    >
                      Restart
                    </Button>
                    <Button
                      intent="ghost"
                      className="ide-button--ghost-danger"
                      onClick={() => handleDeleteWorkspace(workspace)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {isCreatingWorkspace && (
        <CreateWorkspaceDialog
          error={createWorkspaceMutation.error ? getErrorMessage(createWorkspaceMutation.error) : null}
          isPending={createWorkspaceMutation.isPending}
          name={name}
          onClose={() => {
            setIsCreatingWorkspace(false)
            createWorkspaceMutation.reset()
          }}
          onNameChange={setName}
          onRootPathChange={setRootPath}
          onSubmit={handleCreateWorkspace}
          rootPath={rootPath}
        />
      )}

      {confirmingWorkspaceDelete ? (
        <ConfirmDialog
          confirmLabel="Remove Workspace"
          description="This removes the workspace from the registry and clears its loaded thread list from the UI."
          error={deleteWorkspaceMutation.error ? getErrorMessage(deleteWorkspaceMutation.error) : null}
          isPending={deleteWorkspaceMutation.isPending}
          onClose={handleCloseDeleteWorkspaceDialog}
          onConfirm={handleConfirmDeleteWorkspaceDialog}
          subject={confirmingWorkspaceDelete.name}
          title="Remove Workspace?"
        />
      ) : null}
    </section>
  )
}
