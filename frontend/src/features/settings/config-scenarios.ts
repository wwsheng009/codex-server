import { i18n } from '../../i18n/runtime'

export type ConfigScenario = {
  id: string
  title: string
  description: string
  edits: Array<{ keyPath: string; value: unknown }>
}

export type ConfigScenarioMatch = {
  scenario: ConfigScenario
  matchedEditCount: number
  totalEditCount: number
  exact: boolean
}

export type ConfigScenarioDiffEntry = {
  keyPath: string
  currentValue: unknown
  nextValue: unknown
}

export function getAdvancedConfigScenarios(): ConfigScenario[] {
  return [
    {
      id: 'windows-safe-core-env',
      title: i18n._({ id: 'Windows Safe Core Env', message: 'Windows Safe Core Env' }),
      description: i18n._({
        id: 'Minimize inherited environment with inherit=core while restoring Windows command-resolution variables required by cmd/node/npm style invocations.',
        message:
          'Minimize inherited environment with inherit=core while restoring Windows command-resolution variables required by cmd/node/npm style invocations.',
      }),
      edits: [
        {
          keyPath: 'shell_environment_policy',
          value: {
            inherit: 'core',
            set: {
              PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
              SystemRoot: 'C:\\Windows',
              ComSpec: 'C:\\Windows\\System32\\cmd.exe',
            },
          },
        },
      ],
    },
    {
      id: 'guarded-workspace-write',
      title: i18n._({ id: 'Guarded Workspace Write', message: 'Guarded Workspace Write' }),
      description: i18n._({
        id: 'Use on-request approvals with workspace-write sandbox as a conservative runtime default.',
        message:
          'Use on-request approvals with workspace-write sandbox as a conservative runtime default.',
      }),
      edits: [
        {
          keyPath: 'approval_policy',
          value: 'on-request',
        },
        {
          keyPath: 'sandbox_mode',
          value: 'workspace-write',
        },
      ],
    },
    {
      id: 'local-full-access',
      title: i18n._({ id: 'Local Full Access', message: 'Local Full Access' }),
      description: i18n._({
        id: 'Use never approval policy with danger-full-access as the default runtime mode for trusted local environments.',
        message:
          'Use never approval policy with danger-full-access as the default runtime mode for trusted local environments.',
      }),
      edits: [
        {
          keyPath: 'approval_policy',
          value: 'never',
        },
        {
          keyPath: 'sandbox_mode',
          value: 'danger-full-access',
        },
      ],
    },
  ]
}

export function getConfigScenarioMatch(
  config: Record<string, unknown> | undefined,
  scenario: ConfigScenario,
): ConfigScenarioMatch {
  const matchedEditCount = scenario.edits.reduce((count, edit) => {
    const currentValue = getValueAtKeyPath(config, edit.keyPath)
    return deepEqual(currentValue, edit.value) ? count + 1 : count
  }, 0)

  return {
    scenario,
    matchedEditCount,
    totalEditCount: scenario.edits.length,
    exact: matchedEditCount === scenario.edits.length,
  }
}

export function getBestMatchingConfigScenario(
  config: Record<string, unknown> | undefined,
  scenarios: ConfigScenario[],
): ConfigScenarioMatch | null {
  if (!scenarios.length) {
    return null
  }

  const matches = scenarios.map((scenario) => getConfigScenarioMatch(config, scenario))
  matches.sort((left, right) => {
    if (left.matchedEditCount === right.matchedEditCount) {
      return right.totalEditCount - left.totalEditCount
    }

    return right.matchedEditCount - left.matchedEditCount
  })

  if (matches[0].matchedEditCount === 0) {
    return null
  }

  return matches[0]
}

export function getConfigScenarioDiff(
  config: Record<string, unknown> | undefined,
  scenario: ConfigScenario,
): ConfigScenarioDiffEntry[] {
  return scenario.edits
    .map((edit) => {
      const currentValue = getValueAtKeyPath(config, edit.keyPath)
      if (deepEqual(currentValue, edit.value)) {
        return null
      }

      return {
        keyPath: edit.keyPath,
        currentValue,
        nextValue: edit.value,
      } satisfies ConfigScenarioDiffEntry
    })
    .filter((entry): entry is ConfigScenarioDiffEntry => entry !== null)
}

function getValueAtKeyPath(
  root: Record<string, unknown> | undefined,
  keyPath: string,
): unknown {
  if (!root) {
    return undefined
  }

  return keyPath.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined
    }

    return (current as Record<string, unknown>)[segment]
  }, root)
}

function deepEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}
