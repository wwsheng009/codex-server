export type CommandPaletteItem = {
  id: string
  title: string
  subtitle?: string
  group: 'Action' | 'Nav' | 'Recent'
  keywords?: string[]
  shortcut?: string
  priority?: number
  onSelect: () => void
}

export type CommandPaletteProps = {
  isOpen: boolean
  items: CommandPaletteItem[]
  onClose: () => void
  shortcutLabel: string
}

export type RankedItem = CommandPaletteItem & {
  score: number
}
