import { describe, expect, it } from 'vitest'

import { getCompletedCommandOutputDelta } from './command-output'

describe('getCompletedCommandOutputDelta', () => {
  it('returns an empty delta when completion output was already streamed', () => {
    const streamed = 'first line\r\n\r\nsecond line\r\n'

    expect(getCompletedCommandOutputDelta(streamed, streamed)).toBe('')
  })

  it('returns only the missing completion tail when the stream ended early', () => {
    expect(getCompletedCommandOutputDelta('line 1\r\n', 'line 1\r\nline 2\r\n')).toBe('line 2\r\n')
  })

  it('keeps overlap handling stable across chunk boundaries', () => {
    expect(getCompletedCommandOutputDelta('abc123', '123xyz')).toBe('xyz')
  })

  it('falls back to the full completion output when no overlap exists', () => {
    expect(getCompletedCommandOutputDelta('stderr only', 'stdout only')).toBe('stdout only')
  })
})
