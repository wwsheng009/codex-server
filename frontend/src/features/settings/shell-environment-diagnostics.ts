export type ShellEnvironmentDiagnosisSummary = {
  inherit: string
  explicitSetCount: number
  explicitSetKeys: string[]
  windowsCommandResolution: 'at-risk' | 'patched' | 'normal' | 'unknown'
  hasPATHEXT: boolean
  hasSystemRoot: boolean
  hasComSpec: boolean
  missingWindowsVars: string[]
}

export type ShellEnvironmentDiagnosis = {
  info: string
  summary: ShellEnvironmentDiagnosisSummary
  warning: string
}

export function buildShellEnvironmentDiagnosis(
  value: Record<string, unknown> | null,
): ShellEnvironmentDiagnosis {
  const inherit = stringField(value?.inherit) || 'not-explicit'
  const setObject =
    value?.set && typeof value.set === 'object' && !Array.isArray(value.set)
      ? (value.set as Record<string, unknown>)
      : {}
  const explicitSetKeys = Object.keys(setObject).sort()
  const hasPATHEXT = typeof setObject.PATHEXT === 'string' && setObject.PATHEXT.trim() !== ''
  const hasSystemRoot =
    typeof setObject.SystemRoot === 'string' && setObject.SystemRoot.trim() !== ''
  const hasComSpec = typeof setObject.ComSpec === 'string' && setObject.ComSpec.trim() !== ''
  const missingWindowsVars = ['PATHEXT', 'SystemRoot', 'ComSpec'].filter((key) => {
    switch (key) {
      case 'PATHEXT':
        return !hasPATHEXT
      case 'SystemRoot':
        return !hasSystemRoot
      default:
        return !hasComSpec
    }
  })

  const summary: ShellEnvironmentDiagnosisSummary = {
    inherit,
    explicitSetCount: explicitSetKeys.length,
    explicitSetKeys,
    windowsCommandResolution:
      inherit === 'core'
        ? missingWindowsVars.length
          ? 'at-risk'
          : 'patched'
        : inherit === 'not-explicit'
          ? 'unknown'
          : 'normal',
    hasPATHEXT,
    hasSystemRoot,
    hasComSpec,
    missingWindowsVars,
  }

  if (!value) {
    return {
      info:
        'No explicit shell_environment_policy key is present in the resolved config. App-server defaults still apply until you write an override.',
      summary,
      warning: '',
    }
  }

  if (inherit === 'core' && missingWindowsVars.length > 0) {
    return {
      info: '',
      summary,
      warning: `inherit="core" is active, but ${missingWindowsVars.join(', ')} ${missingWindowsVars.length === 1 ? 'is' : 'are'} not explicitly restored in shell_environment_policy.set. On Windows this can break command resolution for cmd/node/npm style invocations.`,
    }
  }

  if (inherit === 'core') {
    return {
      info:
        'inherit="core" is active and the common Windows command-resolution variables are explicitly restored.',
      summary,
      warning: '',
    }
  }

  return {
    info:
      'The current shell_environment_policy does not indicate the specific Windows core-mode risk pattern.',
    summary,
    warning: '',
  }
}

export function createInheritAllShellEnvironmentPolicy() {
  return {
    inherit: 'all',
  }
}

export function createCoreWindowsShellEnvironmentPolicy() {
  return {
    inherit: 'core',
    set: {
      PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    },
  }
}

function stringField(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}
