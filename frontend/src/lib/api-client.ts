import type { ApiResponse } from '../types/api'

const API_PATH_PREFIX = '/api'

export const API_BASE_URL = resolveApiBaseUrl()
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
    response = await fetch(buildApiUrl(path), {
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
  const webSocketBaseUrl = buildWebSocketBaseUrl(API_BASE_URL)
  if (webSocketBaseUrl) {
    return joinApiBasePath(webSocketBaseUrl, path)
  }

  return `${currentWebSocketOrigin()}${normalizeApiPath(path)}`
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

function resolveApiBaseUrl() {
  const configuredBaseUrl = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)
  if (configuredBaseUrl !== null) {
    return configuredBaseUrl
  }

  return defaultApiBaseUrl()
}

function normalizeApiBaseUrl(value: string | undefined) {
  if (value === undefined) {
    return null
  }

  return value.trim().replace(/\/$/, '')
}

function buildApiUrl(path: string) {
  return joinApiBasePath(API_BASE_URL, path)
}

function joinApiBasePath(baseUrl: string, path: string) {
  const normalizedPath = normalizeApiPath(path)
  if (!baseUrl) {
    return normalizedPath
  }

  if (baseUrl.endsWith(API_PATH_PREFIX) && isApiPath(normalizedPath)) {
    return `${baseUrl}${normalizedPath.slice(API_PATH_PREFIX.length)}`
  }

  return `${baseUrl}${normalizedPath}`
}

function normalizeApiPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`
}

function isApiPath(path: string) {
  return path === API_PATH_PREFIX || path.startsWith(`${API_PATH_PREFIX}/`)
}

function buildWebSocketBaseUrl(baseUrl: string) {
  if (!baseUrl) {
    return ''
  }

  if (baseUrl.startsWith('http://') || baseUrl.startsWith('https://')) {
    return baseUrl.replace(/^http/, 'ws')
  }

  if (baseUrl.startsWith('/')) {
    return `${currentWebSocketOrigin()}${baseUrl}`
  }

  return baseUrl
}

function currentWebSocketOrigin() {
  if (typeof window === 'undefined') {
    return 'ws://localhost:18080'
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}`
}

function defaultApiBaseUrl() {
  if (typeof window === 'undefined') {
    return 'http://localhost:18080'
  }

  return ''
}
