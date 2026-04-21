import type { ApiResponse } from '../types/api'

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl()
).replace(/\/$/, '')
export const ACCESS_UNAUTHORIZED_EVENT = 'codex-server-access-unauthorized'

const ACCESS_UNAUTHORIZED_CODES = new Set([
  'access_login_required',
  'access_session_invalid',
])

export class ApiClientError extends Error {
  code?: string
  details?: Record<string, unknown>
  status: number

  constructor(message: string, options: { code?: string; status: number; details?: Record<string, unknown> }) {
    super(message)
    this.name = 'ApiClientError'
    this.code = options.code
    this.details = options.details
    this.status = options.status
  }
}

export function isApiClientErrorCode(error: unknown, code: string) {
  return error instanceof ApiClientError && error.code === code
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  const hasBody = init?.body !== undefined && init.body !== null

  if (hasBody && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      credentials: init?.credentials ?? 'include',
      headers,
    })
  } catch (error) {
    throw new ApiClientError(error instanceof Error ? error.message : 'Failed to fetch', {
      code: 'network_error',
      status: 0,
    })
  }

  const payload = await readApiResponse<T>(response)

  if (!response.ok) {
    if (
      response.status === 401 &&
      payload?.error?.code &&
      ACCESS_UNAUTHORIZED_CODES.has(payload.error.code) &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(
        new CustomEvent(ACCESS_UNAUTHORIZED_EVENT, {
          detail: { code: payload.error.code },
        }),
      )
    }

    throw new ApiClientError(payload?.error?.message ?? `Request failed with status ${response.status}`, {
      code: payload?.error?.code ?? undefined,
      details: payload?.error && typeof payload.error === 'object' ? payload.error : undefined,
      status: response.status,
    })
  }

  if (!payload || !('data' in payload)) {
    throw new ApiClientError('Request succeeded but returned an invalid response payload', {
      status: response.status,
    })
  }

  return payload.data
}

export function buildApiWebSocketUrl(path: string) {
  if (API_BASE_URL) {
    return `${API_BASE_URL.replace(/^http/, 'ws')}${path}`
  }

  if (typeof window === 'undefined') {
    return `ws://localhost:18080${path}`
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${path}`
}

async function readApiResponse<T>(response: Response) {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) {
    return null
  }

  const payload = (await response.json().catch(() => null)) as unknown
  return isApiResponse<T>(payload) ? payload : null
}

function isApiResponse<T>(value: unknown): value is ApiResponse<T> {
  return typeof value === 'object' && value !== null && ('data' in value || 'error' in value)
}

function defaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://localhost:18080'
  }

  return `${window.location.protocol}//${window.location.hostname}:18080`
}
