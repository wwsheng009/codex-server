import { i18n } from '../../i18n/runtime'
import type { BuildComposerPreferenceOptionsInput } from './threadPageComposerPanelTypes'

export function buildComposerPreferenceOptions({
  availableModels,
  supportsPlanMode,
}: BuildComposerPreferenceOptionsInput) {
  return {
    desktopModelOptions: [
      {
        value: '',
        label: i18n._({ id: 'Follow default model', message: 'Follow default model' }),
        triggerLabel: i18n._({ id: 'Default', message: 'Default' }),
      },
      ...availableModels.map((model) => ({
        value: model.value,
        label: model.label,
        triggerLabel: model.triggerLabel,
      })),
    ],
    mobileCollaborationModeOptions: [
      {
        value: 'default',
        label: i18n._({ id: 'Default mode', message: 'Default mode' }),
        triggerLabel: i18n._({ id: 'Mode', message: 'Mode' }),
      },
      {
        value: 'plan',
        label: i18n._({ id: 'Plan mode', message: 'Plan mode' }),
        triggerLabel: 'Plan',
        disabled: !supportsPlanMode,
      },
    ],
    mobileModelOptions: [
      {
        value: '',
        label: i18n._({ id: 'Default model', message: 'Default model' }),
        triggerLabel: i18n._({ id: 'Model', message: 'Model' }),
      },
      ...availableModels.map((model) => ({
        value: model.value,
        label: model.label,
        triggerLabel: model.triggerLabel,
      })),
    ],
    mobilePermissionOptions: [
      {
        value: 'default',
        label: i18n._({ id: 'Default permission', message: 'Default permission' }),
        triggerLabel: i18n._({ id: 'Permission', message: 'Permission' }),
      },
      {
        value: 'full-access',
        label: i18n._({ id: 'Full access', message: 'Full access' }),
        triggerLabel: i18n._({ id: 'Full', message: 'Full' }),
      },
    ],
    mobileReasoningOptions: [
      { value: 'low', label: i18n._({ id: 'Low', message: 'Low' }) },
      { value: 'medium', label: i18n._({ id: 'Medium', message: 'Medium' }) },
      { value: 'high', label: i18n._({ id: 'High', message: 'High' }) },
      { value: 'xhigh', label: i18n._({ id: 'Max', message: 'Max' }) },
    ],
  }
}
