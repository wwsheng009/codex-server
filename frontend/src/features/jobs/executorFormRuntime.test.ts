import { beforeAll, describe, expect, it } from 'vitest'

import { activateLocale } from '../../i18n/runtime'
import type { JobExecutorFormField } from './executorFormRuntime'
import {
  executorFieldUsesWorkspaceAutomationCatalog,
  executorFieldUsesWorkspaceModelCatalog,
  readExecutorFieldDataSourceKind,
  validateExecutorFormPayload,
} from './executorFormRuntime'

describe('executor form runtime', () => {
  beforeAll(async () => {
    await activateLocale('en')
  })

  it('reads datasource metadata for workspace-backed fields', () => {
    const field: JobExecutorFormField = {
      purpose: 'model',
      kind: 'text',
      payloadKey: 'model',
      dataSource: {
        kind: 'workspace_models',
        allowCustomValue: true,
      },
    }

    expect(readExecutorFieldDataSourceKind(field)).toBe('workspace_models')
    expect(executorFieldUsesWorkspaceModelCatalog(field)).toBe(true)
  })

  it('allows automation fallback source references but rejects placeholder automation ids', () => {
    const field: JobExecutorFormField = {
      purpose: 'automationRef',
      kind: 'select',
      payloadKey: 'automationId',
      required: true,
      dataSource: {
        kind: 'workspace_automations',
      },
      validation: {
        allowSourceRefFallback: true,
        disallowedPattern: '^auto[_-]?0*1$',
        disallowedPatternFlags: 'i',
      },
    }

    expect(executorFieldUsesWorkspaceAutomationCatalog(field)).toBe(true)
    expect(validateExecutorFormPayload({}, [field], { fallbackSourceRefId: 'auto_live_123' })).toBe('')
    expect(validateExecutorFormPayload({ automationId: 'auto_001' }, [field])).toContain('sample automation reference')
  })

  it('validates relative workspace paths and integer-only numeric fields', () => {
    const workdirField: JobExecutorFormField = {
      purpose: 'workdir',
      kind: 'text',
      payloadKey: 'workdir',
      validation: {
        relativeWorkspacePath: true,
      },
    }
    const timeoutField: JobExecutorFormField = {
      purpose: 'timeoutSec',
      kind: 'number',
      payloadKey: 'timeoutSec',
      min: 1,
      max: 3600,
      validation: {
        integerOnly: true,
      },
    }

    expect(validateExecutorFormPayload({ workdir: '../outside' }, [workdirField])).toContain('relative workspace path')
    expect(validateExecutorFormPayload({ timeoutSec: 12.5 }, [timeoutField])).toContain('use integers')
  })
})
