import { describe, expect, it } from 'vitest'

import { describeRouteError } from './route-error'

describe('describeRouteError', () => {
  it('maps route error responses into clear 404 copy', () => {
    const description = describeRouteError({
      data: 'Workspace missing',
      internal: true,
      status: 404,
      statusText: 'Not Found',
    })

    expect(description.code).toBe('HTTP 404')
    expect(description.title).toBe('This screen could not be found')
    expect(description.message).toContain('Workspace missing')
  })

  it('treats runtime crashes as render failures', () => {
    const description = describeRouteError(new Error('Cannot read properties of undefined'))

    expect(description.code).toBe('Error')
    expect(description.title).toBe('This screen crashed while rendering')
    expect(description.details).toContain('Cannot read properties of undefined')
  })

  it('detects dynamic import failures and recommends a reload', () => {
    const error = new Error('Failed to fetch dynamically imported module')
    error.name = 'ChunkLoadError'

    const description = describeRouteError(error)

    expect(description.title).toBe('Part of the app failed to load')
    expect(description.recovery).toContain('Reload this route')
  })

  it('captures nested runtime details for debugging', () => {
    const error = new Error('Workspace render failed') as Error & {
      cause?: unknown
      context?: { workspaceId: string; tab: string }
    }

    error.cause = new TypeError('Missing thread state')
    error.context = { workspaceId: 'ws-123', tab: 'logs' }

    const description = describeRouteError(error)

    expect(description.details).toContain('Cause:')
    expect(description.details).toContain('Missing thread state')
    expect(description.details).toContain('Metadata:')
    expect(description.details).toContain('workspaceId')
    expect(description.details).toContain('Stack:')
  })
})
