import { useState } from 'react'
import { i18n } from '../../i18n/runtime'
import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import {
  appearanceThemeOptions,
  colorThemeOptions,
  getAppearanceThemeDescription,
  getAppearanceThemeLabel,
  getColorThemeDescription,
  getColorThemeLabel,
  resolveAppearanceTheme,
} from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSystemAppearancePreferences } from '../../features/settings/useSystemAppearancePreferences'
import { Input } from '../../components/ui/Input'
import { Switch } from '../../components/ui/Switch'
import { Slider } from '../../components/ui/Slider'

export function AppearanceSettingsPage() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const setTheme = useSettingsLocalStore((state) => state.setTheme)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const setAccentTone = useSettingsLocalStore((state) => state.setAccentTone)
  const setUseCustomColors = useSettingsLocalStore((state) => state.setUseCustomColors)

  // Custom Colors
  const accentColorLight = useSettingsLocalStore((state) => state.accentColorLight)
  const setAccentColorLight = useSettingsLocalStore((state) => state.setAccentColorLight)
  const accentColorDark = useSettingsLocalStore((state) => state.accentColorDark)
  const setAccentColorDark = useSettingsLocalStore((state) => state.setAccentColorDark)

  const backgroundColorLight = useSettingsLocalStore((state) => state.backgroundColorLight)
  const setBackgroundColorLight = useSettingsLocalStore((state) => state.setBackgroundColorLight)
  const backgroundColorDark = useSettingsLocalStore((state) => state.backgroundColorDark)
  const setBackgroundColorDark = useSettingsLocalStore((state) => state.setBackgroundColorDark)

  const foregroundColorLight = useSettingsLocalStore((state) => state.foregroundColorLight)
  const setForegroundColorLight = useSettingsLocalStore((state) => state.setForegroundColorLight)
  const foregroundColorDark = useSettingsLocalStore((state) => state.foregroundColorDark)
  const setForegroundColorDark = useSettingsLocalStore((state) => state.setForegroundColorDark)

  // Fonts & Sizes
  const uiFont = useSettingsLocalStore((state) => state.uiFont)
  const setUiFont = useSettingsLocalStore((state) => state.setUiFont)
  const codeFont = useSettingsLocalStore((state) => state.codeFont)
  const setCodeFont = useSettingsLocalStore((state) => state.setCodeFont)
  const uiFontSize = useSettingsLocalStore((state) => state.uiFontSize)
  const setUiFontSize = useSettingsLocalStore((state) => state.setUiFontSize)
  const codeFontSize = useSettingsLocalStore((state) => state.codeFontSize)
  const setCodeFontSize = useSettingsLocalStore((state) => state.setCodeFontSize)

  // Toggles
  const translucentSidebar = useSettingsLocalStore((state) => state.translucentSidebar)
  const setTranslucentSidebar = useSettingsLocalStore((state) => state.setTranslucentSidebar)
  const contrast = useSettingsLocalStore((state) => state.contrast)
  const setContrast = useSettingsLocalStore((state) => state.setContrast)
  const usePointerCursor = useSettingsLocalStore((state) => state.usePointerCursor)
  const setUsePointerCursor = useSettingsLocalStore((state) => state.setUsePointerCursor)

  const { prefersDark } = useSystemAppearancePreferences()
  const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)

  const [editingMode, setEditingMode] = useState<'light' | 'dark'>(resolvedTheme)

  const handleSetAccentTone = (val: typeof accentTone) => {
    setAccentTone(val)
    setUseCustomColors(false)
  }

  const activeColorTheme = colorThemeOptions.find((option) => option.value === accentTone) || colorThemeOptions[0]
  const useCustomColors = useSettingsLocalStore((state) => state.useCustomColors)
  
  const isLight = editingMode === 'light'
  const effectiveAccentColor = useCustomColors 
    ? (isLight ? accentColorLight : accentColorDark)
    : activeColorTheme.swatches[isLight ? 0 : 1]

  const accentColor = isLight ? accentColorLight : accentColorDark
  const setAccentColor = isLight ? setAccentColorLight : setAccentColorDark
  const backgroundColor = isLight ? backgroundColorLight : backgroundColorDark
  const setBackgroundColor = isLight ? setBackgroundColorLight : setBackgroundColorDark
  const foregroundColor = isLight ? foregroundColorLight : foregroundColorDark
  const setForegroundColor = isLight ? setForegroundColorLight : setForegroundColorDark

  const themePreviewCode = `const themePreview: ThemeConfig = {
  surface: "${isLight ? 'base' : 'pane'}",
  accent: "${effectiveAccentColor || 'default'}",
  contrast: ${contrast},
};`

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
            {colorThemeOptions.map((option) => (
              <button
                key={option.value}
                aria-checked={accentTone === option.value}
                aria-label={getColorThemeLabel(option.value)}
                className={accentTone === option.value ? 'theme-swatch theme-swatch--active' : 'theme-swatch'}
                onClick={() => handleSetAccentTone(option.value)}
                role="radio"
                type="button"
              >
                <span className="theme-swatch__palette" aria-hidden="true">
                  {option.swatches.map((swatch) => (
                    <span
                      key={swatch}
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
            id: 'Customize colors and typography for {mode} workbench.',
            message: 'Customize colors and typography for {mode} workbench.',
            values: {
              mode:
                editingMode === 'light'
                  ? i18n._({ id: 'light', message: 'light' })
                  : i18n._({ id: 'dark', message: 'dark' }),
            },
          })}
          title={i18n._({
            id: '{mode} workbench',
            message: '{mode} workbench',
            values: {
              mode:
                editingMode === 'light'
                  ? i18n._({ id: 'Light', message: 'Light' })
                  : i18n._({ id: 'Dark', message: 'Dark' }),
            },
          })}
          meta={
            <div className="segmented-control segmented-control--sm">
              <button 
                className={editingMode === 'light' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                onClick={() => setEditingMode('light')}
                aria-pressed={editingMode === 'light'}
              >
                {i18n._({ id: 'Light', message: 'Light' })}
              </button>
              <button 
                className={editingMode === 'dark' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                onClick={() => setEditingMode('dark')}
                aria-pressed={editingMode === 'dark'}
              >
                {i18n._({ id: 'Dark', message: 'Dark' })}
              </button>
            </div>
          }
        >
          <SettingRow title={i18n._({ id: 'Accent', message: 'Accent' })} description={i18n._({
            id: 'Primary color for buttons, links, and highlights.',
            message: 'Primary color for buttons, links, and highlights.',
          })}>
            <ColorInput ariaLabel={i18n._({ id: 'Accent color', message: 'Accent color' })} value={accentColor} onChange={setAccentColor} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Background', message: 'Background' })} description={i18n._({
            id: 'Base surface color for the main workbench.',
            message: 'Base surface color for the main workbench.',
          })}>
            <ColorInput ariaLabel={i18n._({ id: 'Background color', message: 'Background color' })} value={backgroundColor} onChange={setBackgroundColor} />
          </SettingRow>

          <SettingRow title={i18n._({ id: 'Foreground', message: 'Foreground' })} description={i18n._({
            id: 'Default text color for primary content.',
            message: 'Default text color for primary content.',
          })}>
            <ColorInput ariaLabel={i18n._({ id: 'Foreground color', message: 'Foreground color' })} value={foregroundColor} onChange={setForegroundColor} />
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
            id: 'Monospace typeface for editors and terminal outputs.',
            message: 'Monospace typeface for editors and terminal outputs.',
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
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description={i18n._({
            id: 'Interactive and sizing preferences.',
            message: 'Interactive and sizing preferences.',
          })}
          title={i18n._({ id: 'Interaction', message: 'Interaction' })}
        >
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
      </div>
    </section>
  )
}

function ThemeIcon({ mode }: { mode: string }) {
  if (mode === 'light') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="18.36" x2="5.64" y2="16.94"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
      </svg>
    )
  }
  if (mode === 'dark') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  )
}

function ColorInput({ value, onChange, ariaLabel }: { value: string, onChange: (val: string) => void, ariaLabel?: string }) {
  return (
    <div className="color-input-wrapper">
      <div className="color-swatch" style={{ backgroundColor: value }} aria-hidden="true" />
      <Input 
        aria-label={ariaLabel}
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
        className="color-field"
      />
    </div>
  )
}
