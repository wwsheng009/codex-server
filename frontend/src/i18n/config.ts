export const appLocales = ['en', 'zh-CN'] as const

import type { AppLocale } from './configTypes'
export type { AppLocale } from './configTypes'

export const sourceLocale: AppLocale = 'en'

export const localeLabels: Record<AppLocale, { label: string; nativeLabel: string; shortLabel: string }> = {
  en: {
    label: 'English',
    nativeLabel: 'English',
    shortLabel: 'EN',
  },
  'zh-CN': {
    label: 'Chinese (Simplified)',
    nativeLabel: '简体中文',
    shortLabel: '中文',
  },
}

export function normalizeLocale(value: string | null | undefined): AppLocale {
  const normalized = (value ?? '').trim().toLowerCase()

  if (
    normalized === 'zh' ||
    normalized === 'zh-cn' ||
    normalized === 'zh-hans' ||
    normalized.startsWith('zh-cn-') ||
    normalized.startsWith('zh-hans-')
  ) {
    return 'zh-CN'
  }

  return sourceLocale
}

export function getLocaleDirection(_locale: AppLocale): 'ltr' | 'rtl' {
  return 'ltr'
}
