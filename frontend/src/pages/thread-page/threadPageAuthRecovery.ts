export function shouldSuppressAuthenticationErrorAfterRecovery(input: {
  authRecoveryRequestedAt: number | null
  latestAccountResultAt: number
  accountStatus?: string
}) {
  const { accountStatus, authRecoveryRequestedAt, latestAccountResultAt } = input

  if (authRecoveryRequestedAt === null) {
    return false
  }

  if (latestAccountResultAt < authRecoveryRequestedAt) {
    return true
  }

  return accountStatus === 'requires_openai_auth'
}
