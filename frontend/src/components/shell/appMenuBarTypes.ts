import type { AppearanceTheme } from '../../features/settings/appearance'

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

export type ResolvedAppearanceTheme = 'light' | 'dark'

export type ThemeModeGlyphProps = {
  theme: AppearanceTheme
  resolvedTheme: ResolvedAppearanceTheme
}

export type AppearanceMenuProps = {
  compact?: boolean
}
