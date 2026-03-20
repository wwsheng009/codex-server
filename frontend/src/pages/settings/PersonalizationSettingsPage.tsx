import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { useSettingsLocalStore } from '../../features/settings/local-store'

export function PersonalizationSettingsPage() {
  const responseTone = useSettingsLocalStore((state) => state.responseTone)
  const customInstructions = useSettingsLocalStore((state) => state.customInstructions)
  const setResponseTone = useSettingsLocalStore((state) => state.setResponseTone)
  const setCustomInstructions = useSettingsLocalStore((state) => state.setCustomInstructions)

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Store local response preferences and instruction text that shape how the client should feel when you start new work."
        meta={<span className="meta-pill">{responseTone}</span>}
        title="Personalization"
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description="Local instruction defaults for future multi-page personalization work."
          title="Response Preferences"
        >
          <SettingRow
            description="Choose the default response tone you want the client to bias toward."
            title="Response Tone"
          >
            <label className="field">
              <span>Tone</span>
              <select
                value={responseTone}
                onChange={(event) =>
                  setResponseTone(event.target.value as 'balanced' | 'direct' | 'detailed')
                }
              >
                <option value="balanced">Balanced</option>
                <option value="direct">Direct</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
          </SettingRow>

          <SettingRow
            description="Add instructions that should appear as your personal preference baseline for future settings-aware workflows."
            title="Custom Instructions"
          >
            <label className="field">
              <span>Instructions</span>
              <textarea
                className="ide-textarea ide-textarea--large"
                onChange={(event) => setCustomInstructions(event.target.value)}
                value={customInstructions}
              />
            </label>
            <div className="notice">Saved locally in this client.</div>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
