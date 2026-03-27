import { describe, expect, it } from 'vitest'

import { parseBangShellCommandShortcut } from './threadShellShortcut'

describe('parseBangShellCommandShortcut', () => {
  it('returns a shell command for bang-prefixed single-line input', () => {
    expect(parseBangShellCommandShortcut('!pwd')).toBe('pwd')
    expect(parseBangShellCommandShortcut(' !   git status  ')).toBe('git status')
  })

  it('ignores plain chat input and incomplete bang commands', () => {
    expect(parseBangShellCommandShortcut('hello world')).toBe('')
    expect(parseBangShellCommandShortcut('!')).toBe('')
  })

  it('rejects multiline bang input so normal turns keep handling complex prompts', () => {
    expect(parseBangShellCommandShortcut('!echo hello\nworld')).toBe('')
  })
})
