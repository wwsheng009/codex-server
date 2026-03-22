import type { CatalogItem } from '../../types/api'
import type {
  ComposerAutocompleteMode,
} from '../../lib/composer-autocomplete'
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

export type BuildComposerAvailableModelsInput = Pick<
  ThreadPageComposerPanelStateInput,
  'composerPreferences' | 'models'
>

export type BuildComposerPanelFlagsInput = Pick<
  ThreadPageComposerPanelStateInput,
  | 'fileSearchIsFetching'
  | 'isMentionAutocompleteOpen'
  | 'isSkillAutocompleteOpen'
  | 'normalizedDeferredComposerQuery'
  | 'skillsIsFetching'
> & {
  composerAutocompleteItemsLength: number
}

export type BuildComposerPreferenceOptionsInput = {
  availableModels: ModelOption[]
  supportsPlanMode: boolean
}
