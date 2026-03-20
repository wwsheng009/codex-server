import { useEffect } from 'react'

import { resolveAppearanceTheme } from '../features/settings/appearance'
import { useSettingsLocalStore } from '../features/settings/local-store'
import { useSystemAppearancePreferences } from '../features/settings/useSystemAppearancePreferences'

export function AppearanceController() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const density = useSettingsLocalStore((state) => state.density)
  const reduceMotion = useSettingsLocalStore((state) => state.reduceMotion)
  const { prefersDark, prefersReducedMotion } = useSystemAppearancePreferences()

  useEffect(() => {
    const root = document.documentElement
    const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)

    root.dataset.theme = resolvedTheme
    root.dataset.themeMode = theme
    root.dataset.colorTheme = accentTone
    root.dataset.density = density
    root.dataset.motion = reduceMotion || prefersReducedMotion ? 'reduce' : 'normal'
    root.style.colorScheme = resolvedTheme
  }, [accentTone, density, prefersDark, prefersReducedMotion, reduceMotion, theme])

  return null
}
