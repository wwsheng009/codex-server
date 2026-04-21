import { beforeAll, describe, expect, it } from 'vitest'

import { ApiClientError } from '../../lib/api-client'
import { activateLocale } from '../../i18n/runtime'
import { getJobFailurePresentation, isAutomationRunPlaceholderAutomationId, isBackgroundJobRunRetryable } from './errorPresentation'

describe('jobs error presentation', () => {
  beforeAll(async () => {
    await activateLocale('en')
  })

  it('maps automation missing failures to a clearer guidance message', () => {
    const presentation = getJobFailurePresentation({
      error: 'automation not found',
      errorCode: 'automation_not_found',
      resourceId: 'auto_live_123',
    })

    expect(presentation.message).toContain('Automation target "auto_live_123" could not be found')
    expect(isBackgroundJobRunRetryable({
      error: 'automation not found',
      errorCode: 'automation_not_found',
      resourceId: 'auto_live_123',
    })).toBe(false)
  })

  it('maps missing automation target configuration to a task-oriented message', () => {
    const presentation = getJobFailurePresentation({
      errorCode: 'automation_run_reference_required',
      error: 'automation_run jobs require automationId or sourceRefId',
    })

    expect(presentation.message).toBe('Choose which Automation this job should run before saving or retrying.')
  })

  it('maps conflicting automation targets to a clearer guidance message', () => {
    const presentation = getJobFailurePresentation({
      errorCode: 'automation_run_reference_mismatch',
      error: 'automation_run job sourceRefId must match payload automationId',
    })

    expect(presentation.message).toBe(
      'This job has conflicting Automation targets. Keep only one Automation target selected, then save again.',
    )
  })

  it('prefers structured API error details when retryability is provided', () => {
    const error = new ApiClientError('Request failed', {
      code: 'validation_error',
      status: 400,
      details: {
        code: 'automation_not_found',
        retryable: false,
        resourceId: 'auto_live_456',
      },
    })

    const presentation = getJobFailurePresentation(error)
    expect(presentation.code).toBe('automation_not_found')
    expect(presentation.retryable).toBe(false)
    expect(presentation.resourceId).toBe('auto_live_456')
  })

  it('reads nested errorMeta details from stored job runs', () => {
    const presentation = getJobFailurePresentation({
      error: 'automation not found',
      errorMeta: {
        code: 'automation_not_found',
        retryable: false,
        details: {
          automationId: 'auto_live_789',
        },
      },
    })

    expect(presentation.code).toBe('automation_not_found')
    expect(presentation.retryable).toBe(false)
    expect(presentation.resourceId).toBe('auto_live_789')
    expect(presentation.resourceType).toBe('automation')
  })

  it('detects placeholder automation ids from the example payload', () => {
    expect(isAutomationRunPlaceholderAutomationId('auto_001')).toBe(true)
    expect(isAutomationRunPlaceholderAutomationId('auto-live-1')).toBe(false)
  })
})
