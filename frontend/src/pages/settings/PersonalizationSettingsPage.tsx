import { SettingsGroup, SettingRow, SettingsPageHeader } from '../../components/settings/SettingsPrimitives'
import { SelectControl } from '../../components/ui/SelectControl'
import { useSettingsLocalStore } from '../../features/settings/local-store'
import { TextArea } from '../../components/ui/TextArea'
import { i18n } from '../../i18n/runtime'

export function PersonalizationSettingsPage() {
  const responseTone = useSettingsLocalStore((state) => state.responseTone)
  const customInstructions = useSettingsLocalStore((state) => state.customInstructions)
  const setResponseTone = useSettingsLocalStore((state) => state.setResponseTone)
  const setCustomInstructions = useSettingsLocalStore((state) => state.setCustomInstructions)
  const responseToneLabel =
    responseTone === 'direct'
      ? i18n._({ id: 'Direct', message: 'Direct' })
      : responseTone === 'detailed'
        ? i18n._({ id: 'Detailed', message: 'Detailed' })
        : i18n._({ id: 'Balanced', message: 'Balanced' })

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Store local response preferences and instruction text that shape how the client should feel when you start new work.',
          message:
            'Store local response preferences and instruction text that shape how the client should feel when you start new work.',
        })}
        meta={<span className="meta-pill">{responseToneLabel}</span>}
        title={i18n._({ id: 'Personalization', message: 'Personalization' })}
      />

      <div className="settings-page__stack">
        <SettingsGroup
          description={i18n._({
            id: 'Local instruction defaults for future multi-page personalization work.',
            message: 'Local instruction defaults for future multi-page personalization work.',
          })}
          title={i18n._({ id: 'Response Preferences', message: 'Response Preferences' })}
        >
          <SettingRow
            description={i18n._({
              id: 'Choose the default response tone you want the client to bias toward.',
              message: 'Choose the default response tone you want the client to bias toward.',
            })}
            title={i18n._({ id: 'Response Tone', message: 'Response Tone' })}
          >
            <label className="field">
              <span>{i18n._({ id: 'Tone', message: 'Tone' })}</span>
              <SelectControl
                ariaLabel={i18n._({ id: 'Response tone', message: 'Response tone' })}
                fullWidth
                onChange={(nextValue) =>
                  setResponseTone(nextValue as 'balanced' | 'direct' | 'detailed')
                }
                options={[
                  { value: 'balanced', label: i18n._({ id: 'Balanced', message: 'Balanced' }) },
                  { value: 'direct', label: i18n._({ id: 'Direct', message: 'Direct' }) },
                  { value: 'detailed', label: i18n._({ id: 'Detailed', message: 'Detailed' }) },
                ]}
                value={responseTone}
              />
            </label>
          </SettingRow>
<SettingRow
  description={i18n._({
    id: 'Add instructions that should appear as your personal preference baseline for future settings-aware workflows.',
    message:
      'Add instructions that should appear as your personal preference baseline for future settings-aware workflows.',
  })}
  title={i18n._({ id: 'Custom Instructions', message: 'Custom Instructions' })}
>
  <TextArea
    label={i18n._({ id: 'Instructions', message: 'Instructions' })}
    onChange={(event) => setCustomInstructions(event.target.value)}
    value={customInstructions}
    rows={6}
  />
  <div className="notice">
...
              {i18n._({
                id: 'Saved locally in this client.',
                message: 'Saved locally in this client.',
              })}
            </div>
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}
