import { ApiClientError } from './api-client'

export type UserFacingError = {
  code: string
  title: string
  message: string
}

export function describeError(error: unknown, fallback = 'An unexpected error occurred.') {
  const message = readErrorMessage(error)
  const code = inferErrorCode(error, message)

  switch (code) {
    case 'requires_openai_auth':
      return {
        code,
        title: 'Authentication Required',
        message:
          'Authentication is required before Codex can continue. Reconnect the account or update the API key in Settings → General.',
      } satisfies UserFacingError
    case 'network_error':
      return {
        code,
        title: 'Connection Failed',
        message:
          'Unable to reach the backend service. Check that codex-server is running and the network connection is healthy.',
      } satisfies UserFacingError
    case 'runtime_not_configured':
      return {
        code,
        title: 'Runtime Not Configured',
        message:
          'The runtime is not configured for this workspace yet. Re-open the workspace or verify the backend runtime setup.',
      } satisfies UserFacingError
    case 'workspace_not_found':
      return {
        code,
        title: 'Workspace Missing',
        message: 'The selected workspace could not be found. Refresh the workspace list and try again.',
      } satisfies UserFacingError
    case 'thread_not_found':
      return {
        code,
        title: 'Thread Missing',
        message:
          'The selected thread is no longer available. Refresh the thread list or create a new thread before continuing.',
      } satisfies UserFacingError
    case 'approval_not_found':
      return {
        code,
        title: 'Approval Missing',
        message:
          'The approval request is no longer available. Refresh the approvals list and review the current pending items.',
      } satisfies UserFacingError
    case 'server_request_not_found':
      return {
        code,
        title: 'Request Expired',
        message:
          'The pending server request is no longer valid. Refresh the page and retry the action if it is still needed.',
      } satisfies UserFacingError
    case 'no_active_turn':
      return {
        code,
        title: 'No Active Turn',
        message:
          'There is no active turn to interrupt or steer right now. Start a new message first or wait for the current work to finish.',
      } satisfies UserFacingError
    case 'invalid_response':
      return {
        code,
        title: 'Invalid Server Response',
        message:
          'The backend returned an unexpected response. Retry once, and if it happens again inspect the backend logs for protocol mismatches.',
      } satisfies UserFacingError
    case 'validation_error':
    case 'bad_request':
      return {
        code,
        title: 'Invalid Request',
        message: message || fallback,
      } satisfies UserFacingError
    case 'upstream_error':
      return {
        code,
        title: 'Runtime Error',
        message:
          message ||
          'The Codex runtime failed to complete the request. Check account status, runtime logs, and upstream provider settings before retrying.',
      } satisfies UserFacingError
    default:
      return {
        code,
        title: 'Unexpected Error',
        message: message || fallback,
      } satisfies UserFacingError
  }
}

export function getErrorMessage(error: unknown, fallback?: string) {
  const rawMessage = readErrorMessage(error).trim()
  if (rawMessage) {
    return rawMessage
  }

  return describeError(error, fallback).message
}

export function isAuthenticationError(error: unknown) {
  return describeError(error).code === 'requires_openai_auth'
}

function inferErrorCode(error: unknown, message: string) {
  if (error instanceof ApiClientError && error.code) {
    return error.code
  }

  const normalized = message.toLowerCase()
  if (
    normalized.includes('invalid_api_key') ||
    normalized.includes('authentication required') ||
    normalized.includes('requires openai auth') ||
    (normalized.includes('401 unauthorized') &&
      (normalized.includes('api key') || normalized.includes('openai') || normalized.includes('auth')))
  ) {
    return 'requires_openai_auth'
  }

  if (
    normalized.includes('failed to fetch') ||
    normalized.includes('network request failed') ||
    normalized.includes('networkerror') ||
    normalized.includes('load failed')
  ) {
    return 'network_error'
  }

  if (normalized.includes('invalid response payload') || normalized.includes('invalid response')) {
    return 'invalid_response'
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
