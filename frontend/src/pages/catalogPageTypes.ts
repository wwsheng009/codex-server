export type CatalogSectionItem = {
  id: string
  name: string
  description: string
  value?: string
  shellType?: string
  marketplaceName?: string
  marketplacePath?: string
  installed?: boolean
  enabled?: boolean
  authPolicy?: string
  installPolicy?: string
  sourceType?: string
  sourcePath?: string
  capabilities?: string[] | null
  category?: string | null
  brandColor?: string | null
}

export type CatalogQueryData = {
  models: CatalogSectionItem[]
  skills: CatalogSectionItem[]
  apps: CatalogSectionItem[]
  plugins: CatalogSectionItem[]
  pluginRemoteSyncError?: string | null
  modes: CatalogSectionItem[]
}

export type RuntimeSectionProps = {
  title: string
  description: string
  items: CatalogSectionItem[]
  loading: boolean
  marker: string
  onInstallPlugin?: (item: CatalogSectionItem) => void
  onReadPlugin?: (item: CatalogSectionItem) => void
  onUninstallPlugin?: (item: CatalogSectionItem) => void
  pluginInstallPendingId?: string | null
  pluginReadPendingId?: string | null
  pluginUninstallPendingId?: string | null
}
