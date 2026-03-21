import type { ApiResponse } from '../types/api'

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? defaultApiBaseUrl()
).replace(/\/$/, '')

export class ApiClientError extends Error {
  code?: string
  status: number

  constructor(message: string, options: { code?: string; status: number }) {
    super(message)
    this.name = 'ApiClientError'
    this.code = options.code
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
    throw new ApiClientError(payload?.error?.message ?? `Request failed with status ${response.status}`, {
      code: payload?.error?.code ?? undefined,
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
