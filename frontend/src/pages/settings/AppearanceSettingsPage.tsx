import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import {
  appearanceThemeOptions,
  colorThemeOptions,
  getAppearanceThemeLabel,
  getColorThemeLabel,
} from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'

export function AppearanceSettingsPage() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const density = useSettingsLocalStore((state) => state.density)
  const reduceMotion = useSettingsLocalStore((state) => state.reduceMotion)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const setTheme = useSettingsLocalStore((state) => state.setTheme)
  const setDensity = useSettingsLocalStore((state) => state.setDensity)
  const setReduceMotion = useSettingsLocalStore((state) => state.setReduceMotion)
  const setAccentTone = useSettingsLocalStore((state) => state.setAccentTone)

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Tune the visual density and reading comfort of the desktop shell without changing the core information architecture."
        meta={
          <>
            <span className="meta-pill">{getAppearanceThemeLabel(theme)}</span>
            <span className="meta-pill">{getColorThemeLabel(accentTone)}</span>
            <span className="meta-pill">{density}</span>
          </>
        }
        title="Appearance"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Local-only visual preferences for the current client."
          title="Display"
        >
          <SettingRow
            description="Choose whether the shell follows the OS, stays bright, or switches to a darker workbench."
            title="Theme Mode"
          >
            <div className="segmented-control">
              {appearanceThemeOptions.map((option) => (
                <button
                  key={option.value}
                  className={theme === option.value ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                  onClick={() => setTheme(option.value)}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
          </SettingRow>

          <SettingRow
            description="Shift the shell palette, surfaces, and accent color without changing the information architecture."
            title="Color Theme"
          >
            <div className="theme-swatch-grid">
              {colorThemeOptions.map((option) => (
                <button
                  key={option.value}
                  aria-pressed={accentTone === option.value}
                  className={accentTone === option.value ? 'theme-swatch theme-swatch--active' : 'theme-swatch'}
                  onClick={() => setAccentTone(option.value)}
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
          </SettingRow>

          <SettingRow
            description="Reduce visual density when you want more breathing room in settings and directory pages."
            title="Density"
          >
            <div className="segmented-control">
              <button
                className={density === 'comfortable' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                onClick={() => setDensity('comfortable')}
                type="button"
              >
                Comfortable
              </button>
              <button
                className={density === 'compact' ? 'segmented-control__item segmented-control__item--active' : 'segmented-control__item'}
                onClick={() => setDensity('compact')}
                type="button"
              >
                Compact
              </button>
            </div>
          </SettingRow>

          <SettingRow
            description="Respect reduced motion preferences for loaders and interactive transitions."
            title="Motion"
          >
            <label className="field field--inline">
              <span>Reduce Motion</span>
              <input
                checked={reduceMotion}
                onChange={(event) => setReduceMotion(event.target.checked)}
                type="checkbox"
              />
            </label>
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="A lightweight preview block so appearance settings are not blind form changes."
          title="Preview"
        >
          <div className="settings-preview">
            <div className="settings-preview__card">
              <span>Theme Mode</span>
              <strong>{getAppearanceThemeLabel(theme)}</strong>
            </div>
            <div className="settings-preview__card">
              <span>Color Theme</span>
              <strong>{getColorThemeLabel(accentTone)}</strong>
            </div>
            <div className="settings-preview__card">
              <span>Density</span>
              <strong>{density}</strong>
            </div>
            <div className="settings-preview__card">
              <span>Motion</span>
              <strong>{reduceMotion ? 'Reduced' : 'Standard'}</strong>
            </div>
          </div>
        </SettingsGroup>
      </div>
    </section>
  )
}
