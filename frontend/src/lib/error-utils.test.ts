import { describe, expect, it } from 'vitest'

import { ApiClientError } from './api-client'
import { describeError, getBotOutboundErrorMessage, getErrorMessage, isAuthenticationError } from './error-utils'

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

  it('remaps WeChat reply context failures to a clearer outbound guidance message', () => {
    const error = new Error(
      'WeChat delivery failed during outbound send: wechat sendmessage text failed (chars=2 preview="11"): wechat /ilink/bot/sendmessage returned api error (ret=-2 errcode=0): reply context unavailable',
    )

    expect(getBotOutboundErrorMessage(error)).toBe(
      'WeChat cannot send this proactive message yet because the saved reply context is no longer valid. Ask the recipient to send a new message to this bot first, then try again.',
    )
  })

  it('remaps WeChat waiting-for-context validation failures to the same outbound guidance message', () => {
    const error = new Error(
      'invalid input: wechat recipient "wxid_alice" has not established a sendable reply context yet; wait for the user to send a message first',
    )

    expect(getBotOutboundErrorMessage(error)).toBe(
      'WeChat cannot send this proactive message yet because the saved reply context is no longer valid. Ask the recipient to send a new message to this bot first, then try again.',
    )
  })
})
