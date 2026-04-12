import { describe, expect, it } from 'vitest'

import { ApiClientError } from './api-client'
import { describeError, getErrorMessage, isAuthenticationError } from './error-utils'

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

  it('remaps known Telegram validation codes to friendlier messages', () => {
    const error = new ApiClientError('validation_error: telegram media file path must be absolute: relative/file.png', {
      code: 'telegram_media_path_must_be_absolute',
      status: 400,
    })

    expect(getErrorMessage(error)).toBe('Telegram attachments must use an absolute local file path.')
    expect(describeError(error).message).toBe('Telegram attachments must use an absolute local file path.')
  })

  it('returns an empty string when no error object exists', () => {
    expect(getErrorMessage(undefined)).toBe('')
    expect(getErrorMessage(null)).toBe('')
  })

  it('detects authentication errors from common upstream wording', () => {
    expect(isAuthenticationError(new Error('OpenAI authentication is required.'))).toBe(true)
  })

  it('falls back to upstream message for unknown runtime failures', () => {
    const error = new ApiClientError('json-rpc error -32000: upstream exploded', {
      code: 'upstream_error',
      status: 502,
    })

    expect(getErrorMessage(error)).toContain('upstream exploded')
  })

  it('keeps raw backend messages for unknown validation codes', () => {
    const error = new ApiClientError('telegram media file path must be a file', {
      code: 'validation_error',
      status: 400,
    })

    expect(getErrorMessage(error)).toBe('telegram media file path must be a file')
  })
})
