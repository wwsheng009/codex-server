import { i18n } from '@lingui/core'

import { normalizeLocale, sourceLocale, type AppLocale } from './config'

const catalogLoaders: Record<AppLocale, () => Promise<{ messages: Record<string, string> }>> = {
  en: () => import('../locales/en/messages.po'),
  'zh-CN': () => import('../locales/zh-CN/messages.po'),
}

export { i18n }

export async function activateLocale(locale: AppLocale) {
  const { messages } = await catalogLoaders[locale]()
  i18n.loadAndActivate({ locale, messages })
}

export function getActiveLocale() {
  return normalizeLocale(i18n.locale || sourceLocale)
}
