export type AccessTokenDraftSeed = {
  label: string
  token: string
  expiresAt: string
  permanent: boolean
  revealToken: boolean
}

import { i18n } from '../../i18n/runtime'

const accessTokenPrefix = 'cxs_'
const accessTokenRandomByteLength = 24

export function createBlankAccessTokenDraft(): AccessTokenDraftSeed {
  return {
    label: '',
    token: '',
    expiresAt: '',
    permanent: true,
    revealToken: false,
  }
}

export function createGeneratedAccessTokenDraft(
  randomBytes: Uint8Array = createSecureRandomBytes(accessTokenRandomByteLength),
): AccessTokenDraftSeed {
  return {
    ...createBlankAccessTokenDraft(),
    token: formatGeneratedAccessTokenValue(randomBytes),
    revealToken: true,
  }
}

export function shouldShowFirstAccessTokenGuide(input: {
  configuredTokenCount: number
  draftCount: number
}) {
  return input.configuredTokenCount === 0 && input.draftCount === 0
}

export function formatGeneratedAccessTokenValue(randomBytes: Uint8Array) {
  return accessTokenPrefix + Array.from(randomBytes, (value) => value.toString(16).padStart(2, '0')).join('')
}

function createSecureRandomBytes(length: number) {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error(i18n._({ id: 'Secure token generation requires Web Crypto support in the browser.', message: 'Secure token generation requires Web Crypto support in the browser.' }))
  }

  return crypto.getRandomValues(new Uint8Array(length))
}
