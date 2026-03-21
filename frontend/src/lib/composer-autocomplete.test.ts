import { describe, expect, it } from 'vitest'

import {
  buildComposerAutocompleteKey,
  getComposerAutocompleteMatch,
  normalizeComposerFileSearchItem,
  replaceComposerAutocompleteToken,
} from './composer-autocomplete'

describe('getComposerAutocompleteMatch', () => {
  it('detects slash commands at the caret', () => {
    expect(getComposerAutocompleteMatch('/sta', 4)).toEqual({
      mode: 'command',
      query: 'sta',
      tokenStart: 0,
      tokenEnd: 4,
    })
  })

  it('detects mentions after whitespace', () => {
    expect(getComposerAutocompleteMatch('look at @src', 12)).toEqual({
      mode: 'mention',
      query: 'src',
      tokenStart: 8,
      tokenEnd: 12,
    })
  })

  it('detects skill triggers after whitespace', () => {
    expect(getComposerAutocompleteMatch('use $ui-ux', 10)).toEqual({
      mode: 'skill',
      query: 'ui-ux',
      tokenStart: 4,
      tokenEnd: 10,
    })
  })

  it('ignores regular words without triggers', () => {
    expect(getComposerAutocompleteMatch('review changes', 14)).toBeNull()
  })
})

describe('replaceComposerAutocompleteToken', () => {
  it('replaces the active token and returns the next caret', () => {
    const match = getComposerAutocompleteMatch('check @thr', 10)
    expect(match).not.toBeNull()
    expect(replaceComposerAutocompleteToken('check @thr', match!, '@thread.tsx ')).toEqual({
      value: 'check @thread.tsx ',
      caret: 18,
    })
  })
})

describe('buildComposerAutocompleteKey', () => {
  it('builds a stable key for dismiss state', () => {
    const match = getComposerAutocompleteMatch('/review', 7)
    expect(buildComposerAutocompleteKey(match)).toBe('command:0:7:review')
  })
})

describe('normalizeComposerFileSearchItem', () => {
  it('normalizes file search results with windows paths', () => {
    expect(
      normalizeComposerFileSearchItem({
        path: 'frontend\\src\\pages\\ThreadPage.tsx',
      }),
    ).toEqual({
      path: 'frontend/src/pages/ThreadPage.tsx',
      name: 'ThreadPage.tsx',
      directory: 'frontend/src/pages',
    })
  })
})
