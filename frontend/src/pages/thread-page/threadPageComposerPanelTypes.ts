import type { CatalogItem } from '../../types/api'
import type { ComposerAutocompleteMode } from '../../lib/composer-autocomplete-types'
import type {
  ComposerCommandDefinition,
  ComposerCommandMenu,
  ComposerPreferences,
  ModelOption,
} from './threadPageComposerShared'

export type ThreadPageComposerPanelStateInput = {
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
}

export type BuildComposerAvailableModelsInput = {
  composerPreferences: ComposerPreferences
  models: CatalogItem[]
}

export type BuildComposerPanelFlagsInput = {
  composerAutocompleteItemsLength: number
  fileSearchIsFetching: boolean
  isMentionAutocompleteOpen: boolean
  isSkillAutocompleteOpen: boolean
  normalizedDeferredComposerQuery: string
  skillsIsFetching: boolean
}

export type BuildComposerPreferenceOptionsInput = {
  availableModels: ModelOption[]
  supportsPlanMode: boolean
}
