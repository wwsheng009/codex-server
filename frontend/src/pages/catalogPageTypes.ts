export type CatalogSectionItem = {
  id: string
  name: string
  description: string
  value?: string
  shellType?: string
}

export type CatalogQueryData = {
  models: CatalogSectionItem[]
  skills: CatalogSectionItem[]
  remoteSkills: CatalogSectionItem[]
  apps: CatalogSectionItem[]
  plugins: CatalogSectionItem[]
  modes: CatalogSectionItem[]
}

export type RuntimeSectionProps = {
  title: string
  description: string
  items: CatalogSectionItem[]
  loading: boolean
  marker: string
}
