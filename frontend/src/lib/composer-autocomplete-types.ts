export type ComposerAutocompleteMode = 'command' | 'mention' | 'skill'

export type ComposerAutocompleteMatch = {
  mode: ComposerAutocompleteMode
  query: string
  tokenStart: number
  tokenEnd: number
}

export type NormalizedComposerFileSearchItem = {
  path: string
  name: string
  directory: string
}
