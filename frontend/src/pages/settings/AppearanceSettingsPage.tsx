import { useState } from 'react'
import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import {
  appearanceThemeOptions,
  colorThemeOptions,
  resolveAppearanceTheme,
} from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSystemAppearancePreferences } from '../../features/settings/useSystemAppearancePreferences'

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
        description="Fine-tune the shell palette, typography, and interactive feedback to match your local workbench preferences."
        title="Appearance"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Select light, dark, or system-matched interface mode."
          title="Mode"
        >
          <div className="theme-mode-selector" role="radiogroup">
            {appearanceThemeOptions.map((option) => (
              <button
                key={option.value}
                aria-checked={theme === option.value}
                aria-label={`${option.label} mode`}
                className={theme === option.value ? 'theme-mode-button theme-mode-button--active' : 'theme-mode-button'}
                onClick={() => setTheme(option.value)}
                role="radio"
                type="button"
              >
                <ThemeIcon mode={option.value} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
        </SettingsGroup>

        <SettingsGroup
          description="Apply a pre-defined color palette to the interface."
          title="Color theme"
        >
          <div className="theme-swatch-grid" role="radiogroup">
            {colorThemeOptions.map((option) => (
              <button
                key={option.value}
                aria-checked={accentTone === option.value}
                aria-label={option.label}
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
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </span>
              </button>
            ))}
          </div>
        </SettingsGroup>

        <SettingsGroup
          description="Live look at current theme configuration."
          title="Theme preview"
        >
          <div className="theme-preview-container">
            <pre className="theme-preview-code">
              <code>{themePreviewCode}</code>
            </pre>
          </div>
        </SettingsGroup>

        <SettingsGroup
          description={`Customize colors and typography for ${editingMode} workbench.`}
          title={`${editingMode.charAt(0).toUpperCase() + editingMode.slice(1)} workbench`}
          meta={
            <div className="segmented-control segmented-control--sm">
              <button 
                className={editingMode === 'light' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                onClick={() => setEditingMode('light')}
                aria-pressed={editingMode === 'light'}
              >
                Light
              </button>
              <button 
                className={editingMode === 'dark' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                onClick={() => setEditingMode('dark')}
                aria-pressed={editingMode === 'dark'}
              >
                Dark
              </button>
            </div>
          }
        >
          <SettingRow title="Accent" description="Primary color for buttons, links, and highlights.">
            <ColorInput ariaLabel="Accent color" value={accentColor} onChange={setAccentColor} />
          </SettingRow>

          <SettingRow title="Background" description="Base surface color for the main workbench.">
            <ColorInput ariaLabel="Background color" value={backgroundColor} onChange={setBackgroundColor} />
          </SettingRow>

          <SettingRow title="Foreground" description="Default text color for primary content.">
            <ColorInput ariaLabel="Foreground color" value={foregroundColor} onChange={setForegroundColor} />
          </SettingRow>

          <SettingRow title="UI font" description="Primary typeface for labels, menus, and controls.">
            <input 
              aria-label="UI font family"
              className="field" 
              value={uiFont} 
              onChange={(e) => setUiFont(e.target.value)} 
              placeholder="System default"
            />
          </SettingRow>

          <SettingRow title="Code font" description="Monospace typeface for editors and terminal outputs.">
            <input 
              aria-label="Code font family"
              className="field" 
              value={codeFont} 
              onChange={(e) => setCodeFont(e.target.value)} 
              placeholder="Monospace default"
            />
          </SettingRow>

          <SettingRow title="Translucent sidebar" description="Apply subtle blur and transparency to the sidebar background.">
            <Toggle checked={translucentSidebar} onChange={setTranslucentSidebar} label="Enable translucent sidebar" />
          </SettingRow>

          <SettingRow title="Contrast" description="Adjust visual separation between surfaces.">
            <div className="slider-container">
              <input 
                aria-label="Contrast adjustment"
                type="range" 
                min="0" 
                max="100" 
                value={contrast} 
                onChange={(e) => setContrast(Number(e.target.value))} 
                className="slider"
              />
              <span className="slider-value" aria-hidden="true">{contrast}</span>
            </div>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="Interactive and sizing preferences."
          title="Interaction"
        >
          <SettingRow title="Pointer cursor" description="Use pointing hand cursor for interactive elements.">
            <Toggle checked={usePointerCursor} onChange={setUsePointerCursor} label="Use pointer cursor" />
          </SettingRow>

          <SettingRow title="UI font size" description="Base font size for the Codex UI.">
            <div className="number-input-group">
              <input 
                aria-label="UI font size"
                type="number" 
                className="field field--sm" 
                value={uiFontSize} 
                onChange={(e) => setUiFontSize(Number(e.target.value))} 
              />
              <span className="unit" aria-hidden="true">px</span>
            </div>
          </SettingRow>

          <SettingRow title="Code font size" description="Base font size for code editors and diffs.">
            <div className="number-input-group">
              <input 
                aria-label="Code font size"
                type="number" 
                className="field field--sm" 
                value={codeFontSize} 
                onChange={(e) => setCodeFontSize(Number(e.target.value))} 
              />
              <span className="unit" aria-hidden="true">px</span>
            </div>
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
      <input 
        aria-label={ariaLabel}
        className="field color-field" 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
      />
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean, onChange: (val: boolean) => void, label: string }) {
  return (
    <label className="toggle-switch">
      <input 
        type="checkbox" 
        checked={checked} 
        onChange={(e) => onChange(e.target.checked)} 
        aria-label={label}
      />
      <span className="toggle-slider"></span>
    </label>
  )
}
