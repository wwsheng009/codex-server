import { describe, expect, it } from 'vitest'

import {
  createBlankAccessTokenDraft,
  createGeneratedAccessTokenDraft,
  formatGeneratedAccessTokenValue,
  shouldShowFirstAccessTokenGuide,
} from './tokenDrafts'

describe('access token draft helpers', () => {
  it('returns an empty permanent draft for manual entry', () => {
    expect(createBlankAccessTokenDraft()).toEqual({
      label: '',
      token: '',
      expiresAt: '',
      permanent: true,
      revealToken: false,
    })
  })

  it('formats generated token bytes into the expected prefixed value', () => {
    expect(
      formatGeneratedAccessTokenValue(
        new Uint8Array([0, 1, 2, 15, 16, 17, 254, 255]),
      ),
    ).toBe('cxs_0001020f1011feff')
  })

  it('creates a generated draft with a visible token value', () => {
    expect(
      createGeneratedAccessTokenDraft(
        new Uint8Array([0, 1, 2, 15, 16, 17, 254, 255]),
      ),
    ).toEqual({
      label: '',
      token: 'cxs_0001020f1011feff',
      expiresAt: '',
      permanent: true,
      revealToken: true,
    })
  })

  it('only shows the first-time guide when no configured or draft tokens exist', () => {
    expect(
      shouldShowFirstAccessTokenGuide({
        configuredTokenCount: 0,
        draftCount: 0,
      }),
    ).toBe(true)

    expect(
      shouldShowFirstAccessTokenGuide({
        configuredTokenCount: 1,
        draftCount: 0,
      }),
    ).toBe(false)

    expect(
      shouldShowFirstAccessTokenGuide({
        configuredTokenCount: 0,
        draftCount: 1,
      }),
    ).toBe(false)
  })
})
