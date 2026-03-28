import { describe, expect, it } from 'vitest'

import {
  buildConfiguredBackendThreadTracePayload,
  buildDraftBackendThreadTracePayload,
} from './configSettingsPageRuntimePreferences'

describe('configSettingsPageRuntimePreferences', () => {
  it('preserves configured trace overrides when another settings card saves', () => {
    expect(
      buildConfiguredBackendThreadTracePayload({
        configuredBackendThreadTraceEnabled: true,
        configuredBackendThreadTraceWorkspaceId: ' ws-configured ',
        configuredBackendThreadTraceThreadId: ' thread-configured ',
      }),
    ).toEqual({
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: 'ws-configured',
      backendThreadTraceThreadId: 'thread-configured',
    })
  })

  it('does not materialize env-default trace values into a new explicit override', () => {
    expect(
      buildConfiguredBackendThreadTracePayload({
        configuredBackendThreadTraceEnabled: null,
        configuredBackendThreadTraceWorkspaceId: '',
        configuredBackendThreadTraceThreadId: '',
      }),
    ).toEqual({
      backendThreadTraceEnabled: null,
      backendThreadTraceWorkspaceId: '',
      backendThreadTraceThreadId: '',
    })
  })

  it('uses trace draft values for trace form saves and respects explicit reset input', () => {
    const draft = {
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: ' ws-draft ',
      backendThreadTraceThreadId: ' thread-draft ',
    }

    expect(buildDraftBackendThreadTracePayload(draft)).toEqual({
      backendThreadTraceEnabled: true,
      backendThreadTraceWorkspaceId: 'ws-draft',
      backendThreadTraceThreadId: 'thread-draft',
    })

    expect(
      buildDraftBackendThreadTracePayload(draft, {
        backendThreadTraceEnabled: null,
        backendThreadTraceWorkspaceId: '',
        backendThreadTraceThreadId: '',
      }),
    ).toEqual({
      backendThreadTraceEnabled: null,
      backendThreadTraceWorkspaceId: '',
      backendThreadTraceThreadId: '',
    })
  })
})
