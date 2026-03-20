export function decodeBase64(value: string) {
  try {
    const binary = window.atob(value)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return value
  }
}

const ANSI_ESCAPE_PATTERN = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/

export function containsAnsiEscapeCode(value: string) {
  return ANSI_ESCAPE_PATTERN.test(value)
}

export function safeJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2) ?? '—'
  } catch {
    return String(value)
  }
}
