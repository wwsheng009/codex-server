import { useEffect } from 'react'

import { resolveAppearanceTheme } from '../features/settings/appearance'
import { useSettingsLocalStore } from '../features/settings/local-store'
import { useSystemAppearancePreferences } from '../features/settings/useSystemAppearancePreferences'

export function AppearanceController() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const density = useSettingsLocalStore((state) => state.density)
  const reduceMotion = useSettingsLocalStore((state) => state.reduceMotion)
  const threadSpacing = useSettingsLocalStore((state) => state.threadSpacing)
  const messageSurface = useSettingsLocalStore((state) => state.messageSurface)
  const userMessageEmphasis = useSettingsLocalStore((state) => state.userMessageEmphasis)

  // Granular Theme Fields
  const accentColorLight = useSettingsLocalStore((state) => state.accentColorLight)
  const accentColorDark = useSettingsLocalStore((state) => state.accentColorDark)
  const backgroundColorLight = useSettingsLocalStore((state) => state.backgroundColorLight)
  const backgroundColorDark = useSettingsLocalStore((state) => state.backgroundColorDark)
  const foregroundColorLight = useSettingsLocalStore((state) => state.foregroundColorLight)
  const foregroundColorDark = useSettingsLocalStore((state) => state.foregroundColorDark)
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

    // Mode-specific color overrides
    const accent = resolvedTheme === 'light' ? accentColorLight : accentColorDark
    const bg = resolvedTheme === 'light' ? backgroundColorLight : backgroundColorDark
    const fg = resolvedTheme === 'light' ? foregroundColorLight : foregroundColorDark

    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = theme
    root.dataset.colorTheme = accentTone
    root.dataset.density = density
    root.dataset.threadSpacing = threadSpacing
    root.dataset.messageSurface = messageSurface
    root.dataset.userMessageEmphasis = userMessageEmphasis
    root.dataset.motion = reduceMotion || prefersReducedMotion ? 'reduce' : 'normal'
    root.dataset.translucentSidebar = String(translucentSidebar)
    root.dataset.pointerCursor = String(usePointerCursor)

    root.style.colorScheme = resolvedTheme

    // Apply custom variables if enabled
    if (useCustomColors) {
      if (accent) root.style.setProperty('--accent-custom', accent)
      else root.style.removeProperty('--accent-custom')

      if (bg) {
        root.style.setProperty('--bg-main-custom', bg)
        root.style.setProperty('--bg-app-custom', bg)
      } else {
        root.style.removeProperty('--bg-main-custom')
        root.style.removeProperty('--bg-app-custom')
      }

      if (fg) root.style.setProperty('--text-primary-custom', fg)
      else root.style.removeProperty('--text-primary-custom')
    } else {
      root.style.removeProperty('--accent-custom')
      root.style.removeProperty('--bg-main-custom')
      root.style.removeProperty('--bg-app-custom')
      root.style.removeProperty('--text-primary-custom')
    }

    if (uiFont) root.style.setProperty('--font-ui-custom', uiFont)
    else root.style.removeProperty('--font-ui-custom')

    if (codeFont) root.style.setProperty('--font-code-custom', codeFont)
    else root.style.removeProperty('--font-code-custom')

    root.style.setProperty('--text-body-size-custom', `${uiFontSize}px`)
    root.style.setProperty('--text-code-size-custom', `${codeFontSize}px`)

    // Derived sidebar gradient if not translucent
    if (!translucentSidebar && useCustomColors && bg) {
      root.style.setProperty('--bg-sidebar-custom', bg)
    } else {
      root.style.removeProperty('--bg-sidebar-custom')
    }

    // Contrast affects surface transparency
    const alpha = contrast / 100
    root.style.setProperty('--thread-surface-alpha', String(alpha))
    root.style.setProperty('--thread-surface-alpha-strong', String(alpha + 0.05))

    // Optional: Derived variables
    if (accent) root.style.setProperty('--accent-strong', accent)
  }, [
    theme,
    prefersDark,
    prefersReducedMotion,
    accentTone,
    density,
    reduceMotion,
    threadSpacing,
    messageSurface,
    userMessageEmphasis,
    accentColorLight,
    accentColorDark,
    backgroundColorLight,
    backgroundColorDark,
    foregroundColorLight,
    foregroundColorDark,
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
