import { ApiClientError } from './api-client'
import type { UserFacingError } from './errorUtilsTypes'
export type { UserFacingError } from './errorUtilsTypes'

export function describeError(error: unknown, fallback = 'An unexpected error occurred.') {
  const message = readErrorMessage(error).trim()

  return {
    code: readErrorCode(error),
    title: 'Error',
    message: message || fallback,
  } satisfies UserFacingError
}

export function getErrorMessage(error: unknown, fallback?: string) {
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
