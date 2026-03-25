import type {
  AppearanceTheme,
  ResolvedAppearanceTheme,
} from '../../features/settings/appearanceTypes'

export type AppMenuBarProps = {
  commandPaletteShortcutLabel: string
  mobileNavOpen?: boolean
  onOpenCommandPalette: () => void
  onOpenSidebar?: () => void
  showMobileNavButton?: boolean
}

export type MenuPosition = {
  top: number
  left: number
  width: number
  transformOrigin: string
}

export type ThemeModeGlyphProps = {
  theme: AppearanceTheme
  resolvedTheme: ResolvedAppearanceTheme
}

export type AppearanceMenuProps = {
  compact?: boolean
}
