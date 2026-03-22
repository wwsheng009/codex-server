import type { BuildComposerPanelFlagsInput } from './threadPageComposerPanelTypes'

export function buildComposerPanelFlags({
  composerAutocompleteItemsLength,
  fileSearchIsFetching,
  isMentionAutocompleteOpen,
  isSkillAutocompleteOpen,
  normalizedDeferredComposerQuery,
  skillsIsFetching,
}: BuildComposerPanelFlagsInput) {
  return {
    showMentionSearchHint:
      isMentionAutocompleteOpen &&
      !normalizedDeferredComposerQuery &&
      !fileSearchIsFetching &&
      !composerAutocompleteItemsLength,
    showSkillSearchLoading:
      isSkillAutocompleteOpen && skillsIsFetching && !composerAutocompleteItemsLength,
  }
}
