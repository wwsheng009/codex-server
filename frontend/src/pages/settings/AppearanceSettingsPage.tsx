import { useState } from 'react'
import { i18n } from '../../i18n/runtime'
import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import {
  appearanceThemeOptions,
  colorThemeOptions,
  areWorkbenchThemeColorsEqual,
  getAppearancePaletteLabel,
  getAppearanceColorDefaults,
  getMotionPreferenceDescription,
  getMotionPreferenceLabel,
  getColorThemeSwatches,
  getAppearanceThemeDescription,
  getAppearanceThemeLabel,
  getColorThemeDescription,
  getColorThemeLabel,
  motionPreferenceOptions,
  getThemeColorCustomizationPalette,
  getWorkbenchThemeSwatches,
  isBuiltInColorTheme,
  normalizeAccentTone,
  resolveAppearanceTheme,
  resolveMotionPreference,
} from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSystemAppearancePreferences } from '../../features/settings/useSystemAppearancePreferences'
import { ColorPicker } from '../../components/ui/ColorPicker'
import '../../styles/color-picker.css'

import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { SelectControl } from '../../components/ui/SelectControl'
import { Slider } from '../../components/ui/Slider'
import { Switch } from '../../components/ui/Switch'
import { ThemeIcon } from '../../components/ui/ThemeIcon'

