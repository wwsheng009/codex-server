import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { FormEvent } from 'react'

import {
  SettingRow,
  SettingsGroup,
  SettingsJsonPreview,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { SettingsWorkspaceScopePanel } from '../../components/settings/SettingsWorkspaceScopePanel'
import {
  detectExternalAgentConfig,
  importExternalAgentConfig,
  readConfig,
  readConfigRequirements,
  writeConfigValue,
} from '../../features/settings/api'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { getErrorMessage } from '../../lib/error-utils'

export function ConfigSettingsPage() {
  const queryClient = useQueryClient()
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const [configKeyPath, setConfigKeyPath] = useState('model')
  const [configValue, setConfigValue] = useState('"gpt-5.4"')

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

  const detectExternalMutation = useMutation({
    mutationFn: () => detectExternalAgentConfig(workspaceId!, { includeHome: true }),
  })
  const importExternalMutation = useMutation({
    mutationFn: () =>
      importExternalAgentConfig(workspaceId!, {
        migrationItems: detectExternalMutation.data?.items ?? [],
      }),
  })

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
            {writeConfigMutation.error ? <p className="error-text">{getErrorMessage(writeConfigMutation.error)}</p> : null}
          </SettingRow>

          <SettingRow
            description="Inspect the resolved runtime config and its validation requirements."
            title="Resolved Output"
          >
            {configQuery.isLoading || requirementsQuery.isLoading ? (
              <div className="notice">Loading workspace config…</div>
            ) : null}
            {configQuery.error ? <p className="error-text">{getErrorMessage(configQuery.error)}</p> : null}
            {requirementsQuery.error ? <p className="error-text">{getErrorMessage(requirementsQuery.error)}</p> : null}
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
            {detectExternalMutation.error ? <p className="error-text">{getErrorMessage(detectExternalMutation.error)}</p> : null}
            {importExternalMutation.error ? <p className="error-text">{getErrorMessage(importExternalMutation.error)}</p> : null}
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
