import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'

import {
  ConfigHelperCard,
  SettingsJsonPreview,
  SettingsPageHeader,
} from '../../components/settings/SettingsPrimitives'
import { SettingsJsonDiffPreview } from '../../components/settings/SettingsJsonDiffPreview'
import { InlineNotice } from '../../components/ui/InlineNotice'
import { SettingsWorkspaceScopePanel, type SettingsSummaryItem } from '../../components/settings/SettingsWorkspaceScopePanel'
import {
  batchWriteConfig,
  detectExternalAgentConfig,
  importExternalAgentConfig,
  importRuntimeModelCatalogTemplate,
  readConfig,
  readConfigRequirements,
  readRuntimePreferences,
  writeConfigValue,
  writeRuntimePreferences,
} from '../../features/settings/api'
import {
  type ConfigScenarioMatch,
  getAdvancedConfigScenarios,
  getBestMatchingConfigScenario,
  getConfigScenarioMatch,
  getConfigScenarioDiff,
} from '../../features/settings/config-scenarios'
import {
  getSuggestedConfigTemplate,
  getRuntimeSensitiveConfigItem,
  isRuntimeSensitiveConfigKey,
  runtimeSensitiveConfigItems,
} from '../../features/settings/runtime-sensitive-config'
import { useSettingsShellContext } from '../../features/settings/shell-context'
import { Input } from '../../components/ui/Input'
import { TextArea } from '../../components/ui/TextArea'
import { i18n } from '../../i18n/runtime'
import { formatLocaleDateTime } from '../../i18n/format'
import { getErrorMessage } from '../../lib/error-utils'
import { SelectControl, type SelectOption } from '../../components/ui/SelectControl'
import { activateStoredTab, Tabs } from '../../components/ui/Tabs'
import { useUIStore } from '../../stores/ui-store'
import { ContextIcon, FeedIcon, RefreshIcon, SettingsIcon, SparkIcon, TerminalIcon } from '../../components/ui/RailControls'
import { getWorkspaceRuntimeState, restartWorkspace } from '../../features/workspaces/api'

