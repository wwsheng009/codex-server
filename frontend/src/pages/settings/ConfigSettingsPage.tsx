import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

import {
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
import { i18n } from '../../i18n/runtime'
import { getErrorMessage } from '../../lib/error-utils'
import { SelectControl } from '../../components/ui/SelectControl'
import { activateStoredTab, Tabs } from '../../components/ui/Tabs'
import { useUIStore } from '../../stores/ui-store'
import { ContextIcon, FeedIcon, RefreshIcon, SettingsIcon, SparkIcon, TerminalIcon } from '../../components/ui/RailControls'
import { Tooltip } from '../../components/ui/Tooltip'

export function ConfigSettingsPage() {
  const queryClient = useQueryClient()
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const pushToast = useUIStore((state) => state.pushToast)
  const [configKeyPath, setConfigKeyPath] = useState('model')
  const [configValue, setConfigValue] = useState('"gpt-5.4"')
  const [modelCatalogPath, setModelCatalogPath] = useState('')
  const [defaultShellType, setDefaultShellType] = useState('')
  const [modelShellTypeOverridesInput, setModelShellTypeOverridesInput] = useState('{}')
  const [defaultTurnApprovalPolicy, setDefaultTurnApprovalPolicy] = useState('')
  const [defaultTurnSandboxPolicyInput, setDefaultTurnSandboxPolicyInput] = useState('')
  const [defaultCommandSandboxPolicyInput, setDefaultCommandSandboxPolicyInput] = useState('')
  const [shellEnvironmentPolicyInput, setShellEnvironmentPolicyInput] = useState('')

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

  function buildRuntimePreferencesPayload(input?: {
    modelCatalogPath?: string
    defaultShellType?: string
    modelShellTypeOverrides?: Record<string, string>
    defaultTurnApprovalPolicy?: string
    defaultTurnSandboxPolicy?: Record<string, unknown>
    defaultCommandSandboxPolicy?: Record<string, unknown>
  }) {
    return {
      modelCatalogPath: (input?.modelCatalogPath ?? modelCatalogPath).trim(),
      defaultShellType: input?.defaultShellType ?? defaultShellType,
      modelShellTypeOverrides:
        input?.modelShellTypeOverrides ??
        parseShellOverridesInput(modelShellTypeOverridesInput),
      defaultTurnApprovalPolicy: input?.defaultTurnApprovalPolicy ?? defaultTurnApprovalPolicy,
      defaultTurnSandboxPolicy:
        input?.defaultTurnSandboxPolicy ?? parseSandboxPolicyInput(defaultTurnSandboxPolicyInput),
      defaultCommandSandboxPolicy:
        input?.defaultCommandSandboxPolicy ??
        parseSandboxPolicyInput(defaultCommandSandboxPolicyInput),
    }
  }

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
  const writeShellEnvironmentPolicyMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: 'shell_environment_policy',
        mergeStrategy: 'upsert',
        value: parseShellEnvironmentPolicyInput(shellEnvironmentPolicyInput),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-requirements', workspaceId] }),
      ])
      pushToast({
        title: i18n._({
          id: 'Shell environment policy updated',
          message: 'Shell environment policy updated',
        }),
        message: i18n._({
          id: 'User config now contains an explicit shell_environment_policy override.',
          message: 'User config now contains an explicit shell_environment_policy override.',
        }),
        tone: 'success',
      })
    },
  })
  const writeRuntimePreferencesMutation = useMutation({
    mutationFn: async (input?: {
      modelCatalogPath?: string
      defaultShellType?: string
      modelShellTypeOverrides?: Record<string, string>
      defaultTurnApprovalPolicy?: string
      defaultTurnSandboxPolicy?: Record<string, unknown>
      defaultCommandSandboxPolicy?: Record<string, unknown>
    }) => writeRuntimePreferences(buildRuntimePreferencesPayload(input)),
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setModelShellTypeOverridesInput(
        JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
      )
      setDefaultTurnApprovalPolicy(result.configuredDefaultTurnApprovalPolicy ?? '')
      setDefaultTurnSandboxPolicyInput(
        stringifyJsonInput(result.configuredDefaultTurnSandboxPolicy),
      )
      setDefaultCommandSandboxPolicyInput(
        stringifyJsonInput(result.configuredDefaultCommandSandboxPolicy),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
      ])
      const shellLabel =
        result.effectiveDefaultShellType ||
        i18n._({
          id: 'catalog default',
          message: 'catalog default',
        })
      pushToast({
        title: i18n._({
          id: 'Runtime overrides applied',
          message: 'Runtime overrides applied',
        }),
        message: i18n._({
          id: 'Shell: {shell}; turn sandbox: {turnSandbox}; command sandbox: {commandSandbox}.',
          message: 'Shell: {shell}; turn sandbox: {turnSandbox}; command sandbox: {commandSandbox}.',
          values: {
            shell: shellLabel,
            turnSandbox: formatSandboxPolicyLabel(result.effectiveDefaultTurnSandboxPolicy),
            commandSandbox: formatSandboxPolicyLabel(result.effectiveDefaultCommandSandboxPolicy),
          },
        }),
        tone: 'success',
        actionLabel: i18n._({
          id: 'Open Effective',
          message: 'Open Effective',
        }),
        onAction: () => {
          activateStoredTab('settings-config-main-tabs', 'runtime')
          activateStoredTab('settings-config-runtime-side-tabs', 'effective')
        },
      })
    },
  })

  const detectExternalMutation = useMutation({
    mutationFn: () => detectExternalAgentConfig(workspaceId!, { includeHome: true }),
    onSuccess: (result) => {
      pushToast({
        title: i18n._({
          id: 'External config detected',
          message: 'External config detected',
        }),
        message: i18n._({
          id: 'Found {count} candidate item(s) for import review.',
          message: 'Found {count} candidate item(s) for import review.',
          values: { count: result.items?.length ?? 0 },
        }),
        tone: 'info',
        actionLabel: i18n._({
          id: 'Open Detected',
          message: 'Open Detected',
        }),
        onAction: () => {
          activateStoredTab('settings-config-main-tabs', 'migration')
          activateStoredTab('settings-config-migration-side-tabs', 'detected')
        },
      })
    },
  })
  const importExternalMutation = useMutation({
    mutationFn: () =>
      importExternalAgentConfig(workspaceId!, {
        migrationItems: detectExternalMutation.data?.items ?? [],
      }),
    onSuccess: (result) => {
      pushToast({
        title: i18n._({
          id: 'External agent state imported',
          message: 'External agent state imported',
        }),
        message: i18n._({
          id: 'Imported {count} item(s); backend status: {status}.',
          message: 'Imported {count} item(s); backend status: {status}.',
          values: {
            count: detectExternalMutation.data?.items?.length ?? 0,
            status:
              result.status ??
              i18n._({
                id: 'accepted',
                message: 'accepted',
              }),
          },
        }),
        tone: 'success',
      })
    },
  })
  const importModelCatalogMutation = useMutation({
    mutationFn: importRuntimeModelCatalogTemplate,
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setModelShellTypeOverridesInput(
        JSON.stringify(result.configuredModelShellTypeOverrides ?? {}, null, 2),
      )
      setDefaultTurnApprovalPolicy(result.configuredDefaultTurnApprovalPolicy ?? '')
      setDefaultTurnSandboxPolicyInput(
        stringifyJsonInput(result.configuredDefaultTurnSandboxPolicy),
      )
      setDefaultCommandSandboxPolicyInput(
        stringifyJsonInput(result.configuredDefaultCommandSandboxPolicy),
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-runtime-preferences'] }),
        queryClient.invalidateQueries({ queryKey: ['runtime-catalog'] }),
        queryClient.invalidateQueries({ queryKey: ['models'] }),
      ])
      pushToast({
        title: i18n._({
          id: 'Model catalog imported',
          message: 'Model catalog imported',
        }),
        message: i18n._({
          id: 'Bound runtime catalog to {path}.',
          message: 'Bound runtime catalog to {path}.',
          values: { path: result.configuredModelCatalogPath },
        }),
        tone: 'success',
        actionLabel: i18n._({
          id: 'Open Configured',
          message: 'Open Configured',
        }),
        onAction: () => {
          activateStoredTab('settings-config-main-tabs', 'runtime')
          activateStoredTab('settings-config-runtime-side-tabs', 'configured')
        },
      })
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
    setDefaultTurnApprovalPolicy(runtimePreferencesQuery.data.configuredDefaultTurnApprovalPolicy ?? '')
    setDefaultTurnSandboxPolicyInput(
      stringifyJsonInput(runtimePreferencesQuery.data.configuredDefaultTurnSandboxPolicy),
    )
    setDefaultCommandSandboxPolicyInput(
      stringifyJsonInput(runtimePreferencesQuery.data.configuredDefaultCommandSandboxPolicy),
    )
  }, [runtimePreferencesQuery.data])

  useEffect(() => {
    if (!configQuery.data) {
      return
    }

    setShellEnvironmentPolicyInput(
      stringifyJsonInput(configQuery.data.config?.['shell_environment_policy']),
    )
  }, [configQuery.data])

  const configLayerCount = Array.isArray(configQuery.data?.layers) ? configQuery.data.layers.length : 0
  const runtimeSummary = {
    catalogBound: Boolean(runtimePreferencesQuery.data?.effectiveModelCatalogPath),
    defaultShellType:
      runtimePreferencesQuery.data?.effectiveDefaultShellType ||
      i18n._({
        id: 'catalog default',
        message: 'catalog default',
      }),
    turnApprovalPolicy: formatApprovalPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTurnApprovalPolicy,
    ),
    turnSandboxPolicy: formatSandboxPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTurnSandboxPolicy,
    ),
    commandSandboxPolicy: formatSandboxPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultCommandSandboxPolicy,
    ),
  }

  function applyExecutionPreset(preset: 'danger-full-access' | 'external-sandbox' | 'inherit') {
    switch (preset) {
      case 'danger-full-access':
        setDefaultTurnApprovalPolicy('never')
        setDefaultTurnSandboxPolicyInput(
          JSON.stringify({ type: 'dangerFullAccess' }, null, 2),
        )
        setDefaultCommandSandboxPolicyInput(
          JSON.stringify({ type: 'dangerFullAccess' }, null, 2),
        )
        break
      case 'external-sandbox':
        setDefaultTurnApprovalPolicy('')
        setDefaultTurnSandboxPolicyInput(
          JSON.stringify({ type: 'externalSandbox', networkAccess: 'enabled' }, null, 2),
        )
        setDefaultCommandSandboxPolicyInput(
          JSON.stringify({ type: 'externalSandbox', networkAccess: 'enabled' }, null, 2),
        )
        break
      default:
        setDefaultTurnApprovalPolicy('')
        setDefaultTurnSandboxPolicyInput('')
        setDefaultCommandSandboxPolicyInput('')
        break
    }
  }

  function applyShellEnvironmentPolicyPreset(
    preset: 'inherit-all' | 'inherit-core-windows' | 'clear',
  ) {
    switch (preset) {
      case 'inherit-all':
        setShellEnvironmentPolicyInput(
          JSON.stringify(
            {
              inherit: 'all',
            },
            null,
            2,
          ),
        )
        break
      case 'inherit-core-windows':
        setShellEnvironmentPolicyInput(
          JSON.stringify(
            {
              inherit: 'core',
              set: {
                PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
                SystemRoot: 'C:\\Windows',
                ComSpec: 'C:\\Windows\\System32\\cmd.exe',
              },
            },
            null,
            2,
          ),
        )
        break
      default:
        setShellEnvironmentPolicyInput('')
        break
    }
  }

  const configTabs = [
    {
      id: 'runtime',
      label: i18n._({ id: 'Runtime', message: 'Runtime' }),
      icon: <SparkIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__header">
            <div className="config-workbench__header-main">
              <SettingsWorkspaceScopePanel />
            </div>
            <div className="config-workbench__header-status">
              <div className={`status-pill ${runtimeSummary.catalogBound ? 'status-pill--active' : 'status-pill--paused'}`}>
                {i18n._({ id: 'Catalog', message: 'Catalog' })}:{' '}
                {runtimeSummary.catalogBound
                  ? i18n._({ id: 'Attached', message: 'Attached' })
                  : i18n._({ id: 'Missing', message: 'Missing' })}
              </div>
              <div className="status-pill">
                {i18n._({ id: 'Shell', message: 'Shell' })}: {runtimeSummary.defaultShellType}
              </div>
              <div className="status-pill">
                {i18n._({ id: 'Turn', message: 'Turn' })}: {runtimeSummary.turnSandboxPolicy}
              </div>
              <div className="status-pill">
                {i18n._({ id: 'Command', message: 'Command' })}: {runtimeSummary.commandSandboxPolicy}
              </div>
              <div className="status-pill">
                {i18n._({ id: 'Approval', message: 'Approval' })}: {runtimeSummary.turnApprovalPolicy}
              </div>
            </div>
          </div>

          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  writeRuntimePreferencesMutation.mutate(undefined)
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: 'Shell & Execution Configuration',
                      message: 'Shell & Execution Configuration',
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={writeRuntimePreferencesMutation.isPending}
                      onClick={() =>
                        writeRuntimePreferencesMutation.mutate({
                          defaultShellType: '',
                          modelShellTypeOverrides: {},
                        })
                      }
                      type="button"
                    >
                      {i18n._({
                        id: 'Reset Shell Overrides',
                        message: 'Reset Shell Overrides',
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={writeRuntimePreferencesMutation.isPending}
                      onClick={() =>
                        writeRuntimePreferencesMutation.mutate({
                          defaultTurnApprovalPolicy: '',
                          defaultTurnSandboxPolicy: {},
                          defaultCommandSandboxPolicy: {},
                        })
                      }
                      type="button"
                    >
                      {i18n._({
                        id: 'Reset Execution Defaults',
                        message: 'Reset Execution Defaults',
                      })}
                    </button>
                    <button className="ide-button ide-button--primary ide-button--sm" type="submit">
                      {writeRuntimePreferencesMutation.isPending
                        ? i18n._({ id: 'Applying…', message: 'Applying…' })
                        : i18n._({ id: 'Apply Changes', message: 'Apply Changes' })}
                    </button>
                  </div>
                </div>

                <div className="form-stack">
                  <div className="field-group">
                    <label className="field">
                      <span>
                        {i18n._({ id: 'Model Catalog Path', message: 'Model Catalog Path' })}
                        <FieldHint
                          label={i18n._({
                            id: 'Explain model catalog path',
                            message: 'Explain model catalog path',
                          })}
                          text={i18n._({
                            id: 'Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata.',
                            message:
                              'Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata.',
                          })}
                        />
                      </span>
                      <div className="input-with-action">
                        <input
                          onChange={(event) => setModelCatalogPath(event.target.value)}
                          placeholder={
                            runtimePreferencesQuery.data?.defaultModelCatalogPath ||
                            'E:/path/to/models.json'
                          }
                          value={modelCatalogPath}
                        />
                        <button
                          className="ide-button ide-button--secondary ide-button--sm"
                          onClick={() => importModelCatalogMutation.mutate()}
                          type="button"
                        >
                          {i18n._({ id: 'Template', message: 'Template' })}
                        </button>
                      </div>
                    </label>
                  </div>

                  <div className="form-row">
                    <label className="field">
                      <span>
                        {i18n._({ id: 'Default Shell Type', message: 'Default Shell Type' })}
                        <FieldHint
                          label={i18n._({
                            id: 'Explain default shell type',
                            message: 'Explain default shell type',
                          })}
                          text={i18n._({
                            id: 'Applies one shell type to the catalog unless a model-specific override replaces it.',
                            message:
                              'Applies one shell type to the catalog unless a model-specific override replaces it.',
                          })}
                        />
                      </span>
                      <SelectControl
                        ariaLabel={i18n._({
                          id: 'Default shell type',
                          message: 'Default shell type',
                        })}
                        fullWidth
                        onChange={setDefaultShellType}
                        options={shellTypeOptions}
                        value={defaultShellType}
                      />
                    </label>
                  </div>

                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Reset Shell Overrides clears the service-level shell override while keeping the configured catalog path.',
                      message:
                        'Reset Shell Overrides clears the service-level shell override while keeping the configured catalog path.',
                    })}
                  </p>

                  <div className="form-row">
                    <label className="field">
                      <span>
                        {i18n._({
                          id: 'Default Turn Approval Policy',
                          message: 'Default Turn Approval Policy',
                        })}
                        <FieldHint
                          label={i18n._({
                            id: 'Explain turn approval policy',
                            message: 'Explain turn approval policy',
                          })}
                          text={i18n._({
                            id: "Optional default approval policy applied to turn/start. Leave blank to follow the runtime's own configuration.",
                            message:
                              "Optional default approval policy applied to turn/start. Leave blank to follow the runtime's own configuration.",
                          })}
                        />
                      </span>
                      <SelectControl
                        ariaLabel={i18n._({
                          id: 'Default turn approval policy',
                          message: 'Default turn approval policy',
                        })}
                        fullWidth
                        onChange={setDefaultTurnApprovalPolicy}
                        options={approvalPolicyOptions}
                        value={defaultTurnApprovalPolicy}
                      />
                    </label>
                  </div>

                  <label className="field">
                    <span>
                      {i18n._({
                        id: 'Default Turn Sandbox Policy (JSON)',
                        message: 'Default Turn Sandbox Policy (JSON)',
                      })}
                      <FieldHint
                        label={i18n._({
                          id: 'Explain turn sandbox policy',
                          message: 'Explain turn sandbox policy',
                        })}
                        text={i18n._({
                          id: 'Optional sandboxPolicy override sent with turn/start. Use this instead of relying on shell_type when you need dangerFullAccess or externalSandbox.',
                          message:
                            'Optional sandboxPolicy override sent with turn/start. Use this instead of relying on shell_type when you need dangerFullAccess or externalSandbox.',
                        })}
                      />
                    </span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setDefaultTurnSandboxPolicyInput(event.target.value)}
                      placeholder='{"type":"dangerFullAccess"}'
                      rows={4}
                      value={defaultTurnSandboxPolicyInput}
                    />
                  </label>

                  <label className="field">
                    <span>
                      {i18n._({
                        id: 'Default Command Sandbox Policy (JSON)',
                        message: 'Default Command Sandbox Policy (JSON)',
                      })}
                      <FieldHint
                        label={i18n._({
                          id: 'Explain command sandbox policy',
                          message: 'Explain command sandbox policy',
                        })}
                        text={i18n._({
                          id: "Optional sandboxPolicy override sent with command/exec. Leave blank to keep codex-server's current default.",
                          message:
                            "Optional sandboxPolicy override sent with command/exec. Leave blank to keep codex-server's current default.",
                        })}
                      />
                    </span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setDefaultCommandSandboxPolicyInput(event.target.value)}
                      placeholder='{"type":"dangerFullAccess"}'
                      rows={4}
                      value={defaultCommandSandboxPolicyInput}
                    />
                  </label>

                  <label className="field">
                    <span>
                      {i18n._({
                        id: 'Model Shell Type Overrides (JSON)',
                        message: 'Model Shell Type Overrides (JSON)',
                      })}
                      <FieldHint
                        label={i18n._({
                          id: 'Explain model shell type overrides',
                          message: 'Explain model shell type overrides',
                        })}
                        text={i18n._({
                          id: 'Optional JSON object for model-specific exceptions. Keys are model ids or slugs and values are shell types such as local, shell_command, unified_exec, default, or disabled.',
                          message:
                            'Optional JSON object for model-specific exceptions. Keys are model ids or slugs and values are shell types such as local, shell_command, unified_exec, default, or disabled.',
                        })}
                      />
                    </span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setModelShellTypeOverridesInput(event.target.value)}
                      placeholder="{}"
                      rows={5}
                      value={modelShellTypeOverridesInput}
                    />
                  </label>
                </div>
              </form>

              <details className="config-details-box">
                <summary className="config-details-box__summary">
                  <span>{i18n._({ id: 'Strategy Guide', message: 'Strategy Guide' })}</span>
                  <small>
                    {i18n._({
                      id: 'Which shell type should you choose?',
                      message: 'Which shell type should you choose?',
                    })}
                  </small>
                </summary>
                <div className="config-helper-grid config-helper-grid--compact">
                  <article className="config-helper-card">
                    <strong>local</strong>
                    <p>
                      {i18n._({
                        id: 'Standard local execution.',
                        message: 'Standard local execution.',
                      })}
                    </p>
                  </article>
                  <article className="config-helper-card">
                    <strong>unified_exec</strong>
                    <p>{i18n._({ id: 'Streaming output + stdin.', message: 'Streaming output + stdin.' })}</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>shell_command</strong>
                    <p>{i18n._({ id: 'Script string wrapper.', message: 'Script string wrapper.' })}</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>default</strong>
                    <p>{i18n._({ id: 'Upstream catalog values.', message: 'Upstream catalog values.' })}</p>
                  </article>
                </div>
              </details>

              <details className="config-details-box">
                <summary className="config-details-box__summary">
                  <span>{i18n._({ id: 'Execution Guide', message: 'Execution Guide' })}</span>
                  <small>
                    {i18n._({
                      id: '`sandboxPolicy` controls sandboxing, not `shell_type`',
                      message: '`sandboxPolicy` controls sandboxing, not `shell_type`',
                    })}
                  </small>
                </summary>
                <div className="config-helper-grid config-helper-grid--compact">
                  <article className="config-helper-card">
                    <strong>dangerFullAccess</strong>
                    <p>{'{"type":"dangerFullAccess"}'}</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>externalSandbox</strong>
                    <p>{'{"type":"externalSandbox","networkAccess":"enabled"}'}</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>workspaceWrite</strong>
                    <p>{'{"type":"workspaceWrite","networkAccess":true}'}</p>
                  </article>
                  <article className="config-helper-card">
                    <strong>Approval</strong>
                    <p>
                      {i18n._({
                        id: 'Use `never` together with `dangerFullAccess` when you want a fully unsandboxed, no-approval turn.',
                        message:
                          'Use `never` together with `dangerFullAccess` when you want a fully unsandboxed, no-approval turn.',
                      })}
                    </p>
                  </article>
                </div>
                <div className="setting-row__actions" style={{ marginTop: 12 }}>
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    onClick={() => applyExecutionPreset('danger-full-access')}
                    type="button"
                  >
                    {i18n._({
                      id: 'Load DangerFullAccess',
                      message: 'Load DangerFullAccess',
                    })}
                  </button>
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    onClick={() => applyExecutionPreset('external-sandbox')}
                    type="button"
                  >
                    {i18n._({
                      id: 'Load ExternalSandbox',
                      message: 'Load ExternalSandbox',
                    })}
                  </button>
                  <button
                    className="ide-button ide-button--secondary ide-button--sm"
                    onClick={() => applyExecutionPreset('inherit')}
                    type="button"
                  >
                    {i18n._({
                      id: 'Clear Execution Preset',
                      message: 'Clear Execution Preset',
                    })}
                  </button>
                </div>
              </details>

              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  if (workspaceId) {
                    writeShellEnvironmentPolicyMutation.mutate()
                  }
                }}
              >
                <div className="config-card__header">
                  <strong>
                    {i18n._({
                      id: 'Shell Environment Policy',
                      message: 'Shell Environment Policy',
                    })}
                  </strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyShellEnvironmentPolicyPreset('inherit-all')}
                      type="button"
                    >
                      {i18n._({ id: 'Load inherit=all', message: 'Load inherit=all' })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyShellEnvironmentPolicyPreset('inherit-core-windows')}
                      type="button"
                    >
                      {i18n._({ id: 'Load core+Windows', message: 'Load core+Windows' })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => applyShellEnvironmentPolicyPreset('clear')}
                      type="button"
                    >
                      {i18n._({ id: 'Clear', message: 'Clear' })}
                    </button>
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      disabled={!workspaceId}
                      type="submit"
                    >
                      {writeShellEnvironmentPolicyMutation.isPending
                        ? i18n._({ id: 'Saving…', message: 'Saving…' })
                        : i18n._({ id: 'Save Policy', message: 'Save Policy' })}
                    </button>
                  </div>
                </div>
                <div className="form-stack">
                  <p className="config-inline-note">
                    {i18n._({
                      id: '`codex-server` does not override `shell_environment_policy` when launching app-server. This writes the Codex config value directly, so it affects `shell`, `unified_exec`, `command/exec`, and `thread/shellCommand`.',
                      message:
                        '`codex-server` does not override `shell_environment_policy` when launching app-server. This writes the Codex config value directly, so it affects `shell`, `unified_exec`, `command/exec`, and `thread/shellCommand`.',
                    })}
                  </p>
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'On Windows, `inherit = "core"` can break command resolution unless you also restore variables like `PATHEXT`, `SystemRoot`, and `ComSpec`.',
                      message:
                        'On Windows, `inherit = "core"` can break command resolution unless you also restore variables like `PATHEXT`, `SystemRoot`, and `ComSpec`.',
                    })}
                  </p>
                  <label className="field">
                    <span>
                      shell_environment_policy (JSON)
                      <FieldHint
                        label={i18n._({
                          id: 'Explain shell environment policy',
                          message: 'Explain shell environment policy',
                        })}
                        text={i18n._({
                          id: 'Writes the shell_environment_policy object into Codex config.toml. Use inherit=all for safest compatibility, or inherit=core with explicit Windows variables when minimizing inherited environment.',
                          message:
                            'Writes the shell_environment_policy object into Codex config.toml. Use inherit=all for safest compatibility, or inherit=core with explicit Windows variables when minimizing inherited environment.',
                        })}
                      />
                    </span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setShellEnvironmentPolicyInput(event.target.value)}
                      placeholder='{"inherit":"all"}'
                      rows={8}
                      value={shellEnvironmentPolicyInput}
                    />
                  </label>
                </div>
              </form>

              {writeShellEnvironmentPolicyMutation.error && (
                <InlineNotice
                  details={getErrorMessage(writeShellEnvironmentPolicyMutation.error)}
                  dismissible
                  noticeKey="shell-environment-policy-write-error"
                  title={i18n._({
                    id: 'Shell Environment Policy Update Failed',
                    message: 'Shell Environment Policy Update Failed',
                  })}
                  tone="error"
                >
                  {getErrorMessage(writeShellEnvironmentPolicyMutation.error)}
                </InlineNotice>
              )}

              {writeRuntimePreferencesMutation.error && (
                <InlineNotice
                  details={getErrorMessage(writeRuntimePreferencesMutation.error)}
                  dismissible
                  noticeKey="runtime-write-error"
                  title={i18n._({ id: 'Update Failed', message: 'Update Failed' })}
                  tone="error"
                >
                  {getErrorMessage(writeRuntimePreferencesMutation.error)}
                </InlineNotice>
              )}
            </div>

            <div className="config-workbench__side-panel">
              <div className="config-card config-card--muted">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Status & Inspection', message: 'Status & Inspection' })}</strong>
                </div>
                {runtimePreferencesQuery.data ? (
                  <Tabs
                    ariaLabel={i18n._({
                      id: 'Runtime inspection tabs',
                      message: 'Runtime inspection tabs',
                    })}
                    className="config-workbench__panel"
                    storageKey="settings-config-runtime-side-tabs"
                    items={[
                      {
                        id: 'effective',
                        label: i18n._({ id: 'Effective', message: 'Effective' }),
                        icon: <TerminalIcon />,
                        content: (
                          <SettingsJsonPreview
                            description={i18n._({
                              id: 'Current resolved runtime state.',
                              message: 'Current resolved runtime state.',
                            })}
                            title={i18n._({
                              id: 'Effective Values',
                              message: 'Effective Values',
                            })}
                            value={{
                              modelCatalogPath: runtimePreferencesQuery.data.effectiveModelCatalogPath,
                              defaultShellType: runtimePreferencesQuery.data.effectiveDefaultShellType,
                              modelShellTypeOverrides: runtimePreferencesQuery.data.effectiveModelShellTypeOverrides,
                              defaultTurnApprovalPolicy: runtimePreferencesQuery.data.effectiveDefaultTurnApprovalPolicy,
                              defaultTurnSandboxPolicy: runtimePreferencesQuery.data.effectiveDefaultTurnSandboxPolicy,
                              defaultCommandSandboxPolicy: runtimePreferencesQuery.data.effectiveDefaultCommandSandboxPolicy,
                              command: runtimePreferencesQuery.data.effectiveCommand,
                            }}
                          />
                        ),
                      },
                      {
                        id: 'configured',
                        label: i18n._({ id: 'Configured', message: 'Configured' }),
                        icon: <ContextIcon />,
                        content: (
                          <SettingsJsonPreview
                            description={i18n._({
                              id: 'Values saved in codex-server database.',
                              message: 'Values saved in codex-server database.',
                            })}
                            title={i18n._({ id: 'Saved Values', message: 'Saved Values' })}
                            value={{
                              modelCatalogPath: runtimePreferencesQuery.data.configuredModelCatalogPath,
                              defaultShellType: runtimePreferencesQuery.data.configuredDefaultShellType,
                              modelShellTypeOverrides: runtimePreferencesQuery.data.configuredModelShellTypeOverrides,
                              defaultTurnApprovalPolicy: runtimePreferencesQuery.data.configuredDefaultTurnApprovalPolicy,
                              defaultTurnSandboxPolicy: runtimePreferencesQuery.data.configuredDefaultTurnSandboxPolicy,
                              defaultCommandSandboxPolicy: runtimePreferencesQuery.data.configuredDefaultCommandSandboxPolicy,
                            }}
                          />
                        ),
                      },
                    ]}
                  />
                ) : (
                  <div className="notice">
                    {i18n._({
                      id: 'Loading runtime preferences…',
                      message: 'Loading runtime preferences…',
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'advanced',
      label: i18n._({ id: 'Advanced', message: 'Advanced' }),
      icon: <TerminalIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <form
                className="config-card"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault()
                  if (workspaceId) {
                    writeConfigMutation.mutate()
                  }
                }}
              >
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Direct JSON Write', message: 'Direct JSON Write' })}</strong>
                  <button className="ide-button ide-button--primary ide-button--sm" disabled={!workspaceId} type="submit">
                    {writeConfigMutation.isPending
                      ? i18n._({ id: 'Writing…', message: 'Writing…' })
                      : i18n._({ id: 'Write Key', message: 'Write Key' })}
                  </button>
                </div>
                <div className="form-stack">
                  <label className="field">
                    <span>{i18n._({ id: 'Key Path', message: 'Key Path' })}</span>
                    <input onChange={(event) => setConfigKeyPath(event.target.value)} value={configKeyPath} />
                  </label>
                  <label className="field">
                    <span>{i18n._({ id: 'Value (JSON)', message: 'Value (JSON)' })}</span>
                    <textarea
                      className="ide-textarea"
                      onChange={(event) => setConfigValue(event.target.value)}
                      rows={4}
                      value={configValue}
                    />
                  </label>
                </div>
              </form>

              <div className="config-details-box">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Common Key Paths', message: 'Common Key Paths' })}</strong>
                </div>
                <div className="config-helper-grid config-helper-grid--compact">
                  <div className="config-helper-card">
                    <code>model</code>
                    <small>{i18n._({ id: 'Model identifier', message: 'Model identifier' })}</small>
                  </div>
                  <div className="config-helper-card">
                    <code>sandbox_mode</code>
                    <small>{i18n._({ id: 'local or container', message: 'local or container' })}</small>
                  </div>
                  <div className="config-helper-card">
                    <code>approval_policy</code>
                    <small>{i18n._({ id: 'Approval logic', message: 'Approval logic' })}</small>
                  </div>
                </div>
              </div>

              {writeConfigMutation.error && (
                <InlineNotice
                  details={getErrorMessage(writeConfigMutation.error)}
                  dismissible
                  noticeKey="write-config-error"
                  title={i18n._({ id: 'Write Failed', message: 'Write Failed' })}
                  tone="error"
                >
                  {getErrorMessage(writeConfigMutation.error)}
                </InlineNotice>
              )}
            </div>

            <div className="config-workbench__side-panel">
              <div className="config-card config-card--muted">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Resolved Analysis', message: 'Resolved Analysis' })}</strong>
                </div>
                <Tabs
                  ariaLabel={i18n._({
                    id: 'Resolved analysis tabs',
                    message: 'Resolved analysis tabs',
                  })}
                  className="config-workbench__panel"
                  storageKey="settings-config-advanced-side-tabs"
                  items={[
                    {
                      id: 'config',
                      label: i18n._({ id: 'Current Config', message: 'Current Config' }),
                      icon: <ContextIcon />,
                      content: configQuery.isLoading ? (
                        <div className="notice">
                          {i18n._({
                            id: 'Loading configuration…',
                            message: 'Loading configuration…',
                          })}
                        </div>
                      ) : configQuery.data ? (
                        <SettingsJsonPreview
                          collapsible
                          defaultExpanded={false}
                          description={i18n._({
                            id: 'Final merged configuration including all layers.',
                            message: 'Final merged configuration including all layers.',
                          })}
                          title={i18n._({ id: 'Effective Config', message: 'Effective Config' })}
                          value={configQuery.data.config}
                        />
                      ) : (
                        <div className="empty-state">
                          {i18n._({
                            id: 'Configuration data is unavailable.',
                            message: 'Configuration data is unavailable.',
                          })}
                        </div>
                      ),
                    },
                    {
                      id: 'requirements',
                      label: i18n._({ id: 'Requirements', message: 'Requirements' }),
                      icon: <FeedIcon />,
                      content: requirementsQuery.data ? (
                        <SettingsJsonPreview
                          collapsible
                          defaultExpanded={false}
                          description={i18n._({
                            id: 'Validation status and requirements.',
                            message: 'Validation status and requirements.',
                          })}
                          title={i18n._({ id: 'Requirements', message: 'Requirements' })}
                          value={requirementsQuery.data.requirements ?? null}
                        />
                      ) : (
                        <div className="empty-state">
                          {i18n._({
                            id: 'No requirements payload returned.',
                            message: 'No requirements payload returned.',
                          })}
                        </div>
                      ),
                    },
                  ]}
                />
                {configQuery.error && (
                  <InlineNotice
                  details={getErrorMessage(configQuery.error)}
                  onRetry={() => void queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] })}
                  title={i18n._({ id: 'Read Error', message: 'Read Error' })}
                  tone="error"
                >
                    {getErrorMessage(configQuery.error)}
                  </InlineNotice>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
    },
    {
      id: 'migration',
      label: i18n._({ id: 'Migration', message: 'Migration' }),
      icon: <RefreshIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <div className="config-card">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Migration Console', message: 'Migration Console' })}</strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--primary ide-button--sm"
                      disabled={!workspaceId}
                      onClick={() => detectExternalMutation.mutate()}
                      type="button"
                    >
                      {i18n._({ id: 'Scan', message: 'Scan' })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={!workspaceId || importExternalMutation.isPending || !detectExternalMutation.data?.items?.length}
                      onClick={() => importExternalMutation.mutate()}
                      type="button"
                    >
                      {i18n._({ id: 'Import', message: 'Import' })}
                    </button>
                  </div>
                </div>
                <p className="config-inline-note">
                  {i18n._({
                    id: 'Search for and import state from external agents on this machine.',
                    message: 'Search for and import state from external agents on this machine.',
                  })}
                </p>
              </div>

              <details className="config-details-box">
                <summary className="config-details-box__summary">
                  <span>{i18n._({ id: 'Migration Workflow', message: 'Migration Workflow' })}</span>
                  <small>
                    {i18n._({
                      id: 'How to safely migrate your state',
                      message: 'How to safely migrate your state',
                    })}
                  </small>
                </summary>
                <div className="config-helper-grid config-helper-grid--compact">
                  <article className="config-helper-card">
                    <strong>1. Scan</strong>
                    <p>
                      {i18n._({
                        id: 'Detect artifacts in home & local scopes.',
                        message: 'Detect artifacts in home & local scopes.',
                      })}
                    </p>
                  </article>
                  <article className="config-helper-card">
                    <strong>2. Review</strong>
                    <p>
                      {i18n._({
                        id: 'Verify detected items in the side panel.',
                        message: 'Verify detected items in the side panel.',
                      })}
                    </p>
                  </article>
                  <article className="config-helper-card">
                    <strong>3. Import</strong>
                    <p>
                      {i18n._({
                        id: 'Merge items into active workspace.',
                        message: 'Merge items into active workspace.',
                      })}
                    </p>
                  </article>
                </div>
              </details>

              {detectExternalMutation.error && (
                <InlineNotice
                  details={getErrorMessage(detectExternalMutation.error)}
                  onRetry={() => detectExternalMutation.mutate()}
                  title={i18n._({ id: 'Scan Failed', message: 'Scan Failed' })}
                  tone="error"
                >
                  {getErrorMessage(detectExternalMutation.error)}
                </InlineNotice>
              )}
            </div>

            <div className="config-workbench__side-panel">
              <div className="config-card config-card--muted">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Detected State', message: 'Detected State' })}</strong>
                </div>
                <Tabs
                  ariaLabel={i18n._({
                    id: 'Migration inspection tabs',
                    message: 'Migration inspection tabs',
                  })}
                  className="config-workbench__panel"
                  storageKey="settings-config-migration-side-tabs"
                  items={[
                    {
                      id: 'workflow',
                      label: i18n._({ id: 'Workflow', message: 'Workflow' }),
                      icon: <SettingsIcon />,
                      content: (
                        <div className="config-helper-grid config-helper-grid--compact">
                          <article className="config-helper-card">
                            <strong>1. Scan</strong>
                            <p>
                              {i18n._({
                                id: 'Discover candidate artifacts from local and home scopes.',
                                message: 'Discover candidate artifacts from local and home scopes.',
                              })}
                            </p>
                          </article>
                          <article className="config-helper-card">
                            <strong>2. Review</strong>
                            <p>
                              {i18n._({
                                id: 'Inspect the detected payload before you import it.',
                                message: 'Inspect the detected payload before you import it.',
                              })}
                            </p>
                          </article>
                          <article className="config-helper-card">
                            <strong>3. Import</strong>
                            <p>
                              {i18n._({
                                id: 'Apply the detected state into the active workspace.',
                                message: 'Apply the detected state into the active workspace.',
                              })}
                            </p>
                          </article>
                        </div>
                      ),
                    },
                    {
                      id: 'detected',
                      label: i18n._({ id: 'Detected', message: 'Detected' }),
                      icon: <RefreshIcon />,
                      badge: detectExternalMutation.data?.items?.length ?? null,
                      content: detectExternalMutation.data ? (
                        <SettingsJsonPreview
                          collapsible
                          description={i18n._({
                            id: 'Candidate artifacts ready for migration.',
                            message: 'Candidate artifacts ready for migration.',
                          })}
                          title={i18n._({ id: 'Detected Items', message: 'Detected Items' })}
                          value={detectExternalMutation.data.items}
                        />
                      ) : (
                        <div className="empty-state">
                          {i18n._({
                            id: 'Run a scan to see migration items.',
                            message: 'Run a scan to see migration items.',
                          })}
                        </div>
                      ),
                    },
                  ]}
                />
                {importExternalMutation.error && (
                  <InlineNotice
                    details={getErrorMessage(importExternalMutation.error)}
                    title={i18n._({ id: 'Import Failed', message: 'Import Failed' })}
                    tone="error"
                  >
                    {getErrorMessage(importExternalMutation.error)}
                  </InlineNotice>
                )}
              </div>
            </div>
          </div>
        </div>
      ),
    },
  ]

  return (
    <section className="settings-page">
      <SettingsPageHeader
        description={i18n._({
          id: 'Manage workspace-scoped runtime values, advanced JSON configurations, and environment migrations.',
          message:
            'Manage workspace-scoped runtime values, advanced JSON configurations, and environment migrations.',
        })}
        meta={
          <>
            <span className="meta-pill">{workspaceName}</span>
            <span className="meta-pill">
              {i18n._({
                id: '{count} config layers',
                message: '{count} config layers',
                values: { count: configLayerCount },
              })}
            </span>
          </>
        }
        title={i18n._({ id: 'Config', message: 'Config' })}
      />

      <Tabs
        ariaLabel={i18n._({
          id: 'Config navigation tabs',
          message: 'Config navigation tabs',
        })}
        className="config-main-tabs"
        storageKey="settings-config-main-tabs"
        items={configTabs}
      />
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

const approvalPolicyOptions = [
  { value: '', label: 'Follow runtime default', triggerLabel: '默认' },
  { value: 'untrusted', label: 'Untrusted', triggerLabel: 'Untrusted' },
  { value: 'on-failure', label: 'On Failure', triggerLabel: 'Failure' },
  { value: 'on-request', label: 'On Request', triggerLabel: 'Request' },
  { value: 'never', label: 'Never', triggerLabel: 'Never' },
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

function parseSandboxPolicyInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return undefined
  }

  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Sandbox Policy must be a JSON object')
  }

  return parsed as Record<string, unknown>
}

function parseShellEnvironmentPolicyInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('shell_environment_policy must be a JSON object')
  }

  return parsed as Record<string, unknown>
}

function stringifyJsonInput(value: unknown) {
  if (!value || typeof value !== 'object') {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function formatApprovalPolicyLabel(value?: string | null) {
  switch ((value ?? '').trim()) {
    case 'untrusted':
      return 'untrusted'
    case 'on-failure':
      return 'on-failure'
    case 'on-request':
      return 'on-request'
    case 'never':
      return 'never'
    default:
      return 'inherit'
  }
}

function formatSandboxPolicyLabel(value?: Record<string, unknown> | null) {
  if (!value || typeof value !== 'object') {
    return 'inherit'
  }

  const rawType = typeof value.type === 'string' ? value.type : ''
  if (!rawType) {
    return 'inherit'
  }

  if (rawType === 'externalSandbox' && typeof value.networkAccess === 'string') {
    return `externalSandbox:${value.networkAccess}`
  }

  if (
    (rawType === 'workspaceWrite' || rawType === 'readOnly') &&
    typeof value.networkAccess === 'boolean'
  ) {
    return `${rawType}:${value.networkAccess ? 'network' : 'offline'}`
  }

  return rawType
}

function FieldHint({ label, text }: { label: string; text: string }) {
  return (
    <Tooltip content={text} position="top" triggerLabel={label}>
      <span aria-hidden="true" className="field-hint">
        ?
      </span>
    </Tooltip>
  )
}
