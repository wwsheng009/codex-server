import { describe, expect, it } from 'vitest'

import {
  colorThemeOptions,
  getAppearanceThemeLabel,
  getColorThemeLabel,
  getQuickToggleTheme,
  resolveAppearanceTheme,
} from './appearance'

describe('appearance helpers', () => {
  it('resolves system theme against the OS preference', () => {
    expect(resolveAppearanceTheme('system', true)).toBe('dark')
    expect(resolveAppearanceTheme('system', false)).toBe('light')
  })

  it('passes through explicit theme modes', () => {
    expect(resolveAppearanceTheme('light', true)).toBe('light')
    expect(resolveAppearanceTheme('dark', false)).toBe('dark')
  })

  it('computes the next quick-toggle theme from the visible result', () => {
    expect(getQuickToggleTheme('light', false)).toBe('dark')
    expect(getQuickToggleTheme('dark', true)).toBe('light')
    expect(getQuickToggleTheme('system', false)).toBe('dark')
    expect(getQuickToggleTheme('system', true)).toBe('light')
  })

  it('returns friendly labels for theme controls', () => {
    expect(getAppearanceThemeLabel('system')).toBe('System')
    expect(getColorThemeLabel('mint')).toBe('Mint')
  })

  it('exposes multiple color themes for the settings UI', () => {
    expect(colorThemeOptions.map((option) => option.value)).toEqual([
      'blue',
      'slate',
      'amber',
      'mint',
    ])
  })
})