export function ConfigSettingsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { workspaceId, workspaceName } = useSettingsShellContext()
  const pushToast = useUIStore((state) => state.pushToast)
  const [configKeyPath, setConfigKeyPath] = useState('model')
  const [configValue, setConfigValue] = useState('"gpt-5.4"')
  const [modelCatalogPath, setModelCatalogPath] = useState('')
  const [defaultShellType, setDefaultShellType] = useState('')
  const [defaultTerminalShell, setDefaultTerminalShell] = useState('')
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
  const workspaceRuntimeStateQuery = useQuery({
    queryKey: ['environment-runtime-state', workspaceId],
    enabled: Boolean(workspaceId),
    queryFn: () => getWorkspaceRuntimeState(workspaceId!),
  })
  const directWriteRuntimeSensitiveItem = getRuntimeSensitiveConfigItem(configKeyPath)
  const suggestedConfigTemplate = getSuggestedConfigTemplate(configKeyPath)
  const advancedConfigScenarios = getAdvancedConfigScenarios()
  const advancedScenarioMatches = useMemo(
    () =>
      advancedConfigScenarios.map((scenario) =>
        getConfigScenarioMatch(configQuery.data?.config, scenario),
      ),
    [advancedConfigScenarios, configQuery.data?.config],
  )
  const bestMatchingAdvancedScenario = useMemo(
    () => getBestMatchingConfigScenario(configQuery.data?.config, advancedConfigScenarios),
    [advancedConfigScenarios, configQuery.data?.config],
  )

  function buildRuntimePreferencesPayload(input?: {
    modelCatalogPath?: string
    defaultShellType?: string
    defaultTerminalShell?: string
    modelShellTypeOverrides?: Record<string, string>
    defaultTurnApprovalPolicy?: string
    defaultTurnSandboxPolicy?: Record<string, unknown>
    defaultCommandSandboxPolicy?: Record<string, unknown>
  }) {
    return {
      modelCatalogPath: (input?.modelCatalogPath ?? modelCatalogPath).trim(),
      defaultShellType: input?.defaultShellType ?? defaultShellType,
      defaultTerminalShell: input?.defaultTerminalShell ?? defaultTerminalShell,
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

  const restartRuntimeMutation = useMutation({
    mutationFn: () => restartWorkspace(workspaceId!),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-runtime-state', workspaceId] }),
      ])
      pushToast({
        title: i18n._({
          id: 'Runtime restarted',
          message: 'Runtime restarted',
        }),
        message: i18n._({
          id: 'The selected workspace runtime has been restarted and will reload tracked config from app-server startup.',
          message:
            'The selected workspace runtime has been restarted and will reload tracked config from app-server startup.',
        }),
        tone: 'success',
      })
    },
  })

  const writeConfigMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: configKeyPath,
        mergeStrategy: 'upsert',
        value: parseJsonInput(configValue),
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-runtime-state', workspaceId] }),
      ])
      const runtimeSensitiveItem =
        result.matchedRuntimeSensitiveKey
          ? getRuntimeSensitiveConfigItem(result.matchedRuntimeSensitiveKey)
          : null
      pushToast({
        title: result.runtimeReloadRequired
          ? i18n._({
              id: 'Config saved, restart recommended',
              message: 'Config saved, restart recommended',
            })
          : i18n._({
              id: 'Config key saved',
              message: 'Config key saved',
            }),
        message: result.runtimeReloadRequired
          ? i18n._({
              id: 'Key path {keyPath} matched runtime-sensitive prefix {matchedKey}. The backend marked this write as requiring runtime reload before the live app-server process is guaranteed to reflect the new value.',
              message:
                'Key path {keyPath} matched runtime-sensitive prefix {matchedKey}. The backend marked this write as requiring runtime reload before the live app-server process is guaranteed to reflect the new value.',
              values: {
                keyPath: configKeyPath,
                matchedKey:
                  result.matchedRuntimeSensitiveKey ??
                  runtimeSensitiveItem?.keyPath ??
                  i18n._({ id: 'unknown', message: 'unknown' }),
              },
            })
          : i18n._({
              id: 'The config value was written successfully.',
              message: 'The config value was written successfully.',
            }),
        tone: result.runtimeReloadRequired ? 'info' : 'success',
        actionLabel: result.runtimeReloadRequired
          ? i18n._({ id: 'Restart Runtime', message: 'Restart Runtime' })
          : undefined,
        onAction: result.runtimeReloadRequired
          ? () => {
              if (!workspaceId || restartRuntimeMutation.isPending) {
                return
              }
              restartRuntimeMutation.mutate()
            }
          : undefined,
      })
    },
  })
  const writeShellEnvironmentPolicyMutation = useMutation({
    mutationFn: () =>
      writeConfigValue(workspaceId!, {
        keyPath: 'shell_environment_policy',
        mergeStrategy: 'upsert',
        value: parseShellEnvironmentPolicyInput(shellEnvironmentPolicyInput),
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-runtime-state', workspaceId] }),
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
        actionLabel: result.runtimeReloadRequired
          ? i18n._({ id: 'Restart Runtime', message: 'Restart Runtime' })
          : undefined,
        onAction: result.runtimeReloadRequired
          ? () => {
              if (!workspaceId || restartRuntimeMutation.isPending) {
                return
              }
              restartRuntimeMutation.mutate()
            }
          : undefined,
      })
    },
  })
  const applyConfigScenarioMutation = useMutation({
    mutationFn: async (scenarioId: string) => {
      const scenario = advancedConfigScenarios.find((item) => item.id === scenarioId)
      if (!scenario || !workspaceId) {
        throw new Error('Scenario or workspace is unavailable.')
      }

      await batchWriteConfig(workspaceId, {
        edits: scenario.edits.map((edit) => ({
          keyPath: edit.keyPath,
          mergeStrategy: 'upsert',
          value: edit.value,
        })),
        reloadUserConfig: true,
      })

      return restartWorkspace(workspaceId)
    },
    onSuccess: async (_, scenarioId) => {
      const scenario = advancedConfigScenarios.find((item) => item.id === scenarioId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings-config', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-requirements', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['settings-shell-workspaces'] }),
        queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['environment-runtime-state', workspaceId] }),
      ])
      pushToast({
        title: i18n._({
          id: 'Scenario applied and runtime restarted',
          message: 'Scenario applied and runtime restarted',
        }),
        message:
          scenario?.title ??
          i18n._({
            id: 'The selected config scenario was applied and the workspace runtime restarted.',
            message: 'The selected config scenario was applied and the workspace runtime restarted.',
          }),
        tone: 'success',
      })
    },
  })
  const writeRuntimePreferencesMutation = useMutation({
    mutationFn: async (input?: {
      modelCatalogPath?: string
      defaultShellType?: string
      defaultTerminalShell?: string
      modelShellTypeOverrides?: Record<string, string>
      defaultTurnApprovalPolicy?: string
      defaultTurnSandboxPolicy?: Record<string, unknown>
      defaultCommandSandboxPolicy?: Record<string, unknown>
    }) => writeRuntimePreferences(buildRuntimePreferencesPayload(input)),
    onSuccess: async (result) => {
      setModelCatalogPath(result.configuredModelCatalogPath)
      setDefaultShellType(result.configuredDefaultShellType)
      setDefaultTerminalShell(result.configuredDefaultTerminalShell)
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
        result.effectiveDefaultShellType || i18n._({ id: 'catalog default', message: 'catalog default' })
      const terminalLabel = formatTerminalShellLabel(result.effectiveDefaultTerminalShell)
      pushToast({
        title: i18n._({
          id: 'Runtime overrides applied',
          message: 'Runtime overrides applied',
        }),
        message: i18n._({
          id: 'Shell: {shell}; terminal: {terminal}; turn sandbox: {turnSandbox}; command sandbox: {commandSandbox}.',
          message: 'Shell: {shell}; terminal: {terminal}; turn sandbox: {turnSandbox}; command sandbox: {commandSandbox}.',
          values: {
            shell: shellLabel,
            terminal: terminalLabel,
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
      setDefaultTerminalShell(result.configuredDefaultTerminalShell)
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
    setDefaultTerminalShell(runtimePreferencesQuery.data.configuredDefaultTerminalShell)
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
  const shellTypeOptions = getShellTypeOptions()
  const terminalShellOptions = getTerminalShellOptions(
    runtimePreferencesQuery.data?.supportedTerminalShells ?? [],
    defaultTerminalShell,
  )
  const approvalPolicyOptions = getApprovalPolicyOptions()
  const directWriteRequiresRestart = isRuntimeSensitiveConfigKey(configKeyPath)
  const runtimeSummary = {
    catalogBound: Boolean(runtimePreferencesQuery.data?.effectiveModelCatalogPath),
    defaultShellType:
      runtimePreferencesQuery.data?.effectiveDefaultShellType ||
      i18n._({
        id: 'runtime default',
        message: 'runtime default',
      }),
    defaultTerminalShell: formatTerminalShellLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTerminalShell,
    ),
    turnApprovalPolicy: formatApprovalPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTurnApprovalPolicy,
    ),
    turnSandboxPolicy: formatSandboxPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultTurnSandboxPolicy,
    ),
    commandSandboxPolicy: formatSandboxPolicyLabel(
      runtimePreferencesQuery.data?.effectiveDefaultCommandSandboxPolicy,
    ),
    configLoadStatus:
      workspaceRuntimeStateQuery.data?.configLoadStatus ??
      i18n._({ id: 'initial', message: 'initial' }),
    restartRequired: workspaceRuntimeStateQuery.data?.restartRequired ?? false,
  }

  const runtimeSummaryItems: SettingsSummaryItem[] = [
    {
      label: i18n._({ id: 'Catalog', message: 'Catalog' }),
      value: runtimeSummary.catalogBound
        ? i18n._({ id: 'Attached', message: 'Attached' })
        : i18n._({ id: 'Missing', message: 'Missing' }),
      tone: runtimeSummary.catalogBound ? 'active' : 'paused',
    },
    {
      label: i18n._({ id: 'Shell', message: 'Shell' }),
      value: runtimeSummary.defaultShellType,
    },
    {
      label: i18n._({ id: 'Terminal', message: 'Terminal' }),
      value: runtimeSummary.defaultTerminalShell,
    },
    {
      label: i18n._({ id: 'Turn', message: 'Turn' }),
      value: runtimeSummary.turnSandboxPolicy,
    },
    {
      label: i18n._({ id: 'Command', message: 'Command' }),
      value: runtimeSummary.commandSandboxPolicy,
    },
    {
      label: i18n._({ id: 'Approval', message: 'Approval' }),
      value: runtimeSummary.turnApprovalPolicy,
    },
    {
      label: i18n._({ id: 'Config', message: 'Config' }),
      value: runtimeSummary.configLoadStatus,
      tone: runtimeSummary.restartRequired ? 'paused' : 'active',
    },
  ]

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

  const scenarioPresetDefaultTabId =
    bestMatchingAdvancedScenario?.scenario.id ?? advancedScenarioMatches[0]?.scenario.id
  const scenarioPresetTabItems = advancedScenarioMatches.map((match) => ({
    id: match.scenario.id,
    label: match.scenario.title,
    badge: `${match.matchedEditCount}/${match.totalEditCount}`,
    content: (
      <div className="config-card config-card--muted config-scenario-panel">
        <div className="config-card__header config-scenario-panel__header">
          <div className="config-scenario-panel__heading">
            <strong>{match.scenario.title}</strong>
            <p className="config-inline-note">{match.scenario.description}</p>
          </div>
          <span className={getScenarioMatchStatusClassName(match)}>
            {getScenarioMatchStatusLabel(match)}
          </span>
        </div>
        <p className="config-inline-note">
          {match.exact
            ? i18n._({ id: 'Exact match', message: 'Exact match' })
            : i18n._({
                id: '{matched}/{total} edits matched',
                message: '{matched}/{total} edits matched',
                values: {
                  matched: match.matchedEditCount,
                  total: match.totalEditCount,
                },
              })}
        </p>
        <SettingsJsonPreview
          collapsible={false}
          description={i18n._({
            id: 'Edits that will be written before runtime restart.',
            message: 'Edits that will be written before runtime restart.',
          })}
          title={i18n._({ id: 'Scenario Edits', message: 'Scenario Edits' })}
          value={match.scenario.edits}
        />
        <SettingsJsonDiffPreview
          description={i18n._({
            id: 'Only keys whose values differ from the current config will change.',
            message: 'Only keys whose values differ from the current config will change.',
          })}
          entries={getConfigScenarioDiff(configQuery.data?.config, match.scenario)}
          title={i18n._({ id: 'Scenario Diff', message: 'Scenario Diff' })}
        />
        <div className="setting-row__actions config-scenario-panel__actions">
          <button
            className="ide-button ide-button--secondary ide-button--sm"
            disabled={!workspaceId || applyConfigScenarioMutation.isPending}
            onClick={() => applyConfigScenarioMutation.mutate(match.scenario.id)}
            type="button"
          >
            {applyConfigScenarioMutation.isPending
              ? i18n._({ id: 'Applying…', message: 'Applying…' })
              : i18n._({ id: 'Apply & Restart', message: 'Apply & Restart' })}
          </button>
        </div>
      </div>
    ),
  }))

  const configTabs = [
    {
      id: 'runtime',
      label: i18n._({ id: 'Runtime', message: 'Runtime' }),
      icon: <SparkIcon />,
      content: (
        <div className="config-workbench">
          <div className="config-workbench__header">
            <div className="config-workbench__header-main">
              <SettingsWorkspaceScopePanel extraSummaryItems={runtimeSummaryItems} />
            </div>
          </div>

          <div className="config-workbench__body">
            <div className="config-workbench__main-panel">
              <div className="config-card">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Runtime Actions', message: 'Runtime Actions' })}</strong>
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={!workspaceId || restartRuntimeMutation.isPending}
                      onClick={() => restartRuntimeMutation.mutate()}
                      type="button"
                    >
                      {restartRuntimeMutation.isPending
                        ? i18n._({ id: 'Restarting…', message: 'Restarting…' })
                        : i18n._({ id: 'Restart Runtime', message: 'Restart Runtime' })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      onClick={() => navigate('/settings/environment')}
                      type="button"
                    >
                      {i18n._({
                        id: 'Open Runtime Inspection',
                        message: 'Open Runtime Inspection',
                      })}
                    </button>
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={
                        !workspaceId ||
                        applyConfigScenarioMutation.isPending ||
                        !bestMatchingAdvancedScenario
                      }
                      onClick={() =>
                        bestMatchingAdvancedScenario &&
                        applyConfigScenarioMutation.mutate(bestMatchingAdvancedScenario.scenario.id)
                      }
                      type="button"
                    >
                      {applyConfigScenarioMutation.isPending
                        ? i18n._({ id: 'Applying…', message: 'Applying…' })
                        : i18n._({
                            id: 'Apply Nearest Scenario',
                            message: 'Apply Nearest Scenario',
                          })}
                    </button>
                  </div>
                </div>
                <div className="form-stack">
                  <p className="config-inline-note">
                    {bestMatchingAdvancedScenario
                      ? i18n._({
                          id: 'Nearest built-in scenario: {title} ({matched}/{total} edits matched).',
                          message:
                            'Nearest built-in scenario: {title} ({matched}/{total} edits matched).',
                          values: {
                            title: bestMatchingAdvancedScenario.scenario.title,
                            matched: bestMatchingAdvancedScenario.matchedEditCount,
                            total: bestMatchingAdvancedScenario.totalEditCount,
                          },
                        })
                      : i18n._({
                          id: 'No built-in scenario currently matches the active config closely enough.',
                          message:
                            'No built-in scenario currently matches the active config closely enough.',
                        })}
                  </p>
                  {workspaceRuntimeStateQuery.data ? (
                    <InlineNotice
                      noticeKey={`config-runtime-load-status-${workspaceId}-${workspaceRuntimeStateQuery.data.configLoadStatus}`}
                      title={i18n._({ id: 'Config Load Status', message: 'Config Load Status' })}
                      tone={workspaceRuntimeStateQuery.data.restartRequired ? 'error' : 'info'}
                    >
                      {workspaceRuntimeStateQuery.data.restartRequired
                        ? i18n._({
                            id: 'Restart required: the tracked runtime-affecting config changed after the current runtime started.',
                            message:
                              'Restart required: the tracked runtime-affecting config changed after the current runtime started.',
                          })
                        : i18n._({
                            id: 'Runtime is aligned with the last tracked runtime-affecting config change, or no tracked change exists.',
                            message:
                              'Runtime is aligned with the last tracked runtime-affecting config change, or no tracked change exists.',
                          })}
                    </InlineNotice>
                  ) : null}
                </div>
              </div>

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
                          defaultTerminalShell: '',
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
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata.',
                      message:
                        'Path to the full model catalog JSON file. codex-server uses this file as the source when it needs to rewrite shell_type metadata.',
                    })}
                  </p>

                  <div className="form-row" style={{ gridTemplateColumns: '1fr 200px 220px' }}>
                    <div className="field-group">
                      <div className="input-with-action">
                        <Input
                          label={i18n._({ id: 'Catalog Path', message: 'Catalog Path' })}
                          onChange={(event: ChangeEvent<HTMLInputElement>) => setModelCatalogPath(event.target.value)}
                          placeholder={
                            runtimePreferencesQuery.data?.defaultModelCatalogPath ||
                            'E:/path/to/models.json'
                          }
                          value={modelCatalogPath}
                        />
                        <div className="input-action-floating">
                          <button
                            className="ide-button ide-button--secondary ide-button--sm"
                            onClick={() => importModelCatalogMutation.mutate()}
                            type="button"
                            title={i18n._({ id: 'Load template', message: 'Load template' })}
                          >
                            {i18n._({ id: 'Template', message: 'Template' })}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="field">
                      <label className="field-label">
                        {i18n._({ id: 'Shell Type', message: 'Shell Type' })}
                      </label>
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
                    </div>

                    <div className="field">
                      <label className="field-label">
                        {i18n._({ id: 'Terminal Shell', message: 'Terminal Shell' })}
                      </label>
                      <SelectControl
                        ariaLabel={i18n._({
                          id: 'Default terminal shell',
                          message: 'Default terminal shell',
                        })}
                        fullWidth
                        onChange={setDefaultTerminalShell}
                        options={terminalShellOptions}
                        value={defaultTerminalShell}
                      />
                    </div>
                  </div>

                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Choose which backend shell opens when you start a terminal session. Availability depends on the backend machine and PATH.',
                      message:
                        'Choose which backend shell opens when you start a terminal session. Availability depends on the backend machine and PATH.',
                    })}
                  </p>

                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Default policies for automated turns and manual command execution. Leave blank to follow runtime defaults.',
                      message:
                        'Default policies for automated turns and manual command execution. Leave blank to follow runtime defaults.',
                    })}
                  </p>

                  <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div className="field">
                      <label className="field-label">
                        {i18n._({
                          id: 'Approval Policy',
                          message: 'Approval Policy',
                        })}
                      </label>
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
                    </div>
                  </div>

                  <div className="form-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <TextArea
                      label={i18n._({
                        id: 'Turn Sandbox (JSON)',
                        message: 'Turn Sandbox (JSON)',
                      })}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        setDefaultTurnSandboxPolicyInput(event.target.value)
                      }
                      placeholder='{"type":"dangerFullAccess"}'
                      rows={4}
                      value={defaultTurnSandboxPolicyInput}
                    />

                    <TextArea
                      label={i18n._({
                        id: 'Command Sandbox (JSON)',
                        message: 'Command Sandbox (JSON)',
                      })}
                      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                        setDefaultCommandSandboxPolicyInput(event.target.value)
                      }
                      placeholder='{"type":"dangerFullAccess"}'
                      rows={4}
                      value={defaultCommandSandboxPolicyInput}
                    />
                  </div>

                  <TextArea
                    label={i18n._({
                      id: 'Model Shell Type Overrides (JSON)',
                      message: 'Model Shell Type Overrides (JSON)',
                    })}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setModelShellTypeOverridesInput(event.target.value)
                    }
                    placeholder="{}"
                    rows={4}
                    value={modelShellTypeOverridesInput}
                  />
                </div>
              </form>

              <div className="config-card">
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
                              defaultTerminalShell: runtimePreferencesQuery.data.effectiveDefaultTerminalShell,
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
                              defaultTerminalShell: runtimePreferencesQuery.data.configuredDefaultTerminalShell,
                              modelShellTypeOverrides: runtimePreferencesQuery.data.configuredModelShellTypeOverrides,
                              defaultTurnApprovalPolicy: runtimePreferencesQuery.data.configuredDefaultTurnApprovalPolicy,
                              defaultTurnSandboxPolicy: runtimePreferencesQuery.data.configuredDefaultTurnSandboxPolicy,
                              defaultCommandSandboxPolicy: runtimePreferencesQuery.data.configuredDefaultCommandSandboxPolicy,
                            }}
                          />
                        ),
                      },
                      {
                        id: 'runtime-state',
                        label: i18n._({ id: 'Runtime State', message: 'Runtime State' }),
                        icon: <RefreshIcon />,
                        content: workspaceRuntimeStateQuery.isLoading ? (
                          <div className="notice">
                            {i18n._({
                              id: 'Loading runtime state…',
                              message: 'Loading runtime state…',
                            })}
                          </div>
                        ) : workspaceRuntimeStateQuery.data ? (
                          <div className="form-stack">
                            <div className="mode-metrics">
                              <div className="mode-metric">
                                <span>{i18n._({ id: 'Status', message: 'Status' })}</span>
                                <strong>{workspaceRuntimeStateQuery.data.status}</strong>
                              </div>
                              <div className="mode-metric">
                                <span>{i18n._({ id: 'Config Load', message: 'Config Load' })}</span>
                                <strong>{workspaceRuntimeStateQuery.data.configLoadStatus}</strong>
                              </div>
                              <div className="mode-metric">
                                <span>{i18n._({ id: 'Restart Required', message: 'Restart Required' })}</span>
                                <strong>
                                  {workspaceRuntimeStateQuery.data.restartRequired
                                    ? i18n._({ id: 'Yes', message: 'Yes' })
                                    : i18n._({ id: 'No', message: 'No' })}
                                </strong>
                              </div>
                            </div>
                            <div className="config-helper-grid config-helper-grid--compact">
                              <ConfigHelperCard
                                description={
                                  workspaceRuntimeStateQuery.data.startedAt
                                    ? formatLocaleDateTime(workspaceRuntimeStateQuery.data.startedAt)
                                    : i18n._({ id: 'Not started', message: 'Not started' })
                                }
                                title={i18n._({ id: 'Started', message: 'Started' })}
                              />
                              <ConfigHelperCard
                                description={formatLocaleDateTime(workspaceRuntimeStateQuery.data.updatedAt)}
                                title={i18n._({ id: 'Updated', message: 'Updated' })}
                              />
                              <ConfigHelperCard
                                description={workspaceRuntimeStateQuery.data.command || '—'}
                                title={i18n._({ id: 'Command', message: 'Command' })}
                              />
                            </div>
                            <SettingsJsonPreview
                              description={i18n._({
                                id: 'Observed runtime process state and config load status for the selected workspace.',
                                message:
                                  'Observed runtime process state and config load status for the selected workspace.',
                              })}
                              title={i18n._({
                                id: 'Runtime Process State',
                                message: 'Runtime Process State',
                              })}
                              value={workspaceRuntimeStateQuery.data}
                            />
                          </div>
                        ) : (
                          <div className="empty-state">
                            {i18n._({
                              id: 'Runtime state is unavailable for the selected workspace.',
                              message: 'Runtime state is unavailable for the selected workspace.',
                            })}
                          </div>
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
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Standard local execution.',
                      message: 'Standard local execution.',
                    })}
                    title="local"
                  />
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Streaming output + stdin.',
                      message: 'Streaming output + stdin.',
                    })}
                    title="unified_exec"
                  />
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Script string wrapper.',
                      message: 'Script string wrapper.',
                    })}
                    title="shell_command"
                  />
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Upstream catalog values.',
                      message: 'Upstream catalog values.',
                    })}
                    title="default"
                  />
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
                  <ConfigHelperCard
                    description='{"type":"dangerFullAccess"}'
                    title="dangerFullAccess"
                  />
                  <ConfigHelperCard
                    description='{"type":"externalSandbox","networkAccess":"enabled"}'
                    title="externalSandbox"
                  />
                  <ConfigHelperCard
                    description='{"type":"workspaceWrite","networkAccess":true}'
                    title="workspaceWrite"
                  />
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Use `never` together with `dangerFullAccess` when you want a fully unsandboxed, no-approval turn.',
                      message:
                        'Use `never` together with `dangerFullAccess` when you want a fully unsandboxed, no-approval turn.',
                    })}
                    title={i18n._({ id: 'Approval', message: 'Approval' })}
                  />
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
                  <TextArea
                    label={i18n._({
                      id: 'Policy (JSON)',
                      message: 'Policy (JSON)',
                    })}
                    onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                      setShellEnvironmentPolicyInput(event.target.value)
                    }
                    placeholder='{"inherit":"all"}'
                    rows={8}
                    value={shellEnvironmentPolicyInput}
                  />
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
                  <div className="setting-row__actions">
                    <button
                      className="ide-button ide-button--secondary ide-button--sm"
                      disabled={!workspaceId || restartRuntimeMutation.isPending}
                      onClick={() => restartRuntimeMutation.mutate()}
                      type="button"
                    >
                      {restartRuntimeMutation.isPending
                        ? i18n._({ id: 'Restarting…', message: 'Restarting…' })
                        : i18n._({ id: 'Restart Runtime', message: 'Restart Runtime' })}
                    </button>
                    <button className="ide-button ide-button--primary ide-button--sm" disabled={!workspaceId} type="submit">
                      {writeConfigMutation.isPending
                        ? i18n._({ id: 'Writing…', message: 'Writing…' })
                        : i18n._({ id: 'Write Key', message: 'Write Key' })}
                    </button>
                  </div>
                </div>
                <div className="form-stack">
                  <Input
                    label={i18n._({ id: 'Key Path', message: 'Key Path' })}
                    onChange={(event) => setConfigKeyPath(event.target.value)}
                    value={configKeyPath}
                  />
                  {suggestedConfigTemplate ? (
                    <div className="config-card config-card--muted">
                      <div className="config-card__header">
                        <strong>{suggestedConfigTemplate.title}</strong>
                        <button
                          className="ide-button ide-button--secondary ide-button--sm"
                          onClick={() =>
                            setConfigValue(JSON.stringify(suggestedConfigTemplate.value, null, 2))
                          }
                          type="button"
                        >
                          {i18n._({ id: 'Load Example', message: 'Load Example' })}
                        </button>
                      </div>
                      <p className="config-inline-note">{suggestedConfigTemplate.description}</p>
                      <SettingsJsonPreview
                        collapsible={false}
                        description={i18n._({
                          id: 'Suggested JSON payload for the current key path.',
                          message: 'Suggested JSON payload for the current key path.',
                        })}
                        title={i18n._({ id: 'Suggested Template', message: 'Suggested Template' })}
                        value={suggestedConfigTemplate.value}
                      />
                    </div>
                  ) : null}
                  {directWriteRequiresRestart ? (
                    <InlineNotice
                      noticeKey={`runtime-sensitive-key-${configKeyPath}`}
                      title={i18n._({
                        id: 'Runtime Restart Likely Required',
                        message: 'Runtime Restart Likely Required',
                      })}
                    >
                      {directWriteRuntimeSensitiveItem
                        ? i18n._({
                            id: 'Key path {keyPath} matches runtime-sensitive prefix {matchedKey}. {description} Saving it will mark the workspace runtime as potentially stale until restart.',
                            message:
                              'Key path {keyPath} matches runtime-sensitive prefix {matchedKey}. {description} Saving it will mark the workspace runtime as potentially stale until restart.',
                            values: {
                              keyPath: configKeyPath,
                              matchedKey: directWriteRuntimeSensitiveItem.keyPath,
                              description: directWriteRuntimeSensitiveItem.description,
                            },
                          })
                        : null}
                    </InlineNotice>
                  ) : null}
                  <TextArea
                    label={i18n._({ id: 'Value (JSON)', message: 'Value (JSON)' })}
                    onChange={(event) => setConfigValue(event.target.value)}
                    rows={4}
                    value={configValue}
                  />
                </div>

                <div className="config-details-box" style={{ marginTop: '20px' }}>
                  <div className="config-card__header">
                    <strong>{i18n._({ id: 'Current Config Analysis', message: 'Current Config Analysis' })}</strong>
                  </div>
                  {configQuery.isLoading ? (
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
                  )}
                </div>
              </form>

              <div className="config-details-box">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Write Categories', message: 'Write Categories' })}</strong>
                </div>
                <div className="form-stack">
                  <p className="config-inline-note">
                    {i18n._({
                      id: 'Runtime-sensitive keys typically require a runtime restart after write. Immediate/UI keys usually take effect without restarting the app-server process.',
                      message:
                        'Runtime-sensitive keys typically require a runtime restart after write. Immediate/UI keys usually take effect without restarting the app-server process.',
                    })}
                  </p>
                  <div className="config-helper-grid config-helper-grid--compact">
                    {runtimeSensitiveConfigItems.slice(0, 6).map((item) => (
                      <ConfigHelperCard
                        description={item.description}
                        key={item.keyPath}
                        title={item.keyPath}
                      />
                    ))}
                    <ConfigHelperCard
                      description={i18n._({
                        id: 'Example of a non-runtime-sensitive key path. This type of config does not usually require runtime restart.',
                        message:
                          'Example of a non-runtime-sensitive key path. This type of config does not usually require runtime restart.',
                      })}
                      title="ui.theme"
                    />
                    <ConfigHelperCard
                      description={i18n._({
                        id: 'Another non-runtime-sensitive example for local UI or product behavior toggles.',
                        message:
                          'Another non-runtime-sensitive example for local UI or product behavior toggles.',
                      })}
                      title="notifications.enabled"
                    />
                  </div>
                </div>
              </div>

              <div className="config-details-box">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Scenario Presets & Requirements', message: 'Scenario Presets & Requirements' })}</strong>
                </div>
                <p className="config-inline-note">
                  {bestMatchingAdvancedScenario
                    ? i18n._({
                        id: 'Current config is closest to scenario "{title}" ({matched}/{total} edits matched).',
                        message:
                          'Current config is closest to scenario "{title}" ({matched}/{total} edits matched).',
                        values: {
                          title: bestMatchingAdvancedScenario.scenario.title,
                          matched: bestMatchingAdvancedScenario.matchedEditCount,
                          total: bestMatchingAdvancedScenario.totalEditCount,
                        },
                      })
                    : i18n._({
                        id: 'Current config does not closely match any built-in scenario preset.',
                        message:
                          'Current config does not closely match any built-in scenario preset.',
                      })}
                </p>
                <Tabs
                  ariaLabel={i18n._({
                    id: 'Scenario preset and requirement tabs',
                    message: 'Scenario preset and requirement tabs',
                  })}
                  className="config-scenario-tabs"
                  defaultValue={scenarioPresetDefaultTabId}
                  items={[
                    ...scenarioPresetTabItems,
                    {
                      id: 'requirements',
                      label: i18n._({ id: 'Requirements', message: 'Requirements' }),
                      icon: <FeedIcon />,
                      content: (
                        <div className="config-card config-card--muted config-scenario-panel">
                          <div className="config-card__header">
                            <strong>{i18n._({ id: 'Runtime Requirements', message: 'Runtime Requirements' })}</strong>
                          </div>
                          {requirementsQuery.data ? (
                            <SettingsJsonPreview
                              collapsible={false}
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
                          )}
                        </div>
                      )
                    }
                  ]}
                  storageKey="settings-config-advanced-scenario-tabs"
                />
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
              {applyConfigScenarioMutation.error && (
                <InlineNotice
                  details={getErrorMessage(applyConfigScenarioMutation.error)}
                  dismissible
                  noticeKey="apply-config-scenario-error"
                  title={i18n._({ id: 'Scenario Apply Failed', message: 'Scenario Apply Failed' })}
                  tone="error"
                >
                  {getErrorMessage(applyConfigScenarioMutation.error)}
                </InlineNotice>
              )}
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

              <div className="config-card">
                <div className="config-card__header">
                  <strong>{i18n._({ id: 'Detected State & Workflow', message: 'Detected State & Workflow' })}</strong>
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
                    {
                      id: 'workflow',
                      label: i18n._({ id: 'Workflow', message: 'Workflow' }),
                      icon: <SettingsIcon />,
                      content: (
                        <div className="config-helper-grid config-helper-grid--compact">
                          <ConfigHelperCard
                            description={i18n._({
                              id: 'Discover candidate artifacts from local and home scopes.',
                              message: 'Discover candidate artifacts from local and home scopes.',
                            })}
                            title={i18n._({ id: '1. Scan', message: '1. Scan' })}
                          />
                          <ConfigHelperCard
                            description={i18n._({
                              id: 'Inspect the detected payload before you import it.',
                              message: 'Inspect the detected payload before you import it.',
                            })}
                            title={i18n._({ id: '2. Review', message: '2. Review' })}
                          />
                          <ConfigHelperCard
                            description={i18n._({
                              id: 'Apply the detected state into the active workspace.',
                              message: 'Apply the detected state into the active workspace.',
                            })}
                            title={i18n._({ id: '3. Import', message: '3. Import' })}
                          />
                        </div>
                      ),
                    },
                  ]}
                />
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
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Detect artifacts in home & local scopes.',
                      message: 'Detect artifacts in home & local scopes.',
                    })}
                    title={i18n._({ id: '1. Scan', message: '1. Scan' })}
                  />
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Verify detected items in the side panel.',
                      message: 'Verify detected items in the side panel.',
                    })}
                    title={i18n._({ id: '2. Review', message: '2. Review' })}
                  />
                  <ConfigHelperCard
                    description={i18n._({
                      id: 'Merge items into active workspace.',
                      message: 'Merge items into active workspace.',
                    })}
                    title={i18n._({ id: '3. Import', message: '3. Import' })}
                  />
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

