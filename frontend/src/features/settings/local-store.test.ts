// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const settingsStorageKey = 'codex-server-settings-local-store'

describe('useSettingsLocalStore locale initialization', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  afterEach(() => {
    window.localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('prefers the browser locale for first-run settings state', async () => {
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'zh-CN',
    })
    Object.defineProperty(window.navigator, 'languages', {
      configurable: true,
      value: ['zh-CN', 'en-US'],
    })

    const { useSettingsLocalStore } = await import('./local-store')

    expect(useSettingsLocalStore.getState().locale).toBe('zh-CN')
  })

  it('normalizes persisted locale values before hydrating the store', async () => {
    window.localStorage.setItem(
      settingsStorageKey,
      JSON.stringify({
        state: {
          locale: 'zh',
        },
        version: 4,
      }),
    )
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'en-US',
    })
    Object.defineProperty(window.navigator, 'languages', {
      configurable: true,
      value: ['en-US'],
    })

    const { useSettingsLocalStore } = await import('./local-store')

    expect(useSettingsLocalStore.getState().locale).toBe('zh-CN')
  })
})
