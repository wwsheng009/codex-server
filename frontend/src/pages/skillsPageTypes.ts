export type SkillCardItem = {
  id: string
  name: string
  description: string
}

export type DirectorySectionProps = {
  title: string
  description: string
  items: SkillCardItem[]
  loading: boolean
  marker: string
  sourceLabel: string
  emptyMessage: string
  errorMessage?: string | null
  onRetry?: () => void
  titleError: string
}
