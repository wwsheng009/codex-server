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
    expect(summary?.actionKind).toBe('restart-and-retry')
    expect(summary?.actionTitle).toBe('Restart runtime before retrying')
    expect(summary?.actionSummary).toContain('Recycle the workspace runtime')
    expect(summary?.categoryLabel).toBe('Runtime process exit')
    expect(summary?.recoveryActionLabel).toBe('Restart runtime, then retry')
    expect(summary?.retryable).toBe(true)
    expect(summary?.requiresRecycle).toBe(true)
    expect(summary?.description).toContain('Last error: runtime exited unexpectedly')
    expect(summary?.details).toContain('Recent stderr:')
    expect(summary?.details).toContain('exit status 23')
  })

  it('maps fix-config and retry recovery actions into structured action metadata', () => {
    const fixConfigSummary = buildWorkspaceRuntimeRecoverySummary({
      workspaceId: 'ws-fix',
      status: 'error',
      command: 'codex app-server --listen stdio://',
      rootPath: 'E:/projects/ai/codex-server',
      lastError: 'missing sandbox policy',
      lastErrorCategory: 'configuration',
      lastErrorRecoveryAction: 'fix-launch-config',
      lastErrorRetryable: false,
      lastErrorRequiresRuntimeRecycle: false,
      recentStderr: ['invalid shell_environment_policy'],
      updatedAt: '2026-04-13T00:00:00.000Z',
      configLoadStatus: 'loaded',
      restartRequired: false,
    })
    const retrySummary = buildWorkspaceRuntimeRecoverySummary({
      workspaceId: 'ws-retry',
      status: 'running',
      command: 'codex app-server --listen stdio://',
      rootPath: 'E:/projects/ai/codex-server',
      lastError: 'temporary transport interruption',
      lastErrorCategory: 'transport',
      lastErrorRecoveryAction: 'retry',
      lastErrorRetryable: true,
      lastErrorRequiresRuntimeRecycle: false,
      recentStderr: [],
      updatedAt: '2026-04-13T00:00:00.000Z',
      configLoadStatus: 'loaded',
      restartRequired: false,
    })

    expect(fixConfigSummary?.actionKind).toBe('fix-config')
    expect(fixConfigSummary?.actionTitle).toBe(
      'Review launch configuration before restarting',
    )
    expect(fixConfigSummary?.actionSummary).toContain(
      'Fix the workspace launch settings first',
    )

    expect(retrySummary?.actionKind).toBe('retry')
    expect(retrySummary?.actionTitle).toBe('Retry the failed operation')
    expect(retrySummary?.actionSummary).toContain(
      'retry without forcing a full recycle first',
    )
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
