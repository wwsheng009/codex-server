import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'

import { StatusBadge } from '../components/ui/StatusBadge'
import { createWorkspace, listWorkspaces } from '../features/workspaces/api'

export function WorkspacesPage() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [rootPath, setRootPath] = useState('E:/projects')

  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  const createWorkspaceMutation = useMutation({
    mutationFn: createWorkspace,
    onSuccess: () => {
      setName('')
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] })
    },
  })

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    createWorkspaceMutation.mutate({ name, rootPath })
  }

  return (
    <section className="page">
      <header className="page__header">
        <div>
          <p className="eyebrow">Workspace Runtime</p>
          <h1>Workspaces</h1>
          <p className="page__description">创建工作区、查看 runtime 状态，并进入多会话界面。</p>
        </div>
      </header>

      <div className="workspace-grid">
        <div className="card">
          <h2>New Workspace</h2>
          <form className="stack" onSubmit={handleSubmit}>
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Demo Workspace" />
            </label>
            <label className="field">
              <span>Root Path</span>
              <input
                value={rootPath}
                onChange={(event) => setRootPath(event.target.value)}
                placeholder="E:/projects"
              />
            </label>
            <button className="button" disabled={createWorkspaceMutation.isPending} type="submit">
              {createWorkspaceMutation.isPending ? 'Creating...' : 'Create Workspace'}
            </button>
            {createWorkspaceMutation.error ? (
              <p className="error-text">{createWorkspaceMutation.error.message}</p>
            ) : null}
          </form>
        </div>

        <div className="card">
          <div className="card__header">
            <h2>Available Workspaces</h2>
            <span>{workspacesQuery.data?.length ?? 0} total</span>
          </div>

          <div className="workspace-list">
            {workspacesQuery.isLoading ? <p>Loading workspaces...</p> : null}
            {workspacesQuery.error ? <p className="error-text">{workspacesQuery.error.message}</p> : null}
            {workspacesQuery.data?.map((workspace) => (
              <Link className="workspace-item" key={workspace.id} to={`/workspaces/${workspace.id}`}>
                <div>
                  <h3>{workspace.name}</h3>
                  <p>{workspace.rootPath}</p>
                </div>
                <StatusBadge status={workspace.runtimeStatus} />
              </Link>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
