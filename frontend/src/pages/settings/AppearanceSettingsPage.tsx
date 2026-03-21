import { ThreadMarkdown } from '../../components/thread/ThreadContent'
import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import {
  appearanceThemeOptions,
  colorThemeOptions,
  getAppearancePaletteLabel,
  getAppearanceThemeLabel,
  getMessageSurfaceLabel,
  getThreadSpacingLabel,
  getUserMessageEmphasisLabel,
  messageSurfaceOptions,
  resolveAppearanceTheme,
  threadSpacingOptions,
  userMessageEmphasisOptions,
} from '../../features/settings/appearance'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { useSystemAppearancePreferences } from '../../features/settings/useSystemAppearancePreferences'

export function AppearanceSettingsPage() {
  const theme = useSettingsLocalStore((state) => state.theme)
  const density = useSettingsLocalStore((state) => state.density)
  const reduceMotion = useSettingsLocalStore((state) => state.reduceMotion)
  const accentTone = useSettingsLocalStore((state) => state.accentTone)
  const threadSpacing = useSettingsLocalStore((state) => state.threadSpacing)
  const messageSurface = useSettingsLocalStore((state) => state.messageSurface)
  const userMessageEmphasis = useSettingsLocalStore((state) => state.userMessageEmphasis)
  const setTheme = useSettingsLocalStore((state) => state.setTheme)
  const setDensity = useSettingsLocalStore((state) => state.setDensity)
  const setReduceMotion = useSettingsLocalStore((state) => state.setReduceMotion)
  const setAccentTone = useSettingsLocalStore((state) => state.setAccentTone)
  const setThreadSpacing = useSettingsLocalStore((state) => state.setThreadSpacing)
  const setMessageSurface = useSettingsLocalStore((state) => state.setMessageSurface)
  const setUserMessageEmphasis = useSettingsLocalStore((state) => state.setUserMessageEmphasis)
  const { prefersDark } = useSystemAppearancePreferences()
  const resolvedTheme = resolveAppearanceTheme(theme, prefersDark)
  const activePaletteLabel = getAppearancePaletteLabel(accentTone, resolvedTheme)

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Tune the shell palette, coding-oriented themes, and thread reading comfort without changing the underlying information architecture."
        meta={
          <>
            <span className="meta-pill">{getAppearanceThemeLabel(theme)}</span>
            <span className="meta-pill">{activePaletteLabel}</span>
            <span className="meta-pill">{getThreadSpacingLabel(threadSpacing)}</span>
            <span className="meta-pill">{getMessageSurfaceLabel(messageSurface)}</span>
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
          description="Fine-tune how the thread stream reads, especially during longer coding sessions."
          title="Thread Reading"
        >
          <SettingRow
            description="Control how tightly messages stack in the main thread stream."
            meta={getThreadSpacingLabel(threadSpacing)}
            title="Thread Rhythm"
          >
            <AppearanceOptionGrid
              onChange={setThreadSpacing}
              options={threadSpacingOptions}
              value={threadSpacing}
            />
          </SettingRow>

          <SettingRow
            description="Choose how much background and padding sits behind thread messages."
            meta={getMessageSurfaceLabel(messageSurface)}
            title="Message Surface"
          >
            <AppearanceOptionGrid
              onChange={setMessageSurface}
              options={messageSurfaceOptions}
              value={messageSurface}
            />
          </SettingRow>

          <SettingRow
            description="Decide how distinctly user prompts are tinted relative to assistant replies."
            meta={getUserMessageEmphasisLabel(userMessageEmphasis)}
            title="User Message Emphasis"
          >
            <AppearanceOptionGrid
              onChange={setUserMessageEmphasis}
              options={userMessageEmphasisOptions}
              value={userMessageEmphasis}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="A lightweight preview block so appearance settings are not blind form changes."
          title="Preview"
        >
          <div className="appearance-preview-stack">
            <div className="settings-preview">
              <div className="settings-preview__card">
                <span>Theme Mode</span>
                <strong>{getAppearanceThemeLabel(theme)}</strong>
              </div>
              <div className="settings-preview__card">
                <span>Active Palette</span>
                <strong>{activePaletteLabel}</strong>
              </div>
              <div className="settings-preview__card">
                <span>Density</span>
                <strong>{density}</strong>
              </div>
              <div className="settings-preview__card">
                <span>Thread Rhythm</span>
                <strong>{getThreadSpacingLabel(threadSpacing)}</strong>
              </div>
              <div className="settings-preview__card">
                <span>Surface</span>
                <strong>{getMessageSurfaceLabel(messageSurface)}</strong>
              </div>
              <div className="settings-preview__card">
                <span>Motion</span>
                <strong>{reduceMotion ? 'Reduced' : 'Standard'}</strong>
              </div>
            </div>

            <div className="appearance-thread-preview">
              <div className="appearance-thread-preview__header">
                <div className="appearance-thread-preview__copy">
                  <strong>{activePaletteLabel}</strong>
                  <span>
                    {getThreadSpacingLabel(threadSpacing)} rhythm · {getMessageSurfaceLabel(messageSurface)} surfaces
                    {' · '}
                    {getUserMessageEmphasisLabel(userMessageEmphasis)} user emphasis
                  </span>
                </div>
                <span className="meta-pill">{reduceMotion ? 'Reduced motion' : 'Standard motion'}</span>
              </div>

              <div className="appearance-thread-preview__stream">
                <article className="conversation-row conversation-row--assistant">
                  <div className="conversation-bubble conversation-bubble--assistant">
                    <div className="conversation-bubble__content">
                      <ThreadMarkdown content={'Previewing a calmer coding thread:\n\n- tighter reading rhythm\n- softer message surfaces\n- lower visual noise around text'} />
                    </div>
                  </div>
                </article>

                <article className="conversation-row conversation-row--user">
                  <div className="conversation-bubble conversation-bubble--user">
                    <div className="conversation-bubble__content">
                      <ThreadMarkdown content={'Keep the text first, weaken my prompt background a bit more, and add `Solarized Light` / `Solarized Dark`.'} />
                    </div>
                  </div>
                </article>

                <div className="thread-pending-state thread-pending-state--waiting appearance-thread-preview__status">
                  <span aria-hidden="true" className="thread-pending-state__spinner" />
                  <div className="thread-pending-state__copy">
                    <strong>Generating preview…</strong>
                    <span>The live thread surface follows the controls above immediately.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </SettingsGroup>
      </div>
    </section>
  )
}

function AppearanceOptionGrid<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { value: T; label: string; description: string }[]
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div className="appearance-choice-grid">
      {options.map((option) => (
        <button
          key={option.value}
          aria-pressed={value === option.value}
          className={value === option.value ? 'appearance-choice appearance-choice--active' : 'appearance-choice'}
          onClick={() => onChange(option.value)}
          type="button"
        >
          <strong>{option.label}</strong>
          <span>{option.description}</span>
        </button>
      ))}
    </div>
  )
}
