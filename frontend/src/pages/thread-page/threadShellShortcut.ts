export function parseBangShellCommandShortcut(input: string) {
  const trimmed = input.trim()
  if (!trimmed.startsWith('!') || trimmed.includes('\n')) {
    return ''
  }

  return trimmed.slice(1).trim()
}