function getScenarioMatchStatusClassName(match: ConfigScenarioMatch) {
  if (match.exact) {
    return 'status-pill status-pill--active'
  }

  if (match.matchedEditCount > 0) {
    return 'status-pill status-pill--paused'
  }

  return 'status-pill'
}

function getScenarioMatchStatusLabel(match: ConfigScenarioMatch) {
  if (match.exact) {
    return i18n._({ id: 'Exact', message: 'Exact' })
  }

  if (match.matchedEditCount > 0) {
    return i18n._({ id: 'Partial', message: 'Partial' })
  }

  return i18n._({ id: 'No match', message: 'No match' })
}

function parseJsonInput(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function getShellTypeOptions() {
  return [
    {
      value: '',
      label: i18n._({
        id: 'Follow catalog defaults',
        message: 'Follow catalog defaults',
      }),
      triggerLabel: i18n._({ id: 'Default', message: 'Default' }),
    },
    {
      value: 'default',
      label: i18n._({ id: 'Default', message: 'Default' }),
      triggerLabel: i18n._({ id: 'Default', message: 'Default' }),
    },
    {
      value: 'local',
      label: i18n._({ id: 'LocalShell', message: 'LocalShell' }),
      triggerLabel: i18n._({ id: 'Local', message: 'Local' }),
    },
    {
      value: 'shell_command',
      label: i18n._({ id: 'ShellCommand', message: 'ShellCommand' }),
      triggerLabel: i18n._({ id: 'ShellCmd', message: 'ShellCmd' }),
    },
    {
      value: 'unified_exec',
      label: i18n._({ id: 'UnifiedExec', message: 'UnifiedExec' }),
      triggerLabel: i18n._({ id: 'Unified', message: 'Unified' }),
    },
    {
      value: 'disabled',
      label: i18n._({ id: 'Disabled', message: 'Disabled' }),
      triggerLabel: i18n._({ id: 'Off', message: 'Off' }),
    },
  ]
}

function getTerminalShellOptions(supportedValues: string[], currentValue?: string): SelectOption[] {
  const options: SelectOption[] = [
    {
      value: '',
      label: i18n._({
        id: 'Follow backend automatic shell selection',
        message: 'Follow backend automatic shell selection',
      }),
      triggerLabel: i18n._({ id: 'Auto', message: 'Auto' }),
    },
  ]

  for (const value of supportedValues) {
    options.push(createTerminalShellOption(value))
  }

  const normalizedCurrentValue = (currentValue ?? '').trim().toLowerCase()
  if (
    normalizedCurrentValue &&
    !options.some((option) => option.value === normalizedCurrentValue)
  ) {
    options.push({
      ...createTerminalShellOption(normalizedCurrentValue),
      label: i18n._({
        id: '{shell} (currently saved, unavailable)',
        message: '{shell} (currently saved, unavailable)',
        values: {
          shell: formatTerminalShellLabel(normalizedCurrentValue),
        },
      }),
      disabled: true,
    })
  }

  return options
}

function createTerminalShellOption(value: string) {
  switch (value) {
    case 'pwsh':
      return {
        value,
        label: i18n._({
          id: 'PowerShell 7 (pwsh)',
          message: 'PowerShell 7 (pwsh)',
        }),
        triggerLabel: 'pwsh',
      }
    case 'powershell':
      return {
        value,
        label: i18n._({
          id: 'Windows PowerShell',
          message: 'Windows PowerShell',
        }),
        triggerLabel: i18n._({ id: 'PowerShell', message: 'PowerShell' }),
      }
    case 'cmd':
      return {
        value,
        label: i18n._({
          id: 'Command Prompt',
          message: 'Command Prompt',
        }),
        triggerLabel: 'cmd',
      }
    case 'wsl':
      return {
        value,
        label: 'WSL',
        triggerLabel: 'WSL',
      }
    case 'git-bash':
      return {
        value,
        label: i18n._({
          id: 'Git Bash',
          message: 'Git Bash',
        }),
        triggerLabel: i18n._({
          id: 'Git Bash',
          message: 'Git Bash',
        }),
      }
    case 'bash':
      return { value, label: 'bash', triggerLabel: 'bash' }
    case 'zsh':
      return { value, label: 'zsh', triggerLabel: 'zsh' }
    case 'sh':
      return { value, label: 'sh', triggerLabel: 'sh' }
    default:
      return {
        value,
        label: formatTerminalShellLabel(value),
        triggerLabel: value,
      }
  }
}

function getApprovalPolicyOptions() {
  return [
    {
      value: '',
      label: i18n._({
        id: 'Follow runtime default',
        message: 'Follow runtime default',
      }),
      triggerLabel: i18n._({ id: 'Default', message: 'Default' }),
    },
    {
      value: 'untrusted',
      label: i18n._({ id: 'Untrusted', message: 'Untrusted' }),
      triggerLabel: i18n._({ id: 'Untrusted', message: 'Untrusted' }),
    },
    {
      value: 'on-failure',
      label: i18n._({ id: 'On Failure', message: 'On Failure' }),
      triggerLabel: i18n._({ id: 'Failure', message: 'Failure' }),
    },
    {
      value: 'on-request',
      label: i18n._({ id: 'On Request', message: 'On Request' }),
      triggerLabel: i18n._({ id: 'Request', message: 'Request' }),
    },
    {
      value: 'never',
      label: i18n._({ id: 'Never', message: 'Never' }),
      triggerLabel: i18n._({ id: 'Never', message: 'Never' }),
    },
  ]
}

function parseShellOverridesInput(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return {}
  }

  const parsed = JSON.parse(trimmed)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(
      i18n._({
        id: 'Model Shell Type Overrides must be a JSON object',
        message: 'Model Shell Type Overrides must be a JSON object',
      }),
    )
  }

  const normalized: Record<string, string> = {}
  for (const [key, rawValue] of Object.entries(parsed)) {
    if (typeof rawValue !== 'string') {
      throw new Error(
        i18n._({
          id: 'Model shell override for "{key}" must be a string',
          message: 'Model shell override for "{key}" must be a string',
          values: { key },
        }),
      )
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
    throw new Error(
      i18n._({
        id: 'Sandbox Policy must be a JSON object',
        message: 'Sandbox Policy must be a JSON object',
      }),
    )
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
    throw new Error(
      i18n._({
        id: 'shell_environment_policy must be a JSON object',
        message: 'shell_environment_policy must be a JSON object',
      }),
    )
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
      return i18n._({ id: 'untrusted', message: 'untrusted' })
    case 'on-failure':
      return i18n._({ id: 'on-failure', message: 'on-failure' })
    case 'on-request':
      return i18n._({ id: 'on-request', message: 'on-request' })
    case 'never':
      return i18n._({ id: 'never', message: 'never' })
    default:
      return i18n._({ id: 'inherit', message: 'inherit' })
  }
}