export function AppearanceSettingsPage() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const setTheme = useSettingsLocalStore((state) => state.setTheme)
  const motionPreference = useSettingsLocalStore((state) => state.motionPreference)
  const setMotionPreference = useSettingsLocalStore((state) => state.setMotionPreference)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const setAccentTone = useSettingsLocalStore((state) => state.setAccentTone)
  const themeColorCustomizations = useSettingsLocalStore((state) => state.themeColorCustomizations)
  const customThemes = useSettingsLocalStore((state) => state.customThemes)
  const activeCustomThemeId = useSettingsLocalStore((state) => state.activeCustomThemeId)
  const setThemeColorCustomization = useSettingsLocalStore((state) => state.setThemeColorCustomization)
  const selectCustomTheme = useSettingsLocalStore((state) => state.selectCustomTheme)
  const createCustomTheme = useSettingsLocalStore((state) => state.createCustomTheme)
  const renameCustomTheme = useSettingsLocalStore((state) => state.renameCustomTheme)
  const deleteCustomTheme = useSettingsLocalStore((state) => state.deleteCustomTheme)
  const resetThemePaletteCustomization = useSettingsLocalStore((state) => state.resetThemePaletteCustomization)

  const uiFont = useSettingsLocalStore((state) => state.uiFont)
  const setUiFont = useSettingsLocalStore((state) => state.setUiFont)
  const codeFont = useSettingsLocalStore((state) => state.codeFont)
  const setCodeFont = useSettingsLocalStore((state) => state.setCodeFont)
  const terminalFont = useSettingsLocalStore((state) => state.terminalFont)
  const setTerminalFont = useSettingsLocalStore((state) => state.setTerminalFont)
  const uiFontSize = useSettingsLocalStore((state) => state.uiFontSize)
  const setUiFontSize = useSettingsLocalStore((state) => state.setUiFontSize)
  const codeFontSize = useSettingsLocalStore((state) => state.codeFontSize)
  const setCodeFontSize = useSettingsLocalStore((state) => state.setCodeFontSize)
  const terminalFontSize = useSettingsLocalStore((state) => state.terminalFontSize)
  const setTerminalFontSize = useSettingsLocalStore((state) => state.setTerminalFontSize)
  const terminalLineHeight = useSettingsLocalStore((state) => state.terminalLineHeight)
  const setTerminalLineHeight = useSettingsLocalStore((state) => state.setTerminalLineHeight)
  const terminalRenderer = useSettingsLocalStore((state) => state.terminalRenderer)
  const setTerminalRenderer = useSettingsLocalStore((state) => state.setTerminalRenderer)

  // Toggles
  const translucentSidebar = useSettingsLocalStore((state) => state.translucentSidebar)
  const setTranslucentSidebar = useSettingsLocalStore((state) => state.setTranslucentSidebar)
  const contrast = useSettingsLocalStore((state) => state.contrast)
  const setContrast = useSettingsLocalStore((state) => state.setContrast)
  const usePointerCursor = useSettingsLocalStore((state) => state.usePointerCursor)
  const setUsePointerCursor = useSettingsLocalStore((state) => state.setUsePointerCursor)

  const { prefersDark, prefersReducedMotion } = useSystemAppearancePreferences()
  const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)
  const resolvedMotionPreference = resolveMotionPreference(
    motionPreference,
    prefersReducedMotion,
  )
  const activeAccentTone = normalizeAccentTone(accentTone)
  const motionOptions = motionPreferenceOptions.map((option) => ({
    value: option.value,
    label: getMotionPreferenceLabel(option.value),
  }))

  const [editingMode, setEditingMode] = useState<'light' | 'dark'>(resolvedTheme)
  const builtInThemeOptions = colorThemeOptions.filter((option) => option.value !== 'custom')
  const activeCustomTheme =
    customThemes.find((theme) => theme.id === activeCustomThemeId) ?? customThemes[0]
  const activePaletteCustomization = getThemeColorCustomizationPalette(
    themeColorCustomizations,
    activeAccentTone,
  )

  const handleSetAccentTone = (val: typeof accentTone) => {
    setAccentTone(val)
  }

  const activeThemeCustomization = activePaletteCustomization[editingMode]
  const activeThemeDefaults = getAppearanceColorDefaults(activeAccentTone, editingMode)
  const accentColor = activeThemeCustomization.accent
  const backgroundColor = activeThemeCustomization.background
  const foregroundColor = activeThemeCustomization.foreground
  const activePaletteLabel =
    activeAccentTone === 'custom' && activeCustomTheme
      ? `${activeCustomTheme.name} ${editingMode === 'dark' ? i18n._({ id: 'Dark', message: 'Dark' }) : i18n._({ id: 'Light', message: 'Light' })}`
      : getAppearancePaletteLabel(activeAccentTone, editingMode)
  const isModeCustomized = !areWorkbenchThemeColorsEqual(activeThemeCustomization, activeThemeDefaults)
  const isPaletteCustomized =
    !areWorkbenchThemeColorsEqual(
      activePaletteCustomization.light,
      getAppearanceColorDefaults(activeAccentTone, 'light'),
    ) ||
    !areWorkbenchThemeColorsEqual(
      activePaletteCustomization.dark,
      getAppearanceColorDefaults(activeAccentTone, 'dark'),
    )

  const setAccentColor = (value: string) =>
    setThemeColorCustomization(activeAccentTone, editingMode, 'accent', value)
  const setBackgroundColor = (value: string) =>
    setThemeColorCustomization(activeAccentTone, editingMode, 'background', value)
  const setForegroundColor = (value: string) =>
    setThemeColorCustomization(activeAccentTone, editingMode, 'foreground', value)

  const themePreviewCode = `const themePreview: ThemeConfig = {
  palette: "${activeAccentTone === 'custom' && activeCustomTheme ? activeCustomTheme.name : activeAccentTone}",
  mode: "${editingMode}",
  accent: "${accentColor}",
  background: "${backgroundColor}",
  foreground: "${foregroundColor}",
};`

  const handleCreateCustomTheme = () => {
    createCustomTheme(undefined, activeAccentTone)
  }

  const handleDuplicateCustomTheme = () => {
    createCustomTheme(undefined, 'custom')
  }

  const handleResetCurrentMode = () => {
    resetThemePaletteCustomization(activeAccentTone, editingMode)
  }

  const handleResetCurrentPalette = () => {
    resetThemePaletteCustomization(activeAccentTone)
  }

  const handleDeleteCustomTheme = () => {
    if (activeCustomTheme) {
      deleteCustomTheme(activeCustomTheme.id)
    }
  }

  const terminalRendererOptions = [
    {
      value: 'auto',
      label: i18n._({ id: 'Auto', message: 'Auto' }),
    },
    {
      value: 'webgl',
      label: i18n._({ id: 'WebGL', message: 'WebGL' }),
    },
    {
      value: 'dom',
      label: i18n._({ id: 'DOM', message: 'DOM' }),
    },
  ]

  return (
    <section className="settings-page" role="main">
      <SettingsPageHeader
        description={i18n._({
          id: 'Fine-tune the shell palette, typography, and interactive feedback to match your local workbench preferences.',
          message:
            'Fine-tune the shell palette, typography, and interactive feedback to match your local workbench preferences.',
        })}
        title={i18n._({ id: 'Appearance', message: 'Appearance' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Select light, dark, or system-matched interface mode.',
            message: 'Select light, dark, or system-matched interface mode.',
          })}
          title={i18n._({ id: 'Mode', message: 'Mode' })}
        >
          <div className="theme-mode-selector" role="radiogroup">
            {appearanceThemeOptions.map((option) => (
              <button
                key={option.value}
                aria-checked={theme === option.value}
                aria-label={i18n._({
                  id: '{mode} mode',
                  message: '{mode} mode',
                  values: { mode: getAppearanceThemeLabel(option.value) },
                })}
                className={theme === option.value ? 'theme-mode-button theme-mode-button--active' : 'theme-mode-button'}
                onClick={() => setTheme(option.value)}
                role="radio"
                title={getAppearanceThemeDescription(option.value)}
                type="button"
              >
                <ThemeIcon mode={option.value} />
                <span>{getAppearanceThemeLabel(option.value)}</span>
              </button>
            ))}
          </div>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Apply a pre-defined color palette to the interface.',
            message: 'Apply a pre-defined color palette to the interface.',
          })}
          title={i18n._({ id: 'Color theme', message: 'Color theme' })}
        >
          <div className="theme-swatch-grid" role="radiogroup">
            {builtInThemeOptions.map((option) => (
              <button
                key={option.value}
                aria-checked={activeAccentTone === option.value}
                aria-label={getColorThemeLabel(option.value)}
                className={activeAccentTone === option.value ? 'theme-swatch theme-swatch--active' : 'theme-swatch'}
                onClick={() => handleSetAccentTone(option.value)}
                role="radio"
                type="button"
              >
                <span className="theme-swatch__palette" aria-hidden="true">
                  {getColorThemeSwatches(option.value, themeColorCustomizations).map((swatch, index) => (
                    <span
                      key={`${option.value}-${swatch}-${index}`}
                      className="theme-swatch__dot"
                      style={{ background: swatch }}
                    />
                  ))}
                </span>
                <span className="theme-swatch__copy">
                  <strong>{getColorThemeLabel(option.value)}</strong>
                  <span>{getColorThemeDescription(option.value)}</span>
                </span>
              </button>
            ))}
          </div>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Create, rename, and switch between saved custom palettes.',
            message: 'Create, rename, and switch between saved custom palettes.',
          })}
          title={i18n._({ id: 'Custom themes', message: 'Custom themes' })}
          meta={
            <Button intent="secondary" size="sm" onClick={handleCreateCustomTheme}>
              {i18n._({ id: 'New from Current', message: 'New from Current' })}
            </Button>
          }
        >
          <div className="theme-swatch-grid theme-swatch-grid--custom" role="radiogroup">
            {customThemes.map((customTheme) => {
              const isActive = activeAccentTone === 'custom' && activeCustomTheme?.id === customTheme.id

              return (
                <button
                  key={customTheme.id}
                  aria-checked={isActive}
                  aria-label={customTheme.name}
                  className={isActive ? 'theme-swatch theme-swatch--active' : 'theme-swatch'}
                  onClick={() => selectCustomTheme(customTheme.id)}
                  role="radio"
                  type="button"
                >
                  <span className="theme-swatch__palette" aria-hidden="true">
                    {getWorkbenchThemeSwatches(customTheme.colors).map((swatch, index) => (
                      <span
                        key={`${customTheme.id}-${swatch}-${index}`}
                        className="theme-swatch__dot"
                        style={{ background: swatch }}
                      />
                    ))}
                  </span>
                  <span className="theme-swatch__copy">
                    <strong>{customTheme.name}</strong>
                    <span>
                      {i18n._({
                        id: 'Light {lightAccent} · Dark {darkAccent}',
                        message: 'Light {lightAccent} · Dark {darkAccent}',
                        values: {
                          lightAccent: customTheme.colors.light.accent,
                          darkAccent: customTheme.colors.dark.accent,
                        },
                      })}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Live look at current theme configuration.',
            message: 'Live look at current theme configuration.',
          })}
          title={i18n._({ id: 'Theme preview', message: 'Theme preview' })}
        >
          <div className="theme-preview-container">
            <pre className="theme-preview-code">
              <code>{themePreviewCode}</code>
            </pre>
          </div>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Customize colors and typography for {palette}. Overrides only apply to this theme variant.',
            message: 'Customize colors and typography for {palette}. Overrides only apply to this theme variant.',
            values: {
              palette: activePaletteLabel,
            },
          })}
          title={i18n._({
            id: '{palette} workbench',
            message: '{palette} workbench',
            values: {
              palette: activePaletteLabel,
            },
          })}
          meta={
            <div className="appearance-theme-tools">
              <div className="segmented-control segmented-control--sm">
                <button
                  type="button"
                  className={editingMode === 'light' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                  onClick={() => setEditingMode('light')}
                  aria-pressed={editingMode === 'light'}
                >
                  {i18n._({ id: 'Light', message: 'Light' })}
                </button>
                <button
                  type="button"
                  className={editingMode === 'dark' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                  onClick={() => setEditingMode('dark')}
                  aria-pressed={editingMode === 'dark'}
                >
                  {i18n._({ id: 'Dark', message: 'Dark' })}
                </button>
              </div>
              <div className="appearance-theme-actions">
                {activeAccentTone !== 'custom' ? (
                  <Button intent="secondary" size="sm" onClick={handleCreateCustomTheme}>
                    {i18n._({ id: 'New Custom Theme', message: 'New Custom Theme' })}
                  </Button>
                ) : (
                  <Button intent="secondary" size="sm" onClick={handleDuplicateCustomTheme}>
                    {i18n._({ id: 'Duplicate Theme', message: 'Duplicate Theme' })}
                  </Button>
                )}
                <Button
                  disabled={!isModeCustomized}
                  intent="ghost"
                  size="sm"
                  onClick={handleResetCurrentMode}
                >
                  {i18n._({
                    id: 'Reset {mode}',
                    message: 'Reset {mode}',
                    values: {
                      mode:
                        editingMode === 'light'
                          ? i18n._({ id: 'Light', message: 'Light' })
                          : i18n._({ id: 'Dark', message: 'Dark' }),
                    },
                  })}
                </Button>
                <Button
                  disabled={!isPaletteCustomized}
                  intent="ghost"
                  size="sm"
                  onClick={handleResetCurrentPalette}
                >
                  {activeAccentTone === 'custom'
                    ? i18n._({ id: 'Reset Custom Theme', message: 'Reset Custom Theme' })
                    : i18n._({ id: 'Restore Built-in Theme', message: 'Restore Built-in Theme' })}
                </Button>
                {activeAccentTone === 'custom' ? (
                  <Button
                    className="ide-button--ghost-danger"
                    intent="ghost"
                    size="sm"
                    onClick={handleDeleteCustomTheme}
                  >
                    {i18n._({ id: 'Delete Theme', message: 'Delete Theme' })}
                  </Button>
                ) : null}
              </div>
            </div>
          }
        >
          {!isBuiltInColorTheme(accentTone) ? (
            <SettingRow
              title={i18n._({ id: 'Theme name', message: 'Theme name' })}
              description={i18n._({
                id: 'This custom theme is editable and scoped to its own saved palette.',
                message: 'This custom theme is editable and scoped to its own saved palette.',
              })}
            >
              <div className="appearance-custom-theme-control">
                <Input
                  aria-label={i18n._({ id: 'Custom theme name', message: 'Custom theme name' })}
                  value={activeCustomTheme?.name ?? ''}
                  onChange={(event) => {
                    if (activeCustomTheme) {
                      renameCustomTheme(activeCustomTheme.id, event.target.value)
                    }
                  }}
                />
                <div className="appearance-inline-note">
                  {i18n._({
                    id: 'Custom theme colors are scoped to this palette and do not override the built-in themes.',
                    message:
                      'Custom theme colors are scoped to this palette and do not override the built-in themes.',
                  })}
                </div>
              </div>
            </SettingRow>
          ) : null}

          <SettingRow title={i18n._({ id: 'Accent', message: 'Accent' })} description={i18n._({
            id: 'Primary color for buttons, links, and highlights.',
            message: 'Primary color for buttons, links, and highlights.',
          })}>
            <ColorPicker value={accentColor} onChange={setAccentColor} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Background', message: 'Background' })} description={i18n._({
            id: 'Base surface color for the main workbench.',
            message: 'Base surface color for the main workbench.',
          })}>
            <ColorPicker value={backgroundColor} onChange={setBackgroundColor} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Foreground', message: 'Foreground' })} description={i18n._({
            id: 'Default text color for primary content.',
            message: 'Default text color for primary content.',
          })}>
            <ColorPicker value={foregroundColor} onChange={setForegroundColor} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'UI font', message: 'UI font' })} description={i18n._({
            id: 'Primary typeface for labels, menus, and controls.',
            message: 'Primary typeface for labels, menus, and controls.',
          })}>
            <Input 
              aria-label={i18n._({ id: 'UI font family', message: 'UI font family' })}
              value={uiFont} 
              onChange={(e) => setUiFont(e.target.value)} 
              placeholder={i18n._({ id: 'System default', message: 'System default' })}
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Code font', message: 'Code font' })} description={i18n._({
            id: 'Monospace typeface for editors, diffs, and code blocks.',
            message: 'Monospace typeface for editors, diffs, and code blocks.',
          })}>
            <Input 
              aria-label={i18n._({ id: 'Code font family', message: 'Code font family' })}
              value={codeFont} 
              onChange={(e) => setCodeFont(e.target.value)} 
              placeholder={i18n._({ id: 'Monospace default', message: 'Monospace default' })}
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Translucent sidebar', message: 'Translucent sidebar' })} description={i18n._({
            id: 'Apply subtle blur and transparency to the sidebar background.',
            message: 'Apply subtle blur and transparency to the sidebar background.',
          })}>
            <Switch checked={translucentSidebar} onChange={(e) => setTranslucentSidebar(e.target.checked)} label={i18n._({
              id: 'Enable translucent sidebar',
              message: 'Enable translucent sidebar',
            })} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Contrast', message: 'Contrast' })} description={i18n._({
            id: 'Adjust visual separation between surfaces.',
            message: 'Adjust visual separation between surfaces.',
          })}>
            <Slider
              aria-label={i18n._({ id: 'Contrast adjustment', message: 'Contrast adjustment' })}
              min="0"
              max="100"
              value={contrast}
              onChange={(e) => setContrast(Number(e.target.value))}
              unit="%"
            />          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Interactive and sizing preferences.',
            message: 'Interactive and sizing preferences.',
          })}
          title={i18n._({ id: 'Interaction', message: 'Interaction' })}
        >
          <SettingRow
            title={i18n._({ id: 'Motion', message: 'Motion' })}
            description={
              motionPreference === 'system'
                ? i18n._({
                    id: 'Follow the operating system motion preference. The system is currently {mode}.',
                    message:
                      'Follow the operating system motion preference. The system is currently {mode}.',
                    values: {
                      mode: prefersReducedMotion
                        ? i18n._({ id: 'set to reduce motion', message: 'set to reduce motion' })
                        : i18n._({ id: 'set to normal motion', message: 'set to normal motion' }),
                    },
                  })
                : getMotionPreferenceDescription(motionPreference)
            }
            meta={
              <span className="setting-row__meta-note">
                {i18n._({
                  id: 'Effective: {mode}',
                  message: 'Effective: {mode}',
                  values: {
                    mode: getMotionPreferenceLabel(resolvedMotionPreference),
                  },
                })}
              </span>
            }
          >
            <SelectControl
              ariaLabel={i18n._({ id: 'Motion preference', message: 'Motion preference' })}
              options={motionOptions}
              onChange={(value) => setMotionPreference(value as typeof motionPreference)}
              value={motionPreference}
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Pointer cursor', message: 'Pointer cursor' })} description={i18n._({
            id: 'Use pointing hand cursor for interactive elements.',
            message: 'Use pointing hand cursor for interactive elements.',
          })}>
            <Switch checked={usePointerCursor} onChange={(e) => setUsePointerCursor(e.target.checked)} label={i18n._({
              id: 'Use pointer cursor',
              message: 'Use pointer cursor',
            })} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'UI font size', message: 'UI font size' })} description={i18n._({
            id: 'Base font size for the Codex UI.',
            message: 'Base font size for the Codex UI.',
          })}>
            <Input 
              aria-label={i18n._({ id: 'UI font size', message: 'UI font size' })}
              type="number" 
              value={uiFontSize} 
              onChange={(e) => setUiFontSize(Number(e.target.value))} 
              className="field--inline"
              hint="px"
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Code font size', message: 'Code font size' })} description={i18n._({
            id: 'Base font size for code editors and diffs.',
            message: 'Base font size for code editors and diffs.',
          })}>
            <Input 
              aria-label={i18n._({ id: 'Code font size', message: 'Code font size' })}
              type="number" 
              value={codeFontSize} 
              onChange={(e) => setCodeFontSize(Number(e.target.value))} 
              className="field--inline"
              hint="px"
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Configure terminal typography and renderer behavior separately from editor code styling.',
            message:
              'Configure terminal typography and renderer behavior separately from editor code styling.',
          })}
          title={i18n._({ id: 'Terminal', message: 'Terminal' })}
        >
          <SettingRow title={i18n._({ id: 'Terminal font', message: 'Terminal font' })} description={i18n._({
            id: 'Monospace typeface used inside terminal sessions.',
            message: 'Monospace typeface used inside terminal sessions.',
          })}>
            <Input
              aria-label={i18n._({ id: 'Terminal font family', message: 'Terminal font family' })}
              value={terminalFont}
              onChange={(e) => setTerminalFont(e.target.value)}
              placeholder={i18n._({ id: 'Monospace default', message: 'Monospace default' })}
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Terminal font size', message: 'Terminal font size' })} description={i18n._({
            id: 'Font size used by the embedded terminal.',
            message: 'Font size used by the embedded terminal.',
          })}>
            <Input
              aria-label={i18n._({ id: 'Terminal font size', message: 'Terminal font size' })}
              type="number"
              min="10"
              max="32"
              value={terminalFontSize}
              onChange={(e) => setTerminalFontSize(Number(e.target.value))}
              className="field--inline"
              hint="px"
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Terminal line height', message: 'Terminal line height' })} description={i18n._({
            id: 'Vertical spacing between terminal rows. Lower values feel denser.',
            message: 'Vertical spacing between terminal rows. Lower values feel denser.',
          })}>
            <Input
              aria-label={i18n._({ id: 'Terminal line height', message: 'Terminal line height' })}
              type="number"
              min="1"
              max="2"
              step="0.05"
              value={terminalLineHeight}
              onChange={(e) => setTerminalLineHeight(Number(e.target.value))}
              className="field--inline"
              hint={i18n._({ id: 'row multiplier', message: 'row multiplier' })}
            />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Terminal renderer', message: 'Terminal renderer' })} description={i18n._({
            id: 'Auto prefers WebGL when available. Switch to DOM if terminal glyphs look wrong.',
            message: 'Auto prefers WebGL when available. Switch to DOM if terminal glyphs look wrong.',
          })}>
            <SelectControl
              ariaLabel={i18n._({ id: 'Terminal renderer', message: 'Terminal renderer' })}
              options={terminalRendererOptions}
              onChange={(value) => {
                if (value === 'auto' || value === 'webgl' || value === 'dom') {
                  setTerminalRenderer(value)
                }
              }}
              value={terminalRenderer}
            />
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}

// 确保兼容具名导出和默认导出，以修复 React.lazy 加载失败的问题
export default AppearanceSettingsPage
