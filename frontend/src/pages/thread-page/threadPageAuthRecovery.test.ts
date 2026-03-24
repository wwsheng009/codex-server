import { describe, expect, it } from 'vitest'

import { shouldSuppressAuthenticationErrorAfterRecovery } from './threadPageAuthRecovery'

describe('shouldSuppressAuthenticationErrorAfterRecovery', () => {
  it('keeps suppression while the refreshed account result still reports auth required', () => {
    expect(
      shouldSuppressAuthenticationErrorAfterRecovery({
        authRecoveryRequestedAt: 200,
        latestAccountResultAt: 250,
        accountStatus: 'requires_openai_auth',
      }),
    ).toBe(true)
  })

  it('keeps suppression until a newer account result arrives', () => {
    expect(
      shouldSuppressAuthenticationErrorAfterRecovery({
        authRecoveryRequestedAt: 200,
        latestAccountResultAt: 150,
        accountStatus: 'connected',
      }),
    ).toBe(true)
  })

  it('stops suppression once a newer non-auth account result arrives', () => {
    expect(
      shouldSuppressAuthenticationErrorAfterRecovery({
        authRecoveryRequestedAt: 200,
        latestAccountResultAt: 250,
        accountStatus: 'connected',
      }),
    ).toBe(false)
  })
})
