import { describe, expect, it } from 'vitest'

import {
  decodeBase64,
  fileChanges,
  itemPreview,
  planSteps,
  reasoningContent,
  reasoningSummary,
  userMessageText,
} from '../src/components/thread/threadRender'

describe('threadRender helpers', () => {
  it('extracts user message text from content items', () => {
    const text = userMessageText({
      content: [
        { type: 'text', text: 'first line' },
        { type: 'text', text: 'second line' },
      ],
    })

    expect(text).toBe('first line\nsecond line')
  })

  it('parses plan text into separate steps', () => {
    expect(
      planSteps({
        text: '1. inspect repo\n2. implement fix\n- verify output',
      }),
    ).toEqual(['inspect repo', 'implement fix', 'verify output'])
  })

  it('returns reasoning summary and content arrays', () => {
    expect(reasoningSummary({ summary: ['s1', 's2'] })).toEqual(['s1', 's2'])
    expect(reasoningContent({ content: ['c1'] })).toEqual(['c1'])
  })

  it('formats file changes and preview text', () => {
    const changes = fileChanges({
      changes: [
        {
          path: 'src/app.ts',
          diff: '+hello',
          kind: { type: 'update' },
        },
      ],
    })

    expect(changes).toEqual([
      {
        path: 'src/app.ts',
        diff: '+hello',
        kind: 'update',
      },
    ])

    expect(
      itemPreview({
        type: 'fileChange',
        changes: [
          {
            path: 'src/app.ts',
            diff: '+hello',
            kind: { type: 'update' },
          },
        ],
      }),
    ).toBe('update: src/app.ts')
  })

  it('decodes base64 output through window.atob', () => {
    const atob = (value: string) => Buffer.from(value, 'base64').toString('binary')
    ;(globalThis as { window?: { atob: (value: string) => string } }).window = { atob }

    expect(decodeBase64('aGVsbG8=')).toBe('hello')
  })
})
