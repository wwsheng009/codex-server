import { useEffect } from 'react'

import {
  getAppearanceColorDefaults,
  getThemeColorCustomization,
  normalizeAccentTone,
  resolveAppearanceTheme,
  resolveMotionPreference,
} from '../features/settings/appearance'
import { useSettingsLocalStore } from '../features/settings/local-store'
import { useSystemAppearancePreferences } from '../features/settings/useSystemAppearancePreferences'

function normalizeColorValue(value: string) {
  return value.trim().toLowerCase()
}

function buildSidebarBackground(
  background: string,
  resolvedTheme: 'light' | 'dark',
  translucentSidebar: boolean,
) {
  if (translucentSidebar) {
    return `linear-gradient(180deg, color-mix(in srgb, ${background} 78%, transparent) 0%, color-mix(in srgb, ${background} 94%, transparent) 100%)`
  }

  if (resolvedTheme === 'dark') {
    return `linear-gradient(180deg, color-mix(in srgb, ${background}, white 4%) 0%, color-mix(in srgb, ${background}, black 8%) 100%)`
  }

  return `linear-gradient(180deg, color-mix(in srgb, ${background}, black 5%) 0%, ${background} 100%)`
}

export function AppearanceController() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const density = useSettingsLocalStore((state) => state.density)
  const motionPreference = useSettingsLocalStore((state) => state.motionPreference)
  const threadSpacing = useSettingsLocalStore((state) => state.threadSpacing)
  const messageSurface = useSettingsLocalStore((state) => state.messageSurface)
  const userMessageEmphasis = useSettingsLocalStore((state) => state.userMessageEmphasis)

  const themeColorCustomizations = useSettingsLocalStore((state) => state.themeColorCustomizations)
  const uiFont = useSettingsLocalStore((state) => state.uiFont)
  const codeFont = useSettingsLocalStore((state) => state.codeFont)
  const uiFontSize = useSettingsLocalStore((state) => state.uiFontSize)
  const codeFontSize = useSettingsLocalStore((state) => state.codeFontSize)
  const translucentSidebar = useSettingsLocalStore((state) => state.translucentSidebar)
  const contrast = useSettingsLocalStore((state) => state.contrast)
  const usePointerCursor = useSettingsLocalStore((state) => state.usePointerCursor)
  const useCustomColors = useSettingsLocalStore((state) => state.useCustomColors)

  const { prefersDark, prefersReducedMotion } = useSystemAppearancePreferences()

  useEffect(() => {
    const root = document.documentElement
    const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)
    const activeAccentTone = normalizeAccentTone(accentTone)
    const currentCustomization = getThemeColorCustomization(
      themeColorCustomizations,
      activeAccentTone,
      resolvedTheme,
    )
    const defaults = getAppearanceColorDefaults(activeAccentTone, resolvedTheme)

    const accent = currentCustomization.accent
    const bg = currentCustomization.background
    const fg = currentCustomization.foreground
    const hasAccentOverride =
      useCustomColors && normalizeColorValue(accent) !== normalizeColorValue(defaults.accent)
    const hasBackgroundOverride =
      useCustomColors && normalizeColorValue(bg) !== normalizeColorValue(defaults.background)
    const hasForegroundOverride =
      useCustomColors && normalizeColorValue(fg) !== normalizeColorValue(defaults.foreground)

    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = theme
    root.dataset.colorTheme = activeAccentTone
    root.dataset.density = density
    root.dataset.threadSpacing = threadSpacing
    root.dataset.messageSurface = messageSurface
    root.dataset.userMessageEmphasis = userMessageEmphasis
    root.dataset.motion = resolveMotionPreference(motionPreference, prefersReducedMotion)
    root.dataset.translucentSidebar = String(translucentSidebar)
    root.dataset.pointerCursor = String(usePointerCursor)

    root.style.colorScheme = resolvedTheme

    if (hasAccentOverride) {
      root.style.setProperty('--accent-custom', accent)
      root.style.setProperty(
        '--accent-strong-custom',
        `color-mix(in srgb, ${accent}, ${resolvedTheme === 'light' ? 'black 18%' : 'white 18%'})`,
      )
    } else {
      root.style.removeProperty('--accent-custom')
      root.style.removeProperty('--accent-strong-custom')
    }

    if (hasBackgroundOverride) {
      root.style.setProperty('--bg-main-custom', bg)
      const appBg =
        resolvedTheme === 'light'
          ? `color-mix(in srgb, ${bg}, black 3%)`
          : `color-mix(in srgb, ${bg}, white 2%)`
      root.style.setProperty('--bg-app-custom', appBg)
    } else {
      root.style.removeProperty('--bg-main-custom')
      root.style.removeProperty('--bg-app-custom')
    }

    if (hasForegroundOverride) {
      root.style.setProperty('--text-primary-custom', fg)
      root.style.setProperty(
        '--text-strong-custom',
        `color-mix(in srgb, ${fg}, ${resolvedTheme === 'light' ? 'black 20%' : 'white 10%'})`,
      )
      root.style.setProperty(
        '--text-secondary-custom',
        `color-mix(in srgb, ${fg}, transparent ${resolvedTheme === 'light' ? '30%' : '18%'})`,
      )
      root.style.setProperty(
        '--text-muted-custom',
        `color-mix(in srgb, ${fg}, transparent ${resolvedTheme === 'light' ? '50%' : '34%'})`,
      )
      root.style.setProperty(
        '--text-faint-custom',
        `color-mix(in srgb, ${fg}, transparent ${resolvedTheme === 'light' ? '70%' : '48%'})`,
      )
    } else {
      root.style.removeProperty('--text-primary-custom')
      root.style.removeProperty('--text-strong-custom')
      root.style.removeProperty('--text-secondary-custom')
      root.style.removeProperty('--text-muted-custom')
      root.style.removeProperty('--text-faint-custom')
    }

    if (uiFont) root.style.setProperty('--font-ui-custom', uiFont)
    else root.style.removeProperty('--font-ui-custom')

    if (codeFont) root.style.setProperty('--font-code-custom', codeFont)
    else root.style.removeProperty('--font-code-custom')

    root.style.setProperty('--text-body-size-custom', `${uiFontSize}px`)
    root.style.setProperty('--text-code-size-custom', `${codeFontSize}px`)

    if (hasBackgroundOverride) {
      root.style.setProperty(
        '--bg-sidebar-custom',
        buildSidebarBackground(bg, resolvedTheme, translucentSidebar),
      )
    } else {
      root.style.removeProperty('--bg-sidebar-custom')
    }

    // Contrast affects surface transparency.
    const alpha = contrast / 100
    root.style.setProperty('--thread-surface-alpha', String(alpha))
    root.style.setProperty('--thread-surface-alpha-strong', String(alpha + 0.05))
  }, [
    theme,
    prefersDark,
    prefersReducedMotion,
    accentTone,
    density,
    motionPreference,
    threadSpacing,
    messageSurface,
    userMessageEmphasis,
    themeColorCustomizations,
    uiFont,
    codeFont,
    uiFontSize,
    codeFontSize,
    translucentSidebar,
    contrast,
    usePointerCursor,
    useCustomColors,
  ])

  return null
}
