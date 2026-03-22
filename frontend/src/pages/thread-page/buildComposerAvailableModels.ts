import type { ModelOption } from './threadPageComposerShared'
import { FALLBACK_MODEL_OPTIONS } from './threadPageComposerShared'
import type { BuildComposerAvailableModelsInput } from './threadPageComposerPanelTypes'

export function buildComposerAvailableModels({
  composerPreferences,
  models,
}: BuildComposerAvailableModelsInput): ModelOption[] {
  const options = new Map<string, ModelOption>()

  const registerModel = (value: string, label?: string) => {
    const trimmedValue = value.trim()
    if (!trimmedValue || options.has(trimmedValue)) {
      return
    }

    const trimmedLabel = label?.trim() || trimmedValue
    options.set(trimmedValue, {
      value: trimmedValue,
      label: trimmedLabel,
      triggerLabel: trimmedLabel,
    })
  }

  registerModel(composerPreferences.model)

  for (const item of models) {
    registerModel(item.value ?? item.id ?? item.name, item.name)
  }

  for (const fallbackModel of FALLBACK_MODEL_OPTIONS) {
    registerModel(fallbackModel)
  }

  return Array.from(options.values())
}
