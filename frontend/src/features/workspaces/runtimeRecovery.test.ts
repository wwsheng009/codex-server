import { beforeAll, describe, expect, it } from 'vitest'

import { i18n } from '../../i18n/runtime'
import {
  buildWorkspaceRuntimeRecoverySummary,
  formatRuntimeErrorCategoryLabel,
  formatRuntimeRecoveryActionLabel,
} from './runtimeRecovery'

describe('runtimeRecovery', () => {
  beforeAll(() => {
    i18n.loadAndActivate({ locale: 'en', messages: {} })
  })

  it('formats known runtime error categories and recovery actions', () => {
    expect(formatRuntimeErrorCategoryLabel('process_exit')).toBe('Runtime process exit')
    expect(formatRuntimeErrorCategoryLabel('configuration')).toBe('Launch configuration')
    expect(formatRuntimeRecoveryActionLabel('retry-after-restart')).toBe(
      'Restart runtime, then retry',
    )
    expect(formatRuntimeRecoveryActionLabel('fix-launch-config')).toBe(
      'Fix launch config',
    )
  })

  it('builds recovery guidance with details when diagnostics are present', () => {
    const summary = buildWorkspaceRuntimeRecoverySummary({
      workspaceId: 'ws-1',
      status: 'error',
      command: 'codex app-server --listen stdio://',
      rootPath: 'E:/projects/ai/codex-server',
      lastError: 'runtime exited unexpectedly',
      lastErrorCategory: 'process_exit',
      lastErrorRecoveryAction: 'retry-after-restart',
      lastErrorRetryable: true,
      lastErrorRequiresRuntimeRecycle: true,
      recentStderr: ['runtime exited unexpectedly', 'exit status 23'],
      updatedAt: '2026-04-13T00:00:00.000Z',
      configLoadStatus: 'loaded',
      restartRequired: false,
    })

    expect(summary).not.toBeNull()
    expect(summary?.title).toBe('Runtime Recovery Guidance')
    expect(summary?.tone).toBe('error')
    expect(summary?.categoryLabel).toBe('Runtime process exit')
    expect(summary?.recoveryActionLabel).toBe('Restart runtime, then retry')
    expect(summary?.retryable).toBe(true)
    expect(summary?.requiresRecycle).toBe(true)
    expect(summary?.description).toContain('Last error: runtime exited unexpectedly')
    expect(summary?.details).toContain('Recent stderr:')
    expect(summary?.details).toContain('exit status 23')
  })

  it('returns null when no recovery signals are available', () => {
    expect(
      buildWorkspaceRuntimeRecoverySummary({
        workspaceId: 'ws-1',
        status: 'ready',
        command: 'codex app-server --listen stdio://',
        rootPath: 'E:/projects/ai/codex-server',
        lastErrorRetryable: false,
        lastErrorRequiresRuntimeRecycle: false,
        updatedAt: '2026-04-13T00:00:00.000Z',
        configLoadStatus: 'loaded',
        restartRequired: false,
      }),
    ).toBeNull()
  })
})
