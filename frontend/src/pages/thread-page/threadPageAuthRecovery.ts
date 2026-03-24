export type SuppressAuthenticationErrorAfterRecoveryInput = {
  authRecoveryRequestedAt: number | null
  latestAccountResultAt: number
  accountStatus?: string
}

export function shouldSuppressAuthenticationErrorAfterRecovery(
  input: SuppressAuthenticationErrorAfterRecoveryInput,
) {
  const { accountStatus, authRecoveryRequestedAt, latestAccountResultAt } = input

  if (authRecoveryRequestedAt === null) {
    return false
  }

  if (latestAccountResultAt < authRecoveryRequestedAt) {
    return true
  }

  return accountStatus === 'requires_openai_auth'
}
