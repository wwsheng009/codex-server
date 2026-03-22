import { beforeAll, describe, expect, it } from 'vitest'

import {
  copyThemeColorCustomizationPalette,
  createLegacyThemeColorCustomizations,
  createThemeColorCustomizations,
  colorThemeOptions,
  getThemeColorCustomization,
  hasThemeColorCustomizationOverrides,
  getAppearanceColorDefaults,
  getAppearancePaletteLabel,
  getAppearanceThemeLabel,
  getColorThemeLabel,
  getMessageSurfaceLabel,
  getQuickToggleTheme,
  getThreadSpacingLabel,
  getUserMessageEmphasisLabel,
  normalizeAccentTone,
  normalizeAppearanceTheme,
  normalizeThemeColorCustomizations,
  resetThemeColorCustomization,
  resolveAppearanceTheme,
} from './appearance'
import { activateLocale } from '../../i18n/runtime'

describe('appearance helpers', () => {
  beforeAll(async () => {
    await activateLocale('en')
  })

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
      'custom',
    ])
  })

  it('builds a readable active palette label from the current palette and theme', () => {
    expect(getAppearancePaletteLabel('solarized', 'dark')).toBe('Solarized Dark')
    expect(getAppearancePaletteLabel('graphite', 'light')).toBe('Graphite Light')
  })

  it('exposes palette-specific defaults for each theme variant', () => {
    expect(getAppearanceColorDefaults('solarized', 'light')).toEqual({
      accent: '#2AA198',
      background: '#FDF6E3',
      foreground: '#586E75',
    })
    expect(getAppearanceColorDefaults('graphite', 'dark')).toEqual({
      accent: '#2FBF71',
      background: '#11161D',
      foreground: '#D0D7DE',
    })
  })

  it('builds fully scoped theme customizations from partial seeds and legacy values', () => {
    const partial = createThemeColorCustomizations({
      solarized: {
        dark: {
          accent: '#0EA5E9',
        },
      },
    })

    expect(partial.solarized.dark).toEqual({
      accent: '#0EA5E9',
      background: '#002B36',
      foreground: '#93A1A1',
    })
    expect(partial.blue.light).toEqual({
      accent: '#5271FF',
      background: '#FCFBFA',
      foreground: '#303744',
    })

    const legacy = createLegacyThemeColorCustomizations({
      light: {
        accent: '#123456',
        background: '#FFFFFF',
        foreground: '#111111',
      },
      dark: {
        accent: '#654321',
        background: '#000000',
        foreground: '#EEEEEE',
      },
    })

    expect(legacy.mint.light).toEqual({
      accent: '#123456',
      background: '#FFFFFF',
      foreground: '#111111',
    })
    expect(legacy.cyan.dark).toEqual({
      accent: '#654321',
      background: '#000000',
      foreground: '#EEEEEE',
    })
  })

  it('normalizes unsupported appearance values to safe defaults', () => {
    expect(normalizeAppearanceTheme('dark')).toBe('dark')
    expect(normalizeAppearanceTheme('sepia')).toBe('system')
    expect(normalizeAccentTone('graphite')).toBe('graphite')
    expect(normalizeAccentTone('legacy')).toBe('blue')
  })

  it('fills missing persisted palette entries from defaults', () => {
    const persisted = normalizeThemeColorCustomizations({
      blue: {
        light: {
          accent: '#123456',
        },
      },
    })

    expect(getThemeColorCustomization(persisted, 'blue', 'light')).toEqual({
      accent: '#123456',
      background: '#FCFBFA',
      foreground: '#303744',
    })
    expect(getThemeColorCustomization(persisted, 'graphite', 'dark')).toEqual({
      accent: '#2FBF71',
      background: '#11161D',
      foreground: '#D0D7DE',
    })
  })

  it('can reset and copy palette customizations without leaking across themes', () => {
    const customized = createThemeColorCustomizations({
      blue: {
        light: {
          accent: '#123456',
        },
      },
    })

    expect(hasThemeColorCustomizationOverrides(customized)).toBe(true)

    const copied = copyThemeColorCustomizationPalette(customized, 'blue', 'custom')
    expect(copied.custom.light).toEqual(copied.blue.light)
    expect(copied.custom.dark).toEqual(copied.blue.dark)

    const resetLight = resetThemeColorCustomization(copied, 'blue', 'light')
    expect(resetLight.blue.light).toEqual({
      accent: '#5271FF',
      background: '#FCFBFA',
      foreground: '#303744',
    })
    expect(resetLight.blue.dark).toEqual(copied.blue.dark)

    const resetCustom = resetThemeColorCustomization(copied, 'custom')
    expect(resetCustom.custom.light).toEqual({
      accent: '#7C6A58',
      background: '#FAF6F1',
      foreground: '#362E29',
    })
    expect(resetCustom.custom.dark).toEqual({
      accent: '#D3B79A',
      background: '#18120F',
      foreground: '#F1E7DD',
    })
  })
})
