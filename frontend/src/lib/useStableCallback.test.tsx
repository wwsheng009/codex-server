// @vitest-environment jsdom

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useStableCallback } from './useStableCallback'

describe('useStableCallback', () => {
  it('keeps the callback identity stable while calling the latest implementation', () => {
    const initialCallback = vi.fn((value: string) => `initial:${value}`)
    const nextCallback = vi.fn((value: string) => `next:${value}`)

    const { result, rerender } = renderHook(
      ({ callback }: { callback: (value: string) => string }) =>
        useStableCallback(callback),
      {
        initialProps: {
          callback: initialCallback,
        },
      },
    )

    const stableCallback = result.current
    expect(stableCallback('alpha')).toBe('initial:alpha')
    expect(initialCallback).toHaveBeenCalledWith('alpha')

    rerender({ callback: nextCallback })

    expect(result.current).toBe(stableCallback)
    expect(result.current('beta')).toBe('next:beta')
    expect(nextCallback).toHaveBeenCalledWith('beta')
  })
})