function formatSandboxPolicyLabel(value?: Record<string, unknown> | null) {
  if (!value || typeof value !== 'object') {
    return i18n._({ id: 'inherit', message: 'inherit' })
  }

  const rawType = typeof value.type === 'string' ? value.type : ''
  if (!rawType) {
    return i18n._({ id: 'inherit', message: 'inherit' })
  }

  if (rawType === 'externalSandbox' && typeof value.networkAccess === 'string') {
    return i18n._({
      id: 'externalSandbox:{networkAccess}',
      message: 'externalSandbox:{networkAccess}',
      values: { networkAccess: value.networkAccess },
    })
  }

  if (
    (rawType === 'workspaceWrite' || rawType === 'readOnly') &&
    typeof value.networkAccess === 'boolean'
  ) {
    return i18n._({
      id: '{type}:{mode}',
      message: '{type}:{mode}',
      values: {
        type: rawType,
        mode: value.networkAccess
          ? i18n._({ id: 'network', message: 'network' })
          : i18n._({ id: 'offline', message: 'offline' }),
      },
    })
  }

  return rawType
}

function formatTerminalShellLabel(value?: string | null) {
  switch ((value ?? '').trim()) {
    case 'pwsh':
      return i18n._({
        id: 'PowerShell 7 (pwsh)',
        message: 'PowerShell 7 (pwsh)',
      })
    case 'powershell':
      return i18n._({
        id: 'Windows PowerShell',
        message: 'Windows PowerShell',
      })
    case 'cmd':
      return i18n._({
        id: 'Command Prompt',
        message: 'Command Prompt',
      })
    case 'wsl':
      return 'WSL'
    case 'git-bash':
      return i18n._({
        id: 'Git Bash',
        message: 'Git Bash',
      })
    case 'bash':
      return 'bash'
    case 'zsh':
      return 'zsh'
    case 'sh':
      return 'sh'
    default:
      return i18n._({ id: 'Auto', message: 'Auto' })
  }
}
