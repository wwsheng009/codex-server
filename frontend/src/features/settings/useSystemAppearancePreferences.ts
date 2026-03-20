import { useEffect, useState } from 'react'

type SystemAppearancePreferences = {
  prefersDark: boolean
  prefersReducedMotion: boolean
}

function readMediaQueryMatches(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia(query).matches
}

export function useSystemAppearancePreferences(): SystemAppearancePreferences {
  const [preferences, setPreferences] = useState<SystemAppearancePreferences>(() => ({
    prefersDark: readMediaQueryMatches('(prefers-color-scheme: dark)'),
    prefersReducedMotion: readMediaQueryMatches('(prefers-reduced-motion: reduce)'),
  }))

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return undefined
    }

    const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)')
    const reducedMotionMedia = window.matchMedia('(prefers-reduced-motion: reduce)')

    const updatePreferences = () => {
      setPreferences({
        prefersDark: colorSchemeMedia.matches,
        prefersReducedMotion: reducedMotionMedia.matches,
      })
    }

    updatePreferences()
    colorSchemeMedia.addEventListener('change', updatePreferences)
    reducedMotionMedia.addEventListener('change', updatePreferences)

    return () => {
      colorSchemeMedia.removeEventListener('change', updatePreferences)
      reducedMotionMedia.removeEventListener('change', updatePreferences)
    }
  }, [])

  return preferences
}
