import { ApiClientError } from './api-client'
import type { UserFacingError } from './errorUtilsTypes'
export type { UserFacingError } from './errorUtilsTypes'

export function describeError(error: unknown, fallback = 'An unexpected error occurred.') {
  const code = readErrorCode(error)
  const message = friendlyErrorMessageForCode(code) || readErrorMessage(error).trim()

  return {
    code,
    title: 'Error',
    message: message || fallback,
  } satisfies UserFacingError
}

export function getErrorMessage(error: unknown, fallback?: string) {
  if (error == null) {
    return fallback ?? ''
  }

  const friendlyMessage = friendlyErrorMessageForCode(readErrorCode(error))
  if (friendlyMessage) {
    return friendlyMessage
  }

  const rawMessage = readErrorMessage(error).trim()
  if (rawMessage) {
    return rawMessage
  }

  return describeError(error, fallback).message
}

export function isAuthenticationError(error: unknown) {
  const code = readErrorCode(error)
  if (code === 'requires_openai_auth') {
    return true
  }

  const message = readErrorMessage(error).toLowerCase()
  return (
    message.includes('invalid_api_key') ||
    message.includes('authentication required') ||
    message.includes('authentication is required') ||
    message.includes('requires openai auth') ||
    (message.includes('401 unauthorized') &&
      (message.includes('api key') || message.includes('openai') || message.includes('auth')))
  )
}

function readErrorCode(error: unknown) {
  if (error instanceof ApiClientError && error.code) {
    return error.code
  }

  return 'unknown_error'
}

function readErrorMessage(error: unknown) {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return ''
}

function friendlyErrorMessageForCode(code: string) {
  switch (code) {
    case 'telegram_streaming_media_updates_not_supported':
      return 'Telegram attachments can only be sent in the final completed reply. Streaming updates must stay text-only.'
    case 'telegram_media_path_must_be_absolute':
      return 'Telegram attachments must use an absolute local file path.'
    case 'telegram_media_source_required':
      return 'Telegram attachments need either a remote HTTP(S) URL or an absolute local file path.'
    case 'telegram_media_url_invalid':
      return 'Telegram attachments must use an absolute HTTP or HTTPS URL.'
    default:
      return ''
  }
}
