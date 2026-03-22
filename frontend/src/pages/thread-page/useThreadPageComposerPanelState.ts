import { useMemo } from 'react'

import { getActiveLocale } from '../../i18n/runtime'
import { buildComposerAvailableModels } from './buildComposerAvailableModels'
import { buildComposerPanelFlags } from './buildComposerPanelFlags'
import { buildComposerPreferenceOptions } from './buildComposerPreferenceOptions'
import { normalizeComposerFileSearchItem } from '../../lib/composer-autocomplete'
import { useThreadComposerAutocomplete } from './useThreadComposerAutocomplete'
import { normalizeMcpServerState } from './threadPageComposerShared'
import type { ThreadPageComposerPanelStateInput } from './threadPageComposerPanelTypes'

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
}: ThreadPageComposerPanelStateInput) {
  const activeLocale = getActiveLocale()
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

  const availableModels = useMemo(
    () => buildComposerAvailableModels({ composerPreferences, models }),
    [composerPreferences, models],
  )
  const preferenceOptions = useMemo(
    () => buildComposerPreferenceOptions({ availableModels, supportsPlanMode }),
    [activeLocale, availableModels, supportsPlanMode],
  )
  const panelFlags = useMemo(
    () =>
      buildComposerPanelFlags({
        composerAutocompleteItemsLength: composerAutocompleteItems.length,
        fileSearchIsFetching,
        isMentionAutocompleteOpen,
        isSkillAutocompleteOpen,
        normalizedDeferredComposerQuery,
        skillsIsFetching,
      }),
    [
      composerAutocompleteItems.length,
      fileSearchIsFetching,
      isMentionAutocompleteOpen,
      isSkillAutocompleteOpen,
      normalizedDeferredComposerQuery,
      skillsIsFetching,
    ],
  )

  return {
    composerAutocompleteItem,
    composerAutocompleteItems,
    composerAutocompleteSectionGroups,
    desktopModelOptions: preferenceOptions.desktopModelOptions,
    mcpServerStates,
    mobileCollaborationModeOptions: preferenceOptions.mobileCollaborationModeOptions,
    mobileModelOptions: preferenceOptions.mobileModelOptions,
    mobilePermissionOptions: preferenceOptions.mobilePermissionOptions,
    mobileReasoningOptions: preferenceOptions.mobileReasoningOptions,
    showMentionSearchHint: panelFlags.showMentionSearchHint,
    showSkillSearchLoading: panelFlags.showSkillSearchLoading,
  }
}
