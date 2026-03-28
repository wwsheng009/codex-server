import type { RuntimePreferencesResult } from '../../types/api'

export type RuntimePreferencesBackendThreadTraceDraft = {
  backendThreadTraceEnabled: boolean
  backendThreadTraceWorkspaceId: string
  backendThreadTraceThreadId: string
}

export type RuntimePreferencesBackendThreadTraceInput = {
  backendThreadTraceEnabled?: boolean | null
  backendThreadTraceWorkspaceId?: string
  backendThreadTraceThreadId?: string
}

export function buildDraftBackendThreadTracePayload(
  draft: RuntimePreferencesBackendThreadTraceDraft,
  input?: RuntimePreferencesBackendThreadTraceInput,
) {
  const includeBackendThreadTraceEnabled =
    input && Object.prototype.hasOwnProperty.call(input, 'backendThreadTraceEnabled')
  const includeBackendThreadTraceWorkspaceId =
    input && Object.prototype.hasOwnProperty.call(input, 'backendThreadTraceWorkspaceId')
  const includeBackendThreadTraceThreadId =
    input && Object.prototype.hasOwnProperty.call(input, 'backendThreadTraceThreadId')

  return {
    backendThreadTraceEnabled: includeBackendThreadTraceEnabled
      ? input?.backendThreadTraceEnabled ?? null
      : draft.backendThreadTraceEnabled,
    backendThreadTraceWorkspaceId: (
      includeBackendThreadTraceWorkspaceId
        ? input?.backendThreadTraceWorkspaceId
        : draft.backendThreadTraceWorkspaceId
    )?.trim() ?? '',
    backendThreadTraceThreadId: (
      includeBackendThreadTraceThreadId
        ? input?.backendThreadTraceThreadId
        : draft.backendThreadTraceThreadId
    )?.trim() ?? '',
  }
}

export function buildConfiguredBackendThreadTracePayload(
  result?:
    | Pick<
        RuntimePreferencesResult,
        | 'configuredBackendThreadTraceEnabled'
        | 'configuredBackendThreadTraceWorkspaceId'
        | 'configuredBackendThreadTraceThreadId'
      >
    | null,
) {
  return {
    backendThreadTraceEnabled: result?.configuredBackendThreadTraceEnabled ?? null,
    backendThreadTraceWorkspaceId: (
      result?.configuredBackendThreadTraceWorkspaceId ?? ''
    ).trim(),
    backendThreadTraceThreadId: (result?.configuredBackendThreadTraceThreadId ?? '').trim(),
  }
}
