import { I18nProvider } from '@lingui/react'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'

import { useSettingsLocalStore } from '../features/settings/local-store'
import { getLocaleDirection, type AppLocale } from './config'
import { activateLocale, i18n } from './runtime'

type LinguiClientProviderProps = {
  children: ReactNode
}

export function LinguiClientProvider({ children }: LinguiClientProviderProps) {
  const locale = useSettingsLocalStore((state) => state.locale)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function loadLocale(activeLocale: AppLocale) {
      setIsReady(false)
      await activateLocale(activeLocale)

      if (cancelled) {
        return
      }

      const root = document.documentElement
      root.lang = activeLocale
      root.dir = getLocaleDirection(activeLocale)
      setIsReady(true)
    }

    void loadLocale(locale)

    return () => {
      cancelled = true
    }
  }, [locale])

  if (!isReady) {
    return null
  }

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>
}
