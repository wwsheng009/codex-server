import { describe, expect, it } from 'vitest'

import { ApiClientError } from './api-client'
import { describeError, getErrorMessage } from './error-utils'

describe('error-utils', () => {
  it('keeps backend error titles generic instead of remapping them', () => {
    const error = new ApiClientError('OpenAI authentication is required.', {
      code: 'requires_openai_auth',
      status: 401,
    })

    expect(describeError(error).title).toBe('Error')
    expect(describeError(error).message).toBe('OpenAI authentication is required.')
  })

  it('returns the raw error message when one exists', () => {
    expect(getErrorMessage(new Error('Failed to fetch'))).toBe('Failed to fetch')
  })

  it('falls back to upstream message for unknown runtime failures', () => {
    const error = new ApiClientError('json-rpc error -32000: upstream exploded', {
      code: 'upstream_error',
      status: 502,
    })

    expect(getErrorMessage(error)).toContain('upstream exploded')
  })
})
