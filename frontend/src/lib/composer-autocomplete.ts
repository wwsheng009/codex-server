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

export function getComposerAutocompleteMatch(
  value: string,
  caret: number,
): ComposerAutocompleteMatch | null {
  const safeCaret = clamp(caret, 0, value.length)
  let tokenStart = safeCaret

  while (tokenStart > 0 && !isWhitespace(value[tokenStart - 1])) {
    tokenStart -= 1
  }

  const token = value.slice(tokenStart, safeCaret)
  if (token.length < 1) {
    return null
  }

  if (token.startsWith('/')) {
    if (token.length > 1 && token.slice(1).includes('/')) {
      return null
    }

    return {
      mode: 'command',
      query: token.slice(1),
      tokenStart,
      tokenEnd: safeCaret,
    }
  }

  if (token.startsWith('@')) {
    if (token.length > 1 && token.slice(1).includes('@')) {
      return null
    }

    return {
      mode: 'mention',
      query: token.slice(1),
      tokenStart,
      tokenEnd: safeCaret,
    }
  }

  if (token.startsWith('$')) {
    if (token.length > 1 && token.slice(1).includes('$')) {
      return null
    }

    return {
      mode: 'skill',
      query: token.slice(1),
      tokenStart,
      tokenEnd: safeCaret,
    }
  }

  return null
}

export function replaceComposerAutocompleteToken(
  value: string,
  match: ComposerAutocompleteMatch,
  replacement: string,
) {
  const nextValue =
    value.slice(0, match.tokenStart) + replacement + value.slice(match.tokenEnd)

  return {
    value: nextValue,
    caret: match.tokenStart + replacement.length,
  }
}

export function buildComposerAutocompleteKey(
  match: ComposerAutocompleteMatch | null,
) {
  if (!match) {
    return null
  }

  return `${match.mode}:${match.tokenStart}:${match.tokenEnd}:${match.query}`
}

export function normalizeComposerFileSearchItem(
  entry: Record<string, unknown>,
): NormalizedComposerFileSearchItem | null {
  const path =
    stringField(entry.path) ||
    stringField(entry.relativePath) ||
    stringField(entry.filePath) ||
    stringField(entry.uri) ||
    stringField(entry.name)

  if (!path) {
    return null
  }

  const normalizedPath = path.replaceAll('\\', '/')
  const providedName = stringField(entry.baseName) || stringField(entry.name)
  const name = providedName || normalizedPath.split('/').filter(Boolean).pop() || normalizedPath
  const providedDirectory =
    stringField(entry.directory) ||
    stringField(entry.dir) ||
    stringField(entry.parentPath)

  const directory =
    providedDirectory ||
    normalizedPath.slice(0, Math.max(0, normalizedPath.length - name.length)).replace(/\/$/, '')

  return {
    path: normalizedPath,
    name,
    directory,
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function isWhitespace(value: string | undefined) {
  return value === undefined || /\s/.test(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}
