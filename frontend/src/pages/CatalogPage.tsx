import { useQuery } from '@tanstack/react-query'

import {
  listApps,
  listCollaborationModes,
  listModels,
  listPlugins,
  listSkills,
} from '../features/catalog/api'
import { listWorkspaces } from '../features/workspaces/api'

export function CatalogPage() {
  const workspacesQuery = useQuery({
    queryKey: ['workspaces'],
    queryFn: listWorkspaces,
  })

  const workspaceId = workspacesQuery.data?.[0]?.id

  const catalogQuery = useQuery({
    queryKey: ['catalog', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: async () => {
      const [models, skills, apps, plugins, modes] = await Promise.all([
        listModels(workspaceId!),
        listSkills(workspaceId!),
        listApps(workspaceId!),
        listPlugins(workspaceId!),
        listCollaborationModes(workspaceId!),
      ])

      return { models, skills, apps, plugins, modes }
    },
  })

  return (
    <section className="page">
      <header className="page__header">
        <div>
          <p className="eyebrow">Runtime Catalog</p>
          <h1>Catalog</h1>
          <p className="page__description">展示模型、技能、应用、插件和协作模式目录。</p>
        </div>
      </header>

      {!workspaceId ? <div className="empty-state">Create a workspace first to load catalog data.</div> : null}

      <div className="catalog-grid">
        <CatalogSection items={catalogQuery.data?.models} title="Models" />
        <CatalogSection items={catalogQuery.data?.skills} title="Skills" />
        <CatalogSection items={catalogQuery.data?.apps} title="Apps" />
        <CatalogSection items={catalogQuery.data?.plugins} title="Plugins" />
        <CatalogSection items={catalogQuery.data?.modes} title="Modes" />
      </div>
    </section>
  )
}

type CatalogSectionProps = {
  title: string
  items?: Array<{ id: string; name: string; description: string }>
}

function CatalogSection({ title, items }: CatalogSectionProps) {
  return (
    <div className="card">
      <div className="card__header">
        <h2>{title}</h2>
        <span>{items?.length ?? 0}</span>
      </div>

      <div className="stack">
        {items?.map((item) => (
          <article className="catalog-item" key={item.id}>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
          </article>
        ))}
      </div>
    </div>
  )
}
