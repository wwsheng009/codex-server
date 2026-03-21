import { useMemo } from 'react'

import {
  normalizeComposerFileSearchItem,
  type ComposerAutocompleteMode,
} from '../../lib/composer-autocomplete'
import type { CatalogItem } from '../../types/api'
import { useThreadComposerAutocomplete } from './useThreadComposerAutocomplete'
import {
  FALLBACK_MODEL_OPTIONS,
  normalizeMcpServerState,
  type ComposerCommandDefinition,
  type ComposerCommandMenu,
  type ComposerPreferences,
  type ModelOption,
} from './threadPageComposerShared'

export function useThreadPageComposerPanelState({
  activeComposerMatchMode,
  composerAutocompleteIndex,
  composerCommandDefinitions,
  composerCommandMenu,
  composerPreferences,
  fileSearchFiles,
  fileSearchIsFetching,
  isCommandAutocompleteOpen,
  isMentionAutocompleteOpen,
  isSkillAutocompleteOpen,
  mcpServerStatusEntries,
  models,
  normalizedDeferredComposerQuery,
  setComposerAutocompleteIndex,
  skills,
  skillsIsFetching,
  supportsPlanMode,
}: {
  activeComposerMatchMode?: ComposerAutocompleteMode
  composerAutocompleteIndex: number
  composerCommandDefinitions: ComposerCommandDefinition[]
  composerCommandMenu: ComposerCommandMenu
  composerPreferences: ComposerPreferences
  fileSearchFiles?: Record<string, unknown>[]
  fileSearchIsFetching: boolean
  isCommandAutocompleteOpen: boolean
  isMentionAutocompleteOpen: boolean
  isSkillAutocompleteOpen: boolean
  mcpServerStatusEntries?: Record<string, unknown>[]
  models: CatalogItem[]
  normalizedDeferredComposerQuery: string
  setComposerAutocompleteIndex: (value: number | ((current: number) => number)) => void
  skills: CatalogItem[]
  skillsIsFetching: boolean
  supportsPlanMode: boolean
}) {
  const normalizedMentionFiles = useMemo(
    () =>
      (fileSearchFiles ?? [])
        .map((entry) => normalizeComposerFileSearchItem(entry))
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [fileSearchFiles],
  )

  const {
    composerAutocompleteItem,
    composerAutocompleteItems,
    composerAutocompleteSectionGroups,
  } = useThreadComposerAutocomplete({
    activeComposerMode: activeComposerMatchMode,
    commandDefinitions: composerCommandDefinitions,
    commandMenu: composerCommandMenu,
    composerAutocompleteIndex,
    isCommandAutocompleteOpen,
    isMentionAutocompleteOpen,
    isSkillAutocompleteOpen,
    mentionFiles: normalizedMentionFiles,
    query: normalizedDeferredComposerQuery,
    setComposerAutocompleteIndex,
    skills,
  })

  const mcpServerStates = useMemo(
    () => (mcpServerStatusEntries ?? []).map((entry) => normalizeMcpServerState(entry)),
    [mcpServerStatusEntries],
  )

  const showMentionSearchHint =
    isMentionAutocompleteOpen &&
    !normalizedDeferredComposerQuery &&
    !fileSearchIsFetching &&
    !composerAutocompleteItems.length
  const showSkillSearchLoading =
    isSkillAutocompleteOpen && skillsIsFetching && !composerAutocompleteItems.length

  const availableModels = useMemo<ModelOption[]>(() => {
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
  }, [composerPreferences.model, models])

  const mobileCollaborationModeOptions = useMemo(
    () => [
      { value: 'default', label: '默认模式', triggerLabel: '模式' },
      { value: 'plan', label: 'Plan 模式', triggerLabel: 'Plan', disabled: !supportsPlanMode },
    ],
    [supportsPlanMode],
  )

  const mobilePermissionOptions = useMemo(
    () => [
      { value: 'default', label: '默认权限', triggerLabel: '权限' },
      { value: 'full-access', label: '完全访问', triggerLabel: '全开' },
    ],
    [],
  )

  const mobileModelOptions = useMemo(
    () => [
      { value: '', label: '默认模型', triggerLabel: '模型' },
      ...availableModels.map((model) => ({
        value: model.value,
        label: model.label,
        triggerLabel: model.triggerLabel,
      })),
    ],
    [availableModels],
  )

  const desktopModelOptions = useMemo(
    () => [
      { value: '', label: '跟随默认模型', triggerLabel: '默认' },
      ...availableModels.map((model) => ({
        value: model.value,
        label: model.label,
        triggerLabel: model.triggerLabel,
      })),
    ],
    [availableModels],
  )

  const mobileReasoningOptions = useMemo(
    () => [
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' },
      { value: 'xhigh', label: '超' },
    ],
    [],
  )

  return {
    composerAutocompleteItem,
    composerAutocompleteItems,
    composerAutocompleteSectionGroups,
    desktopModelOptions,
    mcpServerStates,
    mobileCollaborationModeOptions,
    mobileModelOptions,
    mobilePermissionOptions,
    mobileReasoningOptions,
    showMentionSearchHint,
    showSkillSearchLoading,
  }
}
