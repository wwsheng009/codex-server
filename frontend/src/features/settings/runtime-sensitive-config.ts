export type RuntimeSensitiveConfigItem = {
  keyPath: string
  description: string
}

export type SuggestedConfigTemplate = {
  title: string
  description: string
  value: unknown
}

export const runtimeSensitiveConfigItems: RuntimeSensitiveConfigItem[] = [
  {
    keyPath: 'shell_environment_policy',
    description: 'Controls inherited environment variables for shell, command/exec, unified_exec, and thread/shellCommand child processes.',
  },
  {
    keyPath: 'approval_policy',
    description: 'Changes the default approval behavior used by new thread and turn operations.',
  },
  {
    keyPath: 'sandbox_mode',
    description: 'Changes the default sandbox mode for new sessions when no per-request override is provided.',
  },
  {
    keyPath: 'sandbox_workspace_write',
    description: 'Changes workspace-write sandbox details such as writable roots and network access.',
  },
  {
    keyPath: 'model',
    description: 'Changes the default model used by the runtime when requests do not override model explicitly.',
  },
  {
    keyPath: 'model_provider',
    description: 'Changes the default model provider selection used by the runtime.',
  },
  {
    keyPath: 'model_reasoning_effort',
    description: 'Changes the default reasoning effort applied by the runtime.',
  },
  {
    keyPath: 'model_reasoning_summary',
    description: 'Changes the default reasoning summary behavior for new sessions.',
  },
  {
    keyPath: 'model_verbosity',
    description: 'Changes the default model verbosity used by the runtime.',
  },
  {
    keyPath: 'service_tier',
    description: 'Changes the default service tier used by the runtime.',
  },
]

export function isRuntimeSensitiveConfigKey(keyPath: string) {
  return getRuntimeSensitiveConfigItem(keyPath) !== null
}

export function getRuntimeSensitiveConfigItem(keyPath: string) {
  const normalized = keyPath.trim()
  if (!normalized) {
    return null
  }

  return (
    runtimeSensitiveConfigItems.find(
      (item) => normalized === item.keyPath || normalized.startsWith(`${item.keyPath}.`),
    ) ?? null
  )
}

export function getSuggestedConfigTemplate(keyPath: string): SuggestedConfigTemplate | null {
  const normalized = keyPath.trim()
  if (!normalized) {
    return null
  }

  if (normalized === 'shell_environment_policy') {
    return {
      title: 'Windows-safe shell environment policy',
      description:
        'Minimal example that keeps inherit=core while restoring the Windows command-resolution variables most likely to break node/npm/cmd execution.',
      value: {
        inherit: 'core',
        set: {
          PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC',
          SystemRoot: 'C:\\Windows',
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
        },
      },
    }
  }

  if (normalized === 'approval_policy') {
    return {
      title: 'Approval policy example',
      description: 'Sets the default approval policy for new sessions.',
      value: 'on-request',
    }
  }

  if (normalized === 'sandbox_mode') {
    return {
      title: 'Sandbox mode example',
      description: 'Sets the default sandbox mode when requests do not override sandbox explicitly.',
      value: 'workspace-write',
    }
  }

  if (normalized === 'sandbox_workspace_write') {
    return {
      title: 'Workspace-write sandbox example',
      description: 'Example workspace-write sandbox configuration with network enabled.',
      value: {
        writable_roots: [],
        network_access: true,
        exclude_tmpdir_env_var: false,
        exclude_slash_tmp: false,
      },
    }
  }

  if (normalized === 'model') {
    return {
      title: 'Default model example',
      description: 'Sets the default model used by the runtime.',
      value: 'gpt-5.4',
    }
  }

  if (normalized === 'model_provider') {
    return {
      title: 'Model provider example',
      description: 'Sets the default model provider identifier.',
      value: 'openai',
    }
  }

  if (normalized === 'model_reasoning_effort') {
    return {
      title: 'Reasoning effort example',
      description: 'Sets the default reasoning effort for compatible models.',
      value: 'medium',
    }
  }

  if (normalized === 'model_reasoning_summary') {
    return {
      title: 'Reasoning summary example',
      description: 'Sets the default reasoning summary mode.',
      value: 'auto',
    }
  }

  if (normalized === 'model_verbosity') {
    return {
      title: 'Model verbosity example',
      description: 'Sets the default response verbosity.',
      value: 'medium',
    }
  }

  if (normalized === 'service_tier') {
    return {
      title: 'Service tier example',
      description: 'Sets the default service tier for model requests.',
      value: 'auto',
    }
  }

  return null
}
