import { defineConfig } from '@lingui/cli'

export default defineConfig({
  locales: ['en', 'zh-CN'],
  sourceLocale: 'en',
  fallbackLocales: {
    default: 'en',
  },
  catalogs: [
    {
      path: 'src/locales/{locale}/messages',
      include: ['src'],
      exclude: ['**/*.d.ts'],
    },
  ],
})
