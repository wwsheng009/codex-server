import { describe, expect, it } from 'vitest'

import {
  colorThemeOptions,
  getAppearancePaletteLabel,
  getAppearanceThemeLabel,
  getColorThemeLabel,
  getMessageSurfaceLabel,
  getQuickToggleTheme,
  getThreadSpacingLabel,
  getUserMessageEmphasisLabel,
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
    expect(getThreadSpacingLabel('tight')).toBe('Tight')
    expect(getMessageSurfaceLabel('soft')).toBe('Soft')
    expect(getUserMessageEmphasisLabel('minimal')).toBe('Minimal')
  })

  it('exposes multiple color themes for the settings UI', () => {
    expect(colorThemeOptions.map((option) => option.value)).toEqual([
      'cyan',
      'blue',
      'slate',
      'amber',
      'mint',
      'graphite',
      'solarized',
    ])
  })

  it('builds a readable active palette label from the current palette and theme', () => {
    expect(getAppearancePaletteLabel('solarized', 'dark')).toBe('Solarized Dark')
    expect(getAppearancePaletteLabel('graphite', 'light')).toBe('Graphite Light')
  })
})
