import type {
  BuildThreadTerminalSearchBarStateInput,
  ThreadTerminalSearchBarState
} from './threadTerminalConsoleStateTypes'

export function buildThreadTerminalSearchBarState(
  input: BuildThreadTerminalSearchBarStateInput,
): ThreadTerminalSearchBarState | null {
  if (!input.search.isOpen || input.launcher.isOpen) {
    return null
  }

  return {
    feedback: input.search.feedback,
    onChangeQuery: input.search.setQuery,
    onClose: input.search.close,
    onSearchNext: input.search.searchNext,
    onSearchPrevious: input.search.searchPrevious,
    query: input.search.query,
  }
}
