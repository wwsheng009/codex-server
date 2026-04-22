import { afterEach, describe, expect, it, vi } from 'vitest'

function createJsonResponse<T>(data: T) {
  return new Response(JSON.stringify({ data }), {
    headers: {
      'Content-Type': 'application/json',
    },
    status: 200,
  })
}

function stubBrowserWindow(url: string) {
  const location = new URL(url)

  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    location: {
      host: location.host,
      hostname: location.hostname,
      origin: location.origin,
      protocol: location.protocol,
    },
  })
}

async function loadApiClient(options?: {
  apiBaseUrl?: string
  browserUrl?: string
}) {
  vi.resetModules()

  if (options && 'apiBaseUrl' in options) {
    vi.stubEnv('VITE_API_BASE_URL', options.apiBaseUrl ?? '')
  }

  if (options?.browserUrl) {
    stubBrowserWindow(options.browserUrl)
  }

  return import('./api-client')
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('api-client', () => {
  it('defaults browser requests to same-origin api paths', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const { API_BASE_URL, apiRequest, buildApiWebSocketUrl } = await loadApiClient({
      browserUrl: 'https://codex.example.com/workspaces',
    })

    expect(API_BASE_URL).toBe('')

    await expect(apiRequest<{ ok: boolean }>('/api/workspaces')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
    expect(buildApiWebSocketUrl('/api/workspaces/ws-1/stream')).toBe(
      'wss://codex.example.com/api/workspaces/ws-1/stream',
    )
  })

  it('uses an explicit absolute api base url for fetch and websocket requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const { API_BASE_URL, apiRequest, buildApiWebSocketUrl } = await loadApiClient({
      apiBaseUrl: 'http://localhost:18080/',
    })

    expect(API_BASE_URL).toBe('http://localhost:18080')

    await expect(apiRequest<{ ok: boolean }>('/api/workspaces')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:18080/api/workspaces',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
    expect(buildApiWebSocketUrl('/api/workspaces/ws-1/stream')).toBe(
      'ws://localhost:18080/api/workspaces/ws-1/stream',
    )
  })

  it('avoids duplicating the api prefix when the configured base already ends with /api', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const { apiRequest, buildApiWebSocketUrl } = await loadApiClient({
      apiBaseUrl: 'https://api.example.com/api/',
    })

    await expect(apiRequest<{ ok: boolean }>('/api/workspaces')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/workspaces',
      expect.objectContaining({
        credentials: 'include',
      }),
    )
    expect(buildApiWebSocketUrl('/api/workspaces/ws-1/stream')).toBe(
      'wss://api.example.com/api/workspaces/ws-1/stream',
    )
  })
})
