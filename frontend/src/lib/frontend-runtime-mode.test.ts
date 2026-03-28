import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import {
  FRONTEND_RUNTIME_MODE_STORAGE_KEY,
  normalizeFrontendRuntimeMode,
  readFrontendRuntimeMode,
  writeFrontendRuntimeMode,
} from './frontend-runtime-mode'

describe('frontend runtime mode helpers', () => {
  const localStorageState = new Map<string, string>()

  beforeAll(() => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem(key: string) {
          return localStorageState.has(key) ? localStorageState.get(key)! : null
        },
        setItem(key: string, value: string) {
          localStorageState.set(key, value)
        },
        removeItem(key: string) {
          localStorageState.delete(key)
        },
      },
    })
  })

  afterEach(() => {
    localStorageState.clear()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes unknown values back to normal', () => {
    expect(normalizeFrontendRuntimeMode(undefined)).toBe('normal')
    expect(normalizeFrontendRuntimeMode('TRACE')).toBe('normal')
    expect(normalizeFrontendRuntimeMode(' debug ')).toBe('debug')
  })

  it('persists debug mode to local storage', () => {
    writeFrontendRuntimeMode('debug')

    expect(window.localStorage.getItem(FRONTEND_RUNTIME_MODE_STORAGE_KEY)).toBe('debug')
    expect(readFrontendRuntimeMode()).toBe('debug')
  })

  it('clears local storage when switching back to normal mode', () => {
    window.localStorage.setItem(FRONTEND_RUNTIME_MODE_STORAGE_KEY, 'debug')

    writeFrontendRuntimeMode('normal')

    expect(window.localStorage.getItem(FRONTEND_RUNTIME_MODE_STORAGE_KEY)).toBeNull()
    expect(readFrontendRuntimeMode()).toBe('normal')
  })
})
