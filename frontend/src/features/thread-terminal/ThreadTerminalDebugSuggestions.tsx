import type {
  ThreadTerminalDebugSuggestionsState
} from './threadTerminalStressStateTypes'

export function ThreadTerminalDebugSuggestions({
  debugSuggestions,
}: ThreadTerminalDebugSuggestionsState) {
  if (!debugSuggestions.length) {
    return null
  }

  return debugSuggestions.map((suggestion) => (
    <span className="terminal-dock__debug-suggestion" key={suggestion}>
      {suggestion}
    </span>
  ))
}
