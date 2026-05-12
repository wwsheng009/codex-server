import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getThread, listThreadsPage } from './api'

function mockJsonResponse(data: unknown) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
    },
    json: vi.fn().mockResolvedValue({ data }),
  } as unknown as Response
}

describe('threads api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockJsonResponse({})))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('passes preferCached=false when loading a thread detail snapshot', async () => {
    await getThread('ws-1', 'thread-1', {
      contentMode: 'summary',
      preferCached: false,
      turnLimit: 20,
    })

    const requestUrl = vi.mocked(fetch).mock.calls[0]?.[0]
    expect(typeof requestUrl).toBe('string')

    const url = new URL(requestUrl as string)
    expect(url.pathname).toBe('/api/workspaces/ws-1/threads/thread-1')
    expect(url.searchParams.get('contentMode')).toBe('summary')
    expect(url.searchParams.get('preferCached')).toBe('false')
    expect(url.searchParams.get('turnLimit')).toBe('20')
  })

  it('passes preferCached=false when loading a thread list page', async () => {
    await listThreadsPage('ws-1', {
      archived: false,
      limit: 8,
      preferCached: false,
      sortKey: 'created_at',
    })

    const requestUrl = vi.mocked(fetch).mock.calls[0]?.[0]
    expect(typeof requestUrl).toBe('string')

    const url = new URL(requestUrl as string)
    expect(url.pathname).toBe('/api/workspaces/ws-1/threads')
    expect(url.searchParams.get('archived')).toBe('false')
    expect(url.searchParams.get('limit')).toBe('8')
    expect(url.searchParams.get('preferCached')).toBe('false')
    expect(url.searchParams.get('sortKey')).toBe('created_at')
  })
})
