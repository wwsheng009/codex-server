import { describe, expect, it, vi } from 'vitest'

describe('threadConversationProfiler module initialization', () => {
  it('imports without an active locale', async () => {
    vi.resetModules()

    const { i18n } = await import('../../i18n/runtime')

    expect(i18n.locale || '').toBe('')
    await expect(import('./threadConversationProfiler')).resolves.toMatchObject({
      buildConversationRenderProfilerSnapshot: expect.any(Function),
    })
  })
})
