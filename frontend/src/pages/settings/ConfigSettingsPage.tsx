import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
  SettingRow,
  SettingsGroup,
  SettingsJsonPreview,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import {
  detectExternalAgentConfig,
  importExternalAgentConfig,
  importRuntimeModelCatalogTemplate,
  readConfig,
  readConfigRequirements,
  readRuntimePreferences,
  writeConfigValue,
  writeRuntimePreferences,
} from '../../features/settings/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getErrorMessage } from '../../lib/error-utils'
import { SelectControl } from '../../components/ui/SelectControl'

export function ConfigSettingsPage() {
  const queryClient = useQueryClient()
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const [configKeyPath, setConfigKeyPath] = useState('model')
  const [configValue, setConfigValue] = useState('"gpt-5.4"')
  const [modelCatalogPath, setModelCatalogPath] = useState('')
  const [defaultShellType, setDefaultShellType] = useState('')
  const [modelShellTypeOverridesInput, setModelShellTypeOverridesInput] = useState('{}')

  const configQuery = useQuery({
    queryKey: ['settings-config', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfig(workspaceId!, { includeLayers: true }),
  })
  const requirementsQuery = useQuery({
    queryKey: ['settings-requirements', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => readConfigRequirements(workspaceId!),
  })
  const runtimePreferencesQuery = useQuery({
    queryKey: ['settings-runtime-preferences'],
    queryFn: readRuntimePreferences,
  })

  const writeConfigMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: configKeyPath,
        mergeStrategy: 'upsert',
        value: parseJsonInput(configValue),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] })
    },
  })
  const writeRuntimePreferencesMutation = useMutation({
    mutationFn: async () => {
      const overrides = parseShellOverridesInput(modelShellTypeOverridesInput)
      return writeRuntimePreferences({
        modelCatalogPath: modelCatalogPath.trim(),
        defaultShellType,
        modelShellTypeOverrides: overrides,
      })
    },
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setModelShellTypeOverridesInput(
        JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
      ])
    },
  })

  const detectExternalMutation = useMutation({
    mutationFn: () => detectExternalAgentConfig(workspaceId!, { includeHome: true }),
  })
  const importExternalMutation = useMutation({
    mutationFn: () =>
      importExternalAgentConfig(workspaceId!, {
        migrationItems: detectExternalMutation.data?.items ?? [],
      }),
  })
  const importModelCatalogMutation = useMutation({
    mutationFn: importRuntimeModelCatalogTemplate,
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setModelShellTypeOverridesInput(
        JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
      ])
    },
  })

  useEffect(() => {
    if (!runtimePreferencesQuery.data) {
      return
    }

    setModelCatalogPath(runtimePreferencesQuery.data.configuredModelCatalogPath)
    setDefaultShellType(runtimePreferencesQuery.data.configuredDefaultShellType)
    setModelShellTypeOverridesInput(
      JSON.stringify(runtimePreferencesQuery.data.configuredModelShellTypeOverrides ?? {}, null, 2),
    )
  }, [runtimePreferencesQuery.data])

  const configLayerCount = Array.isArray(configQuery.data?.layers) ? configQuery.data.layers.length : 0

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description="Configure workspace-scoped runtime values and migrate external agent state without leaving the settings center."
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">{configLayerCount} config layers</span>
          </>
        }
        title="Config"
      />

      <div className="settings-page__stack">
        <SettingsWorkspaceScopePanel />

        <SettingsGroup
          description="Read and write config values for the selected workspace runtime."
          meta={workspaceId ? 'Workspace scoped' : 'Workspace required'}
          title="Runtime Config"
        >
          <SettingRow
            description="Configure service-level shell type overrides. `Default Shell Type` can be used alone; `Model Shell Type Overrides` is optional and only needed when some models should differ from the default."
            title="Runtime Shell Overrides"
          >
            <form
              className="form-stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                writeRuntimePreferencesMutation.mutate()
              }}
            >
              <label className="field">
                <span>Model Catalog Path</span>
                <input
                  onChange={(event) => setModelCatalogPath(event.target.value)}
                  placeholder={runtimePreferencesQuery.data?.defaultModelCatalogPath || 'E:/path/to/models.json'}
                  value={modelCatalogPath}
                />
              </label>
              <label className="field">
                <span>Default Shell Type</span>
                <SelectControl
                  ariaLabel="Default shell type"
                  fullWidth
                  onChange={setDefaultShellType}
                  options={shellTypeOptions}
                  value={defaultShellType}
                />
              </label>
              <label className="field">
                <span>Model Shell Type Overrides (JSON)</span>
                <textarea
                  className="ide-textarea"
                  onChange={(event) => setModelShellTypeOverridesInput(event.target.value)}
                  placeholder={JSON.stringify(runtimePreferencesQuery.data?.defaultModelShellTypeOverrides ?? {}, null, 2)}
                  rows={8}
                  value={modelShellTypeOverridesInput}
                />
              </label>
              <div className="setting-row__actions">
                <button
                  className="ide-button ide-button--secondary"
                  onClick={() => importModelCatalogMutation.mutate()}
                  type="button"
                >
                  {importModelCatalogMutation.isPending
                    ? 'Importing template…'
                    : 'Import Model Catalog Template'}
                </button>
                <button className="ide-button" type="submit">
                  {writeRuntimePreferencesMutation.isPending ? 'Applying…' : 'Apply Runtime Overrides'}
                </button>
              </div>
            </form>
            <div className="notice">
              Saving this section updates the backend launch command and resets managed runtimes so the next runtime request starts with the new shell behavior. If you only want one shell type everywhere, set `Default Shell Type` and leave the overrides JSON as `{}`. You can also import the bundled template first so you do not need to type a catalog path manually.
            </div>
            {runtimePreferencesQuery.data ? (
              <div className="settings-grid">
                <SettingsJsonPreview
                  description="Configured values stored by codex-server. Empty values fall back to environment defaults."
                  title="Configured Runtime Preferences"
                  value={{
                    modelCatalogPath: runtimePreferencesQuery.data.configuredModelCatalogPath,
                    defaultShellType: runtimePreferencesQuery.data.configuredDefaultShellType,
                    modelShellTypeOverrides: runtimePreferencesQuery.data.configuredModelShellTypeOverrides,
                  }}
                />
                <SettingsJsonPreview
                  description="Current effective runtime command and resolved shell type overrides."
                  title="Effective Runtime State"
                  value={{
                    modelCatalogPath: runtimePreferencesQuery.data.effectiveModelCatalogPath,
                    defaultShellType: runtimePreferencesQuery.data.effectiveDefaultShellType,
                    modelShellTypeOverrides: runtimePreferencesQuery.data.effectiveModelShellTypeOverrides,
                    command: runtimePreferencesQuery.data.effectiveCommand,
                  }}
                />
              </div>
            ) : null}
            {runtimePreferencesQuery.error ? (
              <InlineNotice
                details={getErrorMessage(runtimePreferencesQuery.error)}
                dismissible
                noticeKey={`runtime-preferences-read-${runtimePreferencesQuery.error instanceof Error ? runtimePreferencesQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] })}
                title="Failed To Read Runtime Preferences"
                tone="error"
              >
                {getErrorMessage(runtimePreferencesQuery.error)}
              </InlineNotice>
            ) : null}
            {writeRuntimePreferencesMutation.error ? (
              <InlineNotice
                details={getErrorMessage(writeRuntimePreferencesMutation.error)}
                dismissible
                noticeKey={`runtime-preferences-write-${writeRuntimePreferencesMutation.error instanceof Error ? writeRuntimePreferencesMutation.error.message : 'unknown'}`}
                title="Runtime Override Update Failed"
                tone="error"
              >
                {getErrorMessage(writeRuntimePreferencesMutation.error)}
              </InlineNotice>
            ) : null}
            {importModelCatalogMutation.error ? (
              <InlineNotice
                details={getErrorMessage(importModelCatalogMutation.error)}
                dismissible
                noticeKey={`runtime-preferences-import-${importModelCatalogMutation.error instanceof Error ? importModelCatalogMutation.error.message : 'unknown'}`}
                title="Model Catalog Import Failed"
                tone="error"
              >
                {getErrorMessage(importModelCatalogMutation.error)}
              </InlineNotice>
            ) : null}
            {importModelCatalogMutation.isSuccess && importModelCatalogMutation.data ? (
              <InlineNotice
                details={JSON.stringify(
                  {
                    modelCatalogPath: importModelCatalogMutation.data.configuredModelCatalogPath,
                    effectiveModelCatalogPath: importModelCatalogMutation.data.effectiveModelCatalogPath,
                    effectiveCommand: importModelCatalogMutation.data.effectiveCommand,
                  },
                  null,
                  2,
                )}
                dismissible
                noticeKey={`runtime-preferences-import-success-${importModelCatalogMutation.data.effectiveModelCatalogPath}`}
                title="Model Catalog Imported"
              >
                Bundled template copied and bound to
                {' '}
                <code>{importModelCatalogMutation.data.configuredModelCatalogPath}</code>
                . Managed runtimes will restart with the imported catalog on the next request.
              </InlineNotice>
            ) : null}
          </SettingRow>

          <SettingRow
            description="Write a JSON value into the selected key path for the active workspace."
            title="Write Config Value"
          >
            <form
              className="form-stack"
              onSubmit={(event: FormEvent<HTMLFormElement>) => {
                event.preventDefault()
                if (workspaceId) {
                  writeConfigMutation.mutate()
                }
              }}
            >
              <label className="field">
                <span>Key Path</span>
                <input onChange={(event) => setConfigKeyPath(event.target.value)} value={configKeyPath} />
              </label>
              <label className="field">
                <span>Value (JSON)</span>
                <textarea
                  className="ide-textarea"
                  onChange={(event) => setConfigValue(event.target.value)}
                  rows={5}
                  value={configValue}
                />
              </label>
              <div className="setting-row__actions">
                <button className="ide-button" disabled={!workspaceId} type="submit">
                  {writeConfigMutation.isPending ? 'Writing…' : 'Write Config'}
                </button>
              </div>
            </form>
            {writeConfigMutation.error ? (
              <InlineNotice
                details={getErrorMessage(writeConfigMutation.error)}
                dismissible
                noticeKey={`write-config-${writeConfigMutation.error instanceof Error ? writeConfigMutation.error.message : 'unknown'}`}
                title="Write Config Failed"
                tone="error"
              >
                {getErrorMessage(writeConfigMutation.error)}
              </InlineNotice>
            ) : null}
          </SettingRow>

          <SettingRow
            description="Inspect the resolved runtime config and its validation requirements."
            title="Resolved Output"
          >
            {configQuery.isLoading || requirementsQuery.isLoading ? (
              <div className="notice">Loading workspace config…</div>
            ) : null}
            {configQuery.error ? (
              <InlineNotice
                details={getErrorMessage(configQuery.error)}
                dismissible
                noticeKey={`config-read-${configQuery.error instanceof Error ? configQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] })}
                title="Failed To Read Config"
                tone="error"
              >
                {getErrorMessage(configQuery.error)}
              </InlineNotice>
            ) : null}
            {requirementsQuery.error ? (
              <InlineNotice
                details={getErrorMessage(requirementsQuery.error)}
                dismissible
                noticeKey={`config-requirements-${requirementsQuery.error instanceof Error ? requirementsQuery.error.message : 'unknown'}`}
                onRetry={() => void queryClient.invalidateQueries({ queryKey: ['settings-requirements', workspaceId] })}
                title="Failed To Read Requirements"
                tone="error"
              >
                {getErrorMessage(requirementsQuery.error)}
              </InlineNotice>
            ) : null}
            {configQuery.data || requirementsQuery.data ? (
              <div className="settings-grid">
                {configQuery.data ? (
                  <SettingsJsonPreview
                    description="Resolved configuration for the active workspace."
                    title="Current Config"
                    value={configQuery.data.config}
                  />
                ) : null}
                {requirementsQuery.data ? (
                  <SettingsJsonPreview
                    description="Validation and requirement output for the same workspace."
                    title="Requirements"
                    value={requirementsQuery.data.requirements ?? null}
                  />
                ) : null}
              </div>
            ) : null}
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          description="Detect local external agent settings and import them into the selected workspace."
          title="External Config"
        >
          <SettingRow
            description="Run a migration scan, then import the detected items if they match the workspace you selected."
            title="Import External Agent State"
          >
            <div className="setting-row__actions">
              <button
                className="ide-button"
                disabled={!workspaceId}
                onClick={() => detectExternalMutation.mutate()}
                type="button"
              >
                {detectExternalMutation.isPending ? 'Detecting…' : 'Detect External Config'}
              </button>
              <button
                className="ide-button ide-button--secondary"
                disabled={!workspaceId || importExternalMutation.isPending || !detectExternalMutation.data?.items?.length}
                onClick={() => importExternalMutation.mutate()}
                type="button"
              >
                {importExternalMutation.isPending ? 'Importing…' : 'Import Detected Items'}
              </button>
            </div>
            {!detectExternalMutation.data ? <div className="notice">No migration scan has been run yet.</div> : null}
            {detectExternalMutation.data ? (
              <SettingsJsonPreview
                description="Detected items that can be imported into the active workspace."
                title="Detected Items"
                value={detectExternalMutation.data.items}
              />
            ) : null}
            {detectExternalMutation.error ? (
              <InlineNotice
                details={getErrorMessage(detectExternalMutation.error)}
                dismissible
                noticeKey={`detect-external-${detectExternalMutation.error instanceof Error ? detectExternalMutation.error.message : 'unknown'}`}
                onRetry={() => detectExternalMutation.mutate()}
                title="External Scan Failed"
                tone="error"
              >
                {getErrorMessage(detectExternalMutation.error)}
              </InlineNotice>
            ) : null}
            {importExternalMutation.error ? (
              <InlineNotice
                details={getErrorMessage(importExternalMutation.error)}
                dismissible
                noticeKey={`import-external-${importExternalMutation.error instanceof Error ? importExternalMutation.error.message : 'unknown'}`}
                onRetry={() => importExternalMutation.mutate()}
                title="Import Failed"
                tone="error"
              >
                {getErrorMessage(importExternalMutation.error)}
              </InlineNotice>
            ) : null}
            {importExternalMutation.isSuccess ? (
              <InlineNotice
                details={JSON.stringify(importExternalMutation.data, null, 2)}
                dismissible
                noticeKey={`import-external-success-${detectExternalMutation.data?.items?.length ?? 0}`}
                title="External Agent State Imported"
              >
                Imported
                {' '}
                <strong>{detectExternalMutation.data?.items?.length ?? 0}</strong>
                {' '}
                detected item(s) into the selected workspace. The backend returned
                {' '}
                <code>{importExternalMutation.data?.status ?? 'accepted'}</code>
                .
              </InlineNotice>
            ) : null}
          </SettingRow>
        </SettingsGroup>
      </div>
    </section>
  )
}

function parseJsonInput(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

const shellTypeOptions = [
  { value: '', label: 'Follow catalog defaults', triggerLabel: '默认' },
  { value: 'default', label: 'Default', triggerLabel: 'Default' },
  { value: 'local', label: 'LocalShell', triggerLabel: 'Local' },
  { value: 'shell_command', label: 'ShellCommand', triggerLabel: 'ShellCmd' },
  { value: 'unified_exec', label: 'UnifiedExec', triggerLabel: 'Unified' },
  { value: 'disabled', label: 'Disabled', triggerLabel: 'Off' },
]

function parseShellOverridesInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Model Shell Type Overrides must be a JSON object')
  }

  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') {
      throw new Error(`Model shell override for "${key}" must be a string`)
    }
    normalized[key] = rawValue
  }

  return normalized
}
